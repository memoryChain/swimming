import { COLLISION_SOFTNESS_TUNING } from '../core/CollisionSoftnessTuning';

export interface CollisionSoftnessState {
    side: number;
    forward: number;
    sideVelocity: number;
    forwardVelocity: number;
}

// 使用位移和速度共同衡量碰撞强度，过零回摆时仍保持松弛，不闪回全力划水。
export function collisionRelaxationTarget(state: Readonly<CollisionSoftnessState>): number {
    if (COLLISION_SOFTNESS_TUNING.enabled < 0.5) return 0;
    const frequency = Math.max(2, COLLISION_SOFTNESS_TUNING.frequency);
    const energy = Math.hypot(state.side, state.forward,
        state.sideVelocity / frequency, state.forwardVelocity / frequency);
    if (!Number.isFinite(energy) || energy < 0.002) return 0;
    return Math.min(1, energy * 4) * Math.max(0, Math.min(1, COLLISION_SOFTNESS_TUNING.relaxation));
}

// 两个解析阻尼振子，只驱动骨骼表现；不影响电机的运动或划水阶段。
export class CollisionSoftnessModel implements CollisionSoftnessState {
    side = 0;
    forward = 0;
    sideVelocity = 0;
    forwardVelocity = 0;

    get active(): boolean {
        return this.side !== 0 || this.forward !== 0
            || this.sideVelocity !== 0 || this.forwardVelocity !== 0;
    }

    reset(): void {
        this.side = this.forward = this.sideVelocity = this.forwardVelocity = 0;
    }

    impulse(side: number, forward: number): void {
        if (COLLISION_SOFTNESS_TUNING.enabled < 0.5) return;
        const gain = COLLISION_SOFTNESS_TUNING.impulseScale;
        this.sideVelocity = bounded(this.sideVelocity + bounded(side, 4) * gain, 20);
        this.forwardVelocity = bounded(this.forwardVelocity + bounded(forward, 4) * gain, 20);
    }

    update(dt: number): void {
        if (!this.active) return;
        if (COLLISION_SOFTNESS_TUNING.enabled < 0.5) {
            this.reset();
            return;
        }
        if (!Number.isFinite(dt) || dt <= 0) return;
        // 解析推进避免 30/60/120Hz 的积分差异，也能在长帧后直接衰减。
        const frequency = Math.max(2, COLLISION_SOFTNESS_TUNING.frequency);
        const damping = Math.max(0.5, Math.min(frequency * 0.95, COLLISION_SOFTNESS_TUNING.damping));
        const omega = Math.sqrt(frequency * frequency - damping * damping);
        const decay = Math.exp(-damping * dt);
        const cos = Math.cos(omega * dt);
        const sinOverOmega = Math.sin(omega * dt) / omega;
        const side = this.side;
        const forward = this.forward;
        this.side = decay * (side * cos + (this.sideVelocity + damping * side) * sinOverOmega);
        this.forward = decay * (forward * cos + (this.forwardVelocity + damping * forward) * sinOverOmega);
        this.sideVelocity = decay * (this.sideVelocity * cos
            - (frequency * frequency * side + damping * this.sideVelocity) * sinOverOmega);
        this.forwardVelocity = decay * (this.forwardVelocity * cos
            - (frequency * frequency * forward + damping * this.forwardVelocity) * sinOverOmega);
        if (Math.abs(this.side) + Math.abs(this.forward) < 0.002
            && Math.abs(this.sideVelocity) + Math.abs(this.forwardVelocity) < 0.02) this.reset();
    }

    correct(state: Readonly<CollisionSoftnessState>, blend: number): void {
        if (COLLISION_SOFTNESS_TUNING.enabled < 0.5) {
            this.reset();
            return;
        }
        const t = Number.isFinite(blend) ? Math.max(0, Math.min(1, blend)) : 0;
        this.side += (bounded(state.side, 2) - this.side) * t;
        this.forward += (bounded(state.forward, 2) - this.forward) * t;
        this.sideVelocity += (bounded(state.sideVelocity, 20) - this.sideVelocity) * t;
        this.forwardVelocity += (bounded(state.forwardVelocity, 20) - this.forwardVelocity) * t;
    }
}

function bounded(value: number, limit: number): number {
    return Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0;
}
