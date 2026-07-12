import { Camera, Color, Layers, Material, MeshRenderer, Node, primitives, RenderTexture, utils, Vec3, view } from 'cc';
import { SWIMMER_LAYER, UNDERWATER_LAYER } from './WaterSurfaceBinder';

const REFRACTION_CAMERA_NAME = 'WaterRefractionCamera';
const SWIMMER_CAMERA_NAME = 'SwimmerOverlayCamera';
const TINT_PLANE_NAME = 'UnderwaterTintPlane';
const WATER_SURFACE_NODE_NAME = 'PoolWaterSurface';
// Half-resolution refraction target: the wobble hides the softness and it keeps
// the extra render pass cheap enough for WeChat Mini Game.
const REFRACTION_RT_SCALE = 0.75;
const MIN_RT_SIZE = 16;
// Re-tag swimmer subtrees onto SWIMMER_LAYER periodically to catch async-loaded
// character models and rebuilt rosters.
const SWIMMER_TAG_INTERVAL = 20;

// Reused scratch vector so per-frame tint-plane positioning allocates nothing.
const _tmpTintPos = new Vec3();

// Drives real screen-space refraction for the pool water. A second camera mirrors
// the active main camera every frame and renders only the underwater scene (pool
// floor, lane lines, submerged swimmers on the DEFAULT layer — the water surface
// is on its own layer and excluded) into a RenderTexture. The water material then
// samples that texture with a wave-driven offset, so everything beneath the
// surface is genuinely bent/distorted from any camera angle.
export class WaterRefractionController {
    private _refractionCamera: Camera | null = null;
    private _swimmerCamera: Camera | null = null;
    private _tintPlanes: Node[] = [];
    private _sceneParent: Node | null = null;
    private _waterY = 0;
    private _renderTexture: RenderTexture | null = null;
    private _mainCamera: Camera | null = null;
    private _pool: Node | null = null;
    private _waterNode: Node | null = null;
    private _boundMaterial: Material | null = null;
    private _getSwimmerNodes: (() => Node[]) | null = null;
    private _rtWidth = 0;
    private _rtHeight = 0;
    private _frame = 0;
    private readonly _debug?: (message: string) => void;

    constructor(debug?: (message: string) => void) {
        this._debug = debug;
    }

    // mainCameraNode: the single camera the director drives. getSwimmerNodes:
    // returns the current swimmer root nodes to re-tag onto SWIMMER_LAYER.
    // waterY / poolCenterX: place the underwater tint plane at the surface.
    setup(mainCameraNode: Node, pool: Node, getSwimmerNodes: () => Node[], waterY: number, poolCenterX: number): boolean {
        const mainCamera = mainCameraNode?.getComponent(Camera);
        if (!mainCamera || !pool?.isValid) {
            return false;
        }
        this._mainCamera = mainCamera;
        this._pool = pool;
        this._getSwimmerNodes = getSwimmerNodes;

        const size = view.getVisibleSize();
        this._rtWidth = Math.max(MIN_RT_SIZE, Math.round(size.width * REFRACTION_RT_SCALE));
        this._rtHeight = Math.max(MIN_RT_SIZE, Math.round(size.height * REFRACTION_RT_SCALE));
        const rt = new RenderTexture('PoolWaterRefraction');
        rt.reset({ width: this._rtWidth, height: this._rtHeight });
        this._renderTexture = rt;

        // Create the refraction camera as an INDEPENDENT top-level camera (a
        // sibling of the main camera under sceneRoot), NOT nested under the main
        // camera. A nested child camera has its node transform inherited but the
        // render pipeline does not reliably re-render it to its RenderTexture each
        // frame (the RT freezes on the first frame). An independent camera is
        // ticked every frame; syncCamera() copies the main camera's world
        // transform so it still tracks the view exactly.
        const parent = mainCameraNode.parent ?? mainCameraNode;
        const cameraNode = new Node(REFRACTION_CAMERA_NAME);
        cameraNode.setParent(parent);
        cameraNode.layer = Layers.Enum.DEFAULT;
        const camera = cameraNode.addComponent(Camera);
        // Render ONLY the underwater layer (pool floor/walls). Swimmers are NOT
        // rendered into the RT: the refraction camera has no water plane to clip
        // them, so it would capture their above-water parts too and the opaque
        // water would draw those as if submerged (looks wrong). Instead the water
        // is semi-transparent, so the main-rendered swimmer shows through it with
        // a correct above/below split handled by geometry + depth testing.
        camera.visibility = UNDERWATER_LAYER;
        camera.clearFlags = mainCamera.clearFlags;
        camera.clearColor = mainCamera.clearColor;
        // Lower priority renders before the main camera each frame.
        camera.priority = mainCamera.priority - 1;
        camera.targetTexture = rt;
        this._refractionCamera = camera;

        // Swimmer overlay camera: renders ONLY the swimmer layer, on top of the
        // opaque water (clearFlags DEPTH_ONLY keeps the main camera's colour and
        // clears depth so swimmers always draw over the water instead of being
        // hidden by it). Priority is after the main camera.
        const swimmerNode = new Node(SWIMMER_CAMERA_NAME);
        swimmerNode.setParent(parent);
        swimmerNode.layer = Layers.Enum.DEFAULT;
        const swimmerCamera = swimmerNode.addComponent(Camera);
        swimmerCamera.visibility = SWIMMER_LAYER;
        // DONT_CLEAR keeps BOTH the main camera's colour and its DEPTH buffer.
        // Keeping depth means swimmers are correctly occluded by opaque geometry
        // the main camera drew (lane float ropes, deck, pool edges — they write
        // depth), while the opaque water does NOT write depth (depthWrite:false),
        // so it still doesn't hide the submerged swimmer.
        swimmerCamera.clearFlags = Camera.ClearFlag.DONT_CLEAR;
        swimmerCamera.clearColor = mainCamera.clearColor;
        swimmerCamera.priority = mainCamera.priority + 1;
        this._swimmerCamera = swimmerCamera;

        // Underwater tint quads: one small horizontal blue plane PER swimmer,
        // repositioned every frame to sit at the water surface directly above
        // that swimmer (see syncTintPlanes). A single pool-wide plane was wrong:
        // rendered by the swimmer camera over the whole final image, it darkened
        // ALL the water and dimmed the splash particles. Per-swimmer quads tint
        // only each swimmer's submerged body and leave the rest of the pool clear.
        this._sceneParent = parent;
        this._waterY = waterY;

        this.syncCamera();

        this._debug?.(`water refraction ready rt=${this._rtWidth}x${this._rtHeight}`);
        return true;
    }

    update() {
        if (!this._refractionCamera || !this._mainCamera) {
            return;
        }
        this.resizeIfNeeded();
        this.syncCamera();
        this.ensureMaterialBound();
        this._frame += 1;
        if (this._frame % SWIMMER_TAG_INTERVAL === 0) {
            this.tagSwimmers();
        }
    }

    // Move swimmer subtrees onto SWIMMER_LAYER so only the swimmer camera draws
    // them. Re-run periodically because character models load asynchronously and
    // the roster can rebuild (restart).
    private tagSwimmers() {
        const nodes = this._getSwimmerNodes?.() ?? [];
        for (const node of nodes) {
            if (node?.isValid) {
                setLayerRecursive(node, SWIMMER_LAYER);
            }
        }
    }

    // Keep one small tint quad per swimmer, parked at the water surface directly
    // above each swimmer so it tints only that swimmer's submerged body.
    private syncTintPlanes() {
        const parent = this._sceneParent;
        if (!parent?.isValid) {
            return;
        }
        const nodes = this._getSwimmerNodes?.() ?? [];
        while (this._tintPlanes.length < nodes.length) {
            this._tintPlanes.push(buildTintPlane(parent));
        }
        for (let i = 0; i < this._tintPlanes.length; i++) {
            const plane = this._tintPlanes[i];
            if (!plane?.isValid) {
                continue;
            }
            const swimmer = nodes[i];
            if (swimmer?.isValid) {
                swimmer.getWorldPosition(_tmpTintPos);
                plane.setWorldPosition(_tmpTintPos.x, this._waterY - 0.02, _tmpTintPos.z);
                if (!plane.active) {
                    plane.active = true;
                }
            } else if (plane.active) {
                plane.active = false;
            }
        }
    }

    dispose() {
        if (this._refractionCamera?.isValid) {
            this._refractionCamera.targetTexture = null;
        }
        if (this._refractionCamera?.node?.isValid) {
            this._refractionCamera.node.destroy();
        }
        if (this._swimmerCamera?.node?.isValid) {
            this._swimmerCamera.node.destroy();
        }
        for (const plane of this._tintPlanes) {
            if (plane?.isValid) {
                plane.destroy();
            }
        }
        this._tintPlanes = [];
        this._renderTexture?.destroy();
        this._refractionCamera = null;
        this._swimmerCamera = null;
        this._sceneParent = null;
        this._renderTexture = null;
        this._mainCamera = null;
        this._pool = null;
        this._waterNode = null;
        this._boundMaterial = null;
        this._getSwimmerNodes = null;
    }

    // Copy the main camera's world transform and projection every frame so both
    // the refraction RT and the swimmer overlay are rendered from the exact same
    // viewpoint as the on-screen view, in every camera mode.
    private syncCamera() {
        const main = this._mainCamera;
        if (!main?.isValid) {
            return;
        }
        mirrorCamera(main, this._refractionCamera);
        mirrorCamera(main, this._swimmerCamera);
    }

    private resizeIfNeeded() {
        const size = view.getVisibleSize();
        const width = Math.max(MIN_RT_SIZE, Math.round(size.width * REFRACTION_RT_SCALE));
        const height = Math.max(MIN_RT_SIZE, Math.round(size.height * REFRACTION_RT_SCALE));
        if (width === this._rtWidth && height === this._rtHeight) {
            return;
        }
        this._rtWidth = width;
        this._rtHeight = height;
        // Use resize(), NOT reset(). reset() destroys and recreates the RT's
        // RenderWindow without notifying the camera, leaving the camera bound to
        // the dead window (its target never re-renders -> the RT freezes). resize()
        // keeps the same window, resizes it and emits 'resize' which the camera
        // listens to (setFixedSize), so rendering keeps flowing.
        this._renderTexture?.resize(width, height);
        // Rebind so the sampler points at the resized window's texture.
        this._boundMaterial = null;
    }

    // The runtime water material is created asynchronously by WaterSurfaceBinder,
    // replacing the placeholder material that ships in the GLB. Track the water
    // node and rebind the RT whenever the rendered material instance changes, so
    // we always inject the refraction texture into the live material (binding to
    // the stale placeholder once would leave the water sampling default grey).
    private ensureMaterialBound() {
        if (!this._pool?.isValid || !this._renderTexture) {
            return;
        }
        if (!this._waterNode?.isValid) {
            this._waterNode = findNodeByName(this._pool, WATER_SURFACE_NODE_NAME);
            if (!this._waterNode) {
                return;
            }
        }
        const material = this._waterNode.getComponent(MeshRenderer)?.getSharedMaterial(0) ?? null;
        if (!material) {
            return;
        }
        // Re-apply the RenderTexture every frame. This is cheap and guards against
        // two things: (1) the runtime material replacing the GLB placeholder
        // asynchronously, and (2) the RT recreating its underlying GPU texture on
        // its first real render, which would otherwise leave the sampler pointing
        // at a stale (frozen) texture handle.
        material.setProperty('refractionMap', this._renderTexture);
        if (material !== this._boundMaterial) {
            this._boundMaterial = material;
            this._debug?.('water refraction map bound to material');
        }
    }
}

function findNodeByName(root: Node, name: string): Node | null {
    if (root.name === name) {
        return root;
    }
    for (const child of root.children) {
        const found = findNodeByName(child, name);
        if (found) {
            return found;
        }
    }
    return null;
}

function setLayerRecursive(node: Node, layer: number) {
    node.layer = layer;
    for (const child of node.children) {
        setLayerRecursive(child, layer);
    }
}

function mirrorCamera(main: Camera, target: Camera | null) {
    if (!target?.isValid) {
        return;
    }
    target.node.setWorldPosition(main.node.worldPosition);
    target.node.setWorldRotation(main.node.worldRotation);
    target.projection = main.projection;
    target.fovAxis = main.fovAxis;
    target.fov = main.fov;
    target.orthoHeight = main.orthoHeight;
    target.near = main.near;
    target.far = main.far;
}

// A small horizontal semi-transparent blue quad. One is parked at the water
// surface directly above each swimmer (positioned every frame by
// syncTintPlanes), so depth testing tints only that swimmer's submerged body
// blue while leaving the rest of the pool water and splash particles untouched.
function buildTintPlane(parent: Node): Node {
    const node = new Node(TINT_PLANE_NAME);
    node.setParent(parent);
    node.layer = SWIMMER_LAYER;
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.createMesh(primitives.plane({ width: 3.0, length: 1.6, widthSegments: 1, lengthSegments: 1 }));
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit', technique: 1 });
    material.setProperty('mainColor', new Color(36, 126, 210, 132));
    renderer.setMaterial(material, 0);
    return node;
}
