import { instantiate, Node, Prefab } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { SupplySlot } from './SupplyRaceController';
import { sampleWaterFloatOffset, WATER_FLOAT_PROFILES } from './WaterFloatMotion';
import { ENTERTAINMENT_DEBUG_TUNING } from '../core/EntertainmentBalance';
import { FloatingItemRenderer } from './FloatingItemRenderer';

/** 赛前一次建立双模型池；比赛帧只以 20Hz 消费逻辑状态。 */
export class SupplyRacePresentation {
    private readonly roots: Node[] = [];
    private readonly soda: Node[] = [];
    private readonly slush: Node[] = [];
    private elapsed = 1;
    private disposed = false;
    constructor(world: Node, private readonly course: RaceCourseLayout, count: number, soda: Prefab, slush: Prefab,
        private readonly rendering: FloatingItemRenderer) {
        for (let id = 0; id < count; id++) {
            const root = new Node(`EntertainmentSupply${id}`);
            root.setParent(world); root.layer = world.layer; root.setScale(.7, .7, .7);
            const a = instantiate(soda), b = instantiate(slush);
            a.setParent(root); b.setParent(root);
            this.setLayer(a, world.layer); this.setLayer(b, world.layer);
            a.active = false; b.active = false; root.active = false;
            this.roots.push(root); this.soda.push(a); this.slush.push(b);
            this.rendering.bind(root);
        }
    }
    reset() { this.elapsed = 1; for (const node of this.roots) this.active(node, false); }
    update(dt: number, slots: readonly SupplySlot[], visible: boolean) {
        if (this.disposed) return;
        if (!visible) { for (const node of this.roots) this.active(node, false); this.elapsed = 1; return; }
        this.elapsed += dt;
        if (this.elapsed < .05) return;
        this.elapsed = 0;
        for (let i = 0; i < this.roots.length; i++) {
            const slot = slots[i], node = this.roots[i];
            this.active(node, slot.active);
            if (!slot.active) continue;
            this.active(this.soda[i], slot.kind === 'heartbeat-soda');
            this.active(this.slush[i], slot.kind === 'calm-slush');
            const t = Math.min(1, slot.age / ENTERTAINMENT_DEBUG_TUNING.supplyThrowSeconds);
            const landed = t >= 1;
            node.setWorldPosition(this.course.distanceToWorldX(slot.courseX),
                this.course.waterY + .08 + (landed ? sampleWaterFloatOffset(slot.age, i * .83, WATER_FLOAT_PROFILES.supply)
                    : (1 - t) * 4.5 + Math.sin(t * Math.PI) * 1.8),
                landed ? slot.lateral : slot.lateral * t + (slot.lateral > 0 ? 1 : -1) * (this.course.poolWidth / 2 + 2) * (1 - t));
            node.setRotationFromEuler(landed ? 7 * Math.sin(slot.age * 1.8) : 230 * (1 - t), i * 53 + slot.age * 8, 0);
        }
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        for (const node of this.roots) {
            this.rendering.unbind(node);
            if (node.isValid) node.destroy();
        }
    }
    private active(node: Node, value: boolean) { if (node.isValid && node.active !== value) node.active = value; }
    private setLayer(node: Node, layer: number) { node.layer = layer; for (const child of node.children) this.setLayer(child, layer); }
}
