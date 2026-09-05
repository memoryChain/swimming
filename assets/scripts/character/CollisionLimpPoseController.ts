import { Node, Quat, Vec3 } from 'cc';
import { COLLISION_SOFTNESS_TUNING } from '../core/CollisionSoftnessTuning';
import { collisionRelaxationTarget, CollisionSoftnessModel, CollisionSoftnessState } from '../swimmer/CollisionSoftnessModel';

type LimpLimb = {
    upper: Node; middle: Node; end: Node;
    side: number; leg: boolean;
    restRoot: Quat; restDirection: Vec3; upperAxis: Vec3;
    hingeAxis: Vec3; neutralMiddle: Quat; endRest: Quat;
    normalRoot: Quat; normalMiddle: Quat; normalEnd: Quat;
    follower: Vec3; velocity: Vec3; flex: number; flexVelocity: number;
    endAngle: number; endVelocity: number; endAxis: Vec3; hingeRoot: Vec3;
};

// 显示层的关节动力学：四肢具有独立速度，碰撞注入冲量，近端保留世界惯性，
// 肘膝与手脚通过父关节加速度耦合。最终姿态仍执行身体外侧与铰链限制。
export class CollisionLimpPoseController {
    private _root: Node | null = null;
    private _head: Node | null = null;
    private _shoulderWidth = 0;
    private readonly _headCenter = new Vec3();
    private readonly _limbs: LimpLimb[] = [];
    private _weight = 0;
    private _initialized = false;
    private readonly _bodySide = new Vec3();
    private readonly _bodyUp = new Vec3();
    private readonly _bodyFront = new Vec3();
    private readonly _rootWorld = new Quat();
    private readonly _inverseRoot = new Quat();
    private readonly _target = new Quat();
    private readonly _delta = new Quat();
    private readonly _result = new Quat();
    private readonly _direction = new Vec3();
    private readonly _other = new Vec3();
    private readonly _cross = new Vec3();
    private readonly _acceleration = new Vec3();
    private readonly _equilibrium = new Vec3();
    private readonly _previousRoot = new Quat();
    private readonly _rootTransport = new Quat();
    private readonly _previousSignal = new CollisionSoftnessModel();

    bind(root: Node, leftArm: Node[], rightArm: Node[], leftLeg: Node[], rightLeg: Node[], head: Node | null = null): void {
        this._root = root;
        this._head = head;
        this._limbs.length = 0;
        this.reset();
        if (!leftArm[0] || !rightArm[0] || !leftLeg[0] || !rightLeg[0]) return;
        root.getWorldRotation(this._rootWorld);
        Quat.invert(this._inverseRoot, this._rootWorld);
        // 从真实肩、髋、脚尖量出身体坐标，不假设模型轴向或左侧正负号。
        leftArm[0].getWorldPosition(this._direction);
        rightArm[0].getWorldPosition(this._other);
        Vec3.subtract(this._bodySide, this._direction, this._other);
        this._shoulderWidth = this._bodySide.length();
        Vec3.transformQuat(this._bodySide, this._bodySide, this._inverseRoot);
        Vec3.normalize(this._bodySide, this._bodySide);
        Vec3.add(this._bodyUp, this._direction, this._other);
        leftLeg[0].getWorldPosition(this._direction);
        rightLeg[0].getWorldPosition(this._other);
        Vec3.subtract(this._bodyUp, this._bodyUp, this._direction);
        Vec3.subtract(this._bodyUp, this._bodyUp, this._other);
        Vec3.transformQuat(this._bodyUp, this._bodyUp, this._inverseRoot);
        Vec3.scaleAndAdd(this._bodyUp, this._bodyUp, this._bodySide, -Vec3.dot(this._bodyUp, this._bodySide));
        Vec3.normalize(this._bodyUp, this._bodyUp);
        Vec3.cross(this._bodyFront, this._bodySide, this._bodyUp);
        if (leftLeg[3] && leftLeg[2]) {
            leftLeg[3].getWorldPosition(this._direction);
            leftLeg[2].getWorldPosition(this._other);
            Vec3.subtract(this._direction, this._direction, this._other);
            Vec3.transformQuat(this._direction, this._direction, this._inverseRoot);
            if (Vec3.dot(this._direction, this._bodyFront) < 0) Vec3.negate(this._bodyFront, this._bodyFront);
        }
        this.bindLimb(leftArm, 1, false);
        this.bindLimb(rightArm, -1, false);
        this.bindLimb(leftLeg, 1, true);
        this.bindLimb(rightLeg, -1, true);
    }

    private bindLimb(chain: Node[], side: number, leg: boolean): void {
        const [upper, middle, end] = chain;
        if (!upper || !middle || !end || middle.parent !== upper || end.parent !== middle) return;
        upper.getWorldRotation(this._target);
        const restRoot = new Quat();
        Quat.multiply(restRoot, this._inverseRoot, this._target);
        const upperAxis = new Vec3();
        Vec3.normalize(upperAxis, middle.position);
        const restDirection = new Vec3();
        Vec3.transformQuat(restDirection, upperAxis, restRoot);
        // 肘朝胸前弯，膝朝背后弯；保留模型本身的骨骼 roll。
        const hingeAxis = new Vec3();
        Vec3.cross(hingeAxis, restDirection, this._bodyFront);
        if (leg) Vec3.negate(hingeAxis, hingeAxis);
        Vec3.normalize(hingeAxis, hingeAxis);
        Quat.invert(this._delta, restRoot);
        Vec3.transformQuat(hingeAxis, hingeAxis, this._delta);
        Vec3.normalize(this._direction, end.position);
        Vec3.transformQuat(this._direction, this._direction, middle.rotation);
        Quat.rotationTo(this._delta, this._direction, upperAxis);
        const neutralMiddle = new Quat();
        Quat.multiply(neutralMiddle, this._delta, middle.rotation);
        const endAxis = new Vec3();
        Quat.invert(this._delta, neutralMiddle);
        Vec3.transformQuat(endAxis, hingeAxis, this._delta);
        const hingeRoot = new Vec3();
        Vec3.transformQuat(hingeRoot, hingeAxis, restRoot);
        this._limbs.push({ upper, middle, end, side, leg, restRoot, restDirection, upperAxis,
            hingeAxis, neutralMiddle, endRest: Quat.clone(end.rotation), normalRoot: new Quat(),
            normalMiddle: new Quat(), normalEnd: new Quat(), follower: new Vec3(), velocity: new Vec3(),
            flex: 0, flexVelocity: 0, endAngle: 0, endVelocity: 0, endAxis, hingeRoot });
    }

    reset(): void { this._weight = 0; this._initialized = false; this._previousSignal.reset(); }

    private bodyDirection(side: number, up: number, front: number): void {
        Vec3.multiplyScalar(this._direction, this._bodySide, side);
        Vec3.scaleAndAdd(this._direction, this._direction, this._bodyUp, up);
        Vec3.scaleAndAdd(this._direction, this._direction, this._bodyFront, front);
        Vec3.normalize(this._direction, this._direction);
    }

    private normalFlex(limb: LimpLimb): number {
        Vec3.normalize(this._other, limb.end.position);
        Vec3.transformQuat(this._other, this._other, limb.normalMiddle);
        Vec3.cross(this._cross, limb.upperAxis, this._other);
        return Math.max(0, Math.min(limb.leg ? 1.4 : 1.9,
            Math.atan2(Vec3.dot(this._cross, limb.hingeAxis), Vec3.dot(limb.upperAxis, this._other))));
    }

    // 在单位方向球面上积分近端；边界碰撞消耗能量，不会把手臂锁死在某一目标角度。
    private constrainFollower(limb: LimpLimb): void {
        const minSide = limb.leg ? 0.06 : 0.4;
        const side = Vec3.dot(limb.follower, this._bodySide) * limb.side;
        if (side < minSide) {
            Vec3.scaleAndAdd(limb.follower, limb.follower, this._bodySide, limb.side * (minSide - side));
            const v = Vec3.dot(limb.velocity, this._bodySide) * limb.side;
            if (v < 0) Vec3.scaleAndAdd(limb.velocity, limb.velocity, this._bodySide, -limb.side * v * 1.15);
        }
        const maxUp = limb.leg ? -0.35 : 0.2;
        const up = Vec3.dot(limb.follower, this._bodyUp);
        if (up > maxUp) {
            Vec3.scaleAndAdd(limb.follower, limb.follower, this._bodyUp, maxUp - up);
            const v = Vec3.dot(limb.velocity, this._bodyUp);
            if (v > 0) Vec3.scaleAndAdd(limb.velocity, limb.velocity, this._bodyUp, -v * 1.15);
        }
        Vec3.normalize(limb.follower, limb.follower);
    }

    private simulateLimb(limb: LimpLimb, sideImpulse: number, forwardImpulse: number, dt: number): void {
        const strength = Math.min(1.7, Math.max(0, limb.leg
            ? COLLISION_SOFTNESS_TUNING.legDegrees / 18 : COLLISION_SOFTNESS_TUNING.armDegrees / 24));
        const frequency = Math.max(0.3, Math.min(2, COLLISION_SOFTNESS_TUNING.followSpeed));
        // 冲量改变速度而不是目标姿态。左右肢体与上下肢的力臂不同。
        Vec3.scaleAndAdd(limb.velocity, limb.velocity, this._bodySide, sideImpulse * strength * (limb.leg ? -2 : 4));
        Vec3.scaleAndAdd(limb.velocity, limb.velocity, this._bodyUp, sideImpulse * limb.side * strength * (limb.leg ? -1.8 : 3.5));
        Vec3.scaleAndAdd(limb.velocity, limb.velocity, this._bodyFront,
            (forwardImpulse * (limb.leg ? 4 : -6) + sideImpulse * limb.side * 2) * strength);
        limb.flexVelocity += (Math.abs(forwardImpulse) * (limb.leg ? 5 : 3)
            + sideImpulse * limb.side * (limb.leg ? -3 : 4)) * strength;
        limb.endVelocity -= (forwardImpulse * 2 + sideImpulse * limb.side) * strength;
        this.bodyDirection(limb.side * (limb.leg ? 0.16 : 0.7), limb.leg ? -1 : -0.45, limb.leg ? 0.1 : 0.15);
        Vec3.copy(this._equilibrium, this._direction);
        // 最多十二个 120Hz 小步；长帧不追算无上限积压，也不会爆炸。
        const duration = Math.min(0.1, dt);
        const count = Math.max(1, Math.ceil(duration * 120));
        const h = duration / count;
        const stiffness = (limb.leg ? 15 : 20) * frequency * frequency;
        const damping = (limb.leg ? 2.6 : 2.1) * frequency;
        for (let j = 0; j < count; j++) {
            Vec3.subtract(this._acceleration, this._equilibrium, limb.follower);
            Vec3.multiplyScalar(this._acceleration, this._acceleration, stiffness);
            Vec3.scaleAndAdd(this._acceleration, this._acceleration, limb.velocity, -damping);
            Vec3.scaleAndAdd(this._acceleration, this._acceleration, limb.follower,
                -Vec3.dot(this._acceleration, limb.follower));
            // 父段的角加速度会让肘膝朝相反方向拖后。
            Vec3.cross(this._cross, limb.follower, this._acceleration);
            const parentAcceleration = Vec3.dot(this._cross, limb.hingeRoot);
            Vec3.scaleAndAdd(limb.velocity, limb.velocity, this._acceleration, h);
            Vec3.scaleAndAdd(limb.velocity, limb.velocity, limb.follower, -Vec3.dot(limb.velocity, limb.follower));
            const speed = limb.velocity.length();
            if (speed > 12) Vec3.multiplyScalar(limb.velocity, limb.velocity, 12 / speed);
            Vec3.scaleAndAdd(limb.follower, limb.follower, limb.velocity, h);
            Vec3.normalize(limb.follower, limb.follower);
            this.constrainFollower(limb);
            const oldFlexVelocity = limb.flexVelocity;
            limb.flexVelocity += ((0.4 - limb.flex) * 12 * frequency * frequency
                - limb.flexVelocity * 1.8 * frequency - parentAcceleration * 0.5) * h;
            limb.flexVelocity = Math.max(-12, Math.min(12, limb.flexVelocity));
            limb.flex += limb.flexVelocity * h;
            const maxFlex = limb.leg ? 1.4 : 1.9;
            if (limb.flex < 0) { limb.flex = 0; limb.flexVelocity = Math.abs(limb.flexVelocity) * 0.15; }
            if (limb.flex > maxFlex) { limb.flex = maxFlex; limb.flexVelocity = -Math.abs(limb.flexVelocity) * 0.15; }
            limb.endVelocity -= (limb.flexVelocity - oldFlexVelocity) * 0.45;
            limb.endVelocity += (-limb.endAngle * 18 * frequency * frequency - limb.endVelocity * 2.5 * frequency) * h;
            limb.endVelocity = Math.max(-10, Math.min(10, limb.endVelocity));
            limb.endAngle += limb.endVelocity * h;
            const endLimit = limb.leg ? 0.4 : 0.6;
            if (limb.endAngle < -endLimit) { limb.endAngle = -endLimit; limb.endVelocity = Math.abs(limb.endVelocity) * 0.15; }
            if (limb.endAngle > endLimit) { limb.endAngle = endLimit; limb.endVelocity = -Math.abs(limb.endVelocity) * 0.15; }
        }
    }

    private avoidHead(limb: LimpLimb): void {
        if (limb.leg || !this._head || this._weight < 0.1) return;
        const radiusSquared = this._shoulderWidth * this._shoulderWidth * 0.27 * 0.27;
        // 两个前臂胶囊的简化检查，避免惯性上扬时穿头；仅碰撞激活时运行。
        for (let attempt = 0; attempt < 3; attempt++) {
            limb.middle.getWorldPosition(this._other);
            limb.end.getWorldPosition(this._cross);
            Vec3.subtract(this._cross, this._cross, this._other);
            Vec3.subtract(this._acceleration, this._headCenter, this._other);
            const t = Math.max(0, Math.min(1, Vec3.dot(this._acceleration, this._cross) / Math.max(1e-8, this._cross.lengthSqr())));
            Vec3.scaleAndAdd(this._other, this._other, this._cross, t);
            if (Vec3.squaredDistance(this._other, this._headCenter) >= radiusSquared) return;
            Vec3.scaleAndAdd(this._direction, this._direction, this._bodySide, limb.side * 0.3);
            Vec3.scaleAndAdd(this._direction, this._direction, this._bodyUp, -0.15);
            Vec3.normalize(this._direction, this._direction);
            Quat.rotationTo(this._delta, limb.restDirection, this._direction);
            Quat.multiply(this._target, this._delta, limb.restRoot);
            Quat.multiply(this._target, this._rootWorld, this._target);
            limb.upper.setWorldRotation(this._target);
            if (this._weight > 0.5) {
                Vec3.copy(limb.follower, this._direction);
                const inward = Vec3.dot(limb.velocity, this._bodySide) * limb.side;
                if (inward < 0) Vec3.scaleAndAdd(limb.velocity, limb.velocity, this._bodySide, -limb.side * inward * 1.15);
            }
        }
    }

    apply(state: Readonly<CollisionSoftnessState>, dt: number): void {
        if (!this._root || COLLISION_SOFTNESS_TUNING.enabled < 0.5) { this.reset(); return; }
        if (this._weight === 0 && !(state.side || state.forward || state.sideVelocity || state.forwardVelocity)) return;
        const targetWeight = collisionRelaxationTarget(state);
        if (targetWeight === 0 && this._weight === 0) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        if (step === 0) return;
        const rate = targetWeight > this._weight ? 22 : 3 / Math.max(0.1, COLLISION_SOFTNESS_TUNING.recoverySeconds);
        this._weight += (targetWeight - this._weight) * (1 - Math.exp(-rate * step));
        if (this._weight < 0.001 && targetWeight === 0) { this.reset(); return; }
        this._root.getWorldRotation(this._rootWorld);
        Quat.invert(this._inverseRoot, this._rootWorld);
        if (this._head) {
            this._head.getWorldPosition(this._headCenter);
            Vec3.transformQuat(this._other, this._bodyUp, this._rootWorld);
            Vec3.scaleAndAdd(this._headCenter, this._headCenter, this._other, this._shoulderWidth * 0.15);
        }
        // 上一帧信号按同一解析模型衰减。只有新增冲量／权威修正产生残差，
        // 不把阻尼振子的每次回摆当成又撞一次；仍只消费已有四个同步标量。
        this._previousSignal.update(step);
        const sideImpulse = Math.max(-1, Math.min(1, (state.sideVelocity - this._previousSignal.sideVelocity) / 20));
        const forwardImpulse = Math.max(-1, Math.min(1, (state.forwardVelocity - this._previousSignal.forwardVelocity) / 20));
        this._previousSignal.side = state.side;
        this._previousSignal.forward = state.forward;
        this._previousSignal.sideVelocity = state.sideVelocity;
        this._previousSignal.forwardVelocity = state.forwardVelocity;
        Quat.multiply(this._rootTransport, this._inverseRoot, this._previousRoot);
        // 跳帧、远端瞬移和重入时放弃旧世界缓存，不能把纠正误差变成一次猛烈甩动。
        const keepInertia = this._initialized && step < 0.2 && Math.abs(this._rootTransport.w) > 0.707;
        for (let i = 0; i < this._limbs.length; i++) {
            const limb = this._limbs[i];
            limb.upper.getWorldRotation(this._target);
            Quat.multiply(limb.normalRoot, this._inverseRoot, this._target);
            Quat.copy(limb.normalMiddle, limb.middle.rotation);
            Quat.copy(limb.normalEnd, limb.end.rotation);
            if (!this._initialized) {
                Vec3.transformQuat(limb.follower, limb.upperAxis, limb.normalRoot);
                limb.velocity.set(0, 0, 0);
                limb.flex = this.normalFlex(limb);
                limb.flexVelocity = limb.endAngle = limb.endVelocity = 0;
            } else if (keepInertia) {
                // 世界朝向先保持，再用有限角度约束回身体外侧；子关节始终在父空间。
                Vec3.transformQuat(limb.follower, limb.follower, this._rootTransport);
                Vec3.transformQuat(limb.velocity, limb.velocity, this._rootTransport);
            } else {
                limb.velocity.set(0, 0, 0);
                limb.flexVelocity = limb.endVelocity = 0;
            }
        }
        this._initialized = true;
        Quat.copy(this._previousRoot, this._rootWorld);
        for (let i = 0; i < this._limbs.length; i++) {
            const limb = this._limbs[i];
            this.simulateLimb(limb, sideImpulse, forwardImpulse, step);
            Vec3.transformQuat(this._direction, limb.upperAxis, limb.normalRoot);
            Vec3.lerp(this._direction, this._direction, limb.follower, this._weight);
            const lateral = Vec3.dot(this._direction, this._bodySide) * limb.side;
            const minLateral = (limb.leg ? 0.06 : 0.4) * this._weight;
            if (lateral < minLateral) Vec3.scaleAndAdd(this._direction, this._direction, this._bodySide,
                limb.side * (minLateral - lateral));
            const up = Vec3.dot(this._direction, this._bodyUp);
            const maxUp = limb.leg ? -0.3 * this._weight : 1 - 0.8 * this._weight;
            if (up > maxUp) Vec3.scaleAndAdd(this._direction, this._direction, this._bodyUp, maxUp - up);
            Vec3.normalize(this._direction, this._direction);
            Quat.rotationTo(this._delta, limb.restDirection, this._direction);
            Quat.multiply(this._target, this._delta, limb.restRoot);
            Quat.slerp(this._result, limb.normalRoot, this._target, this._weight);
            Vec3.transformQuat(this._other, limb.upperAxis, this._result);
            Quat.rotationTo(this._delta, this._other, this._direction);
            Quat.multiply(this._result, this._delta, this._result);
            Quat.multiply(this._result, this._rootWorld, this._result);
            limb.upper.setWorldRotation(this._result);

            const flex = this.normalFlex(limb) * (1 - this._weight) + limb.flex * this._weight;
            Quat.fromAxisAngle(this._delta, limb.hingeAxis, Math.max(0, Math.min(limb.leg ? 1.4 : 1.9, flex)));
            Quat.multiply(this._target, this._delta, limb.neutralMiddle);
            Quat.slerp(this._result, limb.normalMiddle, this._target, Math.min(1, this._weight * 4));
            limb.middle.setRotation(this._result);
            Quat.fromAxisAngle(this._delta, limb.endAxis, limb.endAngle);
            Quat.multiply(this._target, this._delta, limb.endRest);
            Quat.slerp(this._result, limb.normalEnd, this._target, this._weight);
            limb.end.setRotation(this._result);
            this.avoidHead(limb);
        }
    }
}
