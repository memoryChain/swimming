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
import { makeUiNode, makeRect, makeLabel } from '../ui/RuntimeUiFactory';
import { StartScreenBuilder } from '../ui/StartScreenBuilder';
import { UIController } from '../ui/UIController';
import { UIFlowController } from '../ui/UIFlowController';
import { DebugLogController } from './DebugLogController';
import { RaceDistanceMode, setRaceDistance } from './GameBalance';
import { InputManager } from './InputManager';
import { InputRouter } from './InputRouter';
import { RaceManager } from './RaceManager';
import { GameState, Rating, StrokeType } from './GameConstants';
import { formatStabilityLog } from './StabilityScoring';
import { loadSavedTuningAsync } from './TuningDebugControls';
import { RaceCameraDirector, RaceCameraMode } from '../camera/RaceCameraDirector';
import { DEFAULT_POOL_DEFINITION } from '../venue/VenueConfig';
import { LaneLayout } from '../venue/LaneLayout';
import { VenueManager } from '../venue/VenueManager';
import { SpectatorCrowdBuilder } from '../venue/SpectatorCrowdBuilder';
import { FinishRankMarkerBuilder } from '../venue/FinishRankMarkerBuilder';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import type { StrokeTimingGuide } from '../swimmer/SwimmerMotor';

const { ccclass } = _decorator;

const LANE_LAYOUT = new LaneLayout(DEFAULT_POOL_DEFINITION.laneCount, DEFAULT_POOL_DEFINITION.laneWidth);
const COURSE_LAYOUT = new RaceCourseLayout(DEFAULT_POOL_DEFINITION);
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
    private _modelDebugModelLabel: Label = null;
    private _timingGuideFill: Graphics = null;
    private _timingGuideMarker: Node = null;
    private _gameFlow: GameFlowController = null;
    private _modelDebugFlow: ModelDebugFlowController = null;
    private _inputRouter: InputRouter = null;
    private readonly _debugLog = new DebugLogController();
    private readonly _raceCameraDirector = new RaceCameraDirector(PLAYER_LANE_Z, COURSE_LAYOUT);
    private readonly _finishRankMarkers = new FinishRankMarkerBuilder(COURSE_LAYOUT);

    private _cameraPos = new Vec3(-6, 4.7, 10.5);
    private _cameraTarget = new Vec3(8, 0.25, PLAYER_LANE_Z);

    onLoad() {
        game.frameRate = 60;
        console.log(`[SpeedSwimming] target frameRate=${game.frameRate}`);
        this.node.layer = Layers.Enum.UI_2D;
        loadSavedTuningAsync(() => this.scheduleOnce(() => {
            try {
                this.buildScene((error) => {
                    if (error) {
                        this.paintError(error);
                        return;
                    }
                    try {
                        this.registerEvents();
                        this.showStartScreen();
                        this.debug('3D runtime initialized');
                    } catch (setupError) {
                        this.paintError(setupError);
                    }
                });
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
        this.drawStrokeTimingGuide(this._playerSwimmer.strokeTimingGuide, this._state === GameState.RACING);
        if (this._modelDebugFlow?.active) {
            this._modelDebugFlow.update(dt);
            this._modelDebugFlow.updateCamera();
            return;
        }
        this._gameFlow?.updateRaceCamera(dt);
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

    private selectRaceDistance(distance: RaceDistanceMode) {
        const selected = setRaceDistance(distance);
        this.debug(`race distance=${selected}m`);
    }

    private buildScene(done: (error?: unknown) => void) {
        const scene = this.createRuntimeSceneBuilder().build();
        this._worldRoot = scene.worldRoot;
        this._cameraNode = scene.cameraNode;
        this._finishRankMarkers.bind(this._worldRoot);
        this.buildPool3D(this._worldRoot, () => {
            if (!this.node?.isValid || !this._worldRoot?.isValid) {
                return;
            }
            try {
                this.buildSwimmers3D(this._worldRoot);
                this.buildUi(scene.canvasNode, scene.width, scene.height);

                this._raceManager = this.node.getComponent(RaceManager) || this.node.addComponent(RaceManager);
                this._raceManager.playerSwimmer = this._playerSwimmer;
                this._raceManager.aiSwimmer = this._aiController?.swimmer ?? null;
                this._raceManager.aiSwimmers = this._aiSwimmers;
                this._gameFlow = this.createGameFlow();
                this._modelDebugFlow = this.createModelDebugFlow();
                this._inputRouter = this.createInputRouter();
                done();
            } catch (error) {
                done(error);
            }
        });
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
            clearFinishRanks: () => this._finishRankMarkers.clear(),
            showFinishRank: (result) => this._finishRankMarkers.show(result),
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
            modelLabel: this._modelDebugModelLabel,
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

    private buildPool3D(root: Node, done: () => void) {
        const venue = new VenueManager({ debug: (message) => this.debug(message) });
        venue.buildPool(root, DEFAULT_POOL_DEFINITION, ({ pool }) => {
            if (!pool?.isValid) {
                this.buildSpectatorCrowd(root, null);
                done();
                return;
            }
            this.scheduleOnce(() => {
                if (!pool.isValid) {
                    this.buildSpectatorCrowd(root, null);
                    done();
                    return;
                }
                const calibrated = COURSE_LAYOUT.calibrateFromPoolScene(pool, DEFAULT_POOL_DEFINITION, (message) => this.debug(message));
                if (calibrated) {
                    this._raceCameraDirector.resetToBroadcast();
                }
                this.buildSpectatorCrowd(root, pool);
                done();
            }, 0);
        });
    }

    private buildSpectatorCrowd(root: Node, pool: Node | null) {
        try {
            new SpectatorCrowdBuilder().build(root, DEFAULT_POOL_DEFINITION, COURSE_LAYOUT, pool, (message) => this.debug(message));
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            this.debug(`spectator crowd skipped: ${message}`);
            console.warn('[SpeedSwimming] spectator crowd skipped', error);
        }
    }

    private buildSwimmers3D(root: Node) {
        const competitors = new CompetitorManager({
            laneLayout: LANE_LAYOUT,
            courseLayout: COURSE_LAYOUT,
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
        this._timingGuideFill = raceHud.timingGuideFill;
        this._timingGuideMarker = raceHud.timingGuideMarker;

        this._startScreen = new StartScreenBuilder({
            onStart: () => this.startGame(),
            onDistanceSelect: (distance) => this.selectRaceDistance(distance),
            onToggleDebug: () => this.toggleDebug(),
            onModelDebug: () => this.enterModelDebug(),
        }).build(uiRoot, w, h);

        const modelDebugHud = new ModelDebugHudBuilder({
            onExit: () => this.exitModelDebug(true),
            onSlow: () => this.slowModelDebugMotion(),
            onFast: () => this.speedUpModelDebugMotion(),
            onSwitchModel: () => this.switchModelDebugVariant(),
        }).build(uiRoot, w, h);
        this._modelDebugHud = modelDebugHud.root;
        this._modelDebugSpeedLabel = modelDebugHud.speedLabel;
        this._modelDebugRatingLabel = modelDebugHud.ratingLabel;
        this._modelDebugSwimSpeedLabel = modelDebugHud.swimSpeedLabel;
        this._modelDebugModelLabel = modelDebugHud.modelLabel;
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
            if (result.rating === Rating.PERFECT) {
                this._playerSwimmer?.playPerfectFlash();
            }
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

    private switchModelDebugVariant() {
        this._modelDebugFlow?.switchModelVariant();
    }

    private toggleDebug() {
        this._debugLog.toggle();
    }

    private drawSpeedBar(_ratio: number) {
        this.drawStrokeTimingGuide(null, false);
    }

    private drawStrokeTimingGuide(guide: StrokeTimingGuide | null, active: boolean) {
        const gfx = this._timingGuideFill;
        if (!gfx) {
            return;
        }
        const w = 12;
        const h = 216;
        gfx.clear();
        const intervals = guide?.intervals ?? [];
        if (intervals.length <= 0) {
            gfx.fillColor = color(255, 92, 92, 180);
            gfx.rect(-w / 2, -h / 2, w, h);
            gfx.fill();
        } else {
            for (const interval of intervals) {
                const start = Math.max(0, Math.min(1, interval.startRatio));
                const end = Math.max(start, Math.min(1, interval.endRatio));
                gfx.fillColor = interval.rating === Rating.PERFECT
                    ? color(255, 224, 89, 245)
                    : interval.rating === Rating.GOOD
                        ? color(80, 242, 161, 225)
                        : color(255, 92, 92, 190);
                gfx.rect(-w / 2, -h / 2 + start * h, w, Math.max(1, (end - start) * h));
                gfx.fill();
            }
        }
        if (this._timingGuideMarker) {
            const markerVisible = active && !!guide?.active;
            this._timingGuideMarker.active = markerVisible;
            if (markerVisible) {
                const y = -h / 2 + Math.max(0, Math.min(1, guide.currentRatio)) * h;
                this._timingGuideMarker.setPosition(this._timingGuideMarker.position.x, y, 0);
            }
        }
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
