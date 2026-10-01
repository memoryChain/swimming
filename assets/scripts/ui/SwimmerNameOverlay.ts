import { Camera, Color, Font, Graphics, Label, Node, Sprite, UITransform, Vec3, view } from 'cc';
import type { RaceFinishResult } from '../core/RaceManager';
import type { Swimmer } from '../entity/Swimmer';
import { styleProjectUiLabel, styleDynamicUiLabel } from './ProjectUiFonts';
import { makeUiNode } from './RuntimeUiFactory';
import { RosterNameAtlas } from './RosterNameAtlas';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

const TAG_WIDTH = 174;
const TAG_HEIGHT = 24;
export const LIVE_PLACEMENT_BADGE_WIDTH = 22;
export const LIVE_PLACEMENT_BADGE_HEIGHT = 22;
const RANK_NAME_GAP = 4;
const NAME_FONT_SIZE = 15;
const NAME_HORIZONTAL_PADDING = 2;
const NAME_MAX_WIDTH = TAG_WIDTH - LIVE_PLACEMENT_BADGE_WIDTH - RANK_NAME_GAP;
const HEAD_OFFSET_Y = 30;
const OFF_SCREEN_MARGIN = 48;
const COLLISION_PADDING_X = 2;
const COLLISION_PADDING_Y = 2;
const NAME_REFERENCE_DISTANCE = 10;
const NAME_MIN_SCALE = 0.48;
const NAME_MAX_SCALE = 1.05;
const NAME_SCALE_STEP = 0.02;
const AI_COLOR = new Color(245, 250, 252, 255);
const OUTLINE_COLOR = new Color(0, 0, 0, 51);
const RANK_BG = new Color(112, 76, 174, 242);
const RANK_TEXT = new Color(245, 250, 252);
const SELF_BG = new Color(255, 201, 58, 242);
const SELF_TEXT = new Color(54, 49, 35);

type NameEntry = {
    swimmer: Swimmer;
    root: Node;
    rankRoot: Node;
    rankLabel: Label;
    rankAtlas: Sprite | null;
    nameLabel: Label;
    displayName: string;
    nameRoot: Node;
    nameWidth: number;
    visualWidth: number;
    placement: number;
    x: number;
    y: number;
    scale: number;
};

// Lightweight race-time name tags. They reuse the same world -> screen -> HUD
// projection path as the finish badges, but deliberately render only outlined
// text so the labels stay quiet while the player is swimming.
export class SwimmerNameOverlay {
    private _hud: Node | null = null;
    private _root: Node | null = null;
    private readonly _entries: NameEntry[] = [];
    private readonly _entriesBySwimmer = new Map<Swimmer, NameEntry>();
    private readonly _worldPos = new Vec3();
    private readonly _screenPos = new Vec3();
    private readonly _uiWorld = new Vec3();
    private readonly _uiLocal = new Vec3();
    private readonly _cameraForward = new Vec3();
    private readonly _cameraToHead = new Vec3();
    private readonly _placedX: number[] = [];
    private readonly _placedY: number[] = [];
    private readonly _placedWidths: number[] = [];
    private readonly _placedHeights: number[] = [];
    private _anchorWarmupFrames = 0;
    private _atlas: RosterNameAtlas | null = null;
    private _rosterVersion = 0;
    private _atlasLoading = false;

    bind(hud: Node) {
        if (!hud?.isValid) {
            return;
        }
        this._hud = hud;
        if (!this._root?.isValid) {
            this._root = makeUiNode('SwimmerNameTags', hud);
            this._root.active = false;
            const owner = this._root;
            owner.once(Node.EventType.NODE_DESTROYED, () => {
                if (this._root !== owner) return;
                this._rosterVersion++;
                this._atlasLoading = false;
                this._atlas?.dispose(); this._atlas = null;
                this._entries.length = 0; this._entriesBySwimmer.clear();
            });
        }
    }

    setSwimmers(swimmers: readonly Swimmer[], player: Swimmer | null) {
        if (!this._root?.isValid) {
            return;
        }
        let count = 0, changed = false;
        for (const swimmer of swimmers) {
            if (!swimmer?.node?.isValid || swimmer === player) continue;
            const entry = this._entries[count++];
            if (!entry || entry.swimmer !== swimmer || entry.displayName !== fitName(swimmer.swimmerName)) changed = true;
        }
        if (!changed && count === this._entries.length) {
            this.resetTracking();
            if (!this._atlas) this.prepareNameAtlas();
            return;
        }
        this._rosterVersion++;
        this._atlasLoading = false;
        for (const entry of this._entries) if (entry.root.active) entry.root.active = false;
        this._atlas?.dispose(); this._atlas = null;
        this._root.destroyAllChildren();
        this._entries.length = 0;
        this._entriesBySwimmer.clear();
        for (const swimmer of swimmers) {
            // 本人的身份由右侧排名和原有指示标记展示，泳道内只显示其他选手。
            if (!swimmer?.node?.isValid || swimmer === player) {
                continue;
            }
            const tag = makeUiNode(`SwimmerName_${swimmer.node.name}`, this._root);
            tag.active = false;
            tag.getComponent(UITransform)!.setContentSize(TAG_WIDTH, TAG_HEIGHT);

            const placementBadge = makeLivePlacementBadge('Placement', tag, swimmer === player);
            const rankRoot = placementBadge.root;
            const rankLabel = placementBadge.label;
            rankRoot.active = false;

            const name = makeSwimmerNameLabel('Name', tag, swimmer.swimmerName);
            const nameNode = name.root;
            const nameWidth = name.width;
            const entry: NameEntry = {
                swimmer,
                root: tag,
                rankRoot,
                rankLabel,
                rankAtlas: null,
                nameLabel: nameNode.getComponent(Label)!,
                displayName: fitName(swimmer.swimmerName),
                nameRoot: nameNode,
                nameWidth,
                visualWidth: nameWidth,
                placement: -1,
                x: Number.NaN,
                y: Number.NaN,
                scale: -1,
            };
            this._entries.push(entry);
            this._entriesBySwimmer.set(swimmer, entry);
        }
        this.resetTracking();
        this.prepareNameAtlas();
    }

    private prepareNameAtlas() {
        if (this._entries.length === 0 || this._atlasLoading) return;
        const version = this._rosterVersion;
        this._atlasLoading = true;
        // 等待真实随包字体，避免把异步加载期间的替代字型永久缓存。
        loadRaceAsset(RESOURCE_PATHS.uiFonts.semibold, Font, (error, font) => {
            if (!this._root?.isValid || version !== this._rosterVersion) return;
            this._atlasLoading = false;
            if (error || !font) return;
            const source = makeUiNode('RankAtlasSource', this._root);
            const label = source.addComponent(Label);
            label.overflow = Label.Overflow.SHRINK;
            label.enableWrapText = false;
            label.font = font; label.useSystemFont = false;
            label.fontSize = 16; label.lineHeight = LIVE_PLACEMENT_BADGE_HEIGHT;
            label.color = RANK_TEXT;
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            source.getComponent(UITransform)!.setContentSize(LIVE_PLACEMENT_BADGE_WIDTH, LIVE_PLACEMENT_BADGE_HEIGHT);
            source.active = false;
            let atlas: RosterNameAtlas | null = null;
            const installed: { rank: Sprite; name: Sprite }[] = [];
            try {
                atlas = RosterNameAtlas.build(this._entries.map(entry => entry.nameLabel), label, RANK_BG);
                for (let i = 0; i < this._entries.length; i++) {
                    const entry = this._entries[i];
                    const rankNode = makeUiNode('CachedRank', entry.rankRoot);
                    rankNode.getComponent(UITransform)!.setContentSize(LIVE_PLACEMENT_BADGE_WIDTH, LIVE_PLACEMENT_BADGE_HEIGHT);
                    rankNode.active = false;
                    const rank = rankNode.addComponent(Sprite);
                    rank.sizeMode = Sprite.SizeMode.CUSTOM;
                    rank.trim = false;
                    rank.spriteFrame = atlas.ranks[Math.max(0, entry.placement - 1)];
                    const frame = atlas.names[i];
                    const nameNode = makeUiNode('CachedName', entry.nameRoot);
                    nameNode.active = false;
                    nameNode.getComponent(UITransform)!.setContentSize(frame.width, frame.height);
                    nameNode.setPosition(frame.x, frame.y, 0);
                    const sprite = nameNode.addComponent(Sprite);
                    sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false; sprite.spriteFrame = frame.frame;
                    installed.push({ rank, name: sprite });
                }
                this._atlas = atlas;
                for (let i = 0; i < this._entries.length; i++) {
                    const entry = this._entries[i], cached = installed[i];
                    entry.rankAtlas = cached.rank;
                    cached.rank.node.active = cached.name.node.active = true;
                    // 仅保留共享纹理页；释放原文字纹理和各自的 Graphics 模型。
                    const background = entry.rankRoot.getComponent(Graphics)!;
                    background.enabled = false; background.destroy();
                    entry.rankLabel.enabled = false; entry.rankLabel.destroy();
                    entry.nameLabel.enabled = false; entry.nameLabel.destroy();
                }
            } catch (error) {
                for (const cached of installed) { cached.rank.node.destroy(); cached.name.node.destroy(); }
                if (atlas !== this._atlas) atlas?.dispose();
                console.warn('[名牌] 纹理缓存未完成，保留完整文字显示', error);
            } finally {
                label.enabled = false;
                source.destroy();
            }
        });
    }

    // Called from the existing 5 Hz live-standing snapshot. Placement text is
    // written only when a swimmer changes rank; projection remains allocation-free.
    setLivePlacements(results: readonly RaceFinishResult[]) {
        for (const result of results) {
            const entry = this._entriesBySwimmer.get(result.swimmer);
            if (!entry || entry.placement === result.placement) {
                continue;
            }
            entry.placement = result.placement;
            if (entry.rankAtlas && this._atlas) {
                const frame = this._atlas.ranks[result.placement - 1];
                if (entry.rankAtlas.spriteFrame !== frame) entry.rankAtlas.spriteFrame = frame;
            } else entry.rankLabel.string = `${result.placement}`;
            if (!entry.rankRoot.active) {
                layoutNameAndPlacement(entry, true);
                entry.rankRoot.active = true;
            }
        }
    }

    clearPlacements() {
        for (const entry of this._entries) {
            entry.placement = -1;
            if (entry.rankRoot.active) {
                entry.rankRoot.active = false;
                layoutNameAndPlacement(entry, false);
            }
        }
    }

    setVisible(visible: boolean) {
        if (this._root?.isValid && this._root.active !== visible) {
            this._root.active = visible;
            if (visible) {
                this.resetTracking();
            }
        }
    }

    // A rematch can pass AWARDS -> READY -> PRECOUNTDOWN between two rendered
    // frames, so visibility never gets an edge and the old finish-line positions
    // would remain on screen. Hide cached tags for one frame while the swimmer
    // rig applies its new standing pose, then project the refreshed head bones.
    resetTracking() {
        this._anchorWarmupFrames = 1;
        for (const entry of this._entries) {
            entry.x = Number.NaN;
            entry.y = Number.NaN;
            entry.scale = -1;
            if (entry.root?.isValid && entry.root.active) {
                entry.root.active = false;
            }
        }
    }

    // 名字位置跟随每个游戏渲染帧，不使用独立采样时钟，避免与角色移动错帧。
    update(
        worldCamera: Camera | null,
        uiCamera: Camera | null,
        finishDistance: number,
        showFinished = false,
        headOffsetY = HEAD_OFFSET_Y,
    ) {
        if (!this._root?.isValid || !this._root.active || !this._hud?.isValid || !worldCamera || !uiCamera) {
            return;
        }
        if (this._anchorWarmupFrames > 0) {
            this._anchorWarmupFrames--;
            return;
        }
        const hudTransform = this._hud.getComponent(UITransform);
        if (!hudTransform) {
            return;
        }
        const visibleSize = view.getVisibleSize();
        const halfWidth = (hudTransform.width || visibleSize.width) / 2 + OFF_SCREEN_MARGIN;
        const halfHeight = (hudTransform.height || visibleSize.height) / 2 + OFF_SCREEN_MARGIN;
        Vec3.transformQuat(this._cameraForward, Vec3.FORWARD, worldCamera.node.worldRotation);
        this._placedX.length = 0;
        this._placedY.length = 0;
        this._placedWidths.length = 0;
        this._placedHeights.length = 0;

        for (const entry of this._entries) {
            const swimmerNode = entry.swimmer?.node;
            if (!entry.root?.isValid || !swimmerNode?.isValid || !swimmerNode.activeInHierarchy
                || (!showFinished && entry.swimmer.distance >= finishDistance)) {
                if (entry.root?.isValid && entry.root.active) {
                    entry.root.active = false;
                }
                continue;
            }
            entry.swimmer.getNameTagWorldPosition(this._worldPos);
            Vec3.subtract(this._cameraToHead, this._worldPos, worldCamera.node.worldPosition);
            if (Vec3.dot(this._cameraToHead, this._cameraForward) <= 0) {
                if (entry.root.active) {
                    entry.root.active = false;
                }
                continue;
            }

            const cameraDistance = Math.max(0.01, this._cameraToHead.length());
            const labelScale = swimmerHudScaleForDistance(cameraDistance);
            worldCamera.worldToScreen(this._worldPos, this._screenPos);
            uiCamera.screenToWorld(this._screenPos, this._uiWorld);
            hudTransform.convertToNodeSpaceAR(this._uiWorld, this._uiLocal);
            if (Math.abs(this._uiLocal.x) > halfWidth || Math.abs(this._uiLocal.y) > halfHeight) {
                if (entry.root.active) {
                    entry.root.active = false;
                }
                continue;
            }

            const x = Math.round(this._uiLocal.x);
            let y = Math.round(this._uiLocal.y + headOffsetY * labelScale);
            // Use this entry's actual compact layout width. The old fixed 118px
            // box was much wider than short names at distant camera scales and
            // caused false overlap transitions (visible as vertical popping).
            const collisionWidth = (entry.visualWidth + COLLISION_PADDING_X) * labelScale;
            const collisionHeight = (TAG_HEIGHT + COLLISION_PADDING_Y) * labelScale;
            for (let guard = 0; guard < this._entries.length; guard++) {
                let collided = false;
                for (let i = 0; i < this._placedX.length; i++) {
                    const overlapWidth = (this._placedWidths[i] + collisionWidth) * 0.5;
                    const overlapHeight = (this._placedHeights[i] + collisionHeight) * 0.5;
                    if (Math.abs(this._placedX[i] - x) < overlapWidth && Math.abs(this._placedY[i] - y) < overlapHeight) {
                        y = Math.round(this._placedY[i] + overlapHeight);
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
            this._placedWidths.push(collisionWidth);
            this._placedHeights.push(collisionHeight);
            if (!entry.root.active) {
                entry.root.active = true;
            }
            if (entry.scale !== labelScale) {
                entry.scale = labelScale;
                entry.root.setScale(labelScale, labelScale, 1);
            }
            if (entry.x !== x || entry.y !== y) {
                entry.x = x;
                entry.y = y;
                entry.root.setPosition(x, y, 0);
            }
        }
    }
}

// Shared by AI name tags and the player's overhead marker so both retain the
// same visual hierarchy as broadcast cameras pull in and out.
export function swimmerHudScaleForDistance(cameraDistance: number): number {
    const rawScale = Math.max(
        NAME_MIN_SCALE,
        Math.min(NAME_MAX_SCALE, Math.sqrt(NAME_REFERENCE_DISTANCE / Math.max(0.01, cameraDistance))),
    );
    return Math.round(rawScale / NAME_SCALE_STEP) * NAME_SCALE_STEP;
}

/** 泳道和终点共用昵称字重、轮廓、截断与紧凑宽度。 */
export function makeSwimmerNameLabel(name: string, parent: Node, value: string): { root: Node; width: number } {
    const displayName = fitName(value);
    const width = Math.min(NAME_MAX_WIDTH, Math.max(NAME_FONT_SIZE, estimateTextWidth(displayName, NAME_FONT_SIZE) + NAME_HORIZONTAL_PADDING));
    const root = makeUiNode(name, parent);
    const label = root.addComponent(Label);
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    label.string = displayName;
    label.fontSize = NAME_FONT_SIZE;
    label.color = AI_COLOR;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.enableOutline = true;
    label.outlineColor = OUTLINE_COLOR;
    label.outlineWidth = 1.5;
    styleDynamicUiLabel(label, TAG_HEIGHT);
    root.getComponent(UITransform)!.setContentSize(width, TAG_HEIGHT);
    return { root, width };
}

function fitName(value: string): string {
    const name = value || 'AI';
    if (name.length <= 8) return name;
    let end = 8;
    const last = name.charCodeAt(end - 1);
    if (last >= 0xD800 && last <= 0xDBFF) end--;
    return `${name.slice(0, end)}…`;
}

function layoutNameAndPlacement(entry: NameEntry, showPlacement: boolean) {
    const totalWidth = showPlacement
        ? LIVE_PLACEMENT_BADGE_WIDTH + RANK_NAME_GAP + entry.nameWidth
        : entry.nameWidth;
    entry.visualWidth = totalWidth;
    const nameX = showPlacement
        ? totalWidth / 2 - entry.nameWidth / 2
        : 0;
    if (entry.nameRoot.position.x !== nameX) {
        entry.nameRoot.setPosition(nameX, 0, 0);
    }
    if (showPlacement) {
        const rankX = -totalWidth / 2 + LIVE_PLACEMENT_BADGE_WIDTH / 2;
        if (entry.rankRoot.position.x !== rankX) {
            entry.rankRoot.setPosition(rankX, 0, 0);
        }
    }
}

export function makeLivePlacementBadge(name: string, parent: Node, self = false): { root: Node; label: Label } {
    const root = makeUiNode(name, parent);
    root.getComponent(UITransform)!.setContentSize(LIVE_PLACEMENT_BADGE_WIDTH, LIVE_PLACEMENT_BADGE_HEIGHT);
    const background = root.addComponent(Graphics);
    // 简单静态正圆只构建一次；不在比赛帧内重画。
    background.fillColor = self ? SELF_BG : RANK_BG;
    background.circle(0, 0, LIVE_PLACEMENT_BADGE_WIDTH / 2);
    background.fill();
    const labelNode = makeUiNode('Label', root);
    labelNode.getComponent(UITransform)!.setContentSize(LIVE_PLACEMENT_BADGE_WIDTH, LIVE_PLACEMENT_BADGE_HEIGHT);
    const label = labelNode.addComponent(Label);
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    label.fontSize = 16;
    label.lineHeight = LIVE_PLACEMENT_BADGE_HEIGHT;
    label.color = self ? SELF_TEXT : RANK_TEXT;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    styleProjectUiLabel(label, 'semibold', LIVE_PLACEMENT_BADGE_HEIGHT);
    labelNode.getComponent(UITransform)!.setContentSize(LIVE_PLACEMENT_BADGE_WIDTH, LIVE_PLACEMENT_BADGE_HEIGHT);
    return { root, label };
}

function estimateTextWidth(text: string, fontSize: number): number {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
        width += text.charCodeAt(i) > 255 ? fontSize : fontSize * 0.58;
    }
    return width;
}
