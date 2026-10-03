import { Mesh, MeshRenderer, Node, Quat } from 'cc';
import type { RecoveryFloatPose } from './RecoveryFloatPose';
import type { FloatingItemRenderer } from '../entertainment/FloatingItemRenderer';

/** 每位参与娱乐玩法的泳者一个固定浮圈，全部共享网格及水线材质。 */
export class RecoveryFloatPresentation {
    private ring: Node | null = null;
    private shown = false;
    private blinkVisible = true;
    private disposed = false;
    private readonly tilt = new Quat();
    private readonly rotation = new Quat();
    constructor(parent: Node, mesh: Mesh, private readonly rendering: FloatingItemRenderer) {
        try {
            const ring = this.ring = new Node('RecoveryFloatRing');
            ring.active = false; ring.setParent(parent); ring.layer = parent.layer;
            ring.addComponent(MeshRenderer).mesh = mesh;
            rendering.bind(ring);
        } catch (error) { this.dispose(); throw error; }
    }
    update(pose: RecoveryFloatPose | null, weight: number): void {
        if (this.disposed) return;
        this.shown = !!pose?.ready && weight > 0;
        if (!this.ring) return;
        const visible = this.shown && this.blinkVisible;
        if (this.ring.active !== visible) this.ring.active = visible;
        if (!visible || !pose) return;
        this.ring.setPosition(pose.position.x - (1 - weight) * .12, pose.position.y - (1 - weight) * .3, pose.position.z);
        Quat.fromEuler(this.tilt, 0, 0, -(1 - weight) * 16);
        Quat.multiply(this.rotation, pose.rotation, this.tilt); this.ring.setRotation(this.rotation);
        const scale = pose.radius;
        if (this.ring.scale.x !== scale) this.ring.setScale(scale, scale, scale);
    }
    setBlinkVisible(visible: boolean): void {
        if (this.disposed || this.blinkVisible === visible) return;
        this.blinkVisible = visible;
        const active = visible && this.shown;
        if (this.ring && this.ring.active !== active) this.ring.active = active;
    }
    hide(): void { this.shown = false; if (this.ring?.active) this.ring.active = false; }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.ring) { this.rendering.unbind(this.ring); if (this.ring.isValid) this.ring.destroy(); }
        this.ring = null;
    }
}
