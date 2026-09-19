import { Camera, Color, Label, LabelOutline, Layers, Node, RenderTexture, Sprite, SpriteFrame, UITransform, Vec3, view } from 'cc';
import type { CannonImpact, CannonLaunch } from '../core/CannonBrawlController';
import type { SharkController } from '../entity/SharkController';
import { SHARK_TUNING, SharkState } from '../entity/SharkTuning';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { SWIMMER_LAYER, UNDERWATER_LAYER } from '../venue/WaterSurfaceBinder';
import { styleProjectUiLabel } from '../ui/ProjectUiFonts';
import { makeLabel, makeRoundedRect, makeUiNode, uiColor } from '../ui/RuntimeUiFactory';

const FEED_WIDTH = 224;
const FEED_HEIGHT = 126;
const PANEL_HEIGHT = 164;
const PANEL_MARGIN = 18;
const RENDER_INTERVAL_SECONDS = 1 / 30;
const CANNON_IMPACT_HOLD_SECONDS = 1;
const WHIRLPOOL_PREVIEW_SECONDS = 1.5;

const WARNING_COLOR = new Color(255, 190, 86, 255);
const DANGER_COLOR = new Color(255, 82, 72, 255);
const INFO_COLOR = new Color(107, 222, 255, 255);
const FEED_CLEAR_COLOR = new Color(13, 48, 86, 255);

type FeedMode = 'none' | 'shark' | 'cannon' | 'whirlpool';

export type RaceEventPictureInPictureOptions = {
    worldRoot: Node;
    hud: Node;
    course: RaceCourseLayout;
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
    private readonly cameraPosition = new Vec3();
    private readonly focus = new Vec3();
    private readonly subjectPosition = new Vec3();
    private readonly targetPosition = new Vec3();
    private readonly biteHoldCameraPosition = new Vec3();
    private readonly biteHoldFocus = new Vec3();

    constructor(private readonly options: RaceEventPictureInPictureOptions) {
        this.buildCamera();
        this.buildHud();
    }

    reset(): void {
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

    showCannonLaunch(launch: CannonLaunch): void {
        const target = this.options.course.swimPosition(launch.targetDistance, launch.targetZ);
        const side = (launch.strikeId & 1) === 0 ? -1 : 1;
        this.cannonTargetX = target.x;
        this.cannonTargetZ = target.z;
        this.cannonSourceX = target.x;
        this.cannonSourceY = this.options.course.waterY + 1.2;
        this.cannonSourceZ = side * (this.options.course.poolWidth * 0.5 + 0.5);
        this.mode = 'cannon';
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

    updateCannon(launch: CannonLaunch | null, remainingSeconds: number, racing: boolean, dt: number): void {
        if (!racing) {
            if (this.mode === 'cannon') this.hide();
            return;
        }
        const safeDt = safeStep(dt);
        if (launch) {
            if (this.mode !== 'cannon') this.showCannonLaunch(launch);
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
        if (this.mode === 'shark' || this.mode === 'cannon') return;
        this.mode = 'whirlpool';
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

    dispose(): void {
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
        const projectileZ = this.cannonSourceZ + (this.cannonTargetZ - this.cannonSourceZ) * progress;
        const projectileY = this.cannonSourceY
            + (this.options.course.waterY + 0.12 - this.cannonSourceY) * progress
            + Math.sin(progress * Math.PI) * 5.2;
        const focusWeight = 0.42 + progress * 0.28;
        this.focus.set(
            this.cannonTargetX,
            this.options.course.waterY + 0.45 + projectileY * 0.08,
            projectileZ + (this.cannonTargetZ - projectileZ) * focusWeight,
        );
        const direction = this.options.course.directionAtDistance(targetDistance);
        this.cameraPosition.set(
            this.cannonTargetX - direction * 7.4,
            this.options.course.waterY + 5.4,
            (this.cannonSourceZ + this.cannonTargetZ) * 0.5,
        );
        this.applyCameraPose(52);
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
    }

    private hide(): void {
        this.setVisible(false);
        this.mode = 'none';
        this.holdSeconds = 0;
        this.warningPush = 0;
        this.biteHoldSeconds = 0;
        this.lastSharkState = SharkState.INACTIVE;
    }

    private buildCamera(): void {
        const node = new Node('RaceEventPictureInPictureCamera');
        node.setParent(this.options.worldRoot);
        node.layer = Layers.Enum.DEFAULT;
        const camera = node.addComponent(Camera);
        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        camera.visibility = Layers.Enum.DEFAULT | SWIMMER_LAYER | UNDERWATER_LAYER;
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
        const visibleSize = view.getVisibleSize();
        const root = makeRoundedRect(
            'RaceEventPictureInPicture',
            this.options.hud,
            FEED_WIDTH + 12,
            PANEL_HEIGHT,
            uiColor(5, 16, 30, 232),
            10,
            uiColor(91, 174, 221, 215),
            2,
        );
        root.setPosition(
            visibleSize.width * 0.5 - (FEED_WIDTH + 12) * 0.5 - PANEL_MARGIN,
            visibleSize.height * 0.5 - PANEL_HEIGHT * 0.5 - PANEL_MARGIN,
            0,
        );
        const titleNode = makeLabel('Title', root, '', 18, uiColor(224, 243, 255));
        titleNode.getComponent(UITransform)!.setContentSize(FEED_WIDTH, 26);
        titleNode.setPosition(0, PANEL_HEIGHT * 0.5 - 16, 0);
        const title = titleNode.getComponent(Label)!;
        styleProjectUiLabel(title, 'semibold', 24);
        const statusNode = makeLabel('Status', root, '', 14, WARNING_COLOR);
        statusNode.getComponent(UITransform)!.setContentSize(FEED_WIDTH, 20);
        statusNode.setPosition(0, PANEL_HEIGHT * 0.5 - 37, 0);
        const status = statusNode.getComponent(Label)!;
        styleProjectUiLabel(status, 'semibold', 20);
        const outline = statusNode.addComponent(LabelOutline);
        outline.color = uiColor(0, 6, 14, 230);
        outline.width = 2;
        const image = makeUiNode('Feed', root);
        image.getComponent(UITransform)!.setContentSize(FEED_WIDTH, FEED_HEIGHT);
        image.setPosition(0, -13, 0);
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
