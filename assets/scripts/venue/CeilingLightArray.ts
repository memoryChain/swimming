import { _decorator, Color, Component, gfx, ImageAsset, Mat4, Material, Mesh, MeshRenderer, Node, Texture2D, utils, Vec3 } from 'cc';

// A rectangular RING of individual bright, unlit spotlight fixtures hung around
// the arena perimeter and aimed down at the pool. Each fixture is a bright solid
// core plus an additive glow halo (a soft radial texture) so it reads as an
// actually-glowing light against the black sky, WITHOUT dynamic lights (which
// flicker in the forward pipeline) and WITHOUT particles (56 emitters would be
// far too heavy on WeChat). The cores merge into one draw call and the halos
// into a second; both nodes are named with "ceiling" so the finish top-view
// camera hides them.

const CEILING_LIGHT_NODE_NAME = 'ceiling_light_array';
const CEILING_GLOW_NODE_NAME = 'ceiling_light_glow';
const CEILING_FLARE_NODE_NAME = 'ceiling_light_flare_glow';
const CEILING_FLARE_CTRL_NAME = 'ceiling_light_flare_ctrl';

// Parallel ceiling light trusses running the length of the pool (along X),
// spread evenly across its width (Z) - like a real aquatics-centre roof rig -
// instead of a single boxy perimeter ring. Pool spans X[0,50], Z[-10.5,10.5].
const LIGHT_HEIGHT_Y = 11;
const STRIP_COUNT: number = 6;
const STRIP_MIN_X = 2;
const STRIP_MAX_X = 48;
const STRIP_MIN_Z = -7.5;
const STRIP_MAX_Z = 7.5;
// Extra transverse rows added off the -X end (beyond STRIP_MIN_X), at the same
// spacing, to cover the deck past that end of the pool.
const EXTRA_COLUMNS_MINUS_X = 3;

// Bright solid core of each fixture; FIXTURE_SPACING is the gap along the ring.
const FIXTURE_SIZE = 0.55;
const FIXTURE_SPACING = 3.0;
const LIGHT_COLOR = new Color(252, 253, 255, 255);

// Additive glow halo per fixture. HALO_SIZE is the soft-light footprint; the
// halo sits a touch below the core (nearer the camera, which looks up from the
// water) so it glows over the core too. GLOW_COLOR alpha scales the intensity.
const HALO_SIZE = 2.4;
const HALO_DROP = 0.06;
const GLOW_COLOR = new Color(255, 248, 230, 210);

// View-dependent camera glare ("lens flare"). A fixture flares only when the
// camera LOOKS AT it (the lamp sits near the centre of view) AND the camera is
// on the lit side of that lamp (the lamp's aim points back toward the camera).
// A lamp aimed away, or off to the side of the view, stays a plain glow. This
// reads like a real lens flare and, unlike a pure beam-cone test, is actually
// observable with a forward-looking race camera. Purely geometry-driven, NOT a
// timed blink.
// cos of the view half-angle: how centred the lamp must be on screen to flare.
const FLARE_VIEW_THRESHOLD = 0.82; // ~35 degrees off screen centre
// Min "lamp faces the camera" dot; keeps back-lit lamps from flaring.
const FLARE_FACING_MIN = 0.05;
const FLARE_MIN_SIZE = 0.6;
const FLARE_MAX_SIZE = 10;
const FLARE_FADE_RATE = 9;

const { ccclass } = _decorator;

type PlainGeometry = { positions: number[]; indices: number[] };
type TexturedGeometry = { positions: number[]; uvs: number[]; indices: number[] };
// A light fixture: local-space centre plus a unit aim direction it points along.
type Fixture = { pos: Vec3; aim: Vec3 };

let sharedGlowTexture: Texture2D | null = null;

// One soft radial glow sprite, generated once: a wide gaussian falloff plus a
// tighter bright core reads as a lamp glow rather than a hard disc.
function getGlowTexture(): Texture2D {
    if (sharedGlowTexture) {
        return sharedGlowTexture;
    }
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    const c = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (x - c) / c;
            const dy = (y - c) / c;
            const r = Math.sqrt(dx * dx + dy * dy);
            const wide = Math.exp(-(r * r) / (2 * 0.30 * 0.30));
            const core = Math.exp(-(r * r) / (2 * 0.11 * 0.11));
            const a = Math.min(1, wide * 0.9 + core * 0.7);
            const i = (y * size + x) * 4;
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = Math.round(255 * a);
        }
    }
    const image = new ImageAsset({
        width: size,
        height: size,
        _data: data,
        _compressed: false,
        format: Texture2D.PixelFormat.RGBA8888,
    });
    const texture = new Texture2D();
    texture.image = image;
    sharedGlowTexture = texture;
    return texture;
}

// The roof rig: STRIP_COUNT parallel trusses running the length of the pool
// (along X), spread across its width (Z), all aiming straight down.
function downFixtures(): Fixture[] {
    const fixtures: Fixture[] = [];
    const perStrip = Math.max(1, Math.round((STRIP_MAX_X - STRIP_MIN_X) / FIXTURE_SPACING));
    const stepX = (STRIP_MAX_X - STRIP_MIN_X) / perStrip;
    for (let s = 0; s < STRIP_COUNT; s++) {
        const z = STRIP_COUNT === 1
            ? (STRIP_MIN_Z + STRIP_MAX_Z) * 0.5
            : STRIP_MIN_Z + (STRIP_MAX_Z - STRIP_MIN_Z) * (s / (STRIP_COUNT - 1));
        // Same spacing as the pool columns, with a few extra rows off the -X end.
        for (let i = -EXTRA_COLUMNS_MINUS_X; i <= perStrip; i++) {
            const x = STRIP_MIN_X + stepX * i;
            fixtures.push({ pos: new Vec3(x, LIGHT_HEIGHT_Y, z), aim: new Vec3(0, -1, 0) });
        }
    }
    return fixtures;
}

// Build an orthonormal (right, up) basis for a quad whose normal is `aim`.
// Falls back to a Z reference when the aim is (near) vertical.
function orientedBasis(aim: Vec3, right: Vec3, up: Vec3): void {
    const ref = Math.abs(aim.y) > 0.99 ? Vec3.UNIT_Z : Vec3.UNIT_Y;
    Vec3.cross(right, ref, aim);
    right.normalize();
    Vec3.cross(up, aim, right);
    up.normalize();
}

const basisRight = new Vec3();
const basisUp = new Vec3();

// Bright solid cores, one quad per fixture, oriented to face along its aim.
function buildCoreGeometry(fixtures: Fixture[]): PlainGeometry {
    const geometry: PlainGeometry = { positions: [], indices: [] };
    const half = FIXTURE_SIZE * 0.5;
    for (const f of fixtures) {
        orientedBasis(f.aim, basisRight, basisUp);
        const base = geometry.positions.length / 3;
        const rx = basisRight.x * half, ry = basisRight.y * half, rz = basisRight.z * half;
        const ux = basisUp.x * half, uy = basisUp.y * half, uz = basisUp.z * half;
        const cx = f.pos.x, cy = f.pos.y, cz = f.pos.z;
        geometry.positions.push(
            cx - rx - ux, cy - ry - uy, cz - rz - uz,
            cx + rx - ux, cy + ry - uy, cz + rz - uz,
            cx + rx + ux, cy + ry + uy, cz + rz + uz,
            cx - rx + ux, cy - ry + uy, cz - rz + uz,
        );
        geometry.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return geometry;
}

// Additive glow halos, one textured quad per fixture, nudged a touch along the
// aim (toward the lit side) so the halo glows over the core.
function buildHaloGeometry(fixtures: Fixture[]): TexturedGeometry {
    const geometry: TexturedGeometry = { positions: [], uvs: [], indices: [] };
    const half = HALO_SIZE * 0.5;
    for (const f of fixtures) {
        orientedBasis(f.aim, basisRight, basisUp);
        const base = geometry.positions.length / 3;
        const rx = basisRight.x * half, ry = basisRight.y * half, rz = basisRight.z * half;
        const ux = basisUp.x * half, uy = basisUp.y * half, uz = basisUp.z * half;
        const cx = f.pos.x + f.aim.x * HALO_DROP;
        const cy = f.pos.y + f.aim.y * HALO_DROP;
        const cz = f.pos.z + f.aim.z * HALO_DROP;
        geometry.positions.push(
            cx - rx - ux, cy - ry - uy, cz - rz - uz,
            cx + rx - ux, cy + ry - uy, cz + rz - uz,
            cx + rx + ux, cy + ry + uy, cz + rz + uz,
            cx - rx + ux, cy - ry + uy, cz - rz + uz,
        );
        geometry.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        geometry.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return geometry;
}

function attachRenderer(parent: Node, name: string, mesh: Mesh, material: Material): void {
    const node = new Node(name);
    node.setParent(parent);
    node.setPosition(0, 0, 0);
    node.setRotationFromEuler(0, 0, 0);
    node.setScale(1, 1, 1);
    node.layer = parent.layer;
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = mesh;
    renderer.setMaterial(material, 0);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(edge1 - edge0, 1e-5)));
    return t * t * (3 - 2 * t);
}

// A unit billboard quad in the local XY plane (normal +Z), textured with the
// glow sprite; the flare controller orients and scales it every frame.
function buildFlareQuadMesh(): Mesh {
    return utils.createMesh({
        positions: [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
        uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        indices: [0, 1, 2, 0, 2, 3],
    });
}

const tmpForward = new Vec3();
const tmpDir = new Vec3();

// Drives one billboard glare per fixture: each lamp independently fades its own
// flare in/out based on how centred it is in view and whether it faces the
// camera, so the glare slides smoothly across lamps instead of a few pooled
// quads jumping between them. Lives on an always-active node.
@ccclass('CeilingLightFlare')
export class CeilingLightFlare extends Component {
    private _centers: Vec3[] = [];
    private _aims: Vec3[] = [];
    private _camera: Node | null = null;
    private _flares: Node[] = [];
    private _intensities: number[] = [];

    init(centers: Vec3[], aims: Vec3[], camera: Node, flares: Node[]): void {
        this._centers = centers;
        this._aims = aims;
        this._camera = camera;
        this._flares = flares;
        this._intensities = new Array(centers.length).fill(0);
    }

    update(dt: number): void {
        const cam = this._camera;
        if (!cam?.isValid || this._centers.length === 0) {
            return;
        }
        const camPos = cam.worldPosition;
        Vec3.transformQuat(tmpForward, Vec3.FORWARD, cam.worldRotation);
        const rate = Math.min(1, dt * FLARE_FADE_RATE);
        for (let i = 0; i < this._centers.length; i++) {
            const center = this._centers[i];
            // Direction from the camera to the fixture (normalized).
            Vec3.subtract(tmpDir, center, camPos);
            const len = tmpDir.length();
            if (len > 1e-4) {
                tmpDir.multiplyScalar(1 / len);
            }
            // How centred the lamp is in view (1 = dead centre of the screen).
            const viewAlign = len > 1e-4 ? Vec3.dot(tmpDir, tmpForward) : -1;
            // Whether the lamp faces back toward the camera (lit side). tmpDir is
            // camera->lamp, so dot(lamp->camera, aim) = -dot(tmpDir, aim).
            const facing = -Vec3.dot(tmpDir, this._aims[i]);
            const target = (facing > FLARE_FACING_MIN && viewAlign > FLARE_VIEW_THRESHOLD)
                ? smoothstep(FLARE_VIEW_THRESHOLD, 1, viewAlign)
                : 0;
            const intensity = this._intensities[i] + (target - this._intensities[i]) * rate;
            this._intensities[i] = intensity;
            const node = this._flares[i];
            if (!node?.isValid) {
                continue;
            }
            if (intensity < 0.01) {
                if (node.active) {
                    node.active = false;
                }
                continue;
            }
            if (!node.active) {
                node.active = true;
            }
            // Billboard: face the camera (double-sided quad).
            Vec3.subtract(tmpDir, camPos, center);
            node.forward = tmpDir;
            const s = FLARE_MIN_SIZE + (FLARE_MAX_SIZE - FLARE_MIN_SIZE) * intensity;
            node.setScale(s, s, s);
        }
    }
}

// Build one glare billboard per fixture (hidden until the camera looks near it)
// plus the always-active controller node.
function setupCameraFlare(
    pool: Node,
    fixtures: Fixture[],
    camera: Node | null,
    glowMaterial: Material,
): void {
    if (!camera?.isValid) {
        return;
    }
    const world = new Mat4();
    pool.getWorldMatrix(world);
    const flareMesh = buildFlareQuadMesh();
    const worldCenters: Vec3[] = [];
    const worldAims: Vec3[] = [];
    const flareNodes: Node[] = [];
    for (const f of fixtures) {
        const center = new Vec3(f.pos.x, f.pos.y, f.pos.z);
        Vec3.transformMat4(center, center, world);
        worldCenters.push(center);
        const aim = new Vec3(f.aim.x, f.aim.y, f.aim.z);
        Vec3.transformMat4Normal(aim, aim, world);
        aim.normalize();
        worldAims.push(aim);
        const node = new Node(CEILING_FLARE_NODE_NAME);
        node.setParent(pool);
        node.layer = pool.layer;
        node.active = false;
        node.setWorldPosition(center);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = flareMesh;
        renderer.setMaterial(glowMaterial, 0);
        flareNodes.push(node);
    }

    const ctrlNode = new Node(CEILING_FLARE_CTRL_NAME);
    ctrlNode.setParent(pool);
    ctrlNode.layer = pool.layer;
    const controller = ctrlNode.addComponent(CeilingLightFlare);
    controller.init(worldCenters, worldAims, camera, flareNodes);
}

// Attach the static ceiling spotlight ring (bright cores + additive glow halos).
export function applyCeilingLightArray(pool: Node | null, camera: Node | null, debug?: (message: string) => void): void {
    if (!pool?.isValid || pool.getChildByName(CEILING_LIGHT_NODE_NAME)) {
        return;
    }
    const fixtures = downFixtures();
    const coreGeometry = buildCoreGeometry(fixtures);
    const haloGeometry = buildHaloGeometry(fixtures);

    let coreMesh: Mesh | null = null;
    let haloMesh: Mesh | null = null;
    try {
        coreMesh = utils.createMesh(coreGeometry);
        haloMesh = utils.createMesh(haloGeometry);
    } catch (error) {
        debug?.(`ceiling light ring mesh build failed: ${error}`);
        return;
    }

    const coreMaterial = new Material();
    coreMaterial.initialize({
        effectName: 'builtin-unlit',
        states: {
            rasterizerState: { cullMode: gfx.CullMode.NONE },
        },
    });
    coreMaterial.name = 'CeilingLightCoreMaterial';
    coreMaterial.setProperty('mainColor', LIGHT_COLOR);

    // Additive, depth-tested but not depth-writing transparent glow.
    const glowMaterial = new Material();
    glowMaterial.initialize({
        effectName: 'builtin-unlit',
        technique: 1,
        defines: { USE_TEXTURE: true },
        states: {
            rasterizerState: { cullMode: gfx.CullMode.NONE },
            depthStencilState: { depthTest: true, depthWrite: false },
            blendState: {
                targets: [{
                    blend: true,
                    blendSrc: gfx.BlendFactor.SRC_ALPHA,
                    blendDst: gfx.BlendFactor.ONE,
                    blendSrcAlpha: gfx.BlendFactor.SRC_ALPHA,
                    blendDstAlpha: gfx.BlendFactor.ONE,
                }],
            },
        },
    });
    glowMaterial.name = 'CeilingLightGlowMaterial';
    glowMaterial.setProperty('mainColor', GLOW_COLOR);
    glowMaterial.setProperty('mainTexture', getGlowTexture());

    attachRenderer(pool, CEILING_LIGHT_NODE_NAME, coreMesh, coreMaterial);
    attachRenderer(pool, CEILING_GLOW_NODE_NAME, haloMesh, glowMaterial);
    setupCameraFlare(pool, fixtures, camera, glowMaterial);
    debug?.(
        `ceiling light ring attached fixtures=${fixtures.length}`
        + ` coreTris=${coreGeometry.indices.length / 3} glowTris=${haloGeometry.indices.length / 3} drawCalls=2`,
    );
}
