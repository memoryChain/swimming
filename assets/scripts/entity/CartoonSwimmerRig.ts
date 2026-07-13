import { _decorator, AnimationClip, Color, Component, EffectAsset, instantiate, Layers, Material, Node, Quat, SkeletalAnimation, SkinnedMeshRenderer, Texture2D, Vec3 } from 'cc';
import { CharacterAnimationPlayer } from '../character/CharacterAnimationPlayer';
import { sampledActionIdFor } from '../character/CharacterActionConfig';
import type { CharacterAction } from '../character/CharacterActionConfig';
import { CHARACTER_POSE_TUNING } from '../character/CharacterMotionTuning';
import { CharacterPoseStateController } from '../character/CharacterPoseStateController';
import { CharacterRig } from '../character/CharacterRig';
import { applyCharacterSkin, CharacterSkinOutfit } from '../character/CharacterSkinApplier';
import { configureSwimmerSkinnedRenderers, findComponentRecursive, findNode, loadSwimmerPrefab, pruneNullComponentsInParentChain, pruneNullComponentsRecursive, setLayerRecursive } from '../character/CharacterModelLoader';
import { FreestylePoseController } from '../character/FreestylePoseController';
import { findSampledDebugAction } from '../character/SampledActionMotionCurve';
import type { SampledActionId } from '../character/SampledActionMotionCurve';
import { SplashEmitter } from '../character/SplashEmitter';
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
    private _perfectGlowShellRoot: Node = null;
    private _perfectGlowMaterial: Material = null;
    private _perfectGlowLoading = false;
    private _modelVariantId = defaultSwimmerModelVariant().id;
    private _modelLoadToken = 0;
    private _colorVariantId = defaultSwimmer0621ColorVariant().id;
    private _colorMask: Texture2D = null;
    private _dynamicColorEffect: EffectAsset = null;
    private _colorAssetLoadToken = 0;
    private _waterY = CHARACTER_POSE_TUNING.splashWaterY;
    private _debugActionPose: DebugSwimmerActionPose = 'freestyle';
    private _debugSampledActionId: SampledActionId | null = null;
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
        if (variant.id === 'swimmer0621_2') {
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
        return this.isBreaststrokeDebugPose() || this.isDivePrepDebugPose() || this.isSampledActionDebugPose();
    }

    get waterY(): number {
        return this._waterY;
    }

    getUpperBodyWorldPosition(out: Vec3): boolean {
        return this._pose.getUpperBodyWorldPosition(out);
    }

    setColorVariant(variantId: string): boolean {
        const variant = findSwimmer0621ColorVariant(variantId);
        if (!variant) {
            return false;
        }
        this._colorVariantId = variant.id;
        if (this._modelVariantId === 'swimmer0621_2') {
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
        if (this._modelDebugMode) {
            this.setModelDebugMode(true);
        }
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
            setLayerRecursive(this._model, Layers.Enum.DEFAULT);
            this._poseState.applyRaceModelSetup();

            this.root = findNode(this._model, 'Armature') || this._model;
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
                `skinned=${this._skinnedRenderers.length} baseEuler=${this._pose.rootBaseEuler.x.toFixed(1)},${this._pose.rootBaseEuler.y.toFixed(1)},${this._pose.rootBaseEuler.z.toFixed(1)}`,
            );
        }, variant.candidates);
    }

    private clearLoadedModel() {
        this._modelLoadToken++;
        this._loaded = false;
        this.root = null;
        this._skinnedRenderers.length = 0;
        this._animationPlayer.disable();
        this._animationPlayer.bind(null);
        this._perfectGlowIntensity = 0;
        this._perfectGlowLoading = false;
        this._perfectGlowMaterial = null;
        this._outlineRoot = null;
        if (this._perfectGlowShellRoot?.isValid) {
            this._perfectGlowShellRoot.destroy();
        }
        this._perfectGlowShellRoot = null;
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

        this._selfTime += dt;
        if (this._modelDebugMode) {
            return;
        }

        if (this._poseState.update(dt, this._animationPlayer.hasAnimation)) {
            return;
        }

    }

    resetPose() {
        if (!this._loaded || !this.root) {
            return;
        }
        this._armAction = 0;
        this._kickAction = 0;
        this._armCycleMotion = 0;
        this._leftHandWaterContact = 0;
        this._rightHandWaterContact = 0;
        this._leftHandWaterEntry = 0;
        this._rightHandWaterEntry = 0;
        this._leftHandWaterProgress = 0;
        this._rightHandWaterProgress = 0;
        this._splashMovementDirection = 1;
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
        if (active && this.node?.isValid && this._loaded && this._model && this.root) {
            this.ensurePerfectGlowShells();
        }
        if (changed) {
            this.updatePerfectGlowMaterial();
        }
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
        const colorVariant = findSwimmer0621ColorVariant(this._colorVariantId) ?? defaultSwimmer0621ColorVariant();
        const usesDynamicColor = this._modelVariantId === 'swimmer0621_2' && !!colorVariant.suit && !!colorVariant.cap;
        const resolvedSuitColor = usesDynamicColor
            ? new Color(...colorVariant.suit, 255)
            : suitColor;
        const resolvedCapColor = usesDynamicColor
            ? new Color(...colorVariant.cap, 255)
            : capColor;
        applyCharacterSkin({
            root: this.root,
            model: this._model,
            skinnedRenderers: this._skinnedRenderers,
            skinColor,
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
        const token = ++this._colorAssetLoadToken;
        const applyWhenReady = () => {
            if (token !== this._colorAssetLoadToken || !this._dynamicColorEffect) {
                return;
            }
            if (this._loaded && this.root) {
                this.applyLaneMaterials(this._skinColor, this._suitColor, this._capColor, this._robotStyle, this._playerOutline);
            }
        };
        loadRaceAsset(RESOURCE_PATHS.swimmer0621ColorMask, Texture2D, (error, texture) => {
            if (token !== this._colorAssetLoadToken || this._modelVariantId !== 'swimmer0621_2') {
                return;
            }
            if (error || !texture) {
                console.error('[SpeedSwimming] failed to load swimmer color mask', error);
                return;
            }
            this._colorMask = texture;
            applyWhenReady();
        });
        loadRaceAsset(RESOURCE_PATHS.swimmerDynamicColorEffect, EffectAsset, (error, effect) => {
            if (token !== this._colorAssetLoadToken || this._modelVariantId !== 'swimmer0621_2') {
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
        const variant = findSwimmer0621ColorVariant(this._colorVariantId);
        return !!variant?.suit && !!variant.cap;
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

    private applyModelDebugSetup() {
        if (!this._model || !this.root) {
            return;
        }
        const useBakedAnimation = this.isMixamoSwimmingDebugVariant();
        this.configureSkinnedRenderers(useBakedAnimation);
        this._poseState.applyRaceModelSetup();
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

    private ensurePerfectGlowShells() {
        if (this._perfectGlowShellRoot?.isValid || this._perfectGlowLoading) {
            return;
        }
        if (!this._model || this._skinnedRenderers.length <= 0) {
            return;
        }
        this._perfectGlowLoading = true;
        loadRaceAsset(RESOURCE_PATHS.swimmerPerfectGlowEffect, EffectAsset, (err, effect) => {
            this._perfectGlowLoading = false;
            if (err || !effect || !this.node?.isValid || !this._model?.isValid) {
                console.warn('[SpeedSwimming] failed to load perfect glow effect', err);
                return;
            }
            const material = new Material();
            material.initialize({ effectAsset: effect });
            material.name = 'SwimmerPerfectGlow';
            material.setProperty('lineWidth', 6);
            material.setProperty('flashStrength', this._perfectGlowIntensity);
            material.setProperty('baseColor', new Color(255, 198, 38, 255));
            this._perfectGlowMaterial = material;

            const root = new Node('SwimmerPerfectGlowShell');
            root.setParent(this._model);
            root.layer = Layers.Enum.DEFAULT;
            root.setPosition(0, 0, 0);
            root.setRotationFromEuler(0, 0, 0);
            root.setScale(1, 1, 1);
            this._perfectGlowShellRoot = root;

            for (const source of this._skinnedRenderers) {
                if (!source.node?.isValid || !source.mesh) {
                    continue;
                }
                const shellNode = new Node(`${source.node.name || 'Skin'}PerfectGlow`);
                const worldPosition = new Vec3();
                const worldRotation = new Quat();
                const worldScale = new Vec3();
                source.node.getWorldPosition(worldPosition);
                source.node.getWorldRotation(worldRotation);
                source.node.getWorldScale(worldScale);
                shellNode.setParent(root);
                shellNode.layer = Layers.Enum.DEFAULT;
                shellNode.setWorldPosition(worldPosition);
                shellNode.setWorldRotation(worldRotation);
                shellNode.setWorldScale(worldScale);
                const shell = shellNode.addComponent(SkinnedMeshRenderer);
                shell.mesh = source.mesh;
                shell.skeleton = source.skeleton;
                shell.skinningRoot = source.skinningRoot || this._model;
                shell.setUseBakedAnimation(false, true);
                shell.uploadAnimation(null);
                setAllRendererMaterialSlots(source, shell, material);
            }
            this.updatePerfectGlowMaterial();
        });
    }

    private updatePerfectGlowMaterial() {
        if (this._perfectGlowShellRoot?.isValid) {
            this._perfectGlowShellRoot.active = this._perfectGlowIntensity > 0.001;
        }
        if (this._perfectGlowMaterial) {
            this._perfectGlowMaterial.setProperty('flashStrength', this._perfectGlowIntensity);
        }
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

function setAllRendererMaterialSlots(source: SkinnedMeshRenderer, target: SkinnedMeshRenderer, material: Material) {
    let applied = false;
    for (let i = 0; i < 8; i++) {
        if (source.getSharedMaterial(i)) {
            target.setMaterial(material, i);
            applied = true;
        }
    }
    if (!applied) {
        target.setMaterial(material, 0);
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
