import { Camera, Color, Graphics, Label, Node, UITransform, Vec3, view } from 'cc';
import type { RaceFinishResult } from '../core/RaceManager';
import { makeUiNode, uiColor } from './RuntimeUiFactory';

// 完赛后在选手头顶展示名次与昵称，并随镜头投影更新位置。

const PLAYER_ACCENT = uiColor(255, 214, 44, 255);
const AI_ACCENT = uiColor(126, 200, 255, 255);
const CHIP_TEXT = uiColor(10, 22, 38, 255);
const BADGE_BG = uiColor(10, 24, 40, 224);
const BADGE_BG_PLAYER = uiColor(58, 40, 6, 236);
const NAME_TEXT = uiColor(238, 246, 255, 255);

const BADGE_HEIGHT = 30;
const CHIP_RADIUS = 12;
const BADGE_PADDING = 8;
const BADGE_HEAD_OFFSET_Y = 26;
const BADGE_STACK_GAP = 33;
const BADGE_CLUSTER_X = 110;

// Slack (in UI px) allowed past the HUD edge before a head badge is culled, so a
// swimmer right at the screen border does not pop in/out.
const BADGE_OFF_SCREEN_MARGIN = 70;

type BadgeEntry = {
    swimmerNode: Node;
    getHead: (out: Vec3) => Vec3;
    root: Node;
    placement: number;
};

export class FinishRankOverlay {
    private _hud: Node | null = null;
    private _badgeRoot: Node | null = null;
    private readonly _badges = new Map<Node, BadgeEntry>();
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

    bind(hud: Node) {
        if (!hud?.isValid) {
            return;
        }
        this._hud = hud;
        if (!this._badgeRoot?.isValid) {
            this._badgeRoot = makeUiNode('FinishRankBadges', hud);
        }
        this._badgeRoot!.active = false;
    }

    hasResults(): boolean {
        return this._badges.size > 0;
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
        if (this._badgeRoot?.isValid) {
            this._badgeRoot.active = false;
        }
    }

    addResult(result: RaceFinishResult) {
        const node = result.swimmer?.node;
        if (!node?.isValid || this._badges.has(node) || !this._badgeRoot?.isValid) {
            return;
        }
        const swimmer = result.swimmer;
        this._badges.set(node, {
            swimmerNode: node,
            getHead: (out) => swimmer.getCameraUpperBodyWorldPosition(out),
            root: this.buildBadge(result),
            placement: result.placement,
        });
        this._badgeRoot.active = this._headBadgesVisible;
        this.refreshBadgeSiblingOrder();
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
