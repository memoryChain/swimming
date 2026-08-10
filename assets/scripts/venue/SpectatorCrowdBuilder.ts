import { _decorator, Color, Component, Layers, Material, MeshRenderer, Node, primitives, Quat, utils, Vec3 } from 'cc';
import { scaledDelta } from '../core/TimeScale';
import { SpectatorCameraFlashEmitter } from './SpectatorCameraFlashEmitter';

const { ccclass, property } = _decorator;

// Clothing stays muted so the unlit pool remains the focal area. Higher tiers
// are progressively darkened per-vertex (see TIER_BRIGHTNESS) so the stands read
// with depth without turning neon/confetti.
const SPECTATOR_COLORS = [
    color(150, 162, 190),
    color(178, 150, 172),
    color(140, 180, 172),
    color(196, 168, 140),
    color(200, 198, 190),
];

// Per-tier brightness multiplier baked into spectator vertex colors. The
// poolside tier remains readable but dim; each higher tier falls deeper into the
// same dark environment as the stands and walls.
const TIER_BRIGHTNESS = [0.52, 0.34, 0.22, 0.14];

const WOBBLE_GROUP_COUNT = 3;
const LEGACY_STAND_ROW_COUNT = 7;
const FLAT_BLEACHER_ROW_COUNT = 2;
// The flat bleacher module's two seat treads sit ~0.6 and ~1.3 above the tier
// base. Lifting the crowd onto those surfaces (instead of the tier floor) keeps
// the vertical planes off the seat faces, which otherwise z-fight head-on.
const SEAT_SURFACE_LIFT = 0.6;
const STAND_ROW_RISE = 0.72;
// Pull the audience cards slightly toward the pool, in front of the moulded
// seat backs. The rebuilt chairs are deeper than the old flat seats and would
// otherwise occlude most of each card from the race camera.
const SPECTATOR_SEAT_FORWARD_OFFSET = 0.22;
const STAND_SECTION_COUNT = 6;
const STAND_AISLE_WIDTH = 1.8;
const SPECTATOR_SPACING = 0.95;
const FLASH_CANDIDATE_RATE = 0.22;
const MAX_FLASH_CANDIDATES = 320;
// The rebuilt grandstands have a shared access core at their longitudinal
// centre. Keep spectator planes out of the full stair/door/platform opening on
// every tier. North/south use the 12 m core; the shorter east stand uses 6 m.
// The small padding also keeps each plane's half-width clear of the side walls.
const LONG_STAND_ACCESS_HALF_WIDTH = 6.35;
const SHORT_STAND_ACCESS_HALF_WIDTH = 3.25;
const STAND_NODE_NAMES = new Set([
    'grandstand_north',
    'grandstand_south',
    'bleacherbatch_t1_n',
    'bleacherbatch_t1_s',
    'bleacherbatch_t1_e',
    'bleacherbatch_t2_n',
    'bleacherbatch_t2_s',
    'bleacherbatch_t2_e',
    'bleacherbatch_t3_n',
    'bleacherbatch_t3_s',
    'bleacherbatch_t3_e',
    'bleacherbatch_t4_n',
    'bleacherbatch_t4_s',
    'bleacherbatch_t4_e',
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
    brightness: number;
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
    tier: number;
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
    build(root: Node, poolNode: Node, debug?: (message: string) => void): SpectatorCameraFlashEmitter | null {
        root.getChildByName('SpectatorCrowd')?.destroy();
        const crowdRoot = makeWorldNode('SpectatorCrowd', root);
        let flashEmitter: SpectatorCameraFlashEmitter | null = null;
        try {
            const stands = collectGrandstands(poolNode);
            if (stands.length <= 0) {
                crowdRoot.active = false;
                debug?.('spectator crowd skipped: current grandstand nodes not found');
                return null;
            }

            const materials = SPECTATOR_COLORS.map((value, index) => makeMaterial(`SpectatorMuted${index}`, value));
            const buckets = Array.from(
                { length: SPECTATOR_COLORS.length * WOBBLE_GROUP_COUNT },
                () => [] as SpectatorSpec[],
            );
            for (const stand of stands) {
                this.collectGrandstandSpectators(buckets, stand);
            }
            this.collectCornerSpectators(buckets, stands, collectCornerAnchors(poolNode));

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

            let flashSiteCount = 0;
            try {
                const flashPositions = buildCameraFlashPositions(buckets);
                flashSiteCount = Math.floor(flashPositions.length / 3);
                if (flashSiteCount > 0) {
                    flashEmitter = crowdRoot.addComponent(SpectatorCameraFlashEmitter);
                    flashEmitter.configure(flashPositions);
                }
            } catch (error) {
                console.warn('[SpeedSwimming] spectator camera flashes skipped', error);
            }

            const message = `spectator crowd built stands=${stands.length} groups=${groupCount} planes=${spectatorCount} flashSites=${flashSiteCount}`;
            debug?.(message);
            console.log(`[SpeedSwimming] ${message}`);
            return flashEmitter;
        } catch (error) {
            crowdRoot.active = false;
            throw error;
        }
    }

    private collectGrandstandSpectators(buckets: SpectatorSpec[][], stand: Grandstand) {
        const { name, bounds, sideSign, axis, rowCount, yaw, tier } = stand;
        const brightness = tierBrightness(tier);
        const standLength = axis === 'x'
            ? bounds.maxX - bounds.minX
            : bounds.maxZ - bounds.minZ;
        const standDepth = axis === 'x'
            ? bounds.maxZ - bounds.minZ
            : bounds.maxX - bounds.minX;
        // Short stands (e.g. the east end) waste too much length on the fixed
        // six aisles and end up sparse; scale the section count with length.
        const sectionCount = Math.max(2, Math.min(STAND_SECTION_COUNT, Math.round(standLength / 12)));
        const sectionWidth = Math.max(
            1,
            (standLength - STAND_AISLE_WIDTH * (sectionCount - 1)) / sectionCount,
        );
        const standCenterLong = axis === 'x'
            ? (bounds.minX + bounds.maxX) * 0.5
            : (bounds.minZ + bounds.maxZ) * 0.5;
        const accessHalfWidth = name.startsWith('bleacherbatch_')
            ? (axis === 'x' ? LONG_STAND_ACCESS_HALF_WIDTH : SHORT_STAND_ACCESS_HALF_WIDTH)
            : 0;
        const rowDepth = standDepth / rowCount;
        // Pool-facing front edge + direction toward the back, derived from the
        // stand's real position. Row 0 (low) must land at the pool-facing front
        // and rake back/up. The old sideSign+minZ convention used the FAR edge on
        // north/south, which inverted the raking and (after the lift) made the
        // high back row protrude over the pool.
        let frontEdge: number;
        let backDir: number;
        if (axis === 'x') {
            frontEdge = Math.abs(bounds.minZ) <= Math.abs(bounds.maxZ) ? bounds.minZ : bounds.maxZ;
            backDir = Math.sign((bounds.minZ + bounds.maxZ) * 0.5) || 1;
        } else {
            const poolCenterX = 25;
            frontEdge = Math.abs(bounds.minX - poolCenterX) <= Math.abs(bounds.maxX - poolCenterX)
                ? bounds.minX
                : bounds.maxX;
            backDir = Math.sign((bounds.minX + bounds.maxX) * 0.5 - poolCenterX) || 1;
        }
        let globalColumn = 0;

        for (let row = 0; row < rowCount; row++) {
            const seatY = bounds.minY + SEAT_SURFACE_LIFT + row * STAND_ROW_RISE;
            const seatDepth = frontEdge + backDir * (row + 0.5) * rowDepth;
            const visibleSeatDepth = seatDepth - backDir * SPECTATOR_SEAT_FORWARD_OFFSET;
            for (let section = 0; section < sectionCount; section++) {
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
                    if (accessHalfWidth > 0 && Math.abs(longPosition - standCenterLong) < accessHalfWidth) {
                        continue;
                    }
                    const depthJitter = jitter(col, row, sideSign, rowDepth * 0.24);
                    const x = axis === 'x' ? longPosition : visibleSeatDepth + depthJitter;
                    const z = axis === 'x' ? visibleSeatDepth + depthJitter : longPosition;
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
                        brightness,
                    });
                }
            }
        }
    }

    private collectCornerSpectators(
        buckets: SpectatorSpec[][],
        stands: Grandstand[],
        anchors: Map<string, Vec3>,
    ) {
        // Per-tier base height comes from the live tier nodes; the horizontal
        // seating frame comes from anchor empties baked into the venue, so the
        // corner crowd lands exactly on the diagonal corner seats regardless of
        // the glTF axis mapping.
        const tierBaseY: Record<number, number> = {};
        for (const stand of stands) {
            if (stand.name.endsWith('_n')) {
                tierBaseY[stand.tier] = stand.bounds.minY;
            }
        }
        const tiers = [1, 2, 3, 4].filter((tier) => tierBaseY[tier] !== undefined);
        if (tiers.length <= 0) {
            return;
        }

        const sides: Array<{ key: string; salt: number }> = [
            { key: 'ne', salt: 0 },
            { key: 'se', salt: 97 },
        ];
        for (const side of sides) {
            const origin = anchors.get(`spectator_corner_${side.key}_o`);
            const alongEnd = anchors.get(`spectator_corner_${side.key}_u`);
            const depthEnd = anchors.get(`spectator_corner_${side.key}_v`);
            if (!origin || !alongEnd || !depthEnd) {
                continue;
            }
            const length = Math.hypot(alongEnd.x - origin.x, alongEnd.z - origin.z);
            const depth = Math.hypot(depthEnd.x - origin.x, depthEnd.z - origin.z);
            if (length < 0.1 || depth < 0.1) {
                continue;
            }
            const longUx = (alongEnd.x - origin.x) / length;
            const longUz = (alongEnd.z - origin.z) / length;
            const depthUx = (depthEnd.x - origin.x) / depth;
            const depthUz = (depthEnd.z - origin.z) / depth;
            // Face inward toward the pool (facing = -depth axis).
            const yaw = Math.atan2(depthUx, depthUz) * 180 / Math.PI;
            const columns = Math.max(5, Math.floor(length / SPECTATOR_SPACING));
            const salt = side.salt;
            for (const tier of tiers) {
                const brightness = tierBrightness(tier);
                const baseY = tierBaseY[tier];
                for (let row = 0; row < FLAT_BLEACHER_ROW_COUNT; row++) {
                    const seatY = baseY + SEAT_SURFACE_LIFT + row * STAND_ROW_RISE;
                    const rowDepth = ((row + 0.5) / FLAT_BLEACHER_ROW_COUNT) * depth;
                    for (let col = 0; col < columns; col++) {
                        if (random01(col, row, tier + salt, 29) < 0.15) {
                            continue;
                        }
                        const along = ((col + 0.5) / columns) * length
                            + jitter(row, col, tier + salt, 0.18);
                        const dp = rowDepth - SPECTATOR_SEAT_FORWARD_OFFSET
                            + jitter(col, row, tier + salt, depth * 0.12);
                        const x = origin.x + longUx * along + depthUx * dp;
                        const z = origin.z + longUz * along + depthUz * dp;
                        const height = 0.34 + random01(row, col, tier + salt, 31) * 0.24;
                        const width = 0.25 + random01(col, tier, row + salt, 37) * 0.24;
                        const colorIndex = Math.floor(
                            random01(col, row, tier + salt + 11, 53) * SPECTATOR_COLORS.length,
                        ) % SPECTATOR_COLORS.length;
                        const wobbleIndex = Math.floor(
                            random01(row, col, tier + salt, 71) * WOBBLE_GROUP_COUNT,
                        ) % WOBBLE_GROUP_COUNT;
                        buckets[wobbleIndex * SPECTATOR_COLORS.length + colorIndex].push({
                            pos: new Vec3(x, seatY + height * 0.5 + 0.025, z),
                            width,
                            height,
                            topWidthScale: 0.76 + random01(col, row, tier + salt, 79) * 0.38,
                            topOffset: jitter(tier, col, row + salt, 0.18),
                            row,
                            col,
                            side: 1,
                            yaw,
                            brightness,
                        });
                    }
                }
            }
        }
    }
}

function buildCameraFlashPositions(buckets: SpectatorSpec[][]): Float32Array {
    const selected: number[] = [];
    for (const bucket of buckets) {
        for (const spectator of bucket) {
            const positionSalt = Math.round((spectator.pos.x + spectator.pos.z) * 10);
            if (random01(spectator.row, spectator.col, positionSalt, 113) >= FLASH_CANDIDATE_RATE) {
                continue;
            }
            selected.push(
                spectator.pos.x,
                spectator.pos.y + spectator.height * 0.12,
                spectator.pos.z,
            );
        }
    }
    const selectedCount = Math.floor(selected.length / 3);
    if (selectedCount <= MAX_FLASH_CANDIDATES) {
        return new Float32Array(selected);
    }
    const positions = new Float32Array(MAX_FLASH_CANDIDATES * 3);
    const stride = selectedCount / MAX_FLASH_CANDIDATES;
    for (let index = 0; index < MAX_FLASH_CANDIDATES; index++) {
        const source = Math.min(selectedCount - 1, Math.floor((index + 0.5) * stride)) * 3;
        const target = index * 3;
        positions[target] = selected[source];
        positions[target + 1] = selected[source + 1];
        positions[target + 2] = selected[source + 2];
    }
    return positions;
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
    const colors: number[] = [];
    const indices: number[] = [];
    const rotation = new Quat();
    const point = new Vec3();
    const normal = new Vec3();
    const minPos = new Vec3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const maxPos = new Vec3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    for (let i = 0; i < spectators.length; i++) {
        const spectator = spectators[i];
        const base = i * 6;
        Quat.fromEuler(
            rotation,
            -90 + jitter(spectator.row, spectator.col, spectator.side, 5),
            spectator.yaw + jitter(spectator.col, spectator.side, spectator.row, 12),
            jitter(spectator.side, spectator.row, spectator.col, 9),
        );
        Vec3.transformQuat(normal, Vec3.UNIT_Y, rotation);

        // Six hard-edged points read as an oval/capsule at venue distance while
        // avoiding alpha overdraw, textures, extra materials, or extra draw calls.
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, -0.28, -0.5, 0.22, 0);
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, 0.28, -0.5, 0.78, 0);
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, 0.5, 0, 1, 0.5);
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, 0.28, 0.5, 0.78, 1);
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, -0.28, 0.5, 0.22, 1);
        pushCorner(positions, normals, uvs, point, normal, minPos, maxPos, spectator, rotation, -0.5, 0, 0, 0.5);
        const b = spectator.brightness;
        for (let vertex = 0; vertex < 6; vertex++) {
            colors.push(b, b, b, 1);
        }
        indices.push(
            base, base + 1, base + 2,
            base, base + 2, base + 3,
            base, base + 3, base + 4,
            base, base + 4, base + 5,
        );
        // Back-facing triangles keep the flat crowd visible from every race shot.
        indices.push(
            base, base + 2, base + 1,
            base, base + 3, base + 2,
            base, base + 4, base + 3,
            base, base + 5, base + 4,
        );
    }

    return { positions, normals, uvs, colors, indices, minPos, maxPos };
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
        const tierMatch = /_t(\d)_/.exec(name);
        const tier = tierMatch ? parseInt(tierMatch[1], 10) : 1;
        stands.push({
            name,
            bounds,
            sideSign,
            axis,
            rowCount: name.startsWith('bleacherbatch_') ? FLAT_BLEACHER_ROW_COUNT : LEGACY_STAND_ROW_COUNT,
            tier,
            // The local quad is authored for a north-facing stand. Rotate it
            // around Y so every audience plane faces the pool on all four sides.
            yaw: axis === 'x'
                ? (sideSign > 0 ? 0 : 180)
                : (sideSign > 0 ? 90 : -90),
        });
    });
    return stands.sort((left, right) => left.sideSign - right.sideSign);
}

// World positions of the corner seating anchor empties baked into the venue GLB
// (spectator_corner_{ne,se}_{o,u,v}). Used to place the diagonal corner crowd
// exactly on the seats without hard-coding the glTF axis mapping.
function collectCornerAnchors(root: Node): Map<string, Vec3> {
    const anchors = new Map<string, Vec3>();
    visit(root, (node) => {
        const name = node.name.toLowerCase();
        if (name.startsWith('spectator_corner_')) {
            anchors.set(name, node.worldPosition.clone());
        }
    });
    return anchors;
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
    material.initialize({ effectName: 'builtin-unlit', defines: { USE_VERTEX_COLOR: true } });
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

function tierBrightness(tier: number): number {
    const index = Math.min(TIER_BRIGHTNESS.length, Math.max(1, tier)) - 1;
    return TIER_BRIGHTNESS[index];
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
