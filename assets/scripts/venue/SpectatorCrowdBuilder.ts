import { _decorator, Color, Component, Layers, Material, MeshRenderer, Node, primitives, Quat, utils, Vec3 } from 'cc';
import { scaledDelta } from '../core/TimeScale';

const { ccclass, property } = _decorator;

// Low-saturation values designed for the venue's dark grandstands. These stay
// unlit so the crowd remains legible, but their low value prevents the old
// neon/confetti look.
const SPECTATOR_COLORS = [
    color(70, 78, 98),
    color(82, 70, 91),
    color(62, 82, 84),
    color(92, 76, 68),
    color(102, 98, 92),
];

const WOBBLE_GROUP_COUNT = 3;
const LEGACY_STAND_ROW_COUNT = 7;
const FLAT_BLEACHER_ROW_COUNT = 2;
const STAND_ROW_RISE = 0.85;
const STAND_SECTION_COUNT = 6;
const STAND_AISLE_WIDTH = 1.8;
const SPECTATOR_SPACING = 0.95;
const STAND_NODE_NAMES = new Set([
    'grandstand_north',
    'grandstand_south',
    'bleacherbatch_t1_n',
    'bleacherbatch_t1_s',
    'bleacherbatch_t1_e',
    'bleacherbatch_t2_n',
    'bleacherbatch_t2_s',
    'bleacherbatch_t2_e',
]);

type StandAxis = 'x' | 'z';

type SpectatorSpec = {
    pos: Vec3;
    width: number;
    height: number;
    topWidthScale: number;
    topOffset: number;
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

type Grandstand = {
    name: string;
    bounds: SceneBounds;
    sideSign: number;
    axis: StandAxis;
    rowCount: number;
    yaw: number;
};

@ccclass('SpectatorGroupWobble')
export class SpectatorGroupWobble extends Component {
    @property public amplitude = 0.025;
    @property public sideAmplitude = 0.012;
    @property public speed = 1;
    @property public phase = 0;

    private readonly _base = new Vec3();

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
    build(root: Node, poolNode: Node, debug?: (message: string) => void) {
        root.getChildByName('SpectatorCrowd')?.destroy();
        const crowdRoot = makeWorldNode('SpectatorCrowd', root);
        try {
            const stands = collectGrandstands(poolNode);
            if (stands.length <= 0) {
                crowdRoot.active = false;
                debug?.('spectator crowd skipped: current grandstand nodes not found');
                return;
            }

            const materials = SPECTATOR_COLORS.map((value, index) => makeMaterial(`SpectatorMuted${index}`, value));
            const buckets = Array.from(
                { length: SPECTATOR_COLORS.length * WOBBLE_GROUP_COUNT },
                () => [] as SpectatorSpec[],
            );
            for (const stand of stands) {
                this.collectGrandstandSpectators(buckets, stand);
            }

            let groupCount = 0;
            let spectatorCount = 0;
            for (let i = 0; i < buckets.length; i++) {
                const colorIndex = i % SPECTATOR_COLORS.length;
                const group = addSpectatorGroup(
                    crowdRoot,
                    `SpectatorMuted${colorIndex}Motion${Math.floor(i / SPECTATOR_COLORS.length)}`,
                    materials[colorIndex],
                    buckets[i],
                    i,
                );
                if (group) {
                    groupCount += 1;
                    spectatorCount += buckets[i].length;
                }
            }

            const message = `spectator crowd built stands=${stands.length} groups=${groupCount} planes=${spectatorCount}`;
            debug?.(message);
            console.log(`[SpeedSwimming] ${message}`);
        } catch (error) {
            crowdRoot.active = false;
            throw error;
        }
    }

    private collectGrandstandSpectators(buckets: SpectatorSpec[][], stand: Grandstand) {
        const { bounds, sideSign, axis, rowCount, yaw } = stand;
        const standLength = axis === 'x'
            ? bounds.maxX - bounds.minX
            : bounds.maxZ - bounds.minZ;
        const standDepth = axis === 'x'
            ? bounds.maxZ - bounds.minZ
            : bounds.maxX - bounds.minX;
        const sectionWidth = Math.max(
            1,
            (standLength - STAND_AISLE_WIDTH * (STAND_SECTION_COUNT - 1)) / STAND_SECTION_COUNT,
        );
        const rowDepth = standDepth / rowCount;
        const innerDepth = axis === 'x'
            ? (sideSign > 0 ? bounds.minZ : bounds.maxZ)
            : (sideSign > 0 ? bounds.minX : bounds.maxX);
        let globalColumn = 0;

        for (let row = 0; row < rowCount; row++) {
            const seatY = bounds.minY + row * STAND_ROW_RISE;
            const seatDepth = innerDepth + sideSign * (row + 0.5) * rowDepth;
            for (let section = 0; section < STAND_SECTION_COUNT; section++) {
                // Horizontal stands are segmented along X; the east/west
                // stands are rotated 90 degrees and must be segmented along Z.
                // Using minX for both axes puts east-side spectators far outside
                // the venue (their Z coordinate starts around the east stand's X).
                const sectionMinLong = (axis === 'x' ? bounds.minX : bounds.minZ)
                    + section * (sectionWidth + STAND_AISLE_WIDTH);
                const columns = Math.max(4, Math.floor(sectionWidth / SPECTATOR_SPACING));
                for (let col = 0; col < columns; col++, globalColumn++) {
                    // Irregular empty pockets keep the crowd from becoming a rigid
                    // checkerboard while the six real stand aisles remain clear.
                    const pocket = random01(Math.floor(col / 3), row, section, 43) * 0.09;
                    if (random01(col, row, section + sideSign * 7, 17) < 0.13 + pocket) {
                        continue;
                    }

                    const height = 0.34 + random01(row, col, section, 31) * 0.24;
                    const width = 0.25 + random01(col, section, row, 37) * 0.24;
                    const longPosition = sectionMinLong
                        + (col + 0.5) * (sectionWidth / columns)
                        + jitter(row, col, section, 0.18);
                    const depthJitter = jitter(col, row, sideSign, rowDepth * 0.24);
                    const x = axis === 'x' ? longPosition : seatDepth + depthJitter;
                    const z = axis === 'x' ? seatDepth + depthJitter : longPosition;
                    const colorIndex = Math.floor(
                        random01(col, row, section + sideSign * 11, 53) * SPECTATOR_COLORS.length,
                    ) % SPECTATOR_COLORS.length;
                    const wobbleIndex = Math.floor(
                        random01(row, col, section, 71) * WOBBLE_GROUP_COUNT,
                    ) % WOBBLE_GROUP_COUNT;

                    buckets[wobbleIndex * SPECTATOR_COLORS.length + colorIndex].push({
                        pos: new Vec3(x, seatY + height * 0.5 + 0.025, z),
                        width,
                        height,
                        topWidthScale: 0.76 + random01(col, row, section, 79) * 0.38,
                        topOffset: jitter(section, col, row, 0.18),
                        row,
                        col: globalColumn,
                        side: sideSign,
                        // Face inward toward the pool; small per-plane yaw/roll
                        // jitter is applied again while building the mesh.
                        yaw,
                    });
                }
            }
        }
    }
}

function addSpectatorGroup(
    parent: Node,
    name: string,
    material: Material,
    spectators: SpectatorSpec[],
    groupIndex: number,
): Node | null {
    if (spectators.length <= 0) {
        return null;
    }

    const node = makeWorldNode(name, parent);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.createMesh(buildSpectatorGeometry(spectators));
    renderer.setMaterial(material, 0);

    const wobble = node.addComponent(SpectatorGroupWobble);
    const motionIndex = Math.floor(groupIndex / SPECTATOR_COLORS.length);
    wobble.amplitude = 0.035 + motionIndex * 0.014 + positiveMod(groupIndex, 3) * 0.004;
    wobble.sideAmplitude = 0.012 + motionIndex * 0.007;
    wobble.speed = 0.82 + motionIndex * 0.21 + positiveMod(groupIndex * 3, 5) * 0.035;
    wobble.phase = motionIndex * 2.05 + groupIndex * 0.37;
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
            -90 + jitter(spectator.row, spectator.col, spectator.side, 5),
            spectator.yaw + jitter(spectator.col, spectator.side, spectator.row, 12),
            jitter(spectator.side, spectator.row, spectator.col, 9),
        );
        Vec3.transformQuat(normal, Vec3.UNIT_Y, rotation);

        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, -0.5, -0.5, 0, 0);
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, 0.5, -0.5, 1, 0);
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, 0.5, 0.5, 1, 1);
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, -0.5, 0.5, 0, 1);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        // Back-facing triangles keep the flat crowd visible from every race shot.
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    return { positions, normals, uvs, indices, minPos, maxPos };
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
    const isTop = zFactor > 0;
    const widthScale = isTop ? spectator.topWidthScale : 1;
    const topOffset = isTop ? spectator.topOffset : 0;
    point.set(spectator.width * (xFactor * widthScale + topOffset), 0, spectator.height * zFactor);
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

function collectGrandstands(root: Node): Grandstand[] {
    const stands: Grandstand[] = [];
    visit(root, (node) => {
        const name = node.name.toLowerCase();
        if (!STAND_NODE_NAMES.has(name)) {
            return;
        }
        const bounds = boundsForNode(node);
        if (!bounds) {
            return;
        }
        const isNorth = name === 'grandstand_north' || name.endsWith('_n');
        const isSouth = name === 'grandstand_south' || name.endsWith('_s');
        const isEast = name.endsWith('_e');
        if (!isNorth && !isSouth && !isEast && !name.endsWith('_w')) {
            return;
        }
        const axis: StandAxis = isNorth || isSouth ? 'x' : 'z';
        const sideSign = axis === 'x'
            ? (isNorth ? 1 : -1)
            : (isEast ? 1 : -1);
        stands.push({
            name,
            bounds,
            sideSign,
            axis,
            rowCount: name.startsWith('bleacherbatch_') ? FLAT_BLEACHER_ROW_COUNT : LEGACY_STAND_ROW_COUNT,
            // The local quad is authored for a north-facing stand. Rotate it
            // around Y so every audience plane faces the pool on all four sides.
            yaw: axis === 'x'
                ? (sideSign > 0 ? 0 : 180)
                : (sideSign > 0 ? 90 : -90),
        });
    });
    return stands.sort((left, right) => left.sideSign - right.sideSign);
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

function visit(node: Node, handle: (node: Node) => void) {
    handle(node);
    for (const child of node.children) {
        visit(child, handle);
    }
}

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
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
