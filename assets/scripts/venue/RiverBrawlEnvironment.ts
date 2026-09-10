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
import { RIVER_BRAWL_BALANCE } from '../core/RiverBrawlBalance';
import type { RaceCourseLayout } from './RaceCourseLayout';
import type { RiverCourseFrame } from './RiverCoursePath';

const { ccclass } = _decorator;
const ROOT_NAME = 'RiverBrawlProceduralEnvironment';
const SEGMENT_LENGTH = 50;
const BANK_DEPTH = 7;
const BANK_TOP_Y = 0.18;
const BANK_BOTTOM_Y = -1.25;
const SURFACE_NODE_NAME = 'PoolWaterSurface';
const FLOOR_NODE_NAME = 'pool_floor';

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

const _frame: RiverCourseFrame = makeFrame();
const _frameNext: RiverCourseFrame = makeFrame();

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

    addQuad(
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number,
        dx: number, dy: number, dz: number,
        color: Rgb,
    ): void {
        const base = this.positions.length / 3;
        this.addVertex(ax, ay, az, color);
        this.addVertex(bx, by, bz, color);
        this.addVertex(cx, cy, cz, color);
        this.addVertex(dx, dy, dz, color);
        this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    addOrientedBox(
        x: number,
        y: number,
        z: number,
        forwardX: number,
        forwardZ: number,
        sideX: number,
        sideZ: number,
        forwardSize: number,
        height: number,
        sideSize: number,
        color: Rgb,
    ): void {
        const hf = forwardSize * 0.5;
        const hh = height * 0.5;
        const hs = sideSize * 0.5;
        const fx = forwardX * hf;
        const fz = forwardZ * hf;
        const sx = sideX * hs;
        const sz = sideZ * hs;
        const base = this.positions.length / 3;
        this.addVertex(x - fx - sx, y - hh, z - fz - sz, color);
        this.addVertex(x + fx - sx, y - hh, z + fz - sz, color);
        this.addVertex(x + fx - sx, y + hh, z + fz - sz, color);
        this.addVertex(x - fx - sx, y + hh, z - fz - sz, color);
        this.addVertex(x - fx + sx, y - hh, z - fz + sz, color);
        this.addVertex(x + fx + sx, y - hh, z + fz + sz, color);
        this.addVertex(x + fx + sx, y + hh, z + fz + sz, color);
        this.addVertex(x - fx + sx, y + hh, z - fz + sz, color);
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

class RibbonBuilder {
    readonly positions: number[] = [];
    readonly normals: number[] = [];
    readonly uvs: number[] = [];
    readonly indices: number[] = [];
    readonly minPos = new Vec3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    readonly maxPos = new Vec3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    addPair(frame: RiverCourseFrame, halfWidth: number, y: number, distance: number): void {
        this.addVertex(frame.x - frame.normalX * halfWidth, y, frame.z - frame.normalZ * halfWidth, distance, 0);
        this.addVertex(frame.x + frame.normalX * halfWidth, y, frame.z + frame.normalZ * halfWidth, distance, 1);
        const pair = this.positions.length / 6 - 1;
        if (pair > 0) {
            const base = (pair - 1) * 2;
            this.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
    }

    geometry(): primitives.IGeometry {
        return {
            positions: this.positions,
            normals: this.normals,
            uvs: this.uvs,
            indices: this.indices,
            minPos: this.minPos,
            maxPos: this.maxPos,
        };
    }

    private addVertex(x: number, y: number, z: number, distance: number, side: number): void {
        this.positions.push(x, y, z);
        this.normals.push(0, 1, 0);
        this.uvs.push(distance * 0.1, side);
        this.minPos.x = Math.min(this.minPos.x, x);
        this.minPos.y = Math.min(this.minPos.y, y);
        this.minPos.z = Math.min(this.minPos.z, z);
        this.maxPos.x = Math.max(this.maxPos.x, x);
        this.maxPos.y = Math.max(this.maxPos.y, y);
        this.maxPos.z = Math.max(this.maxPos.z, z);
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
    const startDistance = Math.min(0, (course.poolStartX - course.startX) * course.direction);
    const endDistance = Math.max(1, raceDistance) + Math.max(0, RIVER_BRAWL_BALANCE.venueEndPadding);
    replaceCourseRibbon(pool, SURFACE_NODE_NAME, course, startDistance, endDistance, course.waterY, course.poolWidth * 0.5, resources);
    replaceCourseRibbon(
        pool,
        FLOOR_NODE_NAME,
        course,
        startDistance,
        endDistance,
        floorWorldY(pool, course.swimY),
        course.poolWidth * 0.5,
        resources,
    );

    const segmentCount = Math.max(1, Math.ceil((endDistance - startDistance) / SEGMENT_LENGTH));
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
        const first = startDistance + segmentIndex * SEGMENT_LENGTH;
        const last = Math.min(endDistance, first + SEGMENT_LENGTH);
        const builder = buildSegmentGeometry(segmentIndex, segmentCount, first, last, course, raceDistance);
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

function replaceCourseRibbon(
    root: Node,
    nodeName: string,
    course: RaceCourseLayout,
    startDistance: number,
    endDistance: number,
    y: number,
    halfWidth: number,
    resources: RiverBrawlEnvironmentResources,
): void {
    const node = findNode(root, nodeName);
    const renderer = node?.getComponent(MeshRenderer);
    if (!node?.isValid || !renderer) return;
    const builder = new RibbonBuilder();
    const spacing = Math.max(1, RIVER_BRAWL_BALANCE.environmentSampleSpacing);
    const steps = Math.max(1, Math.ceil((endDistance - startDistance) / spacing));
    for (let i = 0; i <= steps; i++) {
        const distance = startDistance + (endDistance - startDistance) * i / steps;
        course.sampleCourseFrame(distance, _frame);
        builder.addPair(_frame, halfWidth, y, distance);
    }
    const mesh = utils.createMesh(builder.geometry());
    resources.meshes.push(mesh);
    node.setWorldPosition(Vec3.ZERO);
    node.setWorldRotation(Quat.IDENTITY);
    node.setWorldScale(Vec3.ONE);
    renderer.mesh = mesh;
}

function buildSegmentGeometry(
    index: number,
    segmentCount: number,
    startDistance: number,
    endDistance: number,
    course: RaceCourseLayout,
    raceDistance: number,
): GeometryBuilder {
    const builder = new GeometryBuilder();
    const riverHalfWidth = course.poolWidth * 0.5;
    const theme = themeForSegment(index, segmentCount);
    const bankColor = theme === 'cliff' ? PALETTE.cliff : (index % 2 === 0 ? PALETTE.grass : PALETTE.grassLight);
    addBankRibbons(builder, course, startDistance, endDistance, riverHalfWidth, bankColor);

    const treeCount = theme === 'forest' ? 7 : theme === 'start' ? 2 : theme === 'rock' ? 3 : 4;
    const rockCount = theme === 'rock' || theme === 'cliff' ? 7 : 2;
    const length = Math.max(0.1, endDistance - startDistance);
    for (const side of [-1, 1]) {
        for (let i = 0; i < treeCount; i++) {
            const unit = (i + 0.65 + hash01(index, i, side, 11) * 0.7) / (treeCount + 0.4);
            const distance = startDistance + unit * length;
            const lateral = side * (riverHalfWidth + 1.2 + hash01(index, i, side, 17) * 3.7);
            const point = sampleOffset(course, distance, lateral, _frame);
            const scale = 0.75 + hash01(index, i, side, 23) * 0.65;
            addTree(builder, point.x, BANK_TOP_Y, point.z, scale, (i + index) % 2 === 0);
        }
        for (let i = 0; i < rockCount; i++) {
            const unit = (i + 0.3 + hash01(index, i, side, 31) * 0.8) / (rockCount + 0.2);
            const distance = startDistance + unit * length;
            const lateral = side * (riverHalfWidth + 0.35 + hash01(index, i, side, 37) * 4.5);
            const point = sampleOffset(course, distance, lateral, _frame);
            const scale = 0.45 + hash01(index, i, side, 41) * (theme === 'cliff' ? 1.8 : 0.8);
            addRock(builder, point.x, BANK_TOP_Y, point.z, scale, (i + index) % 2 === 0);
        }
        const hillDistance = startDistance + length * (0.5 + (hash01(index, 2, side, 61) - 0.5) * 0.45);
        const hillLateral = side * (riverHalfWidth + 20 + hash01(index, 0, side, 53) * 5);
        const hill = sampleOffset(course, hillDistance, hillLateral, _frame);
        const hillScale = 4.5 + hash01(index, 1, side, 59) * 3.5;
        builder.addTaperedPrism(hill.x, -0.4, hill.z, hillScale * 1.8, hillScale * 0.15, hillScale, 6, PALETTE.hill, Math.PI / 6);
    }

    const centerDistance = (startDistance + endDistance) * 0.5;
    if (theme === 'bridge') addBridge(builder, course, centerDistance, riverHalfWidth);
    if (raceDistance >= startDistance
        && (raceDistance < endDistance || index === segmentCount - 1)) {
        addFinishLandmark(builder, course, raceDistance, riverHalfWidth);
    }
    return builder;
}

function addBankRibbons(
    builder: GeometryBuilder,
    course: RaceCourseLayout,
    startDistance: number,
    endDistance: number,
    riverHalfWidth: number,
    color: Rgb,
): void {
    const spacing = Math.max(1, RIVER_BRAWL_BALANCE.environmentSampleSpacing);
    const steps = Math.max(1, Math.ceil((endDistance - startDistance) / spacing));
    for (let i = 0; i < steps; i++) {
        const firstDistance = startDistance + (endDistance - startDistance) * i / steps;
        const nextDistance = startDistance + (endDistance - startDistance) * (i + 1) / steps;
        course.sampleCourseFrame(firstDistance, _frame);
        course.sampleCourseFrame(nextDistance, _frameNext);
        for (const side of [-1, 1]) {
            const aInnerX = _frame.x + _frame.normalX * riverHalfWidth * side;
            const aInnerZ = _frame.z + _frame.normalZ * riverHalfWidth * side;
            const aOuterX = _frame.x + _frame.normalX * (riverHalfWidth + BANK_DEPTH) * side;
            const aOuterZ = _frame.z + _frame.normalZ * (riverHalfWidth + BANK_DEPTH) * side;
            const bInnerX = _frameNext.x + _frameNext.normalX * riverHalfWidth * side;
            const bInnerZ = _frameNext.z + _frameNext.normalZ * riverHalfWidth * side;
            const bOuterX = _frameNext.x + _frameNext.normalX * (riverHalfWidth + BANK_DEPTH) * side;
            const bOuterZ = _frameNext.z + _frameNext.normalZ * (riverHalfWidth + BANK_DEPTH) * side;
            if (side > 0) {
                builder.addQuad(
                    aInnerX, BANK_TOP_Y, aInnerZ,
                    bInnerX, BANK_TOP_Y, bInnerZ,
                    bOuterX, BANK_TOP_Y, bOuterZ,
                    aOuterX, BANK_TOP_Y, aOuterZ,
                    color,
                );
                builder.addQuad(
                    aInnerX, BANK_BOTTOM_Y, aInnerZ,
                    bInnerX, BANK_BOTTOM_Y, bInnerZ,
                    bInnerX, BANK_TOP_Y, bInnerZ,
                    aInnerX, BANK_TOP_Y, aInnerZ,
                    PALETTE.dirt,
                );
            } else {
                builder.addQuad(
                    aOuterX, BANK_TOP_Y, aOuterZ,
                    bOuterX, BANK_TOP_Y, bOuterZ,
                    bInnerX, BANK_TOP_Y, bInnerZ,
                    aInnerX, BANK_TOP_Y, aInnerZ,
                    color,
                );
                builder.addQuad(
                    bInnerX, BANK_BOTTOM_Y, bInnerZ,
                    aInnerX, BANK_BOTTOM_Y, aInnerZ,
                    aInnerX, BANK_TOP_Y, aInnerZ,
                    bInnerX, BANK_TOP_Y, bInnerZ,
                    PALETTE.dirt,
                );
            }
        }
    }
}

function addTree(builder: GeometryBuilder, x: number, y: number, z: number, scale: number, light: boolean): void {
    builder.addTaperedPrism(x, y, z, 0.23 * scale, 0.2 * scale, 1.45 * scale, 6, PALETTE.trunk, Math.PI / 6);
    builder.addTaperedPrism(x, y + 1.05 * scale, z, 1.05 * scale, 0.08 * scale, 2.25 * scale, 7, light ? PALETTE.leavesLight : PALETTE.leaves, Math.PI / 7);
}

function addRock(builder: GeometryBuilder, x: number, y: number, z: number, scale: number, light: boolean): void {
    builder.addTaperedPrism(x, y - 0.05, z, 0.8 * scale, 0.48 * scale, 0.7 * scale, 6, light ? PALETTE.rockLight : PALETTE.rock, hash01(Math.floor(x), Math.floor(z), 0, 71) * Math.PI);
}

function addBridge(builder: GeometryBuilder, course: RaceCourseLayout, distance: number, riverHalfWidth: number): void {
    course.sampleCourseFrame(distance, _frame);
    const postOffset = riverHalfWidth + 0.6;
    for (const side of [-1, 1]) {
        const x = _frame.x + _frame.normalX * postOffset * side;
        const z = _frame.z + _frame.normalZ * postOffset * side;
        builder.addOrientedBox(x, 3.0, z, _frame.tangentX, _frame.tangentZ, _frame.normalX, _frame.normalZ, 1.1, 5.7, 1.1, PALETTE.bridge);
    }
    const span = (riverHalfWidth + 1.2) * 2;
    builder.addOrientedBox(_frame.x, 5.7, _frame.z, _frame.tangentX, _frame.tangentZ, _frame.normalX, _frame.normalZ, 1.4, 0.55, span, PALETTE.bridge);
    const capX = _frame.x - _frame.tangentX * 0.8;
    const capZ = _frame.z - _frame.tangentZ * 0.8;
    builder.addOrientedBox(capX, 6.45, capZ, _frame.tangentX, _frame.tangentZ, _frame.normalX, _frame.normalZ, 0.35, 1.4, span, PALETTE.finish);
}

function addFinishLandmark(builder: GeometryBuilder, course: RaceCourseLayout, distance: number, riverHalfWidth: number): void {
    course.sampleCourseFrame(distance, _frame);
    const offset = riverHalfWidth + 0.8;
    for (const side of [-1, 1]) {
        const x = _frame.x + _frame.normalX * offset * side;
        const z = _frame.z + _frame.normalZ * offset * side;
        builder.addOrientedBox(x, 2.25, z, _frame.tangentX, _frame.tangentZ, _frame.normalX, _frame.normalZ, 0.45, 4.5, 0.45, PALETTE.finish);
    }
    builder.addOrientedBox(_frame.x, 4.35, _frame.z, _frame.tangentX, _frame.tangentZ, _frame.normalX, _frame.normalZ, 0.55, 0.35, offset * 2, PALETTE.finish);
}

function sampleOffset(course: RaceCourseLayout, distance: number, lateral: number, frame: RiverCourseFrame): RiverCourseFrame {
    course.sampleCourseFrame(distance, frame);
    frame.x += frame.normalX * lateral;
    frame.z += frame.normalZ * lateral;
    return frame;
}

function themeForSegment(index: number, segmentCount: number): 'start' | 'forest' | 'rock' | 'bridge' | 'cliff' {
    if (index === 0) return 'start';
    const progress = index / Math.max(1, segmentCount - 1);
    if (progress < 0.38) return 'forest';
    if (progress < 0.58) return 'rock';
    if (progress < 0.72) return 'bridge';
    return 'cliff';
}

function floorWorldY(root: Node, swimY: number): number {
    const node = findNode(root, FLOOR_NODE_NAME);
    const renderer = node?.getComponent(MeshRenderer);
    const bounds = (renderer as unknown as { model?: { worldBounds?: { center?: Vec3; halfExtents?: Vec3 } } })
        ?.model?.worldBounds;
    if (bounds?.center && bounds?.halfExtents) {
        return bounds.center.y + bounds.halfExtents.y;
    }
    return swimY - 1.45;
}

function findNode(root: Node, name: string): Node | null {
    if (root.name.toLowerCase() === name.toLowerCase()) return root;
    for (const child of root.children) {
        const found = findNode(child, name);
        if (found) return found;
    }
    return null;
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

function makeFrame(): RiverCourseFrame {
    return { x: 0, z: 0, tangentX: 1, tangentZ: 0, normalX: 0, normalZ: 1, curvature: 0 };
}

function hash01(a: number, b: number, c: number, salt: number): number {
    const value = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + salt * 19.19) * 43758.5453;
    return value - Math.floor(value);
}

function srgbToLinear(value: number): number {
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}
