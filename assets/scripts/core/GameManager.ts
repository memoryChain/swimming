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
    Label,
    Layers,
    Node,
    SphereLight,
    UITransform,
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
import { GameState, MAX_SPEED, RACE_DISTANCE, StrokeType } from './GameConstants';
import { RaceCameraDirector, RaceCameraMode } from '../camera/RaceCameraDirector';
import { DEFAULT_POOL_DEFINITION } from '../venue/VenueConfig';
import { LaneLayout } from '../venue/LaneLayout';
import { VenueManager } from '../venue/VenueManager';

const { ccclass } = _decorator;

const LANE_LAYOUT = new LaneLayout(DEFAULT_POOL_DEFINITION.laneCount, DEFAULT_POOL_DEFINITION.laneWidth);
const LANE_COUNT = LANE_LAYOUT.laneCount;
const POOL_WIDTH = LANE_LAYOUT.poolWidth;
const PLAYER_LANE_INDEX = 3;
const PRIMARY_AI_LANE_INDEX = 4;
const PLAYER_LANE_Z = LANE_LAYOUT.centerZ(PLAYER_LANE_INDEX);
const AI_LANE_Z = LANE_LAYOUT.centerZ(PRIMARY_AI_LANE_INDEX);
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
    private readonly _raceCameraDirector = new RaceCameraDirector(PLAYER_LANE_Z);

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
        this._raceCameraDirector.resetToBroadcast();
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
        this._raceCameraDirector.resetToBroadcast();
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
        this._raceCameraDirector.bindCamera(this._cameraNode);
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
        const venue = new VenueManager({ debug: (message) => this.debug(message) });
        venue.buildPool(root, DEFAULT_POOL_DEFINITION);
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
                LANE_LAYOUT.centerZ(lane),
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
                this._raceCameraDirector.resetCountdownTimers();
            }
            if (state === GameState.RACING) {
                this._raceCameraDirector.resetRaceTimers();
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
        this.debug(`race camera=${this._raceCameraDirector.cycleMode()}`);
    }

    private toggleFreeRaceCamera() {
        if (this._modelDebugActive) {
            return;
        }
        this.debug(`race camera=${this._raceCameraDirector.toggleFreeMode()}`);
    }

    private updateRaceCamera(dt: number) {
        if (!this._playerSwimmer) {
            return;
        }
        const playerDistance = this._playerSwimmer.distance;
        this._raceCameraDirector.update(dt, {
            playerX: this._playerSwimmer.node.position.x,
            playerDistance,
            closestAiDistanceGap: this.closestAiDistanceGap(playerDistance),
            raceActive: this._state === GameState.RACING,
            countdownActive: this._state === GameState.COUNTDOWN,
        });
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
        if (this._cameraNode) {
            this._cameraPos.set(this._cameraNode.position);
        }
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
        this._raceCameraDirector.resetBroadcastCamera();
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
        if (this._raceCameraDirector.mode === RaceCameraMode.Free && this._state === GameState.RACING && button === EventMouse.BUTTON_MIDDLE) {
            this._raceCameraDirector.startFreeDrag();
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
        this._raceCameraDirector.dragFreeCamera(event.getDeltaX(), event.getDeltaY());
    }

    private onDebugCameraMouseUp() {
        this._modelDebugCameraDragging = false;
        this._raceCameraDirector.stopFreeDrag();
    }

    private onDebugCameraWheel(event: EventMouse) {
        if (this._modelDebugActive) {
            this._modelDebugCameraDistance = clamp(this._modelDebugCameraDistance - event.getScrollY() * 0.004, 1.45, 7.5);
            return;
        }
        if (this._state === GameState.RACING) {
            this._raceCameraDirector.zoomFreeCamera(event.getScrollY());
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

function mkWorldNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.DEFAULT;
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
