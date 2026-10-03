import { FloatingItemRenderer } from './FloatingItemRenderer';
import { instantiate, Node, Prefab, Quat, Vec3 } from 'cc';
import { findNode, setLayerRecursive } from '../character/CharacterModelLoader';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { MINE_RELAY_TUNING, type MineRelayArm } from './MineRelayBrawlController';
import { ENTERTAINMENT_SPLASH_OWNER, ENTERTAINMENT_SPLASH_PROFILE, SprayBuoySplashPool } from './SprayBuoySplashPool';

const PRESENTATION_INTERVAL = 1 / 20;
const TRANSFER_THROW_SECONDS = 0.22;
const TRANSFER_THROW_ARC_HEIGHT = 0.55;
const DEFLATE_SECONDS = 0.28;
const EXPLOSION_SECONDS = 0.95;
const TIMED_BOMB_EXPLOSION_INTENSITY = 1.25;

/** 一份水球实例，只消费现有权威计时与归属；不创建碰撞体或第二套恢复状态。 */
export class MineRelayBrawlPresentation {
    private readonly root: Node;
    private body: Node | null = null;
    private connector: Node | null = null;
    private model: Node | null = null;
    private arm: MineRelayArm | null = null;
    private carrier: Node | null = null;
    private anchor: Node | null = null;
    private remainingSeconds = 0;
    private locked = false;
    private disposed = false;
    private elapsed = PRESENTATION_INTERVAL;
    private throwRemaining = 0;
    private throwDuration = 0;
    private throwArcHeight = 0;
    private deflateRemaining = 0;
    private inflation = 1;
    private readonly bodyScale = new Vec3(1, 1, 1);
    private readonly bodyEuler = new Vec3();
    private readonly source = new Vec3();
    private readonly target = new Vec3();
    private readonly centerLocal = new Vec3();
    private readonly sourceRotation = new Quat();
    private readonly targetRotation = new Quat();
    private readonly rotation = new Quat();
    private readonly resolutionWorldPosition = new Vec3();
    private readonly explosionCoreWorldPosition = new Vec3();

    constructor(
        private readonly worldRoot: Node,
        private readonly course: RaceCourseLayout,
        private readonly waterSplashes: SprayBuoySplashPool | null,
        private readonly resolveAnchor: (carrier: Node) => Node | null,
        prefab: Prefab, private readonly rendering: FloatingItemRenderer,
    ) {
        this.root = new Node('TimedWaterBalloonPresentation');
        this.root.setParent(worldRoot);
        this.root.layer = worldRoot.layer;
        this.root.active = false;
        try {
            this.model = instantiate(prefab); this.model.setParent(this.root);
            setLayerRecursive(this.model, worldRoot.layer);
            this.body = findNode(this.model, 'BalloonBody'); this.connector = findNode(this.model, 'BalloonConnector');
            if (!this.body || !this.connector) throw new Error('水球主体或连接件缺失');
            this.rendering.bindTextured(this.root);
        } catch (error) { this.dispose(); throw error; }
    }

    get visualNode(): Node | null {
        return !this.disposed && this.root.active && this.model ? this.root : null;
    }

    reset(): void {
        this.detachMine();
        this.elapsed = PRESENTATION_INTERVAL;
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.TIMED_BOMB);
    }

    attach(arm: MineRelayArm, carrier: Node | null, throwFromStands = false): void {
        if (this.disposed) return;
        this.arm = arm;
        this.carrier = carrier;
        this.remainingSeconds = arm.fuseSeconds;
        this.locked = false;
        this.deflateRemaining = 0;
        this.cancelThrow();
        this.attachCurrent();
        this.presentBody();
        if (!throwFromStands || !this.model || !this.anchor?.isValid) return;
        this.anchor.getWorldPosition(this.target);
        const side = this.target.z >= 0 ? 1 : -1;
        this.source.set(this.target.x - this.course.direction * 1.8,
            this.course.waterY + 4.8, side * (this.course.poolWidth * 0.5 + 3.2));
        this.beginThrow(Math.max(0.2, MINE_RELAY_TUNING.initialTransferCooldownSeconds), 3.6);
    }

    transfer(arm: MineRelayArm, previousCarrier: Node | null, carrier: Node | null): void {
        if (this.disposed) return;
        if (this.root.active) {
            this.root.getWorldPosition(this.source);
            this.root.getWorldRotation(this.sourceRotation);
        } else {
            const oldAnchor = previousCarrier?.isValid ? this.resolveAnchor(previousCarrier) : null;
            if (oldAnchor) oldAnchor.getWorldPosition(this.source);
        }
        const hadVisual = this.root.active;
        this.arm = arm;
        this.carrier = carrier;
        this.deflateRemaining = 0;
        this.cancelThrow();
        this.anchor = carrier?.isValid ? this.resolveAnchor(carrier) : null;
        if (hadVisual && this.anchor?.isValid) this.beginThrow(TRANSFER_THROW_SECONDS, TRANSFER_THROW_ARC_HEIGHT);
        else this.attachCurrent();
    }

    sync(arm: MineRelayArm | null, carrier: Node | null): void {
        if (this.disposed) return;
        if (!arm) {
            if (this.deflateRemaining <= 0 && this.arm) this.detachMine();
            return;
        }
        const changed = this.arm?.roundId !== arm.roundId || this.carrier !== carrier;
        this.arm = arm;
        this.carrier = carrier;
        if (changed) {
            this.deflateRemaining = 0;
            this.cancelThrow();
        }
        if (changed || !this.anchor?.isValid || this.throwRemaining <= 0) this.attachCurrent();
    }

    showResolution(exploded: boolean, worldPosition: Readonly<Vec3> | null): void {
        if (this.disposed) return;
        const round = this.arm?.roundId ?? 0;
        const visible = !!this.visualNode;
        // 解绑前记录球体真实中心，潜水、空中和转交时都不能用水面根位置替代。
        if (visible) {
            this.centerLocal.set(0, 0.245, 0);
            Vec3.transformMat4(this.explosionCoreWorldPosition, this.centerLocal, this.body!.worldMatrix);
        } else if (worldPosition) this.explosionCoreWorldPosition.set(worldPosition);
        if (!exploded && visible) {
            this.root.getWorldPosition(this.target);
            this.root.getWorldRotation(this.rotation);
            this.root.setWorldPosition(this.target);
            this.root.setWorldRotation(this.rotation);
            this.root.setScale(1, 1, 1);
            this.arm = null;
            this.carrier = this.anchor = null;
            this.cancelThrow();
            this.deflateRemaining = DEFLATE_SECONDS;
            return;
        }
        this.detachMine();
        if (!exploded || !worldPosition) return;
        this.resolutionWorldPosition.set(this.explosionCoreWorldPosition.x,
            this.course.waterY + 0.035, this.explosionCoreWorldPosition.z);
        this.waterSplashes?.play({
            owner: ENTERTAINMENT_SPLASH_OWNER.TIMED_BOMB,
            profile: ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION,
            position: this.resolutionWorldPosition,
            explosionCorePosition: this.explosionCoreWorldPosition,
            yawDegrees: round * 53,
            intensity: TIMED_BOMB_EXPLOSION_INTENSITY,
            duration: EXPLOSION_SECONDS,
            layer: this.worldRoot.layer,
        });
    }

    update(dt: number, arm: MineRelayArm | null, carrier: Node | null, remaining: number, locked: boolean, racing: boolean): void {
        if (this.disposed) return;
        if (!racing) { this.detachMine(); return; }
        this.remainingSeconds = remaining;
        this.locked = locked;
        if (!arm && this.deflateRemaining <= 0) return;
        this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        this.sync(arm, carrier);
        const step = this.elapsed;
        this.elapsed = 0;
        if (this.deflateRemaining > 0) { this.advanceDeflate(step); return; }
        if (!this.anchor?.isValid || !this.model) return;
        this.advanceThrow(step);
        this.presentBody();
    }

    dispose(): void {
        if (this.disposed) return;
        this.reset();
        this.disposed = true;
        this.rendering.unbind(this.root);
        if (this.root.isValid) this.root.destroy();
        this.model = this.body = this.connector = null;
    }

    private attachCurrent(): void {
        this.anchor = this.carrier?.isValid ? this.resolveAnchor(this.carrier) : null;
        if (!this.anchor?.isValid || !this.model) { this.setActive(false); return; }
        // 道具实例始终由世界根持有，角色模型重载不会连带销毁它。
        this.anchor.getWorldPosition(this.target);
        this.anchor.getWorldRotation(this.targetRotation);
        if (!Vec3.equals(this.root.worldPosition, this.target)) this.root.setWorldPosition(this.target);
        if (!Quat.equals(this.root.worldRotation, this.targetRotation)) this.root.setWorldRotation(this.targetRotation);
        this.setActive(true);
        if (this.connector && !this.connector.active) this.connector.active = true;
    }

    private presentBody(): void {
        if (!this.arm || !this.body || !this.root.active) return;
        const age = Math.max(0, this.arm.fuseSeconds - this.remainingSeconds);
        const urgency = Math.max(0, Math.min(1, age / Math.max(0.01, this.arm.fuseSeconds)));
        const swell = Math.pow(urgency, 1.65);
        const warning = Math.max(0, (urgency - 0.35) / 0.65);
        // 相位是本轮年龄的函数，频率从 0.75Hz 连续加快到 2.55Hz。
        // 横向鼓起时纵向轻压，再回弹；最后锁定仍只改变外观。
        const phase = Math.PI * 2 * (age * 0.75 + age * urgency * 0.9);
        const pulse = Math.pow(Math.max(0, Math.sin(phase)), 3) * warning;
        this.inflation = 1 + swell * 0.44;
        this.bodyScale.set(this.inflation + pulse * 0.07,
            1 + swell * 0.36 - pulse * 0.025, this.inflation + pulse * 0.07);
        if (!Vec3.equals(this.body.scale, this.bodyScale)) this.body.setScale(this.bodyScale);
        const tremor = this.locked ? Math.sin(age * 39) * 5 : Math.sin(age * 3.1) * (2 + warning);
        this.bodyEuler.set(tremor, Math.sin(age * 2.4) * 1.5,
            this.locked ? Math.sin(age * 31) * 4 : Math.sin(age * 2.4) * 2);
        if (!Vec3.equals(this.body.eulerAngles, this.bodyEuler)) {
            this.body.setRotationFromEuler(this.bodyEuler.x, this.bodyEuler.y, this.bodyEuler.z);
        }
    }

    private beginThrow(duration: number, arcHeight: number): void {
        this.root.getWorldRotation(this.sourceRotation);
        this.root.setScale(1, 1, 1);
        this.root.setWorldPosition(this.source);
        this.root.setWorldRotation(this.sourceRotation);
        this.throwDuration = this.throwRemaining = duration;
        this.throwArcHeight = arcHeight;
        if (this.connector?.active) this.connector.active = false;
        this.setActive(true);
    }

    private advanceThrow(step: number): void {
        if (this.throwRemaining <= 0 || !this.anchor?.isValid) return;
        this.throwRemaining = Math.max(0, this.throwRemaining - step);
        const t = 1 - this.throwRemaining / this.throwDuration;
        this.anchor.getWorldPosition(this.target);
        this.anchor.getWorldRotation(this.targetRotation);
        this.root.setWorldPosition(this.source.x + (this.target.x - this.source.x) * t,
            this.source.y + (this.target.y - this.source.y) * t + Math.sin(t * Math.PI) * this.throwArcHeight,
            this.source.z + (this.target.z - this.source.z) * t);
        Quat.slerp(this.rotation, this.sourceRotation, this.targetRotation, t);
        this.root.setWorldRotation(this.rotation);
        if (this.throwRemaining <= 0) { this.cancelThrow(); this.attachCurrent(); }
    }

    private advanceDeflate(step: number): void {
        this.deflateRemaining = Math.max(0, this.deflateRemaining - step);
        if (this.deflateRemaining <= 0) { this.detachMine(); return; }
        const scale = Math.max(0.02, this.deflateRemaining / DEFLATE_SECONDS);
        if (this.body) this.body.setScale(this.bodyScale.x * scale,
            this.bodyScale.y * (0.2 + 0.8 * scale), this.bodyScale.z * scale);
        if (this.connector?.active) this.connector.active = false;
    }

    private cancelThrow(): void { this.throwRemaining = this.throwDuration = this.throwArcHeight = 0; }

    private detachMine(): void {
        this.arm = null;
        this.carrier = this.anchor = null;
        this.deflateRemaining = 0;
        this.cancelThrow();
        this.setActive(false);
        if (this.root.isValid && this.root.parent !== this.worldRoot) this.root.setParent(this.worldRoot);
    }

    private setActive(value: boolean): void {
        if (this.root.isValid && this.root.active !== value) this.root.active = value;
    }
}
