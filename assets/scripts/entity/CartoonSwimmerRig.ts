import { _decorator, Color, Component, EffectAsset, instantiate, Layers, Material, MeshRenderer, Node, Prefab, primitives, Quat, resources, SkeletalAnimation, SkinnedMeshRenderer, Texture2D, utils, Vec3, Vec4 } from 'cc';

const { ccclass } = _decorator;

const SPLASH_WATER_Y = 0.408;
const SWIMMER_TEXTURE_SIZE = 128;
const OUTLINE_SHELL_WIDTH = 18;

type SplashPart = {
    node: Node;
    material: Material;
    params: Vec4;
    shapeParams: Vec4;
    seed: number;
    basePosition: Vec3;
    baseEuler: Vec3;
    baseScale: Vec3;
    speedWeight: number;
    armWeight: number;
    kickWeight: number;
    burstWeight: number;
};

@ccclass('CartoonSwimmerRig')
export class CartoonSwimmerRig extends Component {
    public root: Node = null;
    public splashNode: Node = null;

    private _model: Node = null;
    private _splashParts: SplashPart[] = [];
    private _splashBurst = 0;
    private _armSplashBurst = 0;
    private _kickSplashBurst = 0;
    private _torso: Node = null;
    private _hips: Node = null;
    private _spine: Node = null;
    private _spine1: Node = null;
    private _neck: Node = null;
    private _head: Node = null;
    private _leftShoulder: Node = null;
    private _leftArm: Node = null;
    private _leftForeArm: Node = null;
    private _leftHand: Node = null;
    private _rightShoulder: Node = null;
    private _rightArm: Node = null;
    private _rightForeArm: Node = null;
    private _rightHand: Node = null;
    private _leftUpLeg: Node = null;
    private _leftLeg: Node = null;
    private _leftFoot: Node = null;
    private _leftToe: Node = null;
    private _rightUpLeg: Node = null;
    private _rightLeg: Node = null;
    private _rightFoot: Node = null;
    private _rightToe: Node = null;
    private _animation: SkeletalAnimation = null;
    private _skinnedRenderers: SkinnedMeshRenderer[] = [];
    private _outlineRoot: Node = null;
    private _rootBasePos = new Vec3();
    private _rootBaseEuler = new Vec3();
    private _rootBaseRotation = new Quat();
    private _boneBaseRotation = new Map<Node, Quat>();
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
    private readonly _tmpOffsetRotation = new Quat();
    private readonly _tmpResultRotation = new Quat();
    private readonly _tmpDirection = new Vec3();
    private readonly _tmpWorldDirection = new Vec3();
    private readonly _tmpParentDirection = new Vec3();
    private readonly _tmpBaseDirection = new Vec3();
    private readonly _tmpDeltaRotation = new Quat();
    private readonly _tmpRootWorldRotation = new Quat();
    private readonly _tmpParentWorldRotation = new Quat();
    private readonly _tmpInverseParentWorldRotation = new Quat();
    private readonly _tmpSplashWorld = new Vec3();
    private readonly _tmpSplashLocal = new Vec3();
    private readonly _tmpSplashWorldB = new Vec3();

    build(skinColor: Color, suitColor: Color, capColor: Color, robotStyle = false, playerOutline = false) {
        if (this._loaded || this._model) {
            return;
        }

        this.splashNode = new Node(`${this.node.name || 'Swimmer'}Splash`);
        this.splashNode.setParent(this.node.parent || this.node);
        this.splashNode.setPosition(this.node.position.x, SPLASH_WATER_Y, this.node.position.z);
        this.splashNode.setScale(1, 1, 1);
        this.splashNode.active = true;
        this.buildSplashSurface();

        loadSwimmerPrefab((err, prefab, path) => {
            if (err || !prefab || !this.node?.isValid) {
                console.error('[SpeedSwimming] failed to load swimmer prefab', err);
                return;
            }

            this._model = instantiate(prefab);
            this._model.name = 'UserSwimmerModel';
            this._model.setParent(this.node);
            setLayerRecursive(this._model, Layers.Enum.DEFAULT);
            this.applyRaceModelSetup();

            this.root = findNode(this._model, 'Armature') || this._model;
            this.bindNodes();
            this.configureSkinnedRenderers();
            this.applyLaneMaterials(skinColor, suitColor, capColor, robotStyle, playerOutline);
            this._animation = findComponentRecursive(this._model, SkeletalAnimation);
            if (this._animation) {
                this._animation.useBakedAnimation = false;
            }
            this._rootBasePos = this.root.position.clone();
            this._rootBaseEuler = this.root.eulerAngles.clone();
            Quat.copy(this._rootBaseRotation, this.root.rotation);
            this.captureBoneBasePose();
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
                `[SpeedSwimming] loaded athlete prefab=${path} joints=${this.boundJointCount} manualBones=${this.manualBoneCount} clips=${this.animationClipNames} ` +
                `skinned=${this._skinnedRenderers.length} baseEuler=${this._rootBaseEuler.x.toFixed(1)},${this._rootBaseEuler.y.toFixed(1)},${this._rootBaseEuler.z.toFixed(1)}`,
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
        this._armSplashBurst = Math.max(this._armSplashBurst, 1.15);
        this._splashBurst = Math.max(this._splashBurst, 1);
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
        this._kickSplashBurst = Math.max(this._kickSplashBurst, 1.25);
        this._splashBurst = Math.max(this._splashBurst, 0.65);
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
        this._splashBurst = Math.max(0, this._splashBurst - dt * 2.8);
        this._armSplashBurst = Math.max(0, this._armSplashBurst - dt * 3.2);
        this._kickSplashBurst = Math.max(0, this._kickSplashBurst - dt * 3.8);
        this.updateArmCycleMotion(dt, armCycle);
        this.updateKickCycleMotion(dt, kickCycle);
        this._leftHandWaterContact = this.handWaterContact(armCycle);
        this._rightHandWaterContact = this.handWaterContact(armCycle + Math.PI);
        this._leftHandWaterProgress = this.handWaterProgress(armCycle);
        this._rightHandWaterProgress = this.handWaterProgress(armCycle + Math.PI);

        const bob = Math.sin(bodyPhase) * 0.045;
        const roll = Math.sin(armCycle) * 10;
        const drive = Math.max(0.85, Math.min(1.45, 0.9 + speed * 0.16));

        this.root.setPosition(this._rootBasePos.x + Math.sin(armCycle) * 0.03, this._rootBasePos.y + bob, this._rootBasePos.z);
        this.root.setRotationFromEuler(
            this._rootBaseEuler.x + Math.sin(kickCycle) * 1.5,
            this._rootBaseEuler.y + roll * 0.16,
            this._rootBaseEuler.z + Math.sin(armCycle) * 1.8,
        );
        if (this._animation) {
            const state = this.getFreestyleState();
            if (state) {
                state.speed = Math.max(0.8, Math.min(1.8, drive + this._armAction * 0.35 + this._kickAction * 0.25));
                this.updateSplashSurface(speed);
                return;
            }
        }

        this.applyUpperBodyRoll(this.armReachSignal(armCycle), drive + this._armAction * 0.45);
        this.applyArm(this._leftShoulder, this._leftArm, this._leftForeArm, this._leftHand, armCycle, drive + this._armAction * 0.7);
        this.applyArm(this._rightShoulder, this._rightArm, this._rightForeArm, this._rightHand, armCycle + Math.PI, drive + this._armAction * 0.7);
        this.applyLeg(this._leftUpLeg, this._leftLeg, this._leftFoot, this._leftToe, kickCycle, drive + this._kickAction * 0.8);
        this.applyLeg(this._rightUpLeg, this._rightLeg, this._rightFoot, this._rightToe, kickCycle + Math.PI, drive + this._kickAction * 0.8);
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
            const previewArm = Math.sin(this._selfTime * 3.8);
            const previewArmCycle = this._selfTime * 3.8;
            const previewKickCycle = this._selfTime * 7.2;
            this.applyUpperBodyRoll(this.armReachSignal(previewArmCycle), 1);
            this.applyArm(this._leftShoulder, this._leftArm, this._leftForeArm, this._leftHand, previewArmCycle, 1.05);
            this.applyArm(this._rightShoulder, this._rightArm, this._rightForeArm, this._rightHand, previewArmCycle + Math.PI, 1.05);
            this.applyLeg(this._leftUpLeg, this._leftLeg, this._leftFoot, this._leftToe, previewKickCycle, 1.05);
            this.applyLeg(this._rightUpLeg, this._rightLeg, this._rightFoot, this._rightToe, previewKickCycle + Math.PI, 1.05);
        }

        if (this._debugTimer >= 1) {
            this._debugTimer = 0;
            const leftArmY = this._leftArm ? this._leftArm.eulerAngles.y.toFixed(1) : 'missing';
            const leftLegX = this._leftLeg ? this._leftLeg.eulerAngles.x.toFixed(1) : 'missing';
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
        this._splashBurst = 0;
        this._armSplashBurst = 0;
        this._kickSplashBurst = 0;
        this.root.setPosition(this._rootBasePos);
        this.restoreBoneBasePose();
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
        this._splashBurst = Math.max(this._splashBurst, Math.max(0, scale));
        this._armSplashBurst = Math.max(this._armSplashBurst, Math.max(0, scale) * 0.85);
        this._kickSplashBurst = Math.max(this._kickSplashBurst, Math.max(0, scale) * 0.7);
        this.updateSplashSurface(0.8);
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
        const armReach = armActive ? this.armReachSignal(this._debugArmPhase) : 0;
        const leftArmCycle = armActive ? this._debugArmPhase : 0;
        const kickPhase = this._debugKickPower > 0 ? Math.sin(this._debugKickPhase) : 0;
        const leftKickCycle = this._debugKickPower > 0 ? this._debugKickPhase : 0;

        this.root.setPosition(this._rootBasePos.x, this._rootBasePos.y, this._rootBasePos.z);
        this.root.setRotation(this._rootBaseRotation);
        this.applyUpperBodyRoll(armReach, armPower);
        this.applyArm(this._leftShoulder, this._leftArm, this._leftForeArm, this._leftHand, leftArmCycle, armPower);
        this.applyArm(this._rightShoulder, this._rightArm, this._rightForeArm, this._rightHand, leftArmCycle + Math.PI, armPower);
        this.applyLeg(this._leftUpLeg, this._leftLeg, this._leftFoot, this._leftToe, leftKickCycle, kickPower);
        this.applyLeg(this._rightUpLeg, this._rightLeg, this._rightFoot, this._rightToe, leftKickCycle + Math.PI, kickPower);

        this._debugLogTimer += dt;
        if (this._debugLogTimer >= 0.75) {
            this._debugLogTimer = 0;
            console.log(
                `[SpeedSwimming] model debug sample arm=${armPhase.toFixed(2)} kick=${kickPhase.toFixed(2)} ` +
                `speed=${this._modelDebugSpeedScale.toFixed(2)} armRate=${this.debugInputRatePerSecond(this._debugArmInputTimes).toFixed(1)}/s kickRate=${this.debugInputRatePerSecond(this._debugKickInputTimes).toFixed(1)}/s ` +
                `armPower=${this._debugArmPower.toFixed(2)} kickPower=${this._debugKickPower.toFixed(2)} ` +
                `leftArmEuler=${boneEuler(this._leftArm)} leftLegEuler=${boneEuler(this._leftLeg)}`,
            );
        }
    }

    private bindNodes() {
        this._spine = findNode(this.root, 'Spine');
        this._spine1 = findNode(this.root, 'Spine1');
        this._torso = findNode(this.root, 'Spine2') || this._spine1 || this._spine || findNode(this.root, 'TorsoMesh');
        this._hips = findNode(this.root, 'Hips') || findNode(this.root, 'HipsMesh');
        this._neck = findNode(this.root, 'Neck');
        this._head = findNode(this.root, 'Head');
        this._leftShoulder = findNode(this.root, 'LeftShoulder');
        this._leftArm = findNode(this.root, 'LeftArm');
        this._leftForeArm = findNode(this.root, 'LeftForeArm');
        this._leftHand = findNode(this.root, 'LeftHand');
        this._rightShoulder = findNode(this.root, 'RightShoulder');
        this._rightArm = findNode(this.root, 'RightArm');
        this._rightForeArm = findNode(this.root, 'RightForeArm');
        this._rightHand = findNode(this.root, 'RightHand');
        this._leftUpLeg = findNode(this.root, 'LeftUpLeg');
        this._leftLeg = findNode(this.root, 'LeftLeg');
        this._leftFoot = findNode(this.root, 'LeftFoot');
        this._leftToe = findNode(this.root, 'LeftToeBase');
        this._rightUpLeg = findNode(this.root, 'RightUpLeg');
        this._rightLeg = findNode(this.root, 'RightLeg');
        this._rightFoot = findNode(this.root, 'RightFoot');
        this._rightToe = findNode(this.root, 'RightToeBase');
    }

    private applyLaneMaterials(skinColor: Color, suitColor: Color, capColor: Color, robotStyle: boolean, playerOutline: boolean) {
        if (this.applyLowSwimmerTextureMaterial(skinColor, suitColor, capColor, robotStyle, playerOutline)) {
            this.configureOutlineShells();
            return;
        }

        const skin = makeMaterial('GLBSwimmerSkin', skinColor, robotStyle ? 0.34 : 0.52, robotStyle ? 0.5 : 0);
        const suit = makeMaterial('GLBSwimmerSuit', suitColor, robotStyle ? 0.38 : 0.5, robotStyle ? 0.35 : 0.02);
        const cap = makeMaterial('GLBSwimmerCap', capColor, robotStyle ? 0.32 : 0.44, robotStyle ? 0.45 : 0.04);
        const white = makeMaterial('GLBSwimmerWhite', robotStyle ? new Color(175, 245, 255, 255) : new Color(242, 252, 255, 255), 0.22, 0.08);
        const dark = makeMaterial('GLBSwimmerDark', robotStyle ? new Color(20, 55, 70, 255) : new Color(10, 16, 24, 255), 0.4, robotStyle ? 0.35 : 0);
        const skinMatches = applyMaterialByName(this.root, [
            'Body', 'BodyMesh', 'Skin', 'Head', 'Neck', 'Face',
            'Arm', 'ForeArm', 'Hand', 'Leg', 'Foot', 'Toe',
            'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
            'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
        ], skin);
        const suitMatches = applyMaterialByName(this.root, [
            'Suit', 'Swimsuit', 'SwimSuit', 'Trunks', 'Shorts', 'Cloth', 'TorsoMesh', 'ChestMesh',
        ], suit);
        applyMaterialByName(this.root, ['SimpleSwimCap', 'Cap', 'SwimCap'], cap);
        applyMaterialByName(this.root, ['SimpleGoggleBand', 'GoggleBand'], dark);
        applyMaterialByName(this.root, ['LeftGoggleLens', 'RightGoggleLens', 'GoggleLens'], white);

        if (skinMatches + suitMatches === 0) {
            const fallback = robotStyle ? makeMaterial('GLBSwimmerLaneColor', blendColor(suitColor, capColor, 0.22), 0.32, 0.18) : skin;
            for (const renderer of this._skinnedRenderers) {
                renderer.setMaterial(fallback, 0);
            }
            console.log(`[SpeedSwimming] applied fallback athlete material robot=${robotStyle} outline=${playerOutline} renderers=${this._skinnedRenderers.length}`);
        }
        this.configureOutlineShells();
    }

    private applyLowSwimmerTextureMaterial(skinColor: Color, suitColor: Color, capColor: Color, robotStyle: boolean, playerOutline: boolean): boolean {
        if (this._skinnedRenderers.length !== 1) {
            return false;
        }

        const renderer = this._skinnedRenderers[0];
        const looksLikeLowProxy = renderer.node.name === 'Skin' || renderer.node.name === 'node_0.003';
        if (!looksLikeLowProxy) {
            return false;
        }

        const tintSuit = suitColor;
        const tintCap = robotStyle ? blendColor(capColor, new Color(175, 245, 255, 255), 0.18) : capColor;
        renderer.setMaterial(makeSwimmerTextureMaterial(skinColor, tintSuit, tintCap, robotStyle), 0);
        console.log(`[SpeedSwimming] applied low swimmer texture material suit=${tintSuit.r},${tintSuit.g},${tintSuit.b} cap=${tintCap.r},${tintCap.g},${tintCap.b} outline=${playerOutline}`);
        return true;
    }

    private configureOutlineShells() {
        if (!this._model || this._skinnedRenderers.length <= 0) {
            return;
        }
        if (this._outlineRoot?.isValid) {
            return;
        }

        const root = new Node('CharacterOutlineShell');
        root.setParent(this._model);
        root.setPosition(0, 0, 0);
        root.setRotationFromEuler(0, 0, 0);
        root.setScale(1, 1, 1);
        root.layer = Layers.Enum.DEFAULT;
        this._outlineRoot = root;

        loadOutlineShellMaterial((material) => {
            if (!material || !this.node?.isValid || !this._model?.isValid || !root.isValid) {
                root.destroy();
                if (this._outlineRoot === root) {
                    this._outlineRoot = null;
                }
                return;
            }

            let shellCount = 0;
            for (const source of this._skinnedRenderers) {
                if (!source.node?.isValid || !source.mesh) {
                    continue;
                }

                const shellNode = new Node(`${source.node.name || 'Skin'}OutlineShell`);
                shellNode.setParent(source.node.parent || root);
                shellNode.layer = Layers.Enum.DEFAULT;
                shellNode.setPosition(source.node.position);
                shellNode.setRotation(source.node.rotation);
                shellNode.setScale(source.node.scale);
                shellNode.setParent(root, true);

                const outline = shellNode.addComponent(SkinnedMeshRenderer);
                outline.mesh = source.mesh;
                outline.skeleton = source.skeleton;
                outline.skinningRoot = source.skinningRoot || this._model;
                outline.setUseBakedAnimation(false, true);
                outline.uploadAnimation(null);
                outline.setMaterial(material, 0);
                shellCount++;
            }

            if (shellCount <= 0) {
                root.destroy();
                if (this._outlineRoot === root) {
                    this._outlineRoot = null;
                }
                return;
            }
            console.log(`[SpeedSwimming] inverted hull normal-outline shells=${shellCount}`);
        });
    }

    private applyModelDebugSetup() {
        if (!this._model || !this.root) {
            return;
        }
        this.configureSkinnedRenderers();
        this.restoreBoneBasePose();
        this._model.setPosition(0, 0.34, 0);
        this._model.setScale(0.92, 0.92, 0.92);
        this._model.setRotationFromEuler(90, 90, 0);
        this.applyUpperBodyRoll(0, 1);
        this.applyArm(this._leftShoulder, this._leftArm, this._leftForeArm, this._leftHand, 0, 1);
        this.applyArm(this._rightShoulder, this._rightArm, this._rightForeArm, this._rightHand, Math.PI, 1);
        this.applyLeg(this._leftUpLeg, this._leftLeg, this._leftFoot, this._leftToe, 0, 1);
        this.applyLeg(this._rightUpLeg, this._rightLeg, this._rightFoot, this._rightToe, Math.PI, 1);
        console.log(
            `[SpeedSwimming] model debug pose applied horizontalSide=true modelEuler=90,90,0 ` +
            `bones=${this.manualBoneCount} skinned=${this._skinnedRenderers.length} ` +
            `leftArm=${!!this._leftArm} rightArm=${!!this._rightArm} leftLeg=${!!this._leftLeg} rightLeg=${!!this._rightLeg}`,
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
        this.restoreBoneBasePose();
        this._model.setPosition(-1.65, 0.42, 0);
        this._model.setScale(0.82, 0.82, 0.82);
        this._model.setRotationFromEuler(0, 90, 0);
        this.applyBoneOffset(this._leftArm, 0, 0, -10);
        this.applyBoneOffset(this._rightArm, 0, 0, 10);
        this.applyBoneOffset(this._leftForeArm, 0, 0, -6);
        this.applyBoneOffset(this._rightForeArm, 0, 0, 6);
        this.applyBoneOffset(this._leftUpLeg, -2, 0, -2);
        this.applyBoneOffset(this._rightUpLeg, 2, 0, 2);
        this.applyBoneOffset(this._leftLeg, 2, 0, 0);
        this.applyBoneOffset(this._rightLeg, -2, 0, 0);
        this.updateSplashSurface(0);
        if (this.splashNode) {
            this.splashNode.active = false;
        }
    }

    private buildSplashSurface() {
        if (!this.splashNode) {
            return;
        }
        resources.load('pool/SwimmerSplash', Material, (err, material) => {
            if (err || !material || !this.splashNode?.isValid) {
                console.warn('[SpeedSwimming] failed to load swimmer splash material', err);
                return;
            }
            this._splashParts.length = 0;
            this.createSplashPart(material, 'LeftHandFoam', new Vec3(0.28, 0.004, -0.38), new Vec3(0, 0, -8), new Vec3(0.42, 1, 0.32), 0.3, 1.35, 0.04, 0.95, 0.82, 0.68, 0.18, 0.45);
            this.createSplashPart(material, 'RightHandFoam', new Vec3(0.28, 0.004, 0.38), new Vec3(0, 0, 8), new Vec3(0.42, 1, 0.32), 0.3, 1.35, 0.04, 0.95, 0.82, 0.68, 0.18, 0.45);
            this.createSplashPart(material, 'FootFoam', new Vec3(-0.94, 0.005, 0), new Vec3(0, 0, 0), new Vec3(0.72, 1, 0.48), 0.85, 0.04, 1.65, 1.0, 1.34, 0.78, 1.0, 1.0);
            this.updateSplashSurface(0);
        });
    }

    private createSplashPart(
        sourceMaterial: Material,
        name: string,
        basePosition: Vec3,
        baseEuler: Vec3,
        baseScale: Vec3,
        speedWeight: number,
        armWeight: number,
        kickWeight: number,
        burstWeight: number,
        width = 1.1,
        length = 0.95,
        flowStrength = 0.25,
        trailStrength = 0.6,
    ) {
        if (!this.splashNode) {
            return;
        }
        const node = new Node(name);
        node.setParent(this.splashNode);
        node.setPosition(basePosition);
        node.setRotationFromEuler(baseEuler.x, baseEuler.y, baseEuler.z);
        node.setScale(baseScale);

        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = utils.createMesh(primitives.plane({
            width,
            length,
            widthSegments: 4,
            lengthSegments: 2,
        }));

        const runtimeMaterial = new Material();
        runtimeMaterial.copy(sourceMaterial);
        runtimeMaterial.name = `Runtime${name}`;
        runtimeMaterial.setProperty('shapeParams', new Vec4(flowStrength, trailStrength, 0, 0));
        renderer.setMaterial(runtimeMaterial, 0);

        this._splashParts.push({
            node,
            material: runtimeMaterial,
            params: new Vec4(),
            shapeParams: new Vec4(flowStrength, trailStrength, 0, 0),
            seed: Math.random() * 20,
            basePosition: basePosition.clone(),
            baseEuler: baseEuler.clone(),
            baseScale: baseScale.clone(),
            speedWeight,
            armWeight,
            kickWeight,
            burstWeight,
        });
    }

    private updateSplashSurface(speed: number) {
        if (!this.splashNode || this._splashParts.length === 0) {
            return;
        }

        const speedRatio = Math.max(0, Math.min(1, speed / 3.2));
        this.splashNode.setPosition(this.node.position.x, SPLASH_WATER_Y, this.node.position.z);
        this.splashNode.setRotationFromEuler(0, 0, 0);
        this.splashNode.setScale(1, 1, 1);
        let anyActive = false;
        for (const part of this._splashParts) {
            const isHand = part.node.name.indexOf('Hand') >= 0;
            const isFoot = part.node.name.indexOf('Foot') >= 0;
            const handContact = this.handContactForPart(part.node.name);
            const rawAction = isHand
                ? handContact * (
                    speedRatio * part.speedWeight * 0.35
                    + this._armAction * part.armWeight
                    + this._splashBurst * part.burstWeight * 0.18
                    + this._armSplashBurst * part.armWeight * 0.7
                )
                : speedRatio * part.speedWeight
                    + this._armAction * part.armWeight
                    + this._kickAction * part.kickWeight
                    + this._splashBurst * part.burstWeight * 0.45
                    + this._armSplashBurst * part.armWeight * 0.5
                    + this._kickSplashBurst * part.kickWeight * 0.5;
            const motionFloor = isFoot
                ? speedRatio * 0.42 + this._kickCycleMotion * 0.58
                : isHand
                    ? handContact * (speedRatio * 0.08 + this._armCycleMotion * 0.72)
                : speedRatio * 0.16;
            const action = Math.max(rawAction, motionFloor);
            const intensity = Math.max(0, Math.min(2.4, action));
            const burst = isHand
                ? handContact * Math.max(
                    this._splashBurst * part.burstWeight * 0.28,
                    this._armSplashBurst * part.armWeight,
                    this._armCycleMotion * 0.45,
                )
                : Math.max(
                    this._splashBurst * part.burstWeight,
                    this._armSplashBurst * part.armWeight,
                    this._kickSplashBurst * part.kickWeight,
                );
            const active = isHand ? handContact > 0.08 && (intensity > 0.04 || burst > 0.04) : intensity > 0.04 || burst > 0.04;
            part.node.active = active;
            anyActive = anyActive || active;

            const surge = Math.min(1, burst * 0.45);
            const footBoost = isFoot ? 1.14 : 1;
            this.resolveSplashPartPosition(part, speedRatio, surge, isFoot, isHand, handContact);
            part.node.setRotationFromEuler(part.baseEuler.x, part.baseEuler.y, part.baseEuler.z);
            part.node.setScale(
                part.baseScale.x * footBoost * (1 + speedRatio * 0.28 + surge * 0.55),
                1,
                part.baseScale.z * footBoost * (1 + surge * 0.58),
            );
            part.params.set(intensity, speedRatio, Math.min(2.4, burst), part.seed);
            part.material.setProperty('splashParams', part.params);
        }
        this.splashNode.active = anyActive;
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

    private handWaterContact(cycle: number): number {
        const phase = positiveMod(-cycle, Math.PI * 2) / (Math.PI * 2);
        const catchToPull = smoothPulse(phase, 0.10, 0.20, 0.46, 0.58);
        const entry = smoothPulse(phase, 0.90, 0.96, 1.0, 1.0) + smoothPulse(phase, 0.0, 0.0, 0.035, 0.09);
        return Math.max(catchToPull, Math.min(1, entry * 0.65));
    }

    private handWaterProgress(cycle: number): number {
        const phase = positiveMod(-cycle, Math.PI * 2) / (Math.PI * 2);
        if (phase >= 0.10 && phase <= 0.58) {
            return smoothRange(phase, 0.10, 0.58);
        }
        return 0;
    }

    private handContactForPart(name: string): number {
        if (name.indexOf('LeftHand') >= 0) {
            return this._leftHandWaterContact;
        }
        if (name.indexOf('RightHand') >= 0) {
            return this._rightHandWaterContact;
        }
        return 0;
    }

    private handProgressForPart(name: string): number {
        if (name.indexOf('LeftHand') >= 0) {
            return this._leftHandWaterProgress;
        }
        if (name.indexOf('RightHand') >= 0) {
            return this._rightHandWaterProgress;
        }
        return 0;
    }

    private resolveSplashPartPosition(part: SplashPart, speedRatio: number, surge: number, isFoot: boolean, isHand: boolean, handContact: number) {
        if (!this.splashNode) {
            return;
        }

        if (isHand) {
            this.resolveHandSplashPartPosition(part, speedRatio, surge, handContact);
            return;
        }

        const followsLimbPosition = true;
        const hasBonePosition = followsLimbPosition && this.getSplashBoneWorldPosition(part.node.name, this._tmpSplashWorld);
        if (hasBonePosition) {
            this._tmpSplashWorld.y = SPLASH_WATER_Y + part.basePosition.y + surge * 0.004;
            this._tmpSplashWorld.x -= speedRatio * (isFoot ? 0.34 : 0.08);
            this.splashNode.inverseTransformPoint(this._tmpSplashLocal, this._tmpSplashWorld);
            part.node.setPosition(this._tmpSplashLocal);
            return;
        }

        part.node.setPosition(
            part.basePosition.x - speedRatio * 0.14 + (isFoot ? -speedRatio * 0.26 : 0),
            part.basePosition.y + surge * 0.004,
            part.basePosition.z,
        );
    }

    private resolveHandSplashPartPosition(part: SplashPart, speedRatio: number, surge: number, handContact: number) {
        const progress = this.handProgressForPart(part.node.name);
        const strokeX = lerp(0.78, 0.28, progress);
        const baseX = lerp(part.basePosition.x, strokeX, handContact) - speedRatio * 0.08;
        const baseY = part.basePosition.y + surge * 0.004;
        const baseZ = part.basePosition.z;
        part.node.setPosition(baseX, baseY, baseZ);
    }

    private getSplashBoneWorldPosition(name: string, out: Vec3): boolean {
        if (name.indexOf('Head') >= 0 && this._head) {
            this._head.getWorldPosition(out);
            return true;
        }
        if (name.indexOf('LeftHand') >= 0 && this._leftHand) {
            this._leftHand.getWorldPosition(out);
            return true;
        }
        if (name.indexOf('RightHand') >= 0 && this._rightHand) {
            this._rightHand.getWorldPosition(out);
            return true;
        }
        if (name.indexOf('Foot') >= 0) {
            const left = this._leftToe || this._leftFoot;
            const right = this._rightToe || this._rightFoot;
            if (left && right) {
                left.getWorldPosition(out);
                right.getWorldPosition(this._tmpSplashWorldB);
                out.x = (out.x + this._tmpSplashWorldB.x) * 0.5;
                out.y = (out.y + this._tmpSplashWorldB.y) * 0.5;
                out.z = (out.z + this._tmpSplashWorldB.z) * 0.5;
                return true;
            }
            if (left || right) {
                (left || right).getWorldPosition(out);
                return true;
            }
        }
        return false;
    }

    private configureSkinnedRenderers() {
        if (!this._model) {
            return;
        }
        this._skinnedRenderers = [];
        collectComponentsRecursive(this._model, SkinnedMeshRenderer, this._skinnedRenderers);
        this._skinnedRenderers = this._skinnedRenderers.filter((renderer) => !isInsideNodeNamed(renderer.node, 'CharacterOutlineShell'));
        for (const renderer of this._skinnedRenderers) {
            renderer.skinningRoot = this._model;
            renderer.setUseBakedAnimation(false, true);
            renderer.uploadAnimation(null);
        }
        if (this._skinnedRenderers.length > 0) {
            const roots = this._skinnedRenderers.map((renderer) => renderer.skinningRoot?.name || 'none').join('|');
            console.log(`[SpeedSwimming] skinned mesh realtime enabled count=${this._skinnedRenderers.length} roots=${roots}`);
        } else {
            console.warn('[SpeedSwimming] no SkinnedMeshRenderer found on swimmer prefab');
        }
    }

    private captureBoneBasePose() {
        this._boneBaseRotation.clear();
        for (const bone of this.manualBones) {
            if (bone) {
                this._boneBaseRotation.set(bone, Quat.clone(bone.rotation));
            }
        }
    }

    private restoreBoneBasePose() {
        this.root?.setPosition(this._rootBasePos);
        this.root?.setRotation(this._rootBaseRotation);
        for (const [bone, rotation] of this._boneBaseRotation) {
            if (bone?.isValid) {
                bone.setRotation(rotation);
            }
        }
    }

    private applyArm(shoulder: Node, arm: Node, foreArm: Node, hand: Node, cycle: number, power: number) {
        if (!arm || !foreArm) {
            return;
        }

        const normalized = positiveMod(-cycle, Math.PI * 2) / (Math.PI * 2);
        const side = arm === this._leftArm ? 1 : -1;
        const wheel = -normalized * Math.PI * 2;
        const c = Math.cos(wheel);
        const s = Math.sin(wheel);
        const armPower = 0.92 + Math.min(2, Math.max(0.8, power)) * 0.08;

        const shoulderLift = (-1 - 2 * c) * armPower;
        const shoulderOpen = side * 6 * armPower;
        const shoulderRoll = side * 2 * armPower;
        const elbowStraight = (-6 + 2 * c) * armPower;
        const handNeutral = -2 * c * armPower;
        const sideClearance = 0.58;

        this.applyBoneOffset(shoulder, shoulderLift, shoulderOpen, shoulderRoll);
        this._tmpDirection.set(side * sideClearance, c, s);
        Vec3.normalize(this._tmpDirection, this._tmpDirection);
        this.applyBoneDirectionFromRoot(arm, foreArm, this._tmpDirection);
        this.applyBoneOffset(foreArm, elbowStraight, side * 3 * armPower, side * 2 * armPower);
        this.applyBoneOffset(hand, handNeutral, side * 2 * armPower, side * 1.5 * armPower);
    }

    private armReachSignal(cycle: number): number {
        const leftReach = Math.cos(positiveMod(-cycle, Math.PI * 2));
        const rightReach = Math.cos(positiveMod(-(cycle + Math.PI), Math.PI * 2));
        return (leftReach - rightReach) * 0.5;
    }

    private applyUpperBodyRoll(phase: number, power: number) {
        const reach = Math.max(-1, Math.min(1, phase));
        const roll = reach * Math.min(1.25, power);
        const leftReach = Math.max(0, reach);
        const rightReach = Math.max(0, -reach);

        this.applyBoneOffset(this._hips, 0, roll * 2.2, 0);
        this.applyBoneOffset(this._spine, 0, roll * 5.5, roll * 0.5);
        this.applyBoneOffset(this._spine1, 0, roll * 8.2, roll * 0.8);
        const swimHeadLift = -14;
        this.applyBoneOffset(this._torso, swimHeadLift * 0.18, roll * 10.5, roll * 1.1);
        this.applyBoneOffset(this._neck, swimHeadLift * 0.72, roll * 6.2, -roll * 0.6);
        this.applyBoneOffset(this._head, -2.5 + swimHeadLift * 1.15, roll * 7.5, -roll * 0.8);
        this.applyBoneOffset(this._leftShoulder, leftReach * -2, roll * 5.5, leftReach * -3);
        this.applyBoneOffset(this._rightShoulder, rightReach * -2, roll * 5.5, rightReach * 3);
    }

    private applyLeg(upLeg: Node, leg: Node, foot: Node, toe: Node, cycle: number, power: number) {
        if (!upLeg || !leg) {
            return;
        }

        const side = upLeg === this._leftUpLeg ? -1 : 1;
        const hip = Math.sin(cycle);
        const knee = Math.sin(cycle - 0.42);
        const ankle = Math.sin(cycle - 0.72);
        const downBeat = Math.max(0, -hip);
        const calfUnderWater = Math.max(0, -knee);
        const calfHigh = Math.max(0, knee);
        const highNeutral = 1 - Math.min(1, calfHigh * 1.35);
        const plantarFlex = 16 + downBeat * 18 + calfUnderWater * 8;
        const footPitch = ankle * 8 * power - plantarFlex * power;
        const toePitch = ankle * 4.5 * power - plantarFlex * 0.62 * power;
        const footSoleUpTwist = -side * downBeat * 7 * highNeutral * power;
        const toeSoleUpTwist = -side * downBeat * 3.5 * highNeutral * power;
        const footOutRoll = -side * downBeat * 1.8 * highNeutral * power;
        const toeOutRoll = -side * downBeat * 0.9 * highNeutral * power;

        this.applyBoneOffset(upLeg, hip * 6.5 * power, side * 0.35 * highNeutral, 0);
        this.applyBoneOffset(leg, knee * 10.5 * power - downBeat * 4.5 * power, side * 0.2 * highNeutral, side * 0.35 * highNeutral);
        this.applyBoneOffset(foot, footPitch, footSoleUpTwist, footOutRoll);
        this.applyBoneOffset(toe, toePitch, toeSoleUpTwist, toeOutRoll);
    }

    private applyBoneOffset(bone: Node, x: number, y: number, z: number) {
        if (!bone) {
            return;
        }
        const base = this._boneBaseRotation.get(bone);
        if (!base) {
            bone.setRotationFromEuler(x, y, z);
            return;
        }
        Quat.fromEuler(this._tmpOffsetRotation, x, y, z);
        Quat.multiply(this._tmpResultRotation, base, this._tmpOffsetRotation);
        bone.setRotation(this._tmpResultRotation);
    }

    private applyBoneDirection(bone: Node, child: Node, directionInParent: Vec3) {
        if (!bone || !child) {
            return;
        }
        const base = this._boneBaseRotation.get(bone);
        if (!base) {
            return;
        }

        Vec3.copy(this._tmpBaseDirection, child.position);
        if (this._tmpBaseDirection.lengthSqr() <= 0.000001) {
            return;
        }
        Vec3.normalize(this._tmpBaseDirection, this._tmpBaseDirection);
        Vec3.transformQuat(this._tmpBaseDirection, this._tmpBaseDirection, base);
        Vec3.normalize(this._tmpBaseDirection, this._tmpBaseDirection);
        Quat.rotationTo(this._tmpDeltaRotation, this._tmpBaseDirection, directionInParent);
        Quat.multiply(this._tmpResultRotation, this._tmpDeltaRotation, base);
        bone.setRotation(this._tmpResultRotation);
    }

    private applyBoneDirectionFromRoot(bone: Node, child: Node, directionInRoot: Vec3) {
        if (!this.root || !bone?.parent) {
            return;
        }

        this.root.getWorldRotation(this._tmpRootWorldRotation);
        bone.parent.getWorldRotation(this._tmpParentWorldRotation);
        Vec3.transformQuat(this._tmpWorldDirection, directionInRoot, this._tmpRootWorldRotation);
        Quat.invert(this._tmpInverseParentWorldRotation, this._tmpParentWorldRotation);
        Vec3.transformQuat(this._tmpParentDirection, this._tmpWorldDirection, this._tmpInverseParentWorldRotation);
        Vec3.normalize(this._tmpParentDirection, this._tmpParentDirection);
        this.applyBoneDirection(bone, child, this._tmpParentDirection);
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
        return [
            this._torso,
            this._hips,
            this._spine,
            this._spine1,
            this._neck,
            this._head,
            this._leftShoulder,
            this._leftArm,
            this._leftForeArm,
            this._leftHand,
            this._rightShoulder,
            this._rightArm,
            this._rightForeArm,
            this._rightHand,
            this._leftUpLeg,
            this._leftLeg,
            this._leftFoot,
            this._leftToe,
            this._rightUpLeg,
            this._rightLeg,
            this._rightFoot,
            this._rightToe,
        ].filter(Boolean).length;
    }

    private get manualBoneCount(): number {
        return this.manualBones.filter(Boolean).length;
    }

    private get manualBones(): Array<Node | null> {
        return [
            this._torso,
            this._hips,
            this._spine,
            this._spine1,
            this._neck,
            this._head,
            this._leftShoulder,
            this._leftArm,
            this._leftForeArm,
            this._leftHand,
            this._rightArm,
            this._rightShoulder,
            this._rightForeArm,
            this._rightHand,
            this._leftUpLeg,
            this._leftLeg,
            this._leftFoot,
            this._leftToe,
            this._rightUpLeg,
            this._rightLeg,
            this._rightFoot,
            this._rightToe,
        ];
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

function findComponentRecursive<T extends Component>(root: Node, type: new (...args: any[]) => T): T | null {
    const component = root.getComponent(type);
    if (component) {
        return component;
    }
    for (const child of root.children) {
        const found = findComponentRecursive(child, type);
        if (found) {
            return found;
        }
    }
    return null;
}

function collectComponentsRecursive<T extends Component>(root: Node, type: new (...args: any[]) => T, out: T[]) {
    const component = root.getComponent(type);
    if (component) {
        out.push(component);
    }
    for (const child of root.children) {
        collectComponentsRecursive(child, type, out);
    }
}

function setLayerRecursive(root: Node, layer: number) {
    root.layer = layer;
    for (const child of root.children) {
        setLayerRecursive(child, layer);
    }
}

function loadSwimmerPrefab(done: (err: Error | null, prefab: Prefab | null, path?: string) => void) {
    const paths = [
        'models/UserSwimmerLow',
        'models/UserSwimmerLow/UserSwimmerLow',
        'models/UserSwimmer',
        'models/UserSwimmer/UserSwimmer',
    ];
    const tryPath = (index: number) => {
        if (index >= paths.length) {
            done(new Error('swimmer prefab not imported yet'), null);
            return;
        }
        resources.load(paths[index], Prefab, (err, prefab) => {
            if (!err && prefab) {
                done(null, prefab, paths[index]);
                return;
            }
            tryPath(index + 1);
        });
    };
    tryPath(0);
}

function findNode(root: Node, name: string): Node | null {
    if (root.name === name) {
        return root;
    }
    for (const child of root.children) {
        const found = findNode(child, name);
        if (found) {
            return found;
        }
    }
    return null;
}

function isInsideNodeNamed(node: Node, name: string): boolean {
    for (let current: Node | null = node; current; current = current.parent) {
        if (current.name === name) {
            return true;
        }
    }
    return false;
}

function makeMaterial(name: string, albedo: Color, roughness = 0.58, metallic = 0): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-standard' });
    material.name = name;
    material.setProperty('albedo', albedo);
    material.setProperty('roughness', roughness);
    material.setProperty('metallic', metallic);
    return material;
}

function makeSwimmerTextureMaterial(skinColor: Color, suitColor: Color, capColor: Color, robotStyle: boolean): Material {
    const texture = makeSwimmerClothesTexture(skinColor, suitColor, capColor);
    const material = new Material();
    material.initialize({ effectName: 'builtin-standard', defines: { USE_ALBEDO_MAP: true } });
    material.name = 'RuntimeLowSwimmerTexture';
    material.setProperty('albedo', new Color(255, 255, 255, 255));
    material.setProperty('albedoMap', texture);
    material.setProperty('roughness', robotStyle ? 0.36 : 0.56);
    material.setProperty('metallic', robotStyle ? 0.16 : 0);
    return material;
}

let outlineShellEffect: EffectAsset | null = null;
let outlineShellLoading = false;
const outlineShellCallbacks: ((effect: EffectAsset | null) => void)[] = [];

function loadOutlineShellMaterial(done: (material: Material | null) => void) {
    const make = (effect: EffectAsset | null) => {
        if (!effect) {
            done(null);
            return;
        }
        const material = new Material();
        material.initialize({ effectAsset: effect });
        material.name = 'CharacterInvertedHullOutline';
        material.setProperty('lineWidth', OUTLINE_SHELL_WIDTH);
        material.setProperty('depthBias', 0.08);
        material.setProperty('baseColor', new Color(3, 5, 8, 255));
        done(material);
    };

    if (outlineShellEffect) {
        make(outlineShellEffect);
        return;
    }

    outlineShellCallbacks.push(make);
    if (outlineShellLoading) {
        return;
    }
    outlineShellLoading = true;

    resources.load('effects/PlayerOutline', EffectAsset, (err, effect) => {
        outlineShellLoading = false;
        if (err || !effect) {
            console.warn('[SpeedSwimming] failed to load character outline effect', err);
            while (outlineShellCallbacks.length > 0) {
                outlineShellCallbacks.shift()?.(null);
            }
            return;
        }

        outlineShellEffect = effect;
        while (outlineShellCallbacks.length > 0) {
            outlineShellCallbacks.shift()?.(outlineShellEffect);
        }
    });
}

function makeSwimmerClothesTexture(skinColor: Color, suitColor: Color, capColor: Color): Texture2D {
    const data = new Uint8Array(SWIMMER_TEXTURE_SIZE * SWIMMER_TEXTURE_SIZE * 4);
    const suitEdge = darkenColor(suitColor, 0.48);

    for (let y = 0; y < SWIMMER_TEXTURE_SIZE; y++) {
        const v = 1 - (y + 0.5) / SWIMMER_TEXTURE_SIZE;
        for (let x = 0; x < SWIMMER_TEXTURE_SIZE; x++) {
            const u = (x + 0.5) / SWIMMER_TEXTURE_SIZE;
            const nx = (u - 0.5) * 2;
            const color = swimmerTextureColor(nx, v, skinColor, suitColor, capColor, suitEdge);
            const index = (y * SWIMMER_TEXTURE_SIZE + x) * 4;
            data[index] = color.r;
            data[index + 1] = color.g;
            data[index + 2] = color.b;
            data[index + 3] = color.a;
        }
    }

    const texture = new Texture2D('RuntimeLowSwimmerClothes');
    texture.create(SWIMMER_TEXTURE_SIZE, SWIMMER_TEXTURE_SIZE, Texture2D.PixelFormat.RGBA8888);
    texture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
    texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
    texture.uploadData(data);
    return texture;
}

function swimmerTextureColor(nx: number, v: number, skin: Color, suit: Color, cap: Color, suitEdge: Color): Color {
    const ax = Math.abs(nx);
    let color = skin;

    const torsoWidth = 0.38 + clamp((v - 0.54) / 0.30, 0, 1) * 0.22;
    if (v >= 0.42 && v <= 0.91 && ax <= torsoWidth) {
        color = suit;
    }
    if (v >= 0.30 && v < 0.60 && ax <= 0.58) {
        color = suit;
    }
    if (v >= 0.24 && v < 0.47 && ax >= 0.12 && ax <= 0.56) {
        color = suit;
    }
    if (v >= 0.34 && v <= 0.91 && ax >= 0.42 && ax <= 0.98) {
        color = suit;
    }

    if (v >= 0.44 && v <= 0.56 && ax >= 0.58) {
        color = skin;
    }

    if ((v >= 0.902 && v <= 0.915 && ax <= 0.46) || (v >= 0.232 && v <= 0.246 && ax >= 0.12 && ax <= 0.56)) {
        color = suitEdge;
    }
    if (v >= 0.330 && v <= 0.345 && ax >= 0.42 && ax <= 0.98) {
        color = suitEdge;
    }

    if (v >= 0.965 && v <= 1 && ax <= 0.78) {
        color = cap;
    }

    return color;
}

function blendColor(a: Color, b: Color, amount: number): Color {
    const t = Math.max(0, Math.min(1, amount));
    return new Color(
        Math.round(a.r + (b.r - a.r) * t),
        Math.round(a.g + (b.g - a.g) * t),
        Math.round(a.b + (b.b - a.b) * t),
        Math.round(a.a + (b.a - a.a) * t),
    );
}

function darkenColor(color: Color, amount: number): Color {
    const t = Math.max(0, Math.min(1, amount));
    return new Color(
        Math.round(color.r * t),
        Math.round(color.g * t),
        Math.round(color.b * t),
        color.a,
    );
}

function applyMaterialByName(root: Node, names: string[], material: Material): number {
    let count = 0;
    if (names.indexOf(root.name) >= 0) {
        const renderer = root.getComponent(MeshRenderer);
        if (renderer) {
            renderer.setMaterial(material, 0);
            count++;
        }
        const skinned = root.getComponent(SkinnedMeshRenderer);
        if (skinned) {
            skinned.setMaterial(material, 0);
            count++;
        }
    }
    for (const child of root.children) {
        count += applyMaterialByName(child, names, material);
    }
    return count;
}

function positiveMod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function smoothRange(value: number, start: number, end: number): number {
    if (end <= start) {
        return value >= end ? 1 : 0;
    }
    return smoothStep((value - start) / (end - start));
}

function smoothPulse(value: number, fadeInStart: number, fullStart: number, fullEnd: number, fadeOutEnd: number): number {
    const fadeIn = fullStart <= fadeInStart ? 1 : smoothRange(value, fadeInStart, fullStart);
    const fadeOut = fadeOutEnd <= fullEnd ? 1 : 1 - smoothRange(value, fullEnd, fadeOutEnd);
    return clamp(fadeIn * fadeOut, 0, 1);
}

function phase01(value: number, start: number, end: number): number {
    if (value <= start || value >= end) {
        return 0;
    }
    return smoothStep((value - start) / (end - start));
}

type ArmPose = {
    t: number;
    reach: number;
    shoulderX: number;
    shoulderY: number;
    shoulderZ: number;
    upperX: number;
    upperY: number;
    upperZ: number;
    foreX: number;
    foreY: number;
    foreZ: number;
    handX: number;
    handY: number;
    handZ: number;
};

const FREESTYLE_ARM_POSES: ArmPose[] = [
    { t: 0.00, reach: 1, shoulderX: -2, shoulderY: 3, shoulderZ: -2, upperX: -88, upperY: 3, upperZ: -4, foreX: -18, foreY: 0, foreZ: -2, handX: -2, handY: 0, handZ: -1 },
    { t: 0.14, reach: 0.85, shoulderX: -1, shoulderY: 2, shoulderZ: -2, upperX: -78, upperY: 2, upperZ: -5, foreX: 18, foreY: -2, foreZ: -5, handX: -3, handY: -1, handZ: -1 },
    { t: 0.30, reach: 0.25, shoulderX: 0, shoulderY: -1, shoulderZ: -3, upperX: -52, upperY: -2, upperZ: -8, foreX: 46, foreY: -5, foreZ: -8, handX: -2, handY: -1, handZ: -1 },
    { t: 0.48, reach: -0.2, shoulderX: 1, shoulderY: -2, shoulderZ: -2, upperX: -22, upperY: -3, upperZ: -7, foreX: 54, foreY: -4, foreZ: -6, handX: -1, handY: -1, handZ: -1 },
    { t: 0.64, reach: -0.75, shoulderX: 1, shoulderY: -1, shoulderZ: 0, upperX: 12, upperY: -2, upperZ: -3, foreX: 16, foreY: -2, foreZ: -2, handX: 0, handY: 0, handZ: 0 },
    { t: 0.76, reach: -0.35, shoulderX: -1, shoulderY: 3, shoulderZ: 2, upperX: 18, upperY: 5, upperZ: 4, foreX: -24, foreY: 2, foreZ: 3, handX: 1, handY: 0, handZ: 0 },
    { t: 0.88, reach: 0.35, shoulderX: -2, shoulderY: 4, shoulderZ: 3, upperX: -36, upperY: 8, upperZ: 5, foreX: -22, foreY: 2, foreZ: 3, handX: 0, handY: 0, handZ: 0 },
    { t: 1.00, reach: 1, shoulderX: -2, shoulderY: 3, shoulderZ: -2, upperX: -88, upperY: 3, upperZ: -4, foreX: -18, foreY: 0, foreZ: -2, handX: -2, handY: 0, handZ: -1 },
];

function sampleFreestyleArmPose(t: number): ArmPose {
    for (let i = 0; i < FREESTYLE_ARM_POSES.length - 1; i++) {
        const a = FREESTYLE_ARM_POSES[i];
        const b = FREESTYLE_ARM_POSES[i + 1];
        if (t >= a.t && t <= b.t) {
            const ratio = smoothStep((t - a.t) / (b.t - a.t));
            return {
                t,
                reach: lerp(a.reach, b.reach, ratio),
                shoulderX: lerp(a.shoulderX, b.shoulderX, ratio),
                shoulderY: lerp(a.shoulderY, b.shoulderY, ratio),
                shoulderZ: lerp(a.shoulderZ, b.shoulderZ, ratio),
                upperX: lerp(a.upperX, b.upperX, ratio),
                upperY: lerp(a.upperY, b.upperY, ratio),
                upperZ: lerp(a.upperZ, b.upperZ, ratio),
                foreX: lerp(a.foreX, b.foreX, ratio),
                foreY: lerp(a.foreY, b.foreY, ratio),
                foreZ: lerp(a.foreZ, b.foreZ, ratio),
                handX: lerp(a.handX, b.handX, ratio),
                handY: lerp(a.handY, b.handY, ratio),
                handZ: lerp(a.handZ, b.handZ, ratio),
            };
        }
    }
    return FREESTYLE_ARM_POSES[0];
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function smoothStep(t: number): number {
    const clamped = Math.max(0, Math.min(1, t));
    return clamped * clamped * (3 - 2 * clamped);
}

function boneEuler(node: Node | null): string {
    if (!node) {
        return 'missing';
    }
    const euler = node.eulerAngles;
    return `${euler.x.toFixed(1)},${euler.y.toFixed(1)},${euler.z.toFixed(1)}`;
}
