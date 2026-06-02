import {
    _decorator,
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
import { CompetitorManager } from '../competitor/CompetitorManager';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { DebugPanelBuilder } from '../ui/DebugPanelBuilder';
import { ModelDebugHudBuilder } from '../ui/ModelDebugHudBuilder';
import { RaceHudBuilder } from '../ui/RaceHudBuilder';
import { makeUiNode, makeRect, makeLabel, drawLeftFill } from '../ui/RuntimeUiFactory';
import { StartScreenBuilder } from '../ui/StartScreenBuilder';
import { UIController } from '../ui/UIController';
import { InputManager } from './InputManager';
import { RaceManager } from './RaceManager';
import { GameState, MAX_SPEED, RACE_DISTANCE, StrokeType } from './GameConstants';
import { RaceCameraDirector, RaceCameraMode } from '../camera/RaceCameraDirector';
import { DEFAULT_POOL_DEFINITION } from '../venue/VenueConfig';
import { LaneLayout } from '../venue/LaneLayout';
import { VenueManager } from '../venue/VenueManager';

const { ccclass } = _decorator;

const LANE_LAYOUT = new LaneLayout(DEFAULT_POOL_DEFINITION.laneCount, DEFAULT_POOL_DEFINITION.laneWidth);
const POOL_WIDTH = LANE_LAYOUT.poolWidth;
const PLAYER_LANE_INDEX = 3;
const PRIMARY_AI_LANE_INDEX = 4;
const PLAYER_LANE_Z = LANE_LAYOUT.centerZ(PLAYER_LANE_INDEX);
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
        const competitors = new CompetitorManager({
            laneLayout: LANE_LAYOUT,
            playerLaneIndex: PLAYER_LANE_INDEX,
            primaryAiLaneIndex: PRIMARY_AI_LANE_INDEX,
            debug: (message) => this.debug(message),
        }).build(root);
        this._playerSwimmer = competitors.playerSwimmer;
        this._aiController = competitors.primaryAiController;
        this._aiControllers = competitors.aiControllers;
        this._aiSwimmers = competitors.aiSwimmers;
    }

    private buildUi(root: Node, w: number, h: number) {
        const uiRoot = makeUiNode('RuntimeUIRoot', root);
        const input = uiRoot.addComponent(InputManager);
        input.strokeTarget = this.node;
        input.pointerInputEnabled = false;
        this._inputManager = input;

        this._raceHud = makeUiNode('RaceHUD', uiRoot);
        this._raceHud.active = false;
        const raceHud = new RaceHudBuilder({
            onStroke: (type) => this.handlePadStroke(type),
            onRestart: () => this.restartGame(),
            onMenu: () => this.showStartScreen(),
        }).build(this._raceHud, w, h);
        this._uiController = raceHud.uiController;
        this._speedFill = raceHud.speedFill;

        this._startScreen = new StartScreenBuilder({
            onStart: () => this.startGame(),
            onToggleDebug: () => this.toggleDebug(),
            onModelDebug: () => this.enterModelDebug(),
        }).build(uiRoot, w, h);

        const modelDebugHud = new ModelDebugHudBuilder({
            onExit: () => this.exitModelDebug(true),
            onSlow: () => this.slowModelDebugMotion(),
            onFast: () => this.speedUpModelDebugMotion(),
        }).build(uiRoot, w, h);
        this._modelDebugHud = modelDebugHud.root;
        this._modelDebugSpeedLabel = modelDebugHud.speedLabel;
        this._modelDebugHud.active = false;

        const debugPanel = new DebugPanelBuilder().build(uiRoot, w, h);
        this._debugPanel = debugPanel.root;
        this._debugLabel = debugPanel.logLabel;
        this._debugPanel.active = this._debugVisible;
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
        const panel = makeUiNode('RuntimeErrorPanel', canvasNode);
        panel.setPosition(0, 0, 0);
        makeRect('ErrorBack', panel, 780, 190, color(70, 16, 16, 245));
        const message = error instanceof Error ? error.message : `${error}`;
        const label = makeLabel('ErrorLabel', panel, `Runtime error: ${message}`, 20, color(255, 255, 255));
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
