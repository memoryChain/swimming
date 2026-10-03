import { Color, gfx, Material, Mesh, MeshRenderer, Node } from 'cc';
import { GEYSER_TUNING, geyserBurstHeight, geyserPulseIndex, geyserRadiusScale, geyserWarningSeconds,
    geyserPulseStart, type GeyserTuning, type GeyserVent } from './GeyserBrawlRules';
import type { FloatingItemLayers } from './FloatingItemRenderer';

import type { GeyserMeshes } from './EntertainmentItemAssets';
type VentView = { root: Node; foam: Node; jet: Node; drops: readonly Node[]; yaw: number; releaseLayers: (() => void) | null };
const FOAM_TAIL_SECONDS = 0.3;
const DROP_LIFE = 0.6;
const DROP_INTERVAL = 0.64;
/** Blender 导出的三份共享网格、一份材质。每口四个渲染节点，水滴与预警气泡复用槽位。 */
export class GeyserBrawlPresentation {
    private material: Material | null = null;
    private readonly views: VentView[] = [];
    private readonly foamY: number;
    private readonly waterlineY: number;
    private sampleTick = -1;
    private disposed = false;

    constructor(parent: Node, private readonly surfaceY: number, ventCount: number, meshes: GeyserMeshes,
        waterY = surfaceY + 0.055, layers: FloatingItemLayers | null = null) {
        // 水面高于泳者根节点，泡沫要放在实际水面上，不能陷进水材质里。
        this.foamY = Math.max(0.03, waterY - surfaceY + 0.025);
        this.waterlineY = waterY - surfaceY;
        let buildingRoot: Node | null = null;
        try {
            this.material = new Material();
            this.material.initialize({ effectName: 'builtin-unlit', technique: 1,
                defines: { USE_VERTEX_COLOR: true }, states: {
                    rasterizerState: { cullMode: gfx.CullMode.NONE },
                    depthStencilState: { depthTest: true, depthWrite: false },
                } });
            this.material.setProperty('mainColor', new Color(255, 255, 255, 255));
            for (let index = 0; index < ventCount; index++) {
                const root = buildingRoot = new Node(`GeyserVent_${index}`);
                parent.addChild(root);
                root.layer = parent.layer;
                const foam = this.part(root, 'SurfaceFoam', meshes.foam);
                const jet = this.part(root, 'WaterJetAndCrown', meshes.jet);
                const drops = [this.part(root, 'BubblesAndDropsA', meshes.drops),
                    this.part(root, 'BubblesAndDropsB', meshes.drops)];
                const yaw = (index * 137.508) % 360;
                jet.setRotationFromEuler(0, yaw, 0);
                drops[0].setRotationFromEuler(0, yaw + 23, 0);
                drops[1].setRotationFromEuler(0, yaw + 157, 0);
                foam.setRotationFromEuler(0, yaw, 0);
                root.active = false;
                const view: VentView = { root, foam, jet, drops, yaw, releaseLayers: null };
                this.views.push(view);
                buildingRoot = null;
                view.releaseLayers = layers?.registerFloatingObject(root) ?? null;
            }
        } catch (error) {
            if (buildingRoot?.isValid) buildingRoot.destroy();
            this.dispose();
            throw error;
        }
    }

    update(vents: readonly GeyserVent[], age: number, pulseCount: number,
        stoppedAt = Number.POSITIVE_INFINITY, tuning: GeyserTuning = GEYSER_TUNING): void {
        if (this.disposed || !Number.isFinite(age)) return;
        const tick = Math.floor(age * 30 + 1e-6);
        if (tick === this.sampleTick) return;
        this.sampleTick = tick;
        for (let index = 0; index < this.views.length; index++) {
            const view = this.views[index];
            const vent = vents[index];
            if (!vent || pulseCount <= 0) { active(view.root, false); continue; }
            const pulse = Math.min(pulseCount - 1, geyserPulseIndex(vent, age, tuning));
            const start = geyserPulseStart(vent, pulse, tuning);
            const local = age - start;
            const radius = geyserRadiusScale(vent, tuning);
            const heightScale = vent.size === 'large' ? tuning.largeJetHeightScale : 1;
            const warning = geyserWarningSeconds(vent, tuning);
            const burstAge = local - warning;
            const releaseAge = burstAge - tuning.burstSeconds;
            const visible = start <= stoppedAt && local >= 0
                && releaseAge < tuning.fallingSeconds + FOAM_TAIL_SECONDS;
            active(view.root, visible);
            if (!visible) continue;
            position(view.root, vent.x, this.surfaceY, vent.z);
            if (burstAge < 0) {
                const pressure = clamp01(local / warning);
                active(view.jet, false);
                active(view.foam, true);
                // 危险范围保持不变，泡沫鼓包从预警开始就高于水面，低机位也能辨认。
                const swell = .65 + pressure * .75 + .12 * pressure * Math.sin(local * 9 + view.yaw);
                scale(view.foam, radius, swell, radius);
                position(view.foam, 0, this.foamY, 0);
                for (let group = 0; group < 2; group++) {
                    const bubbleAge = local - group * 0.35;
                    const node = view.drops[group];
                    active(node, bubbleAge >= 0);
                    if (bubbleAge < 0) continue;
                    const bubbleLife = .82 + group * .11;
                    const rise = (bubbleAge % bubbleLife) / bubbleLife;
                    // 回收前后不可见，避免一批气泡从水面瞬移回池底。
                    const envelope = Math.min(1, rise / .12, (1 - rise) / .14);
                    const spread = (0.35 + rise * 0.35) * radius;
                    scale(node, spread * envelope, (.55 + pressure * .35) * envelope, spread * envelope);
                    // 气泡从真实水面附近冒出；不能沿用池底高度，否则预警整段埋在水下。
                    position(node, 0.04 * Math.sin(local * 7 + group), this.waterlineY - .16 + rise * .38, 0);
                }
                continue;
            }

            // 水束先失去压力，碎水继续按抛物线运动，水面余沫最后散开。
            const release = clamp01(releaseAge / tuning.fallingSeconds);
            const lift = releaseAge >= 0 ? 1 : geyserBurstHeight(vent, pulse, age, tuning);
            // 水下是同一种介质中的上升流，不画有清晰边界的柱体。
            // 只取现有高度包络露出真实水面的部分，水冠也不再从水下拉上来。
            const exposedHeight = Math.max(0,
                -1.4 - release * 0.16 + 2.7 * lift * (1 - release * 0.4) - this.waterlineY) * heightScale;
            active(view.jet, exposedHeight > 0.015 && release < 0.7);
            if (view.jet.active) {
                const phase = burstAge * (vent.size === 'large' ? 7.6 : 10) + view.yaw * .0174533 + pulse * 1.7;
                const width = (1 + .065 * Math.sin(phase)) * (1 - release * .7) * radius;
                scale(view.jet, width, exposedHeight, (1 + .05 * Math.sin(phase + 1.6)) * (1 - release * .7) * radius);
                view.jet.setRotationFromEuler(0, view.yaw + 3.5 * Math.sin(phase * .7), 0);
                position(view.jet, 0, this.waterlineY, 0);
            }
            active(view.foam, true);
            const tail = clamp01((releaseAge - tuning.fallingSeconds) / FOAM_TAIL_SECONDS);
            const ripple = 1 + 0.18 * release + 0.18 * tail;
            scale(view.foam, ripple * radius, (.7 + .14 * Math.sin(burstAge * 8 + view.yaw)) * (1 - tail), ripple * radius);
            position(view.foam, 0, this.foamY - tail * 0.09, 0);
            for (let group = 0; group < 2; group++) {
                const node = view.drops[group];
                const first = tuning.burstRiseSeconds + .025 + group * .32;
                const emissionAge = Math.min(burstAge, tuning.burstSeconds - 0.001);
                const emission = first + Math.floor((emissionAge - first) / DROP_INTERVAL) * DROP_INTERVAL;
                const flightAge = burstAge - emission;
                active(node, emissionAge >= first && flightAge >= 0 && flightAge < DROP_LIFE);
                if (!node.active) continue;
                const spread = (0.52 + 1.38 * flightAge) * radius;
                const shrink = 1 - 0.55 * clamp01((flightAge - 0.4) / 0.2);
                scale(node, spread, shrink * (0.75 + flightAge * 0.7), spread);
                position(node, 0, Math.max(this.foamY, this.waterlineY
                    + (1.12 + 0.8 * flightAge - 4.4 * flightAge * flightAge - this.waterlineY) * heightScale), 0);
            }
        }
    }

    hide(): void {
        if (this.disposed) return;
        for (const view of this.views) active(view.root, false);
        this.sampleTick = -1;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const view of this.views) { view.releaseLayers?.(); if (view.root.isValid) view.root.destroy(); }
        this.material?.destroy();
    }

    private part(parent: Node, name: string, mesh: Mesh): Node {
        const node = new Node(name);
        parent.addChild(node);
        node.layer = parent.layer;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(this.material!, 0);
        node.active = false;
        return node;
    }
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function active(node: Node, value: boolean): void { if (node.active !== value) node.active = value; }
function position(node: Node, x: number, y: number, z: number): void {
    if (node.position.x !== x || node.position.y !== y || node.position.z !== z) node.setPosition(x, y, z);
}
function scale(node: Node, x: number, y: number, z: number): void {
    if (node.scale.x !== x || node.scale.y !== y || node.scale.z !== z) node.setScale(x, y, z);
}
