import { Color, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { MineRelayArm } from './MineRelayBrawlController';

const PRESENTATION_INTERVAL = 1 / 20;
const EXPLOSION_SECONDS = 0.58;
const ATTACH_X = -0.28;
const ATTACH_Y = 0.48;
const ATTACH_Z = 0;

/** 单个固定低面数定时炸弹与池化爆炸网格；炸弹挂到泳者节点后无需逐帧追踪世界坐标。 */
export class MineRelayBrawlPresentation {
    private mineRoot: Node | null = null;
    private lamp: Node | null = null;
    private explosion: Node | null = null;
    private mineMesh: Mesh | null = null;
    private lampMesh: Mesh | null = null;
    private explosionMesh: Mesh | null = null;
    private mineMaterial: Material | null = null;
    private lampMaterial: Material | null = null;
    private explosionMaterial: Material | null = null;
    private activeRoundId = -1;
    private explosionRemaining = 0;
    private elapsed = PRESENTATION_INTERVAL;
    private clock = 0;
    private disposed = false;

    constructor(private readonly worldRoot: Node) {
        this.build();
    }

    reset(): void {
        this.activeRoundId = -1;
        this.explosionRemaining = 0;
        this.elapsed = PRESENTATION_INTERVAL;
        this.clock = 0;
        this.detachMine();
        this.setActive(this.explosion, false);
    }

    attach(arm: MineRelayArm, carrierNode: Node | null): void {
        if (this.disposed || !arm || !carrierNode?.isValid || !this.mineRoot?.isValid) return;
        this.activeRoundId = arm.roundId;
        this.mineRoot.setParent(carrierNode);
        this.mineRoot.setPosition(ATTACH_X, ATTACH_Y, ATTACH_Z);
        this.mineRoot.setRotationFromEuler(0, 0, 0);
        this.mineRoot.setScale(1, 1, 1);
        this.setActive(this.mineRoot, true);
    }

    sync(arm: MineRelayArm | null, carrierNode: Node | null): void {
        if (!arm) {
            if (this.activeRoundId >= 0) this.detachMine();
            return;
        }
        if (arm.roundId !== this.activeRoundId || this.mineRoot?.parent !== carrierNode) {
            this.attach(arm, carrierNode);
        }
    }

    showResolution(exploded: boolean, worldPosition: Readonly<Vec3> | null): void {
        if (this.disposed) return;
        this.detachMine();
        if (!exploded || !worldPosition || !this.explosion?.isValid) return;
        this.explosion.setParent(this.worldRoot);
        this.explosion.setWorldPosition(worldPosition.x, worldPosition.y, worldPosition.z);
        applyWaterExplosionPhase(this.explosion, 0, 0.9);
        this.setActive(this.explosion, true);
        this.explosionRemaining = EXPLOSION_SECONDS;
    }

    update(dt: number, arm: MineRelayArm | null, carrierNode: Node | null, remainingSeconds: number, locked: boolean, racing: boolean): void {
        if (this.disposed) return;
        if (!racing) {
            this.detachMine();
            this.setActive(this.explosion, false);
            return;
        }
        this.sync(arm, carrierNode);
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.elapsed += step;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.elapsed;
        this.elapsed = 0;
        this.clock += presentationStep;
        if (arm && this.mineRoot?.active) {
            const urgency = Math.max(0, Math.min(1, 1 - remainingSeconds / Math.max(0.01, arm.fuseSeconds)));
            const frequency = locked ? 18 : 5 + urgency * 8;
            const pulse = 0.78 + (Math.sin(this.clock * frequency) * 0.5 + 0.5) * (locked ? 0.5 : 0.3);
            this.lamp?.setScale(pulse, pulse, pulse);
            const swayScale = locked ? 1.45 : 1;
            this.mineRoot.setRotationFromEuler(
                Math.sin(this.clock * 3.1) * 3 * swayScale,
                Math.sin(this.clock * 1.8) * 6 * swayScale,
                Math.sin(this.clock * 2.4) * 4 * swayScale,
            );
        }
        if (this.explosionRemaining > 0) {
            this.explosionRemaining = Math.max(0, this.explosionRemaining - presentationStep);
            const progress = 1 - this.explosionRemaining / EXPLOSION_SECONDS;
            if (this.explosion) applyWaterExplosionPhase(this.explosion, progress, 0.9);
            if (this.explosionRemaining <= 0) this.setActive(this.explosion, false);
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.mineRoot?.isValid) this.mineRoot.destroy();
        if (this.explosion?.isValid) this.explosion.destroy();
        this.mineRoot = this.lamp = this.explosion = null;
        this.mineMesh?.destroy();
        this.lampMesh?.destroy();
        this.explosionMesh?.destroy();
        this.mineMaterial?.destroy();
        this.lampMaterial?.destroy();
        this.explosionMaterial?.destroy();
    }

    private detachMine(): void {
        this.activeRoundId = -1;
        if (!this.mineRoot?.isValid) return;
        this.mineRoot.setParent(this.worldRoot);
        this.setActive(this.mineRoot, false);
    }

    private build(): void {
        if (!this.worldRoot?.isValid) return;
        this.mineMesh = utils.createMesh(buildTimedBombGeometry());
        this.lampMesh = utils.createMesh(buildLowPolyLampGeometry());
        this.explosionMesh = utils.createMesh(buildWaterExplosionGeometry());
        this.mineMaterial = makeMineVertexMaterial('TimedBombBodyMaterial', true);
        this.explosionMaterial = makeMineVertexMaterial('MineRelayExplosionMaterial', false);
        this.lampMaterial = new Material();
        this.lampMaterial.initialize({ effectName: 'builtin-unlit' });
        this.lampMaterial.name = 'TimedBombLampMaterial';
        this.lampMaterial.setProperty('mainColor', new Color(255, 72, 24, 255));

        this.mineRoot = this.makeMeshNode('TimedBomb', this.mineMesh, this.mineMaterial, this.worldRoot);
        this.lamp = this.makeMeshNode('TimedBombWarningLamp', this.lampMesh, this.lampMaterial, this.mineRoot);
        this.lamp.setPosition(0, 0.59, 0.02);
        this.explosion = this.makeMeshNode('MineRelayExplosion', this.explosionMesh, this.explosionMaterial, this.worldRoot);
        this.mineRoot.active = false;
        this.explosion.active = false;
    }

    private makeMeshNode(name: string, mesh: Mesh, material: Material, parent: Node): Node {
        const node = new Node(name);
        node.setParent(parent);
        node.layer = this.worldRoot.layer;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(material, 0);
        return node;
    }

    private setActive(node: Node | null, active: boolean): void {
        if (node?.isValid && node.active !== active) node.active = active;
    }
}

type ColorTuple = readonly [number, number, number, number];

export function makeMineVertexMaterial(name: string, opaque: boolean): Material {
    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        technique: opaque ? 0 : 1,
        defines: { USE_VERTEX_COLOR: true },
        states: opaque ? undefined : {
            rasterizerState: { cullMode: gfx.CullMode.NONE },
            depthStencilState: { depthTest: true, depthWrite: false },
        },
    });
    material.name = name;
    material.setProperty('mainColor', Color.WHITE);
    return material;
}

export function buildMineGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendOctahedron(positions, colors, indices, 0.34, [0.07, 0.10, 0.12, 1]);
    const directions: ReadonlyArray<readonly [number, number, number]> = [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    for (const direction of directions) appendSpike(positions, colors, indices, direction, [0.15, 0.19, 0.21, 1]);
    return geometry(positions, colors, indices, new Vec3(-0.57, -0.57, -0.57), new Vec3(0.57, 0.57, 0.57));
}

export function buildTimedBombGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const rods: ReadonlyArray<readonly [number, number, ColorTuple]> = [
        [-0.16, -0.09, [0.82, 0.08, 0.035, 1]],
        [0.16, -0.09, [0.96, 0.16, 0.045, 1]],
        [0, 0.15, [0.72, 0.045, 0.025, 1]],
    ];
    for (const [x, z, color] of rods) {
        appendFacetedCylinder(positions, colors, indices, x, 0, z, 0.14, 0.34, color);
    }

    const strapColor: ColorTuple = [0.055, 0.065, 0.075, 1];
    appendBox(positions, colors, indices, -0.34, -0.22, -0.25, 0.34, -0.12, 0.28, strapColor);
    appendBox(positions, colors, indices, -0.34, 0.12, -0.25, 0.34, 0.22, 0.28, strapColor);

    appendBox(positions, colors, indices, -0.22, 0.24, 0.16, 0.22, 0.48, 0.32, [0.09, 0.11, 0.13, 1]);
    appendBox(positions, colors, indices, -0.16, 0.29, 0.315, 0.16, 0.43, 0.345, [0.12, 0.85, 0.95, 1]);
    appendBox(positions, colors, indices, -0.025, 0.47, -0.025, 0.025, 0.55, 0.025, [0.95, 0.63, 0.08, 1]);
    return geometry(positions, colors, indices, new Vec3(-0.34, -0.34, -0.25), new Vec3(0.34, 0.72, 0.345));
}

function buildLowPolyLampGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendOctahedron(positions, colors, indices, 0.13, [1, 1, 1, 1]);
    return geometry(positions, colors, indices, new Vec3(-0.13, -0.13, -0.13), new Vec3(0.13, 0.13, 0.13));
}

/**
 * 炮火、定时炸弹和障碍水雷共用的立体水爆网格。
 *
 * 水冠与弧形水柱均为有厚度的低面数体块，避免交叉透明面从比赛镜头看成白色三角形。
 * 单实例为 369 顶点／432 三角形；所有几何只在玩法初始化时构建一次，触发阶段仅复用节点并修改变换。
 */
export function buildWaterExplosionGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    // 暖色爆心只负责交代“爆炸”，主体仍保持泳池水花的青蓝色。
    appendRing(positions, colors, indices, 0.16, 0.72,
        [1, 0.44, 0.06, 0.62], [1, 0.7, 0.16, 0], 0.018);
    // 两层水面波纹错开宽度，避免一整张半透明圆盘造成白块和过度填充。
    appendRing(positions, colors, indices, 0.34, 0.78,
        [0.88, 0.99, 1, 0.72], [0.28, 0.82, 0.98, 0.06], 0.028);
    appendRing(positions, colors, indices, 1.18, 2.08,
        [0.42, 0.88, 1, 0.34], [0.18, 0.68, 0.94, 0], 0.012);

    appendWaterCrown(positions, colors, indices);
    for (let i = 0; i < 9; i++) appendCurvedWaterJet(positions, colors, indices, i);
    for (let i = 0; i < 11; i++) appendWaterDroplet(positions, colors, indices, i);

    return geometry(positions, colors, indices, new Vec3(-2.15, 0, -2.15), new Vec3(2.15, 2.65, 2.15));
}

/** 以低频变换播放水爆，不改材质、不重建网格，也不产生临时对象。 */
export function applyWaterExplosionPhase(node: Node, progress: number, intensity = 1): void {
    const phase = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    const expand = 1 - Math.pow(1 - phase, 3);
    const crest = Math.sin(phase * Math.PI);
    const radial = (0.2 + expand * 1.42) * intensity;
    const vertical = (0.16 + crest * 1.5) * intensity;
    node.setScale(radial, vertical, radial);
}

function appendWaterCrown(positions: number[], colors: number[], indices: number[]): void {
    const segments = 14;
    const base = positions.length / 3;
    const heightPattern = [0.76, 1, 0.84, 1.12, 0.8, 0.94, 1.08];
    const radiusPattern = [0.92, 1.08, 0.86, 1.16, 0.96, 1.04, 0.89];
    const baseColor: ColorTuple = [0.12, 0.68, 0.91, 0.82];
    const shoulderColor: ColorTuple = [0.54, 0.91, 1, 0.72];
    const tipColor: ColorTuple = [0.96, 1, 1, 0.08];
    for (let i = 0; i <= segments; i++) {
        const wrapped = i % segments;
        const angle = wrapped / segments * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const height = heightPattern[wrapped % heightPattern.length];
        const rimRadius = 0.54 * radiusPattern[wrapped % radiusPattern.length];
        positions.push(
            cos * 0.48, 0.04, sin * 0.48,
            cos * 0.34, 0.72 * height, sin * 0.34,
            cos * rimRadius, 1.82 * height, sin * rimRadius,
        );
        pushColor(colors, baseColor, 1);
        pushColor(colors, shoulderColor, 1);
        pushColor(colors, tipColor, 1);
    }
    for (let i = 0; i < segments; i++) {
        const current = base + i * 3;
        const next = current + 3;
        indices.push(
            current, next, current + 1,
            current + 1, next, next + 1,
            current + 1, next + 1, current + 2,
            current + 2, next + 1, next + 2,
        );
    }
}

function appendCurvedWaterJet(
    positions: number[], colors: number[], indices: number[], index: number,
): void {
    const angle = (index / 9) * Math.PI * 2 + (index % 2) * 0.12;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const tx = -dz;
    const tz = dx;
    const lift = 1.05 + (index % 3) * 0.2;
    const reach = 1.24 + (index % 4) * 0.13;
    const centers: ReadonlyArray<readonly [number, number]> = [
        [0.42, 0.18],
        [0.72 + (index % 2) * 0.08, lift],
        [reach, 0.52 + (index % 3) * 0.11],
    ];
    const widths = [0.13, 0.105, 0.024];
    const depths = [0.09, 0.075, 0.018];
    const stationColors: readonly ColorTuple[] = [
        [0.08, 0.63, 0.9, 0.84],
        [0.68, 0.95, 1, 0.7],
        [0.94, 1, 1, 0.04],
    ];
    const base = positions.length / 3;
    for (let station = 0; station < centers.length; station++) {
        const [radius, y] = centers[station];
        const width = widths[station];
        const depth = depths[station];
        const cx = dx * radius;
        const cz = dz * radius;
        positions.push(
            cx + tx * width + dx * depth, y, cz + tz * width + dz * depth,
            cx - tx * width + dx * depth, y, cz - tz * width + dz * depth,
            cx - tx * width - dx * depth, y, cz - tz * width - dz * depth,
            cx + tx * width - dx * depth, y, cz + tz * width - dz * depth,
        );
        pushColor(colors, stationColors[station], 4);
    }
    for (let station = 0; station < centers.length - 1; station++) {
        const current = base + station * 4;
        const next = current + 4;
        for (let side = 0; side < 4; side++) {
            const sideNext = (side + 1) % 4;
            indices.push(current + side, next + side, current + sideNext,
                current + sideNext, next + side, next + sideNext);
        }
    }
}

function appendWaterDroplet(
    positions: number[], colors: number[], indices: number[], index: number,
): void {
    const angle = index / 11 * Math.PI * 2 + 0.2;
    const radius = 0.78 + (index % 4) * 0.22;
    const centerX = Math.cos(angle) * radius;
    const centerY = 0.62 + (index % 5) * 0.2;
    const centerZ = Math.sin(angle) * radius;
    const size = 0.055 + (index % 3) * 0.018;
    const base = positions.length / 3;
    positions.push(
        centerX + size, centerY, centerZ,
        centerX - size, centerY, centerZ,
        centerX, centerY + size * 1.35, centerZ,
        centerX, centerY - size * 1.35, centerZ,
        centerX, centerY, centerZ + size,
        centerX, centerY, centerZ - size,
    );
    pushColor(colors, [0.66, 0.94, 1, 0.68], 6);
    const faces = [0, 2, 4, 4, 2, 1, 1, 2, 5, 5, 2, 0, 4, 3, 0, 1, 3, 4, 5, 3, 1, 0, 3, 5];
    for (const face of faces) indices.push(base + face);
}

function appendOctahedron(
    positions: number[], colors: number[], indices: number[], radius: number, color: ColorTuple,
): void {
    const base = positions.length / 3;
    positions.push(
        radius, 0, 0, -radius, 0, 0, 0, radius, 0,
        0, -radius, 0, 0, 0, radius, 0, 0, -radius,
    );
    pushColor(colors, color, 6);
    const faces = [0, 2, 4, 4, 2, 1, 1, 2, 5, 5, 2, 0, 4, 3, 0, 1, 3, 4, 5, 3, 1, 0, 3, 5];
    for (const index of faces) indices.push(base + index);
}

function appendSpike(
    positions: number[], colors: number[], indices: number[],
    direction: readonly [number, number, number], color: ColorTuple,
): void {
    const [dx, dy, dz] = direction;
    const up: readonly [number, number, number] = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = dy * up[2] - dz * up[1];
    let uy = dz * up[0] - dx * up[2];
    let uz = dx * up[1] - dy * up[0];
    const ul = Math.max(0.001, Math.hypot(ux, uy, uz));
    ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const cx = dx * 0.26, cy = dy * 0.26, cz = dz * 0.26;
    const half = 0.095;
    const base = positions.length / 3;
    positions.push(
        cx + ux * half + vx * half, cy + uy * half + vy * half, cz + uz * half + vz * half,
        cx - ux * half + vx * half, cy - uy * half + vy * half, cz - uz * half + vz * half,
        cx - ux * half - vx * half, cy - uy * half - vy * half, cz - uz * half - vz * half,
        cx + ux * half - vx * half, cy + uy * half - vy * half, cz + uz * half - vz * half,
        dx * 0.57, dy * 0.57, dz * 0.57,
    );
    pushColor(colors, color, 5);
    const faces = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 3, 2, 0, 2, 1];
    for (const index of faces) indices.push(base + index);
}

function appendFacetedCylinder(
    positions: number[], colors: number[], indices: number[],
    centerX: number, centerY: number, centerZ: number, radius: number, halfHeight: number, color: ColorTuple,
): void {
    const segments = 8;
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const x = centerX + Math.cos(angle) * radius;
        const z = centerZ + Math.sin(angle) * radius;
        positions.push(x, centerY - halfHeight, z, x, centerY + halfHeight, z);
        pushColor(colors, color, 2);
    }
    const bottomCenter = positions.length / 3;
    positions.push(centerX, centerY - halfHeight, centerZ, centerX, centerY + halfHeight, centerZ);
    pushColor(colors, color, 2);
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        const lower = base + i * 2;
        const upper = lower + 1;
        const nextLower = base + next * 2;
        const nextUpper = nextLower + 1;
        indices.push(lower, upper, nextLower, nextLower, upper, nextUpper);
        indices.push(bottomCenter, lower, nextLower, bottomCenter + 1, nextUpper, upper);
    }
}

function appendBox(
    positions: number[], colors: number[], indices: number[],
    minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, color: ColorTuple,
): void {
    const base = positions.length / 3;
    positions.push(
        minX, minY, minZ, maxX, minY, minZ, maxX, maxY, minZ, minX, maxY, minZ,
        minX, minY, maxZ, maxX, minY, maxZ, maxX, maxY, maxZ, minX, maxY, maxZ,
    );
    pushColor(colors, color, 8);
    const faces = [
        0, 3, 2, 0, 2, 1,
        4, 5, 6, 4, 6, 7,
        0, 4, 7, 0, 7, 3,
        1, 2, 6, 1, 6, 5,
        0, 1, 5, 0, 5, 4,
        3, 7, 6, 3, 6, 2,
    ];
    for (const index of faces) indices.push(base + index);
}

function appendRing(
    positions: number[], colors: number[], indices: number[],
    innerRadius: number, outerRadius: number, innerColor: ColorTuple, outerColor: ColorTuple, y: number,
): void {
    const segments = 24;
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
        const a = i / segments * Math.PI * 2;
        positions.push(Math.cos(a) * innerRadius, y, Math.sin(a) * innerRadius,
            Math.cos(a) * outerRadius, y, Math.sin(a) * outerRadius);
        pushColor(colors, innerColor, 1);
        pushColor(colors, outerColor, 1);
    }
    for (let i = 0; i < segments; i++) {
        const lower = base + i * 2;
        indices.push(lower, lower + 2, lower + 1, lower + 1, lower + 2, lower + 3);
    }
}

function geometry(positions: number[], colors: number[], indices: number[], minPos: Vec3, maxPos: Vec3): primitives.IGeometry {
    return { positions, colors, indices, minPos, maxPos };
}

function pushColor(colors: number[], color: ColorTuple, count: number): void {
    for (let i = 0; i < count; i++) colors.push(color[0], color[1], color[2], color[3]);
}
