import { instantiate, Node, Quat } from 'cc';
import { loadSwimmerPrefab, setLayerRecursive } from './CharacterModelLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import type { RecoveryFloatPose } from './RecoveryFloatPose';

/** 每位泳者一个复用实例；Prefab 的网格和材质由加载缓存共享。 */
export class RecoveryFloatPresentation {
    private ring: Node | null = null;
    private disposed = false;
    private shown = false;
    private blinkVisible = true;
    private pose: RecoveryFloatPose | null = null;
    private weight = 0;
    private readonly tilt = new Quat();
    private readonly rotation = new Quat();

    constructor(private readonly parent: Node) {
        loadSwimmerPrefab((error, result) => {
            if (this.disposed || !parent.isValid || error || !result) return;
            this.ring = instantiate(result.prefab);
            this.ring.name = 'RecoveryFloatRing';
            this.ring.active = false;
            this.ring.setParent(parent);
            setLayerRecursive(this.ring, parent.layer);
            // 晚加载只应用最后一次权威采样，不重播入场。
            if (this.pose) this.update(this.pose, this.weight);
        }, RESOURCE_PATHS.recoveryFloatRingPrefabCandidates);
    }

    update(pose: RecoveryFloatPose, weight: number): void {
        this.pose = pose;
        this.weight = weight;
        this.shown = pose.ready && weight > 0;
        if (!this.ring) return;
        const visible = this.shown && this.blinkVisible;
        if (this.ring.active !== visible) this.ring.active = visible;
        if (!visible) return;
        if (this.ring.layer !== this.parent.layer) setLayerRecursive(this.ring, this.parent.layer);
        this.ring.setPosition(pose.position.x - (1 - weight) * 0.12,
            pose.position.y - (1 - weight) * 0.3, pose.position.z);
        Quat.fromEuler(this.tilt, 0, 0, -(1 - weight) * 16);
        Quat.multiply(this.rotation, pose.rotation, this.tilt);
        this.ring.setRotation(this.rotation);
        const scale = pose.radius;
        if (this.ring.scale.x !== scale) this.ring.setScale(scale, scale, scale);
    }

    setBlinkVisible(visible: boolean): void {
        this.blinkVisible = visible;
        const active = visible && this.shown;
        if (this.ring && this.ring.active !== active) this.ring.active = active;
    }

    hide(): void {
        this.pose = null;
        this.shown = false;
        if (this.ring?.active) this.ring.active = false;
    }

    dispose(): void {
        this.disposed = true;
        this.hide();
        if (this.ring?.isValid) this.ring.destroy();
        this.ring = null;
    }
}
