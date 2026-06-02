import { _decorator, Color, Component, instantiate, Layers, Node, SkeletalAnimation, SkinnedMeshRenderer, Vec3 } from 'cc';
import { CharacterRig } from '../character/CharacterRig';
import { applyCharacterSkin } from '../character/CharacterSkinApplier';
import { configureSwimmerSkinnedRenderers, findComponentRecursive, findNode, loadSwimmerPrefab, pruneNullComponentsRecursive, setLayerRecursive } from '../character/CharacterModelLoader';
import { FreestylePoseController } from '../character/FreestylePoseController';
import { SplashEmitter } from '../character/SplashEmitter';

const { ccclass } = _decorator;

const SPLASH_WATER_Y = 0.408;

@ccclass('CartoonSwimmerRig')
export class CartoonSwimmerRig extends Component implements CharacterRig {
    public root: Node = null;
    public splashNode: Node = null;

    private _model: Node = null;
    private _splashEmitter: SplashEmitter = null;
    private readonly _pose = new FreestylePoseController();
    private _animation: SkeletalAnimation = null;
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
    private _debugArmPhase = 0;
    private _debugKickPhase = 0;
    private _debugArmPower = 0;
    private _debugArmCycleRemaining = 0;
    private _debugKickCycleRemaining = 0;
    private _debugKickPower = 0;
    private _debugMotionClock = 0;
    private _debugArmInputTimes: number[] = [];
    private _debugKickInputTimes: number[] = [];
    private _modelDebugSpeedScale = 1;
    private _debugLogTimer = 0;
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
            try {
                this._model.setParent(this.node);
            } catch (error) {
                console.error('[SpeedSwimming] failed to attach swimmer model prefab', error);
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
            this._animation = findComponentRecursive(this._model, SkeletalAnimation);
            if (this._animation) {
                this._animation.useBakedAnimation = false;
            }
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

    setActiveSwimming(active: boolean) {
        if (this._modelDebugMode) {
            return;
        }
        this._active = active;
        if (active) {
            this._preRaceStanding = false;
            this.applyRaceModelSetup();
            if (this._animation) {
                this.playFreestyleClip();
            }
        } else {
            if (this._animation) {
                this._animation.stop();
            }
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
        if (this._animation) {
            this._animation.stop();
        }
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
            this.queueDebugMotion(this._debugArmInputTimes, Math.PI * 2);
            this._debugArmPower = 1;
            console.log(`[SpeedSwimming] model debug arm stroke trigger rate=${this.debugInputRatePerSecond(this._debugArmInputTimes).toFixed(1)}/s`);
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
            this.queueDebugMotion(this._debugKickInputTimes, Math.PI * 2);
            this._debugKickPower = 1;
            console.log(`[SpeedSwimming] model debug leg kick trigger rate=${this.debugInputRatePerSecond(this._debugKickInputTimes).toFixed(1)}/s`);
            return;
        }
        this._kickAction = 1;
        this._splashEmitter?.triggerKick();
        if (this._loaded) {
            console.log('[SpeedSwimming] rig kick trigger');
        }
    }

    updateFreestyle(dt: number, armCycle: number, kickCycle: number, bodyPhase: number, speed: number) {
        if (!this._loaded || !this._active || !this.root) {
            return;
        }

        this._armAction = Math.max(0, this._armAction - dt * 4.8);
        this._kickAction = Math.max(0, this._kickAction - dt * 7);
        this._splashEmitter?.decay(dt);
        this.updateArmCycleMotion(dt, armCycle);
        this.updateKickCycleMotion(dt, kickCycle);
        this._leftHandWaterContact = this._pose.handWaterContact(armCycle);
        this._rightHandWaterContact = this._pose.handWaterContact(armCycle + Math.PI);
        this._leftHandWaterProgress = this._pose.handWaterProgress(armCycle);
        this._rightHandWaterProgress = this._pose.handWaterProgress(armCycle + Math.PI);
        this.syncSplashState();

        const drive = Math.max(0.85, Math.min(1.45, 0.9 + speed * 0.16));
        this._pose.applyFreestyleRootMotion(armCycle, kickCycle, bodyPhase);
        if (this._animation) {
            const state = this.getFreestyleState();
            if (state) {
                state.speed = Math.max(0.8, Math.min(1.8, drive + this._armAction * 0.35 + this._kickAction * 0.25));
                this.updateSplashSurface(speed);
                return;
            }
        }
        this._pose.applyFreestylePose(armCycle, kickCycle, bodyPhase, drive + this._armAction * 0.45, drive + this._armAction * 0.7, drive + this._kickAction * 0.8);
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

        if (!this._active && !this._animation) {
            this._pose.applyPreviewPose(this._selfTime);
        }

        if (this._debugTimer >= 1) {
            this._debugTimer = 0;
            const leftArmY = this._pose.leftArmEuler;
            const leftLegX = this._pose.leftLegEuler;
            const animState = this.getFreestyleState();
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
        this._debugArmPhase = 0;
        this._debugKickPhase = 0;
        this._debugArmPower = 0;
        this._debugArmCycleRemaining = 0;
        this._debugKickCycleRemaining = 0;
        this._debugKickPower = 0;
        this._debugMotionClock = 0;
        this._debugArmInputTimes.length = 0;
        this._debugKickInputTimes.length = 0;
        this._debugLogTimer = 0;
        if (this._animation) {
            this._animation.stop();
            this._animation.enabled = false;
        }
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
        this._modelDebugSpeedScale = Math.max(0.1, Math.min(1.5, scale));
        console.log(`[SpeedSwimming] model debug speed=${this._modelDebugSpeedScale.toFixed(2)}x`);
    }

    get modelDebugSpeedScale(): number {
        return this._modelDebugSpeedScale;
    }

    triggerSplashBurst(scale = 1) {
        this._splashEmitter?.triggerBurst(scale);
    }

    private updateModelDebug(dt: number) {
        const actionDt = dt * this._modelDebugSpeedScale;
        this._debugMotionClock += dt;
        this.pruneDebugInputTimes(this._debugArmInputTimes);
        this.pruneDebugInputTimes(this._debugKickInputTimes);

        if (this._debugArmCycleRemaining > 0) {
            const armRate = this.debugInputRatePerSecond(this._debugArmInputTimes);
            const step = Math.min(this._debugArmCycleRemaining, actionDt * this.debugMotionSpeedForRate(armRate, Math.PI * 2, 0.7, 5.2));
            this._debugArmPhase += step;
            this._debugArmCycleRemaining -= step;
            this._debugArmPower = Math.max(0.25, Math.min(1, this._debugArmCycleRemaining / (Math.PI * 2)));
        } else {
            this._debugArmPower = 0;
            this._debugArmPhase = 0;
        }
        if (this._debugKickCycleRemaining > 0) {
            const kickRate = this.debugInputRatePerSecond(this._debugKickInputTimes);
            const step = Math.min(this._debugKickCycleRemaining, actionDt * this.debugMotionSpeedForRate(kickRate, Math.PI * 2, 0.82, 5.2));
            this._debugKickPhase += step;
            this._debugKickCycleRemaining -= step;
            this._debugKickPower = Math.max(0.25, Math.min(1, this._debugKickCycleRemaining / (Math.PI * 2)));
        } else {
            this._debugKickPower = 0;
            this._debugKickPhase = 0;
        }

        const armPower = 1 + this._debugArmPower * 1.45;
        const kickPower = 1 + this._debugKickPower * 1.6;
        const armActive = this._debugArmCycleRemaining > 0;
        const armPhase = armActive ? Math.sin(this._debugArmPhase) : 0;
        const armReach = armActive ? this._pose.armReachSignal(this._debugArmPhase) : 0;
        const leftArmCycle = armActive ? this._debugArmPhase : 0;
        const kickPhase = this._debugKickPower > 0 ? Math.sin(this._debugKickPhase) : 0;
        const leftKickCycle = this._debugKickPower > 0 ? this._debugKickPhase : 0;

        this._pose.applyDebugPose(armReach, armPower, leftArmCycle, kickPower, leftKickCycle);

        this._debugLogTimer += dt;
        if (this._debugLogTimer >= 0.75) {
            this._debugLogTimer = 0;
            console.log(
                `[SpeedSwimming] model debug sample arm=${armPhase.toFixed(2)} kick=${kickPhase.toFixed(2)} ` +
                `speed=${this._modelDebugSpeedScale.toFixed(2)} armRate=${this.debugInputRatePerSecond(this._debugArmInputTimes).toFixed(1)}/s kickRate=${this.debugInputRatePerSecond(this._debugKickInputTimes).toFixed(1)}/s ` +
                `armPower=${this._debugArmPower.toFixed(2)} kickPower=${this._debugKickPower.toFixed(2)} ` +
                `leftArmEuler=${this._pose.leftArmEuler} leftLegEuler=${this._pose.leftLegEuler}`,
            );
        }
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

    private updateArmCycleMotion(dt: number, armCycle: number) {
        if (dt <= 0) {
            return;
        }
        if (!this._hasLastArmCycle) {
            this._lastArmCycle = armCycle;
            this._hasLastArmCycle = true;
            return;
        }

        const angularSpeed = Math.abs(armCycle - this._lastArmCycle) / dt;
        this._lastArmCycle = armCycle;
        const target = Math.max(0, Math.min(1, angularSpeed / (Math.PI * 2 * 2.6)));
        const blend = Math.min(1, dt * 10);
        this._armCycleMotion += (target - this._armCycleMotion) * blend;
    }

    private updateKickCycleMotion(dt: number, kickCycle: number) {
        if (dt <= 0) {
            return;
        }
        if (!this._hasLastKickCycle) {
            this._lastKickCycle = kickCycle;
            this._hasLastKickCycle = true;
            return;
        }

        const angularSpeed = Math.abs(kickCycle - this._lastKickCycle) / dt;
        this._lastKickCycle = kickCycle;
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

    private queueDebugMotion(times: number[], cycleAmount: number) {
        times.push(this._debugMotionClock);
        this.pruneDebugInputTimes(times);
        if (times === this._debugArmInputTimes) {
            this._debugArmCycleRemaining += cycleAmount;
        } else {
            this._debugKickCycleRemaining += cycleAmount;
        }
    }

    private debugMotionSpeedForRate(ratePerSecond: number, cycleAmount: number, minCyclesPerSecond: number, maxCyclesPerSecond: number): number {
        const cyclesPerSecond = Math.max(minCyclesPerSecond, Math.min(maxCyclesPerSecond, ratePerSecond));
        return cycleAmount * cyclesPerSecond;
    }

    private debugInputRatePerSecond(times: number[]): number {
        return times.length;
    }

    private pruneDebugInputTimes(times: number[]) {
        while (times.length > 0 && this._debugMotionClock - times[0] > 1) {
            times.shift();
        }
    }

    private get boundJointCount(): number {
        return this._pose.boundJointCount;
    }

    private get manualBoneCount(): number {
        return this._pose.manualBoneCount;
    }

    private get animationClipNames(): string {
        if (!this._animation) {
            return 'none';
        }
        return this._animation.clips.map((clip) => clip?.name || '-').join('|') || 'empty';
    }

    private getFreestyleState() {
        if (!this._animation) {
            return null;
        }
        const clip = this.getFreestyleClip();
        return clip ? this._animation.getState(clip.name) : null;
    }

    private getFreestyleClip() {
        if (!this._animation) {
            return null;
        }
        return this._animation.clips.find((item) => item?.name === 'FreestyleFull') || this._animation.defaultClip || this._animation.clips[0] || null;
    }

    private playFreestyleClip() {
        if (!this._animation) {
            return;
        }
        const clip = this.getFreestyleClip();
        if (!clip) {
            console.warn('[SpeedSwimming] freestyle animation missing clip');
            return;
        }
        this._animation.enabled = true;
        this._animation.defaultClip = clip;
        this._animation.play(clip.name);
        const state = this._animation.getState(clip.name);
        if (state) {
            state.repeatCount = Infinity;
            state.speed = 1;
        }
        console.log(`[SpeedSwimming] playing freestyle clip=${clip.name}`);
    }
}
