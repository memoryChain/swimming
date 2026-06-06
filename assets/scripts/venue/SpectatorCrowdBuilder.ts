import { _decorator, Color, Component, Layers, Material, MeshRenderer, Node, primitives, Quat, utils, Vec3 } from 'cc';
import { PoolDefinition } from './VenueConfig';

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

const SIDE_TIER_SPECS = [
    { y: 3.65, zOffset: 12.4, zSpan: 5.1, columns: 26, bands: 2 },
    { y: 6.0, zOffset: 19.2, zSpan: 5.4, columns: 28, bands: 2 },
    { y: 8.5, zOffset: 27.0, zSpan: 6.0, columns: 30, bands: 2 },
];

const END_TIER_SPECS = [
    { y: 3.65, xOffset: 13.0, xSpan: 6.2, columns: 18, bands: 2 },
    { y: 6.0, xOffset: 21.0, xSpan: 7.0, columns: 20, bands: 2 },
    { y: 8.5, xOffset: 30.0, xSpan: 8.0, columns: 22, bands: 2 },
];

type SpectatorSpec = {
    pos: Vec3;
    width: number;
    height: number;
    row: number;
    col: number;
    side: number;
    yaw: number;
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
        this.phase += dt * this.speed;
        const lift = Math.sin(this.phase) * this.amplitude;
        const sway = Math.cos(this.phase * 0.73) * this.sideAmplitude;
        this.node.setPosition(this._base.x + sway, this._base.y + lift, this._base.z);
    }
}

export class SpectatorCrowdBuilder {
    build(root: Node, definition: PoolDefinition, debug?: (message: string) => void) {
        const crowdRoot = makeWorldNode('SpectatorCrowd', root);
        try {
            const materials = SPECTATOR_COLORS.map((c, i) => makeMaterial(`SpectatorColor${i}`, c));
            const buckets = Array.from({ length: SPECTATOR_COLORS.length * WOBBLE_GROUP_COUNT }, () => [] as SpectatorSpec[]);
            const poolWidth = definition.laneCount * definition.laneWidth;
            this.collectSideStands(buckets, definition, poolWidth);
            this.collectEndStands(buckets, definition, poolWidth);
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
            const message = `spectator crowd built groups=${groupCount} planes=${spectatorCount}`;
            debug?.(message);
            console.log(`[SpeedSwimming] ${message}`);
        } catch (error) {
            crowdRoot.active = false;
            throw error;
        }
    }

    private collectSideStands(buckets: SpectatorSpec[][], definition: PoolDefinition, poolWidth: number) {
        const startX = definition.startX - 14;
        const endX = definition.finishX + 14;
        for (let side = -1; side <= 1; side += 2) {
            for (let tier = 0; tier < SIDE_TIER_SPECS.length; tier++) {
                const spec = SIDE_TIER_SPECS[tier];
                for (let band = 0; band < spec.bands; band++) {
                    for (let col = 0; col < spec.columns; col++) {
                        const t = spec.columns > 1 ? col / (spec.columns - 1) : 0;
                        const x = lerp(startX, endX, t) + jitter(col, tier + band * 3, side, 1.45);
                        const bandT = spec.bands > 1 ? (band / (spec.bands - 1) - 0.5) : 0;
                        const z = side * (poolWidth * 0.5 + spec.zOffset + bandT * spec.zSpan + jitter(tier, col + band * 11, side, 0.82));
                        this.addSpectator(buckets, {
                            pos: this.spectatorPosition(x, spec.y, z, col, tier * 3 + band, side),
                            widthSeed: col,
                            heightSeed: tier + band,
                            colorSeed: side + band * 7,
                            row: tier * 3 + band,
                            col,
                            side,
                            yaw: side > 0 ? 0 : 180,
                        });
                    }
                }
            }
        }
    }

    private collectEndStands(buckets: SpectatorSpec[][], definition: PoolDefinition, poolWidth: number) {
        const zMin = -poolWidth * 0.5 - 28;
        const zMax = poolWidth * 0.5 + 28;
        for (let end = -1; end <= 1; end += 2) {
            const baseX = end < 0 ? definition.startX : definition.finishX;
            for (let tier = 0; tier < END_TIER_SPECS.length; tier++) {
                const spec = END_TIER_SPECS[tier];
                for (let band = 0; band < spec.bands; band++) {
                    for (let col = 0; col < spec.columns; col++) {
                        if (random01(col, tier + band * 5, end, 53) < 0.14) {
                            continue;
                        }
                        const t = spec.columns > 1 ? col / (spec.columns - 1) : 0;
                        const bandT = spec.bands > 1 ? (band / (spec.bands - 1) - 0.5) : 0;
                        const x = baseX + end * (spec.xOffset + bandT * spec.xSpan + jitter(tier + band * 13, col, end, 0.9));
                        const z = lerp(zMin, zMax, t) + jitter(col, tier + band * 2, end, 1.8);
                        this.addSpectator(buckets, {
                            pos: this.spectatorPosition(x, spec.y, z, col, tier * 3 + band, end),
                            widthSeed: tier + band,
                            heightSeed: col,
                            colorSeed: end + 5 + band * 7,
                            row: tier * 3 + band,
                            col,
                            side: end,
                            yaw: end < 0 ? -90 : 90,
                        });
                    }
                }
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
            width: 0.28 + random01(options.widthSeed, options.row, options.side, 31) * 0.26,
            height: 0.42 + random01(options.heightSeed, options.side, options.col, 37) * 0.38 + options.row * 0.012,
            row: options.row,
            col: options.col,
            side: options.side,
            yaw: options.yaw,
        });
    }

    private spectatorPosition(x: number, standTopY: number, z: number, col: number, row: number, side: number): Vec3 {
        const bodyHeight = 0.38 + random01(row, side, col, 37) * 0.28 + row * 0.02;
        return new Vec3(
            x,
            standTopY + bodyHeight * 0.5 + random01(row, col, side, 19) * 0.08,
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
            -90 + jitter(spectator.row, spectator.col, spectator.side, 4),
            spectator.yaw + jitter(spectator.col, spectator.side, spectator.row, 16),
            jitter(spectator.side, spectator.row, spectator.col, 8),
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

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
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
