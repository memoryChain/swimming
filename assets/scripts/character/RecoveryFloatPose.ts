import { Node, Quat, Vec3 } from 'cc';
import { findNode } from './CharacterModelLoader';
import { CHARACTER_POSE_TUNING } from './CharacterMotionTuning';

/** 双臂与圈共用的接触解算。只改骨骼和模型子节点，不改泳者赛程。 */
export class RecoveryFloatPose {
    readonly position = new Vec3();
    readonly rotation = new Quat();
    radius = 0.3;
    ready = false;
    private leftArm: Node | null = null;
    private leftElbow: Node | null = null;
    private leftHand: Node | null = null;
    private rightArm: Node | null = null;
    private rightElbow: Node | null = null;
    private rightHand: Node | null = null;
    private readonly a = new Vec3();
    private readonly b = new Vec3();
    private readonly forward = new Vec3(1, 0, 0);
    private readonly side = new Vec3(0, 0, 1);
    private readonly up = new Vec3(0, 1, 0);
    private readonly target = new Vec3();
    private readonly current = new Vec3();
    private readonly world = new Vec3();
    private readonly elbowL = new Vec3();
    private readonly elbowR = new Vec3();
    private readonly handL = new Vec3();
    private readonly handR = new Vec3();
    private readonly worldRotation = new Quat();
    private readonly inverse = new Quat();
    private readonly delta = new Quat();
    private readonly result = new Quat();
    private readonly leftHinge = new Vec3();
    private readonly rightHinge = new Vec3();
    private readonly leftNeutral = new Quat();
    private readonly rightNeutral = new Quat();
    private readonly bodyFront = new Vec3();
    private readonly hingeWorld = new Vec3();
    private readonly desiredHinge = new Vec3();
    private readonly upperDirection = new Vec3();
    private readonly forearmDirection = new Vec3();
    private leftKnee: Node | null = null;
    private rightKnee: Node | null = null;
    private readonly leftKneeHinge = new Vec3();
    private readonly rightKneeHinge = new Vec3();
    private readonly leftKneeNeutral = new Quat();
    private readonly rightKneeNeutral = new Quat();
    private shoulderHalfWidth = 0;
    private upperLength = 0;
    private forearmHalfLength = 0;
    private sizeScale = NaN;
    private armSpread = 0.5;

    bind(root: Node | null): void {
        this.leftArm = root && findNode(root, 'L_Upperarm');
        this.leftElbow = root && findNode(root, 'L_Forearm');
        this.leftHand = root && findNode(root, 'L_Hand');
        this.rightArm = root && findNode(root, 'R_Upperarm');
        this.rightElbow = root && findNode(root, 'R_Forearm');
        this.rightHand = root && findNode(root, 'R_Hand');
        this.ready = false;
        this.sizeScale = NaN;
        const leftHip = root && findNode(root, 'L_Thigh');
        const rightHip = root && findNode(root, 'R_Thigh');
        this.leftKnee = root && findNode(root, 'L_Calf');
        this.rightKnee = root && findNode(root, 'R_Calf');
        if (leftHip && rightHip && this.leftArm && this.rightArm && this.leftElbow && this.rightElbow && this.leftHand && this.rightHand) {
            this.leftArm.getWorldPosition(this.a);
            this.rightArm.getWorldPosition(this.b);
            this.shoulderHalfWidth = Vec3.distance(this.a, this.b) * 0.5;
            Vec3.subtract(this.side, this.a, this.b);
            Vec3.add(this.up, this.a, this.b);
            Vec3.multiplyScalar(this.up, this.up, 0.5);
            leftHip.getWorldPosition(this.world);
            Vec3.scaleAndAdd(this.up, this.up, this.world, -0.5);
            rightHip.getWorldPosition(this.world);
            Vec3.scaleAndAdd(this.up, this.up, this.world, -0.5);
            Vec3.cross(this.bodyFront, this.side, this.up);
            Vec3.normalize(this.bodyFront, this.bodyFront);
            this.bindHinge(this.leftArm, this.leftElbow, this.leftHand, this.leftHinge, this.leftNeutral);
            this.bindHinge(this.rightArm, this.rightElbow, this.rightHand, this.rightHinge, this.rightNeutral);
            this.upperLength = (this.boneLength(this.leftArm, this.leftElbow)
                + this.boneLength(this.rightArm, this.rightElbow)) * 0.5;
            this.forearmHalfLength = (this.boneLength(this.leftElbow, this.leftHand)
                + this.boneLength(this.rightElbow, this.rightHand)) * 0.25;
            const leftFoot = findNode(root!, 'L_Foot');
            const rightFoot = findNode(root!, 'R_Foot');
            if (this.leftKnee && this.rightKnee && leftFoot && rightFoot) {
                this.bindHinge(leftHip, this.leftKnee, leftFoot, this.leftKneeHinge, this.leftKneeNeutral);
                this.bindHinge(rightHip, this.rightKnee, rightFoot, this.rightKneeHinge, this.rightKneeNeutral);
                Vec3.negate(this.leftKneeHinge, this.leftKneeHinge);
                Vec3.negate(this.rightKneeHinge, this.rightKneeHinge);
            }
        }
    }

    apply(model: Node, phase: number, support = 1, fitHeight = true, motionWeight = 1): void {
        const frame = model.parent;
        this.ready = false;
        if (!frame || !this.leftArm || !this.leftElbow || !this.leftHand
            || !this.rightArm || !this.rightElbow || !this.rightHand) return;
        this.updateArmSpread();
        this.localPoint(frame, this.leftArm, this.a);
        this.localPoint(frame, this.rightArm, this.b);
        // 肩部侧摆决定圈面侧摆；前臂始终在同一个支撑平面内。
        this.side.set(0, this.b.y - this.a.y, this.b.z - this.a.z);
        Vec3.normalize(this.side, this.side);
        Vec3.cross(this.up, this.side, this.forward);
        Vec3.normalize(this.up, this.up);
        const legWave = Math.sin(phase - 0.4) * CHARACTER_POSE_TUNING.recoveryFloatLegSwayDegrees * motionWeight * Math.PI / 180;
        this.knee(this.leftKnee, this.leftKneeHinge, this.leftKneeNeutral, 0.24 + (1 - support) * 0.36 + legWave);
        this.knee(this.rightKnee, this.rightKneeHinge, this.rightKneeNeutral, 0.24 + (1 - support) * 0.22 - legWave);
        this.arm(frame, this.leftArm, this.leftElbow, this.leftHand, -1, this.leftHinge, this.leftNeutral, support);
        this.arm(frame, this.rightArm, this.rightElbow, this.rightHand, 1, this.rightHinge, this.rightNeutral, support);
        this.localPoint(frame, this.leftElbow, this.elbowL);
        this.localPoint(frame, this.rightElbow, this.elbowR);
        this.localPoint(frame, this.leftHand, this.handL);
        this.localPoint(frame, this.rightHand, this.handR);
        this.position.set(
            (this.elbowL.x + this.elbowR.x + this.handL.x + this.handR.x) * 0.25,
            (this.elbowL.y + this.elbowR.y + this.handL.y + this.handR.y) * 0.25,
            (this.elbowL.z + this.elbowR.z + this.handL.z + this.handR.z) * 0.25,
        );
        // 前臂是圈沿上的短弦，圈径由真实肩宽和前臂长度确定。
        const halfWidth = Vec3.distance(this.elbowL, this.elbowR) * 0.5;
        const halfLength = (Vec3.distance(this.elbowL, this.handL)
            + Vec3.distance(this.elbowR, this.handR)) * 0.25;
        this.radius = Math.sqrt(halfWidth * halfWidth + halfLength * halfLength);
        // 双臂搭在后半圈，给胸腹留出空间；避免放大后的圈沿切入胸腹。
        this.position.x += this.radius * 0.87;
        Vec3.scaleAndAdd(this.position, this.position, this.up, -(this.radius * 0.24 + 0.02));
        const heightCorrection = fitHeight ? CHARACTER_POSE_TUNING.recoveryFloatSurfaceY
            + Math.sin(phase) * CHARACTER_POSE_TUNING.recoveryFloatBobAmplitude * motionWeight - this.position.y : 0;
        model.setPosition(model.position.x, model.position.y + heightCorrection, model.position.z);
        this.position.y += heightCorrection;
        Quat.fromAxisAngle(this.rotation, Vec3.UNIT_X, Math.atan2(-this.side.y, this.side.z));
        this.ready = true;
    }

    private bindHinge(upper: Node, elbow: Node, hand: Node, hinge: Vec3, neutral: Quat): void {
        upper.getWorldPosition(this.a);
        elbow.getWorldPosition(this.b);
        Vec3.subtract(this.current, this.b, this.a);
        Vec3.cross(hinge, this.current, this.bodyFront);
        Vec3.normalize(hinge, hinge);
        upper.getWorldRotation(this.inverse);
        Quat.invert(this.inverse, this.inverse);
        Vec3.transformQuat(hinge, hinge, this.inverse);
        Vec3.normalize(this.current, hand.position);
        Vec3.transformQuat(this.current, this.current, elbow.rotation);
        Vec3.normalize(this.target, elbow.position);
        Quat.rotationTo(this.delta, this.current, this.target);
        Quat.multiply(neutral, this.delta, elbow.rotation);
    }

    private boneLength(from: Node, to: Node): number {
        from.getWorldPosition(this.a);
        to.getWorldPosition(this.b);
        return Vec3.distance(this.a, this.b);
    }

    private updateArmSpread(): void {
        const scale = Math.max(1, Math.min(1.2, CHARACTER_POSE_TUNING.recoveryFloatSizeScale));
        if (scale === this.sizeScale || this.upperLength <= 0) return;
        this.sizeScale = scale;
        // 放大前先算双肘需要多张开多少，圈仍由真实前臂接触位置确定，不单独缩放造成悬空。
        // 圈径仍以原扶圈臂向量为基准；增加前伸只改变支撑位置，不再把圈放大。
        const oldForwardDown = 0.38 * 0.38 + 0.78 * 0.78;
        const forwardDown = 1.1 * 1.1 + 0.78 * 0.78;
        const oldHalfWidth = this.shoulderHalfWidth + this.upperLength * 0.5 / Math.sqrt(oldForwardDown + 0.25);
        const oldRadiusSquared = oldHalfWidth * oldHalfWidth + this.forearmHalfLength * this.forearmHalfLength;
        const newHalfWidth = Math.sqrt(oldRadiusSquared * scale * scale - this.forearmHalfLength * this.forearmHalfLength);
        const lateral = Math.min(0.88, Math.max(0, (newHalfWidth - this.shoulderHalfWidth) / this.upperLength));
        this.armSpread = Math.sqrt(forwardDown) * lateral / Math.sqrt(1 - lateral * lateral);
    }

    private knee(bone: Node | null, hinge: Vec3, neutral: Quat, flex: number): void {
        if (!bone) return;
        Quat.fromAxisAngle(this.delta, hinge, flex);
        Quat.multiply(this.result, this.delta, neutral);
        bone.setRotation(this.result);
    }

    private arm(frame: Node, upper: Node, elbow: Node, hand: Node, side: number, hinge: Vec3, neutral: Quat, support: number): void {
        const loose = 1 - support;
        this.target.set(0.38 + support * 0.72 - loose * 0.22, 0, 0);
        Vec3.scaleAndAdd(this.target, this.target, this.up, -0.78 + loose * 0.34);
        Vec3.scaleAndAdd(this.target, this.target, this.side, side * (this.armSpread + loose * 0.35));
        this.pointBone(frame, upper, elbow, this.target);
        Vec3.normalize(this.upperDirection, this.target);
        // 调整上臂滚转，使肘只沿人体铰链屈伸，禁止肘侧折或反折。
        // 找圈时双臂向外、前臂抬起；搭稳后略内收，收敛到后半圈的支撑平面。
        this.forearmDirection.set(1, 0, 0);
        Vec3.scaleAndAdd(this.forearmDirection, this.forearmDirection, this.up, loose * (side < 0 ? 0.6 : 0.85));
        Vec3.scaleAndAdd(this.forearmDirection, this.forearmDirection, this.side, side * (loose * 0.3 - support * 0.55));
        Vec3.normalize(this.forearmDirection, this.forearmDirection);
        Vec3.cross(this.desiredHinge, this.upperDirection, this.forearmDirection);
        Vec3.normalize(this.desiredHinge, this.desiredHinge);
        frame.getWorldRotation(this.worldRotation);
        Vec3.transformQuat(this.desiredHinge, this.desiredHinge, this.worldRotation);
        upper.getWorldRotation(this.worldRotation);
        Vec3.transformQuat(this.hingeWorld, hinge, this.worldRotation);
        Quat.rotationTo(this.delta, this.hingeWorld, this.desiredHinge);
        Quat.multiply(this.result, this.delta, this.worldRotation);
        upper.parent!.getWorldRotation(this.inverse);
        Quat.invert(this.inverse, this.inverse);
        Quat.multiply(this.result, this.inverse, this.result);
        upper.setRotation(this.result);
        const flex = Math.acos(Math.max(-1, Math.min(1, Vec3.dot(this.upperDirection, this.forearmDirection))));
        Quat.fromAxisAngle(this.delta, hinge, flex);
        Quat.multiply(this.result, this.delta, neutral);
        elbow.setRotation(this.result);
    }

    private pointBone(frame: Node, bone: Node, child: Node, direction: Vec3): void {
        bone.getWorldPosition(this.a);
        child.getWorldPosition(this.b);
        Vec3.subtract(this.current, this.b, this.a);
        Vec3.normalize(this.current, this.current);
        frame.getWorldRotation(this.worldRotation);
        Vec3.transformQuat(this.world, direction, this.worldRotation);
        Vec3.normalize(this.world, this.world);
        Quat.rotationTo(this.delta, this.current, this.world);
        bone.getWorldRotation(this.worldRotation);
        Quat.multiply(this.result, this.delta, this.worldRotation);
        bone.parent!.getWorldRotation(this.inverse);
        Quat.invert(this.inverse, this.inverse);
        Quat.multiply(this.result, this.inverse, this.result);
        bone.setRotation(this.result);
    }

    private localPoint(frame: Node, bone: Node, out: Vec3): void {
        bone.getWorldPosition(this.world);
        frame.inverseTransformPoint(out, this.world);
    }
}
