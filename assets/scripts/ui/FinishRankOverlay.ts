import { Camera, Node, UITransform, Vec3, view } from 'cc';
import type { RaceFinishResult } from '../core/RaceManager';
import type { Swimmer } from '../entity/Swimmer';
import { makeUiNode } from './RuntimeUiFactory';
import { LIVE_PLACEMENT_BADGE_WIDTH, makeLivePlacementBadge, makeSwimmerNameLabel, swimmerHudScaleForDistance } from './SwimmerNameOverlay';

const TAG_HEIGHT = 24;
const NAME_GAP = 4;
const HEAD_GAP = 10;
const LABEL_GAP = 4;
const SAMPLE_SECONDS = 1 / 30;

type BadgeEntry = {
    swimmer: Swimmer;
    root: Node;
    placement: number;
    width: number;
    headX: number;
    headTop: number;
    scale: number;
    shownScale: number;
    projected: boolean;
};

/** 终点沿用泳道名牌；根据真实头顶投影留白，避免昵称压住角色。 */
export class FinishRankOverlay {
    private _hud: Node | null = null;
    private _badgeRoot: Node | null = null;
    private readonly _badges = new Map<Node, BadgeEntry>();
    private _headBadgesVisible = true;
    private _elapsed = SAMPLE_SECONDS;
    private readonly _worldPos = new Vec3();
    private readonly _screen = new Vec3();
    private readonly _uiWorld = new Vec3();
    private readonly _uiLocal = new Vec3();
    private readonly _camForward = new Vec3();
    private readonly _camToHead = new Vec3();
    private readonly _projectionEntries: BadgeEntry[] = [];
    private readonly _placedX: number[] = [];
    private readonly _placedY: number[] = [];
    private readonly _placedWidths: number[] = [];
    private readonly _placedHeights: number[] = [];

    bind(hud: Node) {
        if (!hud?.isValid) return;
        this._hud = hud;
        if (!this._badgeRoot?.isValid) this._badgeRoot = makeUiNode('FinishRankBadges', hud);
        if (this._badgeRoot.active) this._badgeRoot.active = false;
    }
    hasResults(): boolean { return this._badges.size > 0; }
    setHeadBadgesVisible(visible: boolean) {
        this._headBadgesVisible = visible;
        if (!this._badgeRoot?.isValid) return;
        const active = visible && this.hasResults();
        if (this._badgeRoot.active !== active) {
            this._badgeRoot.active = active;
            if (active) this._elapsed = SAMPLE_SECONDS;
        }
    }
    clear() {
        for (const entry of this._badges.values()) if (entry.root?.isValid) entry.root.destroy();
        this._badges.clear();
        this._projectionEntries.length = 0;
        this._elapsed = SAMPLE_SECONDS;
        if (this._badgeRoot?.active) this._badgeRoot.active = false;
    }
    addResult(result: RaceFinishResult) {
        const node = result.swimmer?.node;
        if (!node?.isValid || this._badges.has(node) || !this._badgeRoot?.isValid) return;
        const root = makeUiNode(`FinishBadge_${result.placement}`, this._badgeRoot);
        const rank = makeLivePlacementBadge('Placement', root, result.isPlayer);
        rank.label.string = `${result.placement}`;
        const name = makeSwimmerNameLabel('Name', root, result.name || result.swimmer.swimmerName);
        const width = LIVE_PLACEMENT_BADGE_WIDTH + NAME_GAP + name.width;
        root.getComponent(UITransform)!.setContentSize(width, TAG_HEIGHT);
        rank.root.setPosition(-width / 2 + LIVE_PLACEMENT_BADGE_WIDTH / 2, 0, 0);
        name.root.setPosition(width / 2 - name.width / 2, 0, 0);
        root.active = false;
        const entry: BadgeEntry = { swimmer: result.swimmer, root, placement: result.placement, width,
            headX: 0, headTop: 0, scale: 1, shownScale: -1, projected: false };
        this._badges.set(node, entry);
        this._projectionEntries.push(entry);
        // 仅新增成绩时排序，投影帧不重排层级。
        this._projectionEntries.sort((a, b) => a.placement - b.placement);
        for (let i = 0; i < this._projectionEntries.length; i++)
            this._projectionEntries[i].root.setSiblingIndex(this._projectionEntries.length - 1 - i);
        if (this._badgeRoot.active !== this._headBadgesVisible) this._badgeRoot.active = this._headBadgesVisible;
        this._elapsed = SAMPLE_SECONDS;
    }
    update(worldCamera: Camera | null, uiCamera: Camera | null, dt = SAMPLE_SECONDS) {
        if (!this._badgeRoot?.isValid || !this._badgeRoot.active || !worldCamera || !uiCamera || !this._hud?.isValid) return;
        this._elapsed += Math.max(0, dt);
        if (this._elapsed < SAMPLE_SECONDS) return;
        this._elapsed %= SAMPLE_SECONDS;
        const hud = this._hud.getComponent(UITransform);
        if (!hud) return;
        const size = view.getVisibleSize();
        const halfW = (hud.width || size.width) / 2;
        const halfH = (hud.height || size.height) / 2;
        Vec3.transformQuat(this._camForward, Vec3.FORWARD, worldCamera.node.worldRotation);
        this._placedX.length = this._placedY.length = this._placedWidths.length = this._placedHeights.length = 0;
        // 先投影所有头顶，避免名牌向上避让时挡住旁边较高的角色。
        for (const entry of this._projectionEntries) {
            entry.projected = false;
            if (entry.root.isValid && entry.swimmer.node?.activeInHierarchy) {
                entry.swimmer.getNameTagWorldPosition(this._worldPos);
                Vec3.subtract(this._camToHead, this._worldPos, worldCamera.node.worldPosition);
                if (Vec3.dot(this._camToHead, this._camForward) > 0) {
                    entry.scale = swimmerHudScaleForDistance(this._camToHead.length());
                    entry.swimmer.getHeadTopScreenPosition(worldCamera, this._screen);
                    uiCamera.screenToWorld(this._screen, this._uiWorld);
                    hud.convertToNodeSpaceAR(this._uiWorld, this._uiLocal);
                    entry.headX = Math.round(this._uiLocal.x);
                    entry.headTop = this._uiLocal.y;
                    entry.projected = Math.abs(entry.headX) < halfW && Math.abs(entry.headTop) < halfH;
                }
            }
            if (!entry.projected && entry.root.active) entry.root.active = false;
        }
        for (const entry of this._projectionEntries) {
            if (!entry.projected) continue;
            const width = entry.width * entry.scale;
            const height = TAG_HEIGHT * entry.scale;
            const x = Math.round(Math.max(-halfW + width / 2 + 4, Math.min(halfW - width / 2 - 4, entry.headX)));
            let y = Math.ceil(entry.headTop + HEAD_GAP + height / 2);
            for (let guard = 0; guard < this._projectionEntries.length * 2; guard++) {
                const previousY = y;
                for (const other of this._projectionEntries) {
                    if (!other.projected) continue;
                    // 头顶下方的头肩区域作为保留区，边缘留白不随远景缩小。
                    if (Math.abs(x - other.headX) < width / 2 + 34 * other.scale
                        && y - height / 2 < other.headTop + HEAD_GAP
                        && y + height / 2 > other.headTop - 65 * other.scale)
                        y = Math.ceil(other.headTop + HEAD_GAP + height / 2);
                }
                for (let i = 0; i < this._placedX.length; i++) {
                    const gapY = (height + this._placedHeights[i]) / 2 + LABEL_GAP;
                    if (Math.abs(x - this._placedX[i]) < (width + this._placedWidths[i]) / 2 + LABEL_GAP
                        && Math.abs(y - this._placedY[i]) < gapY)
                        y = Math.ceil(this._placedY[i] + gapY);
                }
                if (y === previousY) break;
            }
            // 上方空间不足时隐藏，不能为了挤进屏幕而把名牌压回脸上。
            if (y + height / 2 > halfH - 4) { if (entry.root.active) entry.root.active = false; continue; }
            this._placedX.push(x); this._placedY.push(y);
            this._placedWidths.push(width); this._placedHeights.push(height);
            if (!entry.root.active) entry.root.active = true;
            if (entry.shownScale !== entry.scale) { entry.shownScale = entry.scale; entry.root.setScale(entry.scale, entry.scale, 1); }
            if (entry.root.position.x !== x || entry.root.position.y !== y) entry.root.setPosition(x, y, 0);
        }
    }
}
