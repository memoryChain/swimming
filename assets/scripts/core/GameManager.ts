import {
    _decorator,
    Color,
    Component,
    director,
    EventMouse,
    game,
    Label,
    Layers,
    Node,
    Sprite,
    UITransform,
    Vec3,
} from 'cc';
import { GameFlowController } from '../app/GameFlowController';
import { PlayerConditionModel } from '../condition/PlayerConditionModel';
import { AiConditionModel } from '../condition/AiConditionModel';
import { RaceContext } from '../condition/RaceContext';
import { RacePhase, SprintTier } from '../condition/ConditionTypes';
import { ModelDebugFlowController } from '../app/ModelDebugFlowController';
import { RuntimeSceneBuilder } from '../app/RuntimeSceneBuilder';
import { StandardSkyboxApplier } from '../app/StandardSkyboxApplier';
import { CompetitorManager } from '../competitor/CompetitorManager';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { DebugPanelBuilder } from '../ui/DebugPanelBuilder';
import { ModelDebugHudBuilder } from '../ui/ModelDebugHudBuilder';
import { makeUiNode, makeRect, makeLabel } from '../ui/RuntimeUiFactory';
import { SpeedStarsUiPrefabBuilder } from '../ui/SpeedStarsUiPrefabBuilder';
import { UIController } from '../ui/UIController';
import { UIFlowController } from '../ui/UIFlowController';
import { DebugLogController } from './DebugLogController';
import { consumeMainGameLaunchMode } from './GameLaunchOptions';
import { InputManager } from './InputManager';
import { InputRouter } from './InputRouter';
import { RaceManager } from './RaceManager';
import { GameState, Rating, StrokeType } from './GameConstants';
import { getRaceDistance } from './GameBalance';
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
    private readonly _playerCondition = new PlayerConditionModel();
    private _aiConditions: AiConditionModel[] = [];
    private readonly _raceContext = new RaceContext(this._playerCondition);
    private _aiController: AISwimmerController = null;
    private _aiControllers: AISwimmerController[] = [];
    private _aiSwimmers: Swimmer[] = [];
    private _uiController: UIController = null;
    private _uiFlow: UIFlowController = null;
    private _inputManager: InputManager = null;

    private _raceHud: Node = null;
    private _modelDebugHud: Node = null;
    private _worldRoot: Node = null;
    private _cameraNode: Node = null;
    private _modelDebugSpeedLabel: Label = null;
    private _modelDebugRatingLabel: Label = null;
    private _modelDebugSwimSpeedLabel: Label = null;
    private _modelDebugModelLabel: Label = null;
    private _modelDebugSkyboxLabel: Label = null;
    private _skyboxApplier: StandardSkyboxApplier = null;
    private _timingGuideFillNode: Node = null;
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
                        this.debug('3D runtime initialized');
                        if (consumeMainGameLaunchMode() === 'model-debug') {
                            this.enterModelDebug();
                        } else {
                            this.startGame();
                        }
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
        this.updatePlayerCondition(dt);
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

    private returnToLogin() {
        director.loadScene('Login');
    }

    private buildScene(done: (error?: unknown) => void) {
        const scene = this.createRuntimeSceneBuilder().build();
        this._worldRoot = scene.worldRoot;
        this._cameraNode = scene.cameraNode;
        this._skyboxApplier = scene.skyboxApplier;
        this._finishRankMarkers.bind(this._worldRoot);
        this.buildPool3D(this._worldRoot, () => {
            if (!this.node?.isValid || !this._worldRoot?.isValid) {
                return;
            }
            try {
                this.buildSwimmers3D(this._worldRoot);
                this.buildUi(scene.canvasNode, scene.width, scene.height, (uiError) => {
                    if (uiError) {
                        done(uiError);
                        return;
                    }
                    this._raceManager = this.node.getComponent(RaceManager) || this.node.addComponent(RaceManager);
                    this._raceManager.playerSwimmer = this._playerSwimmer;
                    this._raceManager.aiSwimmer = this._aiController?.swimmer ?? null;
                    this._raceManager.aiSwimmers = this._aiSwimmers;
                    this._gameFlow = this.createGameFlow();
                    this._modelDebugFlow = this.createModelDebugFlow();
                    this._inputRouter = this.createInputRouter();
                    done();
                });
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
            debug: (message) => this.debug(message),
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
                this.syncConditionPhase(state);
            },
            getState: () => this._state,
            clearFinishRanks: () => this._finishRankMarkers.clear(),
            showFinishRank: (result) => this._finishRankMarkers.show(result),
            applyPlayerDive: (result) => {
                this._playerCondition.reset();
                this._playerCondition.setPhase(RacePhase.START);
                this._playerCondition.applyDiveResult(result);
                for (const aiCondition of this._aiConditions) {
                    aiCondition.reset();
                    aiCondition.setPhase(RacePhase.START);
                }
                this._raceContext.reset();
                this._raceContext.latestDiveResult = result;
            },
            enterSprint: () => {
                this._playerCondition.setPhase(RacePhase.SPRINT);
                for (const aiCondition of this._aiConditions) {
                    aiCondition.setPhase(RacePhase.SPRINT);
                }
                this._raceContext.setPhase(RacePhase.SPRINT);
            },
            updateSprintTier: (tier) => {
                this._playerCondition.updateSprintState({ sprintTier: tier });
                this._raceContext.sprintActive = tier !== SprintTier.STEADY;
            },
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
            skyboxLabel: this._modelDebugSkyboxLabel,
            skyboxApplier: this._skyboxApplier,
            resetExtraAiSwimmers: () => this._gameFlow?.resetExtraAiSwimmers(),
            returnToLogin: () => this.returnToLogin(),
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
            this._aiConditions = [];
            this.debug('race opponents disabled');
            return;
        }

        this._aiController = competitors.primaryAiController;
        this._aiControllers = competitors.aiControllers;
        this._aiSwimmers = competitors.aiSwimmers;
        this._aiConditions = this._aiSwimmers.map(() => new AiConditionModel());
    }

    private buildUi(root: Node, w: number, h: number, done: (error?: unknown) => void) {
        const uiRoot = makeUiNode('RuntimeUIRoot', root);
        const input = uiRoot.addComponent(InputManager);
        input.strokeTarget = this.node;
        input.pointerInputEnabled = false;
        this._inputManager = input;

        new SpeedStarsUiPrefabBuilder({
            onStroke: () => this._inputRouter?.handleAutoPadStroke(),
            onStrokeEnd: () => this._inputRouter?.handleAutoPadStrokeEnd(),
            onDiveHoldStart: () => this._gameFlow?.handleDiveChargeStart(),
            onDiveHoldEnd: (holdSeconds) => this._gameFlow?.handleDiveRelease(holdSeconds),
            onRestart: () => this.restartGame(),
            onMenu: () => this.returnToLogin(),
        }).build(uiRoot, w, h, (error, refs) => {
            if (error || !refs) {
                done(error ?? new Error('SpeedStars UI prefab build failed'));
                return;
            }

            this._raceHud = refs.raceHud;
            this._uiController = refs.uiController;
            this._timingGuideFillNode = refs.timingGuideFillNode;
            this._timingGuideMarker = refs.timingGuideMarker;

            const modelDebugHud = new ModelDebugHudBuilder({
                onExit: () => this.exitModelDebug(true),
                onSlow: () => this.slowModelDebugMotion(),
                onFast: () => this.speedUpModelDebugMotion(),
                onSwitchModel: () => this.switchModelDebugVariant(),
                onSwitchTexture: () => this.switchModelDebugTexture(),
                onSwitchSkybox: () => this.switchModelDebugSkybox(),
            }).build(uiRoot, w, h);
            this._modelDebugHud = modelDebugHud.root;
            this._modelDebugSpeedLabel = modelDebugHud.speedLabel;
            this._modelDebugRatingLabel = modelDebugHud.ratingLabel;
            this._modelDebugSwimSpeedLabel = modelDebugHud.swimSpeedLabel;
            this._modelDebugModelLabel = modelDebugHud.modelLabel;
            this._modelDebugSkyboxLabel = modelDebugHud.skyboxLabel;
            this._modelDebugHud.active = false;

            const debugPanel = new DebugPanelBuilder().build(uiRoot, w, h);
            this._debugLog.bind(debugPanel.root, debugPanel.logLabel);

            this._uiFlow = new UIFlowController({
                raceHud: this._raceHud,
                modelDebugHud: this._modelDebugHud,
                uiController: this._uiController,
                drawSpeedBar: (ratio) => this.drawSpeedBar(ratio),
            });
            done();
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

    private updatePlayerCondition(dt: number) {
        if (this._state !== GameState.RACING) {
            return;
        }
        for (const input of this._playerSwimmer?.consumeConditionInputs() ?? []) {
            this._playerCondition.updateFromStroke(input);
        }
        this._playerCondition.tick(dt);
        this._playerSwimmer?.applyConditionSpeedScale(this._playerCondition.efficiencyModifier);
        this._playerSwimmer?.applyConditionQualityScale(this._playerCondition.qualityModifier);
        this._uiFlow?.updateConditionReadout(
            this._playerCondition.heartRate,
            this._playerCondition.heartRateZone,
            this._playerCondition.energy,
        );
        this._uiFlow?.updateHeartRateBar(this._playerCondition.heartRate, this._playerCondition.heartRateZone);
        this._uiFlow?.setHeartRateBarVisible(true);
        this._uiFlow?.updateEnergyBar(this._playerCondition.energy, this._playerCondition.energyDepleted);
        this._uiFlow?.setEnergyBarVisible(true);
        this._raceContext.setPhase(this._playerCondition.phase);
        this.updateAiConditions(dt);
    }

    private updateAiConditions(dt: number) {
        const raceDistance = getRaceDistance();
        for (let i = 0; i < this._aiConditions.length; i++) {
            const swimmer = this._aiSwimmers[i];
            const controller = this._aiControllers[i];
            if (!swimmer || !controller) {
                continue;
            }
            const progress = raceDistance > 0 ? swimmer.distance / raceDistance : 0;
            this._aiConditions[i].tickAi({
                aiPower: swimmer.aiPower,
                difficulty: controller.difficulty,
                progress,
                dt,
            });
            swimmer.applyConditionSpeedScale(this._aiConditions[i].efficiencyModifier);
            swimmer.applyConditionQualityScale(this._aiConditions[i].qualityModifier);
        }
    }

    private syncConditionPhase(state: GameState) {
        const phase = this.phaseForState(state);
        if (phase === null) {
            return;
        }
        if (phase === RacePhase.PACE && this._playerCondition.phase !== RacePhase.START) {
            return;
        }
        this._playerCondition.setPhase(phase);
        for (const aiCondition of this._aiConditions) {
            aiCondition.setPhase(phase);
        }
        this._raceContext.setPhase(phase);
    }

    private phaseForState(state: GameState): RacePhase | null {
        switch (state) {
            case GameState.COUNTDOWN:
            case GameState.DIVING:
            case GameState.GLIDING:
                return RacePhase.START;
            case GameState.RACING:
                return RacePhase.PACE;
            case GameState.FINISHED:
                return RacePhase.RESULT;
            default:
                return null;
        }
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

    private switchModelDebugTexture() {
        this._modelDebugFlow?.switchColorVariant();
    }

    private switchModelDebugSkybox() {
        this._modelDebugFlow?.switchSkyboxVariant();
    }

    private toggleDebug() {
        this._debugLog.toggle();
    }

    private drawSpeedBar(_ratio: number) {
        this.drawStrokeTimingGuide(null, false);
    }

    private drawStrokeTimingGuide(guide: StrokeTimingGuide | null, active: boolean) {
        const fillNode = this._timingGuideFillNode;
        if (!fillNode) {
            return;
        }
        const h = 216;
        const intervals = guide?.intervals ?? [];
        const sprite = fillNode.getComponent(Sprite);
        const transform = fillNode.getComponent(UITransform);
        if (transform) {
            transform.setContentSize(transform.contentSize.width, h);
            fillNode.setPosition(fillNode.position.x, -3, fillNode.position.z);
        }
        if (intervals.length <= 0) {
            if (sprite) {
                sprite.color = color(255, 82, 91, 180);
            }
        } else {
            const best = intervals.find((interval) => interval.rating === Rating.PERFECT)
                ?? intervals.find((interval) => interval.rating === Rating.GOOD)
                ?? intervals[0];
            if (sprite) {
                sprite.color = best.rating === Rating.PERFECT
                    ? color(255, 214, 64, 245)
                    : best.rating === Rating.GOOD
                        ? color(76, 216, 235, 225)
                        : color(255, 82, 91, 190);
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
