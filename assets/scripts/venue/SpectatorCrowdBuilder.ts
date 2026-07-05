import { _decorator, Color, Component, Layers, Material, MeshRenderer, Node, primitives, Quat, utils, Vec3 } from 'cc';
import { RaceCourseLayout } from './RaceCourseLayout';
import { PoolDefinition } from './VenueConfig';
import { scaledDelta } from '../core/TimeScale';

const { ccclass, property } = _decorator;

const SPECTATOR_COLORS = [
    color(255, 28, 78),
    color(255, 226, 24),
    color(36, 255, 92),
    color(0, 214, 255),
    color(132, 54, 255),
    color(255, 112, 0),
    color(255, 40, 221),
    color(18, 94, 255),
    color(255, 255, 255),
    color(0, 255, 196),
    color(220, 255, 0),
    color(255, 64, 28),
];

const WOBBLE_GROUP_COUNT = 4;
const SPECTATOR_DENSITY_SCALE = 0.1;
const ANGLE_JITTER_RATIO = 0.42;
const VENUE_STAND_DEPTH_JITTER = 0.36;

const BOWL_RING_SPECS = [
    { y: 1.05, xPadding: 10.0, zPadding: 4.8, columns: 48 },
    { y: 1.85, xPadding: 15.8, zPadding: 8.1, columns: 56 },
    { y: 2.75, xPadding: 22.2, zPadding: 11.7, columns: 64 },
    { y: 3.75, xPadding: 29.0, zPadding: 15.0, columns: 72 },
    { y: 4.8, xPadding: 36.2, zPadding: 18.5, columns: 80 },
];
const STAND_ROW_NAME_PARTS = ['lower_bowl_continuous_row', 'upper_bowl_continuous_row'];
const MIN_STAND_RADIUS = 2;

type SpectatorSpec = {
    pos: Vec3;
    width: number;
    height: number;
    row: number;
    col: number;
    side: number;
    yaw: number;
};

type SceneBounds = {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
};

type StandRow = {
    bounds: SceneBounds;
    row: number;
    columns: number;
};

@ccclass('SpectatorGroupWobble')
export class SpectatorGroupWobble extends Component {
    @property public amplitude = 0.025;
    @property public sideAmplitude = 0.012;
    @property public speed = 1;
    @property public phase = 0;

    private _base = new Vec3();

    start() {
        this._base.set(this.node.position);
    }

    update(dt: number) {
        this.phase += scaledDelta(dt) * this.speed;
        const lift = Math.sin(this.phase) * this.amplitude;
        const sway = Math.cos(this.phase * 0.73) * this.sideAmplitude;
        this.node.setPosition(this._base.x + sway, this._base.y + lift, this._base.z);
    }
}

export class SpectatorCrowdBuilder {
    build(root: Node, definition: PoolDefinition, courseLayout?: RaceCourseLayout, poolNode?: Node, debug?: (message: string) => void) {
        const crowdRoot = makeWorldNode('SpectatorCrowd', root);
        try {
            const materials = SPECTATOR_COLORS.map((c, i) => makeMaterial(`SpectatorColor${i}`, c));
            const buckets = Array.from({ length: SPECTATOR_COLORS.length * WOBBLE_GROUP_COUNT }, () => [] as SpectatorSpec[]);
            const poolWidth = courseLayout?.poolWidth ?? definition.laneCount * definition.laneWidth;
            const startX = courseLayout?.poolStartX ?? definition.startX;
            const finishX = courseLayout?.poolFinishX ?? definition.finishX;
            const standRows = poolNode?.isValid ? collectStandRows(poolNode) : [];
            if (standRows.length > 0) {
                this.collectVenueStandRows(buckets, standRows, startX, finishX);
            } else {
                this.collectBowlStands(buckets, startX, finishX, poolWidth);
            }
            let groupCount = 0;
            let spectatorCount = 0;
            for (let i = 0; i < buckets.length; i++) {
                const colorIndex = i % SPECTATOR_COLORS.length;
                const wobbleIndex = Math.floor(i / SPECTATOR_COLORS.length);
                const group = addSpectatorGroup(crowdRoot, `SpectatorColor${colorIndex}Wobble${wobbleIndex}`, materials[colorIndex], buckets[i], i);
                if (group) {
                    groupCount += 1;
                    spectatorCount += buckets[i].length;
                }
            }
            const message = `spectator crowd built groups=${groupCount} planes=${spectatorCount} source=${standRows.length > 0 ? 'venue-stands' : 'fallback-ellipse'} rows=${standRows.length}`;
            debug?.(message);
            console.log(`[SpeedSwimming] ${message}`);
        } catch (error) {
            crowdRoot.active = false;
            throw error;
        }
    }

    private collectVenueStandRows(buckets: SpectatorSpec[][], rows: StandRow[], startX: number, finishX: number) {
        const centerX = (startX + finishX) * 0.5;
        const centerZ = 0;
        for (const row of rows) {
            const bounds = row.bounds;
            const rowCenterX = (bounds.minX + bounds.maxX) * 0.5;
            const rowCenterZ = (bounds.minZ + bounds.maxZ) * 0.5;
            const radiusX = Math.max(MIN_STAND_RADIUS, (bounds.maxX - bounds.minX) * 0.5 * 0.9);
            const radiusZ = Math.max(MIN_STAND_RADIUS, (bounds.maxZ - bounds.minZ) * 0.5 * 0.9);
            const angleStep = Math.PI * 2 / row.columns;
            const rowPhase = random01(row.row, row.columns, 5, 97);
            for (let col = 0; col < row.columns; col++) {
                const localCrowdGap = random01(Math.floor(col / 3), row.row, row.columns, 41) * 0.08;
                if (random01(col, row.row, row.columns, 53) < 0.11 + localCrowdGap) {
                    continue;
                }
                const baseAngle = Math.PI * 2 * ((col + rowPhase) / row.columns);
                const angle = baseAngle + jitter(col, row.row, row.columns, angleStep * ANGLE_JITTER_RATIO);
                const depth = jitter(row.row, col, row.columns, VENUE_STAND_DEPTH_JITTER);
                const tangentShift = jitter(col, row.columns, row.row, 0.18);
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const x = rowCenterX + cos * (radiusX + depth) - sin * tangentShift;
                const z = rowCenterZ + sin * (radiusZ + depth) + cos * tangentShift;
                if (!insideBounds2D(x, z, bounds, 0.25)) {
                    continue;
                }
                this.addSpectator(buckets, {
                    pos: this.venueSpectatorPosition(x, bounds.maxY, z, col, row.row, row.columns),
                    widthSeed: col,
                    heightSeed: row.row,
                    colorSeed: row.row * 17,
                    row: row.row,
                    col,
                    side: row.columns,
                    yaw: radiansToDegrees(Math.atan2(x - centerX, z - centerZ)),
                });
            }
        }
    }

    private collectBowlStands(buckets: SpectatorSpec[][], startX: number, finishX: number, poolWidth: number) {
        const centerX = (startX + finishX) * 0.5;
        const centerZ = 0;
        const halfCourseLength = Math.abs(finishX - startX) * 0.5;
        const halfPoolWidth = poolWidth * 0.5;

        for (let row = 0; row < BOWL_RING_SPECS.length; row++) {
            const spec = BOWL_RING_SPECS[row];
            const radiusX = halfCourseLength + spec.xPadding;
            const radiusZ = halfPoolWidth + spec.zPadding;
            const columns = Math.max(8, Math.round(spec.columns * SPECTATOR_DENSITY_SCALE));
            const angleStep = Math.PI * 2 / columns;
            const rowPhase = random01(row, columns, 5, 97);
            for (let col = 0; col < columns; col++) {
                const localCrowdGap = random01(Math.floor(col / 3), row, columns, 41) * 0.08;
                if (random01(col, row, columns, 53) < 0.08 + localCrowdGap) {
                    continue;
                }
                const baseAngle = Math.PI * 2 * ((col + rowPhase) / columns);
                const angle = baseAngle + jitter(col, row, columns, angleStep * ANGLE_JITTER_RATIO);
                const depth = jitter(row, col, columns, 0.62);
                const tangentShift = jitter(col, columns, row, 0.22);
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const x = centerX + cos * (radiusX + depth) - sin * tangentShift;
                const z = centerZ + sin * (radiusZ + depth) + cos * tangentShift;
                this.addSpectator(buckets, {
                    pos: this.spectatorPosition(x, spec.y, z, col, row, columns),
                    widthSeed: col,
                    heightSeed: row,
                    colorSeed: row * 17,
                    row,
                    col,
                    side: columns,
                    yaw: radiansToDegrees(Math.atan2(x - centerX, z - centerZ)),
                });
            }
        }
    }

    private addSpectator(
        buckets: SpectatorSpec[][],
        options: {
            pos: Vec3;
            widthSeed: number;
            heightSeed: number;
            colorSeed: number;
            row: number;
            col: number;
            side: number;
            yaw: number;
        },
    ) {
        if (random01(options.col, options.row, options.side, 11) < 0.12) {
            return;
        }
        const colorIndex = Math.floor(random01(options.col, options.row, options.colorSeed, 23) * SPECTATOR_COLORS.length) % SPECTATOR_COLORS.length;
        const wobbleIndex = Math.floor(random01(options.row, options.col, options.side, 71) * WOBBLE_GROUP_COUNT) % WOBBLE_GROUP_COUNT;
        buckets[wobbleIndex * SPECTATOR_COLORS.length + colorIndex].push({
            pos: options.pos,
            width: 0.22 + random01(options.widthSeed, options.row, options.side, 31) * 0.27,
            height: 0.30 + random01(options.heightSeed, options.side, options.col, 37) * 0.36 + options.row * 0.01,
            row: options.row,
            col: options.col,
            side: options.side,
            yaw: options.yaw,
        });
    }

    private spectatorPosition(x: number, standTopY: number, z: number, col: number, row: number, side: number): Vec3 {
        const bodyHeight = 0.34 + random01(row, side, col, 37) * 0.24 + row * 0.018;
        return new Vec3(
            x,
            standTopY + bodyHeight * 0.5 + random01(row, col, side, 19) * 0.15,
            z,
        );
    }

    private venueSpectatorPosition(x: number, standTopY: number, z: number, col: number, row: number, side: number): Vec3 {
        const bodyHeight = 0.32 + random01(row, side, col, 37) * 0.22 + row * 0.01;
        return new Vec3(
            x,
            standTopY + bodyHeight * 0.5 + 0.02 + random01(row, col, side, 19) * 0.12,
            z,
        );
    }
}

function addSpectatorGroup(parent: Node, name: string, material: Material, spectators: SpectatorSpec[], groupIndex: number): Node | null {
    if (spectators.length <= 0) {
        return null;
    }

    const node = makeWorldNode(name, parent);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.createMesh(buildSpectatorGeometry(spectators));
    renderer.setMaterial(material, 0);

    const wobble = node.addComponent(SpectatorGroupWobble);
    const wobbleIndex = Math.floor(groupIndex / SPECTATOR_COLORS.length);
    wobble.amplitude = 0.09 + positiveMod(groupIndex, 5) * 0.018;
    wobble.sideAmplitude = 0.035 + positiveMod(groupIndex * 2, 4) * 0.014;
    wobble.speed = 1.75 + wobbleIndex * 0.33 + positiveMod(groupIndex * 7, 9) * 0.035;
    wobble.phase = wobbleIndex * 1.57 + groupIndex * 0.21;
    return node;
}

function buildSpectatorGeometry(spectators: SpectatorSpec[]): primitives.IGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const rotation = new Quat();
    const point = new Vec3();
    const normal = new Vec3();
    const minPos = new Vec3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const maxPos = new Vec3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    for (let i = 0; i < spectators.length; i++) {
        const spectator = spectators[i];
        const base = i * 4;
        Quat.fromEuler(
            rotation,
            -90 + jitter(spectator.row, spectator.col, spectator.side, 8),
            spectator.yaw + jitter(spectator.col, spectator.side, spectator.row, 28),
            jitter(spectator.side, spectator.row, spectator.col, 14),
        );
        Vec3.transformQuat(normal, Vec3.UNIT_Y, rotation);

        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, -0.5, -0.5, 0, 0);
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, 0.5, -0.5, 1, 0);
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, 0.5, 0.5, 1, 1);
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, -0.5, 0.5, 0, 1);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    return {
        positions,
        normals,
        uvs,
        indices,
        minPos,
        maxPos,
    };
}

function pushCorner(
    positions: number[],
    normals: number[],
    uvs: number[],
    point: Vec3,
    normal: Vec3,
    minPos: Vec3,
    maxPos: Vec3,
    spectator: SpectatorSpec,
    rotation: Quat,
    xFactor: number,
    zFactor: number,
    u: number,
    v: number,
) {
    point.set(spectator.width * xFactor, 0, spectator.height * zFactor);
    Vec3.transformQuat(point, point, rotation);
    point.add(spectator.pos);
    positions.push(point.x, point.y, point.z);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(u, v);
    minPos.x = Math.min(minPos.x, point.x);
    minPos.y = Math.min(minPos.y, point.y);
    minPos.z = Math.min(minPos.z, point.z);
    maxPos.x = Math.max(maxPos.x, point.x);
    maxPos.y = Math.max(maxPos.y, point.y);
    maxPos.z = Math.max(maxPos.z, point.z);
}

function makeMaterial(name: string, albedo: Color): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit' });
    material.name = name;
    material.setProperty('mainColor', albedo);
    return material;
}

function makeWorldNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.DEFAULT;
    return node;
}

function collectStandRows(root: Node): StandRow[] {
    const rows: StandRow[] = [];
    visit(root, (node) => {
        if (!matchesStandRowNode(node)) {
            return;
        }
        const bounds = boundsForNode(node);
        if (!bounds) {
            return;
        }
        const radiusX = (bounds.maxX - bounds.minX) * 0.5;
        const radiusZ = (bounds.maxZ - bounds.minZ) * 0.5;
        if (radiusX < MIN_STAND_RADIUS || radiusZ < MIN_STAND_RADIUS) {
            return;
        }
        const circumference = ellipseCircumference(radiusX, radiusZ);
        rows.push({
            bounds,
            row: rows.length,
            columns: Math.max(10, Math.min(38, Math.round((circumference / 1.35) * SPECTATOR_DENSITY_SCALE))),
        });
    });
    rows.sort((a, b) => {
        const ay = (a.bounds.minY + a.bounds.maxY) * 0.5;
        const by = (b.bounds.minY + b.bounds.maxY) * 0.5;
        if (Math.abs(ay - by) > 0.05) {
            return ay - by;
        }
        return ellipseCircumference((a.bounds.maxX - a.bounds.minX) * 0.5, (a.bounds.maxZ - a.bounds.minZ) * 0.5)
            - ellipseCircumference((b.bounds.maxX - b.bounds.minX) * 0.5, (b.bounds.maxZ - b.bounds.minZ) * 0.5);
    });
    for (let i = 0; i < rows.length; i++) {
        rows[i].row = i;
    }
    return rows;
}

function boundsForNode(node: Node): SceneBounds | null {
    let bounds: SceneBounds | null = null;
    const renderer = node.getComponent(MeshRenderer);
    const rendererBounds = renderer ? boundsForRenderer(renderer) : null;
    if (rendererBounds) {
        bounds = mergeBounds(bounds, rendererBounds);
    }
    for (const child of node.children) {
        bounds = mergeBounds(bounds, boundsForNode(child));
    }
    return bounds;
}

function boundsForRenderer(renderer: MeshRenderer): SceneBounds | null {
    const model = (renderer as unknown as { model?: { worldBounds?: unknown } }).model;
    const worldBounds = model?.worldBounds as { center?: Vec3; halfExtents?: Vec3 } | undefined;
    if (!worldBounds?.center || !worldBounds?.halfExtents) {
        return null;
    }
    const center = worldBounds.center;
    const half = worldBounds.halfExtents;
    return {
        minX: center.x - half.x,
        maxX: center.x + half.x,
        minY: center.y - half.y,
        maxY: center.y + half.y,
        minZ: center.z - half.z,
        maxZ: center.z + half.z,
    };
}

function mergeBounds(a: SceneBounds | null, b: SceneBounds | null): SceneBounds | null {
    if (!a) {
        return b;
    }
    if (!b) {
        return a;
    }
    return {
        minX: Math.min(a.minX, b.minX),
        maxX: Math.max(a.maxX, b.maxX),
        minY: Math.min(a.minY, b.minY),
        maxY: Math.max(a.maxY, b.maxY),
        minZ: Math.min(a.minZ, b.minZ),
        maxZ: Math.max(a.maxZ, b.maxZ),
    };
}

function insideBounds2D(x: number, z: number, bounds: SceneBounds, margin: number): boolean {
    return x >= bounds.minX + margin
        && x <= bounds.maxX - margin
        && z >= bounds.minZ + margin
        && z <= bounds.maxZ - margin;
}

function ellipseCircumference(radiusX: number, radiusZ: number): number {
    const a = Math.max(radiusX, radiusZ);
    const b = Math.min(radiusX, radiusZ);
    if (a <= 0 || b <= 0) {
        return 0;
    }
    const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
    return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

function matchesAnyName(name: string, parts: string[]): boolean {
    const lower = name.toLowerCase();
    return parts.some((part) => lower.includes(part));
}

function matchesStandRowNode(node: Node): boolean {
    if (matchesAnyName(node.name, STAND_ROW_NAME_PARTS)) {
        return true;
    }
    const meshName = node.getComponent(MeshRenderer)?.mesh?.name;
    return !!meshName && matchesAnyName(meshName, STAND_ROW_NAME_PARTS);
}

function visit(node: Node, handle: (node: Node) => void) {
    handle(node);
    for (const child of node.children) {
        visit(child, handle);
    }
}

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}

function radiansToDegrees(value: number): number {
    return value * 180 / Math.PI;
}

function jitter(a: number, b: number, c: number, scale: number): number {
    return (random01(a, b, c, 0) - 0.5) * scale;
}

function random01(a: number, b: number, c: number, salt: number): number {
    const seed = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + salt * 19.19) * 43758.5453;
    return seed - Math.floor(seed);
}

function positiveMod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}
