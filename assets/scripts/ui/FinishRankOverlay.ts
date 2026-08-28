import { Camera, Color, Graphics, Label, Node, UITransform, Vec3, view } from 'cc';
import type { RaceFinishResult } from '../core/RaceManager';
import { makeButton, makeUiNode, uiColor } from './RuntimeUiFactory';

// Screen-space finish-line ranking display. Replaces the old 3D digit placards
// that were welded to lane positions (and overlapped once swimmers stopped being
// lane-locked). Two complementary parts, both driven by the same finish results:
//   1. Head badges: a small "rank + name" chip pinned above each finished
//      swimmer, projected world -> screen every frame so it follows the top-view
//      camera. Overlapping swimmers get their badges vertically de-collided and
//      the best rank is drawn on top, so who-is-which stays legible.
//   2. Side panel: a compact standing list on the left ("名次" + rank/name rows),
//      rebuilt as each swimmer crosses the line.

const PLAYER_ACCENT = uiColor(255, 214, 44, 255);
const AI_ACCENT = uiColor(126, 200, 255, 255);
const CHIP_TEXT = uiColor(10, 22, 38, 255);
const BADGE_BG = uiColor(10, 24, 40, 224);
const BADGE_BG_PLAYER = uiColor(58, 40, 6, 236);
const NAME_TEXT = uiColor(238, 246, 255, 255);
const ELIMINATED_TEXT = uiColor(132, 147, 162, 255);
const PANEL_BG = uiColor(9, 22, 38, 206);
const PANEL_TITLE = uiColor(150, 214, 255, 255);

const BADGE_HEIGHT = 30;
const CHIP_RADIUS = 12;
const BADGE_PADDING = 8;
const BADGE_HEAD_OFFSET_Y = 26;
const BADGE_STACK_GAP = 33;
const BADGE_CLUSTER_X = 110;

const PANEL_MARGIN = 14;
// Compact two-column layout: keep enough room for the existing six-character
// display name while tightening the visual gutter between rank and name.
const PANEL_WIDTH = 160;
const PANEL_RANK_CENTER_FROM_LEFT = 20;
const PANEL_RANK_LABEL_WIDTH = 28;
const PANEL_NAME_LEFT_FROM_LEFT = 36;
const PANEL_NAME_RIGHT_PADDING = 6;
const PANEL_TITLE_H = 30;
const PANEL_ROW_H = 30;
const PANEL_TOP_CLEARANCE = PANEL_TITLE_H + PANEL_ROW_H;
const EXIT_BUTTON_H = 36;
const EXIT_BUTTON_GAP = 8;

// Slack (in UI px) allowed past the HUD edge before a head badge is culled, so a
// swimmer right at the screen border does not pop in/out.
const BADGE_OFF_SCREEN_MARGIN = 70;

type BadgeEntry = {
    swimmerNode: Node;
    getHead: (out: Vec3) => Vec3;
    root: Node;
    placement: number;
};

type PanelRow = {
    root: Node;
    highlight: Graphics;
    rankLabel: Label;
    nameLabel: Label;
    swimmerNode: Node | null;
    placement: number;
    eliminated: boolean;
    isPlayer: boolean;
    name: string;
};

export class FinishRankOverlay {
    private _hud: Node | null = null;
    private _badgeRoot: Node | null = null;
    private _panel: Node | null = null;
    private _panelBg: Graphics | null = null;
    private _panelRows: Node | null = null;
    private _exitButton: Node | null = null;
    private _panelWidth = 0;
    private _panelHeight = 0;
    private readonly _badges = new Map<Node, BadgeEntry>();
    private readonly _results: RaceFinishResult[] = [];
    private readonly _panelRowPool: PanelRow[] = [];
    private _headBadgesVisible = true;

    // Reused scratch vectors so per-frame projection allocates nothing.
    private readonly _worldPos = new Vec3();
    private readonly _screen = new Vec3();
    private readonly _uiWorld = new Vec3();
    private readonly _uiLocal = new Vec3();
    private readonly _camForward = new Vec3();
    private readonly _camToHead = new Vec3();
    private readonly _projectionEntries: BadgeEntry[] = [];
    private readonly _placedX: number[] = [];
    private readonly _placedY: number[] = [];

    bind(hud: Node, width: number, height: number, onExitRace: () => void) {
        if (!hud?.isValid) {
            return;
        }
        this._hud = hud;
        if (!this._badgeRoot?.isValid) {
            this._badgeRoot = makeUiNode('FinishRankBadges', hud);
        }
        if (!this._panel?.isValid) {
            const panel = makeUiNode('FinishRankPanel', hud);
            const bg = panel.addComponent(Graphics);
            const title = makeUiNode('Title', panel);
            const titleLabel = title.addComponent(Label);
            titleLabel.string = '实时名次';
            titleLabel.fontSize = 18;
            titleLabel.color = PANEL_TITLE;
            titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
            titleLabel.verticalAlign = Label.VerticalAlign.CENTER;
            title.getComponent(UITransform)!.setContentSize(PANEL_WIDTH, PANEL_TITLE_H);
            this._panelRows = makeUiNode('Rows', panel);
            this._exitButton = makeButton('ExitRaceButton', panel, PANEL_WIDTH, EXIT_BUTTON_H, uiColor(190, 64, 72, 238), '退出比赛');
            this._exitButton.on(Node.EventType.TOUCH_END, onExitRace);
            this._panel = panel;
            this._panelBg = bg;
        }
        // Top-right standing corner (the finish line sits on the left in the
        // final top-view framing, so the board reads better opposite it).
        // makeUiNode anchors at centre so offset by half.
        this._panel!.setPosition(
            width / 2 - PANEL_MARGIN - PANEL_WIDTH / 2,
            height / 2 - PANEL_TOP_CLEARANCE - PANEL_MARGIN,
            0,
        );
        this._panel!.active = false;
        this._badgeRoot!.active = false;
    }

    hasResults(): boolean {
        return this._results.length > 0;
    }

    setHeadBadgesVisible(visible: boolean) {
        this._headBadgesVisible = visible;
        if (this._badgeRoot?.isValid) {
            const active = visible && this._badges.size > 0;
            if (this._badgeRoot.active !== active) {
                this._badgeRoot.active = active;
            }
        }
    }

    clear() {
        for (const entry of this._badges.values()) {
            if (entry.root?.isValid) {
                entry.root.destroy();
            }
        }
        this._badges.clear();
        this._projectionEntries.length = 0;
        this._results.length = 0;
        for (const row of this._panelRowPool) {
            row.root.active = false;
        }
        if (this._panel?.isValid) {
            this._panel.active = false;
        }
        if (this._badgeRoot?.isValid) {
            this._badgeRoot.active = false;
        }
    }

    addResult(result: RaceFinishResult) {
        const node = result.swimmer?.node;
        if (!node?.isValid || this._badges.has(node) || !this._badgeRoot?.isValid) {
            return;
        }
        this.replaceResult(result);
        const swimmer = result.swimmer;
        this._badges.set(node, {
            swimmerNode: node,
            getHead: (out) => swimmer.getCameraUpperBodyWorldPosition(out),
            root: this.buildBadge(result),
            placement: result.placement,
        });
        this._badgeRoot.active = this._headBadgesVisible;
        this.refreshBadgeSiblingOrder();
        this.rebuildPanel();
    }

    // The panel is also the in-race standing board. Only rebuild its UI when
    // order or placement changes; distances update every frame but do not need
    // to recreate labels while the order is stable.
    showLiveResults(results: RaceFinishResult[]) {
        if (!this._panel?.isValid || !this._panelRows?.isValid) {
            return;
        }
        this._results.length = 0;
        for (const result of results) {
            this._results.push(result);
        }
        this.rebuildPanel();
    }

    // Reproject every head badge into HUD-local space and de-overlap them so
    // stacked swimmers stay individually readable. Call after the race camera
    // has been updated for the frame.
    update(worldCamera: Camera | null, uiCamera: Camera | null) {
        if (!this._badgeRoot?.isValid || !this._badgeRoot.active
            || !worldCamera || !uiCamera || !this._hud?.isValid) {
            return;
        }
        const hudTransform = this._hud.getComponent(UITransform);
        if (!hudTransform) {
            return;
        }
        const entries = this._projectionEntries;
        this._placedX.length = 0;
        this._placedY.length = 0;
        const size = view.getVisibleSize();
        const halfW = (hudTransform.width || size.width) / 2 + BADGE_OFF_SCREEN_MARGIN;
        const halfH = (hudTransform.height || size.height) / 2 + BADGE_OFF_SCREEN_MARGIN;
        // Camera forward (the -Z axis of the camera node) used to reject swimmers
        // that are behind the camera, e.g. when facing away from the finish wall.
        Vec3.transformQuat(this._camForward, Vec3.FORWARD, worldCamera.node.worldRotation);
        for (const entry of entries) {
            entry.getHead(this._worldPos);
            // Behind the camera -> hide instead of projecting a mirrored ghost.
            Vec3.subtract(this._camToHead, this._worldPos, worldCamera.node.worldPosition);
            if (Vec3.dot(this._camToHead, this._camForward) <= 0) {
                if (entry.root.active) {
                    entry.root.active = false;
                }
                continue;
            }
            worldCamera.worldToScreen(this._worldPos, this._screen);
            uiCamera.screenToWorld(this._screen, this._uiWorld);
            hudTransform.convertToNodeSpaceAR(this._uiWorld, this._uiLocal);
            // Off the visible HUD area -> hide.
            if (Math.abs(this._uiLocal.x) > halfW || Math.abs(this._uiLocal.y) > halfH) {
                if (entry.root.active) {
                    entry.root.active = false;
                }
                continue;
            }
            if (!entry.root.active) {
                entry.root.active = true;
            }
            const x = Math.round(this._uiLocal.x);
            let y = Math.round(this._uiLocal.y + BADGE_HEAD_OFFSET_Y);
            for (let guard = 0; guard < entries.length; guard++) {
                let collided = false;
                for (let i = 0; i < this._placedX.length; i++) {
                    if (Math.abs(this._placedX[i] - x) < BADGE_CLUSTER_X
                        && Math.abs(this._placedY[i] - y) < BADGE_STACK_GAP) {
                        y = this._placedY[i] + BADGE_STACK_GAP;
                        collided = true;
                        break;
                    }
                }
                if (!collided) {
                    break;
                }
            }
            this._placedX.push(x);
            this._placedY.push(y);
            const current = entry.root.position;
            if (current.x !== x || current.y !== y) {
                entry.root.setPosition(x, y, 0);
            }
        }
    }

    private buildBadge(result: RaceFinishResult): Node {
        const accent = result.isPlayer ? PLAYER_ACCENT : AI_ACCENT;
        const bgColor = result.isPlayer ? BADGE_BG_PLAYER : BADGE_BG;
        const name = displayName(result);
        const nameWidth = estimateTextWidth(name, 16);
        const badgeW = BADGE_PADDING + CHIP_RADIUS * 2 + 6 + nameWidth + BADGE_PADDING;

        const badge = makeUiNode(`FinishBadge_${result.placement}`, this._badgeRoot!);
        badge.getComponent(UITransform)!.setContentSize(badgeW, BADGE_HEIGHT);

        const bg = badge.addComponent(Graphics);
        bg.fillColor = bgColor;
        bg.strokeColor = accent;
        bg.lineWidth = 2;
        bg.roundRect(-badgeW / 2, -BADGE_HEIGHT / 2, badgeW, BADGE_HEIGHT, BADGE_HEIGHT / 2);
        bg.fill();
        bg.stroke();

        const chipCenterX = -badgeW / 2 + BADGE_PADDING + CHIP_RADIUS;
        const chipNode = makeUiNode('Chip', badge);
        const chip = chipNode.addComponent(Graphics);
        chip.fillColor = accent;
        chip.circle(chipCenterX, 0, CHIP_RADIUS);
        chip.fill();

        const rankNode = makeUiNode('Rank', badge);
        rankNode.setPosition(chipCenterX, 1, 0);
        rankNode.getComponent(UITransform)!.setContentSize(CHIP_RADIUS * 2 + 6, BADGE_HEIGHT);
        const rankLabel = rankNode.addComponent(Label);
        rankLabel.string = `${result.placement}`;
        rankLabel.fontSize = 16;
        rankLabel.color = CHIP_TEXT;
        rankLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        rankLabel.verticalAlign = Label.VerticalAlign.CENTER;

        const nameNode = makeUiNode('Name', badge);
        const nameCenterX = chipCenterX + CHIP_RADIUS + 6 + nameWidth / 2;
        nameNode.setPosition(nameCenterX, 1, 0);
        nameNode.getComponent(UITransform)!.setContentSize(nameWidth + 10, BADGE_HEIGHT);
        const nameLabel = nameNode.addComponent(Label);
        nameLabel.string = name;
        nameLabel.fontSize = 16;
        nameLabel.color = result.isPlayer ? PLAYER_ACCENT : NAME_TEXT;
        nameLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        nameLabel.verticalAlign = Label.VerticalAlign.CENTER;

        return badge;
    }

    private rebuildPanel() {
        if (!this._panel?.isValid || !this._panelRows?.isValid || !this._panelBg) {
            return;
        }
        this.ensurePanelRows(this._results.length);
        const rowsHeight = this._results.length * PANEL_ROW_H;
        const panelHeight = PANEL_TITLE_H + rowsHeight + 12;
        if (panelHeight !== this._panelHeight) {
            this._panelWidth = PANEL_WIDTH;
            this._panelHeight = panelHeight;
            this._panelBg.clear();
            this._panelBg.fillColor = PANEL_BG;
            this._panelBg.roundRect(-PANEL_WIDTH / 2, -this._panelHeight, PANEL_WIDTH, this._panelHeight, 10);
            this._panelBg.fill();
            this._exitButton?.setPosition(0, -this._panelHeight - EXIT_BUTTON_GAP - EXIT_BUTTON_H / 2, 0);
            this._panel.getChildByName('Title')?.setPosition(0, -PANEL_TITLE_H / 2, 0);
        }

        for (let index = 0; index < this._panelRowPool.length; index++) {
            const row = this._panelRowPool[index];
            const result = this._results[index];
            row.root.active = !!result;
            if (result) {
                this.updatePanelRow(row, result);
            }
        }
        this._panel.active = true;
    }

    private ensurePanelRows(count: number) {
        while (this._panelRowPool.length < count) {
            const row = makeUiNode(`Row_${this._panelRowPool.length + 1}`, this._panelRows!);
            const highlight = row.addComponent(Graphics);
            const rankLabel = addRowLabel(
                row,
                -PANEL_WIDTH / 2 + PANEL_RANK_CENTER_FROM_LEFT,
                PANEL_RANK_LABEL_WIDTH,
                false,
                17,
            );
            const nameLabel = addRowLabel(
                row,
                -PANEL_WIDTH / 2 + PANEL_NAME_LEFT_FROM_LEFT,
                PANEL_WIDTH - PANEL_NAME_LEFT_FROM_LEFT - PANEL_NAME_RIGHT_PADDING,
                true,
                16,
            );
            row.setPosition(0, -PANEL_TITLE_H - this._panelRowPool.length * PANEL_ROW_H - PANEL_ROW_H / 2, 0);
            this._panelRowPool.push({
                root: row,
                highlight,
                rankLabel,
                nameLabel,
                swimmerNode: null,
                placement: -1,
                eliminated: false,
                isPlayer: false,
                name: '',
            });
        }
    }

    private updatePanelRow(row: PanelRow, result: RaceFinishResult) {
        const swimmerNode = result.swimmer?.node ?? null;
        const eliminated = result.eliminated === true;
        const presentationChanged = row.swimmerNode !== swimmerNode
            || row.eliminated !== eliminated
            || row.isPlayer !== result.isPlayer;
        if (presentationChanged) {
            row.highlight.clear();
            if (result.isPlayer) {
                row.highlight.fillColor = uiColor(255, 214, 44, 34);
                row.highlight.rect(-PANEL_WIDTH / 2 + 4, -PANEL_ROW_H / 2 + 2, PANEL_WIDTH - 8, PANEL_ROW_H - 4);
                row.highlight.fill();
            }
            const accent = eliminated ? ELIMINATED_TEXT : (result.isPlayer ? PLAYER_ACCENT : NAME_TEXT);
            row.rankLabel.color = accent;
            row.nameLabel.color = accent;
        }
        if (row.placement !== result.placement) {
            row.rankLabel.string = `${result.placement}`;
        }
        if (row.name !== result.name || row.isPlayer !== result.isPlayer) {
            row.nameLabel.string = displayName(result);
        }
        row.swimmerNode = swimmerNode;
        row.placement = result.placement;
        row.eliminated = eliminated;
        row.isPlayer = result.isPlayer;
        row.name = result.name;
    }

    private replaceResult(result: RaceFinishResult) {
        const index = this._results.findIndex((row) => row.swimmer === result.swimmer);
        if (index >= 0) {
            this._results[index] = result;
        } else {
            this._results.push(result);
        }
    }

    // Placement only changes when a result is added/rebuilt, so do not dirty the
    // UI hierarchy with setSiblingIndex on every projection frame.
    private refreshBadgeSiblingOrder() {
        this._projectionEntries.length = 0;
        for (const entry of this._badges.values()) {
            this._projectionEntries.push(entry);
        }
        this._projectionEntries.sort((a, b) => a.placement - b.placement);
        for (let i = 0; i < this._projectionEntries.length; i++) {
            this._projectionEntries[i].root.setSiblingIndex(this._projectionEntries.length - 1 - i);
        }
    }
}

function addRowLabel(
    parent: Node,
    centerX: number,
    width: number,
    leftAlign: boolean,
    fontSize: number,
): Label {
    const node = makeUiNode('L', parent);
    node.setPosition(leftAlign ? centerX + width / 2 : centerX, 0, 0);
    node.getComponent(UITransform)!.setContentSize(width, PANEL_ROW_H);
    const label = node.addComponent(Label);
    label.fontSize = fontSize;
    label.horizontalAlign = leftAlign ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    return label;
}

function displayName(result: RaceFinishResult): string {
    const name = result.name || (result.isPlayer ? '你' : 'AI');
    return name.length > 6 ? `${name.slice(0, 6)}…` : name;
}

// Rough CJK-aware width estimate so the badge pill hugs the name without a
// measure pass (full-width for non-ASCII, ~0.58em for ASCII).
function estimateTextWidth(text: string, fontSize: number): number {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
        width += text.charCodeAt(i) > 255 ? fontSize : fontSize * 0.58;
    }
    return Math.max(fontSize, width);
}
