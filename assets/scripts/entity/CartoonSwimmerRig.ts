import { _decorator, Color, Component, instantiate, Layers, Node, SkeletalAnimation, SkinnedMeshRenderer, Vec3 } from 'cc';
import { CharacterAnimationPlayer } from '../character/CharacterAnimationPlayer';
import { CharacterDebugController } from '../character/CharacterDebugController';
import { CharacterRig } from '../character/CharacterRig';
import { applyCharacterSkin } from '../character/CharacterSkinApplier';
import { configureSwimmerSkinnedRenderers, findComponentRecursive, findNode, loadSwimmerPrefab, pruneNullComponentsInParentChain, pruneNullComponentsRecursive, setLayerRecursive } from '../character/CharacterModelLoader';
import { FreestylePoseController } from '../character/FreestylePoseController';
import { SplashEmitter } from '../character/SplashEmitter';
import { StrokeType } from '../core/GameConstants';

const { ccclass } = _decorator;

const SPLASH_WATER_Y = 0.408;

@ccclass('CartoonSwimmerRig')
export class CartoonSwimmerRig extends Component implements CharacterRig {
    public root: Node = null;
    public splashNode: Node = null;

    private _model: Node = null;
    private _splashEmitter: SplashEmitter = null;
    private readonly _pose = new FreestylePoseController();
    private readonly _animationPlayer = new CharacterAnimationPlayer();
    private readonly _debug = new CharacterDebugController(this._pose);
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
    private readonly _tmpSplashWorld = new Vec3();

    build(skinColor: Color, suitColor: Color, capColor: Color, robotStyle = false, playerOutline = false) {
        if (this._loaded || this._model) {
            return;
        }

        this._splashEmitter = new SplashEmitter({
            owner: this.node,
            parent: this.node.parent || this.node,
            name: `${this.node.name || 'Swimmer'}Splash`,
            waterY: SPLASH_WATER_Y,
            getBoneWorldPosition: (name, out) => this.getSplashBoneWorldPosition(name, out),
        });
        this.splashNode = this._splashEmitter.node;
        this._splashEmitter.build();

        loadSwimmerPrefab((err, result) => {
            if (err || !result?.prefab || !this.node?.isValid) {
                console.error('[SpeedSwimming] failed to load swimmer prefab', err);
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
            this.configureSkinnedRenderers();
            this.applyLaneMaterials(skinColor, suitColor, capColor, robotStyle, playerOutline);
            this._animationPlayer.bind(findComponentRecursive(this._model, SkeletalAnimation));
            this._pose.captureBasePose();
            this._loaded = true;
            this.resetPose();
            if (this._modelDebugMode) {
                this.applyModelDebugSetup();
            } else if (this._preRaceStanding) {
                this.applyPreRaceStandingSetup();
            } else {
                this.setActiveSwimming(this._active);
            }
            console.log(
                `[SpeedSwimming] loaded athlete prefab=${result.path} joints=${this.boundJointCount} manualBones=${this.manualBoneCount} clips=${this.animationClipNames} ` +
                `skinned=${this._skinnedRenderers.length} baseEuler=${this._pose.rootBaseEuler.x.toFixed(1)},${this._pose.rootBaseEuler.y.toFixed(1)},${this._pose.rootBaseEuler.z.toFixed(1)}`,
            );
        });
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
        if (!this._loaded || !this.root) {
            return;
        }
        this.applyLaneMaterials(skinColor, suitColor, capColor, robotStyle, playerOutline);
    }

    setPreRaceStanding(active: boolean) {
        if (this._modelDebugMode) {
            return;
        }
        this._preRaceStanding = active;
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

    triggerArmStroke() {
        if (this._modelDebugMode) {
            this._debug.triggerArmStroke();
            return;
        }
        this._armAction = 1;
        this._splashEmitter?.triggerArmStroke();
        if (this._loaded) {
            console.log('[SpeedSwimming] rig arm stroke trigger');
        }
    }

    triggerKick() {
        if (this._modelDebugMode) {
            this._debug.triggerKick();
            return;
        }
        this._kickAction = 1;
        this._splashEmitter?.triggerKick();
        if (this._loaded) {
            console.log('[SpeedSwimming] rig kick trigger');
        }
    }

    triggerStroke(type: StrokeType, countsForMotionRate = true) {
        if (this._modelDebugMode) {
            this._debug.triggerStroke(type, countsForMotionRate);
            return;
        }
        this._armAction = 1;
        this._kickAction = 1;
        this._splashEmitter?.triggerArmStroke();
        this._splashEmitter?.triggerKick();
        if (this._loaded) {
            console.log(`[SpeedSwimming] rig ${type} diagonal stroke trigger`);
        }
    }

    setStrokeHeld(type: StrokeType, held: boolean) {
        if (this._modelDebugMode) {
            this._debug.setStrokeHeld(type, held);
        }
    }

    updateFreestyle(dt: number, leftArmCycle: number, rightArmCycle: number, leftKickCycle: number, rightKickCycle: number, bodyPhase: number, speed: number) {
        if (!this._loaded || !this._active || !this.root) {
            return;
        }

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
        this._pose.applyFreestyleRootMotion(leftArmCycle, rightArmCycle, leftKickCycle, rightKickCycle, bodyPhase);
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
            this.updateModelDebug(dt);
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
        this._splashEmitter?.reset();
        this._pose.restoreBasePose();
        this.updateSplashSurface(0);
    }

    setModelDebugMode(active: boolean) {
        this._modelDebugMode = active;
        this._active = false;
        this._debug.setEnabled(active);
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

    setModelDebugSpeedScale(scale: number) {
        this._debug.setSpeedScale(scale);
    }

    setModelDebugSwimSpeedRatio(ratio: number) {
        this._debug.setSwimSpeedRatio(ratio);
    }

    get modelDebugSpeedScale(): number {
        return this._debug.speedScale;
    }

    triggerSplashBurst(scale = 1) {
        this._splashEmitter?.triggerBurst(scale);
    }

    private updateModelDebug(dt: number) {
        this._debug.update(dt);
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
            outlineRoot: this._outlineRoot,
            setOutlineRoot: (root) => {
                this._outlineRoot = root;
            },
        });
    }

    private applyModelDebugSetup() {
        if (!this._model || !this.root) {
            return;
        }
        this.configureSkinnedRenderers();
        this._model.setPosition(0, 0.34, 0);
        this._model.setScale(0.92, 0.92, 0.92);
        this._model.setRotationFromEuler(90, 90, 0);
        this._pose.applyModelDebugPose();
        console.log(
            `[SpeedSwimming] model debug pose applied horizontalSide=true modelEuler=90,90,0 ` +
            `bones=${this.manualBoneCount} skinned=${this._skinnedRenderers.length} ` +
            `leftArm=${this._pose.leftArmPresent} rightArm=${this._pose.rightArmPresent} leftLeg=${this._pose.leftLegPresent} rightLeg=${this._pose.rightLegPresent}`,
        );
    }

    private applyRaceModelSetup() {
        if (!this._model) {
            return;
        }
        this._model.setPosition(0, 0.18, 0);
        this._model.setScale(0.82, 0.82, 0.82);
        this._model.setRotationFromEuler(90, 90, 0);
    }

    private applyPreRaceStandingSetup() {
        if (!this._model || !this.root) {
            return;
        }
        this.applyRaceModelSetup();
        this._model.setPosition(-1.65, 0.42, 0);
        this._model.setScale(0.82, 0.82, 0.82);
        this._model.setRotationFromEuler(0, 90, 0);
        this._pose.applyPreRaceStandingPose();
        this.updateSplashSurface(0);
        this._splashEmitter?.setVisible(false);
    }

    private updateSplashSurface(speed: number) {
        this.syncSplashState();
        this._splashEmitter?.update(speed);
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
