import { _decorator, Color, Component, gfx, Layers, Material, MeshRenderer, Node, primitives, Quat, utils, Vec3 } from 'cc';
import { scaledDelta } from '../core/TimeScale';
import { SpectatorCameraFlashEmitter } from './SpectatorCameraFlashEmitter';
import { createSpectatorTemplate } from './SpectatorGeometry';

const { ccclass, property } = _decorator;

// Keep the palette colourful enough to read as a crowd, then mute only the
// pool-facing first row through its baked vertex colour. This prevents the
// nearest audience and the new poolside props from competing for attention.
const SPECTATOR_COLORS = [
    color(96, 138, 214),
    color(206, 108, 150),
    color(86, 190, 158),
    color(224, 166, 88),
    color(206, 206, 198),
];

// Per-tier brightness multiplier baked into spectator vertex colors, modelling
// 中上层保留可辨轮廓，四档亮度与场馆 atlas 同步；泳池仍是画面最亮的区域。
const TIER_BRIGHTNESS = [1.0, 0.55, 0.28, 0.12];
const FRONT_ROW_BRIGHTNESS = 0.70;
const FRONT_ROW_SATURATION = 0.55;

// 六份模板只在模块加载时构建，第一层有厚度，上层使用同风格平面轮廓。
const SPECTATOR_TEMPLATES = [false, true].map((volume) =>
    [0, 1, 2].map((pose) => createSpectatorTemplate(volume, pose)));
const SPECTATOR_SKIN_COLORS = [color(244, 190, 145), color(211, 153, 108), color(166, 111, 77)];
const SPECTATOR_HAIR_COLORS = [color(55, 40, 38), color(104, 64, 42), color(183, 131, 65)];
const SPECTATOR_PANTS_COLOR = color(47, 62, 86);
const SPECTATOR_EYE_COLOR = color(39, 33, 40);

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
const SPECTATOR_SPACING = 1.1;
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
    'bleacherbatch_t1_w',
    'bleacherbatch_t2_n',
    'bleacherbatch_t2_s',
    'bleacherbatch_t2_e',
    'bleacherbatch_t2_w',
    'bleacherbatch_t3_n',
    'bleacherbatch_t3_s',
    'bleacherbatch_t3_e',
    'bleacherbatch_t3_w',
    'bleacherbatch_t4_n',
    'bleacherbatch_t4_s',
    'bleacherbatch_t4_e',
    'bleacherbatch_t4_w',
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
    saturation: number;
    detailed: boolean;
    pose: number;
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
    private _sampleTime = 0;

    start() {
        this._base.set(this.node.position);
    }

    update(dt: number) {
        if (!this.node.activeInHierarchy) return;
        const delta = scaledDelta(dt);
        if (delta <= 0) return;
        this.phase += delta * this.speed;
        this._sampleTime += delta;
        if (this._sampleTime < 1 / 24) return;
        this._sampleTime %= 1 / 24;
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

            const material = makeMaterial('SpectatorVertexColor');
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
                    material,
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
            const brightness = spectatorBrightness(tier);
            const saturation = spectatorSaturation(tier);
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

                    const height = 0.66 + random01(row, col, section, 31) * 0.14;
                    const width = 0.38 + random01(col, section, row, 37) * 0.10;
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
                    const wobbleIndex = spectatorPose(random01(row, col, section, 71));

                    buckets[wobbleIndex * SPECTATOR_COLORS.length + colorIndex].push({
                        pos: new Vec3(x, seatY + height * 0.5 + 0.025, z),
                        width,
                        height,
                        topWidthScale: 0.94 + random01(col, row, section, 79) * 0.12,
                        topOffset: jitter(section, col, row, 0.06),
                        row,
                        col: globalColumn,
                        side: sideSign,
                        // Face inward toward the pool; small per-plane yaw/roll
                        // jitter is applied again while building the mesh.
                        yaw,
                        brightness,
                        saturation,
                        detailed: tier === 1,
                        pose: wobbleIndex,
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
            { key: 'nw', salt: 193 },
            { key: 'sw', salt: 307 },
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
                const baseY = tierBaseY[tier];
                for (let row = 0; row < FLAT_BLEACHER_ROW_COUNT; row++) {
                    const brightness = spectatorBrightness(tier);
                    const saturation = spectatorSaturation(tier);
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
                        const height = 0.66 + random01(row, col, tier + salt, 31) * 0.14;
                        const width = 0.38 + random01(col, tier, row + salt, 37) * 0.10;
                        const colorIndex = Math.floor(
                            random01(col, row, tier + salt + 11, 53) * SPECTATOR_COLORS.length,
                        ) % SPECTATOR_COLORS.length;
                        const wobbleIndex = spectatorPose(random01(row, col, tier + salt, 71));
                        buckets[wobbleIndex * SPECTATOR_COLORS.length + colorIndex].push({
                            pos: new Vec3(x, seatY + height * 0.5 + 0.025, z),
                            width,
                            height,
                            topWidthScale: 0.94 + random01(col, row, tier + salt, 79) * 0.12,
                            topOffset: jitter(tier, col, row + salt, 0.06),
                            row,
                            col,
                            side: 1,
                            yaw,
                            brightness,
                            saturation,
                            detailed: tier === 1,
                            pose: wobbleIndex,
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
    const colorIndex = positiveMod(groupIndex, SPECTATOR_COLORS.length);
    renderer.mesh = utils.createMesh(buildSpectatorGeometry(spectators, SPECTATOR_COLORS[colorIndex]));
    renderer.setMaterial(material, 0);

    const motionIndex = Math.floor(groupIndex / SPECTATOR_COLORS.length);
    // 大部分观众保持坐稳，只有两类欢呼组需要更新变换。
    if (motionIndex > 0) {
        const wobble = node.addComponent(SpectatorGroupWobble);
        wobble.amplitude = 0.008 + motionIndex * 0.004;
        wobble.sideAmplitude = 0.003;
        wobble.speed = 1.2 + motionIndex * 0.23;
        wobble.phase = motionIndex * 2.05 + groupIndex * 0.37;
    }
    return node;
}

function buildSpectatorGeometry(spectators: SpectatorSpec[], baseColor: Color): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const rotation = new Quat();
    const point = new Vec3();
    const minPos = new Vec3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const maxPos = new Vec3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    for (const spectator of spectators) {
        const template = SPECTATOR_TEMPLATES[spectator.detailed ? 1 : 0][spectator.pose];
        const base = positions.length / 3;
        // 坐姿保持竖直，避免倾斜令有厚度的底部穿入台阶。
        Quat.fromEuler(rotation, -90,
            spectator.yaw + jitter(spectator.col, spectator.side, spectator.row, 8), 0);
        for (let vertex = 0; vertex < template.positions.length / 3; vertex++) {
            pushCorner(positions, point, minPos, maxPos, spectator, rotation,
                template.positions[vertex * 3], template.positions[vertex * 3 + 2],
                template.positions[vertex * 3 + 1]);
        }
        const skinIndex = Math.floor(random01(spectator.row, spectator.col, spectator.side, 131) * SPECTATOR_SKIN_COLORS.length);
        const hairIndex = Math.floor(random01(spectator.row, spectator.col, spectator.side, 139) * SPECTATOR_HAIR_COLORS.length);
        const palette = [baseColor, SPECTATOR_SKIN_COLORS[skinIndex], SPECTATOR_HAIR_COLORS[hairIndex], SPECTATOR_PANTS_COLOR, SPECTATOR_EYE_COLOR];
        // 只在创建场馆时分配，比赛帧不访问或重建模板与色板。
        const linearPalette = palette.map((c) => {
            const r = srgbToLinear(c.r / 255), g = srgbToLinear(c.g / 255), b = srgbToLinear(c.b / 255);
            const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
            const saturation = c === baseColor ? spectator.saturation : 1;
            return [(luminance + (r - luminance) * saturation) * spectator.brightness,
                (luminance + (g - luminance) * saturation) * spectator.brightness,
                (luminance + (b - luminance) * saturation) * spectator.brightness];
        });
        for (let vertex = 0; vertex < template.colors.length / 2; vertex++) {
            const rgb = linearPalette[template.colors[vertex * 2]];
            const shade = template.colors[vertex * 2 + 1];
            colors.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, 1);
        }
        for (const index of template.indices) indices.push(base + index);
    }

    // 此 unlit 顶点色材质不使用法线或 UV，避免新轮廓携带无用的顶点数据。
    return { positions, colors, indices, minPos, maxPos };
}

function pushCorner(
    positions: number[],
    point: Vec3,
    minPos: Vec3,
    maxPos: Vec3,
    spectator: SpectatorSpec,
    rotation: Quat,
    xFactor: number,
    zFactor: number,
    depthFactor: number,
) {
    const isTop = zFactor > 0;
    const widthScale = isTop ? spectator.topWidthScale : 1;
    const topOffset = isTop ? spectator.topOffset : 0;
    // -90° 换轴后正局部深度朝泳池；模板正脸在负深度，故在此反向。
    // 平面版也保留同一深度分层，以免裤子与身体共面闪烁。
    point.set(spectator.width * (xFactor * widthScale + topOffset), -spectator.width * depthFactor,
        spectator.height * zFactor);
    Vec3.transformQuat(point, point, rotation);
    point.add(spectator.pos);
    positions.push(point.x, point.y, point.z);
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
            // 按实际位置朝池内。GLB 的 N 在负 Z；旧双面剪影看不出反向，
            // 有正脸/后脑的立体观众不能沿用节点名推断的南北朝向。
            yaw: axis === 'x'
                ? (bounds.minZ + bounds.maxZ > 0 ? 0 : 180)
                : (bounds.minX + bounds.maxX > 50 ? 90 : -90),
        });
    });
    return stands.sort((left, right) => left.sideSign - right.sideSign);
}

// World positions of the corner seating anchor empties baked into the venue GLB
// (spectator_corner_{ne,se,nw,sw}_{o,u,v}). Used to place the diagonal corner crowd
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

function srgbToLinear(value: number): number {
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function makeMaterial(name: string): Material {
    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        defines: { USE_VERTEX_COLOR: true },
        // 普通 Material 的 overridePipelineStates 只会警告，不会修改剔除状态。
        // 在初始化时设置双面，保证东西看台及反向镜头中的单层观众可见。
        states: { rasterizerState: { cullMode: gfx.CullMode.NONE } },
    });
    material.name = name;
    material.setProperty('mainColor', Color.WHITE);
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

function spectatorBrightness(tier: number): number {
    return tier === 1 ? FRONT_ROW_BRIGHTNESS : tierBrightness(tier);
}

function spectatorSaturation(tier: number): number {
    return tier === 1 ? FRONT_ROW_SATURATION : 1;
}

function spectatorPose(value: number): number {
    return value < 0.72 ? 0 : value < 0.92 ? 1 : 2;
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
