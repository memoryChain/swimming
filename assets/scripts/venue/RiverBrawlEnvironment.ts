import {
    _decorator,
    Color,
    Component,
    gfx,
    Layers,
    Material,
    Mesh,
    MeshRenderer,
    Node,
    primitives,
    Quat,
    utils,
    Vec3,
} from 'cc';
import type { RaceCourseLayout } from './RaceCourseLayout';

const { ccclass } = _decorator;
const ROOT_NAME = 'RiverBrawlProceduralEnvironment';
const SEGMENT_LENGTH = 50;
// The old fall-off rule left a visible void between water and scenery. Banks now
// begin exactly at the analytic river boundary so a clamped body appears to meet
// land instead of hovering beside it.
const BANK_GAP = 0;
const BANK_DEPTH = 7;
const BANK_TOP_Y = 0.18;

type Rgb = readonly [number, number, number];

const PALETTE = {
    grass: [78, 132, 72] as Rgb,
    grassLight: [104, 158, 79] as Rgb,
    dirt: [112, 82, 53] as Rgb,
    trunk: [93, 59, 35] as Rgb,
    leaves: [48, 111, 60] as Rgb,
    leavesLight: [75, 142, 71] as Rgb,
    rock: [105, 113, 115] as Rgb,
    rockLight: [139, 145, 139] as Rgb,
    cliff: [102, 91, 74] as Rgb,
    hill: [74, 104, 93] as Rgb,
    bridge: [115, 70, 39] as Rgb,
    finish: [245, 204, 72] as Rgb,
};

@ccclass('RiverBrawlEnvironmentResources')
class RiverBrawlEnvironmentResources extends Component {
    material: Material | null = null;
    readonly meshes: Mesh[] = [];

    onDestroy(): void {
        for (const mesh of this.meshes) {
            if (mesh?.isValid) mesh.destroy();
        }
        this.meshes.length = 0;
        this.material?.destroy();
        this.material = null;
    }
}

class GeometryBuilder {
    readonly positions: number[] = [];
    readonly colors: number[] = [];
    readonly indices: number[] = [];
    readonly minPos = new Vec3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    readonly maxPos = new Vec3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    addBox(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Rgb): void {
        const hx = sx * 0.5;
        const hy = sy * 0.5;
        const hz = sz * 0.5;
        const base = this.positions.length / 3;
        this.addVertex(x - hx, y - hy, z - hz, color);
        this.addVertex(x + hx, y - hy, z - hz, color);
        this.addVertex(x + hx, y + hy, z - hz, color);
        this.addVertex(x - hx, y + hy, z - hz, color);
        this.addVertex(x - hx, y - hy, z + hz, color);
        this.addVertex(x + hx, y - hy, z + hz, color);
        this.addVertex(x + hx, y + hy, z + hz, color);
        this.addVertex(x - hx, y + hy, z + hz, color);
        this.addIndices(base, [
            0, 2, 1, 0, 3, 2,
            4, 5, 6, 4, 6, 7,
            0, 1, 5, 0, 5, 4,
            3, 7, 6, 3, 6, 2,
            0, 4, 7, 0, 7, 3,
            1, 2, 6, 1, 6, 5,
        ]);
    }

    addTaperedPrism(
        x: number,
        baseY: number,
        z: number,
        baseRadius: number,
        topRadius: number,
        height: number,
        sides: number,
        color: Rgb,
        phase = 0,
    ): void {
        const count = Math.max(3, Math.floor(sides));
        const base = this.positions.length / 3;
        for (let i = 0; i < count; i++) {
            const angle = phase + i * Math.PI * 2 / count;
            this.addVertex(x + Math.cos(angle) * baseRadius, baseY, z + Math.sin(angle) * baseRadius, color);
            this.addVertex(x + Math.cos(angle) * topRadius, baseY + height, z + Math.sin(angle) * topRadius, color);
        }
        const bottomCenter = this.positions.length / 3;
        this.addVertex(x, baseY, z, color);
        const topCenter = this.positions.length / 3;
        this.addVertex(x, baseY + height, z, color);
        for (let i = 0; i < count; i++) {
            const next = (i + 1) % count;
            const b0 = base + i * 2;
            const t0 = b0 + 1;
            const b1 = base + next * 2;
            const t1 = b1 + 1;
            this.indices.push(b0, t1, b1, b0, t0, t1);
            this.indices.push(bottomCenter, b1, b0);
            this.indices.push(topCenter, t0, t1);
        }
    }

    geometry(): primitives.IGeometry {
        return {
            positions: this.positions,
            colors: this.colors,
            indices: this.indices,
            minPos: this.minPos,
            maxPos: this.maxPos,
        };
    }

    private addVertex(x: number, y: number, z: number, color: Rgb): void {
        this.positions.push(x, y, z);
        this.colors.push(
            srgbToLinear(color[0] / 255),
            srgbToLinear(color[1] / 255),
            srgbToLinear(color[2] / 255),
            1,
        );
        this.minPos.x = Math.min(this.minPos.x, x);
        this.minPos.y = Math.min(this.minPos.y, y);
        this.minPos.z = Math.min(this.minPos.z, z);
        this.maxPos.x = Math.max(this.maxPos.x, x);
        this.maxPos.y = Math.max(this.maxPos.y, y);
        this.maxPos.z = Math.max(this.maxPos.z, z);
    }

    private addIndices(base: number, local: readonly number[]): void {
        for (const index of local) this.indices.push(base + index);
    }
}

export function buildRiverBrawlEnvironment(pool: Node, course: RaceCourseLayout, raceDistance: number): void {
    if (!pool?.isValid || pool.getChildByName(ROOT_NAME)) return;
    const root = new Node(ROOT_NAME);
    root.setParent(pool);
    root.layer = Layers.Enum.DEFAULT;
    root.setWorldPosition(Vec3.ZERO);
    root.setWorldRotation(Quat.IDENTITY);
    root.setWorldScale(Vec3.ONE);

    const resources = root.addComponent(RiverBrawlEnvironmentResources);
    resources.material = makeEnvironmentMaterial();
    const segmentCount = Math.max(1, Math.ceil(Math.max(1, raceDistance) / SEGMENT_LENGTH));
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
        const startDistance = segmentIndex * SEGMENT_LENGTH;
        const endDistance = Math.min(raceDistance, startDistance + SEGMENT_LENGTH);
        const firstX = course.distanceToWorldX(startDistance);
        const lastX = course.distanceToWorldX(endDistance);
        const minX = Math.min(firstX, lastX);
        const maxX = Math.max(firstX, lastX);
        const builder = buildSegmentGeometry(segmentIndex, segmentCount, minX, maxX, course.poolWidth * 0.5);
        const node = new Node(`RiverEnvironmentSegment_${segmentIndex + 1}`);
        node.setParent(root);
        node.layer = Layers.Enum.DEFAULT;
        const renderer = node.addComponent(MeshRenderer);
        const mesh = utils.createMesh(builder.geometry());
        resources.meshes.push(mesh);
        renderer.mesh = mesh;
        renderer.setMaterial(resources.material, 0);
    }
}

function buildSegmentGeometry(index: number, segmentCount: number, minX: number, maxX: number, riverHalfWidth: number): GeometryBuilder {
    const builder = new GeometryBuilder();
    const length = Math.max(0.1, maxX - minX);
    const centerX = (minX + maxX) * 0.5;
    const innerBank = riverHalfWidth + BANK_GAP;
    const bankCenter = innerBank + BANK_DEPTH * 0.5;
    const theme = themeForSegment(index, segmentCount);
    const bankColor = theme === 'cliff' ? PALETTE.cliff : (index % 2 === 0 ? PALETTE.grass : PALETTE.grassLight);

    builder.addBox(centerX, BANK_TOP_Y - 0.55, bankCenter, length + 0.4, 1.1, BANK_DEPTH, bankColor);
    builder.addBox(centerX, BANK_TOP_Y - 0.55, -bankCenter, length + 0.4, 1.1, BANK_DEPTH, bankColor);

    const treeCount = theme === 'forest' ? 7 : theme === 'start' ? 2 : theme === 'rock' ? 3 : 4;
    const rockCount = theme === 'rock' || theme === 'cliff' ? 7 : 2;
    for (const side of [-1, 1]) {
        for (let i = 0; i < treeCount; i++) {
            const unit = (i + 0.65 + hash01(index, i, side, 11) * 0.7) / (treeCount + 0.4);
            const x = minX + unit * length;
            const z = side * (innerBank + 1.2 + hash01(index, i, side, 17) * 3.7);
            const scale = 0.75 + hash01(index, i, side, 23) * 0.65;
            addTree(builder, x, BANK_TOP_Y, z, scale, (i + index) % 2 === 0);
        }
        for (let i = 0; i < rockCount; i++) {
            const unit = (i + 0.3 + hash01(index, i, side, 31) * 0.8) / (rockCount + 0.2);
            const x = minX + unit * length;
            const z = side * (innerBank + 0.35 + hash01(index, i, side, 37) * 4.5);
            const scale = 0.45 + hash01(index, i, side, 41) * (theme === 'cliff' ? 1.8 : 0.8);
            addRock(builder, x, BANK_TOP_Y, z, scale, (i + index) % 2 === 0);
        }
        const hillZ = side * (riverHalfWidth + 20 + hash01(index, 0, side, 53) * 5);
        const hillScale = 4.5 + hash01(index, 1, side, 59) * 3.5;
        builder.addTaperedPrism(
            centerX + (hash01(index, 2, side, 61) - 0.5) * length * 0.45,
            -0.4,
            hillZ,
            hillScale * 1.8,
            hillScale * 0.15,
            hillScale,
            6,
            PALETTE.hill,
            Math.PI / 6,
        );
    }

    if (theme === 'bridge') addBridge(builder, centerX, riverHalfWidth);
    if (index === segmentCount - 1) addFinishLandmark(builder, maxX - Math.min(8, length * 0.2), riverHalfWidth);
    return builder;
}

function addTree(builder: GeometryBuilder, x: number, y: number, z: number, scale: number, light: boolean): void {
    builder.addTaperedPrism(x, y, z, 0.23 * scale, 0.2 * scale, 1.45 * scale, 6, PALETTE.trunk, Math.PI / 6);
    builder.addTaperedPrism(
        x,
        y + 1.05 * scale,
        z,
        1.05 * scale,
        0.08 * scale,
        2.25 * scale,
        7,
        light ? PALETTE.leavesLight : PALETTE.leaves,
        Math.PI / 7,
    );
}

function addRock(builder: GeometryBuilder, x: number, y: number, z: number, scale: number, light: boolean): void {
    builder.addTaperedPrism(
        x,
        y - 0.05,
        z,
        0.8 * scale,
        0.48 * scale,
        0.7 * scale,
        6,
        light ? PALETTE.rockLight : PALETTE.rock,
        hash01(Math.floor(x), Math.floor(z), 0, 71) * Math.PI,
    );
}

function addBridge(builder: GeometryBuilder, x: number, riverHalfWidth: number): void {
    const span = (riverHalfWidth + BANK_GAP + 1.2) * 2;
    const postZ = riverHalfWidth + BANK_GAP + 0.6;
    builder.addBox(x, 3.0, postZ, 1.1, 5.7, 1.1, PALETTE.bridge);
    builder.addBox(x, 3.0, -postZ, 1.1, 5.7, 1.1, PALETTE.bridge);
    builder.addBox(x, 5.7, 0, 1.4, 0.55, span, PALETTE.bridge);
    builder.addBox(x - 0.8, 6.45, 0, 0.35, 1.4, span, PALETTE.finish);
}

function addFinishLandmark(builder: GeometryBuilder, x: number, riverHalfWidth: number): void {
    const z = riverHalfWidth + BANK_GAP + 0.8;
    builder.addBox(x, 2.25, z, 0.45, 4.5, 0.45, PALETTE.finish);
    builder.addBox(x, 2.25, -z, 0.45, 4.5, 0.45, PALETTE.finish);
    builder.addBox(x, 4.35, 0, 0.55, 0.35, z * 2, PALETTE.finish);
}

function themeForSegment(index: number, segmentCount: number): 'start' | 'forest' | 'rock' | 'bridge' | 'cliff' {
    if (index === 0) return 'start';
    const progress = index / Math.max(1, segmentCount - 1);
    if (progress < 0.38) return 'forest';
    if (progress < 0.58) return 'rock';
    if (progress < 0.72) return 'bridge';
    return 'cliff';
}

function makeEnvironmentMaterial(): Material {
    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        defines: { USE_VERTEX_COLOR: true },
        states: {
            rasterizerState: { cullMode: gfx.CullMode.BACK },
            depthStencilState: { depthTest: true, depthWrite: true },
        },
    });
    material.name = 'RiverBrawlEnvironmentVertexColor';
    material.setProperty('mainColor', Color.WHITE);
    return material;
}

function hash01(a: number, b: number, c: number, salt: number): number {
    const value = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + salt * 19.19) * 43758.5453;
    return value - Math.floor(value);
}

function srgbToLinear(value: number): number {
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}
