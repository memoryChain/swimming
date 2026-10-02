import { Color, gfx, Material, Mesh, MeshRenderer, Node, utils } from 'cc';
import { GEYSER_TUNING, geyserBurstHeight, geyserPulseIndex, geyserRadiusScale, geyserWarningSeconds,
    geyserPulseStart, type GeyserTuning, type GeyserVent } from './GeyserBrawlRules';

type Geometry = { positions: number[]; colors: number[]; indices: number[] };
type Tint = readonly [number, number, number, number];
type VentView = { root: Node; foam: Node; jet: Node; drops: readonly Node[]; yaw: number };
const FOAM_TAIL_SECONDS = 0.3;
const DROP_LIFE = 0.6;
const DROP_INTERVAL = 0.64;
const WHITE: Tint = [0.88, 0.98, 1, 0.92];
const PALE: Tint = [0.49, 0.88, 0.96, 0.82];
const WATER: Tint = [0.23, 0.71, 0.88, 0.8];
const BASE: Tint = [0.12, 0.53, 0.73, 0.08];
const SUBMERGED: Tint = [0.19, 0.66, 0.82, 0.3];

/** 三份固定网格、一份材质。每口四个渲染节点，水滴与预警气泡复用槽位。 */
export class GeyserBrawlPresentation {
    private readonly meshes: readonly Mesh[];
    private readonly material: Material;
    private readonly views: VentView[] = [];
    private readonly foamY: number;
    private readonly waterlineY: number;
    private sampleTick = -1;
    private disposed = false;

    constructor(parent: Node, private readonly surfaceY: number, ventCount: number,
        waterY = surfaceY + 0.055) {
        // 水面高于泳者根节点，泡沫要放在实际水面上，不能陷进水材质里。
        this.foamY = Math.max(0.03, waterY - surfaceY + 0.025);
        this.waterlineY = waterY - surfaceY;
        this.meshes = [utils.createMesh(buildSurfaceFoam()), utils.createMesh(buildWaterJet(this.waterlineY)),
            utils.createMesh(buildDroplets())];
        this.material = new Material();
        this.material.initialize({ effectName: 'builtin-unlit', technique: 1,
            defines: { USE_VERTEX_COLOR: true }, states: {
                rasterizerState: { cullMode: gfx.CullMode.NONE },
                depthStencilState: { depthTest: true, depthWrite: false },
            } });
        this.material.setProperty('mainColor', new Color(255, 255, 255, 255));
        for (let index = 0; index < ventCount; index++) {
            const root = new Node(`GeyserVent_${index}`);
            parent.addChild(root);
            root.layer = parent.layer;
            const foam = this.part(root, 'SurfaceFoam', this.meshes[0]);
            const jet = this.part(root, 'WaterJetAndCrown', this.meshes[1]);
            const drops = [this.part(root, 'BubblesAndDropsA', this.meshes[2]),
                this.part(root, 'BubblesAndDropsB', this.meshes[2])];
            const yaw = (index * 137.508) % 360;
            jet.setRotationFromEuler(0, yaw, 0);
            drops[0].setRotationFromEuler(0, yaw + 23, 0);
            drops[1].setRotationFromEuler(0, yaw + 157, 0);
            foam.setRotationFromEuler(0, yaw, 0);
            root.active = false;
            this.views.push({ root, foam, jet, drops, yaw });
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
                // 外沿从预警开始就覆盖危险半径，只让鼓包在高度上蓄压。
                const swell = .18 + pressure * .42 + .045 * pressure * Math.sin(local * 9 + view.yaw);
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
                    scale(node, spread * envelope, (.38 + pressure * .2) * envelope, spread * envelope);
                    position(node, 0.04 * Math.sin(local * 7 + group), -1.25 + rise * 1.16, 0);
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
        for (const view of this.views) if (view.root.isValid) view.root.destroy();
        for (const mesh of this.meshes) mesh.destroy();
        this.material.destroy();
    }

    private part(parent: Node, name: string, mesh: Mesh): Node {
        const node = new Node(name);
        parent.addChild(node);
        node.layer = parent.layer;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(this.material, 0);
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
function geometry(): Geometry { return { positions: [], colors: [], indices: [] }; }
function vertex(g: Geometry, x: number, y: number, z: number, tint: Tint): number {
    const index = g.positions.length / 3;
    g.positions.push(x, y, z); g.colors.push(...tint);
    return index;
}
function quad(g: Geometry, a: number, b: number, c: number, d: number): void {
    g.indices.push(a, b, c, a, c, d);
}

/** 不等长泡沫弧与倾斜小水片合在一份网格，避免规则同心圆的靶心感。 */
function buildSurfaceFoam(): Geometry {
    const g = geometry();
    for (let band = 0; band < 2; band++) {
        const count = band === 0 ? 19 : 27;
        for (let part = 0; part < count; part++) {
            if ((part + band) % 5 === 0) continue;
            const angle = part / count * Math.PI * 2 + band * 0.19;
            const next = angle + Math.PI * 2 / count * 0.82;
            const radius = (band === 0 ? 0.53 : 1.15) + 0.065 * Math.sin(part * 2.4);
            const width = (band === 0 ? 0.16 : 0.085) * (0.8 + 0.25 * Math.sin(part * 1.7));
            const top = band === 0 ? 0.05 + (part % 3) * 0.035 : 0.012;
            const a = vertex(g, Math.cos(angle) * radius, 0, Math.sin(angle) * radius, PALE);
            const b = vertex(g, Math.cos(next) * radius, 0, Math.sin(next) * radius, PALE);
            const c = vertex(g, Math.cos(next) * (radius + width), top, Math.sin(next) * (radius + width), WHITE);
            const d = vertex(g, Math.cos(angle) * (radius + width), top * 0.8, Math.sin(angle) * (radius + width), WHITE);
            quad(g, a, b, c, d);
        }
    }
    // 喷口附近的低矮泡沫鼓包，使蓄压有水面体积，而不只剩警戒环。
    for (let patch = 0; patch < 7; patch++) {
        const angle = patch * 2.39996;
        const radius = 0.2 + (patch % 3) * 0.15;
        const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
        const size = 0.09 + (patch % 2) * 0.045;
        const center = vertex(g, x, 0.08 + (patch % 3) * 0.025, z, WHITE);
        for (let side = 0; side < 6; side++) {
            const a = side / 6 * Math.PI * 2;
            vertex(g, x + Math.cos(a) * size, 0, z + Math.sin(a) * size, PALE);
        }
        for (let side = 0; side < 6; side++) g.indices.push(center, center + 1 + side, center + 1 + (side + 1) % 6);
    }
    return g;
}

/** 脉动水束：不等截面、偏心腰身；上部八瓣水冠从中心向外翻卷。 */
function buildWaterJet(waterlineY: number): Geometry {
    const g = geometry();
    const radii = [0.25, 0.25, 0.29, 0.38, 0.48, 0.32];
    const heights = [0, 0.23, 0.48, 0.7, 0.84, 0.94];
    const sides = 12;
    for (let row = 0; row < radii.length; row++) {
        const y = heights[row];
        for (let side = 0; side < sides; side++) {
            const angle = side / sides * Math.PI * 2;
            const ripple = 1 + 0.1 * Math.sin(side * 2.5 + row * 1.6);
            const radius = radii[row] * ripple;
            const tint = row === 0 ? BASE : row < 3 ? SUBMERGED
                : side % 4 === 1 ? PALE : row >= 4 ? PALE : WATER;
            vertex(g, Math.cos(angle) * radius + 0.065 * Math.sin(y * 5), y,
                Math.sin(angle) * radius + 0.045 * Math.sin(y * 7), tint);
            if (row > 0) {
                const a = (row - 1) * sides + side, b = (row - 1) * sides + (side + 1) % sides;
                quad(g, a, b, b + sides, a + sides);
            }
        }
    }
    const cap = vertex(g, 0, 0.965, 0, PALE);
    for (let side = 0; side < sides; side++) g.indices.push(cap, 5 * sides + side, 5 * sides + (side + 1) % sides);
    for (let petal = 0; petal < 8; petal++) {
        const angle = petal / 8 * Math.PI * 2 + 0.07 * Math.sin(petal * 3);
        const base = g.positions.length / 3;
        const length = 0.65 + .22 * Math.sin(petal * 2.2);
        for (let step = 0; step < 6; step++) {
            const t = step / 5;
            const radius = 0.23 + length * t;
            const y = 0.85 + (0.12 + 0.045 * Math.sin(petal * 1.8)) * Math.sin(t * Math.PI)
                - (0.04 + 0.09 * (petal % 3) / 2) * t;
            const halfWidth = (.1 + .08 * Math.sin(t * Math.PI)) * (1 - t * .86)
                * (.85 + .15 * Math.cos(petal * 2.1));
            for (const sign of [-1, 1]) vertex(g,
                Math.cos(angle) * radius - Math.sin(angle) * halfWidth * sign, y,
                Math.sin(angle) * radius + Math.cos(angle) * halfWidth * sign, step >= 3 && petal % 3 !== 0 ? WHITE : PALE);
            if (step > 0) quad(g, base + step * 2 - 2, base + step * 2 - 1, base + step * 2 + 1, base + step * 2);
        }
    }
    return cropJetAboveWater(g, Math.min(0.9, Math.max(0, (1.4 + waterlineY) / 2.7)));
}

/** 初始化时裁掉水下三角面，保留已认可的水上外形，再把水面至柱顶归一化。 */
function cropJetAboveWater(source: Geometry, plane: number): Geometry {
    const result = geometry();
    for (let triangle = 0; triangle < source.indices.length; triangle += 3) {
        const input: number[][] = [];
        for (let corner = 0; corner < 3; corner++) {
            const index = source.indices[triangle + corner];
            input.push([...source.positions.slice(index * 3, index * 3 + 3),
                ...source.colors.slice(index * 4, index * 4 + 4)]);
        }
        const polygon: number[][] = [];
        for (let edge = 0; edge < 3; edge++) {
            const previous = input[(edge + 2) % 3], current = input[edge];
            const wasAbove = previous[1] >= plane, isAbove = current[1] >= plane;
            if (wasAbove !== isAbove) {
                const t = (plane - previous[1]) / (current[1] - previous[1]);
                const point = previous.map((value, index) => value + (current[index] - value) * t);
                point[1] = plane;
                polygon.push(point);
            }
            if (isAbove) polygon.push(current);
        }
        const base = result.positions.length / 3;
        for (const point of polygon) {
            result.positions.push(point[0], Math.max(0, (point[1] - plane) / (1 - plane)), point[2]);
            result.colors.push(point[3], point[4], point[5], point[6]);
        }
        for (let corner = 1; corner + 1 < polygon.length; corner++) result.indices.push(base, base + corner, base + corner + 1);
    }
    return result;
}

/** 八颗错大小切面水滴合一批；两个槽交替发射，避免逐滴创建节点。 */
function buildDroplets(): Geometry {
    const g = geometry();
    for (let drop = 0; drop < 8; drop++) {
        const angle = drop * 2.39996;
        const radius = 0.57 + (drop % 3) * 0.19;
        const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
        const y = (drop % 4) * 0.075;
        const size = 0.055 + (drop % 3) * 0.018;
        const base = g.positions.length / 3;
        vertex(g, x, y + size * 1.65, z, WHITE);
        for (let side = 0; side < 6; side++) {
            const a = side / 6 * Math.PI * 2;
            vertex(g, x + Math.cos(a) * size, y, z + Math.sin(a) * size, side < 3 ? WHITE : PALE);
        }
        vertex(g, x, y - size * 0.85, z, WATER);
        for (let side = 0; side < 6; side++) g.indices.push(base, base + 1 + side,
            base + 1 + (side + 1) % 6, base + 7, base + 1 + (side + 1) % 6, base + 1 + side);
    }
    return g;
}
