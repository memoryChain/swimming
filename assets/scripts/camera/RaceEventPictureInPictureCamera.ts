import { Camera, Color, Label, LabelOutline, Layers, Node, RenderTexture, Sprite, SpriteFrame, sys, UITransform, Vec3, view } from 'cc';
import type { CannonImpact, CannonLaunch } from '../core/CannonBrawlController';
import type { SharkController } from '../entity/SharkController';
import { SHARK_TUNING, SharkState } from '../entity/SharkTuning';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { SWIMMER_LAYER, UNDERWATER_LAYER } from '../venue/WaterSurfaceBinder';
import { setCameraVenueCeilingVisible, VENUE_CEILING_LAYER } from '../venue/TopViewCeilingController';
import { styleProjectUiLabel } from '../ui/ProjectUiFonts';
import { makeLabel, makeRoundedRect, makeUiNode, UI_DESIGN_HEIGHT, UI_DESIGN_WIDTH, uiColor } from '../ui/RuntimeUiFactory';
import { platform } from '../platform/PlatformManager';

const FEED_WIDTH = 256;
const FEED_HEIGHT = 144;
const PANEL_WIDTH = FEED_WIDTH + 12;
const PANEL_HEIGHT = 200;
const PANEL_MARGIN = 18;
const RANKING_RAIL_WIDTH = 117;
const RANKING_RAIL_GAP = 16;
const COURSE_PROGRESS_RIGHT = 226;
const COURSE_PROGRESS_GAP = 12;
const RENDER_INTERVAL_SECONDS = 1 / 30;
const CANNON_IMPACT_HOLD_SECONDS = 1;
const WHIRLPOOL_PREVIEW_SECONDS = 1.5;
const TIMED_BOMB_ARM_PREVIEW_SECONDS = 1.2;
const TIMED_BOMB_TRANSFER_PREVIEW_SECONDS = 0.8;
const TIMED_BOMB_REOPEN_COOLDOWN_SECONDS = 1;
const TIMED_BOMB_RESOLUTION_HOLD_SECONDS = 1;

const WARNING_COLOR = new Color(255, 190, 86, 255);
const DANGER_COLOR = new Color(255, 82, 72, 255);
const INFO_COLOR = new Color(107, 222, 255, 255);
const FEED_CLEAR_COLOR = new Color(13, 48, 86, 255);

type FeedMode = 'none' | 'shark' | 'cannon' | 'whirlpool' | 'timed-bomb';
type TimedBombResolution = 'none' | 'exploded' | 'disarmed';

export type RaceEventPictureInPictureOptions = {
    worldRoot: Node;
    hud: Node;
    course: RaceCourseLayout;
    onHudBoundsChanged?: (leftEdge: number | null) => void;
};

/**
 * 娱乐玩法共用的本地事件镜头。所有玩法复用同一个低分辨率 RT 和相机，
 * 只观察已有权威状态，不参与目标选择、命中、淘汰或同步。
 */
export class RaceEventPictureInPictureCamera {
    private camera: Camera | null = null;
    private cameraNode: Node | null = null;
    private renderTexture: RenderTexture | null = null;
    private spriteFrame: SpriteFrame | null = null;
    private root: Node | null = null;
    private titleLabel: Label | null = null;
    private statusLabel: Label | null = null;
    private mode: FeedMode = 'none';
    private active = false;
    private renderElapsed = RENDER_INTERVAL_SECONDS;
    private holdSeconds = 0;
    private warningPush = 0;
    private biteHoldSeconds = 0;
    private lastSharkState = SharkState.INACTIVE;
    private lastFov = 46;
    private cannonTargetX = 0;
    private cannonTargetZ = 0;
    private cannonSourceX = 0;
    private cannonSourceY = 0;
    private cannonSourceZ = 0;
    private whirlpoolX = 0;
    private whirlpoolZ = 0;
    private whirlpoolSuper = false;
    private timedBombCarrier: Node | null = null;
    private timedBombLane = -1;
    private timedBombLocal = false;
    private timedBombLocked = false;
    private timedBombRemainingSeconds = 0;
    private timedBombPreviewSeconds = 0;
    private timedBombReopenCooldownSeconds = 0;
    private timedBombResolution: TimedBombResolution = 'none';
    private timedBombResolutionHoldSeconds = 0;
    private timedBombPoseReady = false;
    private lastTimedBombCopyLane = -2;
    private lastTimedBombCopySeconds = -1;
    private lastTimedBombCopyLocal = false;
    private lastTimedBombCopyLocked = false;
    private lastTimedBombCopyResolution: TimedBombResolution = 'none';
    private ceilingVisible = true;
    private hudLeftEdge = 0;
    private notifiedHudLeftEdge: number | null = null;
    private readonly cameraPosition = new Vec3();
    private readonly focus = new Vec3();
    private readonly subjectPosition = new Vec3();
    private readonly targetPosition = new Vec3();
    private readonly biteHoldCameraPosition = new Vec3();
    private readonly biteHoldFocus = new Vec3();
    private readonly timedBombDesiredCameraPosition = new Vec3();
    private readonly timedBombDesiredFocus = new Vec3();

    constructor(private readonly options: RaceEventPictureInPictureOptions) {
        this.buildCamera();
        this.buildHud();
    }

    reset(): void {
        this.resetTimedBombTrackingState();
        this.hide();
    }

    updateShark(shark: SharkController | null, dt: number): void {
        const safeDt = safeStep(dt);
        const dangerous = shark?.state === SharkState.WARNING
            || shark?.state === SharkState.HUNT
            || shark?.state === SharkState.BITE;
        const active = dangerous && !!shark?.node?.activeInHierarchy;
        let holdBiteView = false;
        if (active && shark) {
            if (this.mode !== 'shark') {
                this.mode = 'shark';
                this.warningPush = 0;
                this.biteHoldSeconds = 0;
            }
            this.setVisible(true);
            this.setCeilingVisible(shark.state !== SharkState.WARNING);
            this.presentSharkState(shark.state);
            this.updateWarningPush(shark, safeDt);
            if (shark.state === SharkState.BITE) {
                this.biteHoldSeconds = Math.max(0, SHARK_TUNING.biteCameraHoldSeconds);
            }
        } else if (this.mode === 'shark' && this.biteHoldSeconds > 0) {
            this.biteHoldSeconds = Math.max(0, this.biteHoldSeconds - safeDt);
            if (this.biteHoldSeconds <= 0) {
                this.hide();
                return;
            }
            holdBiteView = true;
        } else {
            if (this.mode === 'shark') this.hide();
            return;
        }

        if (!this.shouldRender(safeDt)) return;
        if (holdBiteView) {
            this.cameraPosition.set(this.biteHoldCameraPosition);
            this.focus.set(this.biteHoldFocus);
            this.applyCameraPose(34);
        } else if (shark) {
            this.updateSharkCameraPose(shark);
            if (shark.state === SharkState.BITE) {
                this.biteHoldCameraPosition.set(this.cameraPosition);
                this.biteHoldFocus.set(this.focus);
            }
        }
        this.finishRender();
    }

    showCannonLaunch(launch: CannonLaunch, sourceWorldX = Number.NaN): void {
        const target = this.options.course.swimPosition(launch.targetDistance, launch.targetZ);
        const side = (launch.strikeId & 1) === 0 ? -1 : 1;
        this.cannonTargetX = target.x;
        this.cannonTargetZ = target.z;
        this.cannonSourceX = Number.isFinite(sourceWorldX) ? sourceWorldX : target.x;
        this.cannonSourceY = this.options.course.waterY + 1.2;
        this.cannonSourceZ = side * (this.options.course.poolWidth * 0.5 + 0.5);
        // 鲨鱼危险镜头优先级最高；炮火仍缓存落点，待鲨鱼镜头退出后再接管。
        if (this.mode === 'shark') return;
        this.mode = 'cannon';
        this.setCeilingVisible(true);
        this.holdSeconds = 0;
        this.setCopy('炮火镜头', '炮弹已锁定落点', DANGER_COLOR);
        this.setVisible(true);
    }

    showCannonImpact(impact: CannonImpact): void {
        if (this.mode !== 'cannon') return;
        this.holdSeconds = CANNON_IMPACT_HOLD_SECONDS;
        const status = impact.knockedLane >= 0
            ? `${impact.knockedLane + 1}号泳道被核心命中`
            : impact.hitMask !== 0 ? '冲击波掀翻附近选手' : '炮弹落空';
        this.setCopy('炮火镜头', status, impact.knockedLane >= 0 ? DANGER_COLOR : WARNING_COLOR);
    }

    updateCannon(
        launch: CannonLaunch | null,
        remainingSeconds: number,
        racing: boolean,
        dt: number,
        sourceWorldX = Number.NaN,
    ): void {
        if (!racing) {
            if (this.mode === 'cannon') this.hide();
            return;
        }
        const safeDt = safeStep(dt);
        if (launch) {
            if (this.mode !== 'cannon') this.showCannonLaunch(launch, sourceWorldX);
            if (this.mode !== 'cannon') return;
            const total = Math.max(0.01, launch.warningSeconds);
            const progress = clamp01(1 - remainingSeconds / total);
            if (!this.shouldRender(safeDt)) return;
            this.updateCannonCameraPose(progress, launch.targetDistance);
            this.finishRender();
            return;
        }
        if (this.mode !== 'cannon') return;
        this.holdSeconds = Math.max(0, this.holdSeconds - safeDt);
        if (this.holdSeconds <= 0) {
            this.hide();
            return;
        }
        if (!this.shouldRender(safeDt)) return;
        this.applyCameraPose(49);
        this.finishRender();
    }

    showWhirlpoolPreview(distance: number, lateral: number, spin: -1 | 1, superVariant = false): void {
        // 漩涡是路线教学镜头，不能抢占鲨鱼咬击或炮火落点等即时危险镜头。
        if (this.mode === 'shark' || this.mode === 'cannon' || this.mode === 'timed-bomb') return;
        this.mode = 'whirlpool';
        this.setCeilingVisible(false);
        this.whirlpoolX = this.options.course.distanceToWorldX(distance);
        this.whirlpoolZ = lateral;
        this.whirlpoolSuper = superVariant;
        this.holdSeconds = WHIRLPOOL_PREVIEW_SECONDS;
        this.setCopy(
            superVariant ? '超级漩涡俯视' : '漩涡俯视',
            spin > 0 ? '顺时针水流 · 贴外圈借力' : '逆时针水流 · 贴外圈借力',
            INFO_COLOR,
        );
        this.setVisible(true);
    }

    updateWhirlpool(racing: boolean, dt: number): void {
        if (!racing) {
            if (this.mode === 'whirlpool') this.hide();
            return;
        }
        if (this.mode !== 'whirlpool') return;
        const safeDt = safeStep(dt);
        this.holdSeconds = Math.max(0, this.holdSeconds - safeDt);
        if (this.holdSeconds <= 0) {
            this.hide();
            return;
        }
        if (!this.shouldRender(safeDt)) return;
        this.focus.set(this.whirlpoolX, this.options.course.waterY, this.whirlpoolZ);
        this.cameraPosition.set(
            this.whirlpoolX - this.options.course.direction * 1.1,
            this.options.course.waterY + (this.whirlpoolSuper ? 18.5 : 13.5),
            this.whirlpoolZ + 0.8,
        );
        this.applyCameraPose(this.whirlpoolSuper ? 45 : 42);
        this.finishRender();
    }

    showTimedBombCarrier(
        carrier: Node | null,
        lane: number,
        remainingSeconds: number,
        local: boolean,
        transferred = false,
    ): void {
        this.timedBombCarrier = carrier?.isValid ? carrier : null;
        this.timedBombLane = lane;
        this.timedBombLocal = local;
        this.timedBombLocked = false;
        this.timedBombRemainingSeconds = Math.max(0, remainingSeconds);
        this.timedBombResolution = 'none';
        this.timedBombResolutionHoldSeconds = 0;
        if (!this.timedBombCarrier || this.isTimedBombBlockedByHigherPriority()) return;
        if (transferred && this.mode !== 'timed-bomb' && this.timedBombReopenCooldownSeconds > 0) return;
        const alreadyTracking = this.mode === 'timed-bomb';
        this.mode = 'timed-bomb';
        this.setCeilingVisible(true);
        this.timedBombPreviewSeconds = Math.max(
            this.timedBombPreviewSeconds,
            transferred ? TIMED_BOMB_TRANSFER_PREVIEW_SECONDS : TIMED_BOMB_ARM_PREVIEW_SECONDS,
        );
        if (!alreadyTracking) {
            this.timedBombPoseReady = false;
            this.invalidateTimedBombCopy();
        }
        this.presentTimedBombState();
        this.setVisible(true);
    }

    updateTimedBomb(
        carrier: Node | null,
        lane: number,
        remainingSeconds: number,
        locked: boolean,
        racing: boolean,
        local: boolean,
        dt: number,
    ): void {
        const safeDt = safeStep(dt);
        this.timedBombReopenCooldownSeconds = Math.max(0, this.timedBombReopenCooldownSeconds - safeDt);
        if (carrier?.isValid) this.timedBombCarrier = carrier;
        if (lane >= 0) {
            this.timedBombLane = lane;
            this.timedBombLocal = local;
            this.timedBombLocked = locked;
            this.timedBombRemainingSeconds = Math.max(0, remainingSeconds);
        }

        if (this.timedBombResolution !== 'none') {
            this.timedBombResolutionHoldSeconds = Math.max(0, this.timedBombResolutionHoldSeconds - safeDt);
            if (this.timedBombResolutionHoldSeconds <= 0) {
                if (this.mode === 'timed-bomb') this.hide();
                this.resetTimedBombTrackingState();
                return;
            }
            if (!this.isTimedBombBlockedByHigherPriority() && this.mode !== 'timed-bomb') {
                this.mode = 'timed-bomb';
                this.setCeilingVisible(true);
                this.timedBombPoseReady = false;
                this.invalidateTimedBombCopy();
                this.setVisible(true);
            }
        } else if (!racing || !this.timedBombCarrier?.isValid) {
            if (this.mode === 'timed-bomb') this.hide();
            return;
        } else if (locked && !this.isTimedBombBlockedByHigherPriority() && this.mode !== 'timed-bomb') {
            this.mode = 'timed-bomb';
            this.setCeilingVisible(true);
            this.timedBombPoseReady = false;
            this.invalidateTimedBombCopy();
            this.setVisible(true);
        } else if (!locked && this.mode === 'timed-bomb') {
            this.timedBombPreviewSeconds = Math.max(0, this.timedBombPreviewSeconds - safeDt);
            if (this.timedBombPreviewSeconds <= 0) {
                this.timedBombReopenCooldownSeconds = TIMED_BOMB_REOPEN_COOLDOWN_SECONDS;
                this.hide();
                return;
            }
        }

        if (this.mode !== 'timed-bomb' || this.isTimedBombBlockedByHigherPriority()) return;
        this.presentTimedBombState();
        if (!this.shouldRender(safeDt)) return;
        this.updateTimedBombCameraPose(safeDt);
        this.finishRender();
    }

    showTimedBombResolution(carrier: Node | null, lane: number, exploded: boolean, local: boolean): void {
        this.timedBombCarrier = carrier?.isValid ? carrier : this.timedBombCarrier;
        this.timedBombLane = lane;
        this.timedBombLocal = local;
        this.timedBombLocked = true;
        this.timedBombRemainingSeconds = 0;
        this.timedBombResolution = exploded ? 'exploded' : 'disarmed';
        this.timedBombResolutionHoldSeconds = TIMED_BOMB_RESOLUTION_HOLD_SECONDS;
        if (!this.timedBombCarrier?.isValid || this.isTimedBombBlockedByHigherPriority()) return;
        const alreadyTracking = this.mode === 'timed-bomb';
        this.mode = 'timed-bomb';
        this.setCeilingVisible(true);
        if (!alreadyTracking) this.timedBombPoseReady = false;
        this.invalidateTimedBombCopy();
        this.presentTimedBombState();
        this.setVisible(true);
    }

    clearTimedBombTracking(): void {
        if (this.mode === 'timed-bomb') this.hide();
        this.resetTimedBombTrackingState();
    }

    dispose(): void {
        this.notifyHudBounds(false);
        view.off('canvas-resize', this.layoutHud, this);
        view.off('design-resolution-changed', this.layoutHud, this);
        if (this.camera?.isValid) {
            this.camera.targetTexture = null;
            this.camera.enabled = false;
        }
        if (this.cameraNode?.isValid) this.cameraNode.destroy();
        if (this.root?.isValid) this.root.destroy();
        this.spriteFrame?.destroy();
        this.renderTexture?.destroy();
        this.camera = null;
        this.cameraNode = null;
        this.renderTexture = null;
        this.spriteFrame = null;
        this.root = null;
        this.titleLabel = null;
        this.statusLabel = null;
    }

    private updateCannonCameraPose(progress: number, targetDistance: number): void {
        const projectileX = this.cannonSourceX + (this.cannonTargetX - this.cannonSourceX) * progress;
        const projectileZ = this.cannonSourceZ + (this.cannonTargetZ - this.cannonSourceZ) * progress;
        const projectileY = this.cannonSourceY
            + (this.options.course.waterY + 0.12 - this.cannonSourceY) * progress
            + Math.sin(progress * Math.PI) * 5.2;
        const focusWeight = 0.42 + progress * 0.28;
        const focusX = projectileX + (this.cannonTargetX - projectileX) * focusWeight;
        this.focus.set(
            focusX,
            this.options.course.waterY + 0.45 + projectileY * 0.08,
            projectileZ + (this.cannonTargetZ - projectileZ) * focusWeight,
        );
        const direction = this.options.course.directionAtDistance(targetDistance);
        this.cameraPosition.set(
            focusX - direction * 7.4,
            this.options.course.waterY + 5.4,
            (this.cannonSourceZ + this.cannonTargetZ) * 0.5,
        );
        this.applyCameraPose(52);
    }

    private updateTimedBombCameraPose(dt: number): void {
        const carrier = this.timedBombCarrier;
        if (!carrier?.isValid) return;
        carrier.getWorldPosition(this.subjectPosition);
        const outward = this.subjectPosition.z >= 0 ? 1 : -1;
        this.timedBombDesiredFocus.set(
            this.subjectPosition.x + this.options.course.direction * 0.45,
            this.options.course.waterY + 0.18,
            this.subjectPosition.z,
        );
        this.timedBombDesiredCameraPosition.set(
            this.subjectPosition.x - this.options.course.direction * 4.2,
            this.options.course.waterY + 2.8,
            this.subjectPosition.z + outward * 4.3,
        );
        if (!this.timedBombPoseReady) {
            this.cameraPosition.set(this.timedBombDesiredCameraPosition);
            this.focus.set(this.timedBombDesiredFocus);
            this.timedBombPoseReady = true;
        } else {
            const blend = Math.min(1, dt * 8);
            Vec3.lerp(this.cameraPosition, this.cameraPosition, this.timedBombDesiredCameraPosition, blend);
            Vec3.lerp(this.focus, this.focus, this.timedBombDesiredFocus, blend);
        }
        this.applyCameraPose(44);
    }

    private updateSharkCameraPose(shark: SharkController): void {
        shark.node.getWorldPosition(this.subjectPosition);
        const target = shark.target?.node ?? null;
        if (target?.isValid) target.getWorldPosition(this.targetPosition);
        const targetPosition = target?.isValid ? this.targetPosition : null;
        const waterY = this.options.course.waterY;
        if (!targetPosition || shark.state === SharkState.WARNING) {
            const targetX = targetPosition?.x ?? this.subjectPosition.x;
            const targetZ = targetPosition?.z ?? this.subjectPosition.z;
            const dx = targetX - this.subjectPosition.x;
            const dz = targetZ - this.subjectPosition.z;
            const length = Math.sqrt(dx * dx + dz * dz);
            const forwardX = length > 0.001 ? dx / length : 1;
            const forwardZ = length > 0.001 ? dz / length : 0;
            const sideX = -forwardZ;
            const sideZ = forwardX;
            const push = this.warningPush;
            const wideFocusX = (this.subjectPosition.x + targetX) * 0.5;
            const wideFocusZ = (this.subjectPosition.z + targetZ) * 0.5;
            const closeFocusX = this.subjectPosition.x + forwardX * 0.8;
            const closeFocusZ = this.subjectPosition.z + forwardZ * 0.8;
            this.focus.set(
                wideFocusX + (closeFocusX - wideFocusX) * push,
                waterY + 0.04,
                wideFocusZ + (closeFocusZ - wideFocusZ) * push,
            );
            this.cameraPosition.set(
                this.subjectPosition.x + sideX * 3.1 * push - forwardX * 1.15 * push,
                waterY + 17 - 14.2 * push,
                this.subjectPosition.z + 8.5 * (1 - push) + sideZ * 3.1 * push - forwardZ * 1.15 * push,
            );
            this.applyCameraPose(56 - 20 * push);
            return;
        }
        const dx = targetPosition.x - this.subjectPosition.x;
        const dz = targetPosition.z - this.subjectPosition.z;
        const length = Math.sqrt(dx * dx + dz * dz);
        const forwardX = length > 0.001 ? dx / length : 1;
        const forwardZ = length > 0.001 ? dz / length : 0;
        const sideX = -forwardZ;
        const sideZ = forwardX;
        if (shark.state === SharkState.BITE) {
            this.focus.set(
                this.subjectPosition.x + forwardX * 0.45,
                waterY - 0.16,
                this.subjectPosition.z + forwardZ * 0.45,
            );
            this.cameraPosition.set(
                this.subjectPosition.x - forwardX * 0.9 + sideX * 2.7,
                waterY + 1.05,
                this.subjectPosition.z - forwardZ * 0.9 + sideZ * 2.7,
            );
            this.applyCameraPose(34);
            return;
        }
        const targetLead = Math.min(1.35, length * 0.32);
        this.focus.set(
            this.subjectPosition.x + forwardX * targetLead,
            waterY - 0.08,
            this.subjectPosition.z + forwardZ * targetLead,
        );
        this.cameraPosition.set(
            this.subjectPosition.x - forwardX * 1.5 + sideX * 3.8,
            waterY + 1.35,
            this.subjectPosition.z - forwardZ * 1.5 + sideZ * 3.8,
        );
        this.applyCameraPose(40);
    }

    private updateWarningPush(shark: SharkController, dt: number): void {
        if (shark.state !== SharkState.WARNING) {
            this.warningPush = 1;
            return;
        }
        const duration = Math.max(0.001, SHARK_TUNING.warningSeconds);
        const desired = clamp01(1 - shark.remainingSeconds / duration);
        this.warningPush += (desired - this.warningPush) * Math.min(1, dt * 4.5);
    }

    private presentSharkState(state: SharkState): void {
        if (state === this.lastSharkState && this.mode === 'shark') return;
        this.lastSharkState = state;
        const biting = state === SharkState.BITE;
        const hunting = state === SharkState.HUNT || biting;
        this.setCopy(
            '鲨鱼镜头',
            biting ? '吞没目标中' : hunting ? '正在追击最近选手' : '已落水，锁定目标中',
            hunting ? DANGER_COLOR : WARNING_COLOR,
        );
    }

    private presentTimedBombState(): void {
        const wholeSeconds = Math.max(0, Math.ceil(this.timedBombRemainingSeconds));
        if (this.timedBombLane === this.lastTimedBombCopyLane
            && wholeSeconds === this.lastTimedBombCopySeconds
            && this.timedBombLocal === this.lastTimedBombCopyLocal
            && this.timedBombLocked === this.lastTimedBombCopyLocked
            && this.timedBombResolution === this.lastTimedBombCopyResolution) return;
        this.lastTimedBombCopyLane = this.timedBombLane;
        this.lastTimedBombCopySeconds = wholeSeconds;
        this.lastTimedBombCopyLocal = this.timedBombLocal;
        this.lastTimedBombCopyLocked = this.timedBombLocked;
        this.lastTimedBombCopyResolution = this.timedBombResolution;
        let status: string;
        let color: Readonly<Color> = WARNING_COLOR;
        if (this.timedBombResolution === 'exploded') {
            status = this.timedBombLocal ? '你被炸倒 · 急救中' : `${this.timedBombLane + 1}号泳道被炸倒`;
            color = DANGER_COLOR;
        } else if (this.timedBombResolution === 'disarmed') {
            status = this.timedBombLocal ? '你已冲线 · 拆弹成功' : `${this.timedBombLane + 1}号泳道拆弹成功`;
            color = INFO_COLOR;
        } else if (this.timedBombLocked) {
            status = this.timedBombLocal
                ? `炸弹已锁定在你身上 · ${wholeSeconds}秒`
                : `${this.timedBombLane + 1}号泳道已锁定 · ${wholeSeconds}秒`;
            color = DANGER_COLOR;
        } else {
            status = this.timedBombLocal
                ? `你持有定时炸弹 · ${wholeSeconds}秒`
                : `${this.timedBombLane + 1}号泳道持有 · ${wholeSeconds}秒`;
        }
        this.setCopy('炸弹追踪', status, color);
    }

    private isTimedBombBlockedByHigherPriority(): boolean {
        return this.mode === 'shark' || this.mode === 'cannon';
    }

    private invalidateTimedBombCopy(): void {
        this.lastTimedBombCopyLane = -2;
        this.lastTimedBombCopySeconds = -1;
        this.lastTimedBombCopyResolution = 'none';
    }

    private resetTimedBombTrackingState(): void {
        this.timedBombCarrier = null;
        this.timedBombLane = -1;
        this.timedBombLocal = false;
        this.timedBombLocked = false;
        this.timedBombRemainingSeconds = 0;
        this.timedBombPreviewSeconds = 0;
        this.timedBombReopenCooldownSeconds = 0;
        this.timedBombResolution = 'none';
        this.timedBombResolutionHoldSeconds = 0;
        this.timedBombPoseReady = false;
        this.invalidateTimedBombCopy();
    }

    private shouldRender(dt: number): boolean {
        this.renderElapsed += dt;
        if (this.renderElapsed < RENDER_INTERVAL_SECONDS) {
            if (this.camera?.isValid && this.camera.enabled) this.camera.enabled = false;
            return false;
        }
        this.renderElapsed %= RENDER_INTERVAL_SECONDS;
        return true;
    }

    private finishRender(): void {
        if (this.camera?.isValid && !this.camera.enabled) this.camera.enabled = true;
    }

    private applyCameraPose(fov: number): void {
        if (!this.cameraNode?.isValid) return;
        this.cameraNode.setWorldPosition(this.cameraPosition);
        this.cameraNode.lookAt(this.focus);
        if (Math.abs(fov - this.lastFov) < 0.05) return;
        this.lastFov = fov;
        if (this.camera?.isValid) this.camera.fov = fov;
    }

    private setCopy(title: string, status: string, color: Readonly<Color>): void {
        if (this.titleLabel && this.titleLabel.string !== title) this.titleLabel.string = title;
        if (this.statusLabel && this.statusLabel.string !== status) this.statusLabel.string = status;
        if (this.statusLabel && !sameColor(this.statusLabel.color, color)) this.statusLabel.color = color;
    }

    private setVisible(active: boolean): void {
        if (this.active === active) return;
        this.active = active;
        this.renderElapsed = RENDER_INTERVAL_SECONDS;
        if (this.root?.isValid && this.root.active !== active) this.root.active = active;
        if (!active && this.camera?.isValid && this.camera.enabled) this.camera.enabled = false;
        this.notifyHudBounds(active);
    }

    private hide(): void {
        this.setVisible(false);
        this.setCeilingVisible(true);
        this.mode = 'none';
        this.holdSeconds = 0;
        this.warningPush = 0;
        this.biteHoldSeconds = 0;
        this.lastSharkState = SharkState.INACTIVE;
    }

    private setCeilingVisible(visible: boolean): void {
        if (this.ceilingVisible === visible) return;
        this.ceilingVisible = visible;
        setCameraVenueCeilingVisible(this.camera, visible);
    }

    private buildCamera(): void {
        const node = new Node('RaceEventPictureInPictureCamera');
        node.setParent(this.options.worldRoot);
        node.layer = Layers.Enum.DEFAULT;
        const camera = node.addComponent(Camera);
        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        camera.visibility = Layers.Enum.DEFAULT | SWIMMER_LAYER | UNDERWATER_LAYER | VENUE_CEILING_LAYER;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = FEED_CLEAR_COLOR;
        camera.near = 0.1;
        camera.far = 100;
        camera.fov = 46;
        camera.priority = -4;
        camera.enabled = false;
        const texture = new RenderTexture('RaceEventPictureInPictureRT');
        texture.reset({ width: FEED_WIDTH, height: FEED_HEIGHT });
        camera.targetTexture = texture;
        this.cameraNode = node;
        this.camera = camera;
        this.renderTexture = texture;
    }

    private buildHud(): void {
        const root = makeRoundedRect(
            'RaceEventPictureInPicture',
            this.options.hud,
            PANEL_WIDTH,
            PANEL_HEIGHT,
            uiColor(5, 16, 30, 232),
            10,
            uiColor(91, 174, 221, 215),
            2,
        );
        const titleNode = makeLabel('Title', root, '', 19, uiColor(224, 243, 255));
        titleNode.getComponent(UITransform)!.setContentSize(FEED_WIDTH, 26);
        titleNode.setPosition(0, PANEL_HEIGHT * 0.5 - 16, 0);
        const title = titleNode.getComponent(Label)!;
        styleProjectUiLabel(title, 'semibold', 25);
        const statusNode = makeLabel('Status', root, '', 15, WARNING_COLOR);
        statusNode.getComponent(UITransform)!.setContentSize(FEED_WIDTH, 20);
        statusNode.setPosition(0, PANEL_HEIGHT * 0.5 - 41, 0);
        const status = statusNode.getComponent(Label)!;
        styleProjectUiLabel(status, 'semibold', 21);
        const outline = statusNode.addComponent(LabelOutline);
        outline.color = uiColor(0, 6, 14, 230);
        outline.width = 2;
        const image = makeUiNode('Feed', root);
        image.getComponent(UITransform)!.setContentSize(FEED_WIDTH, FEED_HEIGHT);
        image.setPosition(0, -27, 0);
        const sprite = image.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const spriteFrame = new SpriteFrame();
        spriteFrame.texture = this.renderTexture!;
        sprite.spriteFrame = spriteFrame;
        root.active = false;
        this.root = root;
        this.titleLabel = title;
        this.statusLabel = status;
        this.spriteFrame = spriteFrame;
        this.layoutHud();
        view.on('canvas-resize', this.layoutHud, this);
        view.on('design-resolution-changed', this.layoutHud, this);
    }

    private layoutHud(): void {
        const root = this.root;
        if (!root?.isValid) return;
        const size = view.getVisibleSize();
        const safe = sys.getSafeAreaRect(false);
        const leftInset = Math.max(0, safe.x);
        const rightInset = Math.max(0, size.width - safe.x - safe.width);
        const safeTop = Math.max(0, size.height - safe.y - safe.height);
        const hudScale = Math.min(
            1,
            Math.max(1, size.width - leftInset - rightInset) / UI_DESIGN_WIDTH,
            Math.max(1, safe.height) / UI_DESIGN_HEIGHT,
        );
        // 最右侧永久留给排名；微信胶囊更宽时使用胶囊左边界，但不重复叠加安全区。
        const nativeRightReserve = size.width * platform().getTopRightReservedRatio();
        const rightReserve = Math.max(rightInset + RANKING_RAIL_WIDTH * hudScale, nativeRightReserve);
        const availableWidth = size.width * 0.5 - rightReserve - COURSE_PROGRESS_RIGHT * hudScale;
        const panelScale = Math.min(
            hudScale,
            Math.max(0.01, availableWidth / (PANEL_WIDTH + RANKING_RAIL_GAP + COURSE_PROGRESS_GAP)),
        );
        const panelRight = size.width * 0.5 - rightReserve - RANKING_RAIL_GAP * panelScale;
        const panelTop = size.height * 0.5 - safeTop - PANEL_MARGIN * panelScale;
        const x = panelRight - PANEL_WIDTH * panelScale * 0.5;
        const y = panelTop - PANEL_HEIGHT * panelScale * 0.5;
        if (root.position.x !== x || root.position.y !== y) root.setPosition(x, y, 0);
        if (root.scale.x !== panelScale || root.scale.y !== panelScale) root.setScale(panelScale, panelScale, 1);
        this.hudLeftEdge = panelRight - PANEL_WIDTH * panelScale;
        if (this.active) this.notifyHudBounds(true);
    }

    private notifyHudBounds(active: boolean): void {
        const leftEdge = active ? this.hudLeftEdge : null;
        if (this.notifiedHudLeftEdge === leftEdge) return;
        this.notifiedHudLeftEdge = leftEdge;
        this.options.onHudBoundsChanged?.(leftEdge);
    }
}

function safeStep(dt: number): number {
    return Number.isFinite(dt) ? Math.max(0, dt) : 0;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function sameColor(a: Readonly<Color>, b: Readonly<Color>): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
