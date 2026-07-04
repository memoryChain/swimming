import { _decorator, AnimationClip, Color, Component, EffectAsset, instantiate, Layers, Material, Node, Quat, resources, SkeletalAnimation, SkinnedMeshRenderer, Texture2D, Vec3 } from 'cc';
import { CharacterAnimationPlayer } from '../character/CharacterAnimationPlayer';
import { CHARACTER_POSE_TUNING } from '../character/CharacterMotionTuning';
import { CharacterPoseStateController } from '../character/CharacterPoseStateController';
import { CharacterRig } from '../character/CharacterRig';
import { applyCharacterSkin, CharacterSkinOutfit } from '../character/CharacterSkinApplier';
import { configureSwimmerSkinnedRenderers, findComponentRecursive, findNode, loadSwimmerPrefab, pruneNullComponentsInParentChain, pruneNullComponentsRecursive, setLayerRecursive } from '../character/CharacterModelLoader';
import { FreestylePoseController } from '../character/FreestylePoseController';
import { SplashEmitter } from '../character/SplashEmitter';
import { StrokeType } from '../core/GameConstants';
import { MOTION_TUNING } from '../core/InputTuning';
import { defaultSwimmer0621ColorVariant, defaultSwimmerModelVariant, findSwimmer0621ColorVariant, findSwimmerModelVariant, isDebugOnlySwimmerModelVariant, RESOURCE_PATHS } from '../core/ResourcePaths';
import type { DebugSwimmerActionPose } from '../core/ResourcePaths';
import type { SwimmerMotor } from '../swimmer/SwimmerMotor';

const { ccclass } = _decorator;

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
    private _lastArmCycle = 0;
    private _hasLastArmCycle = false;
    private _kickCycleMotion = 0;
    private _lastKickCycle = 0;
    private _hasLastKickCycle = false;
    private _selfTime = 0;
    private _debugTimer = 0;
    private _modelDebugMode = false;
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
    private readonly _tmpSplashWorld = new Vec3();
    private readonly _tmpSplashHeadWorld = new Vec3();
    private readonly _tmpSplashHandWorld = new Vec3();
    private _mixamoDebugTimer = 0;
    private _lastMixamoDebugLeftArm = '';
    private _lastMixamoDebugLeftLeg = '';

    build(skinColor: Color, suitColor: Color, capColor: Color, robotStyle = false, playerOutline = false) {
        if (this._loaded || this._model) {
            return;
        }
        this.storeSkinSettings(skinColor, suitColor, capColor, robotStyle, playerOutline);

        this._splashEmitter = new SplashEmitter({
            owner: this.node,
            parent: this.node.parent || this.node,
            name: `${this.node.name || 'Swimmer'}Splash`,
            waterY: this._waterY,
            getBoneWorldPosition: (name, out) => this.getSplashBoneWorldPosition(name, out),
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
        if (variant.id === 'swimmer0621_2' && this.hasDynamicColorVariant()) {
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
        return this.isBreaststrokeDebugPose() || this.isDivePrepDebugPose();
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

    setDebugActionPose(pose: DebugSwimmerActionPose) {
        if (this._debugActionPose === pose) {
            return;
        }
        this._debugActionPose = pose;
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
        this._waterY = waterY;
        this._splashEmitter?.setWaterY(waterY);
        this.updateSplashSurface(0);
    }

    setPreRaceStanding(active: boolean) {
        if (this._modelDebugMode) {
            return;
        }
        this._animationPlayer.stop();
        if (active) {
            this._poseState.enterDiveReady();
        } else {
            this._poseState.enterPreview();
            this.resetPose();
        }
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
        this._splashEmitter?.triggerArmStroke();
        if (this._loaded) {
            console.log('[SpeedSwimming] rig arm stroke trigger');
        }
    }

    triggerKick() {
        this._kickAction = 1;
        this._splashEmitter?.triggerKick();
        if (this._loaded) {
            console.log('[SpeedSwimming] rig kick trigger');
        }
    }

    triggerStroke(type: StrokeType) {
        this._armAction = 1;
        this._kickAction = 1;
        this._splashEmitter?.triggerArmStroke();
        this._splashEmitter?.triggerKick();
        if (this._loaded) {
            console.log(`[SpeedSwimming] rig ${type} diagonal stroke trigger`);
        }
    }

    setStrokeHeld(_type: StrokeType, _held: boolean) {
    }

    updateFreestyleFromMotor(dt: number, motor: SwimmerMotor, movementDirection = 1) {
        this.updateFreestyle(
            dt,
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
        this.updateFreestyle(
            dt,
            0,
            0,
            motor.leftKickCycle,
            motor.rightKickCycle,
            motor.bodyPhase,
            motor.currentSpeed,
            movementDirection,
        );
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

        const drive = Math.max(0.85, Math.min(1.45, 0.9 + speed * 0.16));
        this._pose.applyFreestylePose(leftArmCycle, rightArmCycle, leftKickCycle, rightKickCycle, bodyPhase, drive + this._armAction * 0.45, drive + this._armAction * 0.7, drive + this._kickAction * 0.8);

        this._leftHandWaterContact = this._pose.handWaterContact(leftArmCycle);
        this._rightHandWaterContact = this._pose.handWaterContact(rightArmCycle);
        this._leftHandWaterEntry = this.visualHandWaterEntry('left', this._pose.handWaterEntry(leftArmCycle));
        this._rightHandWaterEntry = this.visualHandWaterEntry('right', this._pose.handWaterEntry(rightArmCycle));
        this._leftHandWaterProgress = this._pose.handWaterProgress(leftArmCycle);
        this._rightHandWaterProgress = this._pose.handWaterProgress(rightArmCycle);
        this.updateSplashSurface(speed);
    }

    updateBreaststrokePreview(dt: number) {
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
        if (!this.isBreaststrokeDebugPose()) {
            return;
        }
        const cycleSeconds = CHARACTER_POSE_TUNING.breaststrokePreviewCycleSeconds / Math.max(0.25, MOTION_TUNING.animationSpeedScale);
        const phase = positiveMod(this._selfTime / cycleSeconds, 1);
        this._pose.setMovementDirection(1);
        this._pose.applyBreaststrokePose(phase, 1);
        const action = Math.max(0, Math.sin(phase * Math.PI * 2 - Math.PI * 0.25));
        this._armAction = Math.max(this._armAction - dt * 2.4, action * 0.35);
        this._kickAction = Math.max(this._kickAction - dt * 2.8, Math.max(0, Math.sin(phase * Math.PI * 2 - Math.PI * 1.25)) * 0.55);
        this.syncSplashState();
        this.updateSplashSurface(0.8);
    }

    update(dt: number) {
        if (!this._loaded || !this.root) {
            return;
        }

        this._selfTime += dt;
        this._debugTimer += dt;

        if (this._modelDebugMode) {
            if (this.isMixamoSwimmingDebugVariant()) {
                this.updateMixamoDebugProbe(dt);
            }
            return;
        }

        this.updatePerfectGlow(dt);

        if (this._poseState.update(dt, this._animationPlayer.hasAnimation)) {
            return;
        }

        if (this._debugTimer >= 1) {
            this._debugTimer = 0;
            const leftArmY = this._pose.leftArmEuler;
            const leftLegX = this._pose.leftLegEuler;
            const animState = this._animationPlayer.getFreestyleState();
            console.log(`[SpeedSwimming] rig pose sample state=${this._poseState.state} anim=${!!animState} animTime=${animState ? animState.time.toFixed(2) : '-'} leftArmY=${leftArmY} leftLegX=${leftLegX}`);
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
        this._lastArmCycle = 0;
        this._hasLastArmCycle = false;
        this._kickCycleMotion = 0;
        this._lastKickCycle = 0;
        this._hasLastKickCycle = false;
        this._mixamoDebugTimer = 0;
        this._lastMixamoDebugLeftArm = '';
        this._lastMixamoDebugLeftLeg = '';
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

    triggerPerfectGlow() {
        if (!this.node?.isValid || !this._loaded || !this._model || !this.root) {
            return;
        }
        this._perfectGlowIntensity = 1;
        this.ensurePerfectGlowShells();
        this.updatePerfectGlowMaterial();
    }

    refreshModelDebugSetup() {
        if (!this._modelDebugMode || !this._loaded || !this._model || !this.root) {
            return;
        }
        this._poseState.applyRaceModelSetup();
        if (this.isMixamoSwimmingDebugVariant()) {
            this._animationPlayer.setSpeed(MOTION_TUNING.animationSpeedScale);
        }
    }

    private updatePerfectGlow(dt: number) {
        if (this._perfectGlowIntensity <= 0) {
            this.updatePerfectGlowMaterial();
            return;
        }
        if (!this._perfectGlowMaterial || !this._perfectGlowShellRoot?.isValid) {
            return;
        }
        this._perfectGlowIntensity = Math.max(0, this._perfectGlowIntensity - dt * 5.8);
        this.updatePerfectGlowMaterial();
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
            dynamicColorEffect: usesDynamicColor ? this._dynamicColorEffect : null,
            colorMask: usesDynamicColor ? this._colorMask : null,
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
            if (token !== this._colorAssetLoadToken || !this._colorMask || !this._dynamicColorEffect) {
                return;
            }
            if (this._loaded && this.root) {
                this.applyLaneMaterials(this._skinColor, this._suitColor, this._capColor, this._robotStyle, this._playerOutline);
            }
        };
        resources.load(RESOURCE_PATHS.swimmer0621ColorMask, Texture2D, (error, texture) => {
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
        resources.load(RESOURCE_PATHS.swimmerDynamicColorEffect, EffectAsset, (error, effect) => {
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

    private ensureMixamoDebugAnimationPlaying() {
        if (!this._animationPlayer.hasAnimation) {
            this.ensureMixamoAnimationComponent();
        }
        if (!this._animationPlayer.hasAnimation) {
            return;
        }
        const played = this._animationPlayer.playClip('Swimming', true, MOTION_TUNING.animationSpeedScale)
            || this._animationPlayer.playFirstClip(true, MOTION_TUNING.animationSpeedScale);
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

    private loadMixamoClipByPath(index: number) {
        if (index >= MIXAMO_SWIMMING_CLIP_PATHS.length) {
            this.loadMixamoClipFromDirectory();
            return;
        }
        const path = MIXAMO_SWIMMING_CLIP_PATHS[index];
        resources.load(path, AnimationClip, (error, clip) => {
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
        resources.loadDir('models/UserSwimmer0621_2MixamoSwimming', AnimationClip, (dirError, clips) => {
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

    private updateMixamoDebugProbe(dt: number) {
        this._mixamoDebugTimer += dt;
        if (this._mixamoDebugTimer < 1) {
            return;
        }
        this._mixamoDebugTimer = 0;
        const leftArm = this._pose.leftArmEuler;
        const leftLeg = this._pose.leftLegEuler;
        const leftArmChanged = this._lastMixamoDebugLeftArm !== '' && this._lastMixamoDebugLeftArm !== leftArm;
        const leftLegChanged = this._lastMixamoDebugLeftLeg !== '' && this._lastMixamoDebugLeftLeg !== leftLeg;
        this._lastMixamoDebugLeftArm = leftArm;
        this._lastMixamoDebugLeftLeg = leftLeg;
        console.log(
            `[SpeedSwimming] Mixamo debug probe variant=${this._modelVariantId} ` +
            `${this._animationPlayer.getStateSummary()} ` +
            `leftArm=${leftArm} leftArmChanged=${leftArmChanged} ` +
            `leftLeg=${leftLeg} leftLegChanged=${leftLegChanged} ` +
            `model=${this._model ? this.nodePath(this._model) : '-'} root=${this.root ? this.nodePath(this.root) : '-'}`,
        );
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
        if (this._modelDebugMode && (this._debugActionPose === 'breaststroke' || this._debugActionPose === 'divePrep')) {
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
        resources.load(RESOURCE_PATHS.swimmerPerfectGlowEffect, EffectAsset, (err, effect) => {
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
            const pulse = this._perfectGlowIntensity * (0.72 + Math.sin(this._perfectGlowIntensity * Math.PI * 5.0) * 0.28);
            this._perfectGlowMaterial.setProperty('flashStrength', Math.max(0, Math.min(1, pulse)));
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
        if (source.getMaterial(i)) {
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
