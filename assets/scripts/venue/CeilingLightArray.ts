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
const STRIP_COUNT: number = 4;
const STRIP_MIN_X = 2;
const STRIP_MAX_X = 48;
const STRIP_MIN_Z = -7.5;
const STRIP_MAX_Z = 7.5;

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

// View-dependent camera glare ("lens flare"): when the camera looks nearly
// straight at a fixture, that fixture flares into a big dazzling additive burst
// like a camera pointed at a flashgun. Purely angle-driven, NOT a timed blink.
// Only the single most head-on fixture flares, so this is one extra draw call.
const FLARE_ALIGN_THRESHOLD = 0.9;
const FLARE_MIN_SIZE = 0.6;
const FLARE_MAX_SIZE = 10;
const FLARE_FADE_RATE = 9;

const { ccclass } = _decorator;

type PlainGeometry = { positions: number[]; indices: number[] };
type TexturedGeometry = { positions: number[]; uvs: number[]; indices: number[] };

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

// Evenly spaced fixture centres laid out as STRIP_COUNT parallel trusses that
// run the length of the pool (along X), spread across its width (Z).
function fixtureCenters(): [number, number][] {
    const centers: [number, number][] = [];
    const perStrip = Math.max(1, Math.round((STRIP_MAX_X - STRIP_MIN_X) / FIXTURE_SPACING));
    for (let s = 0; s < STRIP_COUNT; s++) {
        const z = STRIP_COUNT === 1
            ? (STRIP_MIN_Z + STRIP_MAX_Z) * 0.5
            : STRIP_MIN_Z + (STRIP_MAX_Z - STRIP_MIN_Z) * (s / (STRIP_COUNT - 1));
        for (let i = 0; i <= perStrip; i++) {
            const x = STRIP_MIN_X + (STRIP_MAX_X - STRIP_MIN_X) * (i / perStrip);
            centers.push([x, z]);
        }
    }
    return centers;
}

function buildCoreGeometry(centers: [number, number][]): PlainGeometry {
    const geometry: PlainGeometry = { positions: [], indices: [] };
    const half = FIXTURE_SIZE * 0.5;
    for (const [cx, cz] of centers) {
        const base = geometry.positions.length / 3;
        geometry.positions.push(
            cx - half, LIGHT_HEIGHT_Y, cz - half,
            cx + half, LIGHT_HEIGHT_Y, cz - half,
            cx + half, LIGHT_HEIGHT_Y, cz + half,
            cx - half, LIGHT_HEIGHT_Y, cz + half,
        );
        geometry.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return geometry;
}

function buildHaloGeometry(centers: [number, number][]): TexturedGeometry {
    const geometry: TexturedGeometry = { positions: [], uvs: [], indices: [] };
    const half = HALO_SIZE * 0.5;
    const y = LIGHT_HEIGHT_Y - HALO_DROP;
    for (const [cx, cz] of centers) {
        const base = geometry.positions.length / 3;
        geometry.positions.push(
            cx - half, y, cz - half,
            cx + half, y, cz - half,
            cx + half, y, cz + half,
            cx - half, y, cz + half,
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

// Drives a per-fixture billboard glare: every fixture the camera looks near
// flares at once - brightest/biggest for the most head-on one and tapering for
// its neighbours - so the glare reads as one soft moving patch of light rather
// than single lamps popping on one at a time. Lives on an always-active node.
@ccclass('CeilingLightFlare')
export class CeilingLightFlare extends Component {
    private _centers: Vec3[] = [];
    private _camera: Node | null = null;
    private _flares: Node[] = [];
    private _intensities: number[] = [];

    init(centers: Vec3[], camera: Node, flares: Node[]): void {
        this._centers = centers;
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
            Vec3.subtract(tmpDir, center, camPos);
            const len = tmpDir.length();
            const align = len > 1e-4 ? Vec3.dot(tmpDir, tmpForward) / len : -1;
            const target = align > FLARE_ALIGN_THRESHOLD ? smoothstep(FLARE_ALIGN_THRESHOLD, 1, align) : 0;
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
    centers: [number, number][],
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
    const flareNodes: Node[] = [];
    for (const [cx, cz] of centers) {
        const center = new Vec3(cx, LIGHT_HEIGHT_Y, cz);
        Vec3.transformMat4(center, center, world);
        worldCenters.push(center);
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
    controller.init(worldCenters, camera, flareNodes);
}

// Attach the static ceiling spotlight ring (bright cores + additive glow halos).
export function applyCeilingLightArray(pool: Node | null, camera: Node | null, debug?: (message: string) => void): void {
    if (!pool?.isValid || pool.getChildByName(CEILING_LIGHT_NODE_NAME)) {
        return;
    }
    const centers = fixtureCenters();
    const coreGeometry = buildCoreGeometry(centers);
    const haloGeometry = buildHaloGeometry(centers);

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
    setupCameraFlare(pool, centers, camera, glowMaterial);
    debug?.(
        `ceiling light ring attached fixtures=${centers.length}`
        + ` coreTris=${coreGeometry.indices.length / 3} glowTris=${haloGeometry.indices.length / 3} drawCalls=2`,
    );
}
