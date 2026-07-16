import { Camera, Color, Layers, Material, MeshRenderer, Node, RenderTexture, Vec3, Vec4, view } from 'cc';
import { EDITOR } from 'cc/env';
import { SWIMMER_LAYER, UNDERWATER_LAYER } from './WaterSurfaceBinder';

const REFRACTION_CAMERA_NAME = 'WaterRefractionCamera';
const SWIMMER_CAMERA_NAME = 'SwimmerOverlayCamera';
const WATER_SURFACE_NODE_NAME = 'PoolWaterSurface';
// Name of the runtime water material created by WaterSurfaceBinder. Only this
// material's effect carries the refraction/disturbance uniforms, so we gate
// per-frame uniform writes on it (the GLB placeholder material lacks them).
const RUNTIME_WATER_MATERIAL_NAME = 'RuntimePoolWater';
// Refraction target resolution scale. Lower saves fill/bandwidth but the pool
// floor's thin lane lines alias badly below ~0.75, so keep it here; the
// wave-driven UV offset hides the remaining softness.
const REFRACTION_RT_SCALE = 0.75;
const MIN_RT_SIZE = 16;
// Re-tag swimmer subtrees onto SWIMMER_LAYER periodically to catch async-loaded
// character models and rebuilt rosters.
const SWIMMER_TAG_INTERVAL = 20;
// Frames to keep re-applying the RT to the water material after it is (re)created
// or resized, covering the GPU texture handle changing on the first real render.
const REBIND_WARMUP_FRAMES = 4;
// Local-turbulence: must match MAX_DISTURB in RagingPoolWater.effect. Each slot
// is a swimmer's world XZ (xy) + strength (z). disturbParams: x = influence
// radius (world units of churn around a swimmer), y = chaotic ripple frequency,
// z = churn strength added to the refraction offset, w = churn animation speed.
const MAX_DISTURB = 8;
const DISTURB_RADIUS = 1.7;
const DISTURB_FREQUENCY = 9.0;
const DISTURB_STRENGTH = 1.15;
const DISTURB_SPEED = 4.2;
// Pool-bottom recolour that swaps with the camera: ABOVE water the floor/walls are
// deep pool BLUE (so the surface reads as rich blue water); UNDER water they turn
// light/WHITE so the submerged view stays a legible natural pool instead of a blue
// blur. Lane lines stay dark in both. First matching prefix wins.
const FLOOR_TINT: { prefix: string; above: Color; below: Color }[] = [
    { prefix: 'lane_floor_line', above: new Color(8, 12, 20, 255), below: new Color(26, 32, 42, 255) },
    { prefix: 'lane_t_end', above: new Color(8, 12, 20, 255), below: new Color(26, 32, 42, 255) },
    { prefix: 'pool_tile_grout', above: new Color(18, 100, 182, 255), below: new Color(176, 198, 216, 255) },
    { prefix: 'pool_inner_wall', above: new Color(38, 146, 222, 255), below: new Color(220, 234, 246, 255) },
    { prefix: 'pool_floor', above: new Color(24, 126, 210, 255), below: new Color(232, 242, 249, 255) },
];

// Drives real screen-space refraction for the pool water. A second camera mirrors
// the active main camera every frame and renders only the underwater scene (pool
// floor, lane lines, submerged swimmers on the DEFAULT layer — the water surface
// is on its own layer and excluded) into a RenderTexture. The water material then
// samples that texture with a wave-driven offset, so everything beneath the
// surface is genuinely bent/distorted from any camera angle.
export class WaterRefractionController {
    private _refractionCamera: Camera | null = null;
    private _swimmerCamera: Camera | null = null;
    private _renderTexture: RenderTexture | null = null;
    private _mainCamera: Camera | null = null;
    private _pool: Node | null = null;
    private _waterNode: Node | null = null;
    private _boundMaterial: Material | null = null;
    private _getSwimmerNodes: (() => Node[]) | null = null;
    private _rtWidth = 0;
    private _rtHeight = 0;
    // Frames to keep re-applying the RT after (re)creation. The RT can recreate
    // its underlying GPU texture on its first real render, so we rebind for a few
    // frames instead of every frame; steady state does no per-frame rebinding.
    private _rebindFrames = 0;
    private _frame = 0;
    // Reused local-turbulence buffers so the per-frame uniform write allocates
    // nothing. _disturb is uploaded to the water shader's swimmerDisturb[] array.
    private readonly _disturb: Vec4[] = [];
    private readonly _disturbParams = new Vec4(DISTURB_RADIUS, DISTURB_FREQUENCY, DISTURB_STRENGTH, DISTURB_SPEED);
    private readonly _tmpPos = new Vec3();
    // Pool-bottom materials whose colour swaps with the camera crossing the water
    // line (see FLOOR_TINT). _floorUnderwater tracks the current applied set.
    private readonly _floorTints: { material: Material; above: Color; below: Color }[] = [];
    private _waterY = 0;
    private _floorUnderwater: boolean | null = null;
    private _underwaterViewActive = false;
    private _waterActiveBeforeUnderwater = true;
    private readonly _debug?: (message: string) => void;

    constructor(debug?: (message: string) => void) {
        this._debug = debug;
        for (let i = 0; i < MAX_DISTURB; i++) {
            this._disturb.push(new Vec4(0, 0, 0, 0));
        }
    }

    // mainCameraNode: the single camera the director drives. getSwimmerNodes:
    // returns the current swimmer root nodes to re-tag onto SWIMMER_LAYER.
    setup(mainCameraNode: Node, pool: Node, getSwimmerNodes: () => Node[]): boolean {
        // WaterSurfaceBinder hides the pool surface in the editor because its
        // embedded preview does not refresh off-screen cameras reliably. Skip the
        // whole refraction stack as well, so no RenderTexture or extra cameras are
        // created and swimmers remain on the main camera's default layer.
        if (EDITOR) {
            this._debug?.('water refraction skipped in editor');
            return false;
        }
        const mainCamera = mainCameraNode?.getComponent(Camera);
        if (!mainCamera || !pool?.isValid) {
            return false;
        }
        this._mainCamera = mainCamera;
        this._pool = pool;
        this._getSwimmerNodes = getSwimmerNodes;

        const waterNode = findNodeByName(pool, WATER_SURFACE_NODE_NAME);
        this._waterNode = waterNode;
        this._waterActiveBeforeUnderwater = waterNode?.active ?? true;
        this._waterY = waterNode?.isValid ? waterNode.worldPosition.y : 0.1;
        this.collectFloorTints(pool);

        const size = view.getVisibleSize();
        this._rtWidth = Math.max(MIN_RT_SIZE, Math.round(size.width * REFRACTION_RT_SCALE));
        this._rtHeight = Math.max(MIN_RT_SIZE, Math.round(size.height * REFRACTION_RT_SCALE));
        const rt = new RenderTexture('PoolWaterRefraction');
        rt.reset({ width: this._rtWidth, height: this._rtHeight });
        this._renderTexture = rt;
        this._rebindFrames = REBIND_WARMUP_FRAMES;

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

        // Tag the already-created player/effects immediately. The periodic pass
        // below still catches deferred AI and asynchronously-created children.
        this.tagSwimmers();
        this.syncCamera();

        this._debug?.(`water refraction ready rt=${this._rtWidth}x${this._rtHeight}`);
        return true;
    }

    update() {
        if (!this._refractionCamera || !this._mainCamera) {
            return;
        }
        this.syncCamera();
        if (!this._underwaterViewActive) {
            this.resizeIfNeeded();
            this.ensureMaterialBound();
        }
        this.updateFloorTint();
        this._frame += 1;
        if (this._frame % SWIMMER_TAG_INTERVAL === 0) {
            this.tagSwimmers();
        }
    }

    // The refracting surface is only meaningful when viewed from above. Hide it
    // for dedicated underwater camera shots so it cannot cut across the view,
    // and pause the now-unused refraction RenderTexture camera. The swimmer
    // overlay camera deliberately stays enabled because swimmer render roots live
    // on its private layer in both above-water and underwater shots.
    setUnderwaterViewActive(active: boolean) {
        if (active === this._underwaterViewActive) {
            return;
        }
        if (active) {
            if (this._waterNode?.isValid) {
                this._waterActiveBeforeUnderwater = this._waterNode.active;
                this._waterNode.active = false;
            }
            if (this._refractionCamera?.isValid) {
                this._refractionCamera.enabled = false;
            }
        } else {
            if (this._waterNode?.isValid) {
                this._waterNode.active = this._waterActiveBeforeUnderwater;
            }
            if (this._refractionCamera?.isValid) {
                this._refractionCamera.enabled = true;
            }
            // Force a short rebind after the off-screen camera resumes so a
            // resized or recreated GPU texture cannot leave a stale sampler.
            this._boundMaterial = null;
            this._rebindFrames = REBIND_WARMUP_FRAMES;
        }
        this._underwaterViewActive = active;
        this._debug?.(`water surface ${active ? 'hidden for underwater camera' : 'restored above water'}`);
    }

    // Collect the pool-bottom renderers matching FLOOR_TINT, give each an unlit
    // material initialised to the ABOVE-water (blue) colour, and remember the
    // material + both colours so updateFloorTint() can swap them per frame.
    private collectFloorTints(pool: Node) {
        this._floorTints.length = 0;
        const walk = (node: Node) => {
            const name = node.name.toLowerCase();
            const match = FLOOR_TINT.find((entry) => name.startsWith(entry.prefix));
            if (match) {
                const renderer = node.getComponent(MeshRenderer);
                if (renderer) {
                    const slots = renderer.sharedMaterials.length || 1;
                    for (let i = 0; i < slots; i++) {
                        const material = new Material();
                        material.initialize({ effectName: 'builtin-unlit' });
                        material.name = `RuntimeFloor_${node.name}`;
                        material.setProperty('mainColor', match.above.clone());
                        renderer.setMaterial(material, i);
                        this._floorTints.push({ material, above: match.above, below: match.below });
                    }
                }
            }
            for (const child of node.children) {
                walk(child);
            }
        };
        walk(pool);
        this._floorUnderwater = null;
    }

    // Swap the pool-bottom colours when the camera crosses the water line: blue
    // above (rich water look), light/white below (legible underwater view).
    private updateFloorTint() {
        if (this._floorTints.length <= 0 || !this._mainCamera?.node?.isValid) {
            return;
        }
        const underwater = this._mainCamera.node.worldPosition.y < this._waterY;
        if (underwater === this._floorUnderwater) {
            return;
        }
        this._floorUnderwater = underwater;
        for (const tint of this._floorTints) {
            if (tint.material?.isValid) {
                tint.material.setProperty('mainColor', underwater ? tint.below : tint.above);
            }
        }
    }

    // Move swimmer body and splash subtrees onto SWIMMER_LAYER so only the same
    // overlay camera draws them. Re-run periodically because character models,
    // splash particles and the roster can all be created asynchronously.
    private tagSwimmers() {
        const nodes = this._getSwimmerNodes?.() ?? [];
        for (const node of nodes) {
            if (node?.isValid) {
                setLayerRecursive(node, SWIMMER_LAYER);
            }
        }
    }

    dispose() {
        if (this._underwaterViewActive && this._waterNode?.isValid) {
            this._waterNode.active = this._waterActiveBeforeUnderwater;
        }
        if (this._refractionCamera?.isValid) {
            this._refractionCamera.enabled = true;
            this._refractionCamera.targetTexture = null;
        }
        if (this._refractionCamera?.node?.isValid) {
            this._refractionCamera.node.destroy();
        }
        if (this._swimmerCamera?.node?.isValid) {
            this._swimmerCamera.node.destroy();
        }
        this._renderTexture?.destroy();
        this._refractionCamera = null;
        this._swimmerCamera = null;
        this._renderTexture = null;
        this._mainCamera = null;
        this._pool = null;
        this._waterNode = null;
        this._boundMaterial = null;
        this._getSwimmerNodes = null;
        this._floorTints.length = 0;
        this._floorUnderwater = null;
        this._underwaterViewActive = false;
        this._waterActiveBeforeUnderwater = true;
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
        this._rebindFrames = REBIND_WARMUP_FRAMES;
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
        // Only the runtime water material (RuntimePoolWater) carries the
        // refractionMap sampler. Skip the GLB placeholder that ships on the node
        // before WaterSurfaceBinder swaps the real material in, otherwise
        // setProperty logs "illegal property name: refractionMap" every frame.
        if (!material || material.name !== RUNTIME_WATER_MATERIAL_NAME) {
            return;
        }
        // Re-apply the RenderTexture every frame so runtime resize or GPU texture
        // handle changes cannot leave the sampler pointing at a stale texture.
        material.setProperty('refractionMap', this._renderTexture);
        const changed = material !== this._boundMaterial;
        if (changed) {
            this._boundMaterial = material;
            this._debug?.('water refraction map bound to material');
        }
        this.updateSwimmerDisturbance(material, changed);
    }

    // Feed each swimmer's world XZ into the water shader's swimmerDisturb[] so the
    // surface churns finely around them (see RagingPoolWater.effect). Gated on the
    // runtime water material, which is the only one carrying these uniforms.
    private updateSwimmerDisturbance(material: Material, justBound: boolean) {
        if (material.name !== RUNTIME_WATER_MATERIAL_NAME) {
            return;
        }
        if (justBound) {
            material.setProperty('disturbParams', this._disturbParams);
        }
        const nodes = this._getSwimmerNodes?.() ?? [];
        for (let i = 0; i < MAX_DISTURB; i++) {
            const slot = this._disturb[i];
            const node = nodes[i];
            if (node?.isValid) {
                node.getWorldPosition(this._tmpPos);
                slot.set(this._tmpPos.x, this._tmpPos.z, 1.0, 0.0);
            } else {
                slot.set(0, 0, 0, 0);
            }
        }
        material.setProperty('swimmerDisturb', this._disturb);
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
