import { Node, Quat, Vec3 } from 'cc';
import { CHARACTER_POSE_TUNING as TUNING } from './CharacterMotionTuning';
import type { FreestylePoseController, ProceduralPoseSnapshot } from './FreestylePoseController';

type KeyPose = { pose: ProceduralPoseSnapshot; position: Vec3; rotation: Quat };

/** 失衡、找圈、压圈、扶稳。只由权威已过去时间采样，不另起计时器或接管比赛位移。 */
export class RecoveryFloatSequence {
    private from: KeyPose | null = null;
    private impact: KeyPose | null = null;
    private reach: KeyPose | null = null;
    private model: Node | null = null;
    private settleSeconds = TUNING.recoveryFloatEnterSeconds;
    private readonly position = new Vec3();
    private readonly rotation = new Quat();
    private readonly ringPosition = new Vec3();
    private readonly ringRotation = new Quat();
    private ringRadius = 0.3;
    ringWeight = 0;

    constructor(private readonly pose: FreestylePoseController) {}

    begin(model: Node, settleSeconds = TUNING.recoveryFloatEnterSeconds): void {
        this.reset();
        this.model = model;
        this.settleSeconds = Math.max(0.1, settleSeconds);
        this.from = this.capture(model);
        if (!this.from) return;
        // 先求支撑位置，作为浮圈和后续身体回正的共同目标。
        this.support(model, 0, 0);
        this.position.set(model.position);
        this.ringPosition.set(this.pose.recoveryFloat.position);
        this.ringRotation.set(this.pose.recoveryFloat.rotation);
        this.ringRadius = this.pose.recoveryFloat.radius;
        model.setPosition(this.from.position.x, this.from.position.y + 0.035, this.from.position.z);
        model.setRotationFromEuler(96, 90, 22);
        this.pose.applyEntertainmentKnockoutPose(0.8, 0, model, 0, false);
        this.impact = this.capture(model);
        model.setPosition(0, this.from.position.y * 0.25 + this.position.y * 0.75, 0);
        model.setRotationFromEuler(55, 90, -6);
        this.pose.applyEntertainmentKnockoutPose(0.4, 0, model, 0.55, false);
        this.reach = this.capture(model);
        this.applyKey(model, this.from);
        this.restoreRing();
    }

    apply(model: Node, elapsed: number, landingSeconds: number): void {
        if (this.model !== model || !this.from || !this.impact || !this.reach) this.begin(model);
        const t = Math.max(0, elapsed);
        const impactEnd = Math.max(0.1, TUNING.recoveryFloatImpactSeconds);
        // 空中落水未完成时延后找圈，失衡仍从命中时立即开始。
        const reachStart = Math.max(impactEnd, TUNING.recoveryFloatRingDelaySeconds, landingSeconds - 0.15);
        const reachEnd = reachStart + Math.max(0.1, TUNING.recoveryFloatReachSeconds);
        const settleEnd = reachEnd + this.settleSeconds;
        if (t < impactEnd && this.from && this.impact) {
            this.blend(model, this.from, this.impact, ease(t / impactEnd));
            this.restoreRing();
        } else if (t < reachEnd && this.impact && this.reach) {
            this.blend(model, this.impact, this.reach, ease((t - impactEnd) / (reachEnd - impactEnd)));
            this.restoreRing();
        } else {
            this.support(model, t, Math.max(0, t - settleEnd));
            if (t < settleEnd && this.reach) {
                const weight = ease((t - reachEnd) / this.settleSeconds);
                this.position.set(model.position);
                this.rotation.set(model.rotation);
                this.pose.blendFromPoseSnapshot(this.reach.pose, weight);
                Vec3.lerp(this.position, this.reach.position, this.position, weight);
                Quat.slerp(this.rotation, this.reach.rotation, this.rotation, weight);
                model.setPosition(this.position);
                model.setRotation(this.rotation);
                // 圈从固定出水位置连续接入身体摇摆，避免找圈结束那一帧跳到动态目标。
                const ring = this.pose.recoveryFloat;
                Vec3.lerp(ring.position, this.ringPosition, ring.position, weight);
                Quat.slerp(ring.rotation, this.ringRotation, ring.rotation, weight);
                ring.radius = this.ringRadius + (ring.radius - this.ringRadius) * weight;
            }
        }
        this.ringWeight = ease((t - (reachStart - 0.1)) / Math.max(0.1, reachEnd - reachStart + 0.1));
    }

    reset(): void {
        this.from = this.impact = this.reach = null;
        this.model = null;
        this.ringWeight = 0;
    }

    private support(model: Node, elapsed: number, settledAge: number): void {
        const phase = elapsed * TUNING.recoveryFloatBobSpeed;
        model.setPosition(0, 0, 0);
        model.setRotationFromEuler(TUNING.recoveryFloatBodyTiltDegrees + Math.sin(phase * 0.9) * 1.3,
            90, Math.sin(phase * 0.72) * TUNING.recoveryFloatSwayDegrees);
        this.pose.applyEntertainmentKnockoutPose(phase, elapsed, model);
        // 压住圈沿后下压再回弹；手臂和圈同步，不能穿圈或各晃各的。
        const press = -0.035 * Math.sin(settledAge * 9) * Math.exp(-settledAge * 3.8);
        if (press !== 0) {
            model.setPosition(model.position.x, model.position.y + press, model.position.z);
            this.pose.recoveryFloat.position.y += press;
        }
    }

    private restoreRing(): void {
        this.pose.recoveryFloat.position.set(this.ringPosition);
        this.pose.recoveryFloat.rotation.set(this.ringRotation);
        this.pose.recoveryFloat.radius = this.ringRadius;
    }

    private capture(model: Node): KeyPose | null {
        const pose = this.pose.capturePoseSnapshot();
        return pose ? { pose, position: Vec3.clone(model.position), rotation: Quat.clone(model.rotation) } : null;
    }

    private applyKey(model: Node, key: KeyPose): void {
        this.pose.applyPoseSnapshot(key.pose);
        model.setPosition(key.position);
        model.setRotation(key.rotation);
    }

    private blend(model: Node, from: KeyPose, to: KeyPose, weight: number): void {
        this.pose.blendPoseSnapshots(from.pose, to.pose, weight);
        Vec3.lerp(this.position, from.position, to.position, weight);
        Quat.slerp(this.rotation, from.rotation, to.rotation, weight);
        model.setPosition(this.position);
        model.setRotation(this.rotation);
    }
}

function ease(value: number): number {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
}
