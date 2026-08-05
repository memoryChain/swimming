import { Camera, Color, director, EffectAsset, Layers, Material, MeshRenderer, Node, RenderTexture, Texture2D, Vec3, Vec4, view } from 'cc';
import { EDITOR } from 'cc/env';
import { SWIMMER_LAYER, UNDERWATER_LAYER, WATER_SURFACE_LAYER } from './WaterSurfaceBinder';
import { WATER_COLOR_TUNING, registerFloorTintApplier, setSwimmerReflectClip } from './WaterColorTuning';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

const REFRACTION_CAMERA_NAME = 'WaterRefractionCamera';
const SWIMMER_CAMERA_NAME = 'SwimmerOverlayCamera';
const REFLECTION_CAMERA_NAME = 'WaterReflectionCamera';
const WATER_SURFACE_NODE_NAME = 'PoolWaterSurface';
// Name of the runtime water material created by WaterSurfaceBinder. Only this
// material's effect carries the refraction/disturbance uniforms, so we gate
// per-frame uniform writes on it (the GLB placeholder material lacks them).
const RUNTIME_WATER_MATERIAL_NAME = 'RuntimePoolWater';
// Refraction target resolution scale. Lower saves fill/bandwidth but the pool
// floor's thin lane lines alias badly below ~0.75, so keep it here; the
// wave-driven UV offset hides the remaining softness.
const REFRACTION_RT_SCALE = 0.45;
const MIN_RT_SIZE = 16;
// Planar reflection RenderTexture scale. The reflection is heavily wobbled and
// tinted, so it tolerates a lower resolution than the refraction floor.
const REFLECTION_RT_SCALE = 0.5;
// Only render the reflection pass when the main camera is at/below this height
// above the water surface. Normal above-water broadcast shots never pay for the
// extra camera; it switches on exactly when the underside-of-water mirror can be
// seen (camera near/below the surface).
const REFLECTION_ACTIVE_MARGIN = 0.6;
// How far ahead of the camera the mirror look-at point is projected before being
// reflected across the water plane.
const REFLECTION_LOOK_AHEAD = 6.0;
// Deep pool blue the reflection camera clears to, so empty areas of the mirror
// (no geometry) read as water rather than black.
const REFLECTION_CLEAR_COLOR = new Color(9, 46, 82, 255);
// Underwater depth fog (engine linear fog) enabled only for dedicated underwater
// camera shots. Gives the whole submerged scene a "the further, the bluer" look.
const UNDERWATER_FOG_COLOR = new Color(10, 74, 130, 255);
// Start the fog several metres out so the near view stays crisp/clear (like the
// reference) instead of a hazy veil right at the camera; only the distance goes
// deep blue.
const UNDERWATER_FOG_START = 5.0;
const UNDERWATER_FOG_END = 24.0;
// Re-tag swimmer subtrees onto SWIMMER_LAYER periodically to catch async-loaded
// character models and rebuilt rosters.
const SWIMMER_TAG_INTERVAL = 20;
// Async swimmer models and splash nodes arrive during scene startup. Once that
// window closes, the roster is stable across race restarts, so recursive layer
// tagging must stop instead of producing a periodic JS spike throughout a race.
const SWIMMER_TAG_WARMUP_FRAMES = 90;
// Frames to keep re-applying the RT to the water material after it is (re)created
// or resized, covering the GPU texture handle changing on the first real render.
const REBIND_WARMUP_FRAMES = 4;
// Local-turbulence: must match MAX_DISTURB in RagingPoolWater.effect. Each slot
// is a swimmer's world XZ (xy) + strength (z). disturbParams: x = influence
// radius (world units of churn around a swimmer), y = chaotic ripple frequency,
// z = churn strength added to the refraction offset, w = enabled. The expensive
// eight-swimmer branch is enabled only for top-view shots.
const MAX_DISTURB = 8;
const DISTURB_RADIUS = 1.7;
const DISTURB_FREQUENCY = 9.0;
const DISTURB_STRENGTH = 1.15;
// Pool-bottom recolour that swaps with the camera: ABOVE water the floor/walls are
// deep pool BLUE (so the surface reads as rich blue water); UNDER water they turn
// light/WHITE so the submerged view stays a legible natural pool instead of a blue
// blur. Lane lines stay dark in both. First matching prefix wins.
const FLOOR_TINT: { prefix: string; above: Color; belowKind: FloorBelowKind }[] = [
    { prefix: 'lane_floor_line', above: new Color(8, 12, 20, 255), belowKind: 'line' },
    { prefix: 'lane_t_end', above: new Color(8, 12, 20, 255), belowKind: 'line' },
    // Underwater below-colours are a clean, saturated pool blue (not a pale cyan
    // and not a heavy/gray wash): the camera reads a vivid blue pool. The base
    // floor blue is tunable ('水色' → 池底蓝 sliders); walls/grout are derived
    // shades of it; lane lines stay dark for contrast.
    { prefix: 'pool_tile_grout', above: new Color(88, 181, 160, 255), belowKind: 'grout' },
    { prefix: 'pool_inner_wall', above: new Color(126, 208, 182, 255), belowKind: 'wall' },
    { prefix: 'pool_floor', above: new Color(118, 202, 174, 255), belowKind: 'floor' },
];

type FloorBelowKind = 'floor' | 'wall' | 'grout' | 'line';

// Submerged floor colour from the live WATER_COLOR_TUNING floor sliders. Walls
// and grout are proportional shades of the base floor blue.
function computeFloorBelowColor(kind: FloorBelowKind): Color {
    const r = WATER_COLOR_TUNING.floorR;
    const g = WATER_COLOR_TUNING.floorG;
    const b = WATER_COLOR_TUNING.floorB;
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    switch (kind) {
        case 'wall': return new Color(c(r * 0.89), c(g * 0.92), c(b * 0.97), 255);
        case 'grout': return new Color(c(r * 0.67), c(g * 0.76), c(b * 0.86), 255);
        case 'line': return new Color(24, 52, 84, 255);
        case 'floor':
        default: return new Color(c(r), c(g), c(b), 255);
    }
}

// The deep blue the far end of the floor fades toward UNDERWATER (distance
// gradient). Kept fairly bright and low-saturation (the darkening multipliers are
// gentle and even) so the far end reads as a lighter deep blue, not a dark wash;
// alpha = far-blend strength.
function computeFloorDeepColor(): Color {
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    return new Color(
        c(WATER_COLOR_TUNING.floorR * 0.66),
        c(WATER_COLOR_TUNING.floorG * 0.74),
        c(WATER_COLOR_TUNING.floorB * 0.84),
        c(WATER_COLOR_TUNING.floorFarStrength * 255),
    );
}

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
    // Planar-reflection pass: mirrors the main camera across the water plane and
    // renders the underwater scene (floor + swimmers) so the underside of the
    // surface reads as a rippling mirror. Rendered only when the camera is
    // near/below the water surface.
    private _reflectionCamera: Camera | null = null;
    private _reflectionRT: RenderTexture | null = null;
    private _reflWidth = 0;
    private _reflHeight = 0;
    private _reflectionActive = false;
    private _waterY = 0.055;
    // x = mirror strength, y = flip U (mirror is horizontally reversed by the
    // right-handed lookAt of the mirror camera, so default 1), z = flip V,
    // w = extra wobble scale.
    private readonly _reflectionParams = new Vec4(0.9, 1, 0, 1.6);
    private readonly _tmpCamPos = new Vec3();
    private readonly _tmpFwd = new Vec3();
    private readonly _tmpUp = new Vec3();
    private readonly _tmpAhead = new Vec3();
    private readonly _tmpReflPos = new Vec3();
    private readonly _tmpReflAhead = new Vec3();
    private readonly _tmpReflUp = new Vec3();
    // Saved scene fog state so the dedicated-underwater blue fog can be restored
    // when the camera surfaces.
    private _fogSaved = false;
    private _fogPrevEnabled = false;
    private _fogPrevType = 0;
    private readonly _fogPrevColor = new Color();
    private _fogPrevStart = 0;
    private _fogPrevEnd = 0;
    // Frames to keep re-applying the RT after (re)creation. The RT can recreate
    // its underlying GPU texture on its first real render, so we rebind for a few
    // frames instead of every frame; steady state does no per-frame rebinding.
    private _rebindFrames = 0;
    private _frame = 0;
    // Reused local-turbulence buffers so the per-frame uniform write allocates
    // nothing. _disturb is uploaded to the water shader's swimmerDisturb[] array.
    private readonly _disturb: Vec4[] = [];
    private readonly _disturbParams = new Vec4(DISTURB_RADIUS, DISTURB_FREQUENCY, DISTURB_STRENGTH, 0);
    private _swimmerDisturbanceActive = false;
    private _swimmerDisturbanceStateDirty = true;
    // x/y are the safe corridor's world-Z edges, z is the boundary half-width,
    // and w enables the material-side locked lane mask.
    private readonly _laneLockdownParams = new Vec4(0, 0, 0.075, 0);
    // A pending corridor is rendered independently so its warning boundary does
    // not remove the closed-water mask from an earlier lock stage.
    private readonly _laneLockdownWarningParams = new Vec4(0, 0, 0.075, 0);
    private _laneLockdownParamsDirty = true;
    private readonly _tmpPos = new Vec3();
    // Pool-bottom materials whose colour swaps with the underwater camera mode
    // (see FLOOR_TINT). _floorUnderwater tracks the current applied set.
    private readonly _floorTints: { material: Material; above: Color; belowKind: FloorBelowKind }[] = [];
    // Optional custom effect that adds the near-clear -> far-deep-blue distance
    // gradient to the submerged floor (loaded async; falls back to builtin-unlit).
    private _floorDepthEffect: EffectAsset | null = null;
    private _floorHasDepth = false;
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
        if (waterNode?.isValid) {
            waterNode.getWorldPosition(this._tmpPos);
            this._waterY = this._tmpPos.y;
        }
        this.collectFloorTints(pool);
        // Let the '水色' floor sliders re-tint the submerged floor live.
        registerFloorTintApplier(() => this.applyFloorTuning());
        // Upgrade the submerged floor to the distance-gradient effect (near clear,
        // far deep blue) once it loads. Until then the builtin-unlit fallback
        // renders a uniform blue; on load the floor materials are rebuilt.
        loadRaceAsset(RESOURCE_PATHS.underwaterFloorEffect, EffectAsset, (err, effect) => {
            if (err || !effect || !this._pool?.isValid) {
                return;
            }
            this.setFloorDepthEffect(effect);
        });

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

        // Planar-reflection camera: mirrors the main camera across the water
        // plane each frame and renders the underwater scene (pool floor +
        // swimmers) into its own RenderTexture. The water material samples that
        // texture in the underwater-looking-up branch, so the underside of the
        // surface acts like a rippling mirror. Independent top-level camera (same
        // reasoning as the refraction camera) with its own target texture.
        this._reflWidth = Math.max(MIN_RT_SIZE, Math.round(size.width * REFLECTION_RT_SCALE));
        this._reflHeight = Math.max(MIN_RT_SIZE, Math.round(size.height * REFLECTION_RT_SCALE));
        const reflRt = new RenderTexture('PoolWaterReflection');
        reflRt.reset({ width: this._reflWidth, height: this._reflHeight });
        this._reflectionRT = reflRt;
        const reflNode = new Node(REFLECTION_CAMERA_NAME);
        reflNode.setParent(parent);
        reflNode.layer = Layers.Enum.DEFAULT;
        const reflCamera = reflNode.addComponent(Camera);
        // Reflect the underwater pool AND the swimmers. The swimmers' ABOVE-water
        // parts (head/arms breaking the surface) would ghost in the mirror, so the
        // swimmer shader discards them when it detects it is rendering the
        // reflection (a camera above the surface) via the reflectClipParams flag
        // driven below — a real underwater mirror only reflects what is submerged.
        reflCamera.visibility = UNDERWATER_LAYER | SWIMMER_LAYER;
        reflCamera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        reflCamera.clearColor = REFLECTION_CLEAR_COLOR;
        // Render before the main/refraction cameras; it draws to its own RT.
        reflCamera.priority = mainCamera.priority - 2;
        reflCamera.targetTexture = reflRt;
        // Off until the camera dips near/below the surface (saves the whole pass
        // in normal above-water shots).
        reflCamera.enabled = false;
        this._reflectionCamera = reflCamera;

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
        // The reflection (underside mirror) and the water material binding must
        // run in BOTH above-water and underwater shots: the surface stays visible
        // underwater now so its underside can show the mirror.
        this.updateReflection();
        if (!this._underwaterViewActive) {
            this.resizeIfNeeded();
        }
        this.ensureMaterialBound();
        this._frame += 1;
        if (this._frame <= SWIMMER_TAG_WARMUP_FRAMES && this._frame % SWIMMER_TAG_INTERVAL === 0) {
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
        // The surface visibility, underwater screen tint and pool-tile tint must
        // change on the same camera-mode edge. Driving the tiles independently
        // from camera Y used to expose a whole-pool colour pop while a smoothed
        // dive camera crossed the water line.
        this.applyFloorTint(active);
        // Keep the water surface VISIBLE in underwater shots so its underside
        // renders as a MIRROR (the below-water branch of the shader samples the
        // reflection RT). Previously the surface was hidden here, which is exactly
        // why the reflection never showed underwater. Only the opaque above-water
        // refraction camera is paused; the reflection camera keeps running (it
        // self-gates on the camera being below the surface in updateReflection()).
        if (this._refractionCamera?.isValid) {
            this._refractionCamera.enabled = !active;
        }
        if (!active) {
            // Force a short rebind after the off-screen refraction camera resumes
            // so a resized/recreated GPU texture cannot leave a stale sampler.
            this._boundMaterial = null;
            this._rebindFrames = REBIND_WARMUP_FRAMES;
        }
        // NOTE: engine scene fog is intentionally NOT toggled here. Flipping
        // fog.enabled changes the global CC_USE_FOG shader macro, which forces a
        // full shader-variant recompile of every material on that frame — that was
        // the big hitch when entering the water. The submerged blue instead comes
        // from the clean blue pool floor + the surface mirror (no uniform haze).
        this._underwaterViewActive = active;
        this._debug?.(`water surface ${active ? 'underwater mirror mode' : 'restored above water'}`);
    }

    // Local per-swimmer water churn is only useful from the top view. This is an
    // edge-triggered presentation switch: normal shots skip both the CPU uniform
    // upload and the shader's eight-source disturbance loop.
    setSwimmerDisturbanceActive(active: boolean) {
        if (active === this._swimmerDisturbanceActive) {
            return;
        }
        this._swimmerDisturbanceActive = active;
        this._disturbParams.w = active ? 1 : 0;
        this._swimmerDisturbanceStateDirty = true;
    }

    setLaneLockdownMask(safeMinZ: number, safeMaxZ: number) {
        this._laneLockdownParams.set(
            Math.min(safeMinZ, safeMaxZ),
            Math.max(safeMinZ, safeMaxZ),
            0.075,
            1,
        );
        this._laneLockdownWarningParams.w = 0;
        this._laneLockdownParamsDirty = true;
    }

    setLaneLockdownWarning(safeMinZ: number, safeMaxZ: number) {
        this._laneLockdownWarningParams.set(
            Math.min(safeMinZ, safeMaxZ),
            Math.max(safeMinZ, safeMaxZ),
            0.075,
            1,
        );
        this._laneLockdownParamsDirty = true;
    }

    clearLaneLockdownMask() {
        this._laneLockdownParams.w = 0;
        this._laneLockdownWarningParams.w = 0;
        this._laneLockdownParamsDirty = true;
    }

    // Collect the pool-bottom renderers matching FLOOR_TINT, give each an unlit
    // material initialised to the ABOVE-water (blue) colour, and remember the
    // material + both colours so the camera-mode edge can swap them together.
    private collectFloorTints(pool: Node) {
        this._floorTints.length = 0;
        // Reuse one runtime material for renderers that share both their source
        // material and tint rule. The tint rule is part of the cache key on
        // purpose: pool floor, inner walls and lane markings use different
        // above/underwater colours even when the imported GLB material happens
        // to be shared between them.
        const materialCache: {
            source: Material | null;
            tint: (typeof FLOOR_TINT)[number];
            material: Material;
        }[] = [];
        const walk = (node: Node) => {
            const name = node.name.toLowerCase();
            const match = FLOOR_TINT.find((entry) => name.startsWith(entry.prefix));
            if (match) {
                const renderer = node.getComponent(MeshRenderer);
                if (renderer) {
                    const slots = renderer.sharedMaterials.length || 1;
                    for (let i = 0; i < slots; i++) {
                        const source = renderer.getSharedMaterial(i);
                        let cached = materialCache.find((entry) => entry.source === source && entry.tint === match);
                        if (!cached) {
                            const usesPoolTileTexture = name.startsWith('pool_inner_wall') || name.startsWith('pool_floor');
                            const texture = usesPoolTileTexture ? findMaterialTexture(source) : null;
                            const material = new Material();
                            if (this._floorDepthEffect) {
                                material.initialize(texture
                                    ? { effectAsset: this._floorDepthEffect, defines: { USE_TEXTURE: true } }
                                    : { effectAsset: this._floorDepthEffect });
                            } else {
                                material.initialize(texture
                                    ? { effectName: 'builtin-unlit', defines: { USE_TEXTURE: true } }
                                    : { effectName: 'builtin-unlit' });
                            }
                            material.name = `RuntimeFloor_${match.prefix}`;
                            material.setProperty('mainColor', match.above.clone());
                            if (texture) {
                                texture.setWrapMode(Texture2D.WrapMode.REPEAT, Texture2D.WrapMode.REPEAT);
                                material.setProperty('mainTexture', texture);
                            }
                            cached = { source, tint: match, material };
                            materialCache.push(cached);
                            this._floorTints.push({ material, above: match.above, belowKind: match.belowKind });
                        }
                        renderer.setMaterial(cached.material, i);
                    }
                }
            }
            for (const child of node.children) {
                walk(child);
            }
        };
        walk(pool);
        // Every new runtime material was initialised with its above-water tint.
        this._floorUnderwater = false;
        this._floorHasDepth = !!this._floorDepthEffect;
    }

    // Upgrade the submerged floor to the distance-gradient effect once it has
    // loaded (near = floor blue, far = deep blue). Rebuilds the floor materials
    // with the effect and re-applies the current camera state.
    setFloorDepthEffect(effect: EffectAsset) {
        if (!effect || !this._pool?.isValid) {
            return;
        }
        this._floorDepthEffect = effect;
        const prev = this._floorUnderwater;
        this.collectFloorTints(this._pool);
        this._floorUnderwater = prev ?? false;
        this.refreshFloor();
    }

    // Swap the pool-bottom colours atomically with the camera presentation mode:
    // blue above (rich water look), light/white below (legible underwater view).
    private applyFloorTint(underwater: boolean) {
        if (this._floorTints.length <= 0) {
            return;
        }
        if (underwater === this._floorUnderwater) {
            return;
        }
        this._floorUnderwater = underwater;
        this.refreshFloor();
    }

    // Re-apply the floor near/far colours for the CURRENT camera state (above or
    // below water). Used on '水色' slider edits and after the depth effect loads.
    private applyFloorTuning() {
        if (this._floorTints.length <= 0 || this._floorUnderwater === null) {
            return;
        }
        this.refreshFloor();
    }

    private refreshFloor() {
        const underwater = this._floorUnderwater === true;
        for (const tint of this._floorTints) {
            this.applyFloorMaterial(tint, underwater);
        }
    }

    // Set a floor material's near colour (above-deck or submerged blue) and, when
    // the distance-gradient effect is active, the far colour + range so near reads
    // clear and far fades to a deep colour. Above and below water use DIFFERENT
    // deep colours; lane lines never fade.
    private applyFloorMaterial(
        tint: { material: Material; above: Color; belowKind: FloorBelowKind },
        underwater: boolean,
    ) {
        const material = tint.material;
        if (!material?.isValid) {
            return;
        }
        material.setProperty('mainColor', underwater ? computeFloorBelowColor(tint.belowKind) : tint.above);
        if (this._floorHasDepth) {
            // Only the underwater view uses a distance-based blue gradient; above
            // water the floor keeps a flat color (the distance blue there did not
            // read well), so the gradient is disabled when not underwater.
            const enable = underwater && tint.belowKind !== 'line' ? 1 : 0;
            material.setProperty('depthColor', computeFloorDeepColor());
            material.setProperty('depthParams', new Vec4(
                WATER_COLOR_TUNING.floorFarStart,
                WATER_COLOR_TUNING.floorFarEnd,
                enable,
                0,
            ));
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
        // Clear the swimmer reflection-clip flag: it is module-level state, so
        // leaving a race while underwater would otherwise leave it stuck ON and
        // make the next character preview (prepare screen) discard every fragment
        // (character reads black/invisible).
        setSwimmerReflectClip(false);
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
        if (this._reflectionCamera?.isValid) {
            this._reflectionCamera.targetTexture = null;
        }
        if (this._reflectionCamera?.node?.isValid) {
            this._reflectionCamera.node.destroy();
        }
        this._renderTexture?.destroy();
        this._reflectionRT?.destroy();
        this._refractionCamera = null;
        this._swimmerCamera = null;
        this._reflectionCamera = null;
        this._renderTexture = null;
        this._reflectionRT = null;
        this._reflectionActive = false;
        this._mainCamera = null;
        this._pool = null;
        this._waterNode = null;
        this._boundMaterial = null;
        this._getSwimmerNodes = null;
        this._floorTints.length = 0;
        this._floorUnderwater = null;
        this._floorDepthEffect = null;
        this._floorHasDepth = false;
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

    // Reflect the main camera across the water plane and render the underwater
    // scene into the reflection RT. Gated on the camera being near/below the
    // surface: normal above-water shots disable the whole pass.
    private updateReflection() {
        const refl = this._reflectionCamera;
        const main = this._mainCamera;
        if (!refl?.isValid || !main?.isValid) {
            return;
        }
        main.node.getWorldPosition(this._tmpCamPos);
        // Tell the swimmer shader to clip above-water fragments while the mirror
        // reflection is being drawn. Gated on the MAIN camera being clearly below
        // the surface, so the reflection camera (which sits above the surface) is
        // the only above-water swimmer draw and gets clipped; the direct underwater
        // overlay (camera below) and all above-water/broadcast draws stay intact.
        setSwimmerReflectClip(this._tmpCamPos.y < this._waterY);
        const below = this._tmpCamPos.y < this._waterY + REFLECTION_ACTIVE_MARGIN;
        if (below !== this._reflectionActive) {
            this._reflectionActive = below;
            refl.enabled = below;
        }
        if (!below) {
            return;
        }
        const h = this._waterY;
        // Main camera forward / up in world space.
        Vec3.transformQuat(this._tmpFwd, Vec3.FORWARD, main.node.worldRotation);
        Vec3.transformQuat(this._tmpUp, Vec3.UP, main.node.worldRotation);
        Vec3.scaleAndAdd(this._tmpAhead, this._tmpCamPos, this._tmpFwd, REFLECTION_LOOK_AHEAD);
        // Reflect the eye position, the look-at point and the up vector across
        // the horizontal water plane (y = h). Rendering the real scene from this
        // mirrored viewpoint yields the planar reflection.
        this._tmpReflPos.set(this._tmpCamPos.x, 2 * h - this._tmpCamPos.y, this._tmpCamPos.z);
        this._tmpReflAhead.set(this._tmpAhead.x, 2 * h - this._tmpAhead.y, this._tmpAhead.z);
        this._tmpReflUp.set(this._tmpUp.x, -this._tmpUp.y, this._tmpUp.z);
        refl.node.setWorldPosition(this._tmpReflPos);
        refl.node.lookAt(this._tmpReflAhead, this._tmpReflUp);
        refl.projection = main.projection;
        refl.fovAxis = main.fovAxis;
        refl.fov = main.fov;
        refl.orthoHeight = main.orthoHeight;
        refl.near = main.near;
        refl.far = main.far;
    }

    // Toggle the scene's linear blue fog for dedicated underwater shots, saving
    // and restoring the authored fog so above-water shots are unaffected. This is
    // what makes the submerged scene read "the further, the bluer".
    private setUnderwaterFog(active: boolean) {
        let fog: any = null;
        try {
            fog = director.getScene()?.globals?.fog ?? null;
        } catch {
            fog = null;
        }
        if (!fog) {
            return;
        }
        if (active) {
            if (!this._fogSaved) {
                this._fogPrevEnabled = !!fog.enabled;
                this._fogPrevType = fog.type;
                this._fogPrevColor.set(fog.fogColor);
                this._fogPrevStart = fog.fogStart;
                this._fogPrevEnd = fog.fogEnd;
                this._fogSaved = true;
            }
            fog.type = 0; // FogType.LINEAR (enum not exported from 'cc')
            fog.fogColor = UNDERWATER_FOG_COLOR;
            fog.fogStart = UNDERWATER_FOG_START;
            fog.fogEnd = UNDERWATER_FOG_END;
            fog.enabled = true;
        } else if (this._fogSaved) {
            fog.type = this._fogPrevType;
            fog.fogColor = this._fogPrevColor;
            fog.fogStart = this._fogPrevStart;
            fog.fogEnd = this._fogPrevEnd;
            fog.enabled = this._fogPrevEnabled;
            this._fogSaved = false;
        }
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
        const changed = material !== this._boundMaterial;
        // Re-apply the RenderTexture every frame so runtime resize or GPU texture
        // handle changes cannot leave the sampler pointing at a stale texture.
        material.setProperty('refractionMap', this._renderTexture);
        if (this._reflectionRT) {
            material.setProperty('reflectionMap', this._reflectionRT);
        }
        if (changed) {
            material.setProperty('reflectionParams', this._reflectionParams);
        }
        if (changed || this._laneLockdownParamsDirty) {
            material.setProperty('laneLockdownParams', this._laneLockdownParams);
            material.setProperty('laneLockdownWarningParams', this._laneLockdownWarningParams);
            this._laneLockdownParamsDirty = false;
        }
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
        if (justBound || this._swimmerDisturbanceStateDirty) {
            material.setProperty('disturbParams', this._disturbParams);
            this._swimmerDisturbanceStateDirty = false;
        }
        if (!this._swimmerDisturbanceActive) {
            return;
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

function findMaterialTexture(material: Material | null): Texture2D | null {
    if (!material) {
        return null;
    }
    for (const property of ['albedoMap', 'mainTexture', 'baseColorMap', 'baseColorTexture']) {
        try {
            const value = material.getProperty(property);
            if (value instanceof Texture2D) {
                return value;
            }
        } catch {
            // The imported effect does not expose this property name.
        }
    }
    return null;
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
    if (node.layer === WATER_SURFACE_LAYER) {
        return;
    }
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
