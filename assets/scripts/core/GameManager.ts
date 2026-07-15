import {
    _decorator,
    Camera,
    Color,
    Component,
    director,
    EventMouse,
    game,
    geometry,
    Graphics,
    Label,
    Layers,
    Material,
    MeshRenderer,
    Node,
    primitives,
    Sprite,
    UITransform,
    utils,
    Vec3,
    view,
} from 'cc';
import { GameFlowController } from '../app/GameFlowController';
import { PlayerConditionModel } from '../condition/PlayerConditionModel';
import { AiConditionModel } from '../condition/AiConditionModel';
import { RaceContext } from '../condition/RaceContext';
import { RacePhase } from '../condition/ConditionTypes';
import { ModelDebugFlowController } from '../app/ModelDebugFlowController';
import { RuntimeSceneBuilder } from '../app/RuntimeSceneBuilder';
import { StandardSkyboxApplier } from '../app/StandardSkyboxApplier';
import { CompetitorManager } from '../competitor/CompetitorManager';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { DebugPanelBuilder } from '../ui/DebugPanelBuilder';
import { AiDifficultyPanel } from '../ui/AiDifficultyPanel';
import { ModelDebugHudBuilder } from '../ui/ModelDebugHudBuilder';
import { makeUiNode, makeRect, makeLabel, makeButton } from '../ui/RuntimeUiFactory';
import { LoadingOverlay } from '../ui/LoadingOverlay';
import { SpeedStarsUiPrefabBuilder } from '../ui/SpeedStarsUiPrefabBuilder';
import { SweetZoneBar } from '../ui/SweetZoneBar';
import { PreRaceIntroPanel, PreRaceIntroEntry } from '../ui/PreRaceIntroPanel';
import { UIController } from '../ui/UIController';
import { UIFlowController } from '../ui/UIFlowController';
import { DebugLogController } from './DebugLogController';
import { consumeMainGameLaunchMode, getAiDebugDifficulty } from './GameLaunchOptions';
import { InputManager } from './InputManager';
import { InputRouter } from './InputRouter';
import { RaceManager } from './RaceManager';
import { GameState, Rating, StrokeType } from './GameConstants';
import { getRaceDistance } from './GameBalance';
import { loadSavedTuningAsync } from './TuningDebugControls';
import { PERFORMANCE_CONFIG } from './PerformanceConfig';
import { setTimeScale, scaledDelta } from './TimeScale';
import { RaceCameraDirector } from '../camera/RaceCameraDirector';
import { DEFAULT_POOL_DEFINITION } from '../venue/VenueConfig';
import { LaneLayout } from '../venue/LaneLayout';
import { VenueManager } from '../venue/VenueManager';
import { WaterRefractionController } from '../venue/WaterRefractionController';
import { ScoreboardFeedCamera } from '../camera/ScoreboardFeedCamera';
import { SpectatorCrowdBuilder } from '../venue/SpectatorCrowdBuilder';
import { FinishRankMarkerBuilder } from '../venue/FinishRankMarkerBuilder';
import { AwardsPresentation } from '../venue/AwardsPresentation';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { TopViewCeilingController } from '../venue/TopViewCeilingController';
import type { StrokeTimingGuide } from '../swimmer/SwimmerMotor';
import { loadSampledActionsForRace } from '../character/SampledActionLoader';

const { ccclass } = _decorator;

const LANE_LAYOUT = new LaneLayout(DEFAULT_POOL_DEFINITION.laneCount, DEFAULT_POOL_DEFINITION.laneWidth);
const COURSE_LAYOUT = new RaceCourseLayout(DEFAULT_POOL_DEFINITION);
const POOL_WIDTH = LANE_LAYOUT.poolWidth;
const PLAYER_LANE_INDEX = 3;
const PRIMARY_AI_LANE_INDEX = 4;
const PLAYER_LANE_Z = LANE_LAYOUT.centerZ(PLAYER_LANE_INDEX);
const RACE_OPPONENTS_ENABLED = true;
const UNDERWATER_TINT_DISTANCE = 1.2;
const UNDERWATER_TINT_DEPTH = 0.002;
const UNDERWATER_TINT_MARGIN = 1.45;
// Debug bullet-time cycle (B key): full speed -> slower stages -> back to full.
const BULLET_TIME_SCALES = [1, 0.5, 0.25, 0.1];
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
    // 100m AI-debug 1v1 mode: a single opponent at PRIMARY_AI_LANE_INDEX whose
    // difficulty is chosen from the login picker.
    private _aiDebugMode = false;
    private _aiDebugDifficulty = 0.8;
    private _splashCullingEnabled: boolean = PERFORMANCE_CONFIG.splash.cullingEnabled;
    private _splashParticlesEnabled: boolean = PERFORMANCE_CONFIG.splash.particleEmittersEnabled;
    private _uiController: UIController = null;
    private _uiFlow: UIFlowController = null;
    private readonly _preRaceIntroPanel = new PreRaceIntroPanel();
    private _inputManager: InputManager = null;
    // True while a pointer is dragging to orbit the awards free-look camera.
    private _awardsCameraDragging = false;

    private _raceHud: Node = null;
    private _modelDebugHud: Node = null;
    private _underwaterCameraTint: Node = null;
    private _worldRoot: Node = null;
    private _swimmersRoot: Node = null;
    private _poolNode: Node = null;
    private _cameraNode: Node = null;
    private _waterRefraction: WaterRefractionController | null = null;
    private _scoreboardFeed: ScoreboardFeedCamera | null = null;
    private readonly _topViewCeiling = new TopViewCeilingController();
    private readonly _splashCullAabb = new geometry.AABB();
    private readonly _tmpSplashCullCenter = new Vec3();
    private readonly _tmpDialRight = new Vec3();
    // Sweet-zone dials float above each swimmer's head and follow them. World Y
    // offset lifts the anchor above the (roughly water-level, horizontal) body;
    // the screen-space spread keeps the two hand dials side by side and the extra
    // screen Y nudge pushes the pair above the projected head point.
    // Sweet-zone dials float above each swimmer's head and follow them. The world
    // anchor sits just above the (roughly water-level, horizontal) body; the gap
    // above the head and the side-by-side spread are screen-space and scale with
    // the dial so it keeps a consistent look as it grows/shrinks with distance.
    private readonly _dialHeadWorldOffsetY = 0.4;
    private readonly _dialScreenSpread = 88;
    private readonly _dialScreenOffsetY = 66;
    private readonly _playerSpeedScreenOffsetY = 52;
    private readonly _playerSpeedTopViewOffsetY = 80;
    private readonly _playerPreRaceMarkerScreenOffsetY = 18;
    // Perspective scaling: scale = refDistance / cameraDistance, clamped. At the
    // reference distance the dial is drawn at 1:1; nearer swimmers get a bigger
    // dial, farther ones a smaller one.
    private readonly _dialRefDistance = 11;
    private readonly _dialMinScale = 0.5;
    private readonly _dialMaxScale = 1.5;
    private readonly _tmpDialAnchorWorld = new Vec3();
    private readonly _tmpDialAnchorUi = new Vec3();
    private readonly _tmpDialScreen = new Vec3();
    private _uiCamera: Camera = null;
    // Player identification stays a constant screen size so it remains readable
    // when the race camera pulls far back.
    private _overheadReadout: Node = null;
    private _overheadSpeedLabel: Label = null;
    private _playerOverheadMarker: Node = null;
    private _modelDebugSpeedLabel: Label = null;
    private _modelDebugRatingLabel: Label = null;
    private _modelDebugSwimSpeedLabel: Label = null;
    private _modelDebugModelLabel: Label = null;
    private _modelDebugActionLabel: Label = null;
    private _modelDebugSkyboxLabel: Label = null;
    private _skyboxApplier: StandardSkyboxApplier = null;
    private _timingGuideFillNode: Node = null;
    private _timingGuideMarker: Node = null;
    // Left and right arms are independent stroke queues, so each hand gets its own
    // sweet-zone dial (left dial shows the swimmer's speed; right dial omits it).
    private readonly _sweetZoneBarLeft = new SweetZoneBar();
    private readonly _sweetZoneBarRight = new SweetZoneBar();
    // 100m AI-debug 1v1 extras: a second pair of sweet-zone dials for the opponent
    // and a camera-follow-AI toggle button. Built always but only shown in ai-debug.
    private readonly _aiSweetZoneBarLeft = new SweetZoneBar();
    private readonly _aiSweetZoneBarRight = new SweetZoneBar();
    private _cameraFollowsAi = false;
    private _aiDebugCameraButton: Node = null;
    private _aiDebugCameraButtonLabel: Label = null;
    private _raceCameraButton: Node = null;
    private _raceCameraButtonLabel: Label = null;
    private _scoreboardViewButton: Node = null;
    private _scoreboardViewButtonLabel: Label = null;
    private _gameFlow: GameFlowController = null;
    private _modelDebugFlow: ModelDebugFlowController = null;
    private _inputRouter: InputRouter = null;
    private readonly _debugLog = new DebugLogController();
    private readonly _aiDifficultyPanel = new AiDifficultyPanel();
    // Debug bullet-time: cycles the global scheduler time scale so the whole
    // race (movement, limb motion, splashes, camera) can be observed in slow
    // motion while tuning feel. Input classification uses wall-clock, so key
    // presses stay responsive. Toggle with the B key.
    private _bulletTimeIndex = 0;
    private readonly _raceCameraDirector = new RaceCameraDirector(PLAYER_LANE_Z, COURSE_LAYOUT);
    private readonly _finishRankMarkers = new FinishRankMarkerBuilder(COURSE_LAYOUT);
    private readonly _awardsPresentation = new AwardsPresentation(COURSE_LAYOUT);
    private _cameraPos = new Vec3(-6, 4.7, 10.5);
    private _cameraTarget = new Vec3(8, 0.25, PLAYER_LANE_Z);

    onLoad() {
        game.frameRate = 60;
        console.log(`[SpeedSwimming] target frameRate=${game.frameRate}`);
        this.node.layer = Layers.Enum.UI_2D;
        loadSavedTuningAsync(() => this.scheduleOnce(() => {
            loadSampledActionsForRace((actionError) => {
                if (actionError) {
                    this.paintError(actionError);
                    return;
                }
                try {
                    this.buildScene((error) => {
                        if (error) {
                            this.paintError(error);
                            return;
                        }
                        try {
                            this.registerEvents();
                            this.debug('3D runtime initialized');
                            const launchMode = consumeMainGameLaunchMode();
                            if (launchMode === 'model-debug') {
                                this.enterModelDebug();
                            } else {
                                this._aiDebugMode = launchMode === 'ai-debug';
                                if (this._aiDebugMode) {
                                    this._aiDebugDifficulty = getAiDebugDifficulty();
                                }
                                this.applyAiDebugHud();
                                this.startGame();
                            }
                            // Race scene is fully built and its initial camera /
                            // state are set: reveal it by dropping the loading
                            // cover that spanned the scene switch.
                            LoadingOverlay.hide();
                        } catch (setupError) {
                            this.paintError(setupError);
                        }
                    });
                } catch (error) {
                    this.paintError(error);
                }
            });
        }, 0));
    }

    onDestroy() {
        this._inputRouter?.unbind();
        this._gameFlow?.stopAllAi();
        this._gameFlow?.clearRaceManagerCallbacks();
        this._waterRefraction?.dispose();
        this._waterRefraction = null;
        this._scoreboardFeed?.dispose();
        this._scoreboardFeed = null;
        this._awardsPresentation.dispose();
        this._topViewCeiling.dispose();
    }

    update(dt: number) {
        if (!this._playerSwimmer) {
            return;
        }
        // Bullet-time: everything GameManager drives (camera, model debug, etc.)
        // runs on the scaled delta. Input classification stays on wall-clock.
        dt = scaledDelta(dt);
        this._awardsPresentation.update(dt);
        this._inputRouter?.tick();
        // Keep the refraction camera locked to the current view every frame so the
        // water bends whatever is beneath it from any camera mode.
        this._waterRefraction?.update();
        this.consumePlayerRhythmResults();
        this.updatePlayerCondition(dt);
        const timingGuide = this._playerSwimmer.strokeTimingGuide;
        const raceActive = this._state === GameState.RACING;
        const raceDistance = getRaceDistance();
        const playerBeforeFinish = this._playerSwimmer.distance < raceDistance;
        const raceStatusVisible = !this._modelDebugFlow?.active
            && playerBeforeFinish
            && (this._state === GameState.GLIDING || this._state === GameState.RACING);
        this._uiFlow?.setRaceStatusVisible(raceStatusVisible);
        const presentationIndicatorVisible = this._state === GameState.PRECOUNTDOWN
            || this._state === GameState.AWARDS;
        // The player can finish before the last AI swimmer. Hide player-specific
        // overhead UI as soon as the player's own distance reaches the wall during
        // the race, but always identify the protagonist in presentation stages.
        const playerIndicatorVisible = !this._modelDebugFlow?.active
            && (presentationIndicatorVisible || (
                this._state !== GameState.READY
                && this._state !== GameState.FINISHED
                && playerBeforeFinish
            ));
        if (this._raceCameraButton?.isValid) {
            this._raceCameraButton.active = playerIndicatorVisible && raceActive;
        }
        if (this._scoreboardViewButton?.isValid) {
            this._scoreboardViewButton.active = playerIndicatorVisible && raceActive;
        }
        // Motor speed becomes meaningful after the dive has entered its glide.
        // Keep the player marker visible before takeoff, but hide the speed text.
        const playerSpeedVisible = playerIndicatorVisible
            && (this._state === GameState.GLIDING || this._state === GameState.RACING);
        // Sweet-zone timing feedback is a tuning aid. Keep it out of normal
        // races and only expose it in the dedicated AI-difficulty debug race.
        const playerFeedbackVisible = this._aiDebugMode && raceActive && playerBeforeFinish;
        this.drawStrokeTimingGuide(timingGuide, playerFeedbackVisible);
        const playerFacing = this.dialFacingSign(this._playerSwimmer);
        const playerSpeed = this._playerSwimmer.currentSpeed;
        this._sweetZoneBarLeft.setVisible(playerFeedbackVisible);
        this._sweetZoneBarRight.setVisible(playerFeedbackVisible);
        this._sweetZoneBarLeft.update(playerFeedbackVisible ? this._playerSwimmer.strokeTimingGuideForSide(StrokeType.LEFT) : null, playerSpeed, playerFacing);
        this._sweetZoneBarRight.update(playerFeedbackVisible ? this._playerSwimmer.strokeTimingGuideForSide(StrokeType.RIGHT) : null, playerSpeed, playerFacing);
        if (this._overheadReadout) {
            this._overheadReadout.active = playerSpeedVisible;
        }
        if (this._playerOverheadMarker) {
            this._playerOverheadMarker.active = playerIndicatorVisible;
        }
        if (playerIndicatorVisible) {
            this.positionSweetZoneDialsAbove(
                this._playerSwimmer,
                this._sweetZoneBarLeft,
                this._sweetZoneBarRight,
                this._overheadReadout,
                this._playerOverheadMarker,
            );
            if (this._overheadSpeedLabel) {
                this._overheadSpeedLabel.string = `${Math.max(0, playerSpeed).toFixed(2)} m/s`;
            }
        }
        this.updateAiSweetZoneBar(raceActive);
        this.updateSplashCulling();
        // Roster info panel only during pre-race stage 1 (the wide overview shot);
        // it fades out as the per-lane close-up sweep begins.
        this._preRaceIntroPanel.setVisible(
            !this._modelDebugFlow?.active
            && this._state === GameState.PRECOUNTDOWN
            && this._raceCameraDirector.preRacePhase === 'overview',
        );
        if (this._modelDebugFlow?.active) {
            this._topViewCeiling.update(false);
            this.setUnderwaterOverlayVisible(false);
            this._modelDebugFlow.update(dt);
            this._modelDebugFlow.updateCamera();
            return;
        }
        this._gameFlow?.updateRaceCamera(dt);
        this._topViewCeiling.update(this._raceCameraDirector.topViewActive);
        this.setUnderwaterOverlayVisible(this._raceCameraDirector.underwaterViewActive);
    }

    // Cull splash + freeze pose for AI swimmers that are outside the camera frustum. Testing against the
    // real camera frustum (instead of a 1D X-distance guess) correctly handles zoom and any camera mode
    // (broadcast / top / underwater). Off-screen swimmers skip all particle/foam and pose work.
    // 对相机视锥体之外的 AI 选手裁剪水花并冻结姿态。用真实视锥（而非一维 X 距离估算）能正确处理缩放和任意
    // 机位（转播/俯视/水下/自由）。离屏选手跳过全部粒子/泡沫与姿态计算。
    private updateSplashCulling() {
        if (this._modelDebugFlow?.active) {
            return;
        }
        const playerNode = this._playerSwimmer?.node;
        if (!playerNode?.isValid) {
            return;
        }
        if (!this._splashCullingEnabled) {
            // Toggle off: make sure no swimmer stays culled so we can A/B compare performance.
            // 关闭裁剪：确保没有选手仍处于裁剪状态，方便对比开/关的性能差异。
            for (const swimmer of this._aiSwimmers) {
                swimmer?.setSplashCulled(false);
            }
            return;
        }
        const frustum = this._cameraNode?.getComponent(Camera)?.camera?.frustum ?? null;
        const marginXZ = PERFORMANCE_CONFIG.splash.visibilityMarginXZ;
        const marginY = PERFORMANCE_CONFIG.splash.visibilityMarginY;
        const playerX = playerNode.position.x;
        for (const swimmer of this._aiSwimmers) {
            const node = swimmer?.node;
            if (!node?.isValid) {
                continue;
            }
            let culled: boolean;
            if (frustum) {
                const pos = node.position;
                this._tmpSplashCullCenter.set(pos.x, pos.y, pos.z);
                geometry.AABB.set(
                    this._splashCullAabb,
                    this._tmpSplashCullCenter.x, this._tmpSplashCullCenter.y, this._tmpSplashCullCenter.z,
                    marginXZ, marginY, marginXZ,
                );
                culled = geometry.intersect.aabbFrustum(this._splashCullAabb, frustum) === 0;
            } else {
                // Fallback before the camera frustum is available: 1D X-distance window.
                // 相机视锥不可用时的回退：一维 X 距离窗口。
                culled = Math.abs(node.position.x - playerX) > PERFORMANCE_CONFIG.splash.cullingDistanceX;
            }
            swimmer.setSplashCulled(culled);
            if (!culled) {
                // On-screen AI: pick a pose-update stride from distance-based LOD tiers (nearer = higher fps).
                // 屏内 AI：按距离分级选姿态更新 stride（越近帧率越高）。
                swimmer.setMotionThrottleStride(this.motionStrideForDistance(Math.abs(node.position.x - playerX)));
            }
        }
    }

    // Map an AI swimmer's swim-axis distance to the player to a pose-update stride using the configured
    // distance tiers (nearest tier first). Beyond every tier -> farTierStride.
    // 用配置的距离分级（从近到远）把 AI 沿游泳轴到玩家的距离映射到姿态更新 stride。超出全部分级 -> farTierStride。
    private motionStrideForDistance(distanceX: number): number {
        for (const tier of PERFORMANCE_CONFIG.motion.aiPoseDistanceTiers) {
            if (distanceX <= tier.maxDistanceX) {
                return tier.stride;
            }
        }
        return PERFORMANCE_CONFIG.motion.farTierStride;
    }

    private toggleSplashCulling() {
        this._splashCullingEnabled = !this._splashCullingEnabled;
        if (!this._splashCullingEnabled) {
            for (const swimmer of this._aiSwimmers) {
                swimmer?.setSplashCulled(false);
            }
        }
        this.debug(`splash culling=${this._splashCullingEnabled ? 'ON' : 'OFF'}`);
    }

    private toggleSplashParticles() {
        this._splashParticlesEnabled = !this._splashParticlesEnabled;
        this.applySplashParticlesEnabled();
        this.debug(`splash particles=${this._splashParticlesEnabled ? 'ON' : 'OFF'}`);
    }

    private applySplashParticlesEnabled() {
        this._playerSwimmer?.setSplashParticlesEnabled(this._splashParticlesEnabled);
        for (const swimmer of this._aiSwimmers) {
            swimmer?.setSplashParticlesEnabled(this._splashParticlesEnabled);
        }
    }

    startGame() {
        this._inputRouter?.resetStrokeInput();
        this._gameFlow?.startGame();
        this.updateRaceCameraButtonLabel();
    }

    restartGame() {
        this._gameFlow?.restartGame();
        this.updateRaceCameraButtonLabel();
    }

    private returnToLogin() {
        director.getScheduler().setTimeScale(1);
        setTimeScale(1);
        director.loadScene('Login');
    }

    private buildScene(done: (error?: unknown) => void) {
        const scene = this.createRuntimeSceneBuilder().build();
        this._worldRoot = scene.worldRoot;
        this._cameraNode = scene.cameraNode;
        this._underwaterCameraTint = this.buildUnderwaterCameraTint(this._cameraNode, scene.width, scene.height);
        this._skyboxApplier = scene.skyboxApplier;
        this._finishRankMarkers.bind(this._worldRoot);
        this.buildPool3D(this._worldRoot, (pool) => {
            if (!this.node?.isValid || !this._worldRoot?.isValid) {
                return;
            }
            try {
                this.buildPlayerSwimmer3D(this._worldRoot);
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
                    this.scheduleDeferredSceneExtras(pool);
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
            updateScoreboardFeed: (dt, snapshot) => this._scoreboardFeed?.update(dt, snapshot),
            exitModelDebug: (showStart) => this.exitModelDebug(showStart),
            handleModelDebugStroke: (type) => this._modelDebugFlow?.handleStroke(type) ?? false,
            handleModelDebugStrokeHeld: (type, held) => this._modelDebugFlow?.handleStrokeHeld(type, held) ?? false,
            handleModelDebugKickStroke: (type) => this._modelDebugFlow?.handleKickStroke(type) ?? false,
            setState: (state) => {
                this._state = state;
                this.syncConditionPhase(state);
                if (state !== GameState.AWARDS) {
                    this._awardsPresentation.hide();
                }
                if (state === GameState.PRECOUNTDOWN) {
                    this.refreshPreRaceIntroRoster();
                }
            },
            getState: () => this._state,
            clearFinishRanks: () => this._finishRankMarkers.clear(),
            showFinishRank: (result) => this._finishRankMarkers.show(result),
            showAwards: (leaderboard) => {
                const center = this._awardsPresentation.show(leaderboard, this._poolNode);
                this._raceCameraDirector.startAwardsPresentation(center);
            },
            applyPlayerDive: (result) => {
                this._playerCondition.reset();
                this._playerCondition.setPhase(RacePhase.START);
                this._playerCondition.applyDiveResult(result);
                this._uiFlow?.updateHeartRateBar(
                    this._playerCondition.heartRate,
                    this._playerCondition.heartRateZone,
                );
                this._uiFlow?.updateEnergyBar(
                    this._playerCondition.energy,
                    this._playerCondition.energyDepleted,
                );
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
                // Sprint activity belongs to the race phase, not the current
                // effort tier. STEADY/PUSH/GAMBLE only tunes intensity.
                this._raceContext.sprintActive = this._playerCondition.phase === RacePhase.SPRINT;
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
            actionLabel: this._modelDebugActionLabel,
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
            onKickStroke: (type) => this.handlePlayerKickStroke(type),
            onDiveChargeStart: () => this._gameFlow?.handleDiveChargeStart(),
            onDiveRelease: (holdSeconds) => this._gameFlow?.handleDiveRelease(holdSeconds),
            onPrimaryAction: () => this._gameFlow?.handlePrimaryAction(),
            onToggleDebug: () => this.toggleDebug(),
            onCycleRaceCamera: () => this.cycleRaceCamera(),
            onToggleCameraFollowAi: () => this.toggleCameraFollowAi(),
            onToggleSplashCulling: () => this.toggleSplashCulling(),
            onToggleSplashParticles: () => this.toggleSplashParticles(),
            onCycleBulletTime: () => this.cycleBulletTime(),
            onModelDebugSpeedDown: () => this.slowModelDebugMotion(),
            onModelDebugSpeedUp: () => this.speedUpModelDebugMotion(),
            onDebugCameraMouseDown: (event) => this.onDebugCameraMouseDown(event),
            onDebugCameraMouseMove: (event) => this.onDebugCameraMouseMove(event),
            onDebugCameraMouseUp: () => this.onDebugCameraMouseUp(),
            onDebugCameraWheel: (event) => this.onDebugCameraWheel(event),
            onCameraOrbit: (deltaX, deltaY) => this.onAwardsCameraOrbit(deltaX, deltaY),
            onCameraZoom: (scroll) => this.onAwardsCameraZoom(scroll),
        });
    }

    private buildPool3D(root: Node, done: (pool: Node | null) => void) {
        const venue = new VenueManager({ debug: (message) => this.debug(message) });
        venue.buildPool(root, DEFAULT_POOL_DEFINITION, ({ pool }) => {
            if (!pool?.isValid) {
                this._poolNode = null;
                done(null);
                return;
            }
            this.scheduleOnce(() => {
                if (!pool.isValid) {
                    this._poolNode = null;
                    done(null);
                    return;
                }
                const calibrated = COURSE_LAYOUT.calibrateFromPoolScene(pool, DEFAULT_POOL_DEFINITION, (message) => this.debug(message));
                if (calibrated) {
                    this._raceCameraDirector.resetToBroadcast();
                }
                this._poolNode = pool;
                const ceilingCount = this._topViewCeiling.bind(pool);
                this.debug(`top-view ceiling nodes=${ceilingCount}`);
                this.setupWaterRefraction(pool);
                done(pool);
            }, 0);
        });
    }

    private setupWaterRefraction(pool: Node) {
        if (!this._worldRoot?.isValid || !this._cameraNode?.isValid || !pool?.isValid) {
            return;
        }
        this._waterRefraction?.dispose();
        this._waterRefraction = new WaterRefractionController((message) => this.debug(message));
        const ok = this._waterRefraction.setup(
            this._cameraNode,
            pool,
            () => this.collectSwimmerNodes(),
        );
        if (!ok) {
            this._waterRefraction = null;
        }
    }

    // Current swimmer render roots (body + sibling splash effect nodes) for the
    // refraction controller to re-tag onto the swimmer layer. Keeping the body,
    // foam planes and spray particles in the SAME overlay-camera pass lets the
    // transparent splashes render after the opaque character instead of being
    // covered by a later camera pass.
    private collectSwimmerNodes(): Node[] {
        const nodes: Node[] = [];
        if (this._playerSwimmer?.node?.isValid) {
            nodes.push(this._playerSwimmer.node);
            if (this._playerSwimmer.splashNode?.isValid) {
                nodes.push(this._playerSwimmer.splashNode);
            }
        }
        for (const swimmer of this._aiSwimmers) {
            if (swimmer?.node?.isValid) {
                nodes.push(swimmer.node);
                if (swimmer.splashNode?.isValid) {
                    nodes.push(swimmer.splashNode);
                }
            }
        }
        return nodes;
    }

    private buildSpectatorCrowd(root: Node, pool: Node | null) {
        if (!pool?.isValid) {
            this.debug('spectator crowd skipped: pool unavailable');
            return;
        }
        try {
            new SpectatorCrowdBuilder().build(root, pool, (message) => this.debug(message));
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            this.debug(`spectator crowd skipped: ${message}`);
            console.warn('[SpeedSwimming] spectator crowd skipped', error);
        }
    }

    private setupScoreboardFeed(pool: Node | null) {
        if (!PERFORMANCE_CONFIG.scoreboardFeed.enabled) {
            return;
        }
        if (!pool?.isValid || !this._worldRoot?.isValid) {
            return;
        }
        const mainCamera = this._cameraNode?.getComponent(Camera);
        if (!mainCamera) {
            return;
        }
        this._scoreboardFeed?.dispose();
        this._scoreboardFeed = new ScoreboardFeedCamera({
            worldRoot: this._worldRoot,
            mainCamera,
            pool,
            courseLayout: COURSE_LAYOUT,
            playerLaneZ: PLAYER_LANE_Z,
            debug: (message) => this.debug(message),
        });
        this.updateScoreboardViewButtonLabel();
    }

    private createCompetitorManager(): CompetitorManager {
        return new CompetitorManager({
            laneLayout: LANE_LAYOUT,
            courseLayout: COURSE_LAYOUT,
            playerLaneIndex: PLAYER_LANE_INDEX,
            primaryAiLaneIndex: PRIMARY_AI_LANE_INDEX,
            debug: (message) => this.debug(message),
        });
    }

    private buildPlayerSwimmer3D(root: Node) {
        const competitors = this.createCompetitorManager().buildPlayer(root);
        this._swimmersRoot = competitors.group;
        this._playerSwimmer = competitors.playerSwimmer;
        this._aiController = null;
        this._aiControllers = [];
        this._aiSwimmers = [];
        this._aiConditions = [];
        this.applySplashParticlesEnabled();
        this.refreshAiDifficultyPanel();
    }

    private buildDeferredAiSwimmers() {
        if (this._modelDebugFlow?.active) {
            this._aiController = null;
            this.debug('deferred AI swimmers skipped for model debug');
            return;
        }
        if (!RACE_OPPONENTS_ENABLED) {
            this._aiController = null;
            this.debug('race opponents disabled');
            return;
        }
        if (!this._swimmersRoot?.isValid) {
            return;
        }

        const competitors = this.createCompetitorManager().buildAi(
            this._swimmersRoot,
            this._aiDebugMode
                ? { soloLane: PRIMARY_AI_LANE_INDEX, difficultyOverride: this._aiDebugDifficulty }
                : undefined,
        );
        this._aiController = competitors.primaryAiController;
        this._aiControllers.splice(0, this._aiControllers.length, ...competitors.aiControllers);
        this._aiSwimmers.splice(0, this._aiSwimmers.length, ...competitors.aiSwimmers);
        this._aiConditions.splice(0, this._aiConditions.length, ...this._aiSwimmers.map(() => new AiConditionModel()));
        for (const swimmer of this._aiSwimmers) {
            swimmer.reset();
        }
        this._gameFlow?.refreshPreRaceShowcaseRoster();
        // AI swimmers load one frame after startGame(), so the pre-race roster
        // panel was first populated with only the player. Repopulate it now that
        // the full lineup exists.
        this.refreshPreRaceIntroRoster();
        this.applySplashParticlesEnabled();
        if (this._raceManager) {
            this._raceManager.aiSwimmer = this._aiController?.swimmer ?? null;
            this._raceManager.aiSwimmers = this._aiSwimmers;
        }
        this.refreshAiDifficultyPanel();
        this.debug(`deferred AI swimmers loaded count=${this._aiSwimmers.length}`);
    }

    // Rebuild the AI difficulty panel rows from the current roster. Lane index is
    // reconstructed from the AI array order (AI lanes are pushed in ascending lane
    // order, skipping the player lane).
    private refreshAiDifficultyPanel() {
        const entries = this._aiControllers.map((controller, i) => ({
            lane: i < PLAYER_LANE_INDEX ? i : i + 1,
            name: this._aiSwimmers[i]?.swimmerName ?? 'AI',
            difficulty: controller.difficulty,
        }));
        this._aiDifficultyPanel.populate(entries);
    }

    // Rebuild the pre-race stage 1 roster info panel (lane number + avatar + name)
    // from the current roster, ordered by lane (ascending Z). Reuses the results
    // panel avatar/row-back sprite frames.
    private refreshPreRaceIntroRoster() {
        const avatarFrames = this._uiController?.resultAvatarFrames ?? [];
        const normalRowFrame = this._uiController?.resultRowNormalFrame ?? null;
        const playerRowFrame = this._uiController?.resultRowPlayerFrame ?? null;
        const swimmers = [this._playerSwimmer, ...this._aiSwimmers]
            .filter((swimmer): swimmer is Swimmer => Boolean(swimmer?.node?.active))
            .sort((left, right) => left.node.position.z - right.node.position.z);
        const entries: PreRaceIntroEntry[] = swimmers.map((swimmer, index) => ({
            lane: index + 1,
            name: swimmer === this._playerSwimmer ? '你' : swimmer.swimmerName,
            isPlayer: swimmer === this._playerSwimmer,
            avatar: avatarFrames[index] ?? null,
            rowBack: swimmer === this._playerSwimmer ? playerRowFrame : normalRowFrame,
        }));
        this._preRaceIntroPanel.populate(entries);
    }

    private scheduleDeferredSceneExtras(pool: Node | null) {
        this.scheduleOnce(() => {
            if (!this.node?.isValid) {
                return;
            }
            this.buildDeferredAiSwimmers();
            this.scheduleOnce(() => {
                if (this.node?.isValid && this._worldRoot?.isValid) {
                    this.buildSpectatorCrowd(this._worldRoot, pool?.isValid ? pool : this._poolNode);
                    this.setupScoreboardFeed(pool?.isValid ? pool : this._poolNode);
                }
            }, 0);
        }, 0);
    }

    private buildUi(root: Node, w: number, h: number, done: (error?: unknown) => void) {
        // Cache the 2D UI camera so world-anchored HUD elements (e.g. the sweet-zone
        // dials) can map a swimmer's world position back into HUD-local space.
        this._uiCamera = root.getChildByName('Camera')?.getComponent(Camera) ?? null;
        const uiRoot = makeUiNode('RuntimeUIRoot', root);
        const input = uiRoot.addComponent(InputManager);
        input.strokeTarget = this.node;
        input.pointerInputEnabled = false;
        this._inputManager = input;

        new SpeedStarsUiPrefabBuilder({
            onStroke: (type) => this._inputRouter?.handleScreenStroke(type),
            onStrokeEnd: (type) => this._inputRouter?.handleScreenStrokeEnd(type),
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
            // Debug sweet-zone dials: bottom-center of the HUD, one per hand.
            const visibleSize = view.getVisibleSize();
            const playerDialY = -visibleSize.height / 2 + 90;
            const aiDialY = -visibleSize.height / 2 + 260;
            const dialSpread = 78;
            this._sweetZoneBarLeft.build(this._raceHud, -dialSpread, playerDialY, '左', true);
            this._sweetZoneBarRight.build(this._raceHud, dialSpread, playerDialY, '右', false);
            // AI opponent dials stacked just above the player dials (still lower
            // area) + camera-follow button (bottom-right), shown only in AI-debug.
            this._aiSweetZoneBarLeft.build(this._raceHud, -dialSpread, aiDialY, 'AI左', true);
            this._aiSweetZoneBarRight.build(this._raceHud, dialSpread, aiDialY, 'AI右', false);
            this.buildOverheadReadout();
            this.buildPlayerOverheadMarker();
            this._preRaceIntroPanel.build(this._raceHud, visibleSize.width, visibleSize.height);
            this.buildRaceCameraButton(this._raceHud, visibleSize.width, visibleSize.height);
            this.buildScoreboardViewButton(this._raceHud, visibleSize.width, visibleSize.height);
            this.buildAiDebugCameraButton(this._raceHud, visibleSize.width, visibleSize.height);

            const modelDebugHud = new ModelDebugHudBuilder({
                onExit: () => this.exitModelDebug(true),
                onSlow: () => this.slowModelDebugMotion(),
                onFast: () => this.speedUpModelDebugMotion(),
                onSwitchModel: () => this.switchModelDebugVariant(),
                onSwitchAction: () => this.switchModelDebugAction(),
                onSwitchTexture: () => this.switchModelDebugTexture(),
                onSwitchSkybox: () => this.switchModelDebugSkybox(),
            }).build(uiRoot, w, h);
            this._modelDebugHud = modelDebugHud.root;
            this._modelDebugSpeedLabel = modelDebugHud.speedLabel;
            this._modelDebugRatingLabel = modelDebugHud.ratingLabel;
            this._modelDebugSwimSpeedLabel = modelDebugHud.swimSpeedLabel;
            this._modelDebugModelLabel = modelDebugHud.modelLabel;
            this._modelDebugActionLabel = modelDebugHud.actionLabel;
            this._modelDebugSkyboxLabel = modelDebugHud.skyboxLabel;
            this._modelDebugHud.active = false;

            const debugPanel = new DebugPanelBuilder().build(uiRoot, w, h);
            this._debugLog.bind(debugPanel.root, debugPanel.logLabel);
            this._aiDifficultyPanel.build(uiRoot, w, h);
            this.refreshAiDifficultyPanel();

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

    private handlePlayerKickStroke(type: StrokeType) {
        this._gameFlow?.handlePlayerKickStroke(type);
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
        this._uiFlow?.updateHeartRateBar(this._playerCondition.heartRate, this._playerCondition.heartRateZone);
        this._uiFlow?.updateEnergyBar(this._playerCondition.energy, this._playerCondition.energyDepleted);
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
            case GameState.AWARDS:
                return RacePhase.RESULT;
            default:
                return null;
        }
    }

    private consumePlayerRhythmResults() {
        if (this._state !== GameState.RACING) {
            return;
        }
        const showFeedback = (this._playerSwimmer?.distance ?? 0) < getRaceDistance();
        for (const result of this._playerSwimmer?.consumeRhythmResults() ?? []) {
            if (showFeedback) {
                this._uiFlow?.showRating(result.rating, result.combo);
            }
        }
    }

    private cycleRaceCamera() {
        if (this._modelDebugFlow?.active) {
            return;
        }
        const modeName = this._gameFlow?.cycleRaceCamera();
        if (modeName) {
            this.updateRaceCameraButtonLabel(modeName);
        }
        this.debug(`race camera=${modeName}`);
    }

    private buildRaceCameraButton(raceHud: Node, width: number, height: number) {
        const button = makeButton(
            'RaceCameraButton',
            raceHud,
            210,
            54,
            new Color(24, 82, 142, 238),
            '',
        );
        button.setPosition(width / 2 - 122, height / 2 - 68, 0);
        button.setSiblingIndex(raceHud.children.length - 1);
        const labelNode = makeLabel('Label', button, '', 17, new Color(245, 252, 255, 255));
        labelNode.getComponent(UITransform).setContentSize(200, 50);
        this._raceCameraButton = button;
        this._raceCameraButtonLabel = labelNode.getComponent(Label);
        this.updateRaceCameraButtonLabel();
        button.active = false;
        button.on(Node.EventType.TOUCH_END, () => this.cycleRaceCamera());
    }

    private updateRaceCameraButtonLabel(modeName = this._raceCameraDirector.currentModeName) {
        if (this._raceCameraButtonLabel?.isValid) {
            this._raceCameraButtonLabel.string = `相机：${modeName}`;
        }
    }

    private buildScoreboardViewButton(raceHud: Node, width: number, height: number) {
        const button = makeButton(
            'ScoreboardViewButton',
            raceHud,
            210,
            54,
            new Color(24, 82, 142, 238),
            '',
        );
        button.setPosition(width / 2 - 122, height / 2 - 130, 0);
        button.setSiblingIndex(raceHud.children.length - 1);
        const labelNode = makeLabel('Label', button, '', 17, new Color(245, 252, 255, 255));
        labelNode.getComponent(UITransform).setContentSize(200, 50);
        this._scoreboardViewButton = button;
        this._scoreboardViewButtonLabel = labelNode.getComponent(Label);
        this.updateScoreboardViewButtonLabel();
        button.active = false;
        button.on(Node.EventType.TOUCH_END, () => this.cycleScoreboardView());
    }

    private cycleScoreboardView() {
        const name = this._scoreboardFeed?.cyclePreset();
        if (name) {
            this.updateScoreboardViewButtonLabel(name);
            this.debug(`scoreboard feed view=${name}`);
        }
    }

    private updateScoreboardViewButtonLabel(presetName = this._scoreboardFeed?.currentPresetName ?? '侧视') {
        if (this._scoreboardViewButtonLabel?.isValid) {
            this._scoreboardViewButtonLabel.string = `大屏：${presetName}`;
        }
    }

    // Race HUD button (AI-debug mode only): toggle whether the race camera frames
    // the player or the AI opponent. Built hidden; shown by applyAiDebugHud().
    private buildAiDebugCameraButton(raceHud: Node, width: number, height: number) {
        const button = makeButton(
            'AiDebugCameraButton',
            raceHud,
            190,
            56,
            new Color(40, 96, 168, 235),
            '跟随AI',
        );
        button.setPosition(width / 2 - 115, -height / 2 + 140, 0);
        button.setSiblingIndex(raceHud.children.length - 1);
        button.active = false;
        this._aiDebugCameraButton = button;
        this._aiDebugCameraButtonLabel = button.getChildByName('Label')?.getComponent(Label) ?? null;
        button.on(Node.EventType.TOUCH_END, () => this.toggleCameraFollowAi());
    }

    // Show/hide the AI-debug HUD extras based on the active mode.
    private applyAiDebugHud() {
        if (this._aiDebugCameraButton?.isValid) {
            this._aiDebugCameraButton.active = this._aiDebugMode;
        }
        if (!this._aiDebugMode) {
            this._cameraFollowsAi = false;
            this._gameFlow?.setCameraFollowAi(false);
            this._aiSweetZoneBarLeft.setVisible(false);
            this._aiSweetZoneBarRight.setVisible(false);
        }
    }

    // Drive the opponent's sweet-zone dials from the single AI swimmer (AI-debug).
    private updateAiSweetZoneBar(raceActive: boolean) {
        const aiSwimmer = this._aiDebugMode ? this._aiSwimmers[0] : null;
        const show = raceActive && !!aiSwimmer && aiSwimmer.distance < getRaceDistance();
        this._aiSweetZoneBarLeft.setVisible(show);
        this._aiSweetZoneBarRight.setVisible(show);
        if (aiSwimmer) {
            const facing = this.dialFacingSign(aiSwimmer);
            const speed = aiSwimmer.currentSpeed;
            this._aiSweetZoneBarLeft.update(show ? aiSwimmer.strokeTimingGuideForSide(StrokeType.LEFT) : null, speed, facing);
            this._aiSweetZoneBarRight.update(show ? aiSwimmer.strokeTimingGuideForSide(StrokeType.RIGHT) : null, speed, facing);
            if (show) {
                this.positionSweetZoneDialsAbove(aiSwimmer, this._aiSweetZoneBarLeft, this._aiSweetZoneBarRight);
            }
        }
    }

    // Project a point above the swimmer's head into HUD-local space and pin the
    // swimmer's two hand dials there so they hover overhead and follow the
    // character as the camera moves. Left/right dials keep their side-by-side
    // screen spread. Falls back silently if the camera/HUD aren't ready.
    private positionSweetZoneDialsAbove(
        swimmer: Swimmer | null,
        leftBar: SweetZoneBar,
        rightBar: SweetZoneBar,
        readout: Node | null = null,
        playerMarker: Node | null = null,
    ) {
        const node = swimmer?.node;
        const worldCamera = this._cameraNode?.getComponent(Camera);
        const hudTransform = this._raceHud?.getComponent(UITransform);
        if (!node?.isValid || !worldCamera || !this._uiCamera || !hudTransform) {
            return;
        }
        // Anchor to the swimmer's upper body / head (same point the camera tracks)
        // instead of the node origin, which sits mid/rear of the horizontal body.
        swimmer.getCameraUpperBodyWorldPosition(this._tmpDialAnchorWorld);
        this._tmpDialAnchorWorld.y += this._dialHeadWorldOffsetY;
        // Perspective scale from the camera's distance to the swimmer.
        const camDistance = Vec3.distance(this._cameraNode.worldPosition, this._tmpDialAnchorWorld);
        const scale = Math.max(
            this._dialMinScale,
            Math.min(this._dialMaxScale, this._dialRefDistance / Math.max(camDistance, 0.001)),
        );
        // World camera -> screen pixels -> UI camera world -> HUD-local. Going
        // through the actual UI camera (instead of Camera.convertToUINode's
        // design-scale math) keeps the anchor correct when the runtime viewport
        // differs from the design resolution.
        worldCamera.worldToScreen(this._tmpDialAnchorWorld, this._tmpDialScreen);
        this._uiCamera.screenToWorld(this._tmpDialScreen, this._tmpDialAnchorWorld);
        hudTransform.convertToNodeSpaceAR(this._tmpDialAnchorWorld, this._tmpDialAnchorUi);
        const cx = this._tmpDialAnchorUi.x;
        const cy = this._tmpDialAnchorUi.y + this._dialScreenOffsetY * scale;
        const spread = this._dialScreenSpread * scale;
        leftBar.setAnchorPosition(cx - spread, cy);
        rightBar.setAnchorPosition(cx + spread, cy);
        leftBar.setScale(scale);
        rightBar.setScale(scale);
        // Speed and player marker stay at fixed screen size so the main character
        // remains identifiable in the widest camera shots.
        if (readout?.isValid) {
            const speedOffsetY = this._raceCameraDirector.topViewActive
                ? this._playerSpeedTopViewOffsetY
                : this._playerSpeedScreenOffsetY;
            readout.setPosition(cx, this._tmpDialAnchorUi.y + speedOffsetY, 0);
            readout.setScale(1, 1, 1);
        }
        if (playerMarker?.isValid) {
            // In top view the swimmer is visually very thin, so leave a larger
            // gap to keep the triangle tip from covering the character model.
            const markerOffsetY = this._state === GameState.PRECOUNTDOWN
                ? this._playerPreRaceMarkerScreenOffsetY
                : this._raceCameraDirector.topViewActive ? 14 : -8;
            playerMarker.setPosition(cx, this._tmpDialAnchorUi.y + markerOffsetY, 0);
            playerMarker.setScale(1, 1, 1);
        }
    }

    // Build a speed-only readout above the player. Stroke rating and combo remain
    // in their normal HUD positions and are deliberately not reparented here.
    private buildOverheadReadout() {
        if (!this._raceHud?.isValid) {
            return;
        }
        const readout = makeUiNode('SweetZoneReadout', this._raceHud);
        readout.setPosition(0, 0, 0);
        readout.active = false;
        // Render above the dials so the speed text is never occluded.
        readout.setSiblingIndex(this._raceHud.children.length - 1);
        const speedNode = makeUiNode('SweetZoneReadoutSpeed', readout);
        speedNode.setPosition(0, 0, 0);
        speedNode.getComponent(UITransform).setContentSize(200, 32);
        const speedLabel = speedNode.addComponent(Label);
        speedLabel.string = '0.00 m/s';
        speedLabel.fontSize = 24;
        speedLabel.lineHeight = 30;
        speedLabel.color = new Color(255, 255, 255, 255);
        speedLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        speedLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this.addReadoutOutline(speedLabel);
        this._overheadReadout = readout;
        this._overheadSpeedLabel = speedLabel;
    }

    private buildPlayerOverheadMarker() {
        if (!this._raceHud?.isValid) {
            return;
        }
        const marker = makeUiNode('PlayerOverheadMarker', this._raceHud);
        marker.getComponent(UITransform).setContentSize(48, 42);
        marker.active = false;
        marker.setSiblingIndex(this._raceHud.children.length - 1);

        const glowNode = makeUiNode('Glow', marker);
        const glow = glowNode.addComponent(Graphics);
        glow.fillColor = new Color(255, 24, 24, 100);
        glow.moveTo(-20, 38);
        glow.lineTo(20, 38);
        glow.lineTo(0, 2);
        glow.close();
        glow.fill();

        const coreNode = makeUiNode('Core', marker);
        const core = coreNode.addComponent(Graphics);
        core.fillColor = new Color(255, 36, 36, 255);
        core.strokeColor = new Color(255, 225, 225, 255);
        core.lineWidth = 2;
        core.moveTo(-13, 33);
        core.lineTo(13, 33);
        core.lineTo(0, 8);
        core.close();
        core.fill();
        core.stroke();

        this._playerOverheadMarker = marker;
    }

    // Dark outline so overhead readout text stays legible over the bright,
    // varied pool background (plain white text washes out).
    private addReadoutOutline(label: Label) {
        label.enableOutline = true;
        label.outlineColor = new Color(0, 0, 0, 205);
        label.outlineWidth = 3;
    }

    // On-screen swim direction of a swimmer for its sweet-zone dial: the swimmer's
    // world facing (raceDirection along +X) projected onto the camera's screen-X
    // axis. This makes each dial's pointer spin the same way the character's hand
    // visually spins under the CURRENT camera — correct per-swimmer and for any
    // camera side (including the follow-AI view), instead of a raw world sign that
    // fights the camera flipping sides on the return lap.
    private dialFacingSign(swimmer: Swimmer): number {
        const facing = swimmer.raceDirection >= 0 ? 1 : -1;
        if (!this._cameraNode?.isValid) {
            return facing;
        }
        const right = Vec3.transformQuat(this._tmpDialRight, Vec3.RIGHT, this._cameraNode.worldRotation);
        return right.x * facing >= 0 ? 1 : -1;
    }

    // Toggle the race camera between the player and the AI opponent (AI-debug).
    private toggleCameraFollowAi() {
        if (!this._aiDebugMode) {
            return;
        }
        this._cameraFollowsAi = !this._cameraFollowsAi;
        this._gameFlow?.setCameraFollowAi(this._cameraFollowsAi);
        if (this._aiDebugCameraButtonLabel) {
            this._aiDebugCameraButtonLabel.string = this._cameraFollowsAi ? '跟随玩家' : '跟随AI';
        }
        this.debug(`camera follow=${this._cameraFollowsAi ? 'AI' : 'player'}`);
    }

    private enterModelDebug() {
        this._modelDebugFlow?.enter();
    }

    private exitModelDebug(showStart: boolean) {
        this._modelDebugFlow?.exit(showStart);
    }

    private onDebugCameraMouseDown(event: EventMouse) {
        if (this._modelDebugFlow?.active) {
            this._modelDebugFlow.onMouseDown(event);
            return;
        }
        if (this._raceCameraDirector.isAwardsFreeLookActive()) {
            const button = event.getButton();
            this._awardsCameraDragging = button === EventMouse.BUTTON_LEFT
                || button === EventMouse.BUTTON_RIGHT
                || button === EventMouse.BUTTON_MIDDLE;
        }
    }

    private onDebugCameraMouseMove(event: EventMouse) {
        if (this._modelDebugFlow?.active) {
            this._modelDebugFlow.onMouseMove(event);
            return;
        }
        if (this._awardsCameraDragging && this._raceCameraDirector.isAwardsFreeLookActive()) {
            this._raceCameraDirector.orbitAwardsCamera(event.getDeltaX(), event.getDeltaY());
        }
    }

    private onDebugCameraMouseUp() {
        if (this._modelDebugFlow?.active) {
            this._modelDebugFlow.onMouseUp();
            return;
        }
        this._awardsCameraDragging = false;
    }

    private onDebugCameraWheel(event: EventMouse) {
        if (this._modelDebugFlow?.active) {
            this._modelDebugFlow.onMouseWheel(event);
            return;
        }
        if (this._raceCameraDirector.isAwardsFreeLookActive()) {
            this._raceCameraDirector.zoomAwardsCamera(event.getScrollY());
        }
    }

    // Touch orbit / pinch-zoom for the awards ceremony free-look camera (mobile).
    private onAwardsCameraOrbit(deltaX: number, deltaY: number) {
        if (this._modelDebugFlow?.active) {
            return;
        }
        if (this._raceCameraDirector.isAwardsFreeLookActive()) {
            this._raceCameraDirector.orbitAwardsCamera(deltaX, deltaY);
        }
    }

    private onAwardsCameraZoom(scroll: number) {
        if (this._modelDebugFlow?.active) {
            return;
        }
        if (this._raceCameraDirector.isAwardsFreeLookActive()) {
            this._raceCameraDirector.zoomAwardsCamera(scroll);
        }
    }

    private slowModelDebugMotion() {
        this._modelDebugFlow?.slowMotion();
    }

    private speedUpModelDebugMotion() {
        this._modelDebugFlow?.speedUpMotion();
    }

    private cycleBulletTime() {
        this._bulletTimeIndex = (this._bulletTimeIndex + 1) % BULLET_TIME_SCALES.length;
        const scale = BULLET_TIME_SCALES[this._bulletTimeIndex];
        setTimeScale(scale);
        this.debug(`bullet-time x${scale.toFixed(2)}`);
    }

    private switchModelDebugVariant() {
        this._modelDebugFlow?.switchModelVariant();
    }

    private switchModelDebugAction() {
        this._modelDebugFlow?.switchActionPreview();
    }

    private switchModelDebugTexture() {
        this._modelDebugFlow?.switchColorVariant();
    }

    private switchModelDebugSkybox() {
        this._modelDebugFlow?.switchSkyboxVariant();
    }

    private toggleDebug() {
        const visible = this._debugLog.toggle();
        this._aiDifficultyPanel.setVisible(visible);
    }

    private drawSpeedBar(_ratio: number) {
        this.drawStrokeTimingGuide(null, false);
    }

    private setUnderwaterOverlayVisible(visible: boolean) {
        if (this._underwaterCameraTint) {
            this._underwaterCameraTint.active = visible;
            if (visible) {
                this.resizeUnderwaterCameraTint();
            }
        }
    }

    private buildUnderwaterCameraTint(cameraNode: Node, width: number, height: number): Node {
        const tint = new Node('UnderwaterCameraTint3D');
        tint.setParent(cameraNode);
        tint.layer = Layers.Enum.DEFAULT;
        tint.setPosition(0, 0, -UNDERWATER_TINT_DISTANCE);
        tint.setScale(this.underwaterTintScale(width, height));
        tint.active = false;
        const renderer = tint.addComponent(MeshRenderer);
        renderer.mesh = utils.createMesh(primitives.box());
        renderer.setMaterial(makeUnderwaterTintMaterial(), 0);
        return tint;
    }

    private resizeUnderwaterCameraTint() {
        if (!this._underwaterCameraTint) {
            return;
        }
        const design = view.getDesignResolutionSize();
        const visible = view.getVisibleSize();
        const width = visible.width || design.width || 1280;
        const height = visible.height || design.height || 720;
        this._underwaterCameraTint.setScale(this.underwaterTintScale(width, height));
    }

    private underwaterTintScale(width: number, height: number): Vec3 {
        const camera = this._cameraNode?.getComponent(Camera);
        const fov = camera?.fov ?? 36;
        const aspect = height > 0 ? width / height : 16 / 9;
        const planeHeight = Math.tan(fov * Math.PI / 360) * UNDERWATER_TINT_DISTANCE * 2 * UNDERWATER_TINT_MARGIN;
        return new Vec3(planeHeight * aspect, planeHeight, UNDERWATER_TINT_DEPTH);
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
        // Drop the loading cover so the error panel below is actually visible.
        LoadingOverlay.hide();
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

function makeUnderwaterTintMaterial(): Material {
    const material = new Material();
    // Set the depth pipeline states at initialize time. Calling
    // overridePipelineStates() afterwards on a base Material (asset) warns
    // "Pipeline states ... cannot be modified at runtime, instantiate first".
    material.initialize({
        effectName: 'builtin-unlit',
        technique: 1,
        states: {
            depthStencilState: {
                depthTest: false,
                depthWrite: false,
            },
        },
    });
    material.name = 'UnderwaterCameraTint';
    material.setProperty('mainColor', new Color(10, 140, 215, 78));
    return material;
}
