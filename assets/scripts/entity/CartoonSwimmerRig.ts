import { _decorator, Color, Component, EffectAsset, instantiate, Layers, Material, Node, Quat, resources, SkeletalAnimation, SkinnedMeshRenderer, Vec3 } from 'cc';
import { CharacterAnimationPlayer } from '../character/CharacterAnimationPlayer';
import { CharacterRig } from '../character/CharacterRig';
import { applyCharacterSkin, CharacterSkinOutfit } from '../character/CharacterSkinApplier';
import { configureSwimmerSkinnedRenderers, findComponentRecursive, findNode, loadSwimmerPrefab, pruneNullComponentsInParentChain, pruneNullComponentsRecursive, setLayerRecursive } from '../character/CharacterModelLoader';
import { FreestylePoseController } from '../character/FreestylePoseController';
import { SplashEmitter } from '../character/SplashEmitter';
import { StrokeType } from '../core/GameConstants';
import { defaultSwimmerModelVariant, findSwimmerModelVariant, RESOURCE_PATHS } from '../core/ResourcePaths';
import type { SwimmerMotor } from '../swimmer/SwimmerMotor';

const { ccclass } = _decorator;

const SPLASH_WATER_Y = 0.408;
const FINISH_FLOAT_BASE_Y = -0.42;
const FINISH_FLOAT_BOB_AMPLITUDE = 0.035;
const FINISH_FLOAT_BOB_SPEED = 2.6;
const RACE_MODEL_BASE_Y = 0.18;
const SWIMMER_MODEL_SCALE = 1.35;

@ccclass('CartoonSwimmerRig')
export class CartoonSwimmerRig extends Component implements CharacterRig {
    public root: Node = null;
    public splashNode: Node = null;

    private _model: Node = null;
    private _splashEmitter: SplashEmitter = null;
    private readonly _pose = new FreestylePoseController();
    private readonly _animationPlayer = new CharacterAnimationPlayer();
    private _skinnedRenderers: SkinnedMeshRenderer[] = [];
    private _outlineRoot: Node = null;
    private _active = false;
    private _loaded = false;
    private _armAction = 0;
    private _kickAction = 0;
    private _armCycleMotion = 0;
    private _leftHandWaterContact = 0;
    private _rightHandWaterContact = 0;
    private _leftHandWaterProgress = 0;
    private _rightHandWaterProgress = 0;
    private _lastArmCycle = 0;
    private _hasLastArmCycle = false;
    private _kickCycleMotion = 0;
    private _lastKickCycle = 0;
    private _hasLastKickCycle = false;
    private _selfTime = 0;
    private _debugTimer = 0;
    private _modelDebugMode = false;
    private _preRaceStanding = false;
    private _finishFloating = false;
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
    private _waterY = SPLASH_WATER_Y;
    private readonly _tmpSplashWorld = new Vec3();

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
            this.applyRaceModelSetup();

            this.root = findNode(this._model, 'Armature') || this._model;
            this._pose.bind(this.root);
            this._pose.setSwimHeadLift(this.swimHeadLiftDegrees());
            this.configureSkinnedRenderers();
            this.applyLaneMaterials(this._skinColor, this._suitColor, this._capColor, this._robotStyle, this._playerOutline);
            this._animationPlayer.bind(findComponentRecursive(this._model, SkeletalAnimation));
            this._pose.captureBasePose();
            this._loaded = true;
            this.resetPose();
            if (this._modelDebugMode) {
                this.applyModelDebugSetup();
            } else if (this._finishFloating) {
                this.applyFinishFloatingSetup();
            } else if (this._preRaceStanding) {
                this.applyPreRaceStandingSetup();
            } else {
                this.setActiveSwimming(this._active);
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
        this._active = active;
        if (active) {
            this._preRaceStanding = false;
            this._finishFloating = false;
            this.applyRaceModelSetup();
            this._animationPlayer.stop();
        } else {
            this._animationPlayer.stop();
            if (this._preRaceStanding) {
                this.applyPreRaceStandingSetup();
            } else {
                this.resetPose();
            }
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
        this._preRaceStanding = active;
        this._finishFloating = false;
        this._active = false;
        this._animationPlayer.stop();
        if (!this._loaded || !this._model || !this.root) {
            return;
        }
        if (active) {
            this.applyPreRaceStandingSetup();
        } else {
            this.applyRaceModelSetup();
            this.resetPose();
        }
    }

    setFinishFloating() {
        if (this._modelDebugMode) {
            return;
        }
        this._preRaceStanding = false;
        this._finishFloating = true;
        this._active = false;
        this._animationPlayer.stop();
        if (!this._loaded || !this._model || !this.root) {
            return;
        }
        this.applyFinishFloatingSetup();
    }

    setDiveStreamlinePose() {
        if (this._modelDebugMode) {
            return;
        }
        this._preRaceStanding = false;
        this._finishFloating = false;
        this._active = true;
        this._animationPlayer.stop();
        if (!this._loaded || !this._model || !this.root) {
            return;
        }
        this.applyRaceModelSetup();
        this.resetPose();
        this._pose.applyFreestylePose(0, 0, 0, 0, 0, 1, 1, 0.9);
        this._splashEmitter?.setVisible(false);
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

    updateFreestyle(dt: number, leftArmCycle: number, rightArmCycle: number, leftKickCycle: number, rightKickCycle: number, bodyPhase: number, speed: number, movementDirection = 1) {
        if (!this._loaded || !this._active || !this.root) {
            return;
        }

        this._pose.setMovementDirection(movementDirection);
        this._armAction = Math.max(0, this._armAction - dt * 4.8);
        this._kickAction = Math.max(0, this._kickAction - dt * 7);
        this._splashEmitter?.decay(dt);
        this.updateArmCycleMotion(dt, leftArmCycle, rightArmCycle);
        this.updateKickCycleMotion(dt, leftKickCycle, rightKickCycle);
        this._leftHandWaterContact = this._pose.handWaterContact(leftArmCycle);
        this._rightHandWaterContact = this._pose.handWaterContact(rightArmCycle);
        this._leftHandWaterProgress = this._pose.handWaterProgress(leftArmCycle);
        this._rightHandWaterProgress = this._pose.handWaterProgress(rightArmCycle);
        this.syncSplashState();

        const drive = Math.max(0.85, Math.min(1.45, 0.9 + speed * 0.16));
        this._pose.applyFreestylePose(leftArmCycle, rightArmCycle, leftKickCycle, rightKickCycle, bodyPhase, drive + this._armAction * 0.45, drive + this._armAction * 0.7, drive + this._kickAction * 0.8);
        this.updateSplashSurface(speed);
    }

    update(dt: number) {
        if (!this._loaded || !this.root) {
            return;
        }

        this._selfTime += dt;
        this._debugTimer += dt;

        if (this._modelDebugMode) {
            return;
        }

        this.updatePerfectGlow(dt);

        if (this._finishFloating) {
            this.updateFinishFloating();
            return;
        }

        if (!this._active && !this._animationPlayer.hasAnimation) {
            this._pose.applyPreviewPose(this._selfTime);
        }

        if (this._debugTimer >= 1) {
            this._debugTimer = 0;
            const leftArmY = this._pose.leftArmEuler;
            const leftLegX = this._pose.leftLegEuler;
            const animState = this._animationPlayer.getFreestyleState();
            console.log(`[SpeedSwimming] rig pose sample active=${this._active} anim=${!!animState} animTime=${animState ? animState.time.toFixed(2) : '-'} leftArmY=${leftArmY} leftLegX=${leftLegX}`);
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
        this._leftHandWaterProgress = 0;
        this._rightHandWaterProgress = 0;
        this._lastArmCycle = 0;
        this._hasLastArmCycle = false;
        this._kickCycleMotion = 0;
        this._lastKickCycle = 0;
        this._hasLastKickCycle = false;
        this._finishFloating = false;
        this._splashEmitter?.reset();
        this._pose.restoreBasePose();
        this.updateSplashSurface(0);
    }

    setModelDebugMode(active: boolean) {
        this._modelDebugMode = active;
        this._active = active;
        this._animationPlayer.disable();
        for (const renderer of this._skinnedRenderers) {
            renderer.setUseBakedAnimation(false, true);
            renderer.uploadAnimation(null);
        }
        if (!this._loaded || !this._model || !this.root) {
            return;
        }
        this.resetPose();
        if (active) {
            this.applyModelDebugSetup();
        } else {
            this.applyRaceModelSetup();
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
        applyCharacterSkin({
            root: this.root,
            model: this._model,
            skinnedRenderers: this._skinnedRenderers,
            skinColor,
            suitColor,
            capColor,
            robotStyle,
            playerOutline,
            outfit: this._skinOutfit,
            preserveOriginalMaterial: this.preserveOriginalMaterial(),
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

    private applyModelDebugSetup() {
        if (!this._model || !this.root) {
            return;
        }
        this.configureSkinnedRenderers();
        this.applyRaceModelSetup();
        this._pose.applyFreestylePose(0, 0, 0, 0, 0, 1, 1, 0.9);
        console.log(
            `[SpeedSwimming] model debug uses race freestyle pipeline ` +
            `bones=${this.manualBoneCount} skinned=${this._skinnedRenderers.length} ` +
            `leftArm=${this._pose.leftArmPresent} rightArm=${this._pose.rightArmPresent} leftLeg=${this._pose.leftLegPresent} rightLeg=${this._pose.rightLegPresent}`,
        );
    }

    private applyRaceModelSetup() {
        if (!this._model) {
            return;
        }
        this._model.setPosition(0, RACE_MODEL_BASE_Y + this.raceModelYOffset(), 0);
        this._model.setScale(SWIMMER_MODEL_SCALE, SWIMMER_MODEL_SCALE, SWIMMER_MODEL_SCALE);
        this._model.setRotationFromEuler(90, 90, 0);
    }

    private applyPreRaceStandingSetup() {
        if (!this._model || !this.root) {
            return;
        }
        this.applyRaceModelSetup();
        this._model.setPosition(0, 0.55, 0);
        this._model.setScale(SWIMMER_MODEL_SCALE, SWIMMER_MODEL_SCALE, SWIMMER_MODEL_SCALE);
        this._model.setRotationFromEuler(0, 90, 0);
        this._pose.applyPreRaceStandingPose();
        this.updateSplashSurface(0);
        this._splashEmitter?.setVisible(false);
    }

    private applyFinishFloatingSetup() {
        if (!this._model || !this.root) {
            return;
        }
        this._model.setPosition(0, FINISH_FLOAT_BASE_Y, 0);
        this._model.setScale(SWIMMER_MODEL_SCALE, SWIMMER_MODEL_SCALE, SWIMMER_MODEL_SCALE);
        this._model.setRotationFromEuler(0, 90, 0);
        this._pose.applyFinishFloatingPose();
        this.updateSplashSurface(0);
        this._splashEmitter?.setVisible(false);
    }

    private updateFinishFloating() {
        if (!this._model || !this.root) {
            return;
        }
        const bob = Math.sin(this._selfTime * FINISH_FLOAT_BOB_SPEED) * FINISH_FLOAT_BOB_AMPLITUDE;
        this._model.setPosition(0, FINISH_FLOAT_BASE_Y + bob, 0);
        this._pose.applyFinishFloatingPose();
    }

    private updateSplashSurface(speed: number) {
        this.syncSplashState();
        this._splashEmitter?.update(speed);
    }

    private raceModelYOffset(): number {
        return findSwimmerModelVariant(this._modelVariantId)?.raceModelYOffset ?? 0;
    }

    private swimHeadLiftDegrees(): number | undefined {
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
            leftHandWaterContact: this._leftHandWaterContact,
            rightHandWaterContact: this._rightHandWaterContact,
            leftHandWaterProgress: this._leftHandWaterProgress,
            rightHandWaterProgress: this._rightHandWaterProgress,
        });
    }

    private getSplashBoneWorldPosition(name: string, out: Vec3): boolean {
        return this._pose.getSplashBoneWorldPosition(name, out);
    }

    private configureSkinnedRenderers() {
        if (!this._model) {
            return;
        }
        this._skinnedRenderers = configureSwimmerSkinnedRenderers(this._model);
        if (this._skinnedRenderers.length > 0) {
            const roots = this._skinnedRenderers.map((renderer) => renderer.skinningRoot?.name || 'none').join('|');
            console.log(`[SpeedSwimming] skinned mesh realtime enabled count=${this._skinnedRenderers.length} roots=${roots}`);
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
