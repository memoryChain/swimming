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

const BOWL_RING_SPECS = [
    { y: 1.05, xPadding: 10.0, zPadding: 4.8, columns: 48 },
    { y: 1.85, xPadding: 15.8, zPadding: 8.1, columns: 56 },
    { y: 2.75, xPadding: 22.2, zPadding: 11.7, columns: 64 },
    { y: 3.75, xPadding: 29.0, zPadding: 15.0, columns: 72 },
    { y: 4.8, xPadding: 36.2, zPadding: 18.5, columns: 80 },
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
            this.collectBowlStands(buckets, definition, poolWidth);
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

    private collectBowlStands(buckets: SpectatorSpec[][], definition: PoolDefinition, poolWidth: number) {
        const centerX = (definition.startX + definition.finishX) * 0.5;
        const centerZ = 0;
        const halfCourseLength = Math.abs(definition.finishX - definition.startX) * 0.5;
        const halfPoolWidth = poolWidth * 0.5;

        for (let row = 0; row < BOWL_RING_SPECS.length; row++) {
            const spec = BOWL_RING_SPECS[row];
            const radiusX = halfCourseLength + spec.xPadding;
            const radiusZ = halfPoolWidth + spec.zPadding;
            for (let col = 0; col < spec.columns; col++) {
                if (random01(col, row, spec.columns, 53) < 0.11) {
                    continue;
                }
                const baseAngle = Math.PI * 2 * (col / spec.columns);
                const angle = baseAngle + jitter(col, row, spec.columns, 0.055);
                const x = centerX + Math.cos(angle) * (radiusX + jitter(row, col, 2, 0.55));
                const z = centerZ + Math.sin(angle) * (radiusZ + jitter(col, row, 7, 0.45));
                this.addSpectator(buckets, {
                    pos: this.spectatorPosition(x, spec.y, z, col, row, spec.columns),
                    widthSeed: col,
                    heightSeed: row,
                    colorSeed: row * 17,
                    row,
                    col,
                    side: spec.columns,
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
            width: 0.24 + random01(options.widthSeed, options.row, options.side, 31) * 0.22,
            height: 0.34 + random01(options.heightSeed, options.side, options.col, 37) * 0.3 + options.row * 0.01,
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
