import { Color, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { MineRelayArm } from './MineRelayBrawlController';

const PRESENTATION_INTERVAL = 1 / 20;
const EXPLOSION_SECONDS = 0.58;
const TIMED_BOMB_EXPLOSION_INTENSITY = 1.25;
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
        applyWaterExplosionPhase(this.explosion, 0, TIMED_BOMB_EXPLOSION_INTENSITY);
        this.setActive(this.explosion, true);
        this.explosionRemaining = EXPLOSION_SECONDS;
    }

    update(dt: number, arm: MineRelayArm | null, carrierNode: Node | null, remainingSeconds: number, locked: boolean, racing: boolean): void {
        if (this.disposed) return;
        if (!racing) {
            this.detachMine();
            this.explosionRemaining = 0;
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
        this.advanceExplosion(presentationStep);
    }

    /** 玩法切换后只收尾已经触发的爆炸，避免复用节点停在动画中间帧。 */
    updateResidualEffects(dt: number, racing: boolean): void {
        if (this.disposed) return;
        if (!racing) {
            this.explosionRemaining = 0;
            this.setActive(this.explosion, false);
            return;
        }
        if (this.explosionRemaining <= 0) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.elapsed += step;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.elapsed;
        this.elapsed = 0;
        this.advanceExplosion(presentationStep);
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

    private advanceExplosion(step: number): void {
        if (this.explosionRemaining <= 0) return;
        this.explosionRemaining = Math.max(0, this.explosionRemaining - step);
        const progress = 1 - this.explosionRemaining / EXPLOSION_SECONDS;
        if (this.explosion) applyWaterExplosionPhase(this.explosion, progress, TIMED_BOMB_EXPLOSION_INTENSITY);
        if (this.explosionRemaining <= 0) this.setActive(this.explosion, false);
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

    appendFacetedMineBody(positions, colors, indices, 0.34);
    // 略微凸出的腰线让深色球体在比赛镜头下仍有层次，并为旋转提供稳定参照。
    appendFacetedCylinder(positions, colors, indices, 0, 0, 0, 0.365, 0.055, [0.08, 0.16, 0.18, 1]);
    const directions: ReadonlyArray<readonly [number, number, number]> = [
        [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
        [0.62, 0.58, 0.53], [-0.62, 0.58, -0.53],
        [0.60, -0.63, -0.49], [-0.60, -0.63, 0.49],
    ];
    for (const direction of directions) appendDetailedMineSpike(positions, colors, indices, direction);

    // 顶部触发器和侧面警示牌打破完全对称轮廓，轻微旋转时也能被读出来。
    appendFacetedCylinder(positions, colors, indices, 0, 0.405, 0, 0.11, 0.075, [0.13, 0.17, 0.17, 1]);
    appendFacetedCylinder(positions, colors, indices, 0, 0.515, 0, 0.052, 0.045, [0.92, 0.38, 0.055, 1]);
    appendBox(positions, colors, indices, -0.15, 0.455, -0.026, 0.15, 0.495, 0.026, [0.24, 0.29, 0.28, 1]);
    appendBox(positions, colors, indices, 0.07, -0.07, 0.305, 0.23, 0.075, 0.355, [0.72, 0.24, 0.055, 1]);
    return geometry(positions, colors, indices, new Vec3(-0.66, -0.66, -0.66), new Vec3(0.66, 0.59, 0.66));
}

export function buildTimedBombGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const rods: ReadonlyArray<readonly [number, number, ColorTuple]> = [
        [-0.16, -0.09, [0.78, 0.055, 0.028, 1]],
        [0.16, -0.09, [0.94, 0.12, 0.035, 1]],
        [0, 0.15, [0.68, 0.035, 0.02, 1]],
    ];
    for (const [x, z, color] of rods) {
        appendFacetedCylinder(positions, colors, indices, x, 0, z, 0.135, 0.315, color);
        appendFacetedCylinder(positions, colors, indices, x, -0.325, z, 0.145, 0.025, [0.20, 0.025, 0.018, 1]);
        appendFacetedCylinder(positions, colors, indices, x, 0.325, z, 0.145, 0.025, [0.31, 0.045, 0.025, 1]);
    }

    // 两道有厚度的十边形束带真正环抱炸药束，避免旧版横向方块把三根炸药压成一整坨。
    const strapColor: ColorTuple = [0.055, 0.07, 0.078, 1];
    appendFacetedBundleBand(positions, colors, indices, -0.18, 0.28, 0.335, 0.045, strapColor);
    appendFacetedBundleBand(positions, colors, indices, 0.15, 0.28, 0.335, 0.045, [0.075, 0.09, 0.098, 1]);

    // 前方计时器以炸药束正面的接触面为锚点，侧扣压进束带，避免悬浮感。
    appendBox(positions, colors, indices, -0.30, 0.205, 0.145, -0.225, 0.43, 0.285, [0.19, 0.22, 0.225, 1]);
    appendBox(positions, colors, indices, 0.225, 0.205, 0.145, 0.30, 0.43, 0.285, [0.19, 0.22, 0.225, 1]);
    appendChamferedBox(positions, colors, indices, -0.24, 0.19, 0.15, 0.24, 0.50, 0.33, 0.035,
        [0.07, 0.085, 0.095, 1]);

    // 深色显示槽、青色计时玻璃、分段读数和实体按钮，让正面在比赛镜头下仍有清晰层次。
    appendChamferedBox(positions, colors, indices, -0.18, 0.285, 0.326, 0.18, 0.445, 0.343, 0.018,
        [0.018, 0.038, 0.045, 1]);
    appendBox(positions, colors, indices, -0.145, 0.31, 0.341, 0.145, 0.418, 0.352, [0.08, 0.68, 0.78, 1]);
    appendBox(positions, colors, indices, -0.105, 0.335, 0.351, -0.065, 0.393, 0.358, [0.66, 1, 0.92, 1]);
    appendBox(positions, colors, indices, -0.02, 0.335, 0.351, 0.02, 0.393, 0.358, [0.66, 1, 0.92, 1]);
    appendBox(positions, colors, indices, 0.065, 0.335, 0.351, 0.105, 0.393, 0.358, [0.66, 1, 0.92, 1]);
    appendBox(positions, colors, indices, -0.17, 0.225, 0.329, 0.055, 0.255, 0.347, [0.92, 0.53, 0.045, 1]);
    appendBox(positions, colors, indices, 0.095, 0.215, 0.329, 0.165, 0.265, 0.354, [0.88, 0.08, 0.035, 1]);

    // 两根连续低模导线从炸药端盖进入计时器顶部，连接点均有轻微压入。
    appendFacetedCable(positions, colors, indices, [
        [-0.16, 0.34, -0.09], [-0.19, 0.41, 0.015], [-0.17, 0.46, 0.17],
    ], 0.018, [0.96, 0.57, 0.035, 1]);
    appendFacetedCable(positions, colors, indices, [
        [0.16, 0.34, -0.09], [0.20, 0.405, 0.025], [0.17, 0.455, 0.17],
    ], 0.017, [0.12, 0.15, 0.16, 1]);

    // 中央引信座与警示灯共轴，灯体由独立小网格承担闪烁，不增加炸弹主体材质。
    appendFacetedCylinder(positions, colors, indices, 0, 0.375, 0, 0.075, 0.04, [0.12, 0.15, 0.155, 1]);
    appendFacetedCylinder(positions, colors, indices, 0, 0.445, 0, 0.043, 0.035, [0.94, 0.57, 0.055, 1]);
    return geometry(positions, colors, indices, new Vec3(-0.36, -0.36, -0.25), new Vec3(0.36, 0.70, 0.365));
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

function appendFacetedMineBody(
    positions: number[], colors: number[], indices: number[], radius: number,
): void {
    const segments = 10;
    const bands = 6;
    for (let band = 0; band < bands; band++) {
        const theta0 = band / bands * Math.PI;
        const theta1 = (band + 1) / bands * Math.PI;
        const sin0 = Math.sin(theta0), cos0 = Math.cos(theta0);
        const sin1 = Math.sin(theta1), cos1 = Math.cos(theta1);
        for (let segment = 0; segment < segments; segment++) {
            const angle0 = segment / segments * Math.PI * 2;
            const angle1 = (segment + 1) / segments * Math.PI * 2;
            const x00 = Math.cos(angle0) * sin0 * radius;
            const z00 = Math.sin(angle0) * sin0 * radius;
            const x01 = Math.cos(angle1) * sin0 * radius;
            const z01 = Math.sin(angle1) * sin0 * radius;
            const x10 = Math.cos(angle0) * sin1 * radius;
            const z10 = Math.sin(angle0) * sin1 * radius;
            const x11 = Math.cos(angle1) * sin1 * radius;
            const z11 = Math.sin(angle1) * sin1 * radius;
            const shade = 0.9 + ((segment + band * 2) % 3) * 0.055;
            const color: ColorTuple = [0.055 * shade, 0.115 * shade, 0.13 * shade, 1];
            const base = positions.length / 3;
            if (band === 0) {
                positions.push(0, radius, 0, x11, cos1 * radius, z11, x10, cos1 * radius, z10);
                pushColor(colors, color, 3);
                indices.push(base, base + 1, base + 2);
            } else if (band === bands - 1) {
                positions.push(x00, cos0 * radius, z00, x01, cos0 * radius, z01, 0, -radius, 0);
                pushColor(colors, color, 3);
                indices.push(base, base + 1, base + 2);
            } else {
                positions.push(
                    x00, cos0 * radius, z00, x01, cos0 * radius, z01,
                    x10, cos1 * radius, z10, x11, cos1 * radius, z11,
                );
                pushColor(colors, color, 4);
                indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
            }
        }
    }
}

function appendDetailedMineSpike(
    positions: number[], colors: number[], indices: number[],
    direction: readonly [number, number, number],
): void {
    let [dx, dy, dz] = direction;
    const directionLength = Math.max(0.001, Math.hypot(dx, dy, dz));
    dx /= directionLength;
    dy /= directionLength;
    dz /= directionLength;
    const up: readonly [number, number, number] = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = dy * up[2] - dz * up[1];
    let uy = dz * up[0] - dx * up[2];
    let uz = dx * up[1] - dy * up[0];
    const ul = Math.max(0.001, Math.hypot(ux, uy, uz));
    ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const distances = [0.25, 0.37, 0.49];
    const widths = [0.135, 0.105, 0.068];
    const sectionColors: readonly ColorTuple[] = [
        [0.055, 0.08, 0.085, 1],
        [0.12, 0.20, 0.21, 1],
        [0.19, 0.29, 0.30, 1],
    ];
    const base = positions.length / 3;
    for (let section = 0; section < distances.length; section++) {
        const distance = distances[section];
        const half = widths[section];
        const cx = dx * distance, cy = dy * distance, cz = dz * distance;
        positions.push(
            cx + ux * half + vx * half, cy + uy * half + vy * half, cz + uz * half + vz * half,
            cx - ux * half + vx * half, cy - uy * half + vy * half, cz - uz * half + vz * half,
            cx - ux * half - vx * half, cy - uy * half - vy * half, cz - uz * half - vz * half,
            cx + ux * half - vx * half, cy + uy * half - vy * half, cz + uz * half - vz * half,
        );
        pushColor(colors, sectionColors[section], 4);
    }
    const tip = positions.length / 3;
    positions.push(dx * 0.64, dy * 0.64, dz * 0.64);
    pushColor(colors, [0.24, 0.34, 0.34, 1], 1);
    for (let section = 0; section < distances.length - 1; section++) {
        const current = base + section * 4;
        const next = current + 4;
        for (let side = 0; side < 4; side++) {
            const sideNext = (side + 1) % 4;
            indices.push(current + side, current + sideNext, next + sideNext,
                current + side, next + sideNext, next + side);
        }
    }
    const last = base + (distances.length - 1) * 4;
    for (let side = 0; side < 4; side++) {
        indices.push(last + side, last + (side + 1) % 4, tip);
    }
    indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
}

function appendFacetedBundleBand(
    positions: number[], colors: number[], indices: number[],
    centerY: number, innerRadius: number, outerRadius: number, halfHeight: number, color: ColorTuple,
): void {
    const segments = 10;
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        positions.push(
            cos * outerRadius, centerY - halfHeight, sin * outerRadius,
            cos * outerRadius, centerY + halfHeight, sin * outerRadius,
            cos * innerRadius, centerY - halfHeight, sin * innerRadius,
            cos * innerRadius, centerY + halfHeight, sin * innerRadius,
        );
        pushColor(colors, color, 4);
    }
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        const currentBase = base + i * 4;
        const nextBase = base + next * 4;
        const outerBottom = currentBase, outerTop = currentBase + 1;
        const innerBottom = currentBase + 2, innerTop = currentBase + 3;
        const nextOuterBottom = nextBase, nextOuterTop = nextBase + 1;
        const nextInnerBottom = nextBase + 2, nextInnerTop = nextBase + 3;
        indices.push(
            outerBottom, outerTop, nextOuterBottom, nextOuterBottom, outerTop, nextOuterTop,
            innerBottom, nextInnerBottom, innerTop, nextInnerBottom, nextInnerTop, innerTop,
            outerTop, innerTop, nextOuterTop, nextOuterTop, innerTop, nextInnerTop,
            outerBottom, nextOuterBottom, innerBottom, nextOuterBottom, nextInnerBottom, innerBottom,
        );
    }
}

function appendChamferedBox(
    positions: number[], colors: number[], indices: number[],
    minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
    chamfer: number, color: ColorTuple,
): void {
    const cut = Math.max(0, Math.min(chamfer, (maxX - minX) * 0.5, (maxY - minY) * 0.5));
    const outline: ReadonlyArray<readonly [number, number]> = [
        [minX + cut, minY], [maxX - cut, minY], [maxX, minY + cut], [maxX, maxY - cut],
        [maxX - cut, maxY], [minX + cut, maxY], [minX, maxY - cut], [minX, minY + cut],
    ];
    const base = positions.length / 3;
    for (const [x, y] of outline) positions.push(x, y, minZ);
    for (const [x, y] of outline) positions.push(x, y, maxZ);
    const backCenter = positions.length / 3;
    positions.push((minX + maxX) * 0.5, (minY + maxY) * 0.5, minZ);
    const frontCenter = positions.length / 3;
    positions.push((minX + maxX) * 0.5, (minY + maxY) * 0.5, maxZ);
    pushColor(colors, color, outline.length * 2 + 2);
    for (let i = 0; i < outline.length; i++) {
        const next = (i + 1) % outline.length;
        indices.push(
            base + i, base + next, base + outline.length + next,
            base + i, base + outline.length + next, base + outline.length + i,
            backCenter, base + next, base + i,
            frontCenter, base + outline.length + i, base + outline.length + next,
        );
    }
}

function appendFacetedCable(
    positions: number[], colors: number[], indices: number[],
    points: ReadonlyArray<readonly [number, number, number]>, radius: number, color: ColorTuple,
): void {
    if (points.length < 2) return;
    const segments = 6;
    const base = positions.length / 3;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
        const point = points[pointIndex];
        const previous = points[Math.max(0, pointIndex - 1)];
        const next = points[Math.min(points.length - 1, pointIndex + 1)];
        let tx = next[0] - previous[0], ty = next[1] - previous[1], tz = next[2] - previous[2];
        const tangentLength = Math.max(0.0001, Math.hypot(tx, ty, tz));
        tx /= tangentLength; ty /= tangentLength; tz /= tangentLength;
        const referenceX = Math.abs(ty) > 0.9 ? 1 : 0;
        const referenceY = Math.abs(ty) > 0.9 ? 0 : 1;
        let ux = ty * 0 - tz * referenceY;
        let uy = tz * referenceX - tx * 0;
        let uz = tx * referenceY - ty * referenceX;
        const sideLength = Math.max(0.0001, Math.hypot(ux, uy, uz));
        ux /= sideLength; uy /= sideLength; uz /= sideLength;
        const vx = ty * uz - tz * uy;
        const vy = tz * ux - tx * uz;
        const vz = tx * uy - ty * ux;
        for (let segment = 0; segment < segments; segment++) {
            const angle = segment / segments * Math.PI * 2;
            const cos = Math.cos(angle) * radius, sin = Math.sin(angle) * radius;
            positions.push(
                point[0] + ux * cos + vx * sin,
                point[1] + uy * cos + vy * sin,
                point[2] + uz * cos + vz * sin,
            );
            pushColor(colors, color, 1);
        }
    }
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) {
        const current = base + pointIndex * segments;
        const next = current + segments;
        for (let segment = 0; segment < segments; segment++) {
            const sideNext = (segment + 1) % segments;
            indices.push(current + segment, next + segment, current + sideNext,
                current + sideNext, next + segment, next + sideNext);
        }
    }
    const firstCenter = positions.length / 3;
    positions.push(points[0][0], points[0][1], points[0][2]);
    const lastCenter = positions.length / 3;
    const lastPoint = points[points.length - 1];
    positions.push(lastPoint[0], lastPoint[1], lastPoint[2]);
    pushColor(colors, color, 2);
    const lastRing = base + (points.length - 1) * segments;
    for (let segment = 0; segment < segments; segment++) {
        const next = (segment + 1) % segments;
        indices.push(firstCenter, base + next, base + segment,
            lastCenter, lastRing + segment, lastRing + next);
    }
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
