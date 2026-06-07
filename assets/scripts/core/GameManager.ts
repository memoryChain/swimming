import {
    _decorator,
    Color,
    Component,
    EventMouse,
    game,
    Graphics,
    Label,
    Layers,
    Node,
    UITransform,
    Vec3,
} from 'cc';
import { GameFlowController } from '../app/GameFlowController';
import { ModelDebugFlowController } from '../app/ModelDebugFlowController';
import { RuntimeSceneBuilder } from '../app/RuntimeSceneBuilder';
import { CompetitorManager } from '../competitor/CompetitorManager';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { DebugPanelBuilder } from '../ui/DebugPanelBuilder';
import { ModelDebugHudBuilder } from '../ui/ModelDebugHudBuilder';
import { RaceHudBuilder } from '../ui/RaceHudBuilder';
import { makeUiNode, makeRect, makeLabel, drawBottomFill } from '../ui/RuntimeUiFactory';
import { StartScreenBuilder } from '../ui/StartScreenBuilder';
import { UIController } from '../ui/UIController';
import { UIFlowController } from '../ui/UIFlowController';
import { DebugLogController } from './DebugLogController';
import { InputManager } from './InputManager';
import { InputRouter } from './InputRouter';
import { RaceManager } from './RaceManager';
import { SWIMMER_BALANCE } from './GameBalance';
import { GameState, StrokeType } from './GameConstants';
import { formatStabilityLog } from './StabilityScoring';
import { loadSavedTuningAsync } from './TuningDebugControls';
import { RaceCameraDirector, RaceCameraMode } from '../camera/RaceCameraDirector';
import { DEFAULT_POOL_DEFINITION } from '../venue/VenueConfig';
import { LaneLayout } from '../venue/LaneLayout';
import { VenueManager } from '../venue/VenueManager';
import { SpectatorCrowdBuilder } from '../venue/SpectatorCrowdBuilder';

const { ccclass } = _decorator;

const LANE_LAYOUT = new LaneLayout(DEFAULT_POOL_DEFINITION.laneCount, DEFAULT_POOL_DEFINITION.laneWidth);
const POOL_WIDTH = LANE_LAYOUT.poolWidth;
const PLAYER_LANE_INDEX = 3;
const PRIMARY_AI_LANE_INDEX = 4;
const PLAYER_LANE_Z = LANE_LAYOUT.centerZ(PLAYER_LANE_INDEX);
const RACE_OPPONENTS_ENABLED = true;
@ccclass('GameManager')
export class GameManager extends Component {
    private _state = GameState.READY;
    private _raceManager: RaceManager = null;
    private _playerSwimmer: Swimmer = null;
    private _aiController: AISwimmerController = null;
    private _aiControllers: AISwimmerController[] = [];
    private _aiSwimmers: Swimmer[] = [];
    private _uiController: UIController = null;
    private _uiFlow: UIFlowController = null;
    private _inputManager: InputManager = null;

    private _startScreen: Node = null;
    private _raceHud: Node = null;
    private _modelDebugHud: Node = null;
    private _worldRoot: Node = null;
    private _cameraNode: Node = null;
    private _modelDebugSpeedLabel: Label = null;
    private _modelDebugRatingLabel: Label = null;
    private _modelDebugSwimSpeedLabel: Label = null;
    private _speedFill: Graphics = null;
    private _gameFlow: GameFlowController = null;
    private _modelDebugFlow: ModelDebugFlowController = null;
    private _inputRouter: InputRouter = null;
    private readonly _debugLog = new DebugLogController();
    private readonly _raceCameraDirector = new RaceCameraDirector(PLAYER_LANE_Z);
    private _ceilingHiddenForTopView = false;

    private _cameraPos = new Vec3(-6, 4.7, 10.5);
    private _cameraTarget = new Vec3(8, 0.25, PLAYER_LANE_Z);

    onLoad() {
        game.frameRate = 60;
        console.log(`[SpeedSwimming] target frameRate=${game.frameRate}`);
        this.node.layer = Layers.Enum.UI_2D;
        loadSavedTuningAsync(() => this.scheduleOnce(() => {
            try {
                this.buildScene();
                this.registerEvents();
                this.showStartScreen();
                this.debug('3D runtime initialized');
            } catch (error) {
                this.paintError(error);
            }
        }, 0));
    }

    onDestroy() {
        this._inputRouter?.unbind();
        this._gameFlow?.stopAllAi();
        this._gameFlow?.clearRaceManagerCallbacks();
    }

    update(dt: number) {
        if (!this._playerSwimmer) {
            return;
        }
        this._uiFlow?.updateSpeed(this._playerSwimmer.currentSpeed);
        this._uiFlow?.updateSwimTelemetry(
            this._playerSwimmer.currentStability,
            this._playerSwimmer.currentAcceleration,
            this._playerSwimmer.currentSpeed,
        );
        this.consumePlayerRhythmResults();
        this.drawSpeedBar(this._playerSwimmer.currentSpeed / SWIMMER_BALANCE.maxSpeed);
        if (this._modelDebugFlow?.active) {
            this._modelDebugFlow.update(dt);
            this._modelDebugFlow.updateCamera();
            this.updateTopViewCeilingVisibility(false);
            return;
        }
        this._gameFlow?.updateRaceCamera(dt);
        this.updateTopViewCeilingVisibility(this._raceCameraDirector.topViewActive);
    }

    startGame() {
        this._inputRouter?.resetAutoPadSequence();
        this._gameFlow?.startGame();
    }

    restartGame() {
        this._gameFlow?.restartGame();
    }

    private showStartScreen() {
        this._gameFlow?.showStartScreen();
    }

    private buildScene() {
        const scene = this.createRuntimeSceneBuilder().build();
        this._worldRoot = scene.worldRoot;
        this._cameraNode = scene.cameraNode;
        this.buildPool3D(this._worldRoot);
        this.buildSwimmers3D(this._worldRoot);
        this.buildUi(scene.canvasNode, scene.width, scene.height);

        this._raceManager = this.node.getComponent(RaceManager) || this.node.addComponent(RaceManager);
        this._raceManager.playerSwimmer = this._playerSwimmer;
        this._raceManager.aiSwimmer = this._aiController?.swimmer ?? null;
        this._raceManager.aiSwimmers = this._aiSwimmers;
        this._gameFlow = this.createGameFlow();
        this._modelDebugFlow = this.createModelDebugFlow();
        this._inputRouter = this.createInputRouter();
    }

    private createRuntimeSceneBuilder(): RuntimeSceneBuilder {
        return new RuntimeSceneBuilder({
            owner: this,
            cameraDirector: this._raceCameraDirector,
            initialCameraPosition: this._cameraPos,
            initialCameraTarget: this._cameraTarget,
            poolWidth: POOL_WIDTH,
        });
    }

    private createGameFlow(): GameFlowController {
        return new GameFlowController({
            raceManager: this._raceManager,
            playerSwimmer: this._playerSwimmer,
            aiSwimmers: this._aiSwimmers,
            aiControllers: this._aiControllers,
            uiFlow: this._uiFlow,
            raceCameraDirector: this._raceCameraDirector,
            exitModelDebug: (showStart) => this.exitModelDebug(showStart),
            handleModelDebugStroke: (type) => this._modelDebugFlow?.handleStroke(type) ?? false,
            handleModelDebugStrokeHeld: (type, held) => this._modelDebugFlow?.handleStrokeHeld(type, held) ?? false,
            setState: (state) => {
                this._state = state;
            },
            getState: () => this._state,
            debug: (message) => this.debug(message),
        });
    }

    private createModelDebugFlow(): ModelDebugFlowController {
        return new ModelDebugFlowController({
            worldRoot: this._worldRoot,
            cameraNode: this._cameraNode,
            cameraPos: this._cameraPos,
            cameraTarget: this._cameraTarget,
            playerLaneZ: PLAYER_LANE_Z,
            inputManager: this._inputManager,
            raceManager: this._raceManager,
            raceCameraDirector: this._raceCameraDirector,
            playerSwimmer: this._playerSwimmer,
            aiSwimmers: this._aiSwimmers,
            aiControllers: this._aiControllers,
            uiFlow: this._uiFlow,
            speedLabel: this._modelDebugSpeedLabel,
            ratingLabel: this._modelDebugRatingLabel,
            swimSpeedLabel: this._modelDebugSwimSpeedLabel,
            resetExtraAiSwimmers: () => this._gameFlow?.resetExtraAiSwimmers(),
            showStartScreen: () => this.showStartScreen(),
            setState: (state) => {
                this._state = state;
            },
            debug: (message) => this.debug(message),
        });
    }

    private createInputRouter(): InputRouter {
        return new InputRouter(this.node, {
            onStroke: (type) => this.handlePlayerStroke(type),
            onStrokeHeld: (type, held) => this.handlePlayerStrokeHeld(type, held),
            onDiveChargeStart: () => this._gameFlow?.handleDiveChargeStart(),
            onDiveRelease: (holdSeconds) => this._gameFlow?.handleDiveRelease(holdSeconds),
            onPrimaryAction: () => this._gameFlow?.handlePrimaryAction(),
            onToggleDebug: () => this.toggleDebug(),
            onCycleRaceCamera: () => this.cycleRaceCamera(),
            onToggleFreeRaceCamera: () => this.toggleFreeRaceCamera(),
            onModelDebugSpeedDown: () => this.slowModelDebugMotion(),
            onModelDebugSpeedUp: () => this.speedUpModelDebugMotion(),
            onDebugCameraMouseDown: (event) => this.onDebugCameraMouseDown(event),
            onDebugCameraMouseMove: (event) => this.onDebugCameraMouseMove(event),
            onDebugCameraMouseUp: () => this.onDebugCameraMouseUp(),
            onDebugCameraWheel: (event) => this.onDebugCameraWheel(event),
        });
    }

    private buildPool3D(root: Node) {
        const venue = new VenueManager({ debug: (message) => this.debug(message) });
        venue.buildPool(root, DEFAULT_POOL_DEFINITION);
        try {
            new SpectatorCrowdBuilder().build(root, DEFAULT_POOL_DEFINITION, (message) => this.debug(message));
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            this.debug(`spectator crowd skipped: ${message}`);
            console.warn('[SpeedSwimming] spectator crowd skipped', error);
        }
    }

    private buildSwimmers3D(root: Node) {
        const competitors = new CompetitorManager({
            laneLayout: LANE_LAYOUT,
            playerLaneIndex: PLAYER_LANE_INDEX,
            primaryAiLaneIndex: PRIMARY_AI_LANE_INDEX,
            debug: (message) => this.debug(message),
        }).build(root);
        this._playerSwimmer = competitors.playerSwimmer;
        if (!RACE_OPPONENTS_ENABLED) {
            for (const swimmer of competitors.aiSwimmers) {
                swimmer.stopRace();
                swimmer.node.active = false;
            }
            for (const controller of competitors.aiControllers) {
                controller.stopSwimming();
            }
            this._aiController = null;
            this._aiControllers = [];
            this._aiSwimmers = [];
            this.debug('race opponents disabled');
            return;
        }

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
            onStroke: () => this._inputRouter?.handleAutoPadStroke(),
            onStrokeEnd: () => this._inputRouter?.handleAutoPadStrokeEnd(),
            onDiveHoldStart: () => this._gameFlow?.handleDiveChargeStart(),
            onDiveHoldEnd: (holdSeconds) => this._gameFlow?.handleDiveRelease(holdSeconds),
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
        this._modelDebugRatingLabel = modelDebugHud.ratingLabel;
        this._modelDebugSwimSpeedLabel = modelDebugHud.swimSpeedLabel;
        this._modelDebugHud.active = false;

        const debugPanel = new DebugPanelBuilder().build(uiRoot, w, h);
        this._debugLog.bind(debugPanel.root, debugPanel.logLabel);

        this._uiFlow = new UIFlowController({
            startScreen: this._startScreen,
            raceHud: this._raceHud,
            modelDebugHud: this._modelDebugHud,
            uiController: this._uiController,
            drawSpeedBar: (ratio) => this.drawSpeedBar(ratio),
        });
    }

    private registerEvents() {
        this._inputRouter?.bind();
        this._gameFlow?.bindRaceManagerCallbacks();
    }

    private handlePlayerStroke(type: StrokeType) {
        this._gameFlow?.handlePlayerStroke(type);
    }

    private handlePlayerStrokeHeld(type: StrokeType, held: boolean) {
        this._gameFlow?.handlePlayerStrokeHeld(type, held);
    }

    private consumePlayerRhythmResults() {
        if (this._state !== GameState.RACING) {
            return;
        }
        for (const result of this._playerSwimmer?.consumeRhythmResults() ?? []) {
            this.debug(formatStabilityLog('stability', result));
            this._uiFlow?.showRating(result.rating, result.combo);
        }
    }

    private cycleRaceCamera() {
        if (this._modelDebugFlow?.active) {
            return;
        }
        this.debug(`race camera=${this._gameFlow?.cycleRaceCamera()}`);
    }

    private toggleFreeRaceCamera() {
        if (this._modelDebugFlow?.active) {
            return;
        }
        this.debug(`race camera=${this._gameFlow?.toggleFreeRaceCamera()}`);
    }

    private enterModelDebug() {
        this._modelDebugFlow?.enter();
    }

    private exitModelDebug(showStart: boolean) {
        this._modelDebugFlow?.exit(showStart);
    }

    private onDebugCameraMouseDown(event: EventMouse) {
        const button = event.getButton();
        if (this._modelDebugFlow?.onMouseDown(event)) {
            return;
        }
        if (this._raceCameraDirector.mode === RaceCameraMode.Free && this._state === GameState.RACING && button === EventMouse.BUTTON_MIDDLE) {
            this._raceCameraDirector.startFreeDrag();
        }
    }

    private onDebugCameraMouseMove(event: EventMouse) {
        if (this._modelDebugFlow?.onMouseMove(event)) {
            return;
        }
        this._raceCameraDirector.dragFreeCamera(event.getDeltaX(), event.getDeltaY());
    }

    private onDebugCameraMouseUp() {
        this._modelDebugFlow?.onMouseUp();
        this._raceCameraDirector.stopFreeDrag();
    }

    private onDebugCameraWheel(event: EventMouse) {
        if (this._modelDebugFlow?.onMouseWheel(event)) {
            return;
        }
        if (this._state === GameState.RACING) {
            this._raceCameraDirector.zoomFreeCamera(event.getScrollY());
        }
    }

    private slowModelDebugMotion() {
        this._modelDebugFlow?.slowMotion();
    }

    private speedUpModelDebugMotion() {
        this._modelDebugFlow?.speedUpMotion();
    }

    private toggleDebug() {
        this._debugLog.toggle();
    }

    private updateTopViewCeilingVisibility(topViewActive: boolean) {
        if (!this._worldRoot || this._ceilingHiddenForTopView === topViewActive) {
            return;
        }
        this._ceilingHiddenForTopView = topViewActive;
        setCeilingNodesVisible(this._worldRoot, !topViewActive);
    }

    private drawSpeedBar(ratio: number) {
        drawBottomFill(this._speedFill, 12, 216, Math.max(0, Math.min(1, ratio)), color(89, 234, 160));
    }

    private paintError(error: unknown) {
        const canvasNode = this.createRuntimeSceneBuilder().findCanvasNode();
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
        this._debugLog.log(message);
    }
}

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}

function setCeilingNodesVisible(root: Node, visible: boolean) {
    const lowerName = root.name.toLowerCase();
    if (lowerName.includes('ceiling')) {
        root.active = visible;
        return;
    }
    for (const child of root.children) {
        setCeilingNodesVisible(child, visible);
    }
}
