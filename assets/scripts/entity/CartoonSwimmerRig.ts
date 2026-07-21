import { _decorator, AnimationClip, Color, Component, EffectAsset, instantiate, Material, Node, Quat, SkeletalAnimation, SkinnedMeshRenderer, Texture2D, Vec3 } from 'cc';
import { CharacterAnimationPlayer } from '../character/CharacterAnimationPlayer';
import { sampledActionIdFor } from '../character/CharacterActionConfig';
import type { CharacterAction } from '../character/CharacterActionConfig';
import { CHARACTER_POSE_TUNING } from '../character/CharacterMotionTuning';
import { CharacterPoseStateController } from '../character/CharacterPoseStateController';
import { CharacterRig } from '../character/CharacterRig';
import { applyCharacterSkin, CharacterSkinOutfit } from '../character/CharacterSkinApplier';
import { configureSwimmerSkinnedRenderers, findComponentRecursive, findNode, loadSwimmerPrefab, pruneNullComponentsInParentChain, pruneNullComponentsRecursive, setLayerRecursive } from '../character/CharacterModelLoader';
import { FreestylePoseController, ProceduralPoseSnapshot } from '../character/FreestylePoseController';
import { FLIP_TURN_KEYFRAME_1, FLIP_TURN_KEYFRAME_2 } from '../character/FlipTurnPoseCurve';
import { findSampledDebugAction } from '../character/SampledActionMotionCurve';
import type { SampledActionId } from '../character/SampledActionMotionCurve';
import { SplashEmitter } from '../character/SplashEmitter';
import { SWIMMER_BALANCE } from '../core/GameBalance';
import { StrokeType } from '../core/GameConstants';
import { MOTION_TUNING } from '../core/InputTuning';
import { PERFORMANCE_CONFIG } from '../core/PerformanceConfig';
import { loadRaceAsset, loadRaceAssetDir } from '../core/RaceBundleLoader';
import { defaultSwimmer0621ColorVariant, defaultSwimmerModelVariant, findSwimmer0621ColorVariant, findSwimmerModelVariant, isDebugOnlySwimmerModelVariant, RESOURCE_PATHS } from '../core/ResourcePaths';
import type { DebugSwimmerActionPose } from '../core/ResourcePaths';
import type { SwimmerMotor } from '../swimmer/SwimmerMotor';

const { ccclass } = _decorator;

// Spreads background-AI pose updates across frames so throttled swimmers don't all recompute their
// skeleton on the same frame (avoids a periodic per-frame spike). Incremented once per AI rig.
// 让背景 AI 的姿态更新错峰分布到不同帧，避免降频选手在同一帧集中重算骨骼（消除周期性的单帧尖峰）。每个 AI rig 自增一次。
let _backgroundMotionPhaseSeed = 0;

const MIXAMO_SWIMMING_CLIP_PATHS = [
    'models/UserSwimmer0621_2MixamoSwimming/Swimming',
    'models/UserSwimmer0621_2MixamoSwimming/Swimming.004',
    'models/UserSwimmer0621_2MixamoSwimming/Armature|mixamo.com|Layer0',
];

export type RaceFlipTurnUpdate = {
    approachTimeRatio: number;
    returnTimeRatio: number;
    keyframe2Reached: boolean;
    complete: boolean;
};

type FlashRestoreSlot = {
    renderer: SkinnedMeshRenderer;
    index: number;
    material: Material;
};

// Reuse the body-material flash to also show red on a swimmer-vs-swimmer
// collision. The flash intensity decays back to zero (or to the steady yellow
// perfect-zone glow if that is active) over COLLISION_FLASH_SECONDS.
const COLLISION_FLASH_SECONDS = 0.35;
const COLLISION_FLASH_COLOR = new Color(255, 48, 48, 255);
const PERFECT_GLOW_COLOR = new Color(255, 198, 38, 255);

@ccclass('CartoonSwimmerRig')
export class CartoonSwimmerRig extends Component implements CharacterRig {
    public root: Node = null;
    public splashNode: Node = null;

    private _model: Node = null;
    private _splashEmitter: SplashEmitter = null;
    private readonly _pose = new FreestylePoseController();
    private readonly _animationPlayer = new CharacterAnimationPlayer();
    private readonly _poseState = new CharacterPoseStateController({
        pose: this._pose,
        getModel: () => this._model,
        getRoot: () => this.root,
        getSelfTime: () => this._selfTime,
        updateSplashSurface: (speed) => this.updateSplashSurface(speed),
        setSplashVisible: (visible) => this._splashEmitter?.setVisible(visible),
        raceModelYOffset: () => this.raceModelYOffset(),
        raceModelEulerDegrees: () => this.raceModelEulerDegrees(),
    });
    private _skinnedRenderers: SkinnedMeshRenderer[] = [];
    private _outlineRoot: Node = null;
    private _loaded = false;
    private _armAction = 0;
    private _kickAction = 0;
    private _armCycleMotion = 0;
    private _leftHandWaterContact = 0;
    private _rightHandWaterContact = 0;
    private _leftHandWaterEntry = 0;
    private _rightHandWaterEntry = 0;
    private _leftHandWaterProgress = 0;
    private _rightHandWaterProgress = 0;
    private _splashMovementDirection = 1;
    private _splashMovementHeadingRadians = 0;
    private _legSplashSuppressed = false;
    private _lastArmCycle = 0;
    private _hasLastArmCycle = false;
    private _kickCycleMotion = 0;
    private _lastKickCycle = 0;
    private _hasLastKickCycle = false;
    private _treadWaterWeight = 0;
    private _treadWaterPhase = 0;
    private _treadExitHold = 0;
    private _selfTime = 0;
    private _modelDebugMode = false;
    private _debugMotionSpeedScale = 1;
    private _skinColor = new Color(246, 176, 118);
    private _suitColor = new Color(245, 42, 64);
    private _capColor = new Color(255, 220, 72);
    private _robotStyle = false;
    private _playerOutline = false;
    private _skinOutfit: CharacterSkinOutfit = 'default';
    private _perfectGlowIntensity = 0;
    private _bodyFeedbackEnabled = true;
    private _perfectGlowMaterial: Material = null;
    private readonly _perfectGlowRestoreSlots: FlashRestoreSlot[] = [];
    private _collisionFlashTimer = 0;
    private _modelVariantId = defaultSwimmerModelVariant().id;
    private _modelLoadToken = 0;
    private _colorVariantId = defaultSwimmer0621ColorVariant().id;
    private _colorMask: Texture2D = null;
    private _dynamicColorEffect: EffectAsset = null;
    private _colorAssetLoadToken = 0;
    private _waterY = CHARACTER_POSE_TUNING.splashWaterY;
    private _debugActionPose: DebugSwimmerActionPose = 'freestyle';
    private _debugSampledActionId: SampledActionId | null = null;
    private _flipTurnSwimPose: ProceduralPoseSnapshot | null = null;
    private _flipTurnExitSwimPose: ProceduralPoseSnapshot | null = null;
    private _flipTurnKeyframe1Pose: ProceduralPoseSnapshot | null = null;
    private _flipTurnKeyframe2Pose: ProceduralPoseSnapshot | null = null;
    private _debugFlipTurnPlaying = false;
    private _debugFlipTurnElapsed = 0;
    private _debugFlipTurnAccumulatedDegrees = 0;
    private _debugFlipTurnStartDegrees = 0;
    private _debugFlipTurnAccumulatedAxisDegrees = 0;
    private _debugFlipTurnStartAxisDegrees = 0;
    private _debugFlipTurnRotationDeltaDegrees = -180;
    private _raceFlipTurnActive = false;
    private readonly _flipTurnModelBasePosition = new Vec3();
    private readonly _flipTurnModelBaseRotation = new Quat();
    private readonly _flipTurnWaistPivot = new Vec3();
    private readonly _tmpFlipTurnWorldPivot = new Vec3();
    private readonly _tmpFlipTurnOffset = new Vec3();
    private readonly _tmpFlipTurnTransferPosition = new Vec3();
    private readonly _tmpFlipTurnRotation = new Quat();
    private readonly _tmpFlipTurnAxisRotation = new Quat();
    private readonly _tmpFlipTurnCombinedRotation = new Quat();
    private readonly _tmpFlipTurnModelRotation = new Quat();
    private readonly _tmpFlipTurnContactLocal = new Vec3();
    private readonly _tmpFlipTurnContactWorld = [new Vec3(), new Vec3(), new Vec3(), new Vec3()];
    private readonly _tmpSplashWorld = new Vec3();
    private readonly _tmpSplashHeadWorld = new Vec3();
    private readonly _tmpSplashHandWorld = new Vec3();

    // Background AI motion throttling: reduce how often the heavy procedural pose is recomputed.
    // Stride is set per-frame by GameManager based on distance to the player (distance-based LOD).
    // 背景 AI 动作降频：降低昂贵程序化姿态的重算频率。stride 由 GameManager 每帧按到玩家的距离设置（距离分级 LOD）。
    private _backgroundSwimmer = false;
    private _splashCulled = false;
    private _motionThrottleStride = 1;
    private _motionThrottleCountdown = 0;
    private _motionThrottleAccumDt = 0;

    build(skinColor: Color, suitColor: Color, capColor: Color, robotStyle = false, playerOutline = false, reducedSplash = false) {
        if (this._loaded || this._model) {
            return;
        }
        this.storeSkinSettings(skinColor, suitColor, capColor, robotStyle, playerOutline);

        this._backgroundSwimmer = reducedSplash;
        this._motionThrottleStride = 1;
        // Stagger the initial countdown so AI swimmers don't all recompute pose on the same frame once
        // GameManager starts assigning distance-based strides.
        // 错开初始倒计时，等 GameManager 开始按距离分配 stride 后，AI 也不会在同一帧集中重算姿态。
        this._motionThrottleCountdown = reducedSplash ? (_backgroundMotionPhaseSeed++ & 3) : 0;
        this._motionThrottleAccumDt = 0;

        this._splashEmitter = new SplashEmitter({
            owner: this.node,
            parent: this.node.parent || this.node,
            name: `${this.node.name || 'Swimmer'}Splash`,
            waterY: this._waterY,
            getBoneWorldPosition: (name, out) => this.getSplashBoneWorldPosition(name, out),
            reduced: reducedSplash,
        });
        this.splashNode = this._splashEmitter.node;
        this._splashEmitter.build();

        this.loadModelForCurrentVariant();
    }

    setModelVariant(variantId: string): boolean {
        const variant = findSwimmerModelVariant(variantId);
        if (!variant) {
            console.warn(`[SpeedSwimming] unknown swimmer model variant=${variantId}`);
            return false;
        }
        if (this._modelVariantId === variant.id && (this._loaded || this._model)) {
            return true;
        }

        this._modelVariantId = variant.id;
        this._colorAssetLoadToken += 1;
        this._colorMask = null;
        this._dynamicColorEffect = null;
        if (variant.dynamicColor) {
            this.loadDynamicColorAssets();
        }
        if (!this._splashEmitter) {
            return true;
        }

        this.clearLoadedModel();
        this.loadModelForCurrentVariant();
        return true;
    }

    get modelVariantId(): string {
        return this._modelVariantId;
    }

    get colorVariantId(): string {
        return this._colorVariantId;
    }

    get usesDebugAnimationClip(): boolean {
        return this.isMixamoSwimmingDebugVariant();
    }

    get usesDebugProceduralPose(): boolean {
        return this.isBreaststrokeDebugPose() || this.isDivePrepDebugPose() || this.isSampledActionDebugPose() || this.isFlipTurnDebugPose();
    }

    get waterY(): number {
        return this._waterY;
    }

    getUpperBodyWorldPosition(out: Vec3): boolean {
        return this._pose.getUpperBodyWorldPosition(out);
    }

    getSwimBoundaryWorldPositions(outputs: Vec3[]): number {
        return this._pose.getSwimBoundaryWorldPositions(outputs);
    }

    setColorVariant(variantId: string): boolean {
        const variant = findSwimmer0621ColorVariant(variantId);
        if (!variant) {
            return false;
        }
        this._colorVariantId = variant.id;
        if (this.supportsDynamicColor()) {
            if (this.hasDynamicColorVariant() && (!this._colorMask || !this._dynamicColorEffect)) {
                this.loadDynamicColorAssets();
            }
            if (this._loaded && this.root) {
                this.applyLaneMaterials(this._skinColor, this._suitColor, this._capColor, this._robotStyle, this._playerOutline);
            }
        }
        return true;
    }

    setDebugActionPose(pose: DebugSwimmerActionPose, sampledActionId?: SampledActionId) {
        const nextSampledActionId = pose === 'sampledAction' ? sampledActionId ?? null : null;
        if (this._debugActionPose === pose && this._debugSampledActionId === nextSampledActionId) {
            return;
        }
        this._debugActionPose = pose;
        this._debugSampledActionId = nextSampledActionId;
        this.resetDebugFlipTurnState();
        if (this._modelDebugMode) {
            this.setModelDebugMode(true);
        }
    }

    triggerDebugFlipTurn(): boolean {
        if (
            !this._loaded
            || !this.isFlipTurnDebugPose()
            || !this._flipTurnSwimPose
            || !this._flipTurnExitSwimPose
            || this._debugFlipTurnPlaying
        ) {
            return false;
        }
        this._debugFlipTurnPlaying = true;
        this._debugFlipTurnElapsed = 0;
        this._debugFlipTurnStartDegrees = this._debugFlipTurnAccumulatedDegrees;
        this._debugFlipTurnStartAxisDegrees = this._debugFlipTurnAccumulatedAxisDegrees;
        // The world-space somersault sign follows the swimmer's head direction.
        // Left-to-right (+X) uses the observed clockwise turn; right-to-left
        // (-X) mirrors it so the athlete still flips forward toward the wall.
        this._debugFlipTurnRotationDeltaDegrees = this._splashMovementDirection >= 0 ? -180 : 180;
        return true;
    }

    get debugFlipTurnPlaying(): boolean {
        return this._debugFlipTurnPlaying;
    }

    startRaceFlipTurn(): number | null {
        if (!this._loaded || !this._model || !this.root || this._modelDebugMode || this._raceFlipTurnActive) {
            return null;
        }
        this._poseState.applyRaceModelSetup();
        this.setupDebugFlipTurn(true);
        const footContactOffset = this.measureFlipTurnFootContactOffset();
        this._debugFlipTurnPlaying = true;
        this._debugFlipTurnElapsed = 0;
        this._debugFlipTurnStartDegrees = 0;
        this._debugFlipTurnStartAxisDegrees = 0;
        // The swimmer node already faces along its incoming lane direction, so
        // the production turn always uses the same local forward-flip sign.
        this._debugFlipTurnRotationDeltaDegrees = -180;
        this._raceFlipTurnActive = true;
        return footContactOffset;
    }

    updateRaceFlipTurn(dt: number): RaceFlipTurnUpdate | null {
        if (!this._raceFlipTurnActive) {
            return null;
        }
        this.updateDebugFlipTurn(dt);
        const keyframe2Time = Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnToKeyframe1Seconds)
            + Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnToKeyframe2Seconds);
        const totalDuration = keyframe2Time + Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnReturnToSwimSeconds);
        return {
            approachTimeRatio: linearRange(this._debugFlipTurnElapsed, 0, keyframe2Time),
            returnTimeRatio: linearRange(this._debugFlipTurnElapsed, keyframe2Time, totalDuration),
            keyframe2Reached: this._debugFlipTurnElapsed >= keyframe2Time,
            complete: !this._debugFlipTurnPlaying,
        };
    }

    finishRaceFlipTurn() {
        if (!this._raceFlipTurnActive) {
            return;
        }
        const swimPose = this._flipTurnExitSwimPose;
        this._poseState.applyRaceModelSetup();
        if (swimPose) {
            this._pose.applyPoseSnapshot(swimPose);
        }
        this._raceFlipTurnActive = false;
        this.resetDebugFlipTurnState();
        this._poseState.enterFreestyle();
        this._splashEmitter?.setVisible(true);
        this.updateSplashSurface(0);
    }

    private loadModelForCurrentVariant() {
        const variant = findSwimmerModelVariant(this._modelVariantId) ?? defaultSwimmerModelVariant();
        this._modelVariantId = variant.id;
        const token = ++this._modelLoadToken;

        loadSwimmerPrefab((err, result) => {
            if (token !== this._modelLoadToken) {
                return;
            }
            if (err || !result?.prefab || !this.node?.isValid) {
                console.error(`[SpeedSwimming] failed to load swimmer prefab variant=${variant.id}`, err);
                return;
            }

            this._model = instantiate(result.prefab);
            this._model.name = 'UserSwimmerModel';
            const prunedComponents = pruneNullComponentsRecursive(this._model);
            if (prunedComponents > 0) {
                console.warn(`[SpeedSwimming] pruned null components from swimmer prefab count=${prunedComponents}`);
            }
            const prunedParents = pruneNullComponentsInParentChain(this.node);
            if (prunedParents > 0) {
                console.warn(`[SpeedSwimming] pruned null components from swimmer parent chain count=${prunedParents}`);
            }
            if (!this.attachModelToSwimmerNode()) {
                this._model.destroy();
                this._model = null;
                return;
            }
            // The water/refraction stack may already have moved the swimmer root
            // onto its dedicated overlay-camera layer before this async model
            // finishes loading. Inherit that layer instead of forcing the new
            // subtree back to DEFAULT, where the main water pass can cover it.
            setLayerRecursive(this._model, this.node.layer);
            this._poseState.applyRaceModelSetup();

            // Imported GLBs wrap their actual armature in a prefab scene root. The
            // original swimmer names that child `Armature`, while other valid rigs
            // (for example the diver) may use a model-specific name. Falling back
            // to the prefab wrapper makes tread water write its pose rotation onto
            // the same node used for upright model placement, so the pose update
            // immediately overwrites the upright rotation. Resolve the armature
            // generically from the parent of the canonical `Root` bone instead.
            const rootBone = findNode(this._model, 'Root');
            this.root = findNode(this._model, 'Armature') || rootBone?.parent || this._model;
            this._pose.bind(this.root);
            this._pose.setSwimHeadLift(this.swimHeadLiftDegrees());
            this.configureSkinnedRenderers();
            this.applyLaneMaterials(this._skinColor, this._suitColor, this._capColor, this._robotStyle, this._playerOutline);
            this._animationPlayer.bind(findComponentRecursive(this._model, SkeletalAnimation), this.isMixamoSwimmingDebugVariant());
            this.ensureMixamoAnimationComponent();
            this._pose.captureBasePose();
            this._loaded = true;
            this.resetPose();
            if (this._modelDebugMode) {
                this.applyModelDebugSetup();
            } else {
                this._poseState.reapplyCurrentState();
            }
            console.log(
                `[SpeedSwimming] loaded athlete variant=${variant.id} prefab=${result.path} joints=${this.boundJointCount} manualBones=${this.manualBoneCount} clips=${this.animationClipNames} ` +
                `skinned=${this._skinnedRenderers.length} rigRoot=${this.root.name} ` +
                `baseEuler=${this._pose.rootBaseEuler.x.toFixed(1)},${this._pose.rootBaseEuler.y.toFixed(1)},${this._pose.rootBaseEuler.z.toFixed(1)}`,
            );
        }, variant.candidates);
    }

    private clearLoadedModel() {
        this.restorePerfectGlowMaterials();
        this._modelLoadToken++;
        this._loaded = false;
        this.root = null;
        this._skinnedRenderers.length = 0;
        this._animationPlayer.disable();
        this._animationPlayer.bind(null);
        this._perfectGlowIntensity = 0;
        this._collisionFlashTimer = 0;
        this._outlineRoot = null;
        if (this._model?.isValid) {
            this._model.destroy();
        }
        this._model = null;
    }

    private attachModelToSwimmerNode(): boolean {
        if (!this._model) {
            return false;
        }
        try {
            this._model.setParent(this.node);
            return true;
        } catch (firstError) {
            console.warn('[SpeedSwimming] retry swimmer model attach after component cleanup', firstError);
            const prunedModel = pruneNullComponentsRecursive(this._model);
            const prunedParents = pruneNullComponentsInParentChain(this.node);
            if (prunedModel + prunedParents > 0) {
                console.warn(`[SpeedSwimming] retry pruned null components model=${prunedModel} parents=${prunedParents}`);
            }
            try {
                this._model.setParent(this.node);
                return true;
            } catch (secondError) {
                console.error('[SpeedSwimming] failed to attach swimmer model prefab', secondError);
                return false;
            }
        }
    }

    setActiveSwimming(active: boolean) {
        if (this._modelDebugMode) {
            return;
        }
        this._animationPlayer.stop();
        if (active) {
            this._poseState.enterFreestyle();
        } else {
            this._poseState.enterPreview();
            this.resetPose();
        }
    }

    setSwimmerColors(skinColor: Color, suitColor: Color, capColor: Color, robotStyle = false, playerOutline = false) {
        this.storeSkinSettings(skinColor, suitColor, capColor, robotStyle, playerOutline);
        if (!this._loaded || !this.root) {
            return;
        }
        this.applyLaneMaterials(skinColor, suitColor, capColor, robotStyle, playerOutline);
    }

    setSkinOutfit(outfit: CharacterSkinOutfit) {
        if (this._skinOutfit === outfit) {
            return;
        }
        this._skinOutfit = outfit;
        this.applyLaneMaterials(this._skinColor, this._suitColor, this._capColor, this._robotStyle, this._playerOutline);
    }

    setWaterY(waterY: number) {
        const changed = this._waterY !== waterY;
        this._waterY = waterY;
        this._splashEmitter?.setWaterY(waterY);
        this.updateSplashSurface(0);
        // Rebind body materials so their world-space waterline tint sits at the
        // real water surface (materials may have been built before the course
        // supplied waterY).
        if (changed && this._loaded && this.root) {
            this.applyLaneMaterials(this._skinColor, this._suitColor, this._capColor, this._robotStyle, this._playerOutline);
        }
    }

    setLegSplashSuppressed(suppressed: boolean) {
        this._legSplashSuppressed = suppressed;
        this.syncSplashState();
    }

    setSplashCulled(culled: boolean) {
        this._splashCulled = culled;
        this._splashEmitter?.setCulled(culled);
    }

    // Set how many frames elapse between procedural-pose rebuilds for this background AI swimmer.
    // GameManager drives this per-frame from distance-based LOD (nearer AI = smaller stride = higher fps).
    // Player swimmers keep stride 1. Clamps the pending countdown so a stride change never stalls or
    // double-updates the pose.
    // 设置该背景 AI 每隔几帧重算一次程序化姿态。GameManager 按距离分级每帧驱动（越近 stride 越小、帧率越高）。
    // 玩家保持 stride 1。切换时夹紧待定倒计时，避免卡顿或重复更新。
    setMotionThrottleStride(stride: number) {
        if (!this._backgroundSwimmer || !PERFORMANCE_CONFIG.motion.aiPoseThrottleEnabled) {
            this._motionThrottleStride = 1;
            return;
        }
        const next = Math.max(1, Math.floor(stride));
        if (next === this._motionThrottleStride) {
            return;
        }
        this._motionThrottleStride = next;
        if (this._motionThrottleCountdown > next - 1) {
            this._motionThrottleCountdown = next - 1;
        }
    }

    setSplashParticlesEnabled(enabled: boolean) {
        this._splashEmitter?.setParticleEffectsEnabled(enabled);
    }

    setDiveReady(active: boolean, transitionSeconds = CHARACTER_POSE_TUNING.defaultPoseTransitionSeconds) {
        if (this._modelDebugMode) {
            return;
        }
        this._animationPlayer.stop();
        if (active) {
            this._poseState.enterDiveReady(transitionSeconds);
        } else {
            this._poseState.enterPreview();
            this.resetPose();
        }
    }

    setShowcaseStanding(transitionSeconds = 0) {
        if (this._modelDebugMode) {
            return;
        }
        this._animationPlayer.stop();
        this._poseState.enterShowcaseStanding(transitionSeconds);
    }

    setShowcaseAction(action: CharacterAction): boolean {
        return this._poseState.setShowcaseAction(sampledActionIdFor(action));
    }

    setFinishFloating() {
        if (this._modelDebugMode) {
            return;
        }
        this._animationPlayer.stop();
        this._poseState.enterTreadWater();
    }

    setDiveStreamlinePose() {
        if (this._modelDebugMode) {
            return;
        }
        this._animationPlayer.stop();
        this._poseState.enterGlide();
    }

    startDiveStreamlineTransition(duration = CHARACTER_POSE_TUNING.diveStreamlineTransitionSeconds) {
        if (this._modelDebugMode) {
            return;
        }
        this._animationPlayer.stop();
        this._poseState.enterDiveFlight(duration);
    }

    triggerArmStroke() {
        this._armAction = 1;
        this._treadExitHold = CHARACTER_POSE_TUNING.raceTreadStrokeExitHoldSeconds;
        this._splashEmitter?.triggerArmStroke();
    }

    triggerKick() {
        this._kickAction = 1;
        this._treadExitHold = CHARACTER_POSE_TUNING.raceTreadStrokeExitHoldSeconds;
        this._splashEmitter?.triggerKick();
    }

    triggerStroke(_type: StrokeType) {
        this._armAction = 1;
        this._kickAction = 1;
        this._treadExitHold = CHARACTER_POSE_TUNING.raceTreadStrokeExitHoldSeconds;
        this._splashEmitter?.triggerArmStroke();
        this._splashEmitter?.triggerKick();
    }

    setStrokeHeld(_type: StrokeType, _held: boolean) {
        if (_held) {
            this._treadExitHold = CHARACTER_POSE_TUNING.raceTreadStrokeExitHoldSeconds;
        }
    }

    updateFreestyleFromMotor(dt: number, motor: SwimmerMotor, movementDirection = 1) {
        const useDt = this.consumeThrottledMotionDt(dt);
        if (useDt < 0) {
            return;
        }
        // Arms reach along the actual swim heading so they follow the body when it
        // steers, instead of staying pinned to the lane axis.
        this._pose.setMovementHeadingRadians(motor.heading);
        this._splashMovementHeadingRadians = motor.heading;
        this.updateFreestyle(
            useDt,
            motor.leftArmCycle,
            motor.rightArmCycle,
            motor.leftKickCycle,
            motor.rightKickCycle,
            motor.bodyPhase,
            motor.currentSpeed,
            movementDirection,
        );
    }

    updateUnderwaterKickFromMotor(dt: number, motor: SwimmerMotor, movementDirection = 1) {
        const useDt = this.consumeThrottledMotionDt(dt);
        if (useDt < 0) {
            return;
        }
        this._pose.setMovementHeadingRadians(motor.heading);
        this._splashMovementHeadingRadians = motor.heading;
        this.updateFreestyle(
            useDt,
            0,
            0,
            motor.leftKickCycle,
            motor.rightKickCycle,
            motor.bodyPhase,
            motor.currentSpeed,
            movementDirection,
        );
    }

    // Decide whether the heavy procedural pose runs this frame for a background AI swimmer.
    // Returns the delta time to apply (accumulated across skipped frames) or -1 to skip this frame.
    // Off-screen culled AI freeze entirely; on-screen background AI update every N frames; the player
    // (stride 1, never culled) always runs with the raw dt.
    // 决定本帧是否为背景 AI 运行昂贵的程序化姿态。返回应使用的 dt（累计跳过的帧）或 -1 表示本帧跳过。
    // 离屏被裁的 AI 完全冻结；屏内背景 AI 每 N 帧更新；玩家（stride=1、永不裁剪）始终用原始 dt 运行。
    private consumeThrottledMotionDt(dt: number): number {
        if (this._splashCulled && PERFORMANCE_CONFIG.motion.freezePoseWhenCulled) {
            this._motionThrottleAccumDt = 0;
            this._motionThrottleCountdown = 0;
            return -1;
        }
        this._motionThrottleAccumDt += dt;
        if (this._motionThrottleStride <= 1) {
            const used = this._motionThrottleAccumDt;
            this._motionThrottleAccumDt = 0;
            return used;
        }
        if (this._motionThrottleCountdown > 0) {
            this._motionThrottleCountdown--;
            return -1;
        }
        this._motionThrottleCountdown = this._motionThrottleStride - 1;
        const used = this._motionThrottleAccumDt;
        this._motionThrottleAccumDt = 0;
        return used;
    }

    updateFreestyle(dt: number, leftArmCycle: number, rightArmCycle: number, leftKickCycle: number, rightKickCycle: number, bodyPhase: number, speed: number, movementDirection = 1) {
        if (!this._loaded || !this._poseState.isFreestyleActive || !this.root) {
            return;
        }

        this._pose.setMovementDirection(movementDirection);
        this._splashMovementDirection = movementDirection >= 0 ? 1 : -1;
        this._armAction = Math.max(0, this._armAction - dt * 4.8);
        this._kickAction = Math.max(0, this._kickAction - dt * 7);
        this._splashEmitter?.decay(dt);
        this.updateArmCycleMotion(dt, leftArmCycle, rightArmCycle);
        this.updateKickCycleMotion(dt, leftKickCycle, rightKickCycle);

        const treadWeight = this.updateTreadWaterBlend(dt, speed);
        this.applyTreadBlendModelPlacement(treadWeight);
        const drive = Math.max(0.85, Math.min(1.45, 0.9 + speed * 0.16));
        this._pose.applyFreestyleTreadBlendPose(
            leftArmCycle,
            rightArmCycle,
            leftKickCycle,
            rightKickCycle,
            bodyPhase,
            drive + this._armAction * 0.45,
            drive + this._armAction * 0.7,
            drive + this._kickAction * 0.8,
            this._treadWaterPhase,
            treadWeight,
        );

        const splashWeight = 1 - treadWeight;
        this._leftHandWaterContact = this._pose.handWaterContact(leftArmCycle) * splashWeight;
        this._rightHandWaterContact = this._pose.handWaterContact(rightArmCycle) * splashWeight;
        this._leftHandWaterEntry = this.visualHandWaterEntry('left', this._pose.handWaterEntry(leftArmCycle)) * splashWeight;
        this._rightHandWaterEntry = this.visualHandWaterEntry('right', this._pose.handWaterEntry(rightArmCycle)) * splashWeight;
        this._leftHandWaterProgress = this._pose.handWaterProgress(leftArmCycle);
        this._rightHandWaterProgress = this._pose.handWaterProgress(rightArmCycle);
        this.updateSplashSurface(speed);
    }

    // Advance the mid-race tread-water phase and ease the freestyle<->tread blend weight toward
    // the target implied by the current race speed. Enter/exit speeds use hysteresis so the pose
    // does not flicker while the swimmer hovers near the threshold. Returns the eased weight.
    // 推进比赛途中的踩水相位，并把自由泳<->踩水权重缓动到当前速度对应的目标。进入/退出速度带迟滞，
    // 避免临界抖动。返回缓动后的权重。
    private updateTreadWaterBlend(dt: number, speed: number): number {
        const cycleSeconds = CHARACTER_POSE_TUNING.raceTreadWaterCycleSeconds / Math.max(0.25, this.motionPreviewSpeedScale());
        this._treadWaterPhase = positiveMod(this._treadWaterPhase + dt / Math.max(0.05, cycleSeconds), 1);
        this._treadExitHold = Math.max(0, this._treadExitHold - dt);

        let target = this._treadWaterWeight >= 0.5 ? 1 : 0;
        if (this._treadExitHold > 0 || speed >= CHARACTER_POSE_TUNING.raceTreadExitSpeed) {
            target = 0;
        } else if (speed <= CHARACTER_POSE_TUNING.raceTreadEnterSpeed) {
            target = 1;
        }

        const step = CHARACTER_POSE_TUNING.raceTreadBlendRate * dt;
        if (this._treadWaterWeight < target) {
            this._treadWaterWeight = Math.min(target, this._treadWaterWeight + step);
        } else if (this._treadWaterWeight > target) {
            this._treadWaterWeight = Math.max(target, this._treadWaterWeight - step);
        }
        return this._treadWaterWeight;
    }

    // Interpolate the model node's water height and facing between the prone freestyle placement and
    // the upright tread-water placement (the same target used at the finish), so the swimmer rises and
    // turns upright as it slows to a stop and lies back down as it speeds up. weight 0 = freestyle.
    // 在俯卧的自由泳摆位与竖直的踩水摆位（与完赛踩水一致的目标）之间插值模型节点的水面高度和朝向，
    // 让泳手减速停下时抬起并转为竖直、加速时重新趴下。weight 0 = 自由泳。
    private applyTreadBlendModelPlacement(weight: number) {
        if (!this._model) {
            return;
        }
        const raceY = CHARACTER_POSE_TUNING.raceModelBaseY + this.raceModelYOffset() + MOTION_TUNING.swimBodyYOffset;
        const raceEuler = this.raceModelEulerDegrees();
        if (weight <= 0.001) {
            this._model.setPosition(0, raceY, 0);
            this._model.setRotationFromEuler(raceEuler[0], raceEuler[1], raceEuler[2]);
            return;
        }
        const treadY = CHARACTER_POSE_TUNING.raceModelBaseY + CHARACTER_POSE_TUNING.raceTreadModelYOffset + MOTION_TUNING.swimBodyYOffset;
        const treadEuler = CHARACTER_POSE_TUNING.raceTreadModelEuler;
        const w = Math.max(0, Math.min(1, weight));
        this._model.setPosition(0, lerpScalar(raceY, treadY, w), 0);
        this._model.setRotationFromEuler(
            lerpScalar(raceEuler[0], treadEuler[0], w),
            lerpScalar(raceEuler[1], treadEuler[1], w),
            lerpScalar(raceEuler[2], treadEuler[2], w),
        );
    }

    updateDebugActionPreview(dt: number) {
        if (!this._loaded || !this._modelDebugMode) {
            return;
        }
        if (this.isFlipTurnDebugPose()) {
            this.updateDebugFlipTurn(dt);
            return;
        }
        if (this.isDivePrepDebugPose()) {
            this._pose.applyDivePrepPose(1);
            this._armAction = 0;
            this._kickAction = 0;
            this.syncSplashState();
            this.updateSplashSurface(0);
            return;
        }
        if (this.isSampledActionDebugPose() && this._debugSampledActionId) {
            const action = findSampledDebugAction(this._debugSampledActionId);
            if (!action) {
                return;
            }
            const cycleSeconds = action.durationSeconds / Math.max(0.25, this.motionPreviewSpeedScale());
            const phase = positiveMod(this._selfTime / Math.max(0.1, cycleSeconds), 1);
            this._pose.applySampledActionPose(action.id, phase, 1);
            this._armAction = 0;
            this._kickAction = 0;
            this.syncSplashState();
            this.updateSplashSurface(0);
            return;
        }
        if (!this.isBreaststrokeDebugPose()) {
            return;
        }
        const cycleSeconds = CHARACTER_POSE_TUNING.breaststrokePreviewCycleSeconds / Math.max(0.25, this.motionPreviewSpeedScale());
        const phase = positiveMod(this._selfTime / cycleSeconds, 1);
        this._pose.setMovementDirection(1);
        this._pose.applyBreaststrokePose(phase, 1);
        const action = Math.max(0, Math.sin(phase * Math.PI * 2 - Math.PI * 0.25));
        this._armAction = Math.max(this._armAction - dt * 2.4, action * 0.35);
        this._kickAction = Math.max(this._kickAction - dt * 2.8, Math.max(0, Math.sin(phase * Math.PI * 2 - Math.PI * 1.25)) * 0.55);
        this.syncSplashState();
        this.updateSplashSurface(0.8);
    }

    updateBreaststrokePreview(dt: number) {
        this.updateDebugActionPreview(dt);
    }

    update(dt: number) {
        if (!this._loaded || !this.root) {
            return;
        }

        if (this._bodyFeedbackEnabled && (this._perfectGlowIntensity > 0 || this._collisionFlashTimer > 0)) {
            this._collisionFlashTimer = Math.max(0, this._collisionFlashTimer - dt);
            this.updatePerfectGlowMaterial();
        }

        this._selfTime += dt;
        if (this._modelDebugMode) {
            return;
        }

        if (this._poseState.update(dt, this._animationPlayer.hasAnimation)) {
            return;
        }

    }

    onDestroy() {
        this.restorePerfectGlowMaterials();
        if (this._perfectGlowMaterial?.isValid) {
            this._perfectGlowMaterial.destroy();
        }
        this._perfectGlowMaterial = null;
    }

    resetPose() {
        if (!this._loaded || !this.root) {
            return;
        }
        this._armAction = 0;
        this._raceFlipTurnActive = false;
        this.resetDebugFlipTurnState();
        this._kickAction = 0;
        this._armCycleMotion = 0;
        this._leftHandWaterContact = 0;
        this._rightHandWaterContact = 0;
        this._leftHandWaterEntry = 0;
        this._rightHandWaterEntry = 0;
        this._leftHandWaterProgress = 0;
        this._rightHandWaterProgress = 0;
        this._splashMovementDirection = 1;
        this._splashMovementHeadingRadians = 0;
        this._legSplashSuppressed = false;
        this._lastArmCycle = 0;
        this._hasLastArmCycle = false;
        this._kickCycleMotion = 0;
        this._lastKickCycle = 0;
        this._hasLastKickCycle = false;
        this._treadWaterWeight = 0;
        this._treadWaterPhase = 0;
        this._treadExitHold = 0;
        this._poseState.resetRuntime();
        this._splashEmitter?.reset();
        this._pose.restoreBasePose();
        this.updateSplashSurface(0);
    }

    setModelDebugMode(active: boolean) {
        this._modelDebugMode = active;
        this._animationPlayer.disable();
        const useBakedAnimation = active && this.isMixamoSwimmingDebugVariant();
        for (const renderer of this._skinnedRenderers) {
            renderer.setUseBakedAnimation(useBakedAnimation, true);
            if (!useBakedAnimation) {
                renderer.uploadAnimation(null);
            }
        }
        if (!this._loaded || !this._model || !this.root) {
            return;
        }
        this._pose.setSwimHeadLift(this.swimHeadLiftDegrees());
        this.resetPose();
        if (active) {
            this.applyModelDebugSetup();
        } else {
            this._poseState.applyRaceModelSetup();
        }
    }

    triggerSplashBurst(scale = 1) {
        this._splashEmitter?.triggerBurst(scale);
    }

    setPerfectGlowActive(active: boolean) {
        const intensity = active ? 1 : 0;
        const changed = this._perfectGlowIntensity !== intensity;
        this._perfectGlowIntensity = intensity;
        if (changed && this._bodyFeedbackEnabled) {
            this.updatePerfectGlowMaterial();
        }
    }

    setBodyFeedbackEnabled(enabled: boolean) {
        if (this._bodyFeedbackEnabled === enabled) {
            return;
        }
        this._bodyFeedbackEnabled = enabled;
        if (!enabled) {
            this._collisionFlashTimer = 0;
            this.restorePerfectGlowMaterials();
            return;
        }
        this.updatePerfectGlowMaterial();
    }

    // Flash the body red for a moment (reuses the body material) when this
    // swimmer bumps into another. Called each frame contact persists; the timer
    // resets to full so it stays red while touching, then fades after separation.
    flashCollision() {
        if (!this._bodyFeedbackEnabled || !this.node?.isValid || !this._loaded || !this._model || !this.root) {
            return;
        }
        this._collisionFlashTimer = COLLISION_FLASH_SECONDS;
        this.updatePerfectGlowMaterial();
    }

    refreshModelDebugSetup() {
        if (!this._modelDebugMode || !this._loaded || !this._model || !this.root) {
            return;
        }
        this._poseState.applyRaceModelSetup();
        if (this.isMixamoSwimmingDebugVariant()) {
            this._animationPlayer.setSpeed(this.motionPreviewSpeedScale());
        }
    }

    setDebugMotionSpeedScale(scale: number) {
        this._debugMotionSpeedScale = Math.max(0.1, Math.min(1.5, scale));
        if (this._modelDebugMode && this.isMixamoSwimmingDebugVariant()) {
            this._animationPlayer.setSpeed(this.motionPreviewSpeedScale());
        }
    }

    private applyLaneMaterials(skinColor: Color, suitColor: Color, capColor: Color, robotStyle: boolean, playerOutline: boolean) {
        if (!this._model || !this.root) {
            return;
        }
        this.restorePerfectGlowMaterials();
        const modelVariant = findSwimmerModelVariant(this._modelVariantId) ?? defaultSwimmerModelVariant();
        const colorVariant = findSwimmer0621ColorVariant(this._colorVariantId) ?? defaultSwimmer0621ColorVariant();
        const usesDynamicColor = !!modelVariant.dynamicColor
            && (!!colorVariant.skin || !!colorVariant.suit || (modelVariant.dynamicColor.usesCapChannel && !!colorVariant.cap));
        const resolvedSkinColor = colorVariant.skin
            ? new Color(...colorVariant.skin, 255)
            : new Color(skinColor.r, skinColor.g, skinColor.b, 0);
        const resolvedSuitColor = colorVariant.suit
            ? new Color(...colorVariant.suit, 255)
            : suitColor;
        const resolvedCapColor = colorVariant.cap
            ? new Color(...colorVariant.cap, 255)
            : capColor;
        applyCharacterSkin({
            root: this.root,
            model: this._model,
            skinnedRenderers: this._skinnedRenderers,
            skinColor: resolvedSkinColor,
            suitColor: resolvedSuitColor,
            capColor: resolvedCapColor,
            robotStyle,
            playerOutline,
            outfit: this._skinOutfit,
            preserveOriginalMaterial: this.preserveOriginalMaterial(),
            dynamicColorEffect: this._dynamicColorEffect,
            colorMask: usesDynamicColor ? this._colorMask : null,
            waterLine: this._waterY,
            preserveImportedMaterial: this.usesImportedSwimmerMaterial(),
            outlineWidth: this.usesImportedSwimmerMaterial() ? 10 : undefined,
            outlineRoot: this._outlineRoot,
            setOutlineRoot: (root) => {
                this._outlineRoot = root;
            },
        });
        this.updatePerfectGlowMaterial();
    }

    private storeSkinSettings(skinColor: Color, suitColor: Color, capColor: Color, robotStyle: boolean, playerOutline: boolean) {
        this._skinColor = skinColor.clone();
        this._suitColor = suitColor.clone();
        this._capColor = capColor.clone();
        this._robotStyle = robotStyle;
        this._playerOutline = playerOutline;
    }

    private usesImportedSwimmerMaterial(): boolean {
        return this._modelVariantId !== defaultSwimmerModelVariant().id;
    }

    private preserveOriginalMaterial(): boolean {
        return findSwimmerModelVariant(this._modelVariantId)?.preserveOriginalMaterial === true;
    }

    private loadDynamicColorAssets() {
        const modelVariant = findSwimmerModelVariant(this._modelVariantId);
        const dynamicColor = modelVariant?.dynamicColor;
        if (!modelVariant || !dynamicColor) {
            return;
        }
        const expectedModelVariantId = modelVariant.id;
        const token = ++this._colorAssetLoadToken;
        const applyWhenReady = () => {
            if (token !== this._colorAssetLoadToken || !this._dynamicColorEffect) {
                return;
            }
            if (this._loaded && this.root) {
                this.applyLaneMaterials(this._skinColor, this._suitColor, this._capColor, this._robotStyle, this._playerOutline);
            }
        };
        loadRaceAsset(dynamicColor.maskPath, Texture2D, (error, texture) => {
            if (token !== this._colorAssetLoadToken || this._modelVariantId !== expectedModelVariantId) {
                return;
            }
            if (error || !texture) {
                console.error(`[SpeedSwimming] failed to load swimmer color mask variant=${expectedModelVariantId}`, error);
                return;
            }
            this._colorMask = texture;
            applyWhenReady();
        });
        loadRaceAsset(RESOURCE_PATHS.swimmerDynamicColorEffect, EffectAsset, (error, effect) => {
            if (token !== this._colorAssetLoadToken || this._modelVariantId !== expectedModelVariantId) {
                return;
            }
            if (error || !effect) {
                console.error('[SpeedSwimming] failed to load swimmer dynamic color effect', error);
                return;
            }
            this._dynamicColorEffect = effect;
            applyWhenReady();
        });
    }

    private hasDynamicColorVariant(): boolean {
        const dynamicColor = findSwimmerModelVariant(this._modelVariantId)?.dynamicColor;
        if (!dynamicColor) {
            return false;
        }
        const variant = findSwimmer0621ColorVariant(this._colorVariantId);
        return !!variant?.skin
            || !!variant?.suit
            || (dynamicColor.usesCapChannel && !!variant?.cap);
    }

    private supportsDynamicColor(): boolean {
        return !!findSwimmerModelVariant(this._modelVariantId)?.dynamicColor;
    }

    private isMixamoSwimmingDebugVariant(): boolean {
        return this._modelVariantId === 'swimmer0621_2_mixamoSwimming'
            && isDebugOnlySwimmerModelVariant(this._modelVariantId);
    }

    private isBreaststrokeDebugPose(): boolean {
        if (this._modelDebugMode) {
            return this._debugActionPose === 'breaststroke';
        }
        return findSwimmerModelVariant(this._modelVariantId)?.debugPose === 'breaststroke'
            && isDebugOnlySwimmerModelVariant(this._modelVariantId);
    }

    private isDivePrepDebugPose(): boolean {
        if (this._modelDebugMode) {
            return this._debugActionPose === 'divePrep';
        }
        return findSwimmerModelVariant(this._modelVariantId)?.debugPose === 'divePrep'
            && isDebugOnlySwimmerModelVariant(this._modelVariantId);
    }

    private isSampledActionDebugPose(): boolean {
        return this._modelDebugMode && this._debugActionPose === 'sampledAction';
    }

    private isFlipTurnDebugPose(): boolean {
        return this._modelDebugMode && this._debugActionPose === 'flipTurn';
    }

    private ensureMixamoDebugAnimationPlaying() {
        if (!this._animationPlayer.hasAnimation) {
            this.ensureMixamoAnimationComponent();
        }
        if (!this._animationPlayer.hasAnimation) {
            return;
        }
        const speed = this.motionPreviewSpeedScale();
        const played = this._animationPlayer.playClip('Swimming', true, speed)
            || this._animationPlayer.playFirstClip(true, speed);
        if (!played) {
            console.warn(`[SpeedSwimming] Mixamo debug animation missing clips=${this.animationClipNames}`);
        }
    }

    private ensureMixamoAnimationComponent() {
        if (!this.isMixamoSwimmingDebugVariant() || !this._model) {
            return;
        }
        let animation = this._model.getComponent(SkeletalAnimation);
        if (!animation) {
            animation = this._model.addComponent(SkeletalAnimation);
            console.log(`[SpeedSwimming] Mixamo debug added SkeletalAnimation on model root ${this.nodePath(this._model)}`);
        } else {
            console.log(`[SpeedSwimming] Mixamo debug found SkeletalAnimation on model root ${this.nodePath(animation.node)} clips=${animation.clips.map((clip) => clip?.name || '-').join('|') || 'empty'}`);
        }
        this.logMixamoPathProbe();
        this._animationPlayer.bind(animation, true);
        this.loadMixamoClipByPath(0);
    }

    private motionPreviewSpeedScale(): number {
        return this._modelDebugMode ? this._debugMotionSpeedScale : 1;
    }

    private loadMixamoClipByPath(index: number) {
        if (index >= MIXAMO_SWIMMING_CLIP_PATHS.length) {
            this.loadMixamoClipFromDirectory();
            return;
        }
        const path = MIXAMO_SWIMMING_CLIP_PATHS[index];
        loadRaceAsset(path, AnimationClip, (error, clip) => {
            if (!this.isMixamoSwimmingDebugVariant() || !this._model?.isValid) {
                return;
            }
            if (!error && clip) {
                console.log(`[SpeedSwimming] Mixamo loaded clip path=${path}`);
                this.bindMixamoClip(clip);
                return;
            }
            console.log(`[SpeedSwimming] Mixamo clip path skipped path=${path} reason=${error}`);
            this.loadMixamoClipByPath(index + 1);
        });
    }

    private loadMixamoClipFromDirectory() {
        loadRaceAssetDir('models/UserSwimmer0621_2MixamoSwimming', AnimationClip, (dirError, clips) => {
            if (!this.isMixamoSwimmingDebugVariant() || !this._model?.isValid) {
                return;
            }
            const clipNames = clips?.map((item) => item?.name || '-').join('|') || 'empty';
            console.log(`[SpeedSwimming] Mixamo loadDir clips=${clipNames}`);
            const fallback = clips?.find((item) => item?.name === 'Swimming')
                || clips?.find((item) => item?.name?.startsWith('Swimming'))
                || clips?.[0]
                || null;
            if (!fallback) {
                console.warn('[SpeedSwimming] failed to load Mixamo Swimming clip subasset from paths and directory', dirError);
                return;
            }
            this.bindMixamoClip(fallback);
        });
    }

    private bindMixamoClip(clip: AnimationClip) {
        console.log(`[SpeedSwimming] Mixamo debug bind clip=${clip.name} duration=${clip.duration.toFixed(2)}`);
        this._animationPlayer.addClip(clip);
        if (this._modelDebugMode) {
            this.ensureMixamoDebugAnimationPlaying();
        }
    }

    private logMixamoPathProbe() {
        if (!this._model) {
            return;
        }
        const paths = [
            'Armature',
            'Armature/Root',
            'Armature/Root/Hip',
            'Armature/Root/Hip/Waist/Spine01/Spine02/R_Clavicle/R_Upperarm/R_Forearm/R_ForearmTwist01',
            'Armature/UserSwimmer0621_2',
        ];
        const result = paths.map((path) => `${path}=${!!findNodeByPath(this._model, path)}`).join(' ');
        console.log(`[SpeedSwimming] Mixamo path probe from model root ${result}`);
    }

    private nodePath(node: Node): string {
        const names: string[] = [];
        for (let current: Node | null = node; current; current = current.parent) {
            names.push(current.name || '-');
        }
        return names.reverse().join('/');
    }

    private setupDebugFlipTurn(captureCurrentSwimPose = false) {
        if (!this._model || !this.root) {
            return;
        }
        this.resetDebugFlipTurnState();
        Vec3.copy(this._flipTurnModelBasePosition, this._model.position);
        Quat.copy(this._flipTurnModelBaseRotation, this._model.rotation);

        if (captureCurrentSwimPose) {
            this._flipTurnSwimPose = this._pose.capturePoseSnapshot();
            // The race may enter the turn at any point in the freestyle cycle.
            // Keep that live pose only as the entry pose; the return transition
            // must finish on the same neutral underwater pose used after the push.
            this._pose.restoreBasePose();
            const exitDrive = Math.max(
                0.85,
                Math.min(1.45, 0.9 + Math.max(0, SWIMMER_BALANCE.flipTurnPushLaunchSpeed) * 0.16),
            );
            this._pose.applyFreestylePose(0, 0, 0, Math.PI, 0, exitDrive, exitDrive, exitDrive);
            this._flipTurnExitSwimPose = this._pose.capturePoseSnapshot();
        } else {
            this._pose.restoreBasePose();
            this._pose.applyFreestylePose(0, 0, 0, 0, 0, 1, 1, 0.9);
            this._flipTurnSwimPose = this._pose.capturePoseSnapshot();
            this._flipTurnExitSwimPose = this._pose.capturePoseSnapshot();
        }

        this._pose.applyFlipTurnKeyPose(FLIP_TURN_KEYFRAME_1);
        this._flipTurnKeyframe1Pose = this._pose.capturePoseSnapshot();
        this._pose.applyFlipTurnKeyPose(FLIP_TURN_KEYFRAME_2);
        this._flipTurnKeyframe2Pose = this._pose.capturePoseSnapshot();

        if (this._flipTurnSwimPose) {
            this._pose.applyPoseSnapshot(this._flipTurnSwimPose);
        }
        if (this._pose.getHipWorldPosition(this._tmpFlipTurnWorldPivot)) {
            this.node.inverseTransformPoint(this._flipTurnWaistPivot, this._tmpFlipTurnWorldPivot);
        } else {
            Vec3.copy(this._flipTurnWaistPivot, this._flipTurnModelBasePosition);
        }
        this.applyDebugFlipTurnRotation(0, 0, 0);
        this.updateSplashSurface(0);
        this._splashEmitter?.setVisible(false);
    }

    private measureFlipTurnFootContactOffset(): number {
        const swim = this._flipTurnSwimPose;
        const keyframe2 = this._flipTurnKeyframe2Pose;
        if (!swim || !keyframe2) {
            return 1;
        }
        this._pose.applyPoseSnapshot(keyframe2);
        this.applyDebugFlipTurnRotation(-180, 0, -Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth));
        const count = this._pose.getFlipTurnFootContactWorldPositions(this._tmpFlipTurnContactWorld);
        let forward = 0;
        for (let i = 0; i < count; i++) {
            this.node.inverseTransformPoint(this._tmpFlipTurnContactLocal, this._tmpFlipTurnContactWorld[i]);
            forward = Math.max(forward, this._tmpFlipTurnContactLocal.x);
        }
        this._pose.applyPoseSnapshot(swim);
        this.applyDebugFlipTurnRotation(0, 0, 0);
        return Math.max(0.1, forward + CHARACTER_POSE_TUNING.flipTurnWallContactPadding);
    }

    private updateDebugFlipTurn(dt: number) {
        const swim = this._flipTurnSwimPose;
        const exitSwim = this._flipTurnExitSwimPose;
        const keyframe1 = this._flipTurnKeyframe1Pose;
        const keyframe2 = this._flipTurnKeyframe2Pose;
        if (!swim || !exitSwim || !keyframe1 || !keyframe2) {
            return;
        }
        if (!this._debugFlipTurnPlaying) {
            this._pose.applyPoseSnapshot(swim);
            this.applyDebugFlipTurnRotation(this._debugFlipTurnAccumulatedDegrees, this._debugFlipTurnAccumulatedAxisDegrees, 0);
            return;
        }

        this._debugFlipTurnElapsed += Math.max(0, dt) * this.motionPreviewSpeedScale();
        const firstDuration = Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnToKeyframe1Seconds);
        const secondDuration = Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnToKeyframe2Seconds);
        const returnDuration = Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnReturnToSwimSeconds);
        const keyframe2Time = firstDuration + secondDuration;
        const totalDuration = keyframe2Time + returnDuration;

        if (this._debugFlipTurnElapsed < firstDuration) {
            this._pose.blendPoseSnapshots(swim, keyframe1, smoothRange(this._debugFlipTurnElapsed, 0, firstDuration));
        } else if (this._debugFlipTurnElapsed < keyframe2Time) {
            this._pose.blendPoseSnapshots(keyframe1, keyframe2, smoothRange(this._debugFlipTurnElapsed, firstDuration, keyframe2Time));
        } else if (this._debugFlipTurnElapsed < totalDuration) {
            const bodyRatio = smoothRange(this._debugFlipTurnElapsed, keyframe2Time, totalDuration);
            const armReturnDuration = Math.min(
                returnDuration,
                Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnArmReturnSeconds),
            );
            const armRatio = smoothRange(
                this._debugFlipTurnElapsed,
                keyframe2Time,
                keyframe2Time + armReturnDuration,
            );
            this._pose.blendPoseSnapshotsWithArmRatio(keyframe2, exitSwim, bodyRatio, armRatio);
        } else {
            this._pose.applyPoseSnapshot(exitSwim);
            this._debugFlipTurnPlaying = false;
            this._debugFlipTurnAccumulatedDegrees = this._debugFlipTurnStartDegrees + this._debugFlipTurnRotationDeltaDegrees;
            this._debugFlipTurnAccumulatedAxisDegrees = this._debugFlipTurnStartAxisDegrees + 180;
            this._splashMovementDirection *= -1;
            this._pose.setMovementDirection(this._splashMovementDirection);
        }

        const rotationRatio = smoothRange(this._debugFlipTurnElapsed, 0, keyframe2Time);
        const rotationDegrees = this._debugFlipTurnPlaying
            ? this._debugFlipTurnStartDegrees + rotationRatio * this._debugFlipTurnRotationDeltaDegrees
            : this._debugFlipTurnAccumulatedDegrees;
        const axisRotationRatio = smoothRange(this._debugFlipTurnElapsed, keyframe2Time, totalDuration);
        const axisRotationDegrees = this._debugFlipTurnPlaying
            ? this._debugFlipTurnStartAxisDegrees + axisRotationRatio * 180
            : this._debugFlipTurnAccumulatedAxisDegrees;
        const underwaterDepth = Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth);
        let verticalOffset = 0;
        if (this._raceFlipTurnActive && this._debugFlipTurnElapsed >= firstDuration) {
            // Race mode transfers this local depth to the swimmer node when the
            // turn completes. Keep it active on the completion tick as well so
            // the model/root handoff represents the same world transform.
            verticalOffset = -underwaterDepth;
        } else if (this._debugFlipTurnPlaying) {
            if (this._debugFlipTurnElapsed < firstDuration) {
                verticalOffset = -underwaterDepth * smoothRange(this._debugFlipTurnElapsed, 0, firstDuration);
            } else if (this._debugFlipTurnElapsed < keyframe2Time) {
                verticalOffset = -underwaterDepth;
            } else {
                verticalOffset = -underwaterDepth * (1 - smoothRange(this._debugFlipTurnElapsed, keyframe2Time, totalDuration));
            }
        }
        // During the return segment, race mode moves the rotation pivot from the
        // waist to the swimmer-node origin. At ratio 1 the model transform is
        // exactly equivalent to a 180-degree parent-node turn, so handing the
        // rotation to SwimmerRacePhases cannot move the athlete in world space.
        const parentRotationTransferRatio = this._raceFlipTurnActive ? axisRotationRatio : 0;
        this.applyDebugFlipTurnRotation(
            rotationDegrees,
            axisRotationDegrees,
            verticalOffset,
            parentRotationTransferRatio,
        );
        this._armAction = 0;
        this._kickAction = 0;
        this.syncSplashState();
        this.updateSplashSurface(0);
    }

    private applyDebugFlipTurnRotation(
        degrees: number,
        axisDegrees: number,
        verticalOffset: number,
        parentRotationTransferRatio = 0,
    ) {
        if (!this._model) {
            return;
        }
        this._model.setPosition(this._flipTurnModelBasePosition);
        this._model.setRotation(this._flipTurnModelBaseRotation);
        let currentWaist = this._flipTurnWaistPivot;
        if (this._pose.getHipWorldPosition(this._tmpFlipTurnWorldPivot)) {
            this.node.inverseTransformPoint(this._tmpFlipTurnOffset, this._tmpFlipTurnWorldPivot);
            currentWaist = this._tmpFlipTurnOffset;
        }
        Quat.fromAxisAngle(this._tmpFlipTurnRotation, Vec3.UNIT_Z, degrees * Math.PI / 180);
        Quat.fromAxisAngle(this._tmpFlipTurnAxisRotation, Vec3.UNIT_X, axisDegrees * Math.PI / 180);
        Quat.multiply(this._tmpFlipTurnCombinedRotation, this._tmpFlipTurnRotation, this._tmpFlipTurnAxisRotation);
        Quat.multiply(this._tmpFlipTurnModelRotation, this._tmpFlipTurnCombinedRotation, this._flipTurnModelBaseRotation);
        Vec3.subtract(this._tmpFlipTurnOffset, this._flipTurnModelBasePosition, currentWaist);
        Vec3.transformQuat(this._tmpFlipTurnOffset, this._tmpFlipTurnOffset, this._tmpFlipTurnCombinedRotation);
        Vec3.add(this._tmpFlipTurnOffset, this._flipTurnWaistPivot, this._tmpFlipTurnOffset);
        this._tmpFlipTurnOffset.y += verticalOffset;
        const transferRatio = Math.max(0, Math.min(1, parentRotationTransferRatio));
        if (transferRatio > 0) {
            this._tmpFlipTurnTransferPosition.set(this._flipTurnModelBasePosition);
            // The parent handoff changes the swimmer's yaw, so only the lane-plane
            // (X/Z) pivot needs transferring. Preserve the waist-pivoted Y path;
            // blending Y toward the model origin makes the athlete visibly sink
            // while uncurling even though the final vertical handoff is continuous.
            this._tmpFlipTurnTransferPosition.y = this._tmpFlipTurnOffset.y;
            Vec3.lerp(
                this._tmpFlipTurnOffset,
                this._tmpFlipTurnOffset,
                this._tmpFlipTurnTransferPosition,
                transferRatio,
            );
        }
        this._model.setPosition(this._tmpFlipTurnOffset);
        this._model.setRotation(this._tmpFlipTurnModelRotation);
    }

    private resetDebugFlipTurnState() {
        this._debugFlipTurnPlaying = false;
        this._debugFlipTurnElapsed = 0;
        this._debugFlipTurnAccumulatedDegrees = 0;
        this._debugFlipTurnStartDegrees = 0;
        this._debugFlipTurnAccumulatedAxisDegrees = 0;
        this._debugFlipTurnStartAxisDegrees = 0;
        this._debugFlipTurnRotationDeltaDegrees = -180;
        this._flipTurnSwimPose = null;
        this._flipTurnExitSwimPose = null;
        this._flipTurnKeyframe1Pose = null;
        this._flipTurnKeyframe2Pose = null;
    }

    private applyModelDebugSetup() {
        if (!this._model || !this.root) {
            return;
        }
        const useBakedAnimation = this.isMixamoSwimmingDebugVariant();
        this.configureSkinnedRenderers(useBakedAnimation);
        this._poseState.applyRaceModelSetup();
        if (this.isFlipTurnDebugPose()) {
            this.setupDebugFlipTurn();
            console.log(
                `[SpeedSwimming] model debug uses sampled flip-turn keyframes ` +
                `bones=${this.manualBoneCount} skinned=${this._skinnedRenderers.length}`,
            );
            return;
        }
        if (this.isMixamoSwimmingDebugVariant()) {
            this._animationPlayer.setUseBakedAnimation(true);
            this.ensureMixamoDebugAnimationPlaying();
            console.log(
                `[SpeedSwimming] model debug uses imported Mixamo clip ` +
                `bones=${this.manualBoneCount} skinned=${this._skinnedRenderers.length} clips=${this.animationClipNames}`,
            );
            return;
        }
        if (this.isBreaststrokeDebugPose()) {
            this._pose.applyBreaststrokePose(0, 1);
            console.log(
                `[SpeedSwimming] model debug uses procedural breaststroke ` +
                `bones=${this.manualBoneCount} skinned=${this._skinnedRenderers.length}`,
            );
            return;
        }
        if (this.isDivePrepDebugPose()) {
            this._pose.applyDivePrepPose(1);
            this.updateSplashSurface(0);
            this._splashEmitter?.setVisible(false);
            console.log(
                `[SpeedSwimming] model debug uses sampled dive prep pose ` +
                `bones=${this.manualBoneCount} skinned=${this._skinnedRenderers.length}`,
            );
            return;
        }
        if (this.isSampledActionDebugPose() && this._debugSampledActionId) {
            this._pose.applySampledActionPose(this._debugSampledActionId, 0, 1);
            this.updateSplashSurface(0);
            this._splashEmitter?.setVisible(false);
            console.log(
                `[SpeedSwimming] model debug uses sampled action id=${this._debugSampledActionId} ` +
                `bones=${this.manualBoneCount} skinned=${this._skinnedRenderers.length}`,
            );
            return;
        }
        this._poseState.enterFreestyle();
        this._pose.applyFreestylePose(0, 0, 0, 0, 0, 1, 1, 0.9);
        console.log(
            `[SpeedSwimming] model debug uses race freestyle pipeline ` +
            `bones=${this.manualBoneCount} skinned=${this._skinnedRenderers.length} ` +
            `leftArm=${this._pose.leftArmPresent} rightArm=${this._pose.rightArmPresent} leftLeg=${this._pose.leftLegPresent} rightLeg=${this._pose.rightLegPresent}`,
        );
    }

    private updateSplashSurface(speed: number) {
        this.syncSplashState();
        this._splashEmitter?.update(speed);
    }

    private raceModelYOffset(): number {
        if (this._modelDebugMode && this._debugActionPose === 'breaststroke') {
            return -0.88;
        }
        return findSwimmerModelVariant(this._modelVariantId)?.raceModelYOffset ?? 0;
    }

    private raceModelEulerDegrees(): readonly [number, number, number] {
        if (this._modelDebugMode && (this._debugActionPose === 'breaststroke' || this._debugActionPose === 'divePrep' || this._debugActionPose === 'sampledAction')) {
            return [0, 90, 0];
        }
        return findSwimmerModelVariant(this._modelVariantId)?.raceModelEulerDegrees ?? [90, 90, 0];
    }

    private swimHeadLiftDegrees(): number | undefined {
        if (this._modelDebugMode && this._debugActionPose === 'breaststroke') {
            return 6;
        }
        return findSwimmerModelVariant(this._modelVariantId)?.swimHeadLiftDegrees;
    }

    private updateArmCycleMotion(dt: number, leftArmCycle: number, rightArmCycle: number) {
        if (dt <= 0) {
            return;
        }
        if (!this._hasLastArmCycle) {
            this._lastArmCycle = (leftArmCycle + rightArmCycle) * 0.5;
            this._hasLastArmCycle = true;
            return;
        }

        const cycle = (leftArmCycle + rightArmCycle) * 0.5;
        const angularSpeed = Math.abs(cycle - this._lastArmCycle) / dt;
        this._lastArmCycle = cycle;
        const target = Math.max(0, Math.min(1, angularSpeed / (Math.PI * 2 * 2.6)));
        const blend = Math.min(1, dt * 10);
        this._armCycleMotion += (target - this._armCycleMotion) * blend;
    }

    private updateKickCycleMotion(dt: number, leftKickCycle: number, rightKickCycle: number) {
        if (dt <= 0) {
            return;
        }
        if (!this._hasLastKickCycle) {
            this._lastKickCycle = (leftKickCycle + rightKickCycle) * 0.5;
            this._hasLastKickCycle = true;
            return;
        }

        const cycle = (leftKickCycle + rightKickCycle) * 0.5;
        const angularSpeed = Math.abs(cycle - this._lastKickCycle) / dt;
        this._lastKickCycle = cycle;
        const target = Math.max(0, Math.min(1, angularSpeed / (Math.PI * 2 * 3.2)));
        const blend = Math.min(1, dt * 10);
        this._kickCycleMotion += (target - this._kickCycleMotion) * blend;
    }

    private syncSplashState() {
        this._splashEmitter?.setState({
            armAction: this._armAction,
            kickAction: this._kickAction,
            armCycleMotion: this._armCycleMotion,
            kickCycleMotion: this._kickCycleMotion,
            movementDirection: this._splashMovementDirection,
            movementHeadingRadians: this._splashMovementHeadingRadians,
            legSplashSuppressed: this._legSplashSuppressed,
            leftHandWaterContact: this._leftHandWaterContact,
            rightHandWaterContact: this._rightHandWaterContact,
            leftHandWaterEntry: this._leftHandWaterEntry,
            rightHandWaterEntry: this._rightHandWaterEntry,
            leftHandWaterProgress: this._leftHandWaterProgress,
            rightHandWaterProgress: this._rightHandWaterProgress,
        });
    }

    private getSplashBoneWorldPosition(name: string, out: Vec3): boolean {
        return this._pose.getSplashBoneWorldPosition(name, out);
    }

    private visualHandWaterEntry(side: 'left' | 'right', fallback: number): number {
        const handName = side === 'left' ? 'LeftHand' : 'RightHand';
        if (!this._pose.getSplashBoneWorldPosition('Head', this._tmpSplashHeadWorld)
            || !this._pose.getSplashBoneWorldPosition(handName, this._tmpSplashHandWorld)) {
            return fallback;
        }

        const direction = this._splashMovementDirection >= 0 ? 1 : -1;
        const handAheadOfHead = direction * (this._tmpSplashHandWorld.x - this._tmpSplashHeadWorld.x);
        const handAheadOfBody = direction * (this._tmpSplashHandWorld.x - this.node.worldPosition.x);
        const visuallyForward = smoothRange(handAheadOfHead, -0.04, 0.24);
        const nearHeadFront = smoothRange(handAheadOfBody, 0.42, 0.92);
        return clamp01(Math.max(fallback * visuallyForward, visuallyForward * nearHeadFront));
    }

    private configureSkinnedRenderers(useBakedAnimation = false) {
        if (!this._model) {
            return;
        }
        this._skinnedRenderers = configureSwimmerSkinnedRenderers(this._model, { useBakedAnimation });
        if (this._skinnedRenderers.length > 0) {
            const roots = this._skinnedRenderers.map((renderer) => renderer.skinningRoot?.name || 'none').join('|');
            console.log(`[SpeedSwimming] skinned mesh ${useBakedAnimation ? 'baked animation' : 'realtime'} enabled count=${this._skinnedRenderers.length} roots=${roots}`);
        } else {
            console.warn('[SpeedSwimming] no SkinnedMeshRenderer found on swimmer prefab');
        }
    }

    private updatePerfectGlowMaterial() {
        const collisionFlash = this.currentCollisionFlashIntensity();
        const yellowGlow = this._perfectGlowIntensity;
        const intensity = Math.max(yellowGlow, collisionFlash);
        if (intensity <= 0.001) {
            this.restorePerfectGlowMaterials();
            return;
        }

        // Collision feedback has explicit priority over the sweet-zone guide.
        // Both effects start at intensity 1, so comparing their magnitudes made
        // the tie select yellow; as the red timer decayed it could then never win.
        // Once the red timer expires, an active sweet zone naturally shows again.
        const color = collisionFlash > 0 ? COLLISION_FLASH_COLOR : PERFECT_GLOW_COLOR;
        const flashMaterial = this.ensurePerfectGlowMaterial();
        flashMaterial.setProperty('mainColor', color);

        if (this._perfectGlowRestoreSlots.length <= 0) {
            for (const renderer of this._skinnedRenderers) {
                if (!renderer?.isValid || !renderer.node?.isValid) {
                    continue;
                }
                const slotCount = Math.max(1, renderer.sharedMaterials.length);
                for (let index = 0; index < slotCount; index++) {
                    const material = renderer.getSharedMaterial(index);
                    if (!material || material === flashMaterial) {
                        continue;
                    }
                    this._perfectGlowRestoreSlots.push({ renderer, index, material });
                    renderer.setMaterial(flashMaterial, index);
                }
            }
            return;
        }

        for (const slot of this._perfectGlowRestoreSlots) {
            if (!slot.renderer?.isValid || !slot.renderer.node?.isValid) {
                continue;
            }
            const current = slot.renderer.getSharedMaterial(slot.index);
            if (current && current !== flashMaterial) {
                slot.material = current;
                slot.renderer.setMaterial(flashMaterial, slot.index);
            }
        }
    }

    private ensurePerfectGlowMaterial(): Material {
        if (this._perfectGlowMaterial?.isValid) {
            return this._perfectGlowMaterial;
        }
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit' });
        material.name = 'SwimmerBodyFlashUnlit';
        material.setProperty('mainColor', PERFECT_GLOW_COLOR);
        this._perfectGlowMaterial = material;
        return material;
    }

    private restorePerfectGlowMaterials() {
        const flashMaterial = this._perfectGlowMaterial;
        for (const slot of this._perfectGlowRestoreSlots) {
            if (!slot.renderer?.isValid || !slot.renderer.node?.isValid || !slot.material?.isValid) {
                continue;
            }
            if (!flashMaterial || slot.renderer.getSharedMaterial(slot.index) === flashMaterial) {
                slot.renderer.setMaterial(slot.material, slot.index);
            }
        }
        this._perfectGlowRestoreSlots.length = 0;
    }

    private currentCollisionFlashIntensity(): number {
        return this._collisionFlashTimer > 0
            ? this._collisionFlashTimer / COLLISION_FLASH_SECONDS
            : 0;
    }

    private get boundJointCount(): number {
        return this._pose.boundJointCount;
    }

    private get manualBoneCount(): number {
        return this._pose.manualBoneCount;
    }

    private get animationClipNames(): string {
        return this._animationPlayer.clipNames;
    }
}

function findNodeByPath(root: Node, path: string): Node | null {
    let current: Node | null = root;
    for (const part of path.split('/')) {
        if (!current) {
            return null;
        }
        current = current.children.find((child) => child.name === part) ?? null;
    }
    return current;
}

function positiveMod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

function lerpScalar(from: number, to: number, t: number): number {
    return from + (to - from) * t;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function smoothRange(value: number, start: number, end: number): number {
    if (end <= start) {
        return value >= end ? 1 : 0;
    }
    const t = clamp01((value - start) / (end - start));
    return t * t * (3 - 2 * t);
}

function linearRange(value: number, start: number, end: number): number {
    if (end <= start) {
        return value >= end ? 1 : 0;
    }
    return clamp01((value - start) / (end - start));
}
