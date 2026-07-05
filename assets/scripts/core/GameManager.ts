import {
    _decorator,
    Camera,
    Color,
    Component,
    director,
    EventMouse,
    game,
    geometry,
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
import { RacePhase, SprintTier } from '../condition/ConditionTypes';
import { ModelDebugFlowController } from '../app/ModelDebugFlowController';
import { RuntimeSceneBuilder } from '../app/RuntimeSceneBuilder';
import { StandardSkyboxApplier } from '../app/StandardSkyboxApplier';
import { CompetitorManager } from '../competitor/CompetitorManager';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { DebugPanelBuilder } from '../ui/DebugPanelBuilder';
import { ModelDebugHudBuilder } from '../ui/ModelDebugHudBuilder';
import { makeUiNode, makeRect, makeLabel, makeButton } from '../ui/RuntimeUiFactory';
import { SpeedStarsUiPrefabBuilder } from '../ui/SpeedStarsUiPrefabBuilder';
import { SweetZoneBar } from '../ui/SweetZoneBar';
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
import { PERFORMANCE_CONFIG } from './PerformanceConfig';
import { setTimeScale, scaledDelta } from './TimeScale';
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
    // Free-swim debug mode: single player, no AI, endless back-and-forth swim.
    private _freeSwimMode = false;    private _splashCullingEnabled: boolean = PERFORMANCE_CONFIG.splash.cullingEnabled;
    private _splashParticlesEnabled: boolean = PERFORMANCE_CONFIG.splash.particleEmittersEnabled;
    private _uiController: UIController = null;
    private _uiFlow: UIFlowController = null;
    private _inputManager: InputManager = null;

    private _raceHud: Node = null;
    private _modelDebugHud: Node = null;
    private _underwaterCameraTint: Node = null;
    private _worldRoot: Node = null;
    private _swimmersRoot: Node = null;
    private _poolNode: Node = null;
    private _cameraNode: Node = null;
    private readonly _splashCullAabb = new geometry.AABB();
    private readonly _tmpSplashCullCenter = new Vec3();
    private _modelDebugSpeedLabel: Label = null;
    private _modelDebugRatingLabel: Label = null;
    private _modelDebugSwimSpeedLabel: Label = null;
    private _modelDebugModelLabel: Label = null;
    private _modelDebugActionLabel: Label = null;
    private _modelDebugSkyboxLabel: Label = null;
    private _skyboxApplier: StandardSkyboxApplier = null;
    private _timingGuideFillNode: Node = null;
    private _timingGuideMarker: Node = null;
    private readonly _sweetZoneBar = new SweetZoneBar();
    private _freeSwimButtonLabel: Label = null;
    private _gameFlow: GameFlowController = null;
    private _modelDebugFlow: ModelDebugFlowController = null;
    private _inputRouter: InputRouter = null;
    private readonly _debugLog = new DebugLogController();
    // Debug bullet-time: cycles the global scheduler time scale so the whole
    // race (movement, limb motion, splashes, camera) can be observed in slow
    // motion while tuning feel. Input classification uses wall-clock, so key
    // presses stay responsive. Toggle with the B key.
    private _bulletTimeIndex = 0;
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
                        const launchMode = consumeMainGameLaunchMode();
                        if (launchMode === 'model-debug') {
                            this.enterModelDebug();
                        } else {
                            this._freeSwimMode = launchMode === 'free-swim';
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
        // Bullet-time: everything GameManager drives (camera, model debug, etc.)
        // runs on the scaled delta. Input classification stays on wall-clock.
        dt = scaledDelta(dt);
        this._inputRouter?.tick();
        this._uiFlow?.updateSpeed(this._playerSwimmer.currentSpeed);
        this._uiFlow?.updateSwimTelemetry(
            this._playerSwimmer.currentStability,
            this._playerSwimmer.currentAcceleration,
            this._playerSwimmer.currentSpeed,
        );
        this.consumePlayerRhythmResults();
        this.updatePlayerCondition(dt);
        const timingGuide = this._playerSwimmer.strokeTimingGuide;
        const raceActive = this._state === GameState.RACING;
        this.drawStrokeTimingGuide(timingGuide, raceActive);
        this._sweetZoneBar.setVisible(raceActive);
        this._sweetZoneBar.update(raceActive ? timingGuide : null);
        this.updateSplashCulling();
        if (this._modelDebugFlow?.active) {
            this.setUnderwaterOverlayVisible(false);
            this._modelDebugFlow.update(dt);
            this._modelDebugFlow.updateCamera();
            return;
        }
        this._gameFlow?.updateRaceCamera(dt);
        this.setUnderwaterOverlayVisible(this._raceCameraDirector.underwaterViewActive);
    }

    // Cull splash + freeze pose for AI swimmers that are outside the camera frustum. Testing against the
    // real camera frustum (instead of a 1D X-distance guess) correctly handles zoom and any camera mode
    // (broadcast / top / underwater / free). Off-screen swimmers skip all particle/foam and pose work.
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
        this._inputRouter?.resetAutoPadSequence();
        this.applyFreeSwimMode();
        this._gameFlow?.startGame();
    }

    restartGame() {
        this._gameFlow?.restartGame();
    }

    // Free-swim debug mode: single player, no AI, endless back-and-forth swim.
    // Toggled from the race HUD button; restarts the run into/out of the mode.
    private toggleFreeSwim() {
        this._freeSwimMode = !this._freeSwimMode;
        this.debug(`free-swim mode ${this._freeSwimMode ? 'ON' : 'OFF'}`);
        if (this._freeSwimButtonLabel) {
            this._freeSwimButtonLabel.string = this._freeSwimMode ? '退出自由游泳' : '自由游泳';
        }
        this.restartGame();
    }

    // Apply the current free-swim mode to AI visibility and endless flags. Called
    // on every game start so it survives restarts.
    private applyFreeSwimMode() {
        for (const swimmer of this._aiSwimmers) {
            if (swimmer?.node?.isValid) {
                swimmer.node.active = !this._freeSwimMode;
            }
        }
        if (this._freeSwimMode) {
            this._gameFlow?.stopAllAi();
        }
        if (this._raceManager) {
            this._raceManager.endlessMode = this._freeSwimMode;
        }
        this._playerSwimmer?.setEndless(this._freeSwimMode);
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
            exitModelDebug: (showStart) => this.exitModelDebug(showStart),
            handleModelDebugStroke: (type) => this._modelDebugFlow?.handleStroke(type) ?? false,
            handleModelDebugStrokeHeld: (type, held) => this._modelDebugFlow?.handleStrokeHeld(type, held) ?? false,
            handleModelDebugKickStroke: (type) => this._modelDebugFlow?.handleKickStroke(type) ?? false,
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
            onToggleFreeRaceCamera: () => this.toggleFreeRaceCamera(),
            onToggleSplashCulling: () => this.toggleSplashCulling(),
            onToggleSplashParticles: () => this.toggleSplashParticles(),
            onCycleBulletTime: () => this.cycleBulletTime(),
            onModelDebugSpeedDown: () => this.slowModelDebugMotion(),
            onModelDebugSpeedUp: () => this.speedUpModelDebugMotion(),
            onDebugCameraMouseDown: (event) => this.onDebugCameraMouseDown(event),
            onDebugCameraMouseMove: (event) => this.onDebugCameraMouseMove(event),
            onDebugCameraMouseUp: () => this.onDebugCameraMouseUp(),
            onDebugCameraWheel: (event) => this.onDebugCameraWheel(event),
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
                done(pool);
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
        if (this._freeSwimMode) {
            this._aiController = null;
            this.debug('free-swim mode: AI opponents skipped');
            return;
        }
        if (!this._swimmersRoot?.isValid) {
            return;
        }

        const competitors = this.createCompetitorManager().buildAi(this._swimmersRoot);
        this._aiController = competitors.primaryAiController;
        this._aiControllers.splice(0, this._aiControllers.length, ...competitors.aiControllers);
        this._aiSwimmers.splice(0, this._aiSwimmers.length, ...competitors.aiSwimmers);
        this._aiConditions.splice(0, this._aiConditions.length, ...this._aiSwimmers.map(() => new AiConditionModel()));
        for (const swimmer of this._aiSwimmers) {
            swimmer.reset();
        }
        this.applySplashParticlesEnabled();
        if (this._raceManager) {
            this._raceManager.aiSwimmer = this._aiController?.swimmer ?? null;
            this._raceManager.aiSwimmers = this._aiSwimmers;
        }
        this.debug(`deferred AI swimmers loaded count=${this._aiSwimmers.length}`);
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
                }
            }, 0);
        }, 0);
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
            // Debug sweet-zone bar: bottom-center of the HUD.
            const visibleSize = view.getVisibleSize();
            this._sweetZoneBar.build(this._raceHud, 0, -visibleSize.height / 2 + 70);
            this.buildFreeSwimButton(this._raceHud, visibleSize.width, visibleSize.height);

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

    private cycleBulletTime() {
        this._bulletTimeIndex = (this._bulletTimeIndex + 1) % BULLET_TIME_SCALES.length;
        const scale = BULLET_TIME_SCALES[this._bulletTimeIndex];
        setTimeScale(scale);
        this.debug(`bullet-time x${scale.toFixed(2)}`);
    }

    // Race HUD debug button: toggle single-player endless free-swim mode.
    private buildFreeSwimButton(raceHud: Node, width: number, height: number) {
        const button = makeButton(
            'FreeSwimButton',
            raceHud,
            170,
            56,
            new Color(20, 130, 90, 235),
            this._freeSwimMode ? '退出自由游泳' : '自由游泳',
        );
        // Bottom-right, above the sweet-zone bar (a known-visible band). Forced to
        // the front so nothing in the prefab HUD covers it.
        button.setPosition(width / 2 - 105, -height / 2 + 140, 0);
        button.setSiblingIndex(raceHud.children.length - 1);
        this._freeSwimButtonLabel = button.getChildByName('Label')?.getComponent(Label) ?? null;
        button.on(Node.EventType.TOUCH_END, () => this.toggleFreeSwim());
        this.debug(`free-swim button built at (${(width / 2 - 105).toFixed(0)}, ${(-height / 2 + 140).toFixed(0)})`);
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
        this._debugLog.toggle();
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
    material.initialize({ effectName: 'builtin-unlit', technique: 1 });
    material.name = 'UnderwaterCameraTint';
    material.setProperty('mainColor', new Color(10, 140, 215, 78));
    material.overridePipelineStates({
        depthStencilState: {
            depthTest: false,
            depthWrite: false,
        },
    });
    return material;
}
