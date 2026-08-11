import { Color, gfx, Material, Mesh, MeshRenderer, Node, utils } from 'cc';

// A rectangular RING of individual bright, unlit (self-emissive) spotlight
// fixtures hung around the arena perimeter and aimed down at the pool. It reads
// as a stadium spotlight rig against the black sky WITHOUT any dynamic lights
// (multiple dynamic lights flicker in the forward pipeline). The whole ring is
// one merged mesh + one unlit material = one draw call, and it is named with
// "ceiling" so the finish top-view camera hides it.

const CEILING_LIGHT_NODE_NAME = 'ceiling_light_array';

// The ring rectangle in pool-local space (same convention the pool geometry and
// outline meshes use): the pool itself spans X[0,50], Z[-10.5,10.5]. The ring
// sits above/outside the poolside, up near ceiling height, aimed at the water.
const LIGHT_HEIGHT_Y = 15;
const RING_MIN_X = -4;
const RING_MAX_X = 54;
const RING_HALF_Z = 14;

// Each fixture is a small bright square; FIXTURE_SPACING is the target gap
// between fixtures along the perimeter.
const FIXTURE_SIZE = 0.55;
const FIXTURE_SPACING = 3.0;

// Bright, very slightly cool white. Unlit, so it ignores scene lighting and
// stays this bright in the dark venue.
const LIGHT_COLOR = new Color(252, 253, 255, 255);

type MeshGeometry = { positions: number[]; indices: number[] };

function appendDownwardPanel(
    geometry: MeshGeometry,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    y: number,
): void {
    const base = geometry.positions.length / 3;
    // Four corners of a horizontal quad at height y.
    geometry.positions.push(
        minX, y, minZ,
        maxX, y, minZ,
        maxX, y, maxZ,
        minX, y, maxZ,
    );
    // Two triangles; double-sided rendering (cullMode NONE) makes it visible
    // from below regardless of winding.
    geometry.indices.push(
        base, base + 1, base + 2,
        base, base + 2, base + 3,
    );
}

function appendFixture(geometry: MeshGeometry, centerX: number, centerZ: number): void {
    const half = FIXTURE_SIZE * 0.5;
    appendDownwardPanel(
        geometry,
        centerX - half,
        centerX + half,
        centerZ - half,
        centerZ + half,
        LIGHT_HEIGHT_Y,
    );
}

function buildCeilingLightGeometry(): { geometry: MeshGeometry; fixtures: number } {
    const geometry: MeshGeometry = { positions: [], indices: [] };
    // Walk the four perimeter edges; each edge places fixtures from its start
    // corner up to (but not including) the next corner, so corners are not
    // doubled.
    const corners: [number, number][] = [
        [RING_MIN_X, -RING_HALF_Z],
        [RING_MAX_X, -RING_HALF_Z],
        [RING_MAX_X, RING_HALF_Z],
        [RING_MIN_X, RING_HALF_Z],
    ];
    let fixtures = 0;
    for (let edge = 0; edge < 4; edge++) {
        const [startX, startZ] = corners[edge];
        const [endX, endZ] = corners[(edge + 1) % 4];
        const length = Math.hypot(endX - startX, endZ - startZ);
        const count = Math.max(1, Math.round(length / FIXTURE_SPACING));
        for (let i = 0; i < count; i++) {
            const t = i / count;
            appendFixture(geometry, startX + (endX - startX) * t, startZ + (endZ - startZ) * t);
            fixtures++;
        }
    }
    return { geometry, fixtures };
}

// Attach the static, self-emissive ceiling spotlight ring above the pool.
export function applyCeilingLightArray(pool: Node | null, debug?: (message: string) => void): void {
    if (!pool?.isValid || pool.getChildByName(CEILING_LIGHT_NODE_NAME)) {
        return;
    }
    const { geometry, fixtures } = buildCeilingLightGeometry();
    let mesh: Mesh | null = null;
    try {
        mesh = utils.createMesh(geometry);
    } catch (error) {
        debug?.(`ceiling light ring mesh build failed: ${error}`);
        return;
    }

    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        states: {
            rasterizerState: {
                cullMode: gfx.CullMode.NONE,
            },
        },
    });
    material.name = 'CeilingLightArrayMaterial';
    material.setProperty('mainColor', LIGHT_COLOR);

    const node = new Node(CEILING_LIGHT_NODE_NAME);
    node.setParent(pool);
    node.setPosition(0, 0, 0);
    node.setRotationFromEuler(0, 0, 0);
    node.setScale(1, 1, 1);
    node.layer = pool.layer;
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = mesh;
    renderer.setMaterial(material, 0);
    debug?.(
        `ceiling light ring attached fixtures=${fixtures}`
        + ` triangles=${geometry.indices.length / 3} drawCalls=1`,
    );
}
