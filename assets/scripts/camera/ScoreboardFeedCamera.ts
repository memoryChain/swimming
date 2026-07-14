import { Camera, Color, Layers, Material, MeshRenderer, Node, primitives, RenderTexture, Texture2D, utils, Vec3, Vec4 } from 'cc';
import { EDITOR } from 'cc/env';
import { RaceCameraSnapshot } from './RaceCameraDirector';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { SWIMMER_LAYER, UNDERWATER_LAYER, WATER_SURFACE_LAYER } from '../venue/WaterSurfaceBinder';
import { loadRaceAsset } from '../core/RaceBundleLoader';

// Dedicated layer for the venue jumbotron screens. The main camera renders it (so the
// player sees the screens), but the feed camera does NOT — otherwise the feed would draw
// the screens that sample its own RenderTexture, creating an infinite feedback loop.
const SCOREBOARD_LAYER = 1 << 11;
// The feed renders its own simple water on this layer instead of the main pool water: the
// real water uses screen-space refraction computed for the MAIN camera, so it looks wrong
// from the feed's side angle. A plain semi-transparent plane reads cleanly on the screen.
const FEED_WATER_LAYER = 1 << 12;
const SCREEN_NODE_PREFIX = 'scoreboard_screen';
// Low-res feed keeps the extra render cheap on WeChat (screens are ~2.5:1).
const FEED_RT_WIDTH = 480;
const FEED_RT_HEIGHT = 192;
// In the editor preview an off-screen (targetTexture) camera only renders once, so we
// recreate the RenderTexture to force a fresh render. Throttled to every few frames to
// limit the churn/leak. This whole path is compiled out on web/real builds (EDITOR const).
const EDITOR_REFRESH_STRIDE = 3;
// Perf: only re-render the jumbotron feed every Nth frame (a small secondary element, so
// ~30fps is plenty at 60fps main), and skip the whole extra render pass entirely when no
// screen is in view. Both are far cheaper than the per-frame full-scene re-render.
const FEED_RENDER_STRIDE = 2;
// Approx screen centres + facing normal (game coords: X=length, Y=up, Z=lane width).
const FEED_SCREENS = [
    { x: 65.5, y: 7.75, z: 0, nx: -1 },
    { x: -7.5, y: 7.75, z: 0, nx: 1 },
];

// Fixed-height "poolside reporter" presets for the jumbotron feed. The camera sits at a
// constant height on the deck side and only pans horizontally with the swimmer (no
// vertical bob), like a camera operator beside the pool. Cycle with the HUD button to
// find a comfortable angle. sideMargin = extra distance beyond the pool half-width;
// targetYOffset is relative to the water surface.
type FeedPreset = { name: string; height: number; sideMargin: number; targetYOffset: number; fov: number };
const FEED_PRESETS: FeedPreset[] = [
    { name: '侧视', height: 2.6, sideMargin: 5.0, targetYOffset: 0.5, fov: 40 },
    { name: '低机位', height: 1.25, sideMargin: 3.5, targetYOffset: 0.7, fov: 46 },
    { name: '高俯侧', height: 7.5, sideMargin: 3.5, targetYOffset: -0.1, fov: 38 },
    { name: '贴身跟拍', height: 1.9, sideMargin: 1.5, targetYOffset: 0.55, fov: 54 },
];

export type ScoreboardFeedOptions = {
    worldRoot: Node;
    mainCamera: Camera;
    pool: Node;
    courseLayout: RaceCourseLayout;
    playerLaneZ: number;
    debug?: (message: string) => void;
};

// Renders the "broadcast side view" (the old in-race side-tracking shot) into a shared
// RenderTexture that is displayed on the venue jumbotron screens. The main camera itself
// runs the sprint chase during the swim; this feed camera reproduces the classic side
// view via a second RaceCameraDirector locked to feed mode.
export class ScoreboardFeedCamera {
    private _camera: Camera | null = null;
    private _cameraNode: Node | null = null;
    private _renderTexture: RenderTexture | null = null;
    private _feedWater: Node | null = null;
    private _feedFloor: Node | null = null;
    private readonly _screenMaterials: Material[] = [];
    private _editorFrame = 0;
    private _frame = 0;
    private _presetIndex = 0;
    private readonly _camPos = new Vec3();
    private readonly _target = new Vec3();
    private _initialized = false;

    constructor(private readonly _options: ScoreboardFeedOptions) {
        this.setup();
    }

    private setup() {
        const { worldRoot, mainCamera, pool } = this._options;

        const node = new Node('ScoreboardFeedCamera');
        node.setParent(worldRoot);
        node.layer = Layers.Enum.DEFAULT;
        const camera = node.addComponent(Camera);
        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        // Same scene content as the main camera, PLUS the swimmer layer: swimmers are
        // drawn only by a dedicated overlay camera on SWIMMER_LAYER (the main camera
        // excludes it), so the feed must include that layer to show the racers on the
        // jumbotron. Swap the real water AND floor layers for the feed's own versions:
        // the main look is "colourless water + blue floor", but the jumbotron wants the
        // classic "white floor + blue transparent water", so the feed renders its own
        // white-floor + blue-water planes instead of the real (blue-floor) underwater
        // geometry and the (screen-space-refraction) water.
        camera.visibility = (((mainCamera.visibility as number) & ~(WATER_SURFACE_LAYER | UNDERWATER_LAYER)) | SWIMMER_LAYER | FEED_WATER_LAYER);
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = new Color(18, 58, 120, 255);
        camera.near = mainCamera.near;
        camera.far = mainCamera.far;
        camera.priority = mainCamera.priority - 5; // render into the RT before the main pass
        this._camera = camera;
        this._cameraNode = node;

        const rt = new RenderTexture('ScoreboardFeedRT');
        rt.reset({ width: FEED_RT_WIDTH, height: FEED_RT_HEIGHT });
        camera.targetTexture = rt;
        this._renderTexture = rt;

        // Move the jumbotron screens onto their own layer: main camera renders it, feed
        // camera does not (avoids the feedback loop).
        mainCamera.visibility = (mainCamera.visibility as number) | SCOREBOARD_LAYER;
        this.bindScreens(pool, rt);
        this.buildFeedFloor(worldRoot);
        this.buildFeedWater(worldRoot);
    }

    // Feed-only pool floor: a light plane with baked lane lines, so the jumbotron shows a
    // classic white pool bottom (the real floor is tinted blue for the main camera's water
    // trick). Rendered under the feed's blue transparent water.
    private buildFeedFloor(worldRoot: Node) {
        const layout = this._options.courseLayout;
        const startX = layout.poolStartX ?? 0;
        const finishX = layout.poolFinishX ?? 50;
        const centerX = (startX + finishX) * 0.5;
        const lengthX = Math.max(1, Math.abs(finishX - startX));
        const widthZ = Math.max(1, layout.poolWidth ?? 21);
        const waterY = layout.waterY ?? 0.15;
        const node = new Node('ScoreboardFeedFloor');
        node.setParent(worldRoot);
        node.layer = FEED_WATER_LAYER;
        node.setWorldPosition(centerX, waterY - 1.45, 0);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = utils.createMesh(primitives.plane({ width: lengthX, length: widthZ, widthSegments: 1, lengthSegments: 1 }));
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit' });
        material.name = 'ScoreboardFeedFloor';
        material.setProperty('mainColor', new Color(230, 242, 255, 255));
        renderer.setMaterial(material, 0);
        this._feedFloor = node;
        // Upgrade to the lane-line texture once loaded.
        loadRaceAsset('pool/PoolFeedFloor/texture', Texture2D, (err, texture) => {
            if (!node.isValid || err || !texture) {
                return;
            }
            const textured = new Material();
            textured.initialize({ effectName: 'builtin-unlit', defines: { USE_TEXTURE: true } });
            textured.name = 'ScoreboardFeedFloorTex';
            textured.setProperty('mainTexture', texture);
            textured.setProperty('mainColor', new Color(255, 255, 255, 255));
            renderer.setMaterial(textured, 0);
        });
    }

    // A plain semi-transparent water plane rendered only by the feed camera. It covers the
    // pool footprint at the water height; the feed also renders the pool floor + swimmers,
    // so the racers show through cleanly without the main camera's screen-space refraction.
    private buildFeedWater(worldRoot: Node) {
        const layout = this._options.courseLayout;
        const startX = layout.poolStartX ?? 0;
        const finishX = layout.poolFinishX ?? 50;
        const centerX = (startX + finishX) * 0.5;
        const lengthX = Math.max(1, Math.abs(finishX - startX));
        const widthZ = Math.max(1, layout.poolWidth ?? 21);
        const waterY = layout.waterY ?? 0.15;
        const node = new Node('ScoreboardFeedWater');
        node.setParent(worldRoot);
        node.layer = FEED_WATER_LAYER;
        node.setWorldPosition(centerX, waterY, 0);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = utils.createMesh(primitives.plane({ width: lengthX, length: widthZ, widthSegments: 1, lengthSegments: 1 }));
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit', technique: 1 });
        material.name = 'ScoreboardFeedWater';
        material.setProperty('mainColor', new Color(36, 126, 205, 150));
        renderer.setMaterial(material, 0);
        this._feedWater = node;
    }

    private bindScreens(pool: Node, rt: RenderTexture) {
        const screens: Node[] = [];
        collectByPrefix(pool, SCREEN_NODE_PREFIX, screens);
        for (const node of screens) {
            node.layer = SCOREBOARD_LAYER;
            const renderer = node.getComponent(MeshRenderer);
            if (!renderer) {
                continue;
            }
            const material = new Material();
            material.initialize({ effectName: 'builtin-unlit', defines: { USE_TEXTURE: true } });
            material.name = `ScoreboardFeed_${node.name}`;
            material.setProperty('mainTexture', rt);
            material.setProperty('mainColor', new Color(255, 255, 255, 255));
            // RenderTextures sample bottom-up, so flip V to show the feed upright.
            material.setProperty('tilingOffset', new Vec4(1, -1, 0, 1));
            renderer.setMaterial(material, 0);
            this._screenMaterials.push(material);
        }
        this._options.debug?.(`scoreboard feed bound screens=${screens.length}`);
    }

    update(dt: number, snapshot: RaceCameraSnapshot) {
        this.updateReporterCamera(dt, snapshot);
        // Throttle the extra render pass: only draw every FEED_RENDER_STRIDE frames, and
        // only when a screen is actually in view. Disabling the camera skips its pass
        // (the RT keeps its last frame, which is fine for a jumbotron).
        this._frame += 1;
        const due = (this._frame % FEED_RENDER_STRIDE) === 0;
        const shouldRender = due && this.isAnyScreenVisible();
        if (this._camera?.isValid) {
            this._camera.enabled = shouldRender;
        }
        if (shouldRender) {
            this.forceEditorPreviewRefresh();
        }
    }

    // Cheap visibility gate: is any jumbotron screen facing the main camera and within a
    // (generously padded) view cone? If not, the feed render is skipped this frame.
    private isAnyScreenVisible(): boolean {
        const cam = this._options.mainCamera;
        if (!cam?.node?.isValid) {
            return true;
        }
        const p = cam.node.worldPosition;
        const f = cam.node.forward;
        const cosLimit = Math.cos((cam.fov ?? 45) * (Math.PI / 180) * 0.5 + 0.4);
        for (const s of FEED_SCREENS) {
            const tx = s.x - p.x;
            const ty = s.y - p.y;
            const tz = s.z - p.z;
            if (s.nx * tx >= 0) {
                continue; // screen faces away from the camera
            }
            const len = Math.hypot(tx, ty, tz);
            if (len < 1e-3) {
                return true;
            }
            const dot = (f.x * tx + f.y * ty + f.z * tz) / len;
            if (dot > 0 && dot >= cosLimit) {
                return true;
            }
        }
        return false;
    }

    // Cycle to the next fixed-height feed angle; returns the new preset name for the HUD.
    cyclePreset(): string {
        this._presetIndex = (this._presetIndex + 1) % FEED_PRESETS.length;
        return FEED_PRESETS[this._presetIndex].name;
    }

    get currentPresetName(): string {
        return FEED_PRESETS[this._presetIndex].name;
    }

    private updateReporterCamera(dt: number, snapshot: RaceCameraSnapshot) {
        const node = this._cameraNode;
        const camera = this._camera;
        if (!node?.isValid || !camera) {
            return;
        }
        const preset = FEED_PRESETS[this._presetIndex];
        const layout = this._options.courseLayout;
        const laneZ = this._options.playerLaneZ;
        const halfWidth = (layout.poolWidth ?? 21) * 0.5;
        const waterY = layout.waterY ?? 0.15;
        // Fixed deck-side position; only X pans with the swimmer -> no vertical bob.
        const sideZ = halfWidth + preset.sideMargin;
        const wantX = snapshot.playerX;
        if (!this._initialized) {
            this._camPos.set(wantX, preset.height, sideZ);
            this._initialized = true;
        }
        const k = Math.min(1, Math.max(0, dt * 6));
        this._camPos.x += (wantX - this._camPos.x) * k;
        this._camPos.y = preset.height;
        this._camPos.z = sideZ;
        this._target.set(snapshot.playerX, waterY + preset.targetYOffset, laneZ);
        node.setPosition(this._camPos);
        node.lookAt(this._target);
        camera.fov = preset.fov;
    }

    private forceEditorPreviewRefresh() {
        if (!EDITOR) {
            return;
        }
        this._editorFrame += 1;
        if (this._editorFrame % EDITOR_REFRESH_STRIDE !== 0) {
            return;
        }
        const camera = this._camera;
        if (!camera?.isValid) {
            return;
        }
        const old = this._renderTexture;
        const fresh = new RenderTexture('ScoreboardFeedRT');
        fresh.reset({ width: FEED_RT_WIDTH, height: FEED_RT_HEIGHT });
        camera.targetTexture = fresh;
        this._renderTexture = fresh;
        for (const material of this._screenMaterials) {
            if (material?.isValid) {
                material.setProperty('mainTexture', fresh);
            }
        }
        old?.destroy();
    }

    dispose() {
        if (this._camera?.isValid) {
            this._camera.targetTexture = null;
        }
        if (this._camera?.node?.isValid) {
            this._camera.node.destroy();
        }
        if (this._feedWater?.isValid) {
            this._feedWater.destroy();
        }
        if (this._feedFloor?.isValid) {
            this._feedFloor.destroy();
        }
        this._renderTexture?.destroy();
        this._camera = null;
        this._cameraNode = null;
        this._renderTexture = null;
        this._feedWater = null;
        this._feedFloor = null;
        this._screenMaterials.length = 0;
    }
}

function collectByPrefix(root: Node, prefix: string, out: Node[]) {
    if (root.name.startsWith(prefix)) {
        out.push(root);
    }
    for (const child of root.children) {
        collectByPrefix(child, prefix, out);
    }
}
