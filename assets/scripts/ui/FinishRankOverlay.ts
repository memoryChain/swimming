import { Camera, Color, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import type { RaceFinishResult } from '../core/RaceManager';
import { makeUiNode, uiColor } from './RuntimeUiFactory';

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
const PANEL_BG = uiColor(9, 22, 38, 206);
const PANEL_TITLE = uiColor(150, 214, 255, 255);

const BADGE_HEIGHT = 30;
const CHIP_RADIUS = 12;
const BADGE_PADDING = 8;
const BADGE_HEAD_OFFSET_Y = 26;
const BADGE_STACK_GAP = 33;
const BADGE_CLUSTER_X = 110;

const PANEL_MARGIN = 14;
const PANEL_WIDTH = 184;
const PANEL_TITLE_H = 30;
const PANEL_ROW_H = 30;

type BadgeEntry = {
    swimmerNode: Node;
    getHead: (out: Vec3) => Vec3;
    root: Node;
    placement: number;
};

export class FinishRankOverlay {
    private _hud: Node | null = null;
    private _badgeRoot: Node | null = null;
    private _panel: Node | null = null;
    private _panelBg: Graphics | null = null;
    private _panelRows: Node | null = null;
    private _panelWidth = 0;
    private _panelHeight = 0;
    private readonly _badges = new Map<Node, BadgeEntry>();
    private readonly _results: RaceFinishResult[] = [];

    // Reused scratch vectors so per-frame projection allocates nothing.
    private readonly _worldPos = new Vec3();
    private readonly _screen = new Vec3();
    private readonly _uiWorld = new Vec3();
    private readonly _uiLocal = new Vec3();
    private readonly _placed: { x: number; y: number }[] = [];

    bind(hud: Node, width: number, height: number) {
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
            titleLabel.string = '名次';
            titleLabel.fontSize = 18;
            titleLabel.color = PANEL_TITLE;
            titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
            titleLabel.verticalAlign = Label.VerticalAlign.CENTER;
            title.getComponent(UITransform)!.setContentSize(PANEL_WIDTH, PANEL_TITLE_H);
            this._panelRows = makeUiNode('Rows', panel);
            this._panel = panel;
            this._panelBg = bg;
        }
        // Top-right standing corner (the finish line sits on the left in the
        // final top-view framing, so the board reads better opposite it).
        // makeUiNode anchors at centre so offset by half.
        this._panel!.setPosition(width / 2 - PANEL_MARGIN - PANEL_WIDTH / 2, height / 2 - PANEL_MARGIN, 0);
        this._panel!.active = false;
        this._badgeRoot!.active = false;
    }

    hasResults(): boolean {
        return this._results.length > 0;
    }

    clear() {
        for (const entry of this._badges.values()) {
            if (entry.root?.isValid) {
                entry.root.destroy();
            }
        }
        this._badges.clear();
        this._results.length = 0;
        if (this._panelRows?.isValid) {
            this._panelRows.removeAllChildren();
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
        this._results.push(result);
        const swimmer = result.swimmer;
        this._badges.set(node, {
            swimmerNode: node,
            getHead: (out) => swimmer.getCameraUpperBodyWorldPosition(out),
            root: this.buildBadge(result),
            placement: result.placement,
        });
        this._badgeRoot.active = true;
        this.rebuildPanel();
    }

    // Reproject every head badge into HUD-local space and de-overlap them so
    // stacked swimmers stay individually readable. Call after the race camera
    // has been updated for the frame.
    update(worldCamera: Camera | null, uiCamera: Camera | null) {
        if (!this._badgeRoot?.isValid || !worldCamera || !uiCamera || !this._hud?.isValid) {
            return;
        }
        const hudTransform = this._hud.getComponent(UITransform);
        if (!hudTransform) {
            return;
        }
        const entries: BadgeEntry[] = [];
        for (const entry of this._badges.values()) {
            if (entry.root?.isValid && entry.swimmerNode?.isValid) {
                entries.push(entry);
            }
        }
        // Best rank placed first so it keeps its natural spot above the head; the
        // worse ranks get pushed upward when they collide with it.
        entries.sort((a, b) => a.placement - b.placement);
        this._placed.length = 0;
        for (const entry of entries) {
            entry.getHead(this._worldPos);
            worldCamera.worldToScreen(this._worldPos, this._screen);
            uiCamera.screenToWorld(this._screen, this._uiWorld);
            hudTransform.convertToNodeSpaceAR(this._uiWorld, this._uiLocal);
            const x = this._uiLocal.x;
            let y = this._uiLocal.y + BADGE_HEAD_OFFSET_Y;
            for (let guard = 0; guard < entries.length; guard++) {
                let collided = false;
                for (const slot of this._placed) {
                    if (Math.abs(slot.x - x) < BADGE_CLUSTER_X && Math.abs(slot.y - y) < BADGE_STACK_GAP) {
                        y = slot.y + BADGE_STACK_GAP;
                        collided = true;
                        break;
                    }
                }
                if (!collided) {
                    break;
                }
            }
            this._placed.push({ x, y });
            entry.root.setPosition(x, y, 0);
        }
        // Draw the best rank on top of any that stacked behind it.
        for (let i = 0; i < entries.length; i++) {
            entries[i].root.setSiblingIndex(entries.length - 1 - i);
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
        this._panelRows.removeAllChildren();
        const sorted = [...this._results].sort((a, b) => a.placement - b.placement);
        const rowsHeight = sorted.length * PANEL_ROW_H;
        this._panelWidth = PANEL_WIDTH;
        this._panelHeight = PANEL_TITLE_H + rowsHeight + 12;

        this._panelBg.clear();
        this._panelBg.fillColor = PANEL_BG;
        this._panelBg.roundRect(-PANEL_WIDTH / 2, -this._panelHeight, PANEL_WIDTH, this._panelHeight, 10);
        this._panelBg.fill();

        // Title sits at the top of the (downward-growing) panel.
        const title = this._panel.getChildByName('Title');
        title?.setPosition(0, -PANEL_TITLE_H / 2, 0);

        for (let i = 0; i < sorted.length; i++) {
            const result = sorted[i];
            const rowY = -PANEL_TITLE_H - i * PANEL_ROW_H - PANEL_ROW_H / 2;
            const row = makeUiNode(`Row_${result.placement}`, this._panelRows);
            row.setPosition(0, rowY, 0);
            if (result.isPlayer) {
                const highlight = row.addComponent(Graphics);
                highlight.fillColor = uiColor(255, 214, 44, 34);
                highlight.rect(-PANEL_WIDTH / 2 + 4, -PANEL_ROW_H / 2 + 2, PANEL_WIDTH - 8, PANEL_ROW_H - 4);
                highlight.fill();
            }
            const accent = result.isPlayer ? PLAYER_ACCENT : NAME_TEXT;
            addRowLabel(row, `${result.placement}`, -PANEL_WIDTH / 2 + 26, 34, accent, false, 17);
            addRowLabel(row, displayName(result), -PANEL_WIDTH / 2 + 52, PANEL_WIDTH - 60, accent, true, 16);
        }
        this._panel.active = true;
    }
}

function addRowLabel(
    parent: Node,
    text: string,
    centerX: number,
    width: number,
    color: Color,
    leftAlign: boolean,
    fontSize: number,
): void {
    const node = makeUiNode('L', parent);
    node.setPosition(leftAlign ? centerX + width / 2 : centerX, 0, 0);
    node.getComponent(UITransform)!.setContentSize(width, PANEL_ROW_H);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.color = color;
    label.horizontalAlign = leftAlign ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
}

function displayName(result: RaceFinishResult): string {
    if (result.isPlayer) {
        return '你';
    }
    const name = result.name || 'AI';
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
