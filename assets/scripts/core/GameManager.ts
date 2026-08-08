import {
    _decorator,
    Button,
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
import { MusicManager } from '../app/MusicManager';
import { PlayerConditionModel } from '../condition/PlayerConditionModel';
import { AiConditionModel } from '../condition/AiConditionModel';
import { RaceContext } from '../condition/RaceContext';
import { RacePhase } from '../condition/ConditionTypes';
import { ModelDebugFlowController } from '../app/ModelDebugFlowController';
import { RuntimeSceneBuilder } from '../app/RuntimeSceneBuilder';
import { StandardSkyboxApplier } from '../app/StandardSkyboxApplier';
import { CompetitorManager } from '../competitor/CompetitorManager';
import { AIRaceObserver } from '../competitor/AIRaceObserver';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { resolveSwimmerCollisions } from '../entity/SwimmerCollisionResolver';
import { DebugPanelBuilder } from '../ui/DebugPanelBuilder';
import { AiDifficultyPanel } from '../ui/AiDifficultyPanel';
import { ModelDebugHudBuilder } from '../ui/ModelDebugHudBuilder';
import { makeUiNode, makeRect, makeLabel, makeButton } from '../ui/RuntimeUiFactory';
import { LoadingOverlay } from '../ui/LoadingOverlay';
import { SpeedStarsUiPrefabBuilder } from '../ui/SpeedStarsUiPrefabBuilder';
import { SweetZoneBar } from '../ui/SweetZoneBar';
import { FinishRankOverlay } from '../ui/FinishRankOverlay';
import { SwimmerNameOverlay } from '../ui/SwimmerNameOverlay';
import { PreRaceIntroPanel, PreRaceIntroEntry } from '../ui/PreRaceIntroPanel';
import { CameraSpeedLineOverlay } from '../ui/CameraSpeedLineOverlay';
import { UIController } from '../ui/UIController';
import { UIFlowController } from '../ui/UIFlowController';
import { DebugLogController } from './DebugLogController';
import { consumeMainGameLaunchMode, consumeRoomMode, getAiDebugDifficulty, setReturnToRoom } from './GameLaunchOptions';
import { consumeNetRaceSession, NetRaceSessionData } from '../net/NetRaceSession';
import { NetRaceController } from '../net/NetRaceController';
import { buildNetLanePlan, NetLanePlan } from '../net/NetLanePlan';
import { RemoteSwimmerController } from '../entity/RemoteSwimmerController';
import { applyNetSwimmerLook } from '../net/NetSwimmerLook';
import { NetSnapshotEntry } from '../net/NetRaceSnapshot';
import { NET_SIM_STEP } from '../net/NetSimClock';
import { reseedSharedRandom } from './SharedRNG';
import { getPlayerCharacterSelection } from '../app/PlayerCharacterConfig';
import { getProgressionManager } from '../progression/ProgressionManager';
import type { PlayerBalanceOverrides } from '../progression/PlayerBalanceOverrides';
import { applyRaceModifiersToSwimmer, resolveLocalRaceModifiers, resolveModifiersFromDigest } from '../progression/RaceModifiers';
import { decodeModifierDigest } from '../net/NetRaceModifierCodec';
import { InputManager } from './InputManager';
import { InputRouter } from './InputRouter';
import { RaceFinishResult, RaceManager } from './RaceManager';
import { GameState, Rating, StrokeType } from './GameConstants';
import { DIVE_BALANCE, getRaceDifficultyConfig, getRaceDistance, SWIMMER_BALANCE } from './GameBalance';
import { LaneLockdownRaceController, LaneLockdownStatus } from './LaneLockdownRaceController';
import { loadSavedTuningAsync } from './TuningDebugControls';
import { PERFORMANCE_CONFIG } from './PerformanceConfig';
import { randomInt } from './SharedRNG';
import { setTimeScale, scaledDelta } from './TimeScale';
import { RaceCameraDirector } from '../camera/RaceCameraDirector';
import { DEFAULT_POOL_DEFINITION } from '../venue/VenueConfig';
import { LaneLayout } from '../venue/LaneLayout';
import { VenueManager } from '../venue/VenueManager';
import { WaterRefractionController } from '../venue/WaterRefractionController';
import { applyPoolEdgeToonOutline } from '../venue/PoolEdgeToonOutline';
import { ScoreboardFeedCamera } from '../camera/ScoreboardFeedCamera';
import { SpectatorCrowdBuilder } from '../venue/SpectatorCrowdBuilder';
import { applyStandHeightShade } from '../venue/StandHeightShade';
import { AwardsPresentation } from '../venue/AwardsPresentation';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { LaneLockdownVisuals } from '../venue/LaneLockdownVisuals';
import { TopViewCeilingController } from '../venue/TopViewCeilingController';
import type { StrokeTimingGuide } from '../swimmer/SwimmerMotor';
import { loadSampledActionsForRace } from '../character/SampledActionLoader';
import { logTextureFormatDiagnostics } from './TextureFormatDiagnostics';

const { ccclass } = _decorator;

const LANE_LAYOUT = new LaneLayout(DEFAULT_POOL_DEFINITION.laneCount, DEFAULT_POOL_DEFINITION.laneWidth);
const COURSE_LAYOUT = new RaceCourseLayout(DEFAULT_POOL_DEFINITION);
const POOL_WIDTH = LANE_LAYOUT.poolWidth;
const PLAYER_LANE_INDEX = 3;
const PRIMARY_AI_LANE_INDEX = 4;
const PLAYER_LANE_Z = LANE_LAYOUT.centerZ(PLAYER_LANE_INDEX);
const RACE_OPPONENTS_ENABLED = true;
// Host broadcasts an authoritative position snapshot every this many seconds (~6.7Hz).
const NET_SNAPSHOT_INTERVAL = 0.15;
// Redundancy: if a remote human's own position has advanced past this (metres) but its
// dive was never triggered (DiveRelease lost/failed), force it into the race so it can't
// stay stuck on the starting block while its position data keeps moving.
const NET_DIVE_STUCK_M = 1;
// A dive that hasn't reached racing this long after it started (ms) is treated as stuck
// (its tween never completed), so the redundancy forces it straight into racing. Longer
// than the ~1.5s dive tween so a normal in-progress dive isn't cut short.
const NET_DIVE_STUCK_TIMEOUT_MS = 2000;
// In-race frame-sync debug HUD (top-left: 帧/快照/名次 发收 + per-lane distances). OFF by
// default — it repaints a Label every tick which costs a little. Flip to true only when
// debugging sync issues; the HUD code itself (NetRaceController.attachHud/setDiag) is kept.
const NET_RACE_DEBUG_HUD = false;
const RACE_HUD_TEXT_REFRESH_SECONDS = 0.1;
const UNDERWATER_TINT_DISTANCE = 1.2;
const UNDERWATER_TINT_DEPTH = 0.002;
const UNDERWATER_TINT_MARGIN = 1.45;
// Underwater-effect tuning scene ('underwater-debug' launch mode): the player
// continuously flutter-kicks below the surface and laps back and forth so the
// submerged water look (blue + surface mirror) can be tuned without a full race.
const UNDERWATER_DEBUG_SPEED = 1.4;      // lap travel speed (m/s)
const UNDERWATER_DEBUG_DEPTH = 0.75;     // metres the body sits below swimY
const UNDERWATER_DEBUG_KICK_RATE = 9.0;  // leg flutter cadence (rad/s)
const UNDERWATER_DEBUG_BODY_RATE = 3.2;  // body undulation (rad/s)
// Debug bullet-time cycle (B key): full speed -> slower stages -> back to full.
const BULLET_TIME_SCALES = [1, 0.5, 0.25, 0.1];
@ccclass('GameManager')
export class GameManager extends Component {
    private _state = GameState.READY;
    private _raceManager: RaceManager = null;
    private _playerSwimmer: Swimmer = null;
    private readonly _playerCondition = new PlayerConditionModel();
    private _playerBalanceOverrides: PlayerBalanceOverrides | null = null;
    private _aiConditions: AiConditionModel[] = [];
    private readonly _raceContext = new RaceContext(this._playerCondition);
    private _aiController: AISwimmerController = null;
    private _aiControllers: AISwimmerController[] = [];
    private _aiSwimmers: Swimmer[] = [];
    private readonly _laneLockdownRacers: Swimmer[] = [];
    // Reused each frame for the swimmer-vs-swimmer collision pass (no per-frame allocation).
    private readonly _collisionSwimmers: Swimmer[] = [];
    // 100m AI-debug 1v1 mode: a single opponent at PRIMARY_AI_LANE_INDEX whose
    // difficulty is chosen from the login picker.
    private _aiDebugMode = false;
    private _aiDebugDifficulty = 0.8;
    private _splashCullingEnabled: boolean = PERFORMANCE_CONFIG.splash.cullingEnabled;
    private _splashParticlesEnabled: boolean = PERFORMANCE_CONFIG.splash.particleEmittersEnabled;
    private _uiController: UIController = null;
    private _uiFlow: UIFlowController = null;
    private _raceUiBuilder: SpeedStarsUiPrefabBuilder = null;
    private readonly _preRaceIntroPanel = new PreRaceIntroPanel();
    private _inputManager: InputManager = null;
    private _isReturningToLogin = false;
    // True when this race was launched from the online room (finish screen shows only
    // an exit action, which returns to the room).
    private _roomMode = false;
    // Set for a networked (frame-synced) race: shared seed + human roster. Null for a
    // normal single-player race.
    private _netSession: NetRaceSessionData | null = null;
    // Drives lock-step frame exchange during a networked race (null otherwise).
    private _netRaceController: NetRaceController | null = null;
    // Deterministic lane plan for the networked race (null for single-player).
    private _netLanePlan: NetLanePlan | null = null;
    // Remote-human input drivers created for a networked race (empty single-player).
    private _remoteControllers: RemoteSwimmerController[] = [];
    // Host: paces authoritative position-snapshot broadcasts (seconds accumulator).
    private _netSnapshotTimer = 0;
    // Accumulates real dt to step the AI on a fixed 33ms clock in a net race (so the
    // shared-seed AI advance identically on every client instead of drifting on dt).
    private _aiStepAccum = 0;
    // True while a pointer is dragging either independent free-look camera.
    private _awardsCameraDragging = false;
    private _playerOnAwardsPodium = false;
    private _overheadSpeedTextElapsed = RACE_HUD_TEXT_REFRESH_SECONDS;
    private _overheadSpeedText = '';

    private _raceHud: Node = null;
    private _modelDebugHud: Node = null;
    private _underwaterCameraTint: Node = null;
    private _worldRoot: Node = null;
    private _swimmersRoot: Node = null;
    private _poolNode: Node = null;
    private _cameraNode: Node = null;
    private _playerLaneIndex = PLAYER_LANE_INDEX;
    private _primaryAiLaneIndex = PRIMARY_AI_LANE_INDEX;
    private _waterRefraction: WaterRefractionController | null = null;
    private _laneLockdownVisuals: LaneLockdownVisuals | null = null;
    private _laneLockdownRace: LaneLockdownRaceController | null = null;
    private _laneLockdownStatusLabel: Label | null = null;
    private _eliminationDialog: Node | null = null;
    private _spectatorHud: Node | null = null;
    private _spectatorTargetLabel: Label | null = null;
    private _spectatorTarget: Swimmer | null = null;
    private _spectating = false;
    private _venueManager: VenueManager | null = null;
    private _scoreboardFeed: ScoreboardFeedCamera | null = null;
    private readonly _topViewCeiling = new TopViewCeilingController();
    private readonly _splashCullAabb = new geometry.AABB();
    private readonly _tmpSplashCullCenter = new Vec3();
    private readonly _tmpLaneFloatCutoutCenter = new Vec3();
    private readonly _tmpSpectatorTarget = new Vec3();
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
    private readonly _tmpSpeedLineVanishWorld = new Vec3();
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
    private _modelDebugFlipTurnButton: Node = null;
    private _modelDebugSkyboxLabel: Label = null;
    private _skyboxApplier: StandardSkyboxApplier = null;
    private _timingGuideFillNode: Node = null;
    private _timingGuideMarker: Node = null;
    // Left and right arms are independent stroke queues, so each hand gets its own
    // sweet-zone dial (left dial shows the swimmer's speed; right dial omits it).
    private readonly _sweetZoneBarLeft = new SweetZoneBar();
    private readonly _sweetZoneBarRight = new SweetZoneBar();
    // 100m AI-debug 1v1 extras: opponent sweet-zone dials and a camera target toggle.
    private readonly _aiSweetZoneBarLeft = new SweetZoneBar();
    private readonly _aiSweetZoneBarRight = new SweetZoneBar();
    private _cameraFollowsAi = false;
    private _aiDebugCameraButton: Node = null;
    private _aiDebugCameraButtonLabel: Label = null;
    private _fieldOverviewButtonLabel: Label | null = null;
    private _gameFlow: GameFlowController = null;
    private _modelDebugFlow: ModelDebugFlowController = null;
    // Underwater-effect tuning scene state (launch mode 'underwater-debug').
    private _underwaterDebugActive = false;
    private _uwLapDistance = 2;
    private _uwLapDir = 1;
    private _uwKickPhase = 0;
    private _uwBodyPhase = 0;
    // Free-look orbit around the swimmer (drag to rotate, wheel/pinch to zoom).
    private _uwYaw = Math.PI * 0.82;
    private _uwPitch = -0.08;
    private _uwDistance = 5.5;
    private _uwCameraDragging = false;
    private readonly _uwCamPos = new Vec3();
    private readonly _uwCamTarget = new Vec3();
    private _inputRouter: InputRouter = null;
    private readonly _debugLog = new DebugLogController();
    private readonly _aiDifficultyPanel = new AiDifficultyPanel();
    // Debug bullet-time: cycles the global scheduler time scale so the whole
    // race (movement, limb motion, splashes, camera) can be observed in slow
    // motion while tuning feel. Input classification uses wall-clock, so key
    // presses stay responsive. Toggle with the B key.
    private _bulletTimeIndex = 0;
    private readonly _raceCameraDirector = new RaceCameraDirector(PLAYER_LANE_Z, COURSE_LAYOUT);
    private readonly _finishRankOverlay = new FinishRankOverlay();
    private readonly _swimmerNameOverlay = new SwimmerNameOverlay();
    private readonly _cameraSpeedLines = new CameraSpeedLineOverlay();
    private readonly _awardsPresentation = new AwardsPresentation(COURSE_LAYOUT);
    private _cameraPos = new Vec3(-6, 4.7, 10.5);
    private _cameraTarget = new Vec3(8, 0.25, PLAYER_LANE_Z);

    onLoad() {
        game.frameRate = 45;
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
                                this.enterModelDebug('freestyle');
                            } else if (launchMode === 'underwater-debug') {
                                this.enterUnderwaterDebug();
                            } else {
                                this._aiDebugMode = launchMode === 'ai-debug';
                                if (this._aiDebugMode) {
                                    this._aiDebugDifficulty = getAiDebugDifficulty();
                                }
                                this.applyAiDebugHud();
                                this.startGame();
                            }
                            // Models and venue textures finish their asynchronous
                            // uploads shortly after scene construction. Audit once,
                            // after that initial loading window, so a real-device
                            // vConsole can prove both the selected .astc source and
                            // the final GPU texture format without any frame-loop cost.
                            this.scheduleOnce(logTextureFormatDiagnostics, 3);
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
        this._raceUiBuilder?.resetInputState();
        this._inputRouter?.unbind();
        this._netRaceController?.dispose();
        this._netRaceController = null;
        this._gameFlow?.stopAllAi();
        this._gameFlow?.clearRaceManagerCallbacks();
        this._laneLockdownVisuals?.dispose();
        this._laneLockdownVisuals = null;
        this._laneLockdownRace = null;
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
        // Dedicated underwater-effect tuning scene: drive the player + camera
        // directly and skip the entire race/net/HUD update path.
        if (this._underwaterDebugActive) {
            this.updateUnderwaterDebug(dt);
            this._waterRefraction?.update();
            return;
        }
        // Lock-step frame exchange (networked race only) runs on wall-clock dt, before
        // bullet-time scaling. The local player's own position rides along on the frame
        // (reliable channel) so peers catch its copy up without best-effort broadcasts.
        this._netRaceController?.tick(dt, this.buildLocalSelfSnapshot());
        // Deterministic AI: in a net race step the AI on a fixed 33ms clock (raw dt),
        // so the shared-seed AI advance identically on every client (no drift).
        this.driveNetAiFixedStep(dt);
        // Bullet-time: everything GameManager drives (camera, model debug, etc.)
        // runs on the scaled delta. Input classification stays on wall-clock.
        dt = scaledDelta(dt);
        this._awardsPresentation.update(dt);
        this._inputRouter?.tick();
        this.consumePlayerRhythmResults();
        this.updatePlayerCondition(dt);
        const timingGuide = this._playerSwimmer.strokeTimingGuide;
        const raceActive = this._state === GameState.RACING;
        const raceDistance = getRaceDistance();
        const playerAlive = this._playerSwimmer.node.active;
        const playerBeforeFinish = playerAlive && this._playerSwimmer.distance < raceDistance;
        const laneFloatCutoutActive = !this._modelDebugFlow?.active
            && playerBeforeFinish
            && (this._state === GameState.GLIDING || this._state === GameState.RACING);
        const laneFloatCutoutCenter = this._playerSwimmer.getCameraUpperBodyWorldPosition(this._tmpLaneFloatCutoutCenter);
        const playerHeading = this._playerSwimmer.movementHeading;
        this._venueManager?.updateLaneFloatCutout(
            laneFloatCutoutCenter,
            this._playerSwimmer.raceDirection * Math.cos(playerHeading),
            Math.sin(playerHeading),
            laneFloatCutoutActive,
        );
        const raceStatusVisible = !this._modelDebugFlow?.active
            && playerBeforeFinish
            && (this._state === GameState.GLIDING || this._state === GameState.RACING);
        this._uiFlow?.setRaceStatusVisible(raceStatusVisible);
        const presentationIndicatorVisible = this._state === GameState.PRECOUNTDOWN
            || (this._state === GameState.AWARDS && this._playerOnAwardsPodium);
        // The player can finish before the last AI swimmer. Hide player-specific
        // overhead UI as soon as the player's own distance reaches the wall during
        // the race. Identify the protagonist before the start and, during awards,
        // only when the player is actually one of the three podium finishers.
        const playerIndicatorVisible = !this._modelDebugFlow?.active
            && (presentationIndicatorVisible || (
                this._state !== GameState.READY
                && this._state !== GameState.FINISHED
                && playerBeforeFinish
            ));
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
        if (this._overheadReadout && this._overheadReadout.active !== playerSpeedVisible) {
            this._overheadReadout.active = playerSpeedVisible;
        }
        if (this._playerOverheadMarker && this._playerOverheadMarker.active !== playerIndicatorVisible) {
            this._playerOverheadMarker.active = playerIndicatorVisible;
        }
        if (playerIndicatorVisible) {
            this.positionSweetZoneDialsAbove(
                this._playerSwimmer,
                this._sweetZoneBarLeft,
                this._sweetZoneBarRight,
                this._overheadReadout,
                this._playerOverheadMarker,
                playerFeedbackVisible,
            );
            if (this._overheadSpeedLabel) {
                this._overheadSpeedTextElapsed += dt;
                if (this._overheadSpeedTextElapsed >= RACE_HUD_TEXT_REFRESH_SECONDS) {
                    this._overheadSpeedTextElapsed %= RACE_HUD_TEXT_REFRESH_SECONDS;
                    const nextText = `${Math.max(0, playerSpeed).toFixed(2)} m/s`;
                    if (nextText !== this._overheadSpeedText) {
                        this._overheadSpeedText = nextText;
                        this._overheadSpeedLabel.string = nextText;
                    }
                }
            }
        }
        this.updateAiSweetZoneBar(raceActive);
        this.updateSplashCulling();
        // Single-player keeps the original render-driven separation path. Network races
        // resolve collisions inside driveNetAiFixedStep on the shared 33ms clock, never
        // once per render frame (which made impulse count depend on device FPS).
        if (!this._netSession) {
            this.updateSwimmerCollisions();
        }
        this.updateNetRaceSync(dt);
        this.updateLaneLockdown(dt);
        // Roster info panel only during pre-race stage 1 (the wide overview shot);
        // it fades out as the per-lane close-up sweep begins.
        this._preRaceIntroPanel.setVisible(
            !this._modelDebugFlow?.active
            && this._state === GameState.PRECOUNTDOWN
            && this._raceCameraDirector.preRacePhase === 'overview',
        );
        const awardsActive = this._state === GameState.AWARDS;
        const standingPresentation = this._state === GameState.PRECOUNTDOWN || awardsActive;
        const swimmerNamesVisible = !this._modelDebugFlow?.active
            && this._state !== GameState.READY
            && this._state !== GameState.FINISHED;
        this._swimmerNameOverlay.setVisible(swimmerNamesVisible);
        // The podium uses the same quiet name labels as the pool. Hide the larger
        // finish rank chips there so both styles do not cover the standing faces.
        this._finishRankOverlay.setHeadBadgesVisible(!awardsActive);
        if (this._modelDebugFlow?.active) {
            this._topViewCeiling.update(false);
            this.setUnderwaterOverlayVisible(false);
            this._modelDebugFlow.update(dt);
            this._modelDebugFlow.updateCamera();
            this._waterRefraction?.setSwimmerDisturbanceActive(false);
            this._waterRefraction?.update();
            return;
        }
        this.updateSpectatorCameraTarget();
        this._gameFlow?.updateRaceCamera(dt);
        this.updateSpeedLineVanishingPoint();
        this._topViewCeiling.update(this._raceCameraDirector.topViewActive);
        this.setUnderwaterOverlayVisible(this._raceCameraDirector.underwaterViewActive);
        this._waterRefraction?.setSwimmerDisturbanceActive(this._raceCameraDirector.topViewActive);
        this._swimmerNameOverlay.update(
            this._cameraNode?.getComponent(Camera) ?? null,
            this._uiCamera,
            raceDistance,
            awardsActive,
            standingPresentation ? 72 : 30,
        );
        // Pin the finish-line rank badges above each finished swimmer using this
        // frame's final camera transform.
        if (this._finishRankOverlay.hasResults()) {
            this._finishRankOverlay.update(this._cameraNode?.getComponent(Camera) ?? null, this._uiCamera);
        }
        // Update after the race camera so the refraction camera uses this frame's
        // final transform. Underwater shots keep the swimmer overlay camera synced
        // while the water surface and refraction RenderTexture camera stay off.
        this._waterRefraction?.update();
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

    // Push overlapping swimmers apart on the lateral (Z) axis. Manual XZ overlap
    // test over up to 8 swimmers — no physics engine needed. Per-swimmer gating
    // lives in Swimmer.isCollisionActive (only racing, on-screen, non-flip-turn).
    private updateSwimmerCollisions() {
        if (this._modelDebugFlow?.active) {
            return;
        }
        this._collisionSwimmers.length = 0;
        if (this._playerSwimmer) {
            this._collisionSwimmers.push(this._playerSwimmer);
        }
        for (const swimmer of this._aiSwimmers) {
            if (swimmer) {
                this._collisionSwimmers.push(swimmer);
            }
        }
        // Networked race: keep collisions ON while positions are well-synced, but exclude
        // any swimmer that's mid catch-up (snapping to its authoritative position) — a
        // collision push there would fight the snap. The local player never snaps (it's
        // predicted), so it always collides.
        if (this._netSession) {
            for (let i = this._collisionSwimmers.length - 1; i >= 0; i--) {
                if (this._collisionSwimmers[i].netCatchingUp) {
                    this._collisionSwimmers.splice(i, 1);
                }
            }
        }
        // Net races run weighted collisions like single-player: every swimmer's body
        // weight is now consistent across clients (AI from the shared roster; humans from
        // the 养成 profile synced in the net roster and applied in wireRemoteSwimmers), so
        // the weighted knockback split resolves the same everywhere. Residual float
        // divergence is absorbed by the owner/host position authority.
        resolveSwimmerCollisions(this._collisionSwimmers);
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

    private applyBodyFeedbackEnabled() {
        this._playerSwimmer?.setBodyFeedbackEnabled(true);
        for (const swimmer of this._aiSwimmers) {
            swimmer?.setBodyFeedbackEnabled(true);
        }
    }

    startGame() {
        this._raceUiBuilder?.resetInputState();
        this._inputRouter?.resetStrokeInput();
        this._gameFlow?.startGame();
    }

    restartGame() {
        this._raceUiBuilder?.resetInputState();
        this._inputRouter?.resetStrokeInput();
        this.applyPlayerProgression();
        this.randomizeAiRosterForRestart();
        this._gameFlow?.restartGame();
    }

    // Re-roll the AI lineup before each replay so tapping "再来一次" faces a freshly
    // shuffled set of opponents (names + difficulty) in new lane positions. Skipped
    // for the 100m AI-debug 1v1, where the opponent is intentionally fixed.
    private randomizeAiRosterForRestart() {
        if (this._aiDebugMode || this._modelDebugFlow?.active) {
            return;
        }
        if (this._aiSwimmers.length === 0 || this._aiControllers.length === 0) {
            return;
        }
        this.createCompetitorManager().reassignAiRoster(this._aiSwimmers, this._aiControllers);
        this.refreshPreRaceIntroRoster();
        this.refreshSwimmerNameRoster();
        this.refreshAiDifficultyPanel();
        this.debug('restart AI roster reshuffled');
    }

    // In room mode the finish screen offers only "exit" (back to the room), never a
    // replay. Hide the restart button and relabel the menu button accordingly.
    private applyRoomModeHud(raceHud: Node) {
        if (!this._roomMode || !raceHud?.isValid) {
            return;
        }
        const restart = findByName(raceHud, 'RestartButton');
        if (restart) {
            restart.active = false;
        }
        const menu = findByName(raceHud, 'MenuButton');
        const menuLabel = menu?.getChildByName('Label')?.getComponent(Label);
        if (menuLabel) {
            menuLabel.string = '退出比赛';
        }
    }

    private returnToLogin() {
        if (this._isReturningToLogin) {
            return;
        }
        this._isReturningToLogin = true;
        // Room-mode races return to the online room, not the main menu.
        if (this._roomMode) {
            setReturnToRoom(true);
        }
        // Networked race: tell the others we're leaving so our swimmer is retired
        // immediately, rather than freezing in the pool until the straggler countdown.
        if (this._netSession) {
            this._netRaceController?.broadcastQuit();
        }
        this._raceUiBuilder?.resetInputState();
        this._inputRouter?.unbind();
        this._gameFlow?.stopAllAi();
        this._gameFlow?.clearRaceManagerCallbacks();
        director.getScheduler().setTimeScale(1);
        setTimeScale(1);
        director.loadScene('Login');
    }

    private buildScene(done: (error?: unknown) => void) {
        this._roomMode = consumeRoomMode();
        this._netSession = consumeNetRaceSession();
        if (this._netSession) {
            // Networked race: every client reseeds SharedRNG with the host's seed so
            // the AI fill, lane assignment, and roster shuffles match on all clients.
            reseedSharedRandom(this._netSession.seed);
            this._netRaceController = new NetRaceController(this._netSession);
        }
        const scene = this.createRuntimeSceneBuilder().build();
        this._worldRoot = scene.worldRoot;
        this._cameraNode = scene.cameraNode;
        // Networked race: show the sync debug HUD on the race canvas (debug-flag gated).
        if (NET_RACE_DEBUG_HUD) {
            this._netRaceController?.attachHud(scene.canvasNode, scene.width, scene.height);
        }
        this._underwaterCameraTint = this.buildUnderwaterCameraTint(this._cameraNode, scene.width, scene.height);
        this._skyboxApplier = scene.skyboxApplier;
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
                    // Networked race: the host issues a synchronized GO once every
                    // member's pre-race showcase is ready; the countdown starts then.
                    this._netRaceController?.setCountdownStartListener(() => this._raceManager?.startRace());
                    this._netRaceController?.setPlayerQuitListener((pos) => this.onNetPlayerQuit(pos));
                    this.setupLaneLockdownRace();
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
            updateCameraSpeedLines: (dt, speed, visible, sprintBoost) => {
                this._cameraSpeedLines.update(dt, speed, visible, sprintBoost);
            },
            exitModelDebug: (showStart) => this.exitModelDebug(showStart),
            handleModelDebugStroke: (type) => this._modelDebugFlow?.handleStroke(type) ?? false,
            handleModelDebugStrokeHeld: (type, held) => this._modelDebugFlow?.handleStrokeHeld(type, held) ?? false,
            handleModelDebugKickStroke: (type) => this._modelDebugFlow?.handleKickStroke(type) ?? false,
            setState: (state) => {
                this._state = state;
                this.syncConditionPhase(state);
                if (state === GameState.PRECOUNTDOWN) {
                    MusicManager.playRace();
                    this.hideEliminationAndSpectatorUi();
                    this._playerSwimmer?.clearLaneLockdownBounds();
                    for (const swimmer of this._aiSwimmers) {
                        swimmer.clearLaneLockdownBounds();
                    }
                    this._laneLockdownRace?.reset();
                } else if (state === GameState.AWARDS) {
                    MusicManager.playResult();
                    this._laneLockdownVisuals?.clear();
                    if (this._laneLockdownStatusLabel) {
                        this._laneLockdownStatusLabel.node.active = false;
                    }
                    this._spectating = false;
                    this._spectatorTarget = null;
                    if (this._eliminationDialog) {
                        this._eliminationDialog.active = false;
                    }
                    if (this._spectatorHud) {
                        this._spectatorHud.active = false;
                    }
                }
                // The start blocks are a statically batched, non-cullable mesh only
                // seen at the dive end. Hide them once the swimmer leaves the wall
                // (gliding/racing) so their vertices aren't processed every frame.
                this._venueManager?.setStartBlocksVisible(
                    state !== GameState.GLIDING && state !== GameState.RACING,
                );
                if (state !== GameState.AWARDS) {
                    this._awardsPresentation.hide();
                }
                if (state === GameState.PRECOUNTDOWN) {
                    this.refreshPreRaceIntroRoster();
                }
            },
            getState: () => this._state,
            clearFinishRanks: () => this._finishRankOverlay.clear(),
            isLiveRanksEnabled: () => true,
            showLiveRanks: (results) => this._finishRankOverlay.showLiveResults(results),
            showFinishRank: (result) => this._finishRankOverlay.addResult(result),
            onSwimmerEliminated: (swimmer) => this.handleSwimmerEliminated(swimmer),
            beginCountdown: () => this.beginRaceCountdown(),
            resolveNetLeaderboard: (leaderboard, done) => this.resolveNetLeaderboard(leaderboard, done),
            showAwards: (leaderboard) => {
                this._playerOnAwardsPodium = leaderboard.some((row) =>
                    row.isPlayer && row.finished && row.placement >= 1 && row.placement <= 3,
                );
                const center = this._awardsPresentation.show(leaderboard, this._poolNode);
                this._raceCameraDirector.startAwardsPresentation(center);
            },
            playerDiveSpeedScale: () => this._playerBalanceOverrides
                ? this._playerBalanceOverrides.diveMaxLaunchSpeed / DIVE_BALANCE.maxLaunchSpeed
                : 1,
            awardProgression: (input) => {
                const progression = getProgressionManager();
                const characterId = getPlayerCharacterSelection().characterId;
                return progression.awardRace(characterId, input);
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
                this._uiFlow?.setSprintActive(true);
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
            playerLaneZ: LANE_LAYOUT.centerZ(this._playerLaneIndex),
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
            flipTurnButton: this._modelDebugFlipTurnButton,
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
            onStrokeHeld: (type, held, preHeldSeconds) => this.handlePlayerStrokeHeld(type, held, preHeldSeconds),
            onKickStroke: (type) => this.handlePlayerKickStroke(type),
            onDiveChargeStart: () => this._gameFlow?.handleDiveChargeStart(),
            onDiveRelease: (holdSeconds) => this._gameFlow?.handleDiveRelease(holdSeconds),
            onDolphinJump: () => this._gameFlow?.handleDolphinJump(),
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
        this._venueManager = venue;
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
                    venue.setWaterY(COURSE_LAYOUT.waterY);
                    this._raceCameraDirector.resetToBroadcast();
                }
                this._poolNode = pool;
                const ceilingCount = this._topViewCeiling.bind(pool);
                this.debug(`top-view ceiling nodes=${ceilingCount}`);
                this.setupWaterRefraction(pool);
                applyPoolEdgeToonOutline(pool, (message) => this.debug(message));
                this.setupLaneLockdownVisualPreview();
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

    private setupLaneLockdownVisualPreview() {
        this._laneLockdownVisuals?.dispose();
        this._laneLockdownVisuals = null;
        if (!getRaceDifficultyConfig().laneLockdownEnabled || !this._waterRefraction) {
            return;
        }
        this._laneLockdownVisuals = new LaneLockdownVisuals(this._waterRefraction, COURSE_LAYOUT);
        this._laneLockdownVisuals.clear();
    }

    private setupLaneLockdownRace() {
        this._laneLockdownRace = null;
        if (!getRaceDifficultyConfig().laneLockdownEnabled || !this._raceManager) {
            return;
        }
        this._laneLockdownRace = new LaneLockdownRaceController(
            COURSE_LAYOUT,
            this._laneLockdownVisuals,
            (swimmer) => this._raceManager?.eliminateSwimmer(swimmer),
            (status) => this.updateLaneLockdownStatus(status),
            (target) => {
                for (const controller of this._aiControllers) {
                    controller.setLaneLockdownSafeZRange(
                        target?.safeMinZ ?? null,
                        target?.safeMaxZ ?? null,
                        target?.warning ?? false,
                    );
                }
            },
        );
        this._laneLockdownRace.reset();
    }

    private updateLaneLockdown(dt: number) {
        if (!this._laneLockdownRace || this._modelDebugFlow?.active) {
            return;
        }
        this._laneLockdownRacers.length = 0;
        if (this._playerSwimmer?.node?.active) {
            this._laneLockdownRacers.push(this._playerSwimmer);
        }
        for (const swimmer of this._aiSwimmers) {
            if (swimmer?.node?.active) {
                this._laneLockdownRacers.push(swimmer);
            }
        }
        this._laneLockdownRace.update(dt, this._state, this._laneLockdownRacers);
    }

    private updateLaneLockdownStatus(status: LaneLockdownStatus | null) {
        const label = this._laneLockdownStatusLabel;
        if (!label) {
            return;
        }
        if (!status) {
            label.node.active = false;
            return;
        }
        label.node.active = this._state === GameState.RACING;
        label.string = status.locked
            ? `安全泳道 ${status.firstSafeLane}-${status.lastSafeLane}`
            : `泳道收缩 ${status.warningSeconds}s  前往 ${status.firstSafeLane}-${status.lastSafeLane} 道`;
        label.color = status.locked ? new Color(185, 230, 242, 255) : new Color(255, 244, 188, 255);
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
        // Darken the stands progressively with height (bright poolside, dark up
        // top) so the pool reads brighter than the arena. Quick 方案B preview.
        try {
            applyStandHeightShade(pool, undefined, (message) => this.debug(message));
        } catch (error) {
            console.warn('[SpeedSwimming] stand height shade skipped', error);
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
            playerLaneZ: LANE_LAYOUT.centerZ(this._playerLaneIndex),
            debug: (message) => this.debug(message),
        });
    }

    private createCompetitorManager(): CompetitorManager {
        return new CompetitorManager({
            laneLayout: LANE_LAYOUT,
            courseLayout: COURSE_LAYOUT,
            playerLaneIndex: this._playerLaneIndex,
            primaryAiLaneIndex: this._primaryAiLaneIndex,
            debug: (message) => this.debug(message),
        });
    }

    private buildPlayerSwimmer3D(root: Node) {
        this.assignRaceLanes();
        const competitors = this.createCompetitorManager().buildPlayer(root);
        this._swimmersRoot = competitors.group;
        this._playerSwimmer = competitors.playerSwimmer;
        this._aiController = null;
        this._aiControllers = [];
        this._aiSwimmers = [];
        this._aiConditions = [];
        // Networked race: give the local player the same avatar-derived look every
        // other client renders for this seat, so appearances match across clients.
        if (this._netSession) {
            const self = this._netSession.members.find((m) => m.pos === this._netSession!.localPos)
                ?? this._netSession.members.find((m) => m.self);
            if (self) {
                applyNetSwimmerLook(this._playerSwimmer.cartoonRig, self.avatarId);
            }
        }
        this.applySplashParticlesEnabled();
        this.applyBodyFeedbackEnabled();
        this.refreshAiDifficultyPanel();
        this.applyPlayerProgression();
    }

    private applyPlayerProgression() {
        const characterId = getPlayerCharacterSelection().characterId;
        const level = getProgressionManager().getCharacterLevel(characterId);
        // Resolve + apply through the shared seam so the local player uses EXACTLY what it
        // publishes to peers (and what peers apply to its remote copy) — same code path a
        // remote human takes in wireRemoteSwimmers.
        const modifiers = resolveLocalRaceModifiers();
        const overrides = modifiers.balance;
        this._playerBalanceOverrides = overrides;
        if (this._playerSwimmer) {
            applyRaceModifiersToSwimmer(this._playerSwimmer, modifiers);
        }
        if (overrides) {
            this._playerCondition.setProgressionOverrides({
                energyTotal: overrides.energyTotal,
            });
            this._uiFlow?.setEnergyTotal(overrides.energyTotal);
        }
        this.debug('progression character=' + characterId + ' level=' + level);
    }

    private assignRaceLanes() {
        if (this._netSession) {
            // Networked race: every client lays swimmers out identically from the
            // shared roster, and each client's own player takes its seat's lane.
            this._netLanePlan = buildNetLanePlan(this._netSession, LANE_LAYOUT.laneCount);
            this._playerLaneIndex = this._netLanePlan.playerLane;
        } else {
            this._playerLaneIndex = randomInt(LANE_LAYOUT.laneCount);
        }
        this._primaryAiLaneIndex = this._playerLaneIndex === PRIMARY_AI_LANE_INDEX
            ? (PRIMARY_AI_LANE_INDEX + 1) % LANE_LAYOUT.laneCount
            : PRIMARY_AI_LANE_INDEX;
        const playerLaneZ = LANE_LAYOUT.centerZ(this._playerLaneIndex);
        this._raceCameraDirector.setPlayerLaneZ(playerLaneZ);
        this._cameraTarget.z = playerLaneZ;
        this.debug(`race start lane=${this._playerLaneIndex + 1}`);
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
                ? { soloLane: this._primaryAiLaneIndex, difficultyOverride: this._aiDebugDifficulty }
                : undefined,
        );
        this._aiController = competitors.primaryAiController;
        this._aiControllers.splice(0, this._aiControllers.length, ...competitors.aiControllers);
        this._aiSwimmers.splice(0, this._aiSwimmers.length, ...competitors.aiSwimmers);
        this._aiConditions.splice(0, this._aiConditions.length, ...this._aiSwimmers.map(() => new AiConditionModel()));
        for (const swimmer of this._aiSwimmers) {
            swimmer.reset();
        }
        // Networked race: step the AI deterministically on the fixed clock (see
        // driveNetAiFixedStep). Remote humans are excluded again in wireRemoteSwimmers.
        if (this._netSession) {
            for (const swimmer of this._aiSwimmers) {
                swimmer.netFixedStep = true;
            }
        }
        // Give every AI a shared read-only view of the race so its strategy layer
        // (rubber-band toward the player + neck-and-neck duel surge) can measure
        // gaps and rank. The player anchors the strategy, so it must be included.
        const raceObserver = new AIRaceObserver(
            this._playerSwimmer,
            [this._playerSwimmer, ...this._aiSwimmers].filter((s): s is Swimmer => !!s),
        );
        for (const controller of this._aiControllers) {
            controller.raceObserver = raceObserver;
        }
        this._gameFlow?.refreshPreRaceShowcaseRoster();
        // AI swimmers load one frame after startGame(), so the pre-race roster
        // panel was first populated with only the player. Repopulate it now that
        // the full lineup exists.
        this.refreshPreRaceIntroRoster();
        this.refreshSwimmerNameRoster();
        this.applySplashParticlesEnabled();
        this.applyBodyFeedbackEnabled();
        if (this._raceManager) {
            this._raceManager.aiSwimmer = this._aiController?.swimmer ?? null;
            this._raceManager.aiSwimmers = this._aiSwimmers;
        }
        this.refreshAiDifficultyPanel();
        this.debug(`deferred AI swimmers loaded count=${this._aiSwimmers.length}`);
        // Networked race: convert the lanes occupied by remote humans from AI to
        // network-driven bodies. Single-player leaves this untouched.
        this.wireRemoteSwimmers();
    }

    // Networked race only: turn the AI swimmers that sit in remote-human lanes into
    // RemoteSwimmerController-driven bodies and register them with the net controller
    // so their seat's decoded input is replayed onto them. No-op in single-player.
    private wireRemoteSwimmers() {
        this._remoteControllers.length = 0;
        if (!this._netSession || !this._netLanePlan || !this._netRaceController) {
            return;
        }
        const playerLane = this._playerLaneIndex;
        for (const remote of this._netLanePlan.remotes) {
            const lane = remote.lane;
            if (lane === playerLane) {
                continue;
            }
            // AI swimmers are pushed in ascending lane order skipping the player lane,
            // so the body in `lane` is at this index in the AI arrays.
            const index = lane < playerLane ? lane : lane - 1;
            const swimmer = this._aiSwimmers[index];
            const aiController = this._aiControllers[index];
            if (!swimmer?.node?.isValid || !aiController) {
                continue;
            }
            // Neutralize the AI on this lane.
            aiController.remoteDriven = true;
            aiController.stopSwimming();
            // Slice 3: drive remote humans on the SAME deterministic fixed 33ms clock as
            // the AI (driveNetAiFixedStep). Their strokes arrive identically on every
            // client over frame-sync, so a fixed cadence removes the variable-dt drift
            // (huge across iOS 120fps vs Android 60fps) and leaves only the cross-engine
            // float residual for the host snapshot to correct — exactly the AI model.
            // The neutralized AI controller's stepSimulation is a no-op (inactive), so
            // the shared driver loop can step this body without fighting the input replay.
            swimmer.netFixedStep = true;
            // Attach the network-input replayer.
            const driver = swimmer.node.addComponent(RemoteSwimmerController);
            driver.swimmer = swimmer;
            driver.pos = remote.pos;
            driver.resetRemote();
            const identity = this._netSession.members.find((m) => m.pos === remote.pos);
            if (identity?.nickName) {
                swimmer.swimmerName = identity.nickName;
            }
            // Apply this remote human's 养成 profile (digest synced over the room broadcast
            // channel) to their local motor, so their predicted sim + weight-based collision
            // match how their own client races them — the same seam the local player uses
            // (applyPlayerProgression). Re-resolved from the digest via shared config.
            applyRaceModifiersToSwimmer(swimmer, resolveModifiersFromDigest(decodeModifierDigest(identity?.modifiersBlob)));
            // Match this remote human's look to what its own client renders (derived
            // from the shared avatarId) so appearances are identical everywhere.
            if (identity?.avatarId) {
                applyNetSwimmerLook(swimmer.cartoonRig, identity.avatarId);
            }
            this._remoteControllers.push(driver);
            this._netRaceController.registerRemote(remote.pos, driver);
        }
        // The pre-race roster panels + showcase + name overlay were populated with the
        // AI placeholder names BEFORE this rename; rebuild them so the pre-race player
        // list shows each remote human's real nickname (not an AI name).
        this._gameFlow?.refreshPreRaceShowcaseRoster();
        this.refreshPreRaceIntroRoster();
        this.refreshSwimmerNameRoster();
        this._netRaceController?.setLocalPlayerLane(this._playerLaneIndex);
        this.debug(`net remote swimmers wired count=${this._remoteControllers.length}`);
    }

    // Begin the pre-dive countdown. Single-player starts it immediately; a networked
    // race reports this client ready and waits for the host's synchronized GO (so all
    // players' countdowns start together once everyone — including late joiners — has
    // loaded), which then calls startRace() via the countdown-start listener.
    private beginRaceCountdown() {
        if (this._netSession && this._netRaceController) {
            this._netRaceController.reportRaceReady();
            return;
        }
        this._raceManager?.startRace();
    }

    // Host-authoritative final placement (networked race only; single-player passes
    // the local leaderboard straight through). The HOST broadcasts its authoritative
    // placement; a CLIENT waits briefly for it (with a fallback timeout) then adopts
    // the host's ordering so both ends show identical final ranks.
    private resolveNetLeaderboard(
        leaderboard: RaceFinishResult[],
        done: (leaderboard: RaceFinishResult[]) => void,
    ) {
        if (!this._netSession || !this._netRaceController) {
            done(leaderboard);
            return;
        }
        if (this._netRaceController.isHost) {
            // Host is authoritative: broadcast its ordering, use it as-is. Key each
            // entry by the swimmer's STABLE assigned lane (from the deterministic lane
            // plan), NOT RaceManager's world-Z-derived lane — at the finish wall
            // collisions/lateral drift push swimmers into a neighbour's Z bucket, so
            // two rows can collide on that lane and break the client's placement match.
            const entries = [] as { lane: number; placement: number; finished: boolean; time: number }[];
            for (const row of leaderboard) {
                const lane = this.assignedLaneOfSwimmer(row.swimmer);
                if (lane >= 0) {
                    entries.push({ lane, placement: row.placement, finished: row.finished, time: row.time });
                }
            }
            this._netRaceController.sendResult(entries);
            // broadcastInRoom messages can be dropped; resend the result a few times so
            // every client reliably adopts the host's ranking.
            for (let i = 1; i <= 4; i++) {
                setTimeout(() => this._netRaceController?.sendResult(entries), i * 350);
            }
            done(leaderboard);
            return;
        }
        // Client: adopt the host's ordering. If it hasn't arrived yet, wait up to
        // ~1.2s, then fall back to the local ordering so results never hang.
        let settled = false;
        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            this._netRaceController?.setAuthResultListener(null);
            done(leaderboard);
        };
        const apply = (result: { lane: number; placement: number; finished: boolean; time: number }[]) => {
            const byLane = new Map(result.map((e) => [e.lane, e]));
            for (const row of leaderboard) {
                // Match by the same STABLE assigned lane the host keyed by.
                const auth = byLane.get(this.assignedLaneOfSwimmer(row.swimmer));
                if (auth) {
                    row.placement = auth.placement;
                    row.finished = auth.finished;
                    row.time = auth.time;
                }
            }
            leaderboard.sort((a, b) => a.placement - b.placement);
            finish();
        };
        const existing = this._netRaceController.authResult;
        if (existing) {
            apply(existing);
            return;
        }
        this._netRaceController.setAuthResultListener((result) => apply(result));
        setTimeout(() => finish(), 4000);
    }

    // The swimmer occupying a given lane (player lane -> player, else the AI/remote
    // body pushed in ascending lane order skipping the player lane).
    private swimmerForLane(lane: number): Swimmer | null {
        if (lane === this._playerLaneIndex) {
            return this._playerSwimmer;
        }
        const index = lane < this._playerLaneIndex ? lane : lane - 1;
        return this._aiSwimmers[index] ?? null;
    }

    // The stable assigned lane (0-based) of a swimmer, i.e. the reverse of
    // swimmerForLane. Deterministic + identical across clients, so it is a reliable
    // key for the authoritative result (unlike the world-Z-derived race lane). -1 if
    // the swimmer is not one of this race's bodies.
    private assignedLaneOfSwimmer(swimmer: Swimmer | null): number {
        if (!swimmer) {
            return -1;
        }
        for (let lane = 0; lane < LANE_LAYOUT.laneCount; lane++) {
            if (this.swimmerForLane(lane) === swimmer) {
                return lane;
            }
        }
        return -1;
    }

    // A member quit mid-race: retire that seat's swimmer so it stops racing and drops
    // out of the finish accounting (the race can then conclude without waiting for the
    // straggler countdown to DNF a frozen body). If it was the host, host migration
    // separately hands authority to the next seat. No-op if we can't resolve the seat.
    private onNetPlayerQuit(pos: number) {
        if (!this._netLanePlan || !this._raceManager) {
            return;
        }
        const remote = this._netLanePlan.remotes.find((r) => r.pos === pos);
        if (!remote) {
            return;
        }
        const swimmer = this.swimmerForLane(remote.lane);
        if (swimmer) {
            this._raceManager.eliminateSwimmer(swimmer, true);
            this.debug(`net player pos=${pos} quit — retired lane=${remote.lane}`);
        }
    }

    // Deterministic fixed-step driver (net race only). Advances every net-driven body
    // on a FIXED 33ms clock in a stable order, so they progress identically on every
    // client — killing the variable-dt drift the host correction was papering over.
    // Covers BOTH the AI (decisions from the shared RNG seed) and remote humans (inputs
    // replayed from frame-sync); both bodies live in _aiSwimmers with netFixedStep=true
    // and skip their engine update(). A remote lane's AI controller is neutralized, so
    // its stepSimulation is an inactive no-op and won't fight the replayed input.
    // No-op single-player.
    private driveNetAiFixedStep(dt: number) {
        if (!this._netSession || this._aiSwimmers.length === 0) {
            return;
        }
        this._aiStepAccum += dt;
        // Guard against a huge dt after a stall so we don't burst hundreds of steps.
        if (this._aiStepAccum > NET_SIM_STEP * 6) {
            this._aiStepAccum = NET_SIM_STEP;
        }
        while (this._aiStepAccum >= NET_SIM_STEP) {
            this._aiStepAccum -= NET_SIM_STEP;
            for (let i = 0; i < this._aiSwimmers.length; i++) {
                const swimmer = this._aiSwimmers[i];
                if (swimmer?.netFixedStep && swimmer.node.active) {
                    swimmer.netStepBegin();
                }
            }
            for (let i = 0; i < this._aiSwimmers.length; i++) {
                const swimmer = this._aiSwimmers[i];
                if (!swimmer?.netFixedStep || !swimmer.node.active) {
                    continue;
                }
                this._aiControllers[i]?.stepSimulation(NET_SIM_STEP);
                swimmer.stepSimulation(NET_SIM_STEP);
            }
            // One collision solve per deterministic simulation step, after every
            // net-driven body has advanced in stable lane order. The local player's
            // latest predicted body participates but remains owner-authoritative.
            this.updateSwimmerCollisions();
            // Capture the post-collision target so render interpolation preserves the
            // resolved push instead of repainting the pre-collision step position.
            for (let i = 0; i < this._aiSwimmers.length; i++) {
                const swimmer = this._aiSwimmers[i];
                if (swimmer?.netFixedStep && swimmer.node.active) {
                    swimmer.netStepEnd();
                }
            }
        }
        // Smooth the 30/s fixed steps up to the 45fps render by interpolating each
        // net-driven body's position toward the latest step by the leftover phase.
        // Cheap (one lerp + setPosition per body) and net-mode only.
        const renderPhase = this._aiStepAccum / NET_SIM_STEP;
        for (let i = 0; i < this._aiSwimmers.length; i++) {
            const swimmer = this._aiSwimmers[i];
            if (swimmer?.netFixedStep && swimmer.node.active) {
                swimmer.netRenderLerp(renderPhase);
            }
        }
    }


    // Position sync. Every client broadcasts its OWN player's authoritative position
    // (it predicts locally with zero input lag, so its own view is the truth); every
    // other client catches that swimmer's on-screen copy up to it (killing the ~1 RTT
    // input-replay lag + drift). The HOST additionally broadcasts a full snapshot that
    // is authoritative for the AI lanes (shared-seed AI + host tie-breaking).
    private updateNetRaceSync(dt: number) {
        if (!this._netSession || !this._netRaceController) {
            return;
        }
        // If our own frame channel is down (iOS high-performance+), keep telling the room
        // so a peer with working frame sync (e.g. Android) also broadcasts its state.
        // Runs before the racing gate so the switch happens as early as possible.
        this._netRaceController.maybeAnnounceBroadcastNeed();
        // Positions matter once ANY swimmer can be racing — from DIVING (remote humans /
        // AI dive and race while our own player may still be on the block) through
        // RACING. Gating this on our OWN local racing state was the bug: if the local
        // player just sat in DIVING (no input), the remote swimmers never got corrected
        // and froze after their dive glide.
        if (this._state !== GameState.RACING
            && this._state !== GameState.GLIDING
            && this._state !== GameState.DIVING) {
            return;
        }
        // If the current host goes silent (dropped), the lowest surviving seat promotes
        // itself to host here so the race keeps a single authority for the AI lanes.
        this._netRaceController.checkHostMigration(true);
        const laneCount = LANE_LAYOUT.laneCount;
        const raceDistance = getRaceDistance();

        this._netSnapshotTimer += dt;
        if (this._netSnapshotTimer >= NET_SNAPSHOT_INTERVAL) {
            this._netSnapshotTimer = 0;
            // Host: broadcast the full snapshot (authoritative for AI lanes). Human
            // positions ride the reliable frame channel (buildLocalSelfSnapshot in
            // tick()), not this best-effort broadcast.
            if (this._netRaceController.isHost) {
                const entries: NetSnapshotEntry[] = [];
                for (let lane = 0; lane < laneCount; lane++) {
                    const swimmer = this.swimmerForLane(lane);
                    if (!swimmer?.node?.active) {
                        continue;
                    }
                    entries.push({
                        lane,
                        distance: swimmer.distance,
                        lateral: swimmer.netLateralOffset,
                        finished: swimmer.distance >= raceDistance,
                        heading: swimmer.netHeading,
                        speed: swimmer.netSpeed,
                        energy: swimmer.ultimate.energy,
                    });
                }
                this._netRaceController.sendSnapshot(entries);
            }
            // Broadcast-only fallback (e.g. iOS high-performance+ disables the lock-step
            // frame channel): a non-host human's self-position can no longer ride
            // uploadFrame, so broadcast it as P| here instead. The host's own lane is
            // already carried in its S| snapshot above, so only non-hosts send P|.
            // `broadcastSyncRequired` also triggers when a PEER can't use frames (mixed
            // iOS/Android room), so an Android guest still broadcasts P| to an iOS host.
            // In a fully frame-synced race this is false and self keeps riding the
            // reliable frame channel via tick(), so single-player + normal races are
            // unchanged.
            else if (this._netRaceController.broadcastSyncRequired) {
                const self = this.buildLocalSelfSnapshot();
                if (self) {
                    this._netRaceController.sendSelfSnapshot(self);
                }
            }
            if (NET_RACE_DEBUG_HUD) {
                this._netRaceController.setDiag(this.buildNetDiag());
            }
        }

        // Correct every swimmer EXCEPT our own predicted player (correcting it would snap
        // it back to a ~RTT-stale value = "走不动"). Human lanes catch up to their owner's
        // OWN-authoritative self-report (strong, no lag drift); AI lanes follow the host's
        // authoritative snapshot.
        for (let lane = 0; lane < laneCount; lane++) {
            if (lane === this._playerLaneIndex) {
                continue;
            }
            const swimmer = this.swimmerForLane(lane);
            if (!swimmer?.node?.active) {
                continue;
            }
            const isHuman = this.isNetHumanLane(lane);
            const self = isHuman ? this._netRaceController.selfSnapshot(lane) : null;
            // Resolve a correction target from the best available source: the human's own
            // self-report on the reliable frame channel first, else the host snapshot (S|).
            let targetDist: number;
            let targetLat: number;
            let targetHead: number;
            let targetSpeed: number;
            let targetFinished: boolean;
            let distBlend: number;
            let latBlend: number;
            let headBlend: number;
            if (self) {
                targetDist = self.distance;
                targetLat = self.lateral;
                targetHead = self.heading;
                targetSpeed = self.speed;
                targetFinished = self.finished;
                distBlend = 0.4;
                latBlend = 0.4;
                headBlend = 0.4;
            } else {
                const target = this._netRaceController.snapshotTargets.find((e) => e.lane === lane);
                if (!target) {
                    continue;
                }
                targetDist = target.distance;
                targetLat = target.lateral;
                targetHead = target.heading;
                targetSpeed = target.speed;
                targetFinished = target.finished;
                distBlend = 0.2;
                latBlend = 0.25;
                headBlend = 0.3;
            }
            // Stuck-dive redundancy for remote humans: the owner is clearly moving but this
            // copy isn't racing — its DiveRelease was lost, or its dive stuck mid-tween and
            // never reached racing. Force it straight into the race so it can't stay frozen
            // at the block (which left the host invisible, way behind the friend). Applies
            // regardless of whether the position came from the frame channel or S|. (Only
            // when clearly not a normal in-progress dive: never dived, or dived long enough
            // ago that the ~1.5s dive tween should already be done.)
            if (isHuman && targetDist > NET_DIVE_STUCK_M && !swimmer.isNetRacing) {
                const remote = swimmer.getComponent(RemoteSwimmerController);
                if (remote && (!remote.hasDived || remote.diveElapsed() > NET_DIVE_STUCK_TIMEOUT_MS)) {
                    remote.forceEnterRace(targetDist);
                }
            }
            swimmer.applyNetCorrection(targetDist, targetLat, distBlend, latBlend);
            swimmer.applyNetHeading(targetHead, headBlend);
            // Drive the tread-water<->freestyle pose from the owner's authoritative speed
            // so a corrected-forward copy can't be stuck in the vertical tread pose.
            swimmer.applyNetPoseSpeed(targetSpeed);
            // Finish is host/owner-authoritative: the eased correction never quite reaches
            // the wall, so honour the authoritative finished flag and snap this copy onto
            // the finish line. The local finish path then plays its tread-water pose and
            // freezes it (instead of jittering at the wall with a flickering name tag).
            if (targetFinished) {
                swimmer.applyNetFinish();
            }
            // Outcome-affecting energy uses the same authority as movement: a human's
            // owner reports it on the reliable frame channel; AI follows the host S|
            // snapshot. Apply exactly (rather than once-per-render blending) so the
            // dolphin threshold cannot vary with FPS or a stale best-effort packet.
            if (isHuman) {
                if (self && self.energy >= 0) {
                    swimmer.applyNetEnergy(self.energy, 1);
                }
            } else {
                const hostTarget = this._netRaceController.snapshotTargets.find((e) => e.lane === lane);
                if (hostTarget && hostTarget.energy >= 0) {
                    swimmer.applyNetEnergy(hostTarget.energy, 1);
                }
            }
        }
    }

    // True if a lane is occupied by a HUMAN (local player or a remote human), whose
    // position is own-authoritative (self-report), vs an AI lane (host-authoritative).
    private isNetHumanLane(lane: number): boolean {
        if (lane === this._playerLaneIndex) {
            return true;
        }
        if (!this._netLanePlan) {
            return false;
        }
        return this._netLanePlan.remotes.some((r) => r.lane === lane);
    }

    // The local player's own authoritative position for the frame, or null when it isn't
    // meaningful yet (not racing/gliding, or single-player). Ridden along on the reliable
    // lock-step frame so peers catch its remote copy up to how we actually see it.
    private buildLocalSelfSnapshot(): NetSnapshotEntry | null {
        if (!this._netSession || !this._netRaceController) {
            return null;
        }
        if (this._state !== GameState.RACING && this._state !== GameState.GLIDING) {
            return null;
        }
        const player = this._playerSwimmer;
        if (!player?.node?.active) {
            return null;
        }
        return {
            lane: this._playerLaneIndex,
            distance: player.distance,
            lateral: player.netLateralOffset,
            finished: player.distance >= getRaceDistance(),
            heading: player.netHeading,
            speed: player.netSpeed,
            energy: player.ultimate.energy,
        };
    }

    // Per-lane local-vs-host distance diagnostic for the net HUD. '*' marks the local
    // player's lane. On the client it shows both the local distance and the host's
    // authoritative distance (so we can see if a lane — e.g. our own on the host —
    // fails to advance, or if snapshots aren't arriving).
    private buildNetDiag(): string {
        if (!this._netRaceController) {
            return '';
        }
        const isHost = this._netRaceController.isHost;
        const hostByLane: Record<number, number> = {};
        for (const t of this._netRaceController.snapshotTargets) {
            hostByLane[t.lane] = t.distance;
        }
        const lines: string[] = [];
        for (let lane = 0; lane < LANE_LAYOUT.laneCount; lane++) {
            const swimmer = this.swimmerForLane(lane);
            if (!swimmer?.node?.active) {
                continue;
            }
            const mark = lane === this._playerLaneIndex ? '*' : ' ';
            const local = swimmer.distance.toFixed(1);
            if (isHost) {
                lines.push(`${mark}道${lane} 本地${local}`);
            } else {
                const host = hostByLane[lane];
                lines.push(`${mark}道${lane} 本地${local} 房主${host !== undefined ? host.toFixed(1) : '?'}`);
            }
        }
        return lines.join('\n');
    }

    // Rebuild the AI difficulty panel rows from the current roster. Lane index is
    // reconstructed from the AI array order (AI lanes are pushed in ascending lane
    // order, skipping the player lane).
    private refreshAiDifficultyPanel() {
        const entries = this._aiControllers.map((controller, i) => ({
            lane: i < this._playerLaneIndex ? i : i + 1,
            name: this._aiSwimmers[i]?.swimmerName ?? 'AI',
            difficulty: controller.difficulty,
        }));
        this._aiDifficultyPanel.populate(entries);
    }

    private refreshSwimmerNameRoster() {
        const swimmers = [this._playerSwimmer, ...this._aiSwimmers]
            .filter((swimmer): swimmer is Swimmer => Boolean(swimmer?.node?.isValid));
        this._swimmerNameOverlay.setSwimmers(swimmers, this._playerSwimmer);
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
            name: swimmer.swimmerName,
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

        const raceUiBuilder = new SpeedStarsUiPrefabBuilder({
            onStroke: (type) => this._inputRouter?.handleScreenStroke(type),
            onStrokeEnd: (type) => this._inputRouter?.handleScreenStrokeEnd(type),
            onDiveHoldStart: () => this._gameFlow?.handleDiveChargeStart(),
            onDiveHoldEnd: (holdSeconds) => this._gameFlow?.handleDiveRelease(holdSeconds),
            onRestart: () => this.restartGame(),
            onMenu: () => this.returnToLogin(),
        });
        this._raceUiBuilder = raceUiBuilder;
        raceUiBuilder.build(uiRoot, w, h, (error, refs) => {
            if (error || !refs) {
                done(error ?? new Error('SpeedStars UI prefab build failed'));
                return;
            }

            this._raceHud = refs.raceHud;
            this.applyRoomModeHud(this._raceHud);
            this.buildLaneLockdownStatus(this._raceHud, w, h);
            this.buildEliminationSpectatorUi(this._raceHud, w, h);
            this._cameraSpeedLines.bind(this._raceHud);
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
            this._swimmerNameOverlay.bind(this._raceHud);
            this.refreshSwimmerNameRoster();
            this._finishRankOverlay.bind(this._raceHud, visibleSize.width, visibleSize.height, () => this.returnToLogin());
            this._preRaceIntroPanel.build(this._raceHud, visibleSize.width, visibleSize.height);
            this.buildAiDebugCameraButton(this._raceHud, visibleSize.width, visibleSize.height);
            // Networked race: an overhead whole-field toggle to compare AI positions
            // across clients.
            if (this._netSession) {
                this.buildFieldOverviewButton(this._raceHud, visibleSize.width, visibleSize.height);
            }
            const modelDebugHud = new ModelDebugHudBuilder({
                onExit: () => this.exitModelDebug(true),
                onSlow: () => this.slowModelDebugMotion(),
                onFast: () => this.speedUpModelDebugMotion(),
                onSwitchModel: () => this.switchModelDebugVariant(),
                onSwitchAction: () => this.switchModelDebugAction(),
                onPlayFlipTurn: () => this._modelDebugFlow?.triggerFlipTurn(),
                onSwitchTexture: () => this.switchModelDebugTexture(),
                onSwitchSkybox: () => this.switchModelDebugSkybox(),
            }).build(uiRoot, w, h);
            this._modelDebugHud = modelDebugHud.root;
            this._modelDebugSpeedLabel = modelDebugHud.speedLabel;
            this._modelDebugRatingLabel = modelDebugHud.ratingLabel;
            this._modelDebugSwimSpeedLabel = modelDebugHud.swimSpeedLabel;
            this._modelDebugModelLabel = modelDebugHud.modelLabel;
            this._modelDebugActionLabel = modelDebugHud.actionLabel;
            this._modelDebugFlipTurnButton = modelDebugHud.flipTurnButton;
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

    private buildLaneLockdownStatus(raceHud: Node, width: number, height: number) {
        if (!getRaceDifficultyConfig().laneLockdownEnabled) {
            return;
        }
        const labelNode = makeLabel('LaneLockdownStatus', raceHud, '', 22, new Color(185, 230, 242, 255));
        labelNode.setPosition(0, height * 0.5 - 120, 0);
        labelNode.getComponent(UITransform)?.setContentSize(Math.min(width - 40, 560), 44);
        labelNode.active = false;
        const label = labelNode.getComponent(Label);
        this._laneLockdownStatusLabel = label;
    }

    private buildEliminationSpectatorUi(raceHud: Node, width: number, height: number) {
        const dialog = makeUiNode('EliminationDialog', raceHud);
        dialog.getComponent(UITransform)?.setContentSize(width, height);
        makeRect('Shade', dialog, width, height, new Color(5, 14, 26, 188));
        const panel = makeRect('Panel', dialog, 470, 242, new Color(19, 42, 66, 248));
        const title = makeLabel('Title', panel, '你已被淘汰', 30, new Color(255, 244, 188, 255));
        title.setPosition(0, 70, 0);
        const detail = makeLabel('Detail', panel, '本局仍在进行，选择接下来的观看方式', 18, new Color(220, 236, 248, 255));
        detail.setPosition(0, 28, 0);
        const exitButton = makeButton('ExitRace', panel, 170, 52, new Color(61, 81, 99, 255), '退出游戏');
        exitButton.setPosition(-96, -64, 0);
        exitButton.on(Button.EventType.CLICK, this.returnToLogin, this);
        const spectateButton = makeButton('SpectateRace', panel, 170, 52, new Color(26, 131, 170, 255), '观战');
        spectateButton.setPosition(96, -64, 0);
        spectateButton.on(Button.EventType.CLICK, this.startSpectating, this);
        dialog.active = false;
        this._eliminationDialog = dialog;

        const spectatorHud = makeUiNode('SpectatorHud', raceHud);
        spectatorHud.getComponent(UITransform)?.setContentSize(width, height);
        const targetLabelNode = makeLabel('SpectatorTarget', spectatorHud, '', 20, new Color(220, 244, 255, 255));
        targetLabelNode.setPosition(0, height * 0.5 - 170, 0);
        this._spectatorTargetLabel = targetLabelNode.getComponent(Label);
        const switchButton = makeButton('SwitchSpectatorTarget', spectatorHud, 180, 48, new Color(26, 131, 170, 245), '切换观战目标');
        switchButton.setPosition(width * 0.5 - 120, -height * 0.5 + 100, 0);
        switchButton.on(Button.EventType.CLICK, this.cycleSpectatorTarget, this);
        spectatorHud.active = false;
        this._spectatorHud = spectatorHud;
    }

    private handleSwimmerEliminated(swimmer: Swimmer) {
        if (swimmer === this._spectatorTarget) {
            this.selectSpectatorTarget(false);
        }
        if (swimmer !== this._playerSwimmer) {
            return;
        }
        if (this._eliminationDialog) {
            this._eliminationDialog.active = true;
        }
        if (this._spectatorHud) {
            this._spectatorHud.active = false;
        }
    }

    private startSpectating() {
        if (this._eliminationDialog) {
            this._eliminationDialog.active = false;
        }
        this._spectating = true;
        if (this._spectatorHud) {
            this._spectatorHud.active = true;
        }
        this.selectSpectatorTarget(true);
    }

    private cycleSpectatorTarget() {
        this.selectSpectatorTarget(false);
    }

    private selectSpectatorTarget(randomize: boolean) {
        const candidates = this._aiSwimmers.filter((swimmer) => swimmer?.node?.active);
        if (candidates.length <= 0) {
            this._spectating = false;
            this._spectatorTarget = null;
            if (this._spectatorHud) {
                this._spectatorHud.active = false;
            }
            this._raceCameraDirector.stopSpectatorFreeLook();
            return;
        }
        const currentIndex = candidates.indexOf(this._spectatorTarget);
        const index = randomize
            ? Math.floor(Math.random() * candidates.length)
            : (currentIndex + 1 + candidates.length) % candidates.length;
        this._spectatorTarget = candidates[index];
        this._spectatorTarget.node.getWorldPosition(this._tmpSpectatorTarget);
        this._raceCameraDirector.startSpectatorFreeLook(this._tmpSpectatorTarget, this._spectatorTarget.raceDirection);
        if (this._spectatorTargetLabel) {
            this._spectatorTargetLabel.string = `观战：${this._spectatorTarget.swimmerName}`;
        }
    }

    private updateSpectatorCameraTarget() {
        if (!this._spectating) {
            return;
        }
        if (!this._spectatorTarget?.node?.active) {
            this.selectSpectatorTarget(false);
            return;
        }
        this._spectatorTarget.node.getWorldPosition(this._tmpSpectatorTarget);
        this._raceCameraDirector.updateSpectatorFreeLookTarget(this._tmpSpectatorTarget, this._spectatorTarget.raceDirection);
    }

    private hideEliminationAndSpectatorUi() {
        if (this._eliminationDialog) {
            this._eliminationDialog.active = false;
        }
        if (this._spectatorHud) {
            this._spectatorHud.active = false;
        }
        this._spectating = false;
        this._spectatorTarget = null;
        this._raceCameraDirector.stopSpectatorFreeLook();
    }

    private registerEvents() {
        this._inputRouter?.bind();
        this._gameFlow?.bindRaceManagerCallbacks();
    }

    private handlePlayerStroke(type: StrokeType) {
        this._gameFlow?.handlePlayerStroke(type);
    }

    private handlePlayerStrokeHeld(type: StrokeType, held: boolean, preHeldSeconds = 0): boolean {
        return this._gameFlow?.handlePlayerStrokeHeld(type, held, preHeldSeconds) ?? false;
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
        const ultimate = this._playerSwimmer?.ultimate;
        if (ultimate) {
            this._uiFlow?.updateUltimateEnergyBar(ultimate.energy, ultimate.canAffordDolphin);
            if (ultimate.consumeDeniedFlash()) {
                this._uiFlow?.flashUltimateEnergyDenied();
            }
        }
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
        const wasSprint = this._playerCondition.phase === RacePhase.SPRINT;
        this._playerCondition.setPhase(phase);
        for (const aiCondition of this._aiConditions) {
            aiCondition.setPhase(phase);
        }
        this._raceContext.setPhase(phase);
        if (wasSprint && phase !== RacePhase.SPRINT) {
            this._uiFlow?.setSprintActive(false);
        }
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
        this.debug(`race camera=${modeName}`);
    }

    // AI-debug-only camera target button. It is built with the race HUD but stays
    // hidden in every regular game mode.
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

    // Networked debug: an overhead whole-field camera toggle so the player can compare
    // every swimmer's position against the other client (verifying AI sync).
    private buildFieldOverviewButton(raceHud: Node, width: number, height: number) {
        const button = makeButton(
            'FieldOverviewButton',
            raceHud,
            190,
            56,
            new Color(52, 120, 96, 235),
            '俯视全场',
        );
        button.setPosition(width / 2 - 115, -height / 2 + 210, 0);
        button.setSiblingIndex(raceHud.children.length - 1);
        this._fieldOverviewButtonLabel = button.getChildByName('Label')?.getComponent(Label) ?? null;
        button.on(Node.EventType.TOUCH_END, () => {
            const active = this._raceCameraDirector.toggleFieldOverview();
            if (this._fieldOverviewButtonLabel) {
                this._fieldOverviewButtonLabel.string = active ? '退出俯视' : '俯视全场';
            }
        });
    }

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
        positionDials = true,
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
        if (positionDials) {
            leftBar.setAnchorPosition(cx - spread, cy);
            rightBar.setAnchorPosition(cx + spread, cy);
            leftBar.setScale(scale);
            rightBar.setScale(scale);
        }
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

    // Project a distant point along the swimmer's actual travel direction. This
    // is the lane's visual vanishing point for the current camera composition,
    // so screen-space speed lines converge with the scene instead of HUD centre.
    private updateSpeedLineVanishingPoint() {
        if (!this._cameraSpeedLines.consumeVanishingPointRefresh()) {
            return;
        }
        const swimmer = this._playerSwimmer;
        const worldCamera = this._cameraNode?.getComponent(Camera);
        const hudTransform = this._raceHud?.getComponent(UITransform);
        if (!swimmer?.node?.isValid || !worldCamera || !this._uiCamera || !hudTransform) {
            return;
        }
        const heading = swimmer.cameraHeading;
        // Include the airborne flight pitch so the vanishing point (and thus the
        // speed-line convergence) tilts UP on the climb and DOWN on the fall,
        // instead of always pointing along the flat water line.
        const pitch = swimmer.flightPitch;
        const cosP = Math.cos(pitch);
        const sinP = Math.sin(pitch);
        const baseY = swimmer.isDolphinAirActive ? swimmer.node.worldPosition.y : swimmer.swimWorldY;
        this._tmpSpeedLineVanishWorld.set(swimmer.node.worldPosition);
        this._tmpSpeedLineVanishWorld.x += swimmer.raceDirection * Math.cos(heading) * cosP * 32;
        this._tmpSpeedLineVanishWorld.z += Math.sin(heading) * cosP * 32;
        this._tmpSpeedLineVanishWorld.y = baseY + sinP * 32;
        worldCamera.worldToScreen(this._tmpSpeedLineVanishWorld, this._tmpDialScreen);
        this._uiCamera.screenToWorld(this._tmpDialScreen, this._tmpSpeedLineVanishWorld);
        hudTransform.convertToNodeSpaceAR(this._tmpSpeedLineVanishWorld, this._tmpDialAnchorUi);
        this._cameraSpeedLines.setVanishingPoint(this._tmpDialAnchorUi.x, this._tmpDialAnchorUi.y);
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
        if (this._aiDebugCameraButtonLabel?.isValid) {
            this._aiDebugCameraButtonLabel.string = this._cameraFollowsAi ? '跟随玩家' : '跟随AI';
        }
        this.debug(`camera follow=${this._cameraFollowsAi ? 'AI' : 'player'}`);
    }

    private enterModelDebug(initialActionId = 'freestyle') {
        this._modelDebugFlow?.enter(initialActionId);
    }

    private exitModelDebug(showStart: boolean) {
        if (this._underwaterDebugActive) {
            this._underwaterDebugActive = false;
            this.returnToLogin();
            return;
        }
        this._modelDebugFlow?.exit(showStart);
    }

    // Enter the underwater-effect tuning scene: hide the AI, keep the player, force
    // the underwater render path, and show the tuning HUD (its '水色' sliders +
    // exit button). The player is then driven manually in updateUnderwaterDebug.
    private enterUnderwaterDebug() {
        this._underwaterDebugActive = true;
        this._state = GameState.READY;
        const player = this._playerSwimmer;
        if (!player) {
            return;
        }
        for (const ai of this._aiSwimmers) {
            if (ai.node?.active) {
                ai.node.active = false;
            }
        }
        // Take the player out of the race sim; its pose/position are driven here.
        player.netFixedStep = true;
        player.node.active = true;
        player.cartoonRig?.setActiveSwimming(true);
        player.cartoonRig?.setLegSplashSuppressed(true);
        this._uwLapDistance = Math.min(2, COURSE_LAYOUT.courseLength * 0.1);
        this._uwLapDir = 1;
        this._uwKickPhase = 0;
        this._uwBodyPhase = 0;
        this._uwYaw = Math.PI * 0.82;
        this._uwPitch = -0.08;
        this._uwDistance = 5.5;
        this._uwCameraDragging = false;
        // Force the underwater render path (blue floor swap + surface mirror) and
        // keep the flat veil box off.
        this._waterRefraction?.setUnderwaterViewActive(true);
        this.setUnderwaterOverlayVisible(false);
        // Reuse the model-debug tuning HUD for the '水色' sliders + exit button.
        this._uiFlow?.showModelDebugHud();
        this.debug('enterUnderwaterDebug');
    }

    // Drive the underwater tuning scene each frame: lap the player back and forth
    // below the surface with a continuous flutter kick, and follow with an
    // underwater chase camera looking up toward the surface mirror.
    private updateUnderwaterDebug(dt: number) {
        const player = this._playerSwimmer;
        if (!player) {
            return;
        }
        for (const ai of this._aiSwimmers) {
            if (ai.node?.active) {
                ai.node.active = false;
            }
        }
        const length = COURSE_LAYOUT.courseLength;
        this._uwLapDistance += this._uwLapDir * UNDERWATER_DEBUG_SPEED * dt;
        if (this._uwLapDistance >= length) {
            this._uwLapDistance = length;
            this._uwLapDir = -1;
        } else if (this._uwLapDistance <= 0) {
            this._uwLapDistance = 0;
            this._uwLapDir = 1;
        }
        const dirSign = this._uwLapDir > 0 ? 1 : -1;
        const worldX = COURSE_LAYOUT.distanceToWorldX(this._uwLapDistance);
        const swimY = COURSE_LAYOUT.swimY;
        const bodyY = swimY - UNDERWATER_DEBUG_DEPTH;
        player.node.setPosition(worldX, bodyY, PLAYER_LANE_Z);
        player.node.setRotationFromEuler(0, dirSign > 0 ? 0 : 180, 0);
        // Continuous underwater flutter kick (arms held in streamline = 0 cycles).
        this._uwKickPhase += dt * UNDERWATER_DEBUG_KICK_RATE;
        this._uwBodyPhase += dt * UNDERWATER_DEBUG_BODY_RATE;
        player.cartoonRig?.updateFreestyle(
            dt,
            0,
            0,
            this._uwKickPhase,
            this._uwKickPhase + Math.PI,
            this._uwBodyPhase,
            UNDERWATER_DEBUG_SPEED,
            dirSign,
        );
        // The debug swimmer is always submerged, so keep the bubble trail on.
        this._playerSwimmer?.cartoonRig?.updateUnderwaterBubbles(true);
        // Free-look orbit around the swimmer: the camera follows the lapping
        // swimmer while the user drags to rotate and wheels/pinches to zoom.
        this._uwCamTarget.set(worldX, bodyY + 0.25, PLAYER_LANE_Z);
        const cosPitch = Math.cos(this._uwPitch);
        this._uwCamPos.set(
            this._uwCamTarget.x + Math.cos(this._uwYaw) * cosPitch * this._uwDistance,
            this._uwCamTarget.y + Math.sin(this._uwPitch) * this._uwDistance,
            this._uwCamTarget.z + Math.sin(this._uwYaw) * cosPitch * this._uwDistance,
        );
        const camNode = this._cameraNode;
        if (camNode?.isValid) {
            camNode.setWorldPosition(this._uwCamPos);
            camNode.lookAt(this._uwCamTarget);
        }
        // Follow the actual camera height: below the surface = underwater look
        // (mirror + blue floor gradient); orbit above the surface = above-water
        // look (deck + the above-water distance gradient), so both can be seen and
        // tuned in this scene.
        this._waterRefraction?.setUnderwaterViewActive(this._uwCamPos.y < COURSE_LAYOUT.waterY);
    }

    private onDebugCameraMouseDown(event: EventMouse) {
        if (this._underwaterDebugActive) {
            const button = event.getButton();
            this._uwCameraDragging = button === EventMouse.BUTTON_LEFT
                || button === EventMouse.BUTTON_RIGHT
                || button === EventMouse.BUTTON_MIDDLE;
            return;
        }
        if (this._modelDebugFlow?.active) {
            this._modelDebugFlow.onMouseDown(event);
            return;
        }
        if (this._raceCameraDirector.isFreeLookActive()) {
            const button = event.getButton();
            this._awardsCameraDragging = button === EventMouse.BUTTON_LEFT
                || button === EventMouse.BUTTON_RIGHT
                || button === EventMouse.BUTTON_MIDDLE;
        }
    }

    private onDebugCameraMouseMove(event: EventMouse) {
        if (this._underwaterDebugActive) {
            if (this._uwCameraDragging) {
                this.orbitUnderwaterCamera(event.getDeltaX(), event.getDeltaY());
            }
            return;
        }
        if (this._modelDebugFlow?.active) {
            this._modelDebugFlow.onMouseMove(event);
            return;
        }
        if (this._awardsCameraDragging && this._raceCameraDirector.isFreeLookActive()) {
            this.orbitFreeLookCamera(event.getDeltaX(), event.getDeltaY());
        }
    }

    private onDebugCameraMouseUp() {
        if (this._underwaterDebugActive) {
            this._uwCameraDragging = false;
            return;
        }
        if (this._modelDebugFlow?.active) {
            this._modelDebugFlow.onMouseUp();
            return;
        }
        this._awardsCameraDragging = false;
    }

    private onDebugCameraWheel(event: EventMouse) {
        if (this._underwaterDebugActive) {
            this.zoomUnderwaterCamera(event.getScrollY());
            return;
        }
        if (this._modelDebugFlow?.active) {
            this._modelDebugFlow.onMouseWheel(event);
            return;
        }
        if (this._raceCameraDirector.isFreeLookActive()) {
            this.zoomFreeLookCamera(event.getScrollY());
        }
    }

    // Touch orbit / pinch-zoom for the active free-look camera (mobile).
    private onAwardsCameraOrbit(deltaX: number, deltaY: number) {
        if (this._underwaterDebugActive) {
            this.orbitUnderwaterCamera(deltaX, deltaY);
            return;
        }
        if (this._modelDebugFlow?.active) {
            return;
        }
        if (this._raceCameraDirector.isFreeLookActive()) {
            this.orbitFreeLookCamera(deltaX, deltaY);
        }
    }

    private onAwardsCameraZoom(scroll: number) {
        if (this._underwaterDebugActive) {
            this.zoomUnderwaterCamera(scroll);
            return;
        }
        if (this._modelDebugFlow?.active) {
            return;
        }
        if (this._raceCameraDirector.isFreeLookActive()) {
            this.zoomFreeLookCamera(scroll);
        }
    }

    private orbitFreeLookCamera(deltaX: number, deltaY: number) {
        if (this._raceCameraDirector.spectatorFreeLookActive) {
            this._raceCameraDirector.orbitSpectatorCamera(deltaX, deltaY);
        } else {
            this._raceCameraDirector.orbitAwardsCamera(deltaX, deltaY);
        }
    }

    private zoomFreeLookCamera(scroll: number) {
        if (this._raceCameraDirector.spectatorFreeLookActive) {
            this._raceCameraDirector.zoomSpectatorCamera(scroll);
        } else {
            this._raceCameraDirector.zoomAwardsCamera(scroll);
        }
    }

    // Free-look orbit controls for the underwater tuning scene (drag + wheel/pinch).
    private orbitUnderwaterCamera(deltaX: number, deltaY: number) {
        this._uwYaw -= deltaX * 0.008;
        this._uwPitch += deltaY * 0.006;
        this._uwPitch = Math.max(-1.4, Math.min(1.4, this._uwPitch));
    }

    private zoomUnderwaterCamera(scroll: number) {
        this._uwDistance = Math.max(2, Math.min(25, this._uwDistance - scroll * 0.004));
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
        this._waterRefraction?.setUnderwaterViewActive(visible);
        // The old full-screen blue box (UnderwaterCameraTint3D) is a UNIFORM tint
        // with no distance falloff — it reads as a dirty gauze/veil over the whole
        // underwater view. The submerged blue now comes from distance fog + the
        // blue pool floor + the surface mirror, so keep this overlay OFF. The node
        // is kept (not destroyed) so it can be re-enabled if fog is unavailable.
        if (this._underwaterCameraTint && this._underwaterCameraTint.active) {
            this._underwaterCameraTint.active = false;
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
        // The timing guide is an AI-tuning aid. Production races still pass through
        // this method every frame, so return before touching transforms/colors when
        // the debug presentation is disabled.
        if (!active) {
            if (this._timingGuideMarker?.active) {
                this._timingGuideMarker.active = false;
            }
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

// Depth-first search for a descendant node by name (Node.getChildByName is direct
// children only).
function findByName(root: Node, name: string): Node | null {
    if (root.name === name) {
        return root;
    }
    for (const child of root.children) {
        const found = findByName(child, name);
        if (found) {
            return found;
        }
    }
    return null;
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
