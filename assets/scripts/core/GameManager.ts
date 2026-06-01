import {
    _decorator,
    Button,
    Camera,
    Canvas,
    Color,
    Component,
    DirectionalLight,
    EventMouse,
    game,
    Graphics,
    input,
    Input,
    instantiate,
    Label,
    Layers,
    Material,
    MeshRenderer,
    Node,
    Prefab,
    primitives,
    resources,
    SphereLight,
    UITransform,
    utils,
    Vec3,
    view,
} from 'cc';
import { AISwimmerController } from '../entity/AISwimmerController';
import { CartoonSwimmerRig } from '../entity/CartoonSwimmerRig';
import { Swimmer } from '../entity/Swimmer';
import { UIController } from '../ui/UIController';
import { InputManager } from './InputManager';
import { RaceManager } from './RaceManager';
import { RhythmEvaluator } from './RhythmEvaluator';
import { WaterSurface } from './WaterSurface';
import { COUNTDOWN_SECONDS, GameState, MAX_SPEED, RACE_DISTANCE, StrokeType } from './GameConstants';

const { ccclass } = _decorator;

const LANE_COUNT = 8;
const LANE_WIDTH = 2.05;
const POOL_WIDTH = LANE_COUNT * LANE_WIDTH;
const PLAYER_LANE_INDEX = 3;
const PRIMARY_AI_LANE_INDEX = 4;
const PLAYER_LANE_Z = laneCenterZ(PLAYER_LANE_INDEX);
const AI_LANE_Z = laneCenterZ(PRIMARY_AI_LANE_INDEX);
const POOL_LENGTH = RACE_DISTANCE + 8;
const POOL_SCENE_PREFAB_PATH = 'pool/PoolScene';
const MIN_BROADCAST_VIEW_SECONDS = 4.2;
const BROADCAST_SHOT_SECONDS = 6.2;
const FIRST_PERSON_SHOT_SECONDS = 6.8;
const FIRST_PERSON_MIN_SECONDS = 5.8;

enum RaceCameraMode {
    Broadcast = 0,
    Side = 1,
    Chase = 2,
    Top = 3,
    FirstPerson = 4,
    Free = 5,
}

const RACE_CAMERA_MODE_NAMES = ['AUTO', 'SIDE', 'CHASE', 'TOP', 'FIRST', 'FREE'];

@ccclass('GameManager')
export class GameManager extends Component {
    private _state = GameState.READY;
    private _raceManager: RaceManager = null;
    private _playerSwimmer: Swimmer = null;
    private _aiController: AISwimmerController = null;
    private _aiControllers: AISwimmerController[] = [];
    private _aiSwimmers: Swimmer[] = [];
    private _uiController: UIController = null;
    private _inputManager: InputManager = null;

    private _startScreen: Node = null;
    private _raceHud: Node = null;
    private _modelDebugHud: Node = null;
    private _worldRoot: Node = null;
    private _cameraNode: Node = null;
    private _debugPanel: Node = null;
    private _debugLabel: Label = null;
    private _modelDebugSpeedLabel: Label = null;
    private _speedFill: Graphics = null;
    private _debugLines: string[] = [];
    private _debugVisible = false;
    private _modelDebugActive = false;
    private _modelDebugCameraDragging = false;
    private _modelDebugCameraYaw = Math.PI / 2;
    private _modelDebugCameraPitch = 0.04;
    private _modelDebugCameraDistance = 3.2;
    private _modelDebugSpeedScale = 0.35;
    private _raceCameraMode = RaceCameraMode.Broadcast;
    private _raceCameraDragging = false;
    private _raceFreeCameraYaw = Math.PI / 2;
    private _raceFreeCameraPitch = 0.32;
    private _raceFreeCameraDistance = 10.5;
    private _broadcastShotTimer = 0;
    private _broadcastShotIndex = 0;
    private _broadcastShotSequence: number[] = [];
    private _broadcastShotSequenceCursor = 0;
    private _broadcastDuelTimer = 0;
    private _broadcastDuelCooldown = 0;
    private _broadcastDuelShotIndex = 1;
    private _broadcastCameraFov = 36;
    private _broadcastDesiredFov = 36;
    private _broadcastCountdownElapsed = 0;
    private _broadcastRaceElapsed = 0;

    private _cameraPos = new Vec3(-6, 4.7, 10.5);
    private _cameraTarget = new Vec3(8, 0.25, PLAYER_LANE_Z);
    private _lastPadStrokeMs = 0;
    private _lastPadStrokeType: StrokeType | null = null;

    onLoad() {
        game.frameRate = 60;
        console.log(`[SpeedSwimming] target frameRate=${game.frameRate}`);
        this.node.layer = Layers.Enum.UI_2D;
        this.scheduleOnce(() => {
            try {
                this.buildScene();
                this.registerEvents();
                this.showStartScreen();
                this.debug('3D runtime initialized');
            } catch (error) {
                this.paintError(error);
            }
        }, 0);
    }

    onDestroy() {
        this.node.off('arm-stroke', this.onArmStroke, this);
        this.node.off('leg-kick', this.onLegKick, this);
        this.node.off('primary-action', this.onPrimaryAction, this);
        this.node.off('toggle-debug', this.toggleDebug, this);
        this.node.off('cycle-race-camera', this.cycleRaceCamera, this);
        this.node.off('toggle-free-race-camera', this.toggleFreeRaceCamera, this);
        this.node.off('model-debug-speed-down', this.slowModelDebugMotion, this);
        this.node.off('model-debug-speed-up', this.speedUpModelDebugMotion, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onDebugCameraMouseDown, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onDebugCameraMouseMove, this);
        input.off(Input.EventType.MOUSE_UP, this.onDebugCameraMouseUp, this);
        input.off(Input.EventType.MOUSE_WHEEL, this.onDebugCameraWheel, this);
        this.stopAllAi();
        if (this._raceManager) {
            this._raceManager.onCountdownTick = null;
            this._raceManager.onStateChange = null;
            this._raceManager.onRaceTimerUpdate = null;
            this._raceManager.onProgressUpdate = null;
            this._raceManager.onRaceFinished = null;
        }
    }

    update(dt: number) {
        if (!this._playerSwimmer) {
            return;
        }
        this._uiController?.updateSpeed(this._playerSwimmer.currentSpeed);
        this.drawSpeedBar(this._playerSwimmer.currentSpeed / MAX_SPEED);
        if (this._modelDebugActive) {
            this.updateModelDebugCamera();
            return;
        }
        this.updateRaceCamera(dt);
    }

    startGame() {
        this.debug('startGame');
        this.exitModelDebug(false);
        this._startScreen.active = false;
        this._raceHud.active = true;
        this._uiController?.resetAll();
        this._raceManager?.resetRace();
        this.resetExtraAiSwimmers();
        this.drawSpeedBar(0);
        this._raceCameraMode = RaceCameraMode.Broadcast;
        this._raceCameraDragging = false;
        this.resetBroadcastDirector();
        this.resetBroadcastCamera();
        this._raceManager?.startRace();
    }

    restartGame() {
        this.debug('restartGame');
        this.stopAllAi();
        this.startGame();
    }

    private showStartScreen() {
        this.debug('showStartScreen');
        this._state = GameState.READY;
        this.stopAllAi();
        this._raceManager?.resetRace();
        this.resetExtraAiSwimmers();
        this.drawSpeedBar(0);
        this._raceCameraMode = RaceCameraMode.Broadcast;
        this._raceCameraDragging = false;
        this.resetBroadcastDirector();
        this.resetBroadcastCamera();
        if (this._raceHud) {
            this._raceHud.active = false;
        }
        if (this._modelDebugHud) {
            this._modelDebugHud.active = false;
        }
        if (this._startScreen) {
            this._startScreen.active = true;
        }
    }

    private buildScene() {
        const canvasNode = this.findCanvasNode();
        const sceneRoot = canvasNode.parent || canvasNode;
        canvasNode.layer = Layers.Enum.UI_2D;
        this.node.layer = Layers.Enum.UI_2D;
        this.cleanRuntimeChildren(canvasNode, sceneRoot);

        const design = view.getDesignResolutionSize();
        const w = design.width || 1280;
        const h = design.height || 720;

        this.setupUiCamera(canvasNode, h);
        this._worldRoot = mkWorldNode('Runtime3DWorld', sceneRoot);
        this.setupWorldCamera(sceneRoot);
        this.buildLights(this._worldRoot);
        this.buildPool3D(this._worldRoot);
        this.buildSwimmers3D(this._worldRoot);
        this.buildUi(canvasNode, w, h);

        this._raceManager = this.node.getComponent(RaceManager) || this.node.addComponent(RaceManager);
        this._raceManager.playerSwimmer = this._playerSwimmer;
        this._raceManager.aiSwimmer = this._aiController?.swimmer ?? null;
    }

    private setupUiCamera(canvasNode: Node, h: number) {
        const canvas = canvasNode.getComponent(Canvas) || canvasNode.addComponent(Canvas);
        let cameraNode = canvasNode.getChildByName('Camera');
        if (!cameraNode) {
            cameraNode = new Node('Camera');
            cameraNode.setParent(canvasNode);
            cameraNode.addComponent(Camera);
        }
        cameraNode.layer = Layers.Enum.UI_2D;
        const camera = cameraNode.getComponent(Camera);
        camera.visibility = Layers.BitMask.UI_2D;
        camera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        camera.priority = 10;
        camera.orthoHeight = h / 2;
        canvas.cameraComponent = camera;
    }

    private setupWorldCamera(sceneRoot: Node) {
        this._cameraNode = mkWorldNode('BroadcastCamera3D', sceneRoot);
        this._cameraNode.setPosition(this._cameraPos);
        const camera = this._cameraNode.addComponent(Camera);
        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        camera.visibility = Layers.BitMask.DEFAULT;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = color(122, 198, 238);
        camera.fov = 36;
        camera.near = 0.1;
        camera.far = 260;
        camera.priority = 0;
        this._cameraNode.lookAt(this._cameraTarget);
    }

    private buildLights(root: Node) {
        const sunNode = mkWorldNode('StadiumSun', root);
        sunNode.setRotationFromEuler(-48, 34, 0);
        const sun = sunNode.addComponent(DirectionalLight);
        sun.illuminance = 118000;

        const fillNode = mkWorldNode('PoolFillLight', root);
        fillNode.setPosition(45, 10, 8);
        const fill = fillNode.addComponent(SphereLight);
        fill.luminousFlux = 9800;
        fill.size = 9;

        for (let x = 0; x <= 100; x += 20) {
            const lightNode = mkWorldNode('RoofLight', root);
            lightNode.setPosition(x, 8.6, -POOL_WIDTH / 2 - 7.2);
            const light = lightNode.addComponent(SphereLight);
            light.luminousFlux = 1600;
            light.size = 1.1;

            const mirrorNode = mkWorldNode('RoofLightMirror', root);
            mirrorNode.setPosition(x, 8.6, POOL_WIDTH / 2 + 7.2);
            const mirror = mirrorNode.addComponent(SphereLight);
            mirror.luminousFlux = 1600;
            mirror.size = 1.1;
        }
    }

    private buildPool3D(root: Node) {
        resources.load(POOL_SCENE_PREFAB_PATH, Prefab, (err, prefab) => {
            if (err || !prefab || !root.isValid) {
                console.warn(`[SpeedSwimming] failed to load ${POOL_SCENE_PREFAB_PATH}, using line-only fallback`, err);
                this.buildPoolFallback(root);
                return;
            }

            const pool = instantiate(prefab);
            pool.name = 'LoadedEditablePoolScene';
            pool.setParent(root);
            pool.setPosition(Vec3.ZERO);
            pool.setScale(Vec3.ONE);
            this.configureLoadedPool(pool);
            this.debug(`pool prefab loaded: ${POOL_SCENE_PREFAB_PATH}`);
        });
    }

    private configureLoadedPool(pool: Node) {
        const oldWaterNodes: Node[] = [];
        this.collectNodesByName(pool, new Set(['PoolWater_0_50', 'PoolWater_50_100']), oldWaterNodes);
        for (const node of oldWaterNodes) {
            node.active = false;
        }

        const newWaterNodes: Node[] = [];
        this.collectNodesByName(pool, new Set(['flat_transparent_water_plane']), newWaterNodes);
        for (const node of newWaterNodes) {
            node.active = true;
        }

        if (!pool.getComponent(WaterSurface)) {
            pool.addComponent(WaterSurface);
        }

        resources.load('pool/RagingPoolWater', Material, (err, material) => {
            if (err || !material || !pool.isValid) {
                console.warn('[SpeedSwimming] failed to load transparent pool water material', err);
                return;
            }
            for (const node of newWaterNodes) {
                if (!node.isValid) {
                    continue;
                }
                const renderer = node.getComponent(MeshRenderer);
                if (renderer) {
                    renderer.setMaterial(material, 0);
                }
            }
            this.debug(`transparent low-poly water bound nodes=${newWaterNodes.length}`);
        });
    }

    private collectNodesByName(root: Node, names: Set<string>, out: Node[]) {
        if (names.has(root.name)) {
            out.push(root);
        }
        for (const child of root.children) {
            this.collectNodesByName(child, names, out);
        }
    }

    private buildPoolFallback(root: Node) {
        const mats = {
            floor: mat('emptyPoolFloor', color(14, 32, 54)),
            start: mat('startLine', color(255, 224, 36)),
            finish: mat('finishLine', color(255, 255, 255)),
            white: mat('white', color(255, 255, 255)),
        };

        addBox(root, 'EmptyRaceSurface', mats.floor, new Vec3(50, -0.06, 0), new Vec3(POOL_LENGTH + 8, 0.04, POOL_WIDTH + 2));
        addBox(root, 'StartLine', mats.start, new Vec3(0, 0.02, 0), new Vec3(0.24, 0.04, POOL_WIDTH + 1));
        addBox(root, 'FinishLine', mats.finish, new Vec3(100, 0.02, 0), new Vec3(0.28, 0.04, POOL_WIDTH + 1));
    }

    private buildLaneRope3D(root: Node, z: number, red: Material, white: Material) {
        for (let x = -3; x <= 103; x += 1.35) {
            const material = Math.floor((x + 3) / 5.4) % 2 === 0 ? red : white;
            addSphere(root, 'LaneFloat', material, new Vec3(x, 0.14, z), 0.16, new Vec3(1, 0.55, 0.55));
        }
    }

    private buildStartingBlock(root: Node, lane: number, z: number, mats: Record<string, Material>) {
        addBox(root, `Lane${lane + 1}BlockBase`, mats.white, new Vec3(-2.42, 0.5, z), new Vec3(1.08, 0.46, 1.05));
        const top = addBox(root, `Lane${lane + 1}BlockTop`, mats.white, new Vec3(-2.72, 0.9, z), new Vec3(0.92, 0.18, 0.82));
        top.setRotationFromEuler(0, 0, -2);
        addBox(root, `Lane${lane + 1}BlockFace`, mats.deckDark, new Vec3(-3.0, 0.66, z), new Vec3(0.05, 0.28, 0.68));
        addBox(root, `Lane${lane + 1}BlockGrip`, mats.steel, new Vec3(-2.18, 0.93, z), new Vec3(0.08, 0.08, 0.78));

        const numberBars = lane + 1;
        const startZ = z - Math.min(0.28, numberBars * 0.045);
        for (let i = 0; i < numberBars; i++) {
            addBox(root, `Lane${lane + 1}NumberMark`, mats.black, new Vec3(-3.035, 0.69, startZ + i * 0.08), new Vec3(0.025, 0.16, 0.035));
        }
    }

    private buildArenaStands(root: Node, deckZ: number, mats: Record<string, Material>) {
        for (const side of [-1, 1]) {
            const zBase = side * (deckZ + 3.2);
            addBox(root, 'LowerStandWall', mats.bannerDark, new Vec3(50, 0.82, zBase), new Vec3(116, 1.05, 0.7));
            addBox(root, 'SwimmingBanner', mats.banner, new Vec3(50, 1.48, zBase - side * 0.42), new Vec3(116, 0.34, 0.18));
            addBox(root, 'UpperStandWall', mats.bannerDark, new Vec3(50, 2.55, zBase + side * 1.35), new Vec3(116, 1.1, 0.78));
            addBox(root, 'UpperBanner', mats.banner, new Vec3(50, 3.18, zBase + side * 0.88), new Vec3(116, 0.3, 0.18));

            for (let row = 0; row < 6; row++) {
                const y = 1.25 + row * 0.34;
                const z = zBase + side * (0.58 + row * 0.34);
                const material = row % 2 === 0 ? mats.seatA : mats.seatB;
                addBox(root, 'SeatRow', material, new Vec3(50, y, z), new Vec3(112, 0.16, 0.22));
                for (let x = -2; x <= 102; x += 7.2) {
                    addBox(root, 'SeatBreak', mats.deckDark, new Vec3(x, y + 0.03, z - side * 0.02), new Vec3(0.18, 0.18, 0.26));
                }
            }

            for (let x = 0; x <= 100; x += 20) {
                addBox(root, 'AisleStripe', mats.white, new Vec3(x, 2.0, zBase + side * 1.35), new Vec3(0.18, 2.05, 0.08));
            }
        }

        addBox(root, 'CenterScoreboard', mats.white, new Vec3(50, 4.2, deckZ + 4.9), new Vec3(11, 2.2, 0.2));
        addBox(root, 'CenterScoreboardBlue', mats.banner, new Vec3(53.4, 4.2, deckZ + 4.76), new Vec3(3.8, 1.8, 0.12));
        addBox(root, 'ScoreboardWordMark', mats.bannerDark, new Vec3(47.0, 4.45, deckZ + 4.74), new Vec3(3.6, 0.16, 0.1));
        addBox(root, 'ScoreboardLine', mats.banner, new Vec3(47.0, 4.0, deckZ + 4.73), new Vec3(4.6, 0.12, 0.1));
    }

    private buildRoofRig(root: Node, mats: Record<string, Material>) {
        const roofY = 7.1;
        const leftZ = -POOL_WIDTH / 2 - 8.1;
        const rightZ = POOL_WIDTH / 2 + 8.1;
        addBox(root, 'RoofGlassPanel', mats.laneBlue, new Vec3(50, roofY + 0.35, 0), new Vec3(116, 0.08, POOL_WIDTH + 13));

        for (let x = -4; x <= 104; x += 12) {
            addBox(root, 'RoofCrossBeam', mats.steel, new Vec3(x, roofY, 0), new Vec3(0.18, 0.16, POOL_WIDTH + 17));
            const diagA = addBox(root, 'RoofDiagonalBeam', mats.steel, new Vec3(x + 3, roofY - 0.15, -3.9), new Vec3(0.14, 0.14, POOL_WIDTH + 6));
            diagA.setRotationFromEuler(0, 0, 8);
            const diagB = addBox(root, 'RoofDiagonalBeam', mats.steel, new Vec3(x + 9, roofY - 0.15, 3.9), new Vec3(0.14, 0.14, POOL_WIDTH + 6));
            diagB.setRotationFromEuler(0, 0, -8);
        }

        for (let x = -2; x <= 102; x += 4) {
            addSphere(root, 'RoofBulbLeft', mats.light, new Vec3(x, roofY - 0.45, leftZ), 0.13, new Vec3(1, 1, 1));
            addSphere(root, 'RoofBulbRight', mats.light, new Vec3(x, roofY - 0.45, rightZ), 0.13, new Vec3(1, 1, 1));
        }
        addBox(root, 'LeftLightRail', mats.steel, new Vec3(50, roofY - 0.46, leftZ), new Vec3(112, 0.06, 0.08));
        addBox(root, 'RightLightRail', mats.steel, new Vec3(50, roofY - 0.46, rightZ), new Vec3(112, 0.06, 0.08));
    }

    private buildSwimmers3D(root: Node) {
        const group = mkWorldNode('Swimmers3D', root);
        this._aiControllers = [];
        this._aiSwimmers = [];

        const suits = [
            color(255, 75, 94),
            color(26, 152, 255),
            color(255, 205, 38),
            color(255, 40, 58),
            color(36, 214, 116),
            color(168, 82, 255),
            color(255, 126, 42),
            color(20, 220, 230),
        ];
        const caps = [
            color(35, 235, 255),
            color(255, 246, 64),
            color(255, 90, 220),
            color(255, 242, 52),
            color(250, 250, 255),
            color(94, 255, 130),
            color(70, 110, 255),
            color(255, 255, 255),
        ];
        const aiProfiles = [
            { difficulty: 0.86, bpmOffset: 0, power: 1.02, maxSpeed: 1.0 },
            { difficulty: 0.93, bpmOffset: 10, power: 1.12, maxSpeed: 1.04 },
            { difficulty: 0.98, bpmOffset: 20, power: 1.24, maxSpeed: 1.08 },
            { difficulty: 0.92, bpmOffset: 8, power: 1.08, maxSpeed: 1.03 },
            { difficulty: 0.99, bpmOffset: 24, power: 1.28, maxSpeed: 1.1 },
            { difficulty: 0.82, bpmOffset: -2, power: 1.0, maxSpeed: 1.0 },
            { difficulty: 0.96, bpmOffset: 16, power: 1.18, maxSpeed: 1.06 },
            { difficulty: 1.0, bpmOffset: 28, power: 1.32, maxSpeed: 1.12 },
        ];

        for (let lane = 0; lane < LANE_COUNT; lane++) {
            const isPlayer = lane === PLAYER_LANE_INDEX;
            const swimmer = this.createSwimmer3D(
                group,
                isPlayer ? 'PlayerSwimmer3D' : `AISwimmerLane${lane + 1}`,
                0,
                laneCenterZ(lane),
                !isPlayer,
                suits[lane],
                caps[lane],
            );
            if (isPlayer) {
                this._playerSwimmer = swimmer;
                continue;
            }

            const controller = swimmer.node.addComponent(AISwimmerController);
            controller.swimmer = swimmer;
            controller.difficulty = aiProfiles[lane].difficulty;
            controller.bpmOffset = aiProfiles[lane].bpmOffset;
            swimmer.aiPower = aiProfiles[lane].power;
            swimmer.aiMaxSpeedScale = aiProfiles[lane].maxSpeed;
            this._aiSwimmers.push(swimmer);
            this._aiControllers.push(controller);
            if (lane === PRIMARY_AI_LANE_INDEX) {
                this._aiController = controller;
            }
        }
    }

    private createSwimmer3D(parent: Node, name: string, x: number, z: number, isAI: boolean, suitColor?: Color, capColor?: Color): Swimmer {
        const node = mkWorldNode(name, parent);
        node.setPosition(x, 0.22, z);

        const rig = node.addComponent(CartoonSwimmerRig);
        const sharedSkin = color(246, 176, 118);
        rig.build(
            sharedSkin,
            suitColor || (isAI ? color(58, 92, 128) : color(245, 42, 64)),
            capColor || (isAI ? color(110, 230, 248) : color(255, 220, 72)),
            isAI,
            !isAI,
        );
        const swimmer = node.addComponent(Swimmer);
        swimmer.cartoonRig = rig;
        swimmer.splashNode = rig.splashNode;
        swimmer.rhythmEvaluator = node.addComponent(RhythmEvaluator);
        swimmer.isAI = isAI;
        swimmer.swimmerName = isAI ? 'AI' : 'Player';
        this.debug(`${name} uses CartoonSwimmerRig`);
        return swimmer;
    }

    private buildWaterDetail(root: Node, foam: Material, bright: Material) {
        for (let lane = 0; lane < LANE_COUNT; lane++) {
            const z = laneCenterZ(lane);
            for (let x = 6; x <= 98; x += 16) {
                const offset = ((lane * 3 + Math.floor(x)) % 5) * 0.08;
                const waveA = addBox(root, 'LaneWave', foam, new Vec3(x + offset, 0.064, z - 0.34), new Vec3(1.0, 0.014, 0.018));
                waveA.setRotationFromEuler(0, 0, (lane % 2 === 0 ? 4 : -4));
                const waveB = addBox(root, 'LaneBlueRipple', bright, new Vec3(x + 4.6, 0.058, z + 0.3), new Vec3(0.82, 0.012, 0.016));
                waveB.setRotationFromEuler(0, 0, (lane % 2 === 0 ? -3 : 3));
            }
        }
        for (let x = 4; x <= 100; x += 18) {
            addBox(root, 'WallFoamLeft', foam, new Vec3(x, 0.064, -POOL_WIDTH / 2 + 0.18), new Vec3(1.2, 0.014, 0.022));
            addBox(root, 'WallFoamRight', foam, new Vec3(x + 6, 0.064, POOL_WIDTH / 2 - 0.18), new Vec3(1.2, 0.014, 0.022));
        }
    }

    private buildUi(root: Node, w: number, h: number) {
        const uiRoot = mkUiNode('RuntimeUIRoot', root);
        const input = uiRoot.addComponent(InputManager);
        input.strokeTarget = this.node;
        input.pointerInputEnabled = false;
        this._inputManager = input;

        this._raceHud = mkUiNode('RaceHUD', uiRoot);
        this._raceHud.active = false;
        this.buildRaceHud(this._raceHud, w, h);
        this._startScreen = this.buildStartScreen(uiRoot, w, h);
        this._modelDebugHud = this.buildModelDebugHud(uiRoot, w, h);
        this._modelDebugHud.active = false;
        this._debugPanel = this.buildDebugPanel(uiRoot, w, h);
        this._debugPanel.active = this._debugVisible;
    }

    private buildRaceHud(parent: Node, w: number, h: number) {
        const leftPad = mkTouchArea('LeftInput', parent, w / 2, h);
        leftPad.setPosition(-w / 4, 0, 0);
        leftPad.on(Node.EventType.TOUCH_START, () => this.handlePadStroke(StrokeType.LEG), this);
        leftPad.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT) {
                this.handlePadStroke(StrokeType.LEG);
            }
        }, this);
        const rightPad = mkTouchArea('RightInput', parent, w / 2, h);
        rightPad.setPosition(w / 4, 0, 0);
        rightPad.on(Node.EventType.TOUCH_START, () => this.handlePadStroke(StrokeType.ARM), this);
        rightPad.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT || event.getButton() === EventMouse.BUTTON_RIGHT) {
                this.handlePadStroke(StrokeType.ARM);
            }
        }, this);

        mkRect('TopBar', parent, w, 82, color(6, 18, 30, 190)).setPosition(0, h / 2 - 41, 0);
        mkLabel('Title', parent, 'SPEED SWIMMING 3D', 24, color(255, 255, 255)).setPosition(-w / 2 + 188, h / 2 - 38, 0);
        const timerLabel = mkLabel('Timer', parent, '0:00.00', 30, color(255, 255, 255));
        timerLabel.setPosition(w / 2 - 118, h / 2 - 38, 0);
        const hintLabel = mkLabel('Hint', parent, 'Left/A kick   Right/D arms   C camera   V free view', 18, color(190, 236, 255));
        hintLabel.setPosition(0, h / 2 - 38, 0);

        mkLabel('SpeedText', parent, 'PACE', 16, color(210, 240, 250)).setPosition(-168, h / 2 - 92, 0);
        mkRect('SpeedTrack', parent, 240, 12, color(5, 18, 30, 210)).setPosition(0, h / 2 - 92, 0);
        const speedFillNode = mkLeftRect('SpeedFill', parent, 240, 10, color(89, 234, 160));
        speedFillNode.setPosition(-120, h / 2 - 92, 0);
        this._speedFill = speedFillNode.getComponent(Graphics);
        const speedLabel = mkLabel('SpeedValue', parent, '0.00 m/s  0%', 16, color(255, 255, 255));
        speedLabel.getComponent(UITransform).setContentSize(180, 26);
        speedLabel.setPosition(164, h / 2 - 92, 0);

        const ratingLabel = mkLabel('Rating', parent, '', 34, color(255, 255, 255));
        ratingLabel.setPosition(0, h / 2 - 142, 0);
        const comboLabel = mkLabel('Combo', parent, '', 20, color(255, 255, 255));
        comboLabel.setPosition(0, h / 2 - 176, 0);

        const countdownOverlay = mkUiNode('CountdownOverlay', parent);
        countdownOverlay.active = false;
        mkRect('CountdownShade', countdownOverlay, w, h, color(0, 0, 0, 70));
        const countdownLabel = mkLabel('CountdownLabel', countdownOverlay, '3', 96, color(255, 255, 255));
        countdownLabel.getComponent(UITransform).setContentSize(720, 220);
        countdownLabel.getComponent(Label).lineHeight = 140;

        const resultPanel = mkUiNode('ResultPanel', parent);
        resultPanel.active = false;
        mkRect('ResultBg', resultPanel, 500, 236, color(8, 22, 34, 240));
        const resultTitle = mkLabel('ResultTitle', resultPanel, 'YOU WIN', 42, color(255, 224, 89));
        resultTitle.setPosition(0, 64, 0);
        const resultTime = mkLabel('ResultTime', resultPanel, '', 20, color(255, 255, 255));
        resultTime.setPosition(0, 12, 0);
        const restart = mkButton('RestartButton', resultPanel, 178, 44, color(38, 116, 190), 'RACE AGAIN');
        restart.setPosition(-98, -70, 0);
        restart.on(Node.EventType.TOUCH_END, () => this.restartGame(), this);
        const menu = mkButton('MenuButton', resultPanel, 150, 44, color(232, 68, 72), 'MENU');
        menu.setPosition(104, -70, 0);
        menu.on(Node.EventType.TOUCH_END, () => this.showStartScreen(), this);

        const ui = mkUiNode('UIController', parent).addComponent(UIController);
        ui.timerLabel = timerLabel.getComponent(Label);
        ui.speedLabel = speedLabel.getComponent(Label);
        ui.hintLabel = hintLabel.getComponent(Label);
        ui.countdownOverlay = countdownOverlay;
        ui.countdownLabel = countdownLabel.getComponent(Label);
        ui.resultPanel = resultPanel;
        ui.resultTitle = resultTitle.getComponent(Label);
        ui.resultTime = resultTime.getComponent(Label);
        ui.ratingLabel = ratingLabel.getComponent(Label);
        ui.comboLabel = comboLabel.getComponent(Label);
        this._uiController = ui;
    }

    private buildStartScreen(parent: Node, w: number, h: number): Node {
        const screen = mkUiNode('StartScreen', parent);
        mkRect('StartShade', screen, w, h, color(4, 12, 22, 125));
        mkRect('TopAccent', screen, w, 12, color(255, 224, 89)).setPosition(0, h / 2 - 6, 0);
        mkLabel('Kicker', screen, '100M FREESTYLE RHYTHM', 18, color(128, 225, 235)).setPosition(0, 124, 0);
        mkLabel('Logo', screen, 'SPEED SWIMMING 3D', 62, color(255, 255, 255)).setPosition(0, 70, 0);
        mkLabel('SubTitle', screen, 'Freestyle rhythm: left click kicks, right click pulls the arms.', 22, color(224, 235, 235)).setPosition(0, 16, 0);

        const start = mkButton('StartButton', screen, 220, 52, color(255, 224, 89), 'START RACE');
        start.setPosition(-124, -62, 0);
        start.on(Node.EventType.TOUCH_END, () => this.startGame(), this);

        const debug = mkButton('DebugButton', screen, 190, 52, color(38, 116, 190), 'DEBUG');
        debug.setPosition(116, -62, 0);
        debug.on(Node.EventType.TOUCH_END, () => this.toggleDebug(), this);

        const modelDebug = mkButton('ModelDebugButton', screen, 240, 48, color(28, 148, 124), 'MODEL DEBUG');
        modelDebug.setPosition(0, -126, 0);
        modelDebug.on(Node.EventType.TOUCH_END, () => this.enterModelDebug(), this);

        mkLabel('Controls', screen, 'Left mouse / A: kick    Right mouse / D: arm pull    C: camera    V: free view', 18, color(220, 232, 235)).setPosition(0, -184, 0);
        return screen;
    }

    private buildModelDebugHud(parent: Node, w: number, h: number): Node {
        const hud = mkUiNode('ModelDebugHUD', parent);
        mkRect('ModelDebugTop', hud, w, 76, color(5, 16, 26, 190)).setPosition(0, h / 2 - 38, 0);
        mkLabel('ModelDebugTitle', hud, 'MODEL ACTION DEBUG', 24, color(255, 255, 255)).setPosition(-w / 2 + 190, h / 2 - 38, 0);
        mkLabel('ModelDebugHint', hud, 'A: legs    D: arms    Q/E: speed    Drag: orbit    Wheel: zoom', 18, color(150, 235, 255)).setPosition(0, h / 2 - 38, 0);
        const exit = mkButton('ModelDebugExit', hud, 130, 42, color(232, 68, 72), 'EXIT');
        exit.setPosition(w / 2 - 86, h / 2 - 38, 0);
        exit.on(Node.EventType.TOUCH_END, () => this.exitModelDebug(true), this);
        mkRect('ModelDebugBottom', hud, w, 54, color(5, 16, 26, 120)).setPosition(0, -h / 2 + 27, 0);
        const slower = mkButton('ModelDebugSlow', hud, 54, 36, color(38, 116, 190), '-');
        slower.setPosition(-88, -h / 2 + 27, 0);
        slower.on(Node.EventType.TOUCH_END, () => this.slowModelDebugMotion(), this);
        const faster = mkButton('ModelDebugFast', hud, 54, 36, color(38, 116, 190), '+');
        faster.setPosition(88, -h / 2 + 27, 0);
        faster.on(Node.EventType.TOUCH_END, () => this.speedUpModelDebugMotion(), this);
        const speedLabel = mkLabel('ModelDebugStatus', hud, 'Speed 0.35x', 18, color(230, 244, 250));
        speedLabel.setPosition(0, -h / 2 + 27, 0);
        this._modelDebugSpeedLabel = speedLabel.getComponent(Label);
        return hud;
    }

    private buildDebugPanel(parent: Node, w: number, h: number): Node {
        const panel = mkUiNode('DebugPanel', parent);
        panel.setPosition(-w / 2 + 210, -h / 2 + 144, 0);
        mkRect('DebugBack', panel, 390, 210, color(0, 0, 0, 205));
        mkLabel('DebugTitle', panel, 'DEBUG', 18, color(255, 224, 89)).setPosition(-150, 80, 0);
        const label = mkLabel('DebugLog', panel, '', 14, color(150, 235, 255));
        label.getComponent(UITransform).setContentSize(350, 150);
        label.setPosition(0, -10, 0);
        this._debugLabel = label.getComponent(Label);
        return panel;
    }

    private registerEvents() {
        this.node.off('arm-stroke', this.onArmStroke, this);
        this.node.off('leg-kick', this.onLegKick, this);
        this.node.off('primary-action', this.onPrimaryAction, this);
        this.node.off('toggle-debug', this.toggleDebug, this);
        this.node.off('cycle-race-camera', this.cycleRaceCamera, this);
        this.node.off('toggle-free-race-camera', this.toggleFreeRaceCamera, this);
        this.node.off('model-debug-speed-down', this.slowModelDebugMotion, this);
        this.node.off('model-debug-speed-up', this.speedUpModelDebugMotion, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onDebugCameraMouseDown, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onDebugCameraMouseMove, this);
        input.off(Input.EventType.MOUSE_UP, this.onDebugCameraMouseUp, this);
        input.off(Input.EventType.MOUSE_WHEEL, this.onDebugCameraWheel, this);
        this.node.on('arm-stroke', this.onArmStroke, this);
        this.node.on('leg-kick', this.onLegKick, this);
        this.node.on('primary-action', this.onPrimaryAction, this);
        this.node.on('toggle-debug', this.toggleDebug, this);
        this.node.on('cycle-race-camera', this.cycleRaceCamera, this);
        this.node.on('toggle-free-race-camera', this.toggleFreeRaceCamera, this);
        this.node.on('model-debug-speed-down', this.slowModelDebugMotion, this);
        this.node.on('model-debug-speed-up', this.speedUpModelDebugMotion, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onDebugCameraMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onDebugCameraMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.onDebugCameraMouseUp, this);
        input.on(Input.EventType.MOUSE_WHEEL, this.onDebugCameraWheel, this);

        if (!this._raceManager) {
            return;
        }
        this._raceManager.onCountdownTick = (value) => this._uiController?.showCountdown(value);
        this._raceManager.onStateChange = (state) => {
            this._state = state;
            this.debug(`state=${state}`);
            if (state === GameState.COUNTDOWN) {
                this._broadcastCountdownElapsed = 0;
                this._broadcastRaceElapsed = 0;
                this._broadcastShotTimer = 0;
            }
            if (state === GameState.RACING) {
                this._broadcastRaceElapsed = 0;
                this._broadcastShotTimer = 0;
                this._uiController?.hideCountdown();
                this.startExtraAiSwimmers();
                this.startAllAi();
            }
        };
        this._raceManager.onRaceTimerUpdate = (time) => this._uiController?.updateTimer(time);
        this._raceManager.onProgressUpdate = (playerDist, aiDist) => {
            this._uiController?.updateProgress(playerDist, aiDist);
        };
        this._raceManager.onRaceFinished = (playerWin, playerTime, aiTime) => {
            this.debug(`finished win=${playerWin} player=${playerTime.toFixed(2)} ai=${aiTime.toFixed(2)}`);
            this.stopAllAi();
            this._uiController?.showResult(playerWin, playerTime, aiTime);
        };
    }

    private onPrimaryAction() {
        if (this._state === GameState.READY) {
            this.startGame();
        } else if (this._state === GameState.FINISHED) {
            this.restartGame();
        }
    }

    private onArmStroke() {
        this.handlePlayerStroke(StrokeType.ARM);
    }

    private onLegKick() {
        this.handlePlayerStroke(StrokeType.LEG);
    }

    private handlePadStroke(type: StrokeType) {
        const now = Date.now();
        if (this._lastPadStrokeType === type && now - this._lastPadStrokeMs < 45) {
            return;
        }
        this._lastPadStrokeType = type;
        this._lastPadStrokeMs = now;
        this.handlePlayerStroke(type);
    }

    private handlePlayerStroke(type: StrokeType) {
        if (this._modelDebugActive) {
            if (type === StrokeType.ARM) {
                this._playerSwimmer?.cartoonRig?.triggerArmStroke();
                this.debug('model debug: arms');
            } else {
                this._playerSwimmer?.cartoonRig?.triggerKick();
                this.debug('model debug: legs');
            }
            return;
        }
        if (this._state !== GameState.RACING) {
            return;
        }
        const result = this._playerSwimmer?.handleStroke(type);
        if (result) {
            this.debug(`stroke=${type} rating=${result.rating} combo=${result.combo}`);
            this._uiController?.showRating(result.rating, result.combo);
        }
    }

    private cycleRaceCamera() {
        if (this._modelDebugActive) {
            return;
        }
        this._raceCameraMode = (this._raceCameraMode + 1) % RACE_CAMERA_MODE_NAMES.length;
        this._raceCameraDragging = false;
        if (this._raceCameraMode === RaceCameraMode.Broadcast) {
            this.resetBroadcastDirector();
        }
        this.applyRaceCameraFov();
        this.debug(`race camera=${RACE_CAMERA_MODE_NAMES[this._raceCameraMode]}`);
    }

    private toggleFreeRaceCamera() {
        if (this._modelDebugActive) {
            return;
        }
        this._raceCameraMode = this._raceCameraMode === RaceCameraMode.Free ? RaceCameraMode.Broadcast : RaceCameraMode.Free;
        this._raceCameraDragging = false;
        if (this._raceCameraMode === RaceCameraMode.Broadcast) {
            this.resetBroadcastDirector();
        }
        this.applyRaceCameraFov();
        this.debug(`race camera=${RACE_CAMERA_MODE_NAMES[this._raceCameraMode]}`);
    }

    private updateRaceCamera(dt: number) {
        if (this._raceCameraMode === RaceCameraMode.Free) {
            this.updateRaceFreeCamera();
            return;
        }
        if (this._raceCameraMode === RaceCameraMode.FirstPerson) {
            this.updateRaceFirstPersonCamera();
            return;
        }
        if (this._raceCameraMode === RaceCameraMode.Broadcast) {
            this.updateBroadcastCamera(dt);
            return;
        }
        this.updateRacePresetCamera();
    }

    private updateBroadcastCamera(dt: number) {
        if (!this._cameraNode || !this._playerSwimmer) {
            return;
        }
        const playerX = this._playerSwimmer.node.position.x;
        const playerDistance = this._playerSwimmer.distance;
        const raceRatio = Math.max(0, Math.min(1, this._playerSwimmer.distance / RACE_DISTANCE));
        const raceActive = this._state === GameState.RACING;
        const countdownActive = this._state === GameState.COUNTDOWN;
        if (countdownActive) {
            this._broadcastCountdownElapsed += dt;
        }
        if (raceActive) {
            this._broadcastRaceElapsed += dt;
            if (this._broadcastRaceElapsed > 1.2) {
                this._broadcastShotTimer += dt;
            }
            if (this._broadcastShotTimer > this.currentBroadcastShotSeconds()) {
                this._broadcastShotTimer = 0;
                this.advanceBroadcastShot();
            }
        }

        const closestGap = this.closestAiDistanceGap(playerDistance);
        const closeDuel = raceActive && raceRatio > 0.12 && raceRatio < 0.82 && closestGap < 3.2;
        this._broadcastDuelTimer = Math.max(0, this._broadcastDuelTimer - dt);
        this._broadcastDuelCooldown = Math.max(0, this._broadcastDuelCooldown - dt);
        const minViewSeconds = this._broadcastShotIndex === 4 ? FIRST_PERSON_MIN_SECONDS : MIN_BROADCAST_VIEW_SECONDS;
        if (closeDuel && this._broadcastShotTimer >= minViewSeconds && this._broadcastDuelTimer <= 0 && this._broadcastDuelCooldown <= 0) {
            this._broadcastDuelTimer = 4.4;
            this._broadcastDuelCooldown = 7.4;
            this._broadcastShotTimer = 0;
            this._broadcastDuelShotIndex = (this._broadcastDuelShotIndex + 1) % 2;
        }

        let desiredPos: Vec3;
        let desiredTarget: Vec3;
        let fixedTopView = false;
        if (!raceActive && !countdownActive) {
            desiredTarget = new Vec3(0.2, 0.78, 0);
            desiredPos = new Vec3(5.8, 1.65, 0);
            this._broadcastDesiredFov = 42;
        } else if (countdownActive) {
            const sideTarget = new Vec3(0.2, 0.44, PLAYER_LANE_Z);
            const sidePos = new Vec3(sideTarget.x, 1.65, PLAYER_LANE_Z + 9.8);
            const frontTarget = new Vec3(0.2, 0.78, 0);
            const frontPos = new Vec3(5.8, 1.65, 0);
            const moveStart = 1;
            const moveDuration = Math.max(0.1, COUNTDOWN_SECONDS - 2);
            const ratio = smoothStep(clamp((this._broadcastCountdownElapsed - moveStart) / moveDuration, 0, 1));
            desiredTarget = new Vec3();
            desiredPos = new Vec3();
            Vec3.lerp(desiredTarget, frontTarget, sideTarget, ratio);
            Vec3.lerp(desiredPos, frontPos, sidePos, ratio);
            this._broadcastDesiredFov = 32 + (42 - 32) * (1 - ratio);
        } else if (this._broadcastRaceElapsed < 1.2) {
            desiredTarget = new Vec3(playerX + 0.6, 0.44, PLAYER_LANE_Z);
            desiredPos = new Vec3(desiredTarget.x, 1.65, PLAYER_LANE_Z + 9.8);
            this._broadcastDesiredFov = 32;
        } else if (playerDistance >= RACE_DISTANCE - 8) {
            const finishAnchorX = RACE_DISTANCE - 7.5;
            const playerFollowX = playerX + 3.4;
            const targetX = playerFollowX * 0.65 + finishAnchorX * 0.35;
            desiredTarget = new Vec3(targetX, 0.18, 0);
            desiredPos = new Vec3(desiredTarget.x, 22.5, 0);
            this._broadcastDesiredFov = 46;
            fixedTopView = true;
        } else if (!raceActive || raceRatio < 0.06) {
            desiredPos = new Vec3(playerX - 5.7, 4.25, PLAYER_LANE_Z + 11.8);
            desiredTarget = new Vec3(playerX + 5.0, 0.36, PLAYER_LANE_Z + 0.1);
            this._broadcastDesiredFov = 36;
        } else if (raceRatio < 0.18) {
            desiredTarget = new Vec3(playerX + 1.2, 0.44, PLAYER_LANE_Z);
            desiredPos = new Vec3(desiredTarget.x, 1.65, PLAYER_LANE_Z + 9.8);
            this._broadcastDesiredFov = 32;
        } else if (this._broadcastDuelTimer > 0) {
            if (this._broadcastDuelShotIndex === 0) {
                desiredPos = new Vec3(playerX - 4.1, 2.05, PLAYER_LANE_Z + 3.5);
                desiredTarget = new Vec3(playerX + 1.85, 0.62, PLAYER_LANE_Z);
            } else {
                desiredTarget = new Vec3(playerX + 0.9, 0.62, PLAYER_LANE_Z);
                desiredPos = new Vec3(desiredTarget.x, 1.95, PLAYER_LANE_Z + 4.4);
            }
            this._broadcastDesiredFov = 28;
        } else {
            const shot = this._broadcastShotIndex;
            if (shot === 0) {
                desiredTarget = new Vec3(playerX + 3.2, 0.42, PLAYER_LANE_Z);
                desiredPos = new Vec3(desiredTarget.x, 1.55, PLAYER_LANE_Z + 9.2);
                this._broadcastDesiredFov = 33;
            } else if (shot === 1) {
                desiredPos = new Vec3(playerX - 7.2, 2.75, PLAYER_LANE_Z + 3.3);
                desiredTarget = new Vec3(playerX + 3.6, 0.48, PLAYER_LANE_Z);
                this._broadcastDesiredFov = 34;
            } else if (shot === 2) {
                desiredPos = new Vec3(playerX - 5.7, 4.25, PLAYER_LANE_Z + 11.8);
                desiredTarget = new Vec3(playerX + 5.0, 0.36, PLAYER_LANE_Z + 0.1);
                this._broadcastDesiredFov = 36;
            } else if (shot === 3) {
                desiredPos = new Vec3(playerX - 3.9, 2.35, PLAYER_LANE_Z + 7.6);
                desiredTarget = new Vec3(playerX + 2.0, 0.48, PLAYER_LANE_Z);
                this._broadcastDesiredFov = 33;
            } else if (shot === 4) {
                desiredPos = firstPersonCameraPos(playerX);
                desiredTarget = new Vec3(playerX + 9.0, 0.58, PLAYER_LANE_Z);
                this._broadcastDesiredFov = 62;
            }
        }

        if (fixedTopView) {
            this._cameraPos.set(desiredPos);
            this._cameraTarget.set(desiredTarget);
            this._broadcastCameraFov = this._broadcastDesiredFov;
            this._cameraNode.setPosition(this._cameraPos);
            this._cameraNode.lookAt(this._cameraTarget, new Vec3(0, 0, -1));
            this.applyRaceCameraFov();
            return;
        }

        const smooth = raceActive ? cameraBlend(dt, this._broadcastDuelTimer > 0 ? 4.4 : 2.7) : cameraBlend(dt, 5.8);
        Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, smooth);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, desiredTarget, smooth);
        this._broadcastCameraFov += (this._broadcastDesiredFov - this._broadcastCameraFov) * smooth;
        this._cameraNode.setPosition(this._cameraPos);
        this._cameraNode.lookAt(this._cameraTarget);
        this.applyRaceCameraFov();
    }

    private updateRacePresetCamera() {
        if (!this._cameraNode || !this._playerSwimmer) {
            return;
        }

        const playerX = this._playerSwimmer.node.position.x;
        let desiredPos: Vec3;
        let desiredTarget: Vec3;
        if (this._raceCameraMode === RaceCameraMode.Side) {
            desiredTarget = new Vec3(playerX + 3.0, 0.42, PLAYER_LANE_Z);
            desiredPos = new Vec3(desiredTarget.x, 1.6, PLAYER_LANE_Z + 9.6);
        } else if (this._raceCameraMode === RaceCameraMode.Chase) {
            desiredPos = new Vec3(playerX - 7.2, 2.55, PLAYER_LANE_Z + 2.9);
            desiredTarget = new Vec3(playerX + 3.6, 0.42, PLAYER_LANE_Z);
        } else {
            desiredPos = new Vec3(playerX + 1.8, 17.5, PLAYER_LANE_Z + 0.1);
            desiredTarget = new Vec3(playerX + 2.6, 0.12, PLAYER_LANE_Z);
        }
        const smooth = this._state === GameState.RACING ? 0.1 : 0.2;
        Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, smooth);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, desiredTarget, smooth);
        this._cameraNode.setPosition(this._cameraPos);
        this._cameraNode.lookAt(this._cameraTarget);
        this.applyRaceCameraFov();
    }

    private updateRaceFirstPersonCamera() {
        if (!this._cameraNode || !this._playerSwimmer) {
            return;
        }

        const playerX = this._playerSwimmer.node.position.x;
        const desiredPos = firstPersonCameraPos(playerX);
        const desiredTarget = new Vec3(playerX + 9.0, 0.58, PLAYER_LANE_Z);
        this._cameraPos.set(desiredPos);
        this._cameraTarget.set(desiredTarget);
        this._cameraNode.setPosition(this._cameraPos);
        this._cameraNode.lookAt(this._cameraTarget);
        this.applyRaceCameraFov();
    }

    private updateRaceFreeCamera() {
        if (!this._cameraNode || !this._playerSwimmer) {
            return;
        }

        const playerX = this._playerSwimmer.node.position.x;
        const target = new Vec3(playerX + 1.2, 0.55, PLAYER_LANE_Z);
        const cosPitch = Math.cos(this._raceFreeCameraPitch);
        const desiredPos = new Vec3(
            target.x + Math.cos(this._raceFreeCameraYaw) * cosPitch * this._raceFreeCameraDistance,
            target.y + Math.sin(this._raceFreeCameraPitch) * this._raceFreeCameraDistance,
            target.z + Math.sin(this._raceFreeCameraYaw) * cosPitch * this._raceFreeCameraDistance,
        );
        Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, 0.18);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, target, 0.18);
        this._cameraNode.setPosition(this._cameraPos);
        this._cameraNode.lookAt(this._cameraTarget);
        this.applyRaceCameraFov();
    }

    private applyRaceCameraFov() {
        const camera = this._cameraNode?.getComponent(Camera);
        if (!camera || this._modelDebugActive) {
            return;
        }
        camera.fov = this._raceCameraMode === RaceCameraMode.Broadcast
            ? this._broadcastCameraFov
            : this._raceCameraMode === RaceCameraMode.Top
                ? 44
                : this._raceCameraMode === RaceCameraMode.FirstPerson
                    ? 62
                    : this._raceCameraMode === RaceCameraMode.Free ? 38 : 36;
    }

    private resetBroadcastCamera() {
        this._cameraTarget.set(0.2, 0.78, 0);
        this._cameraPos.set(5.8, 1.65, 0);
        this.applyRaceCameraFov();
        if (this._cameraNode) {
            this._cameraNode.setPosition(this._cameraPos);
            this._cameraNode.lookAt(this._cameraTarget);
        }
    }

    private resetBroadcastDirector() {
        this._broadcastShotTimer = 0;
        this._broadcastDuelTimer = 0;
        this._broadcastDuelCooldown = 0;
        this._broadcastDuelShotIndex = 1;
        this._broadcastCameraFov = 42;
        this._broadcastDesiredFov = 42;
        this._broadcastCountdownElapsed = 0;
        this._broadcastRaceElapsed = 0;
        this.pickBroadcastShotSequence();
    }

    private pickBroadcastShotSequence() {
        const sequences = [
            [4, 0, 1, 2, 3],
            [0, 4, 2, 1, 3],
            [2, 0, 4, 3, 1],
            [0, 1, 3, 4, 2],
            [4, 2, 0, 3, 1],
        ];
        this._broadcastShotSequence = sequences[Math.floor(Math.random() * sequences.length)].slice();
        this._broadcastShotSequenceCursor = 0;
        this._broadcastShotIndex = this._broadcastShotSequence[0];
    }

    private advanceBroadcastShot() {
        if (this._broadcastShotSequence.length === 0) {
            this.pickBroadcastShotSequence();
            return;
        }
        this._broadcastShotSequenceCursor++;
        if (this._broadcastShotSequenceCursor >= this._broadcastShotSequence.length) {
            this.pickBroadcastShotSequence();
            return;
        }
        this._broadcastShotIndex = this._broadcastShotSequence[this._broadcastShotSequenceCursor];
    }

    private currentBroadcastShotSeconds(): number {
        return this._broadcastShotIndex === 4 ? FIRST_PERSON_SHOT_SECONDS : BROADCAST_SHOT_SECONDS;
    }

    private closestAiDistanceGap(playerDistance: number): number {
        let gap = Number.POSITIVE_INFINITY;
        for (const swimmer of this._aiSwimmers) {
            if (swimmer.node.active) {
                gap = Math.min(gap, Math.abs(swimmer.distance - playerDistance));
            }
        }
        return gap;
    }

    private enterModelDebug() {
        this.debug('enterModelDebug');
        this._modelDebugActive = true;
        this._modelDebugCameraYaw = Math.PI / 2;
        this._modelDebugCameraPitch = 0.04;
        this._modelDebugCameraDistance = 3.2;
        this._modelDebugCameraDragging = false;
        this._modelDebugSpeedScale = 0.35;
        this.applyModelDebugSpeed();
        if (this._inputManager) {
            this._inputManager.modelDebugMode = true;
        }
        this.stopAllAi();
        this._raceManager?.resetRace();
        this._state = GameState.READY;
        if (this._startScreen) {
            this._startScreen.active = false;
        }
        if (this._raceHud) {
            this._raceHud.active = false;
        }
        if (this._modelDebugHud) {
            this._modelDebugHud.active = true;
        }
        for (const swimmer of this._aiSwimmers) {
            swimmer.node.active = false;
        }
        if (this._playerSwimmer) {
            this._playerSwimmer.node.active = true;
            this._playerSwimmer.reset();
            this._playerSwimmer.node.setPosition(12, 0.24, PLAYER_LANE_Z);
            this._playerSwimmer.cartoonRig?.setModelDebugMode(true);
            this._playerSwimmer.cartoonRig?.setModelDebugSpeedScale(this._modelDebugSpeedScale);
        }
        this.updateModelDebugCamera(1);
        if (this._cameraNode) {
            const camera = this._cameraNode.getComponent(Camera);
            if (camera) {
                camera.fov = 28;
            }
        }
    }

    private exitModelDebug(showStart: boolean) {
        if (!this._modelDebugActive) {
            return;
        }
        this.debug('exitModelDebug');
        this._modelDebugActive = false;
        this._modelDebugCameraDragging = false;
        if (this._inputManager) {
            this._inputManager.modelDebugMode = false;
        }
        if (this._modelDebugHud) {
            this._modelDebugHud.active = false;
        }
        for (const swimmer of this._aiSwimmers) {
            swimmer.node.active = true;
        }
        this._playerSwimmer?.cartoonRig?.setModelDebugMode(false);
        this._playerSwimmer?.reset();
        this.resetExtraAiSwimmers();
        this.resetBroadcastCamera();
        const camera = this._cameraNode?.getComponent(Camera);
        if (camera) {
            camera.fov = 36;
        }
        if (showStart) {
            this.showStartScreen();
        }
    }

    private updateModelDebugCamera(smooth = 0.18) {
        if (!this._cameraNode) {
            return;
        }
        const target = new Vec3(12, 0.54, PLAYER_LANE_Z);
        const cosPitch = Math.cos(this._modelDebugCameraPitch);
        const desiredPos = new Vec3(
            target.x + Math.cos(this._modelDebugCameraYaw) * cosPitch * this._modelDebugCameraDistance,
            target.y + Math.sin(this._modelDebugCameraPitch) * this._modelDebugCameraDistance,
            target.z + Math.sin(this._modelDebugCameraYaw) * cosPitch * this._modelDebugCameraDistance,
        );
        Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, smooth);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, target, smooth);
        this._cameraNode.setPosition(this._cameraPos);
        this._cameraNode.lookAt(this._cameraTarget);
    }

    private onDebugCameraMouseDown(event: EventMouse) {
        const button = event.getButton();
        if (this._modelDebugActive) {
            this._modelDebugCameraDragging = button === EventMouse.BUTTON_LEFT || button === EventMouse.BUTTON_RIGHT || button === EventMouse.BUTTON_MIDDLE;
            return;
        }
        if (this._raceCameraMode === RaceCameraMode.Free && this._state === GameState.RACING) {
            this._raceCameraDragging = button === EventMouse.BUTTON_MIDDLE;
        }
    }

    private onDebugCameraMouseMove(event: EventMouse) {
        if (this._modelDebugActive) {
            if (!this._modelDebugCameraDragging) {
                return;
            }
            this._modelDebugCameraYaw -= event.getDeltaX() * 0.008;
            this._modelDebugCameraPitch += event.getDeltaY() * 0.006;
            this._modelDebugCameraPitch = clamp(this._modelDebugCameraPitch, -0.85, 0.85);
            return;
        }
        if (this._raceCameraMode === RaceCameraMode.Free && this._raceCameraDragging) {
            this._raceFreeCameraYaw -= event.getDeltaX() * 0.006;
            this._raceFreeCameraPitch += event.getDeltaY() * 0.0045;
            this._raceFreeCameraPitch = clamp(this._raceFreeCameraPitch, -0.15, 1.22);
        }
    }

    private onDebugCameraMouseUp() {
        this._modelDebugCameraDragging = false;
        this._raceCameraDragging = false;
    }

    private onDebugCameraWheel(event: EventMouse) {
        if (this._modelDebugActive) {
            this._modelDebugCameraDistance = clamp(this._modelDebugCameraDistance - event.getScrollY() * 0.004, 1.45, 7.5);
            return;
        }
        if (this._raceCameraMode === RaceCameraMode.Free && this._state === GameState.RACING) {
            this._raceFreeCameraDistance = clamp(this._raceFreeCameraDistance - event.getScrollY() * 0.006, 3.2, 22);
        }
    }

    private slowModelDebugMotion() {
        if (!this._modelDebugActive) {
            return;
        }
        this._modelDebugSpeedScale = clamp(this._modelDebugSpeedScale - 0.1, 0.1, 1.5);
        this.applyModelDebugSpeed();
    }

    private speedUpModelDebugMotion() {
        if (!this._modelDebugActive) {
            return;
        }
        this._modelDebugSpeedScale = clamp(this._modelDebugSpeedScale + 0.1, 0.1, 1.5);
        this.applyModelDebugSpeed();
    }

    private applyModelDebugSpeed() {
        this._playerSwimmer?.cartoonRig?.setModelDebugSpeedScale(this._modelDebugSpeedScale);
        if (this._modelDebugSpeedLabel) {
            this._modelDebugSpeedLabel.string = `Speed ${this._modelDebugSpeedScale.toFixed(2)}x`;
        }
        this.debug(`model debug speed=${this._modelDebugSpeedScale.toFixed(2)}x`);
    }

    private startExtraAiSwimmers() {
        for (const swimmer of this._aiSwimmers) {
            if (swimmer !== this._raceManager?.aiSwimmer) {
                swimmer.startRace();
            }
        }
    }

    private resetExtraAiSwimmers() {
        for (const swimmer of this._aiSwimmers) {
            if (swimmer !== this._raceManager?.aiSwimmer) {
                swimmer.reset();
            }
        }
    }

    private startAllAi() {
        for (const controller of this._aiControllers) {
            controller.startSwimming();
        }
    }

    private stopAllAi() {
        for (const controller of this._aiControllers) {
            controller.stopSwimming();
        }
    }

    private toggleDebug() {
        this._debugVisible = !this._debugVisible;
        if (this._debugPanel) {
            this._debugPanel.active = this._debugVisible;
        }
        this.debug(`debug=${this._debugVisible ? 'on' : 'off'}`);
    }

    private drawSpeedBar(ratio: number) {
        drawLeftFill(this._speedFill, 240, 10, Math.max(0, Math.min(1, ratio)), color(89, 234, 160));
    }

    private findCanvasNode(): Node {
        if (this.node.getComponent(Canvas)) {
            return this.node;
        }
        const parent = this.node.parent;
        if (parent?.getComponent(Canvas)) {
            return parent;
        }
        return this.node;
    }

    private cleanRuntimeChildren(canvasNode: Node, sceneRoot: Node) {
        const camera = canvasNode.getChildByName('Camera');
        for (const child of [...canvasNode.children]) {
            if (child !== camera && child !== this.node) {
                child.active = false;
                child.destroy();
            }
        }
        for (const child of [...sceneRoot.children]) {
            if (child.name === 'Runtime3DWorld' || child.name === 'BroadcastCamera3D') {
                child.destroy();
            }
        }
    }

    private paintError(error: unknown) {
        const canvasNode = this.findCanvasNode();
        const panel = mkUiNode('RuntimeErrorPanel', canvasNode);
        panel.setPosition(0, 0, 0);
        mkRect('ErrorBack', panel, 780, 190, color(70, 16, 16, 245));
        const message = error instanceof Error ? error.message : `${error}`;
        const label = mkLabel('ErrorLabel', panel, `Runtime error: ${message}`, 20, color(255, 255, 255));
        label.getComponent(UITransform).setContentSize(720, 120);
        label.setPosition(0, 0, 0);
        console.error('[SpeedSwimming] runtime error', error);
    }

    private debug(message: string) {
        console.log(`[SpeedSwimming] ${message}`);
        this._debugLines.push(message);
        if (this._debugLines.length > 9) {
            this._debugLines.shift();
        }
        if (this._debugLabel) {
            this._debugLabel.string = this._debugLines.join('\n');
        }
    }
}

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function cameraBlend(dt: number, speed: number): number {
    if (dt <= 0) {
        return 0.1;
    }
    return clamp(1 - Math.exp(-dt * speed), 0.035, 0.28);
}

function smoothStep(value: number): number {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}

function firstPersonCameraPos(playerX: number): Vec3 {
    return new Vec3(playerX + 0.95, 0.74, PLAYER_LANE_Z + 0.08);
}

function laneCenterZ(index: number): number {
    return -POOL_WIDTH / 2 + LANE_WIDTH * (index + 0.5);
}

function mat(name: string, albedo: Color): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-standard' });
    material.name = name;
    material.setProperty('albedo', albedo);
    material.setProperty('roughness', 0.68);
    return material;
}

function mkWorldNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.DEFAULT;
    return node;
}

function addBox(parent: Node, name: string, material: Material, pos: Vec3, scale: Vec3): Node {
    const node = mkWorldNode(name, parent);
    node.setPosition(pos);
    node.setScale(scale);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.createMesh(primitives.box());
    renderer.setMaterial(material, 0);
    return node;
}

function addSphere(parent: Node, name: string, material: Material, pos: Vec3, radius: number, scale = new Vec3(1, 1, 1)): Node {
    const node = mkWorldNode(name, parent);
    node.setPosition(pos);
    node.setScale(radius * scale.x, radius * scale.y, radius * scale.z);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.createMesh(primitives.sphere(1, { segments: 18 }));
    renderer.setMaterial(material, 0);
    return node;
}

function mkUiNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform);
    return node;
}

function mkRect(name: string, parent: Node, w: number, h: number, fill: Color): Node {
    const node = mkUiNode(name, parent);
    node.getComponent(UITransform).setContentSize(w, h);
    const gfx = node.addComponent(Graphics);
    gfx.fillColor = fill;
    gfx.rect(-w / 2, -h / 2, w, h);
    gfx.fill();
    return node;
}

function mkLeftRect(name: string, parent: Node, w: number, h: number, fill: Color): Node {
    const node = mkUiNode(name, parent);
    node.getComponent(UITransform).setContentSize(w, h);
    const gfx = node.addComponent(Graphics);
    drawLeftFill(gfx, w, h, 1, fill);
    return node;
}

function mkTouchArea(name: string, parent: Node, w: number, h: number): Node {
    const node = mkUiNode(name, parent);
    node.getComponent(UITransform).setContentSize(w, h);
    const button = node.addComponent(Button);
    button.transition = Button.Transition.NONE;
    return node;
}

function mkLabel(name: string, parent: Node, text: string, fontSize: number, fill: Color): Node {
    const node = mkUiNode(name, parent);
    node.getComponent(UITransform).setContentSize(620, fontSize + 14);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.color = fill;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    return node;
}

function mkButton(name: string, parent: Node, w: number, h: number, fill: Color, text: string): Node {
    const node = mkRect(name, parent, w, h, fill);
    const button = node.addComponent(Button);
    button.transition = Button.Transition.NONE;
    if (text) {
        const labelNode = mkLabel('Label', node, text, 18, color(255, 255, 255, 235));
        labelNode.getComponent(UITransform).setContentSize(w, h);
    }
    return node;
}

function drawLeftFill(gfx: Graphics, w: number, h: number, ratio: number, fill: Color) {
    if (!gfx) {
        return;
    }
    gfx.clear();
    gfx.fillColor = fill;
    gfx.rect(0, -h / 2, w * ratio, h);
    gfx.fill();
}
