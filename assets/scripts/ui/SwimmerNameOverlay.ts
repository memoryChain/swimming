import { Camera, Color, Graphics, Label, Node, Sprite, SpriteFrame, UIOpacity, UITransform, Vec3, view } from 'cc';
import type { RaceFinishResult } from '../core/RaceManager';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import type { Swimmer } from '../entity/Swimmer';
import { loadAvatarUiSpriteFrame } from './AvatarUiAssets';
import { styleProjectUiLabel, styleDynamicUiLabel } from './ProjectUiFonts';
import { makeUiNode } from './RuntimeUiFactory';

const TAG_WIDTH = 174;
const TAG_HEIGHT = 24;
export const LIVE_PLACEMENT_BADGE_WIDTH = 22;
export const LIVE_PLACEMENT_BADGE_HEIGHT = 22;
const RANK_NAME_GAP = 4;
const NAME_FONT_SIZE = 15;
const NAME_HORIZONTAL_PADDING = 2;
const NAME_MAX_WIDTH = TAG_WIDTH - LIVE_PLACEMENT_BADGE_WIDTH - RANK_NAME_GAP;
const HEAD_OFFSET_Y = 30;
const DIZZY_SIZE = 92;
const DIZZY_OFFSET_Y = 24;
const DIZZY_STAR_COUNT = 3;
const DIZZY_STAR_SIZE = 36;
const DIZZY_ORBIT_RADIUS_X = 38;
const DIZZY_ORBIT_RADIUS_Y = 14;
const DIZZY_ORBIT_RADIANS_PER_SECOND = Math.PI * 2 / 4.6;
const DIZZY_TRAIL_SEGMENT_COUNT = 2;
const DIZZY_TRAIL_PHASE_STEP = 0.50;
const DIZZY_TRAIL_BASE_WIDTH = 28;
const DIZZY_TRAIL_HEIGHT = 8;
const DIZZY_TRAIL_SCALE_STEP = 0.02;
const DIZZY_TRAIL_ALPHA_FACTORS = [0.70, 0.42] as const;
const DIZZY_MIN_SCALE = 0.72;
const DIZZY_MAX_SCALE = 1.12;
const DIZZY_SCALE_STEP = 0.02;
const DIZZY_MIN_OPACITY = 155;
const DIZZY_MAX_OPACITY = 255;
const DIZZY_SAMPLE_SECONDS = 1 / 20;
const FULL_CIRCLE_RADIANS = Math.PI * 2;
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
const DIZZY_TRAIL_COLOR = new Color(255, 220, 84, 255);

type DizzyTrailVisual = {
    root: Node;
    sprite: Sprite;
    opacity: UIOpacity;
    x: number;
    y: number;
    angle: number;
    scaleX: number;
    alpha: number;
};

type DizzyStarVisual = {
    root: Node;
    sprite: Sprite;
    opacity: UIOpacity;
    x: number;
    y: number;
    scale: number;
    alpha: number;
    trails: DizzyTrailVisual[];
};

type NameEntry = {
    swimmer: Swimmer;
    root: Node;
    rankRoot: Node;
    rankLabel: Label;
    nameRoot: Node;
    nameWidth: number;
    visualWidth: number;
    placement: number;
    x: number;
    y: number;
    scale: number;
    dizzyRoot: Node;
    dizzyStars: DizzyStarVisual[];
    dizzyPhase: number;
    dizzyX: number;
    dizzyY: number;
    dizzyKnocked: boolean;
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
    private _dizzyFrame: SpriteFrame | null = null;
    private _dizzyTrailFrame: SpriteFrame | null = null;
    private _dizzyElapsed = DIZZY_SAMPLE_SECONDS;

    bind(hud: Node) {
        if (!hud?.isValid) {
            return;
        }
        this._hud = hud;
        if (!this._root?.isValid) {
            this._root = makeUiNode('SwimmerNameTags', hud);
            this._root.active = false;
            loadAvatarUiSpriteFrame(RESOURCE_PATHS.entertainmentKnockoutUi.dizzyStars, (frame) => {
                if (!frame) return;
                this._dizzyFrame = frame;
                for (const entry of this._entries) {
                    for (const star of entry.dizzyStars) {
                        if (star.sprite?.isValid && star.sprite.spriteFrame !== frame) {
                            star.sprite.spriteFrame = frame;
                        }
                    }
                }
            });
            loadAvatarUiSpriteFrame(RESOURCE_PATHS.softSpeedStreak, (frame) => {
                if (!frame) return;
                this._dizzyTrailFrame = frame;
                for (const entry of this._entries) {
                    for (const star of entry.dizzyStars) {
                        for (const trail of star.trails) {
                            if (trail.sprite?.isValid && trail.sprite.spriteFrame !== frame) {
                                trail.sprite.spriteFrame = frame;
                            }
                        }
                    }
                }
            });
        }
    }

    setSwimmers(swimmers: readonly Swimmer[], player: Swimmer | null) {
        if (!this._root?.isValid) {
            return;
        }
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
            // Keep the dizzy orbit on the HUD root instead of parenting it to the
            // collision-avoiding name tag. Its anchor is projected separately from
            // the rendered head bone, so label stacking cannot push it aside.
            const dizzyRoot = makeUiNode('EntertainmentDizzyStars', this._root);
            dizzyRoot.getComponent(UITransform)!.setContentSize(DIZZY_SIZE, DIZZY_SIZE);
            const dizzyStars: DizzyStarVisual[] = [];
            const dizzyTrails: DizzyTrailVisual[][] = [];
            // Build every trail before the stars so the two shared textures stay
            // grouped into two stable UI batches and every trail remains behind.
            for (let i = 0; i < DIZZY_STAR_COUNT; i++) {
                const trails: DizzyTrailVisual[] = [];
                for (let segment = 0; segment < DIZZY_TRAIL_SEGMENT_COUNT; segment++) {
                    const trailRoot = makeUiNode(`DizzyTrail_${i + 1}_${segment + 1}`, dizzyRoot);
                    trailRoot.getComponent(UITransform)!.setContentSize(DIZZY_TRAIL_BASE_WIDTH, DIZZY_TRAIL_HEIGHT);
                    const sprite = trailRoot.addComponent(Sprite);
                    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                    sprite.trim = false;
                    sprite.color = DIZZY_TRAIL_COLOR;
                    sprite.spriteFrame = this._dizzyTrailFrame;
                    const opacity = trailRoot.addComponent(UIOpacity);
                    trails.push({
                        root: trailRoot,
                        sprite,
                        opacity,
                        x: Number.NaN,
                        y: Number.NaN,
                        angle: Number.NaN,
                        scaleX: -1,
                        alpha: -1,
                    });
                }
                dizzyTrails.push(trails);
            }
            for (let i = 0; i < DIZZY_STAR_COUNT; i++) {
                const starRoot = makeUiNode(`DizzyStar_${i + 1}`, dizzyRoot);
                starRoot.getComponent(UITransform)!.setContentSize(DIZZY_STAR_SIZE, DIZZY_STAR_SIZE);
                const sprite = starRoot.addComponent(Sprite);
                sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                sprite.trim = false;
                sprite.spriteFrame = this._dizzyFrame;
                const opacity = starRoot.addComponent(UIOpacity);
                dizzyStars.push({
                    root: starRoot,
                    sprite,
                    opacity,
                    x: Number.NaN,
                    y: Number.NaN,
                    scale: -1,
                    alpha: -1,
                    trails: dizzyTrails[i],
                });
            }
            dizzyRoot.active = false;
            const entry: NameEntry = {
                swimmer,
                root: tag,
                rankRoot,
                rankLabel,
                nameRoot: nameNode,
                nameWidth,
                visualWidth: nameWidth,
                placement: -1,
                x: Number.NaN,
                y: Number.NaN,
                scale: -1,
                dizzyRoot,
                dizzyStars,
                dizzyPhase: 0,
                dizzyX: Number.NaN,
                dizzyY: Number.NaN,
                dizzyKnocked: false,
            };
            this._entries.push(entry);
            this._entriesBySwimmer.set(swimmer, entry);
        }
        this.resetTracking();
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
            entry.rankLabel.string = `${result.placement}`;
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
            entry.dizzyX = Number.NaN;
            entry.dizzyY = Number.NaN;
            entry.dizzyKnocked = false;
            entry.dizzyPhase = 0;
            if (entry.root?.isValid && entry.root.active) {
                entry.root.active = false;
            }
            if (entry.dizzyRoot?.isValid && entry.dizzyRoot.active) {
                entry.dizzyRoot.active = false;
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
        dt = 0,
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
        this._dizzyElapsed += Math.max(0, dt);
        const advanceDizzy = this._dizzyElapsed >= DIZZY_SAMPLE_SECONDS;
        const dizzyDt = advanceDizzy ? this._dizzyElapsed : 0;
        if (advanceDizzy) this._dizzyElapsed = 0;

        for (const entry of this._entries) {
            const swimmerNode = entry.swimmer?.node;
            if (!entry.root?.isValid || !swimmerNode?.isValid || !swimmerNode.activeInHierarchy
                || (!showFinished && entry.swimmer.distance >= finishDistance)) {
                if (entry.root?.isValid && entry.root.active) {
                    entry.root.active = false;
                }
                if (entry.dizzyRoot?.isValid && entry.dizzyRoot.active) {
                    entry.dizzyRoot.active = false;
                }
                continue;
            }
            entry.swimmer.getNameTagWorldPosition(this._worldPos);
            Vec3.subtract(this._cameraToHead, this._worldPos, worldCamera.node.worldPosition);
            if (Vec3.dot(this._cameraToHead, this._cameraForward) <= 0) {
                if (entry.root.active) {
                    entry.root.active = false;
                }
                if (entry.dizzyRoot.active) {
                    entry.dizzyRoot.active = false;
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
                if (entry.dizzyRoot.active) {
                    entry.dizzyRoot.active = false;
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
            const wantsDizzy = entry.swimmer.isEntertainmentKnocked && !!entry.dizzyStars[0]?.sprite.spriteFrame;
            const enteredDizzy = wantsDizzy && !entry.dizzyKnocked;
            entry.dizzyKnocked = wantsDizzy;
            let showDizzy = wantsDizzy && entry.dizzyRoot.active;
            if (wantsDizzy && (advanceDizzy || enteredDizzy)) {
                // Reuse the rendered head's projected HUD position calculated above.
                // Re-projecting it here added duplicate camera work for every knocked swimmer.
                const dizzyX = Math.round(this._uiLocal.x);
                const dizzyY = Math.round(this._uiLocal.y + DIZZY_OFFSET_Y * labelScale);
                showDizzy = Math.abs(dizzyX) <= halfWidth && Math.abs(dizzyY) <= halfHeight;
                if (showDizzy && (entry.dizzyX !== dizzyX || entry.dizzyY !== dizzyY)) {
                    entry.dizzyX = dizzyX;
                    entry.dizzyY = dizzyY;
                    entry.dizzyRoot.setPosition(dizzyX, dizzyY, 1);
                }
            }
            if (entry.dizzyRoot.active !== showDizzy) {
                entry.dizzyRoot.active = showDizzy;
                if (showDizzy) {
                    this.updateDizzyOrbit(entry, 0, true);
                }
            }
            if (showDizzy && advanceDizzy) {
                this.updateDizzyOrbit(entry, dizzyDt, false);
            }
            if (entry.scale !== labelScale) {
                entry.scale = labelScale;
                entry.root.setScale(labelScale, labelScale, 1);
                entry.dizzyRoot.setScale(labelScale, labelScale, 1);
            }
            if (entry.x !== x || entry.y !== y) {
                entry.x = x;
                entry.y = y;
                entry.root.setPosition(x, y, 0);
            }
        }
    }

    private updateDizzyOrbit(entry: NameEntry, dt: number, reset: boolean) {
        entry.dizzyPhase = reset
            ? 0
            : (entry.dizzyPhase + Math.max(0, dt) * DIZZY_ORBIT_RADIANS_PER_SECOND) % FULL_CIRCLE_RADIANS;
        for (let i = 0; i < entry.dizzyStars.length; i++) {
            const star = entry.dizzyStars[i];
            const phase = entry.dizzyPhase + i * FULL_CIRCLE_RADIANS / DIZZY_STAR_COUNT;
            const sin = Math.sin(phase);
            const x = Math.round(Math.cos(phase) * DIZZY_ORBIT_RADIUS_X);
            const y = Math.round(sin * DIZZY_ORBIT_RADIUS_Y);
            // The lower half of the tilted orbit passes in front of the swimmer:
            // make it larger and brighter while every star stays screen-upright.
            const depth = (1 - sin) * 0.5;
            const rawScale = DIZZY_MIN_SCALE + (DIZZY_MAX_SCALE - DIZZY_MIN_SCALE) * depth;
            const scale = Math.round(rawScale / DIZZY_SCALE_STEP) * DIZZY_SCALE_STEP;
            const alpha = Math.round(DIZZY_MIN_OPACITY + (DIZZY_MAX_OPACITY - DIZZY_MIN_OPACITY) * depth);
            for (let segment = 0; segment < star.trails.length; segment++) {
                const trail = star.trails[segment];
                const leadPhase = phase - segment * DIZZY_TRAIL_PHASE_STEP;
                const tailPhase = phase - (segment + 1) * DIZZY_TRAIL_PHASE_STEP;
                const leadX = Math.cos(leadPhase) * DIZZY_ORBIT_RADIUS_X;
                const leadY = Math.sin(leadPhase) * DIZZY_ORBIT_RADIUS_Y;
                const tailX = Math.cos(tailPhase) * DIZZY_ORBIT_RADIUS_X;
                const tailY = Math.sin(tailPhase) * DIZZY_ORBIT_RADIUS_Y;
                const trailX = Math.round((leadX + tailX) * 0.5);
                const trailY = Math.round((leadY + tailY) * 0.5);
                const deltaX = leadX - tailX;
                const deltaY = leadY - tailY;
                const angle = Math.round(Math.atan2(deltaY, deltaX) * 180 / Math.PI);
                const rawScaleX = Math.max(0.25, Math.sqrt(deltaX * deltaX + deltaY * deltaY) / DIZZY_TRAIL_BASE_WIDTH);
                const scaleX = Math.round(rawScaleX / DIZZY_TRAIL_SCALE_STEP) * DIZZY_TRAIL_SCALE_STEP;
                const trailDepth = (1 - Math.sin((leadPhase + tailPhase) * 0.5)) * 0.5;
                const depthAlpha = DIZZY_MIN_OPACITY + (DIZZY_MAX_OPACITY - DIZZY_MIN_OPACITY) * trailDepth;
                const trailAlpha = Math.round(depthAlpha * DIZZY_TRAIL_ALPHA_FACTORS[segment]);
                if (trail.x !== trailX || trail.y !== trailY) {
                    trail.x = trailX;
                    trail.y = trailY;
                    trail.root.setPosition(trailX, trailY, 0);
                }
                if (trail.angle !== angle) {
                    trail.angle = angle;
                    trail.root.setRotationFromEuler(0, 0, angle);
                }
                if (trail.scaleX !== scaleX) {
                    trail.scaleX = scaleX;
                    trail.root.setScale(scaleX, 1, 1);
                }
                if (trail.alpha !== trailAlpha) {
                    trail.alpha = trailAlpha;
                    trail.opacity.opacity = trailAlpha;
                }
            }
            if (star.x !== x || star.y !== y) {
                star.x = x;
                star.y = y;
                star.root.setPosition(x, y, 0);
            }
            if (star.scale !== scale) {
                star.scale = scale;
                star.root.setScale(scale, scale, 1);
            }
            if (star.alpha !== alpha) {
                star.alpha = alpha;
                star.opacity.opacity = alpha;
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
    return name.length > 8 ? `${name.slice(0, 8)}…` : name;
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
