import { _decorator, Color, Component, EffectAsset, instantiate, JsonAsset, Material, Node, Quat, SkeletalAnimation, SkinnedMeshRenderer, Texture2D, Vec3, Vec4 } from 'cc';
import { CharacterAnimationPlayer } from '../character/CharacterAnimationPlayer';
import type { BreaststrokeBoneName, BreaststrokeMotionSample } from '../character/BreaststrokeMotionCurve';
import { sampledActionIdFor } from '../character/CharacterActionConfig';
import type { CharacterAction } from '../character/CharacterActionConfig';
import { CHARACTER_POSE_TUNING } from '../character/CharacterMotionTuning';
import { CharacterPoseStateController } from '../character/CharacterPoseStateController';
import { CharacterRig } from '../character/CharacterRig';
import { applyCharacterSkin, CharacterSkinOutfit } from '../character/CharacterSkinApplier';
import { DiveChargeGatherEffect } from '../character/DiveChargeGatherEffect';
import { collectComponentsRecursive, configureSwimmerSkinnedRenderers, findComponentRecursive, findNode, loadSwimmerPrefab, pruneNullComponentsInParentChain, pruneNullComponentsRecursive, setLayerRecursive } from '../character/CharacterModelLoader';
import type { DivePrepBoneName, DivePrepPoseSample } from '../character/DivePrepPoseCurve';
import { FreestylePoseController, ProceduralPoseSnapshot } from '../character/FreestylePoseController';
import { FLIP_TURN_KEYFRAME_1, FLIP_TURN_KEYFRAME_2 } from '../character/FlipTurnPoseCurve';
import { findSampledDebugAction, SAMPLED_ACTION_IDS } from '../character/SampledActionMotionCurve';
import type { SampledActionId, SampledActionMotion } from '../character/SampledActionMotionCurve';
import { SplashEmitter } from '../character/SplashEmitter';
import type { SplashEmitterState } from '../character/SplashEmitter';
import { UnderwaterBubbleEmitter } from '../character/UnderwaterBubbleEmitter';
import { SWIMMER_BALANCE } from '../core/GameBalance';
import { StrokeType } from '../core/GameConstants';
import { MOTION_TUNING } from '../core/InputTuning';
import { PERFORMANCE_CONFIG } from '../core/PerformanceConfig';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { defaultSwimmerColorVariant, defaultSwimmerModelVariant, findSwimmerColorVariant, findSwimmerModelVariant, isDebugOnlySwimmerModelVariant, RESOURCE_PATHS } from '../core/ResourcePaths';
import type { DebugSwimmerActionPose } from '../core/ResourcePaths';
import type { SwimmerMotor } from '../swimmer/SwimmerMotor';

const { ccclass } = _decorator;

// Spreads background-AI pose updates across frames so throttled swimmers don't all recompute their
// skeleton on the same frame (avoids a periodic per-frame spike). Incremented once per AI rig.
// 让背景 AI 的姿态更新错峰分布到不同帧，避免降频选手在同一帧集中重算骨骼（消除周期性的单帧尖峰）。每个 AI rig 自增一次。
let _backgroundMotionPhaseSeed = 0;

const TREAD_WATER_OVERRIDE_BONES: readonly BreaststrokeBoneName[] = [
    'Root', 'Hip', 'Waist', 'Spine01', 'Spine02', 'NeckTwist01', 'Head',
    'L_Clavicle', 'L_Upperarm', 'L_Forearm', 'L_Hand',
    'R_Clavicle', 'R_Upperarm', 'R_Forearm', 'R_Hand',
    'L_Thigh', 'L_Calf', 'L_Foot', 'L_ToeBase',
    'R_Thigh', 'R_Calf', 'R_Foot', 'R_ToeBase',
];

const DIVE_PREP_OVERRIDE_BONES: readonly DivePrepBoneName[] = [
    'Root', 'Hip', 'Waist', 'Spine01', 'Spine02', 'NeckTwist01', 'Head',
    'L_Clavicle', 'L_Upperarm', 'L_Forearm', 'L_Hand',
    'R_Clavicle', 'R_Upperarm', 'R_Forearm', 'R_Hand',
    'L_Thigh', 'L_Calf', 'L_Foot', 'L_ToeBase',
    'R_Thigh', 'R_Calf', 'R_Foot', 'R_ToeBase',
];

const finiteTuple = (tuple: unknown, length: number): boolean =>
    Array.isArray(tuple)
    && tuple.length === length
    && tuple.every((component) => typeof component === 'number' && Number.isFinite(component));

function parseTreadWaterOverride(value: unknown): readonly BreaststrokeMotionSample[] | null {
    const data = value as { id?: unknown; samples?: unknown } | null;
    if (!data || data.id !== 'breaststroke' || !Array.isArray(data.samples) || data.samples.length === 0) {
        return null;
    }
    for (const sampleValue of data.samples) {
        const sample = sampleValue as {
            phase?: unknown;
            root?: unknown;
            head?: unknown;
            hand?: unknown;
            foot?: unknown;
            rotations?: Record<string, unknown>;
        } | null;
        if (!sample
            || typeof sample.phase !== 'number'
            || !Number.isFinite(sample.phase)
            || !finiteTuple(sample.root, 3)
            || !finiteTuple(sample.head, 3)
            || !finiteTuple(sample.hand, 3)
            || !finiteTuple(sample.foot, 3)
            || !sample.rotations
            || TREAD_WATER_OVERRIDE_BONES.some((boneName) => !finiteTuple(sample.rotations?.[boneName], 4))) {
            return null;
        }
    }
    return data.samples as BreaststrokeMotionSample[];
}

function parseDivePrepOverride(value: unknown): DivePrepPoseSample | null {
    const data = value as (DivePrepPoseSample & {
        id?: unknown;
        rotationSpace?: unknown;
    }) | null;
    if (!data
        || data.id !== 'divePrep'
        || data.rotationSpace !== 'base-relative'
        || !finiteTuple(data.root, 3)
        || !finiteTuple(data.head, 3)
        || !finiteTuple(data.leftHand, 3)
        || !finiteTuple(data.rightHand, 3)
        || !finiteTuple(data.leftFoot, 3)
        || !finiteTuple(data.rightFoot, 3)
        || !data.rotations
        || DIVE_PREP_OVERRIDE_BONES.some((boneName) => !finiteTuple(data.rotations[boneName], 4))) {
        return null;
    }
    return data;
}

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
const SKILL_DASH_GLOW_COLOR = new Color(88, 224, 255, 255);
const DIVE_CHARGE_BLUE = new Color(48, 198, 255, 255);
const DIVE_CHARGE_YELLOW = new Color(255, 218, 42, 255);
const DIVE_CHARGE_RED = new Color(255, 54, 24, 255);
const DIVE_CHARGE_VISUAL_INTERVAL_SECONDS = 1 / 30;
const DIVE_CHARGE_POWER_STEPS = 20;

@ccclass('CartoonSwimmerRig')
export class CartoonSwimmerRig extends Component implements CharacterRig {
    public root: Node = null;
    public splashNode: Node = null;

    private _model: Node = null;
    private _splashEmitter: SplashEmitter = null;
    private _bubbleEmitter: UnderwaterBubbleEmitter = null;
    private readonly _splashState: SplashEmitterState = {
        armAction: 0,
        kickAction: 0,
        armCycleMotion: 0,
        kickCycleMotion: 0,
        movementDirection: 1,
        movementHeadingRadians: 0,
        legSplashSuppressed: false,
        leftHandWaterContact: 0,
        rightHandWaterContact: 0,
        leftHandWaterEntry: 0,
        rightHandWaterEntry: 0,
        leftHandWaterProgress: 0,
        rightHandWaterProgress: 0,
    };
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
    // A freshly instantiated skinned GLB can render its bind pose for one frame
    // before Cocos uploads the joint matrices written by the procedural pose.
    // Keep its renderers hidden through one complete update/late-update cycle.
    private _rendererRevealFramesRemaining = 0;
    private _castsShadow = false;
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
    // Networked remote copies: the OWNER's authoritative swim speed drives the
    // tread-water<->freestyle blend instead of this copy's local motor speed (which
    // jitters over the network). -1 = no override (single-player / local player).
    private _treadSpeedOverride = -1;
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
    private _skillDashGlowIntensity = 0;
    private _bodyFeedbackEnabled = true;
    private _perfectGlowMaterial: Material = null;
    private readonly _perfectGlowRestoreSlots: FlashRestoreSlot[] = [];
    private _collisionFlashTimer = 0;
    private _diveChargeGatherEffect: DiveChargeGatherEffect | null = null;
    private _diveChargeRequestedActive = false;
    private _diveChargeRequestedPower = 0;
    private _diveChargeVisualElapsed = 0;
    private _diveChargeReleaseBurstRemaining = 0;
    private readonly _diveChargeWorldCenter = new Vec3();
    private readonly _diveChargeBodyMaterials: Material[] = [];
    private readonly _diveChargeBodyParams = new Vec4(0, 0, 0.90, 15);
    private readonly _diveChargeRimParams = new Vec4(4, 1, 0, 0);
    private _modelVariantId = defaultSwimmerModelVariant().id;
    private _modelLoadToken = 0;
    private _colorVariantId = defaultSwimmerColorVariant().id;
    private _colorOverride: { skin?: Color; suit?: Color; cap?: Color } | null = null;
    private _colorMask: Texture2D = null;
    private _dynamicColorEffect: EffectAsset = null;
    private _colorAssetLoadToken = 0;
    private _waterY = CHARACTER_POSE_TUNING.splashWaterY;
    private _waterlineEffectEnabled = true;
    private _debugActionPose: DebugSwimmerActionPose = 'freestyle';
    private _debugSampledActionId: SampledActionId | null = null;
    private readonly _sampledActionOverrides = new Map<SampledActionId, SampledActionMotion>();
    private _sampledActionOverrideLoadToken = 0;
    private _showcaseActionId: SampledActionId = 'waving';
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
    private _lastTreadModelY = Number.NaN;
    private _lastTreadModelEulerX = Number.NaN;
    private _lastTreadModelEulerY = Number.NaN;
    private _lastTreadModelEulerZ = Number.NaN;

    build(
        skinColor: Color,
        suitColor: Color,
        capColor: Color,
        robotStyle = false,
        playerOutline = false,
        reducedSplash = false,
        enableSplash = true,
    ) {
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

        if (enableSplash) {
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
            // Underwater bubbles: player only (skip reduced-LOD AI). Parented under
            // the splash node so it inherits the swimmer overlay-layer tagging and
            // is drawn over the opaque underwater surface.
            if (!reducedSplash) {
                this._bubbleEmitter = new UnderwaterBubbleEmitter({
                    parent: this.splashNode || this.node,
                    name: `${this.node.name || 'Swimmer'}Bubbles`,
                    getBoneWorldPosition: (name, out) => this.getSplashBoneWorldPosition(name, out),
                });
                this._bubbleEmitter.build();
            }
        }

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

    getModelWorldPivot(out: Vec3): boolean {
        // Imported armature roots are commonly offset behind the character.
        // Prefer the hip for presentation rotation: it lies on the body's
        // vertical centreline and stays stable while a showcase action moves
        // the head and arms.
        if (this._pose.getHipWorldPosition(out)) {
            return true;
        }
        if (!this.root?.isValid) {
            return false;
        }
        this.root.getWorldPosition(out);
        return true;
    }

    getGroundContactWorldPosition(out: Vec3): boolean {
        const count = this._pose.getFlipTurnFootContactWorldPositions(this._tmpFlipTurnContactWorld);
        if (count <= 0) {
            return false;
        }
        let x = 0;
        let z = 0;
        let lowestY = Number.POSITIVE_INFINITY;
        for (let index = 0; index < count; index++) {
            const contact = this._tmpFlipTurnContactWorld[index];
            x += contact.x;
            z += contact.z;
            lowestY = Math.min(lowestY, contact.y);
        }
        out.set(x / count, lowestY - 0.012, z / count);
        return true;
    }

    // A presentation-only render proxy reuses this rig's live skeleton. The
    // locker-room UI renders it into a RenderTexture as a real-time silhouette.
    createShadowSilhouetteProxy(parent: Node, material: Material, layer: number): Node | null {
        if (!this._model || this._skinnedRenderers.length <= 0) {
            return null;
        }
        const root = new Node('SwimmerPlanarShadowProxy');
        root.layer = layer;
        root.setParent(parent);
        for (const source of this._skinnedRenderers) {
            if (!source.node?.isValid || !source.mesh) {
                continue;
            }
            const shadowNode = new Node(`${source.node.name || 'Skin'}PlanarShadow`);
            shadowNode.layer = layer;
            shadowNode.setParent(root);
            shadowNode.setWorldPosition(source.node.worldPosition);
            shadowNode.setWorldRotation(source.node.worldRotation);
            shadowNode.setWorldScale(source.node.worldScale);
            const renderer = shadowNode.addComponent(SkinnedMeshRenderer);
            renderer.mesh = source.mesh;
            renderer.skeleton = source.skeleton;
            renderer.skinningRoot = source.skinningRoot || this._model;
            renderer.setUseBakedAnimation(false, true);
            renderer.uploadAnimation(null);
            renderer.shadowCastingMode = 0;
            renderer.setMaterial(material, 0);
        }
        return root;
    }

    get usesDebugAnimationClip(): boolean {
        return false;
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
        const variant = findSwimmerColorVariant(variantId);
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

    setColorOverride(override: { skin?: Color; suit?: Color; cap?: Color } | null) {
        this._colorOverride = override
            ? { skin: override.skin?.clone(), suit: override.suit?.clone(), cap: override.cap?.clone() }
            : null;
        if (this._loaded && this.root) {
            this.applyLaneMaterials(this._skinColor, this._suitColor, this._capColor, this._robotStyle, this._playerOutline);
        }
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
        this.invalidateTreadBlendModelPlacement();
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
            // Most canonical T-pose exports name that child `Armature`, but a valid
            // export may use another armature name. Falling back to the prefab
            // wrapper makes tread water write its pose rotation onto
            // the same node used for upright model placement, so the pose update
            // immediately overwrites the upright rotation. Resolve the armature
            // generically from the parent of the canonical `Root` bone instead.
            const rootBone = findNode(this._model, 'Root');
            this.root = findNode(this._model, 'Armature') || rootBone?.parent || this._model;
            this._pose.setModelVariantId(variant.id);
            this._pose.bind(this.root);
            this._pose.setSwimHeadLift(this.swimHeadLiftDegrees());
            this.configureSkinnedRenderers();
            this.setSkinnedRenderersEnabled(false);
            this.applyLaneMaterials(this._skinColor, this._suitColor, this._capColor, this._robotStyle, this._playerOutline);
            this._animationPlayer.bind(findComponentRecursive(this._model, SkeletalAnimation), false);
            this._pose.captureBasePose();
            this.refreshShowcaseAction();
            this.loadSampledActionOverrides(variant, token);
            this._loaded = true;
            this.resetPose();
            if (this._modelDebugMode) {
                this.applyModelDebugSetup();
            } else {
                this._poseState.reapplyCurrentState();
            }
            this._rendererRevealFramesRemaining = 2;
            console.log(
                `[SpeedSwimming] loaded athlete variant=${variant.id} prefab=${result.path} joints=${this.boundJointCount} manualBones=${this.manualBoneCount} clips=${this.animationClipNames} ` +
                `skinned=${this._skinnedRenderers.length} rigRoot=${this.root.name} ` +
                `baseEuler=${this._pose.rootBaseEuler.x.toFixed(1)},${this._pose.rootBaseEuler.y.toFixed(1)},${this._pose.rootBaseEuler.z.toFixed(1)}`,
            );
        }, variant.candidates);
    }

    private clearLoadedModel() {
        this.restorePerfectGlowMaterials();
        this._diveChargeBodyMaterials.length = 0;
        this._modelLoadToken++;
        this._sampledActionOverrideLoadToken++;
        this._sampledActionOverrides.clear();
        this._pose.setBreaststrokeSamplesOverride(null);
        this._pose.setDivePrepPoseOverride(null);
        this._poseState.setShowcaseAction(this._showcaseActionId, null);
        this._loaded = false;
        this._rendererRevealFramesRemaining = 0;
        this.root = null;
        this._skinnedRenderers.length = 0;
        this._animationPlayer.disable();
        this._animationPlayer.bind(null);
        this._perfectGlowIntensity = 0;
        this._skillDashGlowIntensity = 0;
        this._collisionFlashTimer = 0;
        this._outlineRoot = null;
        if (this._model?.isValid) {
            this._model.destroy();
        }
        this._model = null;
    }

    private sampledDebugAction(actionId: SampledActionId): SampledActionMotion | null {
        const variant = findSwimmerModelVariant(this._modelVariantId);
        if (variant?.sampledActionOverrideDir) {
            // A rig with its own bind basis must never silently fall back to the
            // canonical curve: that is exactly how flipped forearms/hands are
            // introduced while the asynchronous override load is still pending.
            return this._sampledActionOverrides.get(actionId) ?? null;
        }
        return findSampledDebugAction(actionId);
    }

    private refreshShowcaseAction(): boolean {
        return this._poseState.setShowcaseAction(
            this._showcaseActionId,
            this.sampledDebugAction(this._showcaseActionId),
        );
    }

    private loadSampledActionOverrides(variant: ReturnType<typeof defaultSwimmerModelVariant>, modelLoadToken: number) {
        this._sampledActionOverrides.clear();
        this._pose.setBreaststrokeSamplesOverride(null);
        this._pose.setDivePrepPoseOverride(null);
        const directory = variant.sampledActionOverrideDir;
        const filePrefix = variant.sampledActionOverrideFilePrefix;
        const divePrepPath = variant.divePrepOverridePath;
        if (!directory || !filePrefix) {
            return;
        }
        // This rig cannot safely use the canonical tread-water local rotations.
        // Hold its captured base pose until the rig-profile curves arrive.
        this._pose.setBreaststrokeSamplesOverride([]);
        this._pose.setDivePrepPoseOverride(null);
        const overrideToken = ++this._sampledActionOverrideLoadToken;
        let remaining = SAMPLED_ACTION_IDS.length + 1 + (divePrepPath ? 1 : 0);
        let failed = false;
        let treadWaterSampleCount = 0;
        let divePrepLoaded = false;
        const finishOne = () => {
            remaining -= 1;
            if (remaining > 0) {
                return;
            }
            if (failed
                || this._sampledActionOverrides.size !== SAMPLED_ACTION_IDS.length
                || treadWaterSampleCount <= 0
                || (!!divePrepPath && !divePrepLoaded)) {
                console.error(
                    `[SpeedSwimming] sampled action overrides incomplete variant=${variant.id} ` +
                    `emotes=${this._sampledActionOverrides.size}/${SAMPLED_ACTION_IDS.length} ` +
                    `treadWaterSamples=${treadWaterSampleCount} ` +
                    `divePrep=${divePrepPath ? divePrepLoaded : 'default'}`,
                );
                return;
            }
            console.log(
                `[SpeedSwimming] sampled action overrides loaded variant=${variant.id} ` +
                `emotes=${this._sampledActionOverrides.size} treadWaterSamples=${treadWaterSampleCount} ` +
                `divePrep=${divePrepPath ? divePrepLoaded : 'default'}`,
            );
            this.refreshShowcaseAction();
            if (this._modelDebugMode) {
                if (this._debugActionPose === 'sampledAction'
                    || this._debugActionPose === 'breaststroke'
                    || this._debugActionPose === 'divePrep') {
                    this.applyModelDebugSetup();
                }
            } else {
                this._poseState.reapplyCurrentState();
            }
        };
        for (const actionId of SAMPLED_ACTION_IDS) {
            loadRaceAsset(`${directory}/${filePrefix}${actionId}`, JsonAsset, (error, asset) => {
                if (overrideToken !== this._sampledActionOverrideLoadToken || modelLoadToken !== this._modelLoadToken) {
                    return;
                }
                if (error || !asset) {
                    failed = true;
                    console.error(`[SpeedSwimming] sampled action override load failed variant=${variant.id} action=${actionId}`, error);
                } else {
                    const action = asset.json as SampledActionMotion;
                    if (action && SAMPLED_ACTION_IDS.indexOf(action.id) >= 0 && Array.isArray(action.samples) && action.samples.length > 0) {
                        this._sampledActionOverrides.set(action.id, action);
                        if (action.id === this._showcaseActionId) {
                            this.refreshShowcaseAction();
                        }
                    } else {
                        failed = true;
                        console.error(`[SpeedSwimming] sampled action override is invalid variant=${variant.id} action=${actionId}`);
                    }
                }
                finishOne();
            });
        }
        loadRaceAsset(`${directory}/${filePrefix}breaststroke`, JsonAsset, (error, asset) => {
            if (overrideToken !== this._sampledActionOverrideLoadToken || modelLoadToken !== this._modelLoadToken) {
                return;
            }
            const samples = !error && asset ? parseTreadWaterOverride(asset.json) : null;
            if (!samples) {
                failed = true;
                console.error(
                    `[SpeedSwimming] tread-water override load failed variant=${variant.id}`,
                    error,
                );
            } else {
                treadWaterSampleCount = samples.length;
                this._pose.setBreaststrokeSamplesOverride(samples);
            }
            finishOne();
        });
        if (divePrepPath) {
            loadRaceAsset(divePrepPath, JsonAsset, (error, asset) => {
                if (overrideToken !== this._sampledActionOverrideLoadToken || modelLoadToken !== this._modelLoadToken) {
                    return;
                }
                const sample = !error && asset ? parseDivePrepOverride(asset.json) : null;
                if (!sample) {
                    failed = true;
                    console.error(
                        `[SpeedSwimming] dive-prep override load failed variant=${variant.id}`,
                        error,
                    );
                } else {
                    divePrepLoaded = true;
                    this._pose.setDivePrepPoseOverride(sample);
                }
                finishOne();
            });
        }
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
            this.invalidateTreadBlendModelPlacement();
            this._poseState.enterFreestyle();
        } else {
            this._poseState.enterPreview();
            this.resetPose();
        }
    }

    setSkillDashActive(active: boolean) {
        if (this._modelDebugMode || active === this._poseState.isSkillDashActive) {
            return;
        }
        this._animationPlayer.stop();
        if (active) {
            this._poseState.enterSkillDash(0.08);
        } else {
            this._poseState.enterFreestyle(0.08);
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
        if (this._legSplashSuppressed === suppressed) {
            return;
        }
        this._legSplashSuppressed = suppressed;
        this.syncSplashState();
    }

    setSplashCulled(culled: boolean) {
        if (this._splashCulled === culled) {
            return;
        }
        this._splashCulled = culled;
        this._splashEmitter?.setCulled(culled);
    }

    // The race uses a world-space waterline shader, while presentation spaces
    // such as the locker room reuse the same character rig without any pool.
    // Keep that material effect independent from splash visibility.
    setWaterlineEffectEnabled(enabled: boolean) {
        if (this._waterlineEffectEnabled === enabled) {
            return;
        }
        this._waterlineEffectEnabled = enabled;
        if (this._loaded && this.root) {
            this.applyLaneMaterials(this._skinColor, this._suitColor, this._capColor, this._robotStyle, this._playerOutline);
        }
    }

    setCastShadow(enabled: boolean) {
        this._castsShadow = enabled;
        for (const renderer of this._skinnedRenderers) {
            renderer.shadowCastingMode = enabled ? 1 : 0;
        }
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
        this._showcaseActionId = sampledActionIdFor(action);
        return this.refreshShowcaseAction();
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

    // Networked remote copy: drive the tread-water<->freestyle blend from the OWNER's
    // authoritative speed (m/s) instead of this copy's local motor speed. Pass a
    // negative value to clear the override (local player / single-player).
    setTreadWaterSpeedOverride(speed: number) {
        this._treadSpeedOverride = speed;
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
        if (this._poseState.isSkillDashActive) {
            this._pose.applyWaveDashPose();
            this._leftHandWaterContact = 0;
            this._rightHandWaterContact = 0;
            this._leftHandWaterEntry = 0;
            this._rightHandWaterEntry = 0;
            this.updateSplashSurface(speed);
            return;
        }
        this.updateArmCycleMotion(dt, leftArmCycle, rightArmCycle);
        this.updateKickCycleMotion(dt, leftKickCycle, rightKickCycle);

        // Remote copies drive the tread-water decision from the owner's authoritative
        // speed (synced) so the pose can't say "treading water" while the corrected
        // position slides forward. Arm/kick cadence still comes from the replayed input.
        const treadSpeed = this._treadSpeedOverride >= 0 ? this._treadSpeedOverride : speed;
        const treadWeight = this.updateTreadWaterBlend(dt, treadSpeed);
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
        const w = weight <= 0.001 ? 0 : Math.max(0, Math.min(1, weight));
        const treadY = CHARACTER_POSE_TUNING.raceModelBaseY + CHARACTER_POSE_TUNING.raceTreadModelYOffset + MOTION_TUNING.swimBodyYOffset;
        const treadEuler = CHARACTER_POSE_TUNING.raceTreadModelEuler;
        const y = w === 0 ? raceY : lerpScalar(raceY, treadY, w);
        const eulerX = w === 0 ? raceEuler[0] : lerpScalar(raceEuler[0], treadEuler[0], w);
        const eulerY = w === 0 ? raceEuler[1] : lerpScalar(raceEuler[1], treadEuler[1], w);
        const eulerZ = w === 0 ? raceEuler[2] : lerpScalar(raceEuler[2], treadEuler[2], w);
        if (y !== this._lastTreadModelY) {
            this._model.setPosition(0, y, 0);
            this._lastTreadModelY = y;
        }
        if (eulerX !== this._lastTreadModelEulerX
            || eulerY !== this._lastTreadModelEulerY
            || eulerZ !== this._lastTreadModelEulerZ) {
            this._model.setRotationFromEuler(eulerX, eulerY, eulerZ);
            this._lastTreadModelEulerX = eulerX;
            this._lastTreadModelEulerY = eulerY;
            this._lastTreadModelEulerZ = eulerZ;
        }
    }

    private invalidateTreadBlendModelPlacement() {
        this._lastTreadModelY = Number.NaN;
        this._lastTreadModelEulerX = Number.NaN;
        this._lastTreadModelEulerY = Number.NaN;
        this._lastTreadModelEulerZ = Number.NaN;
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
            const action = this.sampledDebugAction(this._debugSampledActionId);
            if (!action) {
                return;
            }
            const cycleSeconds = action.durationSeconds / Math.max(0.25, this.motionPreviewSpeedScale());
            const phase = positiveMod(this._selfTime / Math.max(0.1, cycleSeconds), 1);
            this._pose.applySampledActionPose(action.id, phase, 1, action);
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

        if (this._diveChargeRequestedActive) {
            this.updateDiveChargeVisual(dt);
        }
        if (this._diveChargeReleaseBurstRemaining > 0) {
            this._diveChargeReleaseBurstRemaining = Math.max(0, this._diveChargeReleaseBurstRemaining - Math.max(0, dt));
            if (this._diveChargeReleaseBurstRemaining <= 0) {
                this._diveChargeGatherEffect?.destroy();
                this._diveChargeGatherEffect = null;
            }
        }

        if (this._bodyFeedbackEnabled && (this._perfectGlowIntensity > 0 || this._skillDashGlowIntensity > 0 || this._collisionFlashTimer > 0)) {
            this._collisionFlashTimer = Math.max(0, this._collisionFlashTimer - dt);
            this.updatePerfectGlowMaterial();
        }

        this._selfTime += dt;
        if (this._modelDebugMode) {
            return;
        }

        let poseDt = dt;
        if (this._backgroundSwimmer && this._poseState.isPresentationMotionActive) {
            poseDt = this.consumeThrottledMotionDt(dt);
            if (poseDt < 0) {
                return;
            }
        }
        if (this._poseState.update(poseDt, this._animationPlayer.hasAnimation)) {
            return;
        }

    }

    lateUpdate() {
        if (this._rendererRevealFramesRemaining <= 0 || !this._loaded || !this._model?.isValid) {
            return;
        }
        this._rendererRevealFramesRemaining--;
        if (this._rendererRevealFramesRemaining <= 0) {
            this.setSkinnedRenderersEnabled(true);
        }
    }

    onDestroy() {
        this._modelLoadToken += 1;
        this._colorAssetLoadToken += 1;
        this._diveChargeBodyMaterials.length = 0;
        this._diveChargeGatherEffect?.destroy();
        this._diveChargeGatherEffect = null;
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
        this._treadSpeedOverride = -1;
        this.invalidateTreadBlendModelPlacement();
        this._poseState.resetRuntime();
        this._splashEmitter?.reset();
        this._pose.restoreBasePose();
        this.updateSplashSurface(0);
    }

    setModelDebugMode(active: boolean) {
        this._modelDebugMode = active;
        this._animationPlayer.disable();
        const useBakedAnimation = false;
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

    // Big exaggerated one-shot surface plume for the dolphin-jump take-off and
    // landing (all emitters fire, bypassing entry gating and leg suppression).
    triggerBigSplash(scale = 1, force = false) {
        this._splashEmitter?.triggerBigSurfaceBurst(scale, force);
    }

    setPerfectGlowActive(active: boolean) {
        const intensity = active ? 1 : 0;
        const changed = this._perfectGlowIntensity !== intensity;
        this._perfectGlowIntensity = intensity;
        if (changed && this._bodyFeedbackEnabled) {
            this.updatePerfectGlowMaterial();
        }
    }

    setSkillDashGlowActive(active: boolean) {
        const intensity = active ? 1 : 0;
        if (this._skillDashGlowIntensity === intensity) {
            return;
        }
        this._skillDashGlowIntensity = intensity;
        if (this._bodyFeedbackEnabled) {
            this.updatePerfectGlowMaterial();
        }
    }

    // Start-dive charge feedback. Body materials carry a subtle Screen glow;
    // a single pooled mesh supplies the converging rays and launch burst.
    setDiveChargeEffect(power: number, active: boolean) {
        const nextPower = Math.max(0, Math.min(1, power));
        if (this._diveChargeRequestedActive === active && this._diveChargeRequestedPower === nextPower) {
            return;
        }
        // A rematch can replace renderer-local material instances. Rebind the
        // next time charging begins rather than writing into detached instances.
        if (active && !this._diveChargeRequestedActive) {
            this._diveChargeBodyMaterials.length = 0;
        }
        this._diveChargeRequestedActive = active;
        this._diveChargeRequestedPower = nextPower;
        if (!active) {
            this._diveChargeVisualElapsed = 0;
            this.applyDiveChargeVisual(0, false);
        }
    }

    clearDiveChargeEffect(restoreRim = true) {
        if (!this._diveChargeRequestedActive
            && !this._diveChargeGatherEffect
            && this._diveChargeBodyParams.x <= 0
            && (restoreRim ? this._diveChargeRimParams.y >= 1 : this._diveChargeRimParams.y < 1)) {
            this._diveChargeBodyMaterials.length = 0;
            return;
        }
        this._diveChargeRequestedActive = false;
        this._diveChargeRequestedPower = 0;
        this._diveChargeVisualElapsed = 0;
        this._diveChargeReleaseBurstRemaining = 0;
        this.applyDiveChargeBodyMaterial(0, 0, false, restoreRim);
        this._diveChargeBodyMaterials.length = 0;
        this._diveChargeGatherEffect?.destroy();
        this._diveChargeGatherEffect = null;
    }

    releaseDiveChargeEffect(duration?: number) {
        this._diveChargeRequestedActive = false;
        this._diveChargeRequestedPower = 0;
        this._diveChargeVisualElapsed = 0;
        // Keep the normal rim off through the release and flight. It is a
        // skinned-material effect, so restoring it here looks like a white
        // charge light following the airborne character.
        this.applyDiveChargeBodyMaterial(0, 0, false, false);
        this._diveChargeBodyMaterials.length = 0;
        const gather = this._diveChargeGatherEffect;
        if (gather && this._pose.getUpperBodyWorldPosition(this._diveChargeWorldCenter)) {
            gather.setWorldPosition(this._diveChargeWorldCenter);
        }
        this._diveChargeReleaseBurstRemaining = gather?.releaseBurst(duration) ?? 0;
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
    }

    setDebugMotionSpeedScale(scale: number) {
        this._debugMotionSpeedScale = Math.max(0.1, Math.min(1.5, scale));
    }

    private applyLaneMaterials(skinColor: Color, suitColor: Color, capColor: Color, robotStyle: boolean, playerOutline: boolean) {
        if (!this._model || !this.root) {
            return;
        }
        this.restorePerfectGlowMaterials();
        this._diveChargeBodyMaterials.length = 0;
        const modelVariant = findSwimmerModelVariant(this._modelVariantId) ?? defaultSwimmerModelVariant();
        const colorVariant = findSwimmerColorVariant(this._colorVariantId) ?? defaultSwimmerColorVariant();
        const override = this._colorOverride;
        const usesDynamicColor = !!modelVariant.dynamicColor
            && (!!override?.skin || !!override?.suit || (modelVariant.dynamicColor.usesCapChannel && !!override?.cap)
                || !!colorVariant.suit || (modelVariant.dynamicColor.usesCapChannel && !!colorVariant.cap));
        const resolvedSkinColor = override?.skin ?? new Color(skinColor.r, skinColor.g, skinColor.b, 0);
        const resolvedSuitColor = override?.suit ?? (colorVariant.suit
            ? new Color(...colorVariant.suit, 255)
            : new Color(suitColor.r, suitColor.g, suitColor.b, 0));
        const resolvedCapColor = override?.cap ?? (colorVariant.cap
            ? new Color(...colorVariant.cap, 255)
            : new Color(capColor.r, capColor.g, capColor.b, 0));
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
            dynamicColorMode: modelVariant.dynamicColor?.mode ?? 'mask',
            waterLine: this._waterlineEffectEnabled ? this._waterY : undefined,
            outlineRoot: this._outlineRoot,
            setOutlineRoot: (root) => {
                this._outlineRoot = root;
            },
        });
        // Dynamic-color assets can finish loading while the swimmer is in the
        // air. Rebind the current charge/rim state onto the fresh material
        // instances so their effect defaults cannot re-enable the blue-white
        // rim before the dive has entered the water.
        const chargeStillActive = this._diveChargeRequestedActive && this._diveChargeBodyParams.x > 0;
        this.applyDiveChargeBodyMaterial(
            chargeStillActive ? this._diveChargeBodyParams.x : 0,
            chargeStillActive ? this._diveChargeBodyParams.y : 0,
            chargeStillActive,
            this._diveChargeRimParams.y >= 1,
        );
        this.updatePerfectGlowMaterial();
    }

    private updateDiveChargeVisual(dt: number) {
        this._diveChargeVisualElapsed += Math.max(0, dt);
        if (this._diveChargeVisualElapsed < DIVE_CHARGE_VISUAL_INTERVAL_SECONDS) {
            return;
        }
        this._diveChargeVisualElapsed %= DIVE_CHARGE_VISUAL_INTERVAL_SECONDS;
        const quantizedPower = Math.round(this._diveChargeRequestedPower * DIVE_CHARGE_POWER_STEPS) / DIVE_CHARGE_POWER_STEPS;
        this.applyDiveChargeVisual(0.35 + quantizedPower * 0.65, true);
    }

    private applyDiveChargeVisual(intensity: number, active: boolean) {
        this.applyDiveChargeBodyMaterial(intensity, this._diveChargeRequestedPower, active);
        if (active && !this._diveChargeGatherEffect) {
            this._diveChargeGatherEffect = new DiveChargeGatherEffect(this.node);
        }
        const gather = this._diveChargeGatherEffect;
        if (!gather) {
            return;
        }
        gather.setCharge(intensity, this._diveChargeRequestedPower);
        gather.setActive(active);
        if (active && this._pose.getUpperBodyWorldPosition(this._diveChargeWorldCenter)) {
            gather.setWorldPosition(this._diveChargeWorldCenter);
        }
    }

    private applyDiveChargeBodyMaterial(intensity: number, progress: number, active: boolean, restoreRim = true) {
        if (this._diveChargeBodyMaterials.length <= 0) {
            this.bindDiveChargeBodyMaterials();
        }
        this._diveChargeBodyParams.x = active ? intensity : 0;
        this._diveChargeBodyParams.y = active ? Math.max(0, Math.min(1, progress)) : 0;
        this._diveChargeRimParams.y = active || !restoreRim ? 0 : 1;
        for (const material of this._diveChargeBodyMaterials) {
            if (!material?.isValid) {
                continue;
            }
            material.setProperty('chargeParams', this._diveChargeBodyParams);
            material.setProperty('rimParams', this._diveChargeRimParams);
        }
    }

    private bindDiveChargeBodyMaterials() {
        for (const renderer of this._skinnedRenderers) {
            if (!renderer?.isValid || !renderer.node?.isValid) {
                continue;
            }
            const slotCount = Math.max(1, renderer.sharedMaterials.length);
            for (let index = 0; index < slotCount; index++) {
                const shared = renderer.getSharedMaterial(index);
                if (!shared?.isValid) {
                    continue;
                }
                let supportsCharge = false;
                for (const pass of shared.passes) {
                    if (pass.getHandle('chargeParams')) {
                        supportsCharge = true;
                        break;
                    }
                }
                if (!supportsCharge) {
                    continue;
                }
                const material = renderer.getMaterialInstance(index);
                if (!material?.isValid) {
                    continue;
                }
                material.setProperty('chargeBlue', DIVE_CHARGE_BLUE);
                material.setProperty('chargeYellow', DIVE_CHARGE_YELLOW);
                material.setProperty('chargeRed', DIVE_CHARGE_RED);
                this._diveChargeBodyMaterials.push(material);
            }
        }
    }

    private storeSkinSettings(skinColor: Color, suitColor: Color, capColor: Color, robotStyle: boolean, playerOutline: boolean) {
        this._skinColor = skinColor.clone();
        this._suitColor = suitColor.clone();
        this._capColor = capColor.clone();
        this._robotStyle = robotStyle;
        this._playerOutline = playerOutline;
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
        if (dynamicColor.mode === 'mask' && dynamicColor.maskPath) {
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
        }
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
        const variant = findSwimmerColorVariant(this._colorVariantId);
        return !!variant?.suit
            || (dynamicColor.usesCapChannel && !!variant?.cap);
    }

    private supportsDynamicColor(): boolean {
        return !!findSwimmerModelVariant(this._modelVariantId)?.dynamicColor;
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

    private motionPreviewSpeedScale(): number {
        return this._modelDebugMode ? this._debugMotionSpeedScale : 1;
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
        this.configureSkinnedRenderers(false);
        this._poseState.applyRaceModelSetup();
        if (this.isFlipTurnDebugPose()) {
            this.setupDebugFlipTurn();
            console.log(
                `[SpeedSwimming] model debug uses sampled flip-turn keyframes ` +
                `bones=${this.manualBoneCount} skinned=${this._skinnedRenderers.length}`,
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
            const action = this.sampledDebugAction(this._debugSampledActionId);
            if (action) {
                this._pose.applySampledActionPose(action.id, 0, 1, action);
            }
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

    // Drive the player's underwater bubble trail. Called every frame by the owner
    // (Swimmer in a race, GameManager in the underwater debug scene) with the
    // current submerged state. No-op for AI (no bubble emitter) and above water.
    updateUnderwaterBubbles(active: boolean) {
        if (!this._bubbleEmitter) {
            return;
        }
        const emit = active && !this._splashCulled;
        this._bubbleEmitter.setEmitting(emit);
        if (emit) {
            this._bubbleEmitter.updatePositions();
        }
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
        if (!this._splashEmitter) {
            return;
        }
        const state = this._splashState;
        state.armAction = this._armAction;
        state.kickAction = this._kickAction;
        state.armCycleMotion = this._armCycleMotion;
        state.kickCycleMotion = this._kickCycleMotion;
        state.movementDirection = this._splashMovementDirection;
        state.movementHeadingRadians = this._splashMovementHeadingRadians;
        state.legSplashSuppressed = this._legSplashSuppressed;
        state.leftHandWaterContact = this._leftHandWaterContact;
        state.rightHandWaterContact = this._rightHandWaterContact;
        state.leftHandWaterEntry = this._leftHandWaterEntry;
        state.rightHandWaterEntry = this._rightHandWaterEntry;
        state.leftHandWaterProgress = this._leftHandWaterProgress;
        state.rightHandWaterProgress = this._rightHandWaterProgress;
        this._splashEmitter.setState(state);
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
        for (const renderer of this._skinnedRenderers) {
            renderer.shadowCastingMode = this._castsShadow ? 1 : 0;
        }
        if (this._skinnedRenderers.length > 0) {
            const roots = this._skinnedRenderers.map((renderer) => renderer.skinningRoot?.name || 'none').join('|');
            console.log(`[SpeedSwimming] skinned mesh ${useBakedAnimation ? 'baked animation' : 'realtime'} enabled count=${this._skinnedRenderers.length} roots=${roots}`);
        } else {
            console.warn('[SpeedSwimming] no SkinnedMeshRenderer found on swimmer prefab');
        }
    }

    private setSkinnedRenderersEnabled(enabled: boolean) {
        if (!this._model?.isValid) {
            return;
        }
        const renderers: SkinnedMeshRenderer[] = [];
        collectComponentsRecursive(this._model, SkinnedMeshRenderer, renderers);
        for (const renderer of renderers) {
            if (renderer?.isValid) {
                renderer.enabled = enabled;
            }
        }
    }

    private updatePerfectGlowMaterial() {
        const collisionFlash = this.currentCollisionFlashIntensity();
        const yellowGlow = this._perfectGlowIntensity;
        const dashGlow = this._skillDashGlowIntensity;
        const intensity = Math.max(yellowGlow, dashGlow, collisionFlash);
        if (intensity <= 0.001) {
            this.restorePerfectGlowMaterials();
            return;
        }

        // Collision feedback has explicit priority over the sweet-zone guide.
        // Both effects start at intensity 1, so comparing their magnitudes made
        // the tie select yellow; as the red timer decayed it could then never win.
        // Once the red timer expires, an active sweet zone naturally shows again.
        const color = collisionFlash > 0
            ? COLLISION_FLASH_COLOR
            : dashGlow > 0 ? SKILL_DASH_GLOW_COLOR : PERFECT_GLOW_COLOR;
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
