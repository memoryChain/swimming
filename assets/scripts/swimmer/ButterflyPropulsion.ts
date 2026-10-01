import type { SwimPhysicsInput, SwimPhysicsModel } from './SwimPhysicsModel';

/** 蝶泳独立推进预算。累计曲线跨帧消费，末帧不会多支付；无引擎依赖或逐帧分配。 */
export class ButterflyPropulsion {
    private elapsed = 0;
    private duration = 1;
    private budget = 0;

    get active(): boolean { return this.elapsed < this.duration && this.budget > 0; }
    get impulseBudget(): number { return this.budget; }

    start(impulse: number, seconds: number) {
        this.elapsed = 0;
        this.duration = Number.isFinite(seconds) ? Math.max(0.001, seconds) : 1;
        this.budget = Number.isFinite(impulse) ? Math.max(0, impulse) : 0;
    }

    reset() { this.elapsed = 0; this.duration = 1; this.budget = 0; }

    consume(dt: number): number {
        if (!this.active || !Number.isFinite(dt) || dt <= 0) return 0;
        const before = this.elapsed / this.duration;
        this.elapsed = Math.min(this.duration, this.elapsed + dt);
        return this.budget * (this.cumulative(this.elapsed / this.duration) - this.cumulative(before)) / dt;
    }

    private cumulative(x: number): number {
        // 导数 12x(1-x)^2：起止为零，前三分之一达到峰值，随后平滑收力。
        return x * x * (6 + x * (-8 + 3 * x));
    }
}

/** 仅启用蝶泳时创建；小步消费脉冲并累计位移，不改变自由泳／联机的原积分路径。 */
export class ButterflyPhysicsIntegrator {
    private readonly input: SwimPhysicsInput = {
        dt: 0, strokeAcceleration: 0, kickAcceleration: 0, speedCapBonus: 0,
        glideDrag: 0, environmentDrag: 0,
    };
    private readonly result = { currentSpeed: 0, averageSpeed: 0 };
    get stepAverageSpeed(): number { return this.result.averageSpeed; }

    step(physics: SwimPhysicsModel, pulse: ButterflyPropulsion, speed: number, dt: number,
        strokeAcceleration: number, kickAcceleration: number, speedCapBonus: number,
        glideDrag: number, environmentDrag: number, propulsionScale = 1, pulseDelay = 0) {
        const out = this.result;
        out.currentSpeed = out.averageSpeed = speed;
        if (!Number.isFinite(dt) || dt <= 0) return out;
        // 常规帧按至多 1/120 秒积分；严重卡顿也只做 32 步，避免追帧死亡螺旋。
        const steps = Math.min(32, Math.max(1, Math.ceil(dt * 120 - 1e-9)));
        const step = dt / steps;
        const input = this.input;
        input.kickAcceleration = kickAcceleration;
        input.speedCapBonus = speedCapBonus;
        input.glideDrag = glideDrag;
        input.environmentDrag = environmentDrag;
        const delay = Math.max(0, Math.min(dt, pulseDelay));
        let travelled = 0;
        for (let i = 0; i < steps; i++) {
            const from = i * step, to = (i + 1) * step;
            // 超时在帧中发生时，先积分抱水段，不能提前兑现失误脉冲。
            const beforePulse = Math.max(0, Math.min(to, delay) - from);
            if (beforePulse > 0) {
                input.dt = beforePulse;
                input.strokeAcceleration = strokeAcceleration;
                speed = physics.speedAfterStep(speed, input);
                travelled += speed * beforePulse;
            }
            const activeStep = step - beforePulse;
            if (activeStep > 1e-12) {
                input.dt = activeStep;
                input.strokeAcceleration = strokeAcceleration + pulse.consume(activeStep) * propulsionScale;
                speed = physics.speedAfterStep(speed, input);
                travelled += speed * activeStep;
            }
        }
        out.currentSpeed = speed;
        out.averageSpeed = travelled / dt;
        return out;
    }
}
