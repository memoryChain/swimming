import { Node, Quat, Vec3 } from 'cc';
import { findNode } from './CharacterModelLoader';

export class FreestylePoseController {
    public root: Node = null;
    public readonly rootBasePos = new Vec3();
    public readonly rootBaseEuler = new Vec3();
    public readonly rootBaseRotation = new Quat();

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
    private readonly _boneBaseRotation = new Map<Node, Quat>();
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
    private readonly _tmpSplashWorldB = new Vec3();

    bind(root: Node) {
        this.root = root;
        this._spine = findNode(root, 'Spine');
        this._spine1 = findNode(root, 'Spine1');
        this._torso = findNode(root, 'Spine2') || this._spine1 || this._spine || findNode(root, 'TorsoMesh');
        this._hips = findNode(root, 'Hips') || findNode(root, 'HipsMesh');
        this._neck = findNode(root, 'Neck');
        this._head = findNode(root, 'Head');
        this._leftShoulder = findNode(root, 'LeftShoulder');
        this._leftArm = findNode(root, 'LeftArm');
        this._leftForeArm = findNode(root, 'LeftForeArm');
        this._leftHand = findNode(root, 'LeftHand');
        this._rightShoulder = findNode(root, 'RightShoulder');
        this._rightArm = findNode(root, 'RightArm');
        this._rightForeArm = findNode(root, 'RightForeArm');
        this._rightHand = findNode(root, 'RightHand');
        this._leftUpLeg = findNode(root, 'LeftUpLeg');
        this._leftLeg = findNode(root, 'LeftLeg');
        this._leftFoot = findNode(root, 'LeftFoot');
        this._leftToe = findNode(root, 'LeftToeBase');
        this._rightUpLeg = findNode(root, 'RightUpLeg');
        this._rightLeg = findNode(root, 'RightLeg');
        this._rightFoot = findNode(root, 'RightFoot');
        this._rightToe = findNode(root, 'RightToeBase');
    }

    captureBasePose() {
        if (!this.root) {
            return;
        }
        Vec3.copy(this.rootBasePos, this.root.position);
        Vec3.copy(this.rootBaseEuler, this.root.eulerAngles);
        Quat.copy(this.rootBaseRotation, this.root.rotation);
        this._boneBaseRotation.clear();
        for (const bone of this.manualBones) {
            if (bone) {
                this._boneBaseRotation.set(bone, Quat.clone(bone.rotation));
            }
        }
    }

    restoreBasePose() {
        this.root?.setPosition(this.rootBasePos);
        this.root?.setRotation(this.rootBaseRotation);
        for (const [bone, rotation] of this._boneBaseRotation) {
            if (bone?.isValid) {
                bone.setRotation(rotation);
            }
        }
    }

    applyFreestylePose(armCycle: number, kickCycle: number, bodyPhase: number, upperBodyPower: number, armPower: number, kickPower: number) {
        this.applyFreestyleRootMotion(armCycle, kickCycle, bodyPhase);
        this.applyUpperBodyRoll(this.armReachSignal(armCycle), upperBodyPower);
        this.applyArm(this._leftShoulder, this._leftArm, this._leftForeArm, this._leftHand, armCycle, armPower);
        this.applyArm(this._rightShoulder, this._rightArm, this._rightForeArm, this._rightHand, armCycle + Math.PI, armPower);
        this.applyLeg(this._leftUpLeg, this._leftLeg, this._leftFoot, this._leftToe, kickCycle, kickPower);
        this.applyLeg(this._rightUpLeg, this._rightLeg, this._rightFoot, this._rightToe, kickCycle + Math.PI, kickPower);
    }

    applyFreestyleRootMotion(armCycle: number, kickCycle: number, bodyPhase: number) {
        if (!this.root) {
            return;
        }
        const bob = Math.sin(bodyPhase) * 0.045;
        const roll = Math.sin(armCycle) * 10;
        this.root.setPosition(this.rootBasePos.x + Math.sin(armCycle) * 0.03, this.rootBasePos.y + bob, this.rootBasePos.z);
        this.root.setRotationFromEuler(
            this.rootBaseEuler.x + Math.sin(kickCycle) * 1.5,
            this.rootBaseEuler.y + roll * 0.16,
            this.rootBaseEuler.z + Math.sin(armCycle) * 1.8,
        );
    }

    applyPreviewPose(selfTime: number) {
        const previewArmCycle = selfTime * 3.8;
        const previewKickCycle = selfTime * 7.2;
        this.applyUpperBodyRoll(this.armReachSignal(previewArmCycle), 1);
        this.applyArm(this._leftShoulder, this._leftArm, this._leftForeArm, this._leftHand, previewArmCycle, 1.05);
        this.applyArm(this._rightShoulder, this._rightArm, this._rightForeArm, this._rightHand, previewArmCycle + Math.PI, 1.05);
        this.applyLeg(this._leftUpLeg, this._leftLeg, this._leftFoot, this._leftToe, previewKickCycle, 1.05);
        this.applyLeg(this._rightUpLeg, this._rightLeg, this._rightFoot, this._rightToe, previewKickCycle + Math.PI, 1.05);
    }

    applyDebugPose(armReach: number, armPower: number, leftArmCycle: number, kickPower: number, leftKickCycle: number) {
        if (!this.root) {
            return;
        }
        this.root.setPosition(this.rootBasePos.x, this.rootBasePos.y, this.rootBasePos.z);
        this.root.setRotation(this.rootBaseRotation);
        this.applyUpperBodyRoll(armReach, armPower);
        this.applyArm(this._leftShoulder, this._leftArm, this._leftForeArm, this._leftHand, leftArmCycle, armPower);
        this.applyArm(this._rightShoulder, this._rightArm, this._rightForeArm, this._rightHand, leftArmCycle + Math.PI, armPower);
        this.applyLeg(this._leftUpLeg, this._leftLeg, this._leftFoot, this._leftToe, leftKickCycle, kickPower);
        this.applyLeg(this._rightUpLeg, this._rightLeg, this._rightFoot, this._rightToe, leftKickCycle + Math.PI, kickPower);
    }

    applyModelDebugPose() {
        this.restoreBasePose();
        this.applyUpperBodyRoll(0, 1);
        this.applyArm(this._leftShoulder, this._leftArm, this._leftForeArm, this._leftHand, 0, 1);
        this.applyArm(this._rightShoulder, this._rightArm, this._rightForeArm, this._rightHand, Math.PI, 1);
        this.applyLeg(this._leftUpLeg, this._leftLeg, this._leftFoot, this._leftToe, 0, 1);
        this.applyLeg(this._rightUpLeg, this._rightLeg, this._rightFoot, this._rightToe, Math.PI, 1);
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

    handWaterContact(cycle: number): number {
        const phase = positiveMod(-cycle, Math.PI * 2) / (Math.PI * 2);
        const catchToPull = smoothPulse(phase, 0.10, 0.20, 0.46, 0.58);
        const entry = smoothPulse(phase, 0.90, 0.96, 1.0, 1.0) + smoothPulse(phase, 0.0, 0.0, 0.035, 0.09);
        return Math.max(catchToPull, Math.min(1, entry * 0.65));
    }

    handWaterProgress(cycle: number): number {
        const phase = positiveMod(-cycle, Math.PI * 2) / (Math.PI * 2);
        if (phase >= 0.10 && phase <= 0.58) {
            return smoothRange(phase, 0.10, 0.58);
        }
        return 0;
    }

    armReachSignal(cycle: number): number {
        const leftReach = Math.cos(positiveMod(-cycle, Math.PI * 2));
        const rightReach = Math.cos(positiveMod(-(cycle + Math.PI), Math.PI * 2));
        return (leftReach - rightReach) * 0.5;
    }

    getSplashBoneWorldPosition(name: string, out: Vec3): boolean {
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
