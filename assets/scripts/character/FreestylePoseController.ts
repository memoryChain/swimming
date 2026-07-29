import { Node, Quat, Vec3 } from 'cc';
import { FREESTYLE_POSE_TUNING } from './CharacterMotionTuning';
import { MOTION_TUNING } from '../core/InputTuning';
import { BreaststrokeBoneName, BreaststrokeMotionSample, getBreaststrokeSamples } from './BreaststrokeMotionCurve';
import { findNode } from './CharacterModelLoader';
import type { DivePrepBoneName, DivePrepPoseSample } from './DivePrepPoseCurve';
import { FLIP_TURN_KEYFRAME_1, FlipTurnBoneName, FlipTurnPoseSample } from './FlipTurnPoseCurve';
import { findSampledDebugAction, SampledActionBoneName, SampledActionId, SampledActionMotion, SampledActionMotionSample } from './SampledActionMotionCurve';

const BREASTSTROKE_SAMPLED_LIMB_BONES: ReadonlySet<BreaststrokeBoneName> = new Set([
    'L_Clavicle',
    'L_Upperarm',
    'L_Forearm',
    'L_Hand',
    'R_Clavicle',
    'R_Upperarm',
    'R_Forearm',
    'R_Hand',
    'L_Thigh',
    'L_Calf',
    'L_Foot',
    'L_ToeBase',
    'R_Thigh',
    'R_Calf',
    'R_Foot',
    'R_ToeBase',
]);
// Hand thickness differs enough between the four shared-rig meshes that one
// wrist distance either leaves a visible gap or drives the left hand through
// the right. These ratios were measured from the deformed palm surfaces in
// Blender; they leave a small positive contact clearance on every clap.
const CLAP_WRIST_SEPARATION_ARM_RATIOS: Readonly<Record<string, number>> = {
    muscleMan: 0.35,
    women2: 0.215,
    lowPolyHuman2: 0.29,
    diver: 0.33,
};
// Diver's longer upper arms and shorter forearm share produce a much smaller
// wrist arc from the same local rotations. Expand only its open clap phase to
// match the visible range of the other characters.
const CLAP_OPEN_WRIST_SEPARATION_ARM_RATIOS: Readonly<Record<string, number>> = {
    diver: 0.66,
};
const CLAP_CONTACT_PHASES: readonly number[] = [0, 0.228571, 0.485714, 0.771429, 1];
const CLAP_CONTACT_PHASE_HALF_WIDTH = 0.15;
const BONE_ALIASES: Record<string, string[]> = {
    Hips: ['Hip', 'Pelvis'],
    Spine: ['Waist', 'Spine01'],
    Spine1: ['Spine01', 'Spine02'],
    Spine2: ['Spine02'],
    Neck: ['NeckTwist01', 'NeckTwist02'],
    LeftShoulder: ['L_Clavicle'],
    LeftArm: ['L_Upperarm'],
    LeftForeArm: ['L_Forearm'],
    LeftHand: ['L_Hand'],
    RightShoulder: ['R_Clavicle'],
    RightArm: ['R_Upperarm'],
    RightForeArm: ['R_Forearm'],
    RightHand: ['R_Hand'],
    LeftUpLeg: ['L_Thigh'],
    LeftLeg: ['L_Calf'],
    LeftFoot: ['L_Foot'],
    LeftToeBase: ['L_ToeBase'],
    RightUpLeg: ['R_Thigh'],
    RightLeg: ['R_Calf'],
    RightFoot: ['R_Foot'],
    RightToeBase: ['R_ToeBase'],
};

export type ProceduralPoseSnapshot = {
    rootPosition: Vec3;
    rootRotation: Quat;
    boneRotations: Map<Node, Quat>;
};

export class FreestylePoseController {
    public root: Node = null;
    public readonly rootBasePos = new Vec3();
    public readonly rootBaseEuler = new Vec3();
    public readonly rootBaseRotation = new Quat();

    private _torso: Node = null;
    private _rootBone: Node = null;
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
    private readonly _breaststrokeBones = new Map<BreaststrokeBoneName, Node>();
    private _breaststrokeSamplesOverride: readonly BreaststrokeMotionSample[] | null = null;
    private _divePrepPoseOverride: DivePrepPoseSample | null = null;
    private readonly _sampledActionNodes = new Map<string, Node>();
    private readonly _flipTurnBones = new Map<FlipTurnBoneName, Node>();
    private readonly _boneBaseRotation = new Map<Node, Quat>();
    private readonly _boneBasePosition = new Map<Node, Vec3>();
    private readonly _tmpOffsetRotation = new Quat();
    private readonly _tmpResultRotation = new Quat();
    private readonly _tmpAxisRotation = new Quat();
    private readonly _tmpBlendRotation = new Quat();
    private readonly _tmpBlendPosition = new Vec3();
    private readonly _tmpDirection = new Vec3();
    private readonly _tmpWorldDirection = new Vec3();
    private readonly _tmpParentDirection = new Vec3();
    private readonly _tmpBaseDirection = new Vec3();
    private readonly _tmpDeltaRotation = new Quat();
    private readonly _tmpRootWorldRotation = new Quat();
    private readonly _tmpParentWorldRotation = new Quat();
    private readonly _tmpInverseParentWorldRotation = new Quat();
    private readonly _tmpSplashWorldB = new Vec3();
    private readonly _tmpMovementForwardRoot = new Vec3();
    private readonly _tmpGroundHip = new Vec3();
    private readonly _tmpGroundKnee = new Vec3();
    private readonly _tmpGroundAnkle = new Vec3();
    private readonly _tmpGroundTarget = new Vec3();
    private readonly _tmpGroundAxis = new Vec3();
    private readonly _tmpGroundKneeOffset = new Vec3();
    private readonly _tmpGroundDesiredKnee = new Vec3();
    private readonly _tmpGroundFootRotation = new Quat();
    private readonly _tmpGroundToeRotation = new Quat();
    private readonly _tmpGroundBoneRotation = new Quat();
    private readonly _tmpClapCenter = new Vec3();
    private readonly _tmpClapAxis = new Vec3();
    private readonly _tmpClapLeftTarget = new Vec3();
    private readonly _tmpClapRightTarget = new Vec3();
    private readonly _tmpClapHandRotation = new Quat();
    private readonly _movementForwardWorld = new Vec3(1, 0, 0);
    private _sampledActionRestLeftContactOffsetY = 0;
    private _sampledActionRestRightContactOffsetY = 0;
    private _sampledActionHipTranslationScale = 1;
    private _modelVariantId = 'muscleMan';
    private _swimHeadLiftDegrees = FREESTYLE_POSE_TUNING.defaultSwimHeadLiftDegrees;
    private _movementDirectionSign = 1;
    private _movementHeadingRadians = 0;

    bind(root: Node) {
        this.root = root;
        this._rootBone = findNode(root, 'Root');
        this._spine = findBoneNode(root, 'Spine');
        this._spine1 = findBoneNode(root, 'Spine1');
        this._torso = findBoneNode(root, 'Spine2') || this._spine1 || this._spine || findNode(root, 'TorsoMesh');
        this._hips = findBoneNode(root, 'Hips') || findNode(root, 'HipsMesh');
        this._neck = findBoneNode(root, 'Neck');
        this._head = findBoneNode(root, 'Head');
        this._leftShoulder = findBoneNode(root, 'LeftShoulder');
        this._leftArm = findBoneNode(root, 'LeftArm');
        this._leftForeArm = findBoneNode(root, 'LeftForeArm');
        this._leftHand = findBoneNode(root, 'LeftHand');
        this._rightShoulder = findBoneNode(root, 'RightShoulder');
        this._rightArm = findBoneNode(root, 'RightArm');
        this._rightForeArm = findBoneNode(root, 'RightForeArm');
        this._rightHand = findBoneNode(root, 'RightHand');
        this._leftUpLeg = findBoneNode(root, 'LeftUpLeg');
        this._leftLeg = findBoneNode(root, 'LeftLeg');
        this._leftFoot = findBoneNode(root, 'LeftFoot');
        this._leftToe = findBoneNode(root, 'LeftToeBase');
        this._rightUpLeg = findBoneNode(root, 'RightUpLeg');
        this._rightLeg = findBoneNode(root, 'RightLeg');
        this._rightFoot = findBoneNode(root, 'RightFoot');
        this._rightToe = findBoneNode(root, 'RightToeBase');
        this.bindBreaststrokeBones();
        this.bindFlipTurnBones(root);
        this.bindSampledActionNodes(root);
    }

    captureBasePose() {
        if (!this.root) {
            return;
        }
        Vec3.copy(this.rootBasePos, this.root.position);
        Vec3.copy(this.rootBaseEuler, this.root.eulerAngles);
        Quat.copy(this.rootBaseRotation, this.root.rotation);
        this._boneBaseRotation.clear();
        this._boneBasePosition.clear();
        for (const bone of this.manualBones) {
            if (bone) {
                this._boneBaseRotation.set(bone, Quat.clone(bone.rotation));
                this._boneBasePosition.set(bone, Vec3.clone(bone.position));
            }
        }
        for (const bone of this._sampledActionNodes.values()) {
            if (!this._boneBaseRotation.has(bone)) {
                this._boneBaseRotation.set(bone, Quat.clone(bone.rotation));
                this._boneBasePosition.set(bone, Vec3.clone(bone.position));
            }
        }
        this.captureSampledActionGroundPlane();
    }

    setBreaststrokeSamplesOverride(samples: readonly BreaststrokeMotionSample[] | null) {
        this._breaststrokeSamplesOverride = samples;
    }

    setDivePrepPoseOverride(sample: DivePrepPoseSample | null) {
        this._divePrepPoseOverride = sample;
    }

    setModelVariantId(variantId: string) {
        this._modelVariantId = variantId;
    }

    restoreBasePose() {
        this.root?.setPosition(this.rootBasePos);
        this.root?.setRotation(this.rootBaseRotation);
        for (const [bone, rotation] of this._boneBaseRotation) {
            if (bone?.isValid) {
                bone.setRotation(rotation);
            }
        }
        for (const [bone, position] of this._boneBasePosition) {
            if (bone?.isValid) {
                bone.setPosition(position);
            }
        }
    }

    capturePoseSnapshot(): ProceduralPoseSnapshot | null {
        if (!this.root) {
            return null;
        }
        const boneRotations = new Map<Node, Quat>();
        for (const bone of this.manualBones) {
            if (bone?.isValid) {
                boneRotations.set(bone, Quat.clone(bone.rotation));
            }
        }
        return {
            rootPosition: this.root.position.clone(),
            rootRotation: Quat.clone(this.root.rotation),
            boneRotations,
        };
    }

    applyPoseSnapshot(snapshot: ProceduralPoseSnapshot) {
        if (!this.root) {
            return;
        }
        this.root.setPosition(snapshot.rootPosition);
        this.root.setRotation(snapshot.rootRotation);
        for (const [bone, rotation] of snapshot.boneRotations) {
            if (bone.isValid) {
                bone.setRotation(rotation);
            }
        }
    }

    blendPoseSnapshots(from: ProceduralPoseSnapshot, to: ProceduralPoseSnapshot, ratio: number) {
        this.blendPoseSnapshotsWithArmRatio(from, to, ratio, ratio);
    }

    blendPoseSnapshotsWithArmRatio(
        from: ProceduralPoseSnapshot,
        to: ProceduralPoseSnapshot,
        bodyRatio: number,
        armRatio: number,
    ) {
        if (!this.root) {
            return;
        }
        const bodyT = clamp(bodyRatio, 0, 1);
        const armT = clamp(armRatio, 0, 1);
        Vec3.lerp(this._tmpBlendPosition, from.rootPosition, to.rootPosition, bodyT);
        this.root.setPosition(this._tmpBlendPosition);
        Quat.slerp(this._tmpBlendRotation, from.rootRotation, to.rootRotation, bodyT);
        this.root.setRotation(this._tmpBlendRotation);
        for (const [bone, fromRotation] of from.boneRotations) {
            const toRotation = to.boneRotations.get(bone);
            if (!toRotation || !bone.isValid) {
                continue;
            }
            const boneT = this.isArmBone(bone) ? armT : bodyT;
            Quat.slerp(this._tmpBlendRotation, fromRotation, toRotation, boneT);
            bone.setRotation(this._tmpBlendRotation);
        }
    }

    setMovementDirection(direction: number) {
        this._movementDirectionSign = direction >= 0 ? 1 : -1;
        this.updateMovementForwardWorld();
    }

    // Steering heading (radians): the arms reach along the swimmer's ACTUAL
    // travel direction, not a fixed lane axis. Without this the arm-forward is
    // pinned to world X and the arms keep pointing down the lane after the body
    // yaws. World forward = lane axis (by lap sign) rotated by heading about Y.
    setMovementHeadingRadians(headingRadians: number) {
        this._movementHeadingRadians = Number.isFinite(headingRadians) ? headingRadians : 0;
        this.updateMovementForwardWorld();
    }

    private updateMovementForwardWorld() {
        const d = this._movementDirectionSign;
        const h = this._movementHeadingRadians;
        this._movementForwardWorld.set(d * Math.cos(h), 0, Math.sin(h));
    }

    setSwimHeadLift(degrees: number | undefined) {
        this._swimHeadLiftDegrees = typeof degrees === 'number' ? degrees : FREESTYLE_POSE_TUNING.defaultSwimHeadLiftDegrees;
    }

    applyFreestylePose(leftArmCycle: number, rightArmCycle: number, leftKickCycle: number, rightKickCycle: number, bodyPhase: number, upperBodyPower: number, armPower: number, kickPower: number) {
        const rightBreath = this.rightBreathSignal(rightArmCycle);
        this.applyFreestyleRootMotion(leftArmCycle, rightArmCycle, leftKickCycle, rightKickCycle, bodyPhase, rightBreath);
        this.applyUpperBodyRoll(
            this.armReachSignal(leftArmCycle, rightArmCycle),
            upperBodyPower,
            rightBreath,
        );
        this.applyArm(this._leftShoulder, this._leftArm, this._leftForeArm, this._leftHand, this.armPoseCycle(leftArmCycle), armPower);
        this.applyArm(this._rightShoulder, this._rightArm, this._rightForeArm, this._rightHand, this.armPoseCycle(rightArmCycle), armPower);
        this.applyLeg(this._leftUpLeg, this._leftLeg, this._leftFoot, this._leftToe, leftKickCycle, kickPower);
        this.applyLeg(this._rightUpLeg, this._rightLeg, this._rightFoot, this._rightToe, rightKickCycle, kickPower);
    }

    applyFreestyleRootMotion(leftArmCycle: number, rightArmCycle: number, leftKickCycle: number, rightKickCycle: number, bodyPhase: number, rightBreath = 0) {
        if (!this.root) {
            return;
        }
        const bob = Math.sin(bodyPhase) * 0.045;
        const armReach = this.armReachSignal(leftArmCycle, rightArmCycle);
        const breathRatio = clamp(rightBreath, 0, 1);
        const baseBodyRoll = this.sideBodyRollSignal(leftArmCycle, rightArmCycle) * FREESTYLE_POSE_TUNING.freestyleInternalBodyRollDegrees;
        const bodyRoll = baseBodyRoll - breathRatio * MOTION_TUNING.rightBreathBodyRollDegrees;
        const kickSignal = (Math.sin(leftKickCycle) - Math.sin(rightKickCycle)) * 0.5;
        const axisCenteringOffset = this.freestyleAxisCenteringOffset(baseBodyRoll, breathRatio);
        this.laneSideInRootParent(this._tmpParentDirection);
        this.root.setPosition(
            this.rootBasePos.x + armReach * 0.03 + this._tmpParentDirection.x * axisCenteringOffset,
            this.rootBasePos.y + bob + this._tmpParentDirection.y * axisCenteringOffset,
            this.rootBasePos.z + this._tmpParentDirection.z * axisCenteringOffset,
        );
        Quat.fromEuler(
            this._tmpResultRotation,
            this.rootBaseEuler.x + MOTION_TUNING.swimBodyPitchDegrees + kickSignal * 1.5,
            this.rootBaseEuler.y,
            this.rootBaseEuler.z,
        );
        this.applyRootRollAroundMovementAxis(bodyRoll);
        this.root.setRotation(this._tmpResultRotation);
    }

    applyPreviewPose(selfTime: number) {
        const previewArmCycle = selfTime * 3.8;
        const previewKickCycle = selfTime * 7.2;
        this.applyUpperBodyRoll(this.armReachSignal(previewArmCycle, previewArmCycle), 1);
        this.applyArm(this._leftShoulder, this._leftArm, this._leftForeArm, this._leftHand, this.armPoseCycle(previewArmCycle), 1.05);
        this.applyArm(this._rightShoulder, this._rightArm, this._rightForeArm, this._rightHand, this.armPoseCycle(previewArmCycle), 1.05);
        this.applyLeg(this._leftUpLeg, this._leftLeg, this._leftFoot, this._leftToe, previewKickCycle, 1.05);
        this.applyLeg(this._rightUpLeg, this._rightLeg, this._rightFoot, this._rightToe, previewKickCycle, 1.05);
    }

    applyBreaststrokePose(phase: number, power = 1) {
        if (!this.root) {
            return;
        }
        const p = positiveMod(phase, 1);
        const sample = sampleBreaststrokeMotion(1 - p, this._breaststrokeSamplesOverride);
        const hand = sample.hand;
        const foot = sample.foot;
        const head = sample.head;
        const pull = smoothPulse(p, 0.06, 0.14, 0.26, 0.36) + smoothPulse(p, 0.58, 0.66, 0.78, 0.88);
        const recover = smoothPulse(p, 0.28, 0.38, 0.48, 0.58) + smoothPulse(p, 0.80, 0.88, 0.94, 1.0);
        const kick = smoothPulse(p, 0.14, 0.22, 0.36, 0.48) + smoothPulse(p, 0.66, 0.74, 0.88, 0.98);
        const glide = 1 - Math.max(pull, recover, kick);
        const lift = (head[2] - 0.1) * 0.18 + pull * 0.025 - glide * 0.008;

        this.root.setPosition(this.rootBasePos.x + recover * 0.018, this.rootBasePos.y + lift, this.rootBasePos.z);
        this.root.setRotationFromEuler(
            this.rootBaseEuler.x + FREESTYLE_POSE_TUNING.treadWaterBodyForwardDegrees + pull * 0.8 - kick * 0.3,
            this.rootBaseEuler.y + FREESTYLE_POSE_TUNING.treadWaterStraightenYawDegrees,
            this.rootBaseEuler.z + FREESTYLE_POSE_TUNING.treadWaterStraightenRollDegrees,
        );
        this.applyBoneOffset(this._hips, -kick * 1.0, 0, 0);
        this.applyBoneOffset(this._spine, 4 + pull * 0.4, 0, 0);
        this.applyBoneOffset(this._spine1, 6 + pull * 0.6, 0, 0);
        this.applyBoneOffset(this._torso, 5 + this._swimHeadLiftDegrees * 0.04 + pull * 0.8, 0, 0);
        this.applyBoneOffset(this._neck, -1 + this._swimHeadLiftDegrees * 0.2 + pull * 1.0, 0, 0);
        this.applyBoneOffset(this._head, -3 + this._swimHeadLiftDegrees * 0.36 + pull * 1.2, 0, 0);
        this.applyBreaststrokeSampleRotations(sample, power);
    }

    // Blend between the freestyle stroke pose and the tread-water pose so the swimmer
    // can smoothly settle into treading water when it stops mid-race and swim again
    // when it speeds back up. treadWeight 0 = full freestyle, 1 = full tread-water.
    // 在自由泳姿态与踩水姿态之间平滑过渡：比赛途中停下时自然进入踩水，重新加速时切回自由泳。
    // treadWeight 0 = 完全自由泳，1 = 完全踩水。
    applyFreestyleTreadBlendPose(
        leftArmCycle: number,
        rightArmCycle: number,
        leftKickCycle: number,
        rightKickCycle: number,
        bodyPhase: number,
        upperBodyPower: number,
        armPower: number,
        kickPower: number,
        treadPhase: number,
        treadWeight: number,
    ) {
        if (!this.root) {
            return;
        }
        const weight = clamp(treadWeight, 0, 1);
        if (weight <= 0.001) {
            this.applyFreestylePose(leftArmCycle, rightArmCycle, leftKickCycle, rightKickCycle, bodyPhase, upperBodyPower, armPower, kickPower);
            return;
        }
        if (weight >= 0.999) {
            this.restoreBasePose();
            this.applyBreaststrokePose(treadPhase, 1);
            return;
        }

        const bones = this.manualBones.filter((bone): bone is Node => !!bone);
        this.applyFreestylePose(leftArmCycle, rightArmCycle, leftKickCycle, rightKickCycle, bodyPhase, upperBodyPower, armPower, kickPower);
        const freestyleRootPosition = this.root.position.clone();
        const freestyleRootRotation = this.root.rotation.clone();
        const freestyleRotations = bones.map((bone) => bone.rotation.clone());

        this.restoreBasePose();
        this.applyBreaststrokePose(treadPhase, 1);

        Vec3.lerp(this._tmpBlendPosition, freestyleRootPosition, this.root.position, weight);
        this.root.setPosition(this._tmpBlendPosition);
        Quat.slerp(this._tmpBlendRotation, freestyleRootRotation, this.root.rotation, weight);
        this.root.setRotation(this._tmpBlendRotation);
        for (let i = 0; i < bones.length; i++) {
            Quat.slerp(this._tmpBlendRotation, freestyleRotations[i], bones[i].rotation, weight);
            bones[i].setRotation(this._tmpBlendRotation);
        }
    }

    applyDivePrepPose(power = 1) {
        if (!this.root) {
            return;
        }
        this.restoreBasePose();
        const sample = this._divePrepPoseOverride;
        if (sample) {
            this.applySampleRotations(sample, power);
        }
    }

    applyFlipTurnKeyPose(sample: FlipTurnPoseSample, power = 1) {
        if (!this.root) {
            return;
        }
        this.restoreBasePose();
        const blend = clamp(power, 0, 1);
        this.root.setPosition(
            this.rootBasePos.x + sample.rootOffset[0] * blend,
            this.rootBasePos.y + sample.rootOffset[1] * blend,
            this.rootBasePos.z + sample.rootOffset[2] * blend,
        );
        this.applyFlipTurnRotations(sample, blend);
    }

    getHipWorldPosition(out: Vec3): boolean {
        if (!this._hips) {
            return false;
        }
        this._hips.getWorldPosition(out);
        return true;
    }

    getFlipTurnFootContactWorldPositions(outputs: Vec3[]): number {
        const bones = [this._leftFoot, this._leftToe, this._rightFoot, this._rightToe];
        let count = 0;
        for (const bone of bones) {
            if (!bone || count >= outputs.length) {
                continue;
            }
            bone.getWorldPosition(outputs[count]);
            count += 1;
        }
        return count;
    }

    applySampledActionPose(actionId: SampledActionId, phase: number, power = 1, actionOverride?: SampledActionMotion) {
        if (!this.root) {
            return;
        }
        const action = actionOverride ?? findSampledDebugAction(actionId);
        if (!action) {
            return;
        }
        this.restoreBasePose();
        const sample = sampleDebugActionMotion(action.samples, phase);
        this.applySampledActionTranslation(sample, power, action);
        this.applySampledActionRotations(sample, power, action);
        if (actionId === 'clapping') {
            this.applySampledClapContact(sample.phase, power);
        }
        this.applySampledActionGrounding(sample, power);
    }

    applyDivePrepToStreamlinePose(blend: number) {
        if (!this.root) {
            return;
        }
        const t = clamp(blend, 0, 1);
        if (t <= 0) {
            this.applyDivePrepPose(1);
            return;
        }
        if (t >= 1) {
            this.restoreBasePose();
            this.applyFreestylePose(0, 0, 0, 0, 0, 1, 1, 0.9);
            return;
        }

        const bones = this.manualBones.filter((bone): bone is Node => !!bone);
        this.applyDivePrepPose(1);
        const prepRootPosition = this.root.position.clone();
        const prepRootRotation = this.root.rotation.clone();
        const prepRotations = bones.map((bone) => bone.rotation.clone());

        this.restoreBasePose();
        this.applyFreestylePose(0, 0, 0, 0, 0, 1, 1, 0.9);
        const streamlineRootPosition = this.root.position.clone();
        const streamlineRootRotation = this.root.rotation.clone();
        const streamlineRotations = bones.map((bone) => bone.rotation.clone());

        Vec3.lerp(this._tmpBlendPosition, prepRootPosition, streamlineRootPosition, t);
        this.root.setPosition(this._tmpBlendPosition);
        Quat.slerp(this._tmpBlendRotation, prepRootRotation, streamlineRootRotation, t);
        this.root.setRotation(this._tmpBlendRotation);
        for (let i = 0; i < bones.length; i++) {
            Quat.slerp(this._tmpBlendRotation, prepRotations[i], streamlineRotations[i], t);
            bones[i].setRotation(this._tmpBlendRotation);
        }
    }

    applyPreRaceStandingPose() {
        this.restoreBasePose();
        this.applyBoneOffset(this._leftArm, 0, 0, -10);
        this.applyBoneOffset(this._rightArm, 0, 0, 10);
        this.applyBoneOffset(this._leftForeArm, 0, 0, -6);
        this.applyBoneOffset(this._rightForeArm, 0, 0, 6);
        this.applyBoneOffset(this._leftUpLeg, -2, 0, -2);
        this.applyBoneOffset(this._rightUpLeg, 2, 0, 2);
        this.applyBoneOffset(this._leftLeg, 2, 0, 0);
        this.applyBoneOffset(this._rightLeg, -2, 0, 0);
    }

    applyFinishFloatingPose() {
        this.restoreBasePose();
        this.applyBoneOffset(this._spine, -2, 0, 0);
        this.applyBoneOffset(this._spine1, -3, 0, 0);
        this.applyBoneOffset(this._neck, -4, 0, 0);
        this.applyBoneOffset(this._head, -6, 0, 0);
        this.applyBoneOffset(this._leftShoulder, 2, -2, -4);
        this.applyBoneOffset(this._rightShoulder, 2, 2, 4);
        this.applyBoneOffset(this._leftArm, 8, 0, -22);
        this.applyBoneOffset(this._rightArm, 8, 0, 22);
        this.applyBoneOffset(this._leftForeArm, 0, 0, -18);
        this.applyBoneOffset(this._rightForeArm, 0, 0, 18);
        this.applyBoneOffset(this._leftUpLeg, -4, 0, -4);
        this.applyBoneOffset(this._rightUpLeg, 4, 0, 4);
        this.applyBoneOffset(this._leftLeg, 8, 0, 0);
        this.applyBoneOffset(this._rightLeg, -8, 0, 0);
        this.applyBoneOffset(this._leftFoot, 8, 0, 0);
        this.applyBoneOffset(this._rightFoot, 8, 0, 0);
    }

    handWaterContact(cycle: number): number {
        const phase = positiveMod(-this.armPoseCycle(cycle), Math.PI * 2) / (Math.PI * 2);
        const catchToPull = smoothPulse(phase, 0.10, 0.20, 0.46, 0.58);
        const entry = this.handWaterEntry(cycle);
        return Math.max(catchToPull, Math.min(1, entry * 0.65));
    }

    handWaterEntry(cycle: number): number {
        const phase = positiveMod(-this.armPoseCycle(cycle), Math.PI * 2) / (Math.PI * 2);
        return smoothPulse(phase, 0.90, 0.96, 1.0, 1.0) + smoothPulse(phase, 0.0, 0.0, 0.035, 0.09);
    }

    handWaterProgress(cycle: number): number {
        const phase = positiveMod(-this.armPoseCycle(cycle), Math.PI * 2) / (Math.PI * 2);
        if (phase >= 0.10 && phase <= 0.58) {
            return smoothRange(phase, 0.10, 0.58);
        }
        return 0;
    }

    armReachSignal(leftCycle: number, rightCycle = leftCycle): number {
        const leftReach = Math.cos(positiveMod(-this.armPoseCycle(leftCycle), Math.PI * 2));
        const rightReach = Math.cos(positiveMod(-this.armPoseCycle(rightCycle), Math.PI * 2));
        return (leftReach - rightReach) * 0.5;
    }

    sideBodyRollSignal(leftCycle: number, rightCycle = leftCycle): number {
        return -this.armReachSignal(leftCycle, rightCycle);
    }

    private rightBreathSignal(rightCycle: number): number {
        const phase = positiveMod(-this.armPoseCycle(rightCycle), Math.PI * 2) / (Math.PI * 2);
        // Arm pose phase runs from 1 toward 0 while the motor cycle advances.
        const turnInAfterExtension = 1 - smoothRange(phase, 0.82, 0.94);
        const returnNearFullExtension = smoothRange(phase, 0.04, 0.16);
        return clamp(turnInAfterExtension * returnNearFullExtension, 0, 1);
    }

    private armPoseCycle(cycle: number): number {
        return cycle + FREESTYLE_POSE_TUNING.armForwardCycleOffset;
    }

    getSplashBoneWorldPosition(name: string, out: Vec3): boolean {
        if (name.indexOf('Head') >= 0 && this._head) {
            this._head.getWorldPosition(out);
            return true;
        }
        if (name.indexOf('Body') >= 0) {
            const body = this._torso || this._spine1 || this._spine;
            if (body) {
                body.getWorldPosition(out);
                return true;
            }
        }
        if (name.indexOf('LeftHand') >= 0 && this._leftHand) {
            this._leftHand.getWorldPosition(out);
            return true;
        }
        if (name.indexOf('RightHand') >= 0 && this._rightHand) {
            this._rightHand.getWorldPosition(out);
            return true;
        }
        if (name.indexOf('LeftLeg') >= 0 && this._leftLeg) {
            this._leftLeg.getWorldPosition(out);
            return true;
        }
        if (name.indexOf('RightLeg') >= 0 && this._rightLeg) {
            this._rightLeg.getWorldPosition(out);
            return true;
        }
        if (name.indexOf('LeftFoot') >= 0) {
            const left = this._leftToe || this._leftFoot;
            if (left) {
                left.getWorldPosition(out);
                return true;
            }
        }
        if (name.indexOf('RightFoot') >= 0) {
            const right = this._rightToe || this._rightFoot;
            if (right) {
                right.getWorldPosition(out);
                return true;
            }
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

    getUpperBodyWorldPosition(out: Vec3): boolean {
        const upper = this._torso || this._spine1 || this._spine;
        if (upper && this._head) {
            upper.getWorldPosition(out);
            this._head.getWorldPosition(this._tmpSplashWorldB);
            Vec3.lerp(out, out, this._tmpSplashWorldB, 0.28);
            return true;
        }
        if (upper) {
            upper.getWorldPosition(out);
            return true;
        }
        if (this._head) {
            this._head.getWorldPosition(out);
            return true;
        }
        return false;
    }

    // Writes the current world positions of the joints that define the swimmer's
    // lateral footprint. The caller owns/reuses the output vectors, so this is
    // safe to sample every frame without creating garbage.
    getSwimBoundaryWorldPositions(outputs: Vec3[]): number {
        let count = 0;
        count = this.writeBoundaryWorldPosition(this._head, outputs, count);
        count = this.writeBoundaryWorldPosition(this._torso || this._spine1 || this._spine, outputs, count);
        count = this.writeBoundaryWorldPosition(this._leftArm, outputs, count);
        count = this.writeBoundaryWorldPosition(this._leftForeArm, outputs, count);
        count = this.writeBoundaryWorldPosition(this._leftHand, outputs, count);
        count = this.writeBoundaryWorldPosition(this._rightArm, outputs, count);
        count = this.writeBoundaryWorldPosition(this._rightForeArm, outputs, count);
        count = this.writeBoundaryWorldPosition(this._rightHand, outputs, count);
        count = this.writeBoundaryWorldPosition(this._leftToe || this._leftFoot, outputs, count);
        count = this.writeBoundaryWorldPosition(this._rightToe || this._rightFoot, outputs, count);
        return count;
    }

    private writeBoundaryWorldPosition(bone: Node | null, outputs: Vec3[], index: number): number {
        if (!bone || !outputs[index]) {
            return index;
        }
        bone.getWorldPosition(outputs[index]);
        return index + 1;
    }

    get boundJointCount(): number {
        return this.manualBones.filter(Boolean).length;
    }

    get manualBoneCount(): number {
        return this.manualBones.filter(Boolean).length;
    }

    get leftArmPresent(): boolean {
        return !!this._leftArm;
    }

    get rightArmPresent(): boolean {
        return !!this._rightArm;
    }

    get leftLegPresent(): boolean {
        return !!this._leftLeg;
    }

    get rightLegPresent(): boolean {
        return !!this._rightLeg;
    }

    get leftArmEuler(): string {
        return boneEuler(this._leftArm);
    }

    get leftLegEuler(): string {
        return boneEuler(this._leftLeg);
    }

    private get manualBones(): Array<Node | null> {
        const bones: Array<Node | null> = [
            this._torso,
            this._rootBone,
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
        for (const bone of this._flipTurnBones.values()) {
            if (bones.indexOf(bone) < 0) {
                bones.push(bone);
            }
        }
        return bones;
    }

    private isArmBone(bone: Node): boolean {
        return bone === this._leftShoulder
            || bone === this._leftArm
            || bone === this._leftForeArm
            || bone === this._leftHand
            || bone === this._rightShoulder
            || bone === this._rightArm
            || bone === this._rightForeArm
            || bone === this._rightHand;
    }

    private bindFlipTurnBones(root: Node) {
        this._flipTurnBones.clear();
        for (const name of Object.keys(FLIP_TURN_KEYFRAME_1.rotations) as FlipTurnBoneName[]) {
            const bone = findNode(root, name);
            if (bone) {
                this._flipTurnBones.set(name, bone);
            }
        }
    }

    private bindBreaststrokeBones() {
        this._breaststrokeBones.clear();
        const entries: Array<[BreaststrokeBoneName, Node | null]> = [
            ['Root', this._rootBone],
            ['Hip', this._hips],
            ['Waist', this._spine],
            ['Spine01', this._spine1],
            ['Spine02', this._torso],
            ['NeckTwist01', this._neck],
            ['Head', this._head],
            ['L_Clavicle', this._leftShoulder],
            ['L_Upperarm', this._leftArm],
            ['L_Forearm', this._leftForeArm],
            ['L_Hand', this._leftHand],
            ['R_Clavicle', this._rightShoulder],
            ['R_Upperarm', this._rightArm],
            ['R_Forearm', this._rightForeArm],
            ['R_Hand', this._rightHand],
            ['L_Thigh', this._leftUpLeg],
            ['L_Calf', this._leftLeg],
            ['L_Foot', this._leftFoot],
            ['L_ToeBase', this._leftToe],
            ['R_Thigh', this._rightUpLeg],
            ['R_Calf', this._rightLeg],
            ['R_Foot', this._rightFoot],
            ['R_ToeBase', this._rightToe],
        ];
        for (const [name, node] of entries) {
            if (node) {
                this._breaststrokeBones.set(name, node);
            }
        }
    }

    private bindSampledActionNodes(root: Node) {
        this._sampledActionNodes.clear();
        const visit = (node: Node) => {
            this._sampledActionNodes.set(node.name, node);
            for (const child of node.children) {
                visit(child);
            }
        };
        visit(root);
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
        const forwardReach = smoothRange(c, 0.20, 0.96);
        const forwardSideClearance = MOTION_TUNING.forwardArmSideClearance;
        const sideClearance = lerp(0.56, forwardSideClearance, forwardReach);
        const underwaterPull = smoothPulse(normalized, 0.08, 0.18, 0.48, 0.62);
        const recovery = smoothPulse(normalized, 0.56, 0.66, 0.82, 0.94);
        const palmFacingWeight = Math.max(forwardReach, underwaterPull * 0.62, recovery * 0.18);

        const shoulderLift = lerp(-1 - 2 * c, -7.2, forwardReach) * armPower;
        const shoulderOpen = side * lerp(6, 1.2, forwardReach) * armPower;
        const shoulderRoll = side * lerp(2, 0.35, forwardReach) * armPower;
        const elbowStraight = lerp(-6 + 2 * c, 0.2, forwardReach) * armPower;
        const foreArmOpen = side * lerp(3, 0.15, forwardReach) * armPower;
        const foreArmRoll = side * lerp(2, 0.1, forwardReach) * armPower;
        const handNeutral = lerp(-2 * c, -0.1, forwardReach) * armPower;
        const palmTurn = -side * MOTION_TUNING.handPalmTurnDegrees * palmFacingWeight;
        const upperArmPalmTurn = palmTurn * 0.25;
        const foreArmPalmTurn = palmTurn * 0.58;
        const handPalmTurn = palmTurn - upperArmPalmTurn - foreArmPalmTurn;
        const handOpen = side * lerp(2, 0.1, forwardReach) * armPower + handPalmTurn;
        const handRoll = side * lerp(1.5, 0.1, forwardReach) * armPower;

        this.movementForwardInRoot(this._tmpMovementForwardRoot);
        if (forwardReach > 0.02) {
            const forwardShoulderClearance = Math.max(0.46, forwardSideClearance + 0.25);
            const shoulderSideClearance = lerp(0.54, forwardShoulderClearance, forwardReach);
            this._tmpDirection.set(
                side * shoulderSideClearance + this._tmpMovementForwardRoot.x * forwardReach,
                this._tmpMovementForwardRoot.y * forwardReach,
                s * 0.12 + this._tmpMovementForwardRoot.z * forwardReach,
            );
            Vec3.normalize(this._tmpDirection, this._tmpDirection);
            this.applyBoneDirectionFromRootWithOffset(
                shoulder,
                arm,
                this._tmpDirection,
                shoulderLift * 0.45,
                shoulderOpen * 0.35,
                shoulderRoll * 0.35,
            );
        } else {
            this.applyBoneOffset(shoulder, shoulderLift, shoulderOpen, shoulderRoll);
        }
        this._tmpDirection.set(
            side * sideClearance + this._tmpMovementForwardRoot.x * c,
            this._tmpMovementForwardRoot.y * c,
            s + this._tmpMovementForwardRoot.z * c,
        );
        Vec3.normalize(this._tmpDirection, this._tmpDirection);
        this.applyBoneDirectionFromRootWithOffset(arm, foreArm, this._tmpDirection, 0, upperArmPalmTurn, 0);
        if (forwardReach > 0.02) {
            this._tmpDirection.set(
                side * sideClearance * 0.34 + this._tmpMovementForwardRoot.x,
                this._tmpMovementForwardRoot.y,
                s * 0.04 + this._tmpMovementForwardRoot.z,
            );
            Vec3.normalize(this._tmpDirection, this._tmpDirection);
            this.applyBoneDirectionFromRootWithOffset(foreArm, hand, this._tmpDirection, elbowStraight, foreArmOpen + foreArmPalmTurn, foreArmRoll);
        } else {
            this.applyBoneOffset(foreArm, elbowStraight, foreArmOpen + foreArmPalmTurn, foreArmRoll);
        }
        this.applyBoneOffset(hand, handNeutral, handOpen, handRoll);
    }

    private applyBreaststrokeSampleRotations(sample: BreaststrokeMotionSample, power: number) {
        const blend = clamp(power, 0, 1);
        for (const name of Object.keys(sample.rotations) as BreaststrokeBoneName[]) {
            if (!BREASTSTROKE_SAMPLED_LIMB_BONES.has(name)) {
                continue;
            }
            const rotation = sample.rotations[name];
            if (!rotation) {
                continue;
            }
            const bone = this._breaststrokeBones.get(name);
            if (!bone) {
                continue;
            }
            const base = this._boneBaseRotation.get(bone);
            if (base) {
                this.setQuatFromTuple(this._tmpOffsetRotation, rotation);
                if (blend < 0.999) {
                    Quat.slerp(this._tmpOffsetRotation, Quat.IDENTITY, this._tmpOffsetRotation, blend);
                }
                Quat.multiply(this._tmpResultRotation, base, this._tmpOffsetRotation);
                bone.setRotation(this._tmpResultRotation);
            } else {
                this.setQuatFromTuple(this._tmpOffsetRotation, rotation);
                bone.setRotation(this._tmpOffsetRotation);
            }
        }
    }

    private applySampleRotations(sample: DivePrepPoseSample, power: number) {
        // DivePrepPoseCurve stores offsets relative to the captured model base pose.
        const blend = clamp(power, 0, 1);
        for (const name of Object.keys(sample.rotations) as DivePrepBoneName[]) {
            const rotation = sample.rotations[name];
            if (!rotation) {
                continue;
            }
            const bone = this._sampledActionNodes.get(name) ?? this._breaststrokeBones.get(name as BreaststrokeBoneName);
            if (!bone) {
                continue;
            }
            const base = this._boneBaseRotation.get(bone);
            this.setQuatFromTuple(this._tmpOffsetRotation, rotation);
            if (blend < 0.999) {
                Quat.slerp(this._tmpOffsetRotation, Quat.IDENTITY, this._tmpOffsetRotation, blend);
            }
            if (base) {
                Quat.multiply(this._tmpResultRotation, base, this._tmpOffsetRotation);
                bone.setRotation(this._tmpResultRotation);
            } else {
                bone.setRotation(this._tmpOffsetRotation);
            }
        }
    }

    private applyFlipTurnRotations(sample: FlipTurnPoseSample, power: number) {
        const blend = clamp(power, 0, 1);
        for (const name of Object.keys(sample.rotations) as FlipTurnBoneName[]) {
            const rotation = sample.rotations[name];
            const bone = this._flipTurnBones.get(name);
            if (!rotation || !bone) {
                continue;
            }
            const base = this._boneBaseRotation.get(bone);
            this.setQuatFromTuple(this._tmpOffsetRotation, rotation);
            if (blend < 0.999) {
                Quat.slerp(this._tmpOffsetRotation, Quat.IDENTITY, this._tmpOffsetRotation, blend);
            }
            if (base) {
                Quat.multiply(this._tmpResultRotation, base, this._tmpOffsetRotation);
                bone.setRotation(this._tmpResultRotation);
            } else {
                bone.setRotation(this._tmpOffsetRotation);
            }
        }
    }

    private applySampledActionRotations(sample: SampledActionMotionSample, power: number, action: SampledActionMotion) {
        const blend = clamp(power, 0, 1);
        const baseRelative = action.rotationSpace === 'base-relative';
        for (const name of Object.keys(sample.rotations) as SampledActionBoneName[]) {
            const rotation = sample.rotations[name];
            if (!rotation) {
                continue;
            }
            const bone = this._breaststrokeBones.get(name as BreaststrokeBoneName);
            if (!bone) {
                continue;
            }
            const base = this._boneBaseRotation.get(bone);
            this.setQuatFromTuple(this._tmpOffsetRotation, rotation);
            if (baseRelative) {
                // Shared T-pose curves store a local delta from each model's
                // captured bind pose. Different bone lengths remain untouched.
                if (blend < 0.999) {
                    Quat.slerp(this._tmpOffsetRotation, Quat.IDENTITY, this._tmpOffsetRotation, blend);
                }
                if (base) {
                    Quat.multiply(this._tmpResultRotation, base, this._tmpOffsetRotation);
                    bone.setRotation(this._tmpResultRotation);
                } else {
                    bone.setRotation(this._tmpOffsetRotation);
                }
            } else if (base) {
                // Backward-compatible path for the original absolute glTF
                // curves used by non-T-pose characters.
                Quat.slerp(this._tmpResultRotation, base, this._tmpOffsetRotation, blend);
                bone.setRotation(this._tmpResultRotation);
            } else {
                bone.setRotation(this._tmpOffsetRotation);
            }
        }
    }

    private applySampledActionTranslation(sample: SampledActionMotionSample, power: number, action: SampledActionMotion) {
        if (!this._hips) {
            return;
        }
        const base = this._boneBasePosition.get(this._hips);
        if (!base) {
            return;
        }
        const blend = clamp(power, 0, 1);
        if (action.hipTranslationSpace === 'base-relative-normalized') {
            const scale = Math.sqrt(base.x * base.x + base.y * base.y + base.z * base.z);
            this._tmpBlendPosition.set(
                base.x + sample.hipTranslation[0] * scale,
                base.y + sample.hipTranslation[1] * scale,
                base.z + sample.hipTranslation[2] * scale,
            );
        } else {
            this._tmpBlendPosition.set(sample.hipTranslation[0], sample.hipTranslation[1], sample.hipTranslation[2]);
        }
        Vec3.lerp(this._tmpBlendPosition, base, this._tmpBlendPosition, blend);
        this._hips.setPosition(this._tmpBlendPosition);
    }

    private captureSampledActionGroundPlane() {
        if (!this.root) {
            this._sampledActionRestLeftContactOffsetY = 0;
            this._sampledActionRestRightContactOffsetY = 0;
            this._sampledActionHipTranslationScale = 1;
            return;
        }
        this.root.getWorldPosition(this._tmpGroundHip);
        const rootY = this._tmpGroundHip.y;
        const leftY = this.sampledFootContactWorldY(this._leftFoot, this._leftToe);
        const rightY = this.sampledFootContactWorldY(this._rightFoot, this._rightToe);
        this._sampledActionRestLeftContactOffsetY = Number.isFinite(leftY) ? leftY - rootY : 0;
        this._sampledActionRestRightContactOffsetY = Number.isFinite(rightY) ? rightY - rootY : 0;
        const hipBase = this._hips ? this._boneBasePosition.get(this._hips) : null;
        this._sampledActionHipTranslationScale = hipBase
            ? Math.max(0.000001, Math.sqrt(
                hipBase.x * hipBase.x
                + hipBase.y * hipBase.y
                + hipBase.z * hipBase.z
            ))
            : 1;
    }

    private applySampledActionGrounding(sample: SampledActionMotionSample, power: number) {
        if (!this.root || !this._hips) {
            return;
        }
        const contactMask = sample.groundedFeet ?? 0;
        const leftGrounded = (contactMask & 1) !== 0;
        const rightGrounded = (contactMask & 2) !== 0;
        if (!leftGrounded && !rightGrounded) {
            return;
        }
        const blend = clamp(power, 0, 1);
        this.root.getWorldPosition(this._tmpGroundHip);
        const contactHeights = sample.footContactHeights;
        const leftTargetY = (
            this._tmpGroundHip.y
            + this._sampledActionRestLeftContactOffsetY
            + (contactHeights?.[0] ?? 0) * this._sampledActionHipTranslationScale
        );
        const rightTargetY = (
            this._tmpGroundHip.y
            + this._sampledActionRestRightContactOffsetY
            + (contactHeights?.[1] ?? 0) * this._sampledActionHipTranslationScale
        );
        const leftY = leftGrounded
            ? this.sampledFootContactWorldY(this._leftFoot, this._leftToe)
            : Number.NEGATIVE_INFINITY;
        const rightY = rightGrounded
            ? this.sampledFootContactWorldY(this._rightFoot, this._rightToe)
            : Number.NEGATIVE_INFINITY;
        const leftCorrection = leftTargetY - leftY;
        const rightCorrection = rightTargetY - rightY;
        const anchorCorrection = leftGrounded && rightGrounded
            ? Math.min(leftCorrection, rightCorrection)
            : (leftGrounded ? leftCorrection : rightCorrection);
        this._hips.getWorldPosition(this._tmpGroundHip);
        this._tmpGroundHip.y += anchorCorrection * blend;
        this._hips.setWorldPosition(this._tmpGroundHip);

        // A shared Hip shift plants one support foot. When both feet support
        // the body, solve the remaining height difference using this model's
        // own thigh/calf lengths instead of per-character action data.
        if (leftGrounded && rightGrounded) {
            for (let iteration = 0; iteration < 2; iteration++) {
                this.solveSampledLegGroundContact(
                    this._leftUpLeg,
                    this._leftLeg,
                    this._leftFoot,
                    this._leftToe,
                    leftTargetY,
                    blend,
                );
                this.solveSampledLegGroundContact(
                    this._rightUpLeg,
                    this._rightLeg,
                    this._rightFoot,
                    this._rightToe,
                    rightTargetY,
                    blend,
                );
            }
        }
    }

    private sampledFootContactWorldY(foot: Node, toe: Node): number {
        if (!foot && !toe) {
            return Number.POSITIVE_INFINITY;
        }
        let contactY = Number.POSITIVE_INFINITY;
        if (foot) {
            foot.getWorldPosition(this._tmpGroundAnkle);
            contactY = Math.min(contactY, this._tmpGroundAnkle.y);
        }
        if (toe) {
            toe.getWorldPosition(this._tmpGroundTarget);
            contactY = Math.min(contactY, this._tmpGroundTarget.y);
        }
        return contactY;
    }

    private solveSampledLegGroundContact(
        thigh: Node,
        calf: Node,
        foot: Node,
        toe: Node,
        groundY: number,
        power: number,
    ) {
        if (!thigh || !calf || !foot) {
            return;
        }
        const contactError = groundY - this.sampledFootContactWorldY(foot, toe);
        if (Math.abs(contactError) <= 0.0005) {
            return;
        }

        foot.getWorldRotation(this._tmpGroundFootRotation);
        toe?.getWorldRotation(this._tmpGroundToeRotation);
        thigh.getWorldPosition(this._tmpGroundHip);
        calf.getWorldPosition(this._tmpGroundKnee);
        foot.getWorldPosition(this._tmpGroundAnkle);
        Vec3.copy(this._tmpGroundTarget, this._tmpGroundAnkle);
        this._tmpGroundTarget.y += contactError * power;

        const firstLength = Vec3.distance(this._tmpGroundHip, this._tmpGroundKnee);
        const secondLength = Vec3.distance(this._tmpGroundKnee, this._tmpGroundAnkle);
        Vec3.subtract(this._tmpGroundAxis, this._tmpGroundTarget, this._tmpGroundHip);
        const targetDistance = this._tmpGroundAxis.length();
        if (firstLength <= 0.000001 || secondLength <= 0.000001 || targetDistance <= 0.000001) {
            return;
        }
        Vec3.multiplyScalar(this._tmpGroundAxis, this._tmpGroundAxis, 1 / targetDistance);
        const reachableDistance = Math.min(
            firstLength + secondLength - 0.000001,
            Math.max(Math.abs(firstLength - secondLength) + 0.000001, targetDistance),
        );

        Vec3.subtract(this._tmpGroundKneeOffset, this._tmpGroundKnee, this._tmpGroundHip);
        const kneeAlongAxis = Vec3.dot(this._tmpGroundKneeOffset, this._tmpGroundAxis);
        Vec3.scaleAndAdd(
            this._tmpGroundKneeOffset,
            this._tmpGroundKneeOffset,
            this._tmpGroundAxis,
            -kneeAlongAxis,
        );
        if (this._tmpGroundKneeOffset.lengthSqr() <= 0.00000001) {
            if (Math.abs(this._tmpGroundAxis.x) < 0.9) {
                this._tmpGroundKneeOffset.set(
                    0,
                    this._tmpGroundAxis.z,
                    -this._tmpGroundAxis.y,
                );
            } else {
                this._tmpGroundKneeOffset.set(
                    this._tmpGroundAxis.y,
                    -this._tmpGroundAxis.x,
                    0,
                );
            }
        }
        Vec3.normalize(this._tmpGroundKneeOffset, this._tmpGroundKneeOffset);

        const along = (
            firstLength * firstLength
            - secondLength * secondLength
            + reachableDistance * reachableDistance
        ) / (2 * reachableDistance);
        const bendHeight = Math.sqrt(Math.max(0, firstLength * firstLength - along * along));
        Vec3.scaleAndAdd(
            this._tmpGroundDesiredKnee,
            this._tmpGroundHip,
            this._tmpGroundAxis,
            along,
        );
        Vec3.scaleAndAdd(
            this._tmpGroundDesiredKnee,
            this._tmpGroundDesiredKnee,
            this._tmpGroundKneeOffset,
            bendHeight,
        );

        Vec3.subtract(this._tmpWorldDirection, this._tmpGroundKnee, this._tmpGroundHip);
        Vec3.subtract(this._tmpDirection, this._tmpGroundDesiredKnee, this._tmpGroundHip);
        this.rotateWorldBoneDirection(thigh, this._tmpWorldDirection, this._tmpDirection);

        calf.getWorldPosition(this._tmpGroundKnee);
        foot.getWorldPosition(this._tmpGroundAnkle);
        Vec3.subtract(this._tmpWorldDirection, this._tmpGroundAnkle, this._tmpGroundKnee);
        Vec3.subtract(this._tmpDirection, this._tmpGroundTarget, this._tmpGroundKnee);
        this.rotateWorldBoneDirection(calf, this._tmpWorldDirection, this._tmpDirection);

        // IK changes parent transforms, so restore the choreography's ankle
        // and toe orientation after correcting contact height.
        foot.setWorldRotation(this._tmpGroundFootRotation);
        toe?.setWorldRotation(this._tmpGroundToeRotation);
    }

    private applySampledClapContact(phase: number, power: number) {
        if (!this._leftArm || !this._leftForeArm || !this._leftHand
            || !this._rightArm || !this._rightForeArm || !this._rightHand) {
            return;
        }
        let contactWeight = 0;
        for (const contactPhase of CLAP_CONTACT_PHASES) {
            const distance = Math.abs(phase - contactPhase);
            if (distance >= CLAP_CONTACT_PHASE_HALF_WIDTH) {
                continue;
            }
            contactWeight = Math.max(
                contactWeight,
                0.5 + 0.5 * Math.cos(
                    Math.PI * distance / CLAP_CONTACT_PHASE_HALF_WIDTH,
                ),
            );
        }
        const actionPower = clamp(power, 0, 1);
        const openSeparationRatio = (
            CLAP_OPEN_WRIST_SEPARATION_ARM_RATIOS[this._modelVariantId]
        );
        const blend = (
            openSeparationRatio === undefined
                ? contactWeight * actionPower
                : actionPower
        );
        if (blend <= 0) {
            return;
        }

        this._leftHand.getWorldPosition(this._tmpGroundHip);
        this._rightHand.getWorldPosition(this._tmpGroundKnee);
        Vec3.add(this._tmpClapCenter, this._tmpGroundHip, this._tmpGroundKnee);
        Vec3.multiplyScalar(this._tmpClapCenter, this._tmpClapCenter, 0.5);
        Vec3.subtract(this._tmpClapAxis, this._tmpGroundHip, this._tmpGroundKnee);
        const currentSeparation = this._tmpClapAxis.length();
        if (currentSeparation <= 0.000001) {
            return;
        }
        Vec3.multiplyScalar(this._tmpClapAxis, this._tmpClapAxis, 1 / currentSeparation);

        const averageArmLength = (
            this.sampledArmLength(this._leftArm, this._leftForeArm, this._leftHand)
            + this.sampledArmLength(this._rightArm, this._rightForeArm, this._rightHand)
        ) * 0.5;
        if (averageArmLength <= 0.000001) {
            return;
        }
        const separationRatio = (
            CLAP_WRIST_SEPARATION_ARM_RATIOS[this._modelVariantId]
            ?? CLAP_WRIST_SEPARATION_ARM_RATIOS.muscleMan
        );
        const targetSeparationRatio = (
            openSeparationRatio === undefined
                ? separationRatio
                : lerp(openSeparationRatio, separationRatio, contactWeight)
        );
        const contactSeparation = averageArmLength * targetSeparationRatio;
        // Standard rigs need correction only near impact. Diver instead follows
        // an explicit contact-to-open wrist arc because its bone proportions
        // compress the authored opening. Both paths can push intersecting hands
        // apart instead of treating an already-small distance as valid.
        const desiredSeparation = lerp(
            currentSeparation,
            contactSeparation,
            blend,
        );
        Vec3.scaleAndAdd(
            this._tmpClapLeftTarget,
            this._tmpClapCenter,
            this._tmpClapAxis,
            desiredSeparation * 0.5,
        );
        Vec3.scaleAndAdd(
            this._tmpClapRightTarget,
            this._tmpClapCenter,
            this._tmpClapAxis,
            -desiredSeparation * 0.5,
        );

        this.solveSampledArmContact(
            this._leftArm,
            this._leftForeArm,
            this._leftHand,
            this._tmpClapLeftTarget,
        );
        this.solveSampledArmContact(
            this._rightArm,
            this._rightForeArm,
            this._rightHand,
            this._tmpClapRightTarget,
        );
    }

    private sampledArmLength(upperArm: Node, foreArm: Node, hand: Node): number {
        upperArm.getWorldPosition(this._tmpGroundHip);
        foreArm.getWorldPosition(this._tmpGroundKnee);
        hand.getWorldPosition(this._tmpGroundAnkle);
        return (
            Vec3.distance(this._tmpGroundHip, this._tmpGroundKnee)
            + Vec3.distance(this._tmpGroundKnee, this._tmpGroundAnkle)
        );
    }

    private solveSampledArmContact(
        upperArm: Node,
        foreArm: Node,
        hand: Node,
        target: Vec3,
    ) {
        hand.getWorldRotation(this._tmpClapHandRotation);
        upperArm.getWorldPosition(this._tmpGroundHip);
        foreArm.getWorldPosition(this._tmpGroundKnee);
        hand.getWorldPosition(this._tmpGroundAnkle);

        const firstLength = Vec3.distance(this._tmpGroundHip, this._tmpGroundKnee);
        const secondLength = Vec3.distance(this._tmpGroundKnee, this._tmpGroundAnkle);
        Vec3.subtract(this._tmpGroundAxis, target, this._tmpGroundHip);
        const targetDistance = this._tmpGroundAxis.length();
        if (firstLength <= 0.000001 || secondLength <= 0.000001 || targetDistance <= 0.000001) {
            return;
        }
        Vec3.multiplyScalar(this._tmpGroundAxis, this._tmpGroundAxis, 1 / targetDistance);
        const reachableDistance = Math.min(
            firstLength + secondLength - 0.000001,
            Math.max(Math.abs(firstLength - secondLength) + 0.000001, targetDistance),
        );

        // Preserve the sampled elbow bend side so the IK cannot flip between
        // adjacent clap frames.
        Vec3.subtract(this._tmpGroundKneeOffset, this._tmpGroundKnee, this._tmpGroundHip);
        const elbowAlongAxis = Vec3.dot(this._tmpGroundKneeOffset, this._tmpGroundAxis);
        Vec3.scaleAndAdd(
            this._tmpGroundKneeOffset,
            this._tmpGroundKneeOffset,
            this._tmpGroundAxis,
            -elbowAlongAxis,
        );
        if (this._tmpGroundKneeOffset.lengthSqr() <= 0.00000001) {
            if (Math.abs(this._tmpGroundAxis.x) < 0.9) {
                this._tmpGroundKneeOffset.set(
                    0,
                    this._tmpGroundAxis.z,
                    -this._tmpGroundAxis.y,
                );
            } else {
                this._tmpGroundKneeOffset.set(
                    this._tmpGroundAxis.y,
                    -this._tmpGroundAxis.x,
                    0,
                );
            }
        }
        Vec3.normalize(this._tmpGroundKneeOffset, this._tmpGroundKneeOffset);

        const along = (
            firstLength * firstLength
            - secondLength * secondLength
            + reachableDistance * reachableDistance
        ) / (2 * reachableDistance);
        const bendHeight = Math.sqrt(Math.max(0, firstLength * firstLength - along * along));
        Vec3.scaleAndAdd(
            this._tmpGroundDesiredKnee,
            this._tmpGroundHip,
            this._tmpGroundAxis,
            along,
        );
        Vec3.scaleAndAdd(
            this._tmpGroundDesiredKnee,
            this._tmpGroundDesiredKnee,
            this._tmpGroundKneeOffset,
            bendHeight,
        );

        Vec3.subtract(this._tmpWorldDirection, this._tmpGroundKnee, this._tmpGroundHip);
        Vec3.subtract(this._tmpDirection, this._tmpGroundDesiredKnee, this._tmpGroundHip);
        this.rotateWorldBoneDirection(upperArm, this._tmpWorldDirection, this._tmpDirection);

        foreArm.getWorldPosition(this._tmpGroundKnee);
        hand.getWorldPosition(this._tmpGroundAnkle);
        Vec3.subtract(this._tmpWorldDirection, this._tmpGroundAnkle, this._tmpGroundKnee);
        Vec3.subtract(this._tmpDirection, target, this._tmpGroundKnee);
        this.rotateWorldBoneDirection(foreArm, this._tmpWorldDirection, this._tmpDirection);

        // The endpoint solve changes child transforms; keep the sampled palm
        // facing so the hands meet palm-to-palm instead of turning edge-on.
        hand.setWorldRotation(this._tmpClapHandRotation);
    }

    private rotateWorldBoneDirection(bone: Node, current: Vec3, desired: Vec3) {
        if (current.lengthSqr() <= 0.00000001 || desired.lengthSqr() <= 0.00000001) {
            return;
        }
        Vec3.normalize(current, current);
        Vec3.normalize(desired, desired);
        bone.getWorldRotation(this._tmpGroundBoneRotation);
        Quat.rotationTo(this._tmpDeltaRotation, current, desired);
        Quat.multiply(this._tmpResultRotation, this._tmpDeltaRotation, this._tmpGroundBoneRotation);
        bone.setWorldRotation(this._tmpResultRotation);
    }

    private applyDivePrepArmReach(power: number) {
        const reach = FREESTYLE_POSE_TUNING.divePrepArmForwardDegrees * clamp(power, 0, 1);
        this.applyCurrentBoneOffset(this._leftArm, -reach, -reach * 0.2, -reach * 0.15);
        this.applyCurrentBoneOffset(this._rightArm, -reach, reach * 0.2, reach * 0.15);
        this.applyCurrentBoneOffset(this._leftForeArm, -reach * 0.45, 0, -reach * 0.1);
        this.applyCurrentBoneOffset(this._rightForeArm, -reach * 0.45, 0, reach * 0.1);
    }

    private applyDivePrepFootLeveling(power: number) {
        const blend = clamp(power, 0, 1);
        this.levelFootToeDirectionToWorldHorizontal(this._leftFoot, this._leftToe, blend);
        this.levelFootToeDirectionToWorldHorizontal(this._rightFoot, this._rightToe, blend);
    }

    private setQuatFromTuple(out: Quat, value: readonly [number, number, number, number]) {
        out.x = value[0];
        out.y = value[1];
        out.z = value[2];
        out.w = value[3];
    }

    private applyBreaststrokeArm(shoulder: Node, arm: Node, foreArm: Node, hand: Node, side: number, handTarget: readonly [number, number, number], pull: number, recover: number, power: number) {
        if (!arm || !foreArm) {
            return;
        }
        const handSide = Math.abs(handTarget[0]) * 2.0;
        const handForward = clamp(-handTarget[1] * 2.1, 0.18, 1.05);
        const handVertical = handTarget[2] * 1.55;
        const active = Math.max(pull, recover, handSide);
        const elbowSide = lerp(0.18, handSide * 0.78, 0.82);
        const elbowForward = lerp(0.52, handForward * 0.72, 0.72);
        const elbowVertical = lerp(-0.02, handVertical * 0.45, 0.6) - pull * 0.06;
        const foreSide = handSide - elbowSide;
        const foreForward = handForward - elbowForward;
        const foreVertical = handVertical - elbowVertical;
        const elbowBend = pull * 22 + (1 - handForward) * 26 - recover * 18;
        const handCup = pull * 32 + handSide * 14 - recover * 12;

        this.applyBoneOffset(shoulder, pull * -2 + recover * 1.5, side * (handSide * 4 + pull * 2), side * (-2 - handSide * 4));
        this.movementForwardInRoot(this._tmpMovementForwardRoot);
        this._tmpDirection.set(
            side * elbowSide + this._tmpMovementForwardRoot.x * elbowForward,
            this._tmpMovementForwardRoot.y * elbowForward,
            elbowVertical + this._tmpMovementForwardRoot.z * elbowForward,
        );
        Vec3.normalize(this._tmpDirection, this._tmpDirection);
        this.applyBoneDirectionFromRootWithOffset(
            arm,
            foreArm,
            this._tmpDirection,
            -active * 1.4 * power,
            side * (handSide * 2 - pull * 4) * power,
            side * (pull * 3 - recover * 2) * power,
        );

        this._tmpDirection.set(
            side * foreSide + this._tmpMovementForwardRoot.x * foreForward,
            this._tmpMovementForwardRoot.y * foreForward,
            foreVertical + this._tmpMovementForwardRoot.z * foreForward,
        );
        Vec3.normalize(this._tmpDirection, this._tmpDirection);
        this.applyBoneDirectionFromRootWithOffset(
            foreArm,
            hand,
            this._tmpDirection,
            -elbowBend * power,
            side * (handSide * 8 + pull * 3) * power,
            side * (pull * 7 - recover * 4) * power,
        );
        this.applyBoneOffset(hand, -pull * 7, side * handCup * power, side * (pull * 5 - recover * 4) * power);
    }

    private applyUpperBodyRoll(phase: number, power: number, rightBreath = 0) {
        const reach = Math.max(-1, Math.min(1, phase));
        const leftReach = Math.max(0, reach);
        const rightReach = Math.max(0, -reach);
        const breathRatio = clamp(rightBreath, 0, 1);
        const breathTurn = -MOTION_TUNING.rightBreathTurnDegrees * breathRatio * 0.18;
        const headBreathTurn = breathTurn * FREESTYLE_POSE_TUNING.freestyleRightBreathHeadTurnScale;
        const breathLift = smoothRange(breathRatio, 0.08, 0.82);

        const swimHeadLift = this._swimHeadLiftDegrees;
        this.applyBoneOffset(this._torso, swimHeadLift * 0.18 + breathLift * 1.6, breathTurn * 0.1, 0);
        this.applyBoneOffset(this._neck, swimHeadLift * 0.72 + breathLift * 3.0, headBreathTurn * 0.28, 0);
        this.applyBoneOffset(this._head, -2.5 + swimHeadLift * 1.15 + breathLift * 2.1, headBreathTurn * 0.5, 0);
        this.applyBoneOffset(this._leftShoulder, leftReach * -2, 0, leftReach * -3);
        this.applyBoneOffset(this._rightShoulder, rightReach * -2 - breathLift * 3.2, 0, rightReach * 3 - breathLift * 1.8);
    }

    private applyRootRollAroundMovementAxis(degrees: number) {
        if (!this.root) {
            return;
        }
        if (this.root.parent) {
            this.root.parent.getWorldRotation(this._tmpParentWorldRotation);
        } else {
            Quat.copy(this._tmpParentWorldRotation, Quat.IDENTITY);
        }
        Quat.multiply(this._tmpRootWorldRotation, this._tmpParentWorldRotation, this._tmpResultRotation);
        Quat.invert(this._tmpInverseParentWorldRotation, this._tmpRootWorldRotation);
        Vec3.transformQuat(this._tmpDirection, this._movementForwardWorld, this._tmpInverseParentWorldRotation);
        Vec3.normalize(this._tmpDirection, this._tmpDirection);
        Quat.fromAxisAngle(this._tmpAxisRotation, this._tmpDirection, degrees * Math.PI / 180);
        Quat.multiply(this._tmpResultRotation, this._tmpResultRotation, this._tmpAxisRotation);
    }

    private freestyleAxisCenteringOffset(baseBodyRollDegrees: number, rightBreath: number): number {
        const rollRatio = clamp(baseBodyRollDegrees / FREESTYLE_POSE_TUNING.freestyleInternalBodyRollDegrees, -1, 1);
        const rollOffset = -Math.sin(rollRatio * Math.PI * 0.5) * FREESTYLE_POSE_TUNING.freestyleAxisCenteringOffset;
        const breathOffset = clamp(rightBreath, 0, 1) * FREESTYLE_POSE_TUNING.freestyleRightBreathAxisCenteringOffset;
        return (rollOffset + breathOffset) * this._movementDirectionSign;
    }

    private laneSideInRootParent(out: Vec3): Vec3 {
        out.set(0, 0, 1);
        if (!this.root?.parent) {
            return out;
        }
        this.root.parent.getWorldRotation(this._tmpParentWorldRotation);
        Quat.invert(this._tmpInverseParentWorldRotation, this._tmpParentWorldRotation);
        Vec3.transformQuat(out, out, this._tmpInverseParentWorldRotation);
        Vec3.normalize(out, out);
        return out;
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

    private applyBreaststrokeLeg(upLeg: Node, leg: Node, foot: Node, toe: Node, side: number, footTarget: readonly [number, number, number], kick: number, power: number) {
        if (!upLeg || !leg) {
            return;
        }
        const footSide = Math.abs(footTarget[0]) * 2.0;
        const footBack = clamp(footTarget[1] * 2.0, 0.18, 1.15);
        const footVertical = footTarget[2] * 1.7;
        const thighSide = footSide * 0.36;
        const thighBack = footBack * 0.46;
        const thighVertical = footVertical * 0.35;
        const calfSide = footSide - thighSide;
        const calfBack = footBack - thighBack;
        const calfVertical = footVertical - thighVertical;

        this.movementForwardInRoot(this._tmpMovementForwardRoot);
        this._tmpDirection.set(
            side * thighSide - this._tmpMovementForwardRoot.x * thighBack,
            -this._tmpMovementForwardRoot.y * thighBack,
            thighVertical - this._tmpMovementForwardRoot.z * thighBack,
        );
        Vec3.normalize(this._tmpDirection, this._tmpDirection);
        this.applyBoneDirectionFromRootWithOffset(upLeg, leg, this._tmpDirection, kick * -4 * power, side * footSide * 4 * power, side * kick * 4 * power);

        this._tmpDirection.set(
            side * calfSide - this._tmpMovementForwardRoot.x * calfBack,
            -this._tmpMovementForwardRoot.y * calfBack,
            calfVertical - this._tmpMovementForwardRoot.z * calfBack,
        );
        Vec3.normalize(this._tmpDirection, this._tmpDirection);
        this.applyBoneDirectionFromRootWithOffset(leg, foot, this._tmpDirection, kick * -18 * power, side * footSide * 6 * power, side * kick * 5 * power);

        const ankleOut = side * (footSide * 30 + kick * 14);
        const footPitch = -14 - kick * 22 + footVertical * 16;
        this.applyBoneOffset(foot, footPitch * power, ankleOut * power, side * (kick * -6 + footSide * 4) * power);
        this.applyBoneOffset(toe, footPitch * 0.48 * power, ankleOut * 0.48 * power, side * (kick * -3) * power);
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

    private applyCurrentBoneOffset(bone: Node, x: number, y: number, z: number) {
        if (!bone) {
            return;
        }
        Quat.fromEuler(this._tmpOffsetRotation, x, y, z);
        Quat.multiply(this._tmpResultRotation, bone.rotation, this._tmpOffsetRotation);
        bone.setRotation(this._tmpResultRotation);
    }

    private levelFootToeDirectionToWorldHorizontal(foot: Node, toe: Node, power: number) {
        if (!foot || !toe || !foot.parent) {
            return;
        }

        Vec3.copy(this._tmpBaseDirection, toe.position);
        if (this._tmpBaseDirection.lengthSqr() <= 0.000001) {
            return;
        }
        Vec3.normalize(this._tmpBaseDirection, this._tmpBaseDirection);

        foot.getWorldRotation(this._tmpRootWorldRotation);
        Vec3.transformQuat(this._tmpWorldDirection, this._tmpBaseDirection, this._tmpRootWorldRotation);
        Vec3.normalize(this._tmpWorldDirection, this._tmpWorldDirection);

        this._tmpDirection.set(this._tmpWorldDirection.x, 0, this._tmpWorldDirection.z);
        if (this._tmpDirection.lengthSqr() <= 0.000001) {
            return;
        }
        Vec3.normalize(this._tmpDirection, this._tmpDirection);

        Quat.rotationTo(this._tmpDeltaRotation, this._tmpWorldDirection, this._tmpDirection);
        Quat.multiply(this._tmpResultRotation, this._tmpDeltaRotation, this._tmpRootWorldRotation);

        foot.parent.getWorldRotation(this._tmpParentWorldRotation);
        Quat.invert(this._tmpInverseParentWorldRotation, this._tmpParentWorldRotation);
        Quat.multiply(this._tmpResultRotation, this._tmpInverseParentWorldRotation, this._tmpResultRotation);
        if (power < 0.999) {
            Quat.slerp(this._tmpResultRotation, foot.rotation, this._tmpResultRotation, power);
        }
        foot.setRotation(this._tmpResultRotation);
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

    private applyBoneDirectionFromRootWithOffset(bone: Node, child: Node, directionInRoot: Vec3, x: number, y: number, z: number) {
        if (!this.root || !bone?.parent) {
            return;
        }

        this.root.getWorldRotation(this._tmpRootWorldRotation);
        bone.parent.getWorldRotation(this._tmpParentWorldRotation);
        Vec3.transformQuat(this._tmpWorldDirection, directionInRoot, this._tmpRootWorldRotation);
        Quat.invert(this._tmpInverseParentWorldRotation, this._tmpParentWorldRotation);
        Vec3.transformQuat(this._tmpParentDirection, this._tmpWorldDirection, this._tmpInverseParentWorldRotation);
        Vec3.normalize(this._tmpParentDirection, this._tmpParentDirection);
        this.applyBoneDirectionWithOffset(bone, child, this._tmpParentDirection, x, y, z);
    }

    private applyBoneDirectionWithOffset(bone: Node, child: Node, directionInParent: Vec3, x: number, y: number, z: number) {
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
        Quat.fromEuler(this._tmpOffsetRotation, x, y, z);
        Quat.multiply(this._tmpResultRotation, this._tmpResultRotation, this._tmpOffsetRotation);
        bone.setRotation(this._tmpResultRotation);
    }

    private movementForwardInRoot(out: Vec3): Vec3 {
        if (!this.root) {
            out.set(0, 1, 0);
            return out;
        }
        this.root.getWorldRotation(this._tmpRootWorldRotation);
        Quat.invert(this._tmpInverseParentWorldRotation, this._tmpRootWorldRotation);
        Vec3.transformQuat(out, this._movementForwardWorld, this._tmpInverseParentWorldRotation);
        Vec3.normalize(out, out);
        return out;
    }
}

function positiveMod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

function findBoneNode(root: Node, name: string): Node | null {
    const candidates = [name, ...(BONE_ALIASES[name] ?? [])];
    for (const candidate of candidates) {
        const node = findNode(root, candidate);
        if (node) {
            return node;
        }
    }
    return null;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function lerp(from: number, to: number, t: number): number {
    return from + (to - from) * clamp(t, 0, 1);
}

const NEUTRAL_BREASTSTROKE_SAMPLE: BreaststrokeMotionSample = {
    phase: 0,
    root: [0, 0, 0],
    head: [0, 0, 0],
    hand: [0, 0, 0],
    foot: [0, 0, 0],
    rotations: {},
};

function sampleBreaststrokeMotion(
    phase: number,
    samplesOverride: readonly BreaststrokeMotionSample[] | null = null,
): BreaststrokeMotionSample {
    const samples = samplesOverride ?? getBreaststrokeSamples();
    if (samples.length === 0) {
        // Not yet loaded from the race bundle: hold a neutral pose so the tread-water
        // blend has no effect instead of crashing on an empty sample list.
        return NEUTRAL_BREASTSTROKE_SAMPLE;
    }
    if (samples.length === 1) {
        return samples[0];
    }
    const p = positiveMod(phase, 1);
    for (let i = 0; i < samples.length - 1; i++) {
        const current = samples[i];
        const next = samples[i + 1];
        if (p >= current.phase && p <= next.phase) {
            const t = smoothRange(p, current.phase, next.phase);
            return {
                phase: p,
                root: lerpVectorTuple(current.root, next.root, t),
                head: lerpVectorTuple(current.head, next.head, t),
                hand: lerpVectorTuple(current.hand, next.hand, t),
                foot: lerpVectorTuple(current.foot, next.foot, t),
                rotations: slerpBreaststrokeRotations(current.rotations, next.rotations, t),
            };
        }
    }
    return samples[samples.length - 1];
}

function sampleDebugActionMotion(samples: readonly SampledActionMotionSample[], phase: number): SampledActionMotionSample {
    if (samples.length <= 1) {
        return samples[0];
    }
    const p = positiveMod(phase, 1);
    for (let i = 0; i < samples.length - 1; i++) {
        const current = samples[i];
        const next = samples[i + 1];
        if (p >= current.phase && p <= next.phase) {
            const t = smoothRange(p, current.phase, next.phase);
            return {
                phase: p,
                hipTranslation: lerpVectorTuple(current.hipTranslation, next.hipTranslation, t),
                rotations: slerpSampledActionRotations(current.rotations, next.rotations, t),
                // Only keep a planted foot when both adjacent source samples
                // agree, preventing a one-frame ground snap at takeoff/landing.
                groundedFeet: (current.groundedFeet ?? 0) & (next.groundedFeet ?? 0),
                footContactHeights: [
                    lerp(current.footContactHeights?.[0] ?? 0, next.footContactHeights?.[0] ?? 0, t),
                    lerp(current.footContactHeights?.[1] ?? 0, next.footContactHeights?.[1] ?? 0, t),
                ],
            };
        }
    }
    return samples[samples.length - 1];
}

function slerpSampledActionRotations(
    from: SampledActionMotionSample['rotations'],
    to: SampledActionMotionSample['rotations'],
    t: number,
): SampledActionMotionSample['rotations'] {
    return slerpBreaststrokeRotations(from, to, t);
}

function lerpVectorTuple(from: readonly [number, number, number], to: readonly [number, number, number], t: number): readonly [number, number, number] {
    return [
        lerp(from[0], to[0], t),
        lerp(from[1], to[1], t),
        lerp(from[2], to[2], t),
    ];
}

function slerpBreaststrokeRotations(
    from: BreaststrokeMotionSample['rotations'],
    to: BreaststrokeMotionSample['rotations'],
    t: number,
): BreaststrokeMotionSample['rotations'] {
    const rotations: Partial<Record<BreaststrokeBoneName, readonly [number, number, number, number]>> = {};
    for (const name of Object.keys(from) as BreaststrokeBoneName[]) {
        const fromRotation = from[name];
        const toRotation = to[name];
        if (!fromRotation || !toRotation) {
            continue;
        }
        const ax = fromRotation[0];
        const ay = fromRotation[1];
        const az = fromRotation[2];
        const aw = fromRotation[3];
        let bx = toRotation[0];
        let by = toRotation[1];
        let bz = toRotation[2];
        let bw = toRotation[3];
        let dot = ax * bx + ay * by + az * bz + aw * bw;
        if (dot < 0) {
            dot = -dot;
            bx = -bx;
            by = -by;
            bz = -bz;
            bw = -bw;
        }
        if (dot > 0.9995) {
            rotations[name] = normalizeQuatTuple([
                lerp(ax, bx, t),
                lerp(ay, by, t),
                lerp(az, bz, t),
                lerp(aw, bw, t),
            ]);
            continue;
        }
        const theta0 = Math.acos(clamp(dot, -1, 1));
        const theta = theta0 * t;
        const sinTheta = Math.sin(theta);
        const sinTheta0 = Math.sin(theta0);
        const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
        const s1 = sinTheta / sinTheta0;
        rotations[name] = [
            ax * s0 + bx * s1,
            ay * s0 + by * s1,
            az * s0 + bz * s1,
            aw * s0 + bw * s1,
        ];
    }
    return rotations;
}

function normalizeQuatTuple(value: readonly [number, number, number, number]): readonly [number, number, number, number] {
    const length = Math.sqrt(value[0] * value[0] + value[1] * value[1] + value[2] * value[2] + value[3] * value[3]) || 1;
    return [
        value[0] / length,
        value[1] / length,
        value[2] / length,
        value[3] / length,
    ];
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
