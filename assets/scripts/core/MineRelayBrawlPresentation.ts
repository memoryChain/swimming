import { Color, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { MineRelayArm } from './MineRelayBrawlController';

const PRESENTATION_INTERVAL = 1 / 20;
const EXPLOSION_SECONDS = 0.58;
const ATTACH_X = -0.28;
const ATTACH_Y = 0.48;
const ATTACH_Z = 0;

/** 单个固定低面数水雷与池化爆炸网格；水雷挂到泳者节点后无需逐帧追踪世界坐标。 */
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
        this.explosion.setScale(0.3, 0.3, 0.3);
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
            this.mineRoot.setRotationFromEuler(0, this.clock * (locked ? 190 : 75), Math.sin(this.clock * 4) * 7);
        }
        if (this.explosionRemaining > 0) {
            this.explosionRemaining = Math.max(0, this.explosionRemaining - presentationStep);
            const progress = 1 - this.explosionRemaining / EXPLOSION_SECONDS;
            const scale = 0.3 + Math.sin(Math.min(1, progress) * Math.PI * 0.78) * 1.65;
            this.explosion?.setScale(scale, 0.55 + scale * 1.2, scale);
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
        this.mineMesh = utils.createMesh(buildMineGeometry());
        this.lampMesh = utils.createMesh(buildLowPolyLampGeometry());
        this.explosionMesh = utils.createMesh(buildExplosionGeometry());
        this.mineMaterial = makeVertexMaterial('MineRelayBodyMaterial', true);
        this.explosionMaterial = makeVertexMaterial('MineRelayExplosionMaterial', false);
        this.lampMaterial = new Material();
        this.lampMaterial.initialize({ effectName: 'builtin-unlit' });
        this.lampMaterial.name = 'MineRelayLampMaterial';
        this.lampMaterial.setProperty('mainColor', new Color(255, 72, 24, 255));

        this.mineRoot = this.makeMeshNode('MineRelayMine', this.mineMesh, this.mineMaterial, this.worldRoot);
        this.lamp = this.makeMeshNode('MineRelayWarningLamp', this.lampMesh, this.lampMaterial, this.mineRoot);
        this.lamp.setPosition(0, 0.48, 0);
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

function makeVertexMaterial(name: string, opaque: boolean): Material {
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

function buildMineGeometry(): primitives.IGeometry {
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

function buildLowPolyLampGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendOctahedron(positions, colors, indices, 0.13, [1, 1, 1, 1]);
    return geometry(positions, colors, indices, new Vec3(-0.13, -0.13, -0.13), new Vec3(0.13, 0.13, 0.13));
}

function buildExplosionGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendRing(positions, colors, indices, 0.35, 1.95, [1, 0.48, 0.04, 0.58], [0.55, 0.9, 1, 0], 0.02);
    appendRibbon(positions, colors, indices, -0.65, 0, 0.65, 0, 2.7, [0.75, 0.95, 1, 0.76], [1, 0.42, 0.04, 0]);
    appendRibbon(positions, colors, indices, 0, -0.65, 0, 0.65, 2.7, [0.75, 0.95, 1, 0.76], [1, 0.42, 0.04, 0]);
    return geometry(positions, colors, indices, new Vec3(-1.95, 0, -1.95), new Vec3(1.95, 2.7, 1.95));
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

function appendRibbon(
    positions: number[], colors: number[], indices: number[],
    x0: number, z0: number, x1: number, z1: number, tipY: number,
    bottomColor: ColorTuple, topColor: ColorTuple,
): void {
    const base = positions.length / 3;
    positions.push(x0, 0, z0, x1, 0, z1, x1 * 0.12, tipY, z1 * 0.12, x0 * 0.12, tipY, z0 * 0.12);
    pushColor(colors, bottomColor, 2);
    pushColor(colors, topColor, 2);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function geometry(positions: number[], colors: number[], indices: number[], minPos: Vec3, maxPos: Vec3): primitives.IGeometry {
    return { positions, colors, indices, minPos, maxPos };
}

function pushColor(colors: number[], color: ColorTuple, count: number): void {
    for (let i = 0; i < count; i++) colors.push(color[0], color[1], color[2], color[3]);
}
