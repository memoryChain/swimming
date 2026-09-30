import { BUTTERFLY_TUNING } from '../core/ButterflyTuning';

const unit = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const x = unit(v); return x * x * (3 - 2 * x); };

/** 临界阻尼响应；输入事件只改变目标，不瞬移位置或重置速度。 */
class BodyResponse {
    value = 0;
    private velocity = 0;
    advance(target: number, rate: number, dt: number) {
        const offset = this.value - target;
        const carry = this.velocity + rate * offset;
        const decay = Math.exp(-rate * dt);
        this.value = target + (offset + carry * dt) * decay;
        this.velocity = (this.velocity - rate * carry * dt) * decay;
    }
    reset() { this.value = this.velocity = 0; }
}

/** 本地测试的身体表现。只输出模型偏移，不参与速度、碰撞、潜水或网络状态。 */
export class ButterflyBuoyancy {
    offsetY = 0;
    chestPitch = 0;
    hipPitch = 0;
    waveScale = 1;
    private readonly pressure = new BodyResponse();
    private readonly hips = new BodyResponse();
    private readonly rebound = new BodyResponse();
    private readonly support = new BodyResponse();
    private kickTarget = 0;
    private depth = 0;
    private lift = 0;
    private kickLift = 0;
    private response = 0.12;

    start() {
        this.reset();
        // 每拍快照，修改调参不会让正在播放的姿态跳变。
        this.depth = Math.max(0, Math.min(0.3, BUTTERFLY_TUNING.holdDepthMeters));
        this.lift = Math.max(0, Math.min(0.1, BUTTERFLY_TUNING.releaseLiftMeters));
        this.kickLift = Math.max(0, Math.min(0.1, BUTTERFLY_TUNING.kickLiftMeters));
        this.response = Math.max(0.06, Math.min(0.3, BUTTERFLY_TUNING.buoyancyResponseSeconds));
    }

    kick() { this.kickTarget = Math.min(1, this.kickTarget + 0.45); }

    advance(from: number, to: number, duration: number, release: number, quality: number, timeout: number) {
        // 超时可能发生在一帧内部，必须在事件时刻拆开积分，不能由帧率决定多压一小步。
        if (release >= 0 && from < release && to > release) {
            this.advance(from, release, duration, -1, quality, timeout);
            from = release;
        }
        // 跟随整拍时钟按小步采样输入目标，低帧率和卡顿不改变响应路径。
        const seconds = Math.max(0, to - from) * duration;
        const steps = Math.max(1, Math.ceil(seconds * 120));
        const dt = seconds / steps;
        for (let i = 0; i < steps; i++) {
            const p = from + (to - from) * (i + 0.5) / steps;
            const held = release < 0 || p < release;
            const q = Math.max(0, quality);
            const recovery = held ? 0 : unit((p - release) / Math.max(0.1, 1 - release));
            const push = held ? 0 : Math.sin(Math.PI * recovery) ** 2 * q;
            const rate = 3 / this.response;
            this.pressure.advance(held ? smooth(p / timeout) : 0,
                rate * (held ? 1 : 0.72 + q * 0.28), dt);
            this.hips.advance(this.pressure.value, rate * 0.65, dt);
            this.rebound.advance(push, rate, dt);
            this.support.advance(this.kickTarget, rate, dt);
            this.kickTarget *= Math.exp(-dt / 0.22);
        }
        // 拍尾以零斜率回到公共前伸姿态，深浅不同的相邻两拍也能连续衔接。
        const envelope = 1 - smooth((to - 0.8) / 0.2);
        if (envelope <= 0) {
            this.offsetY = this.chestPitch = this.hipPitch = 0;
            this.waveScale = 1;
            return;
        }
        const pressure = unit(this.pressure.value) * envelope;
        const rebound = unit(this.rebound.value) * envelope;
        const support = unit(this.support.value) * envelope;
        this.offsetY = -this.depth * pressure + this.lift * rebound + this.kickLift * support;
        this.chestPitch = 4 * pressure - 3 * rebound - 2 * support;
        this.hipPitch = -3 * unit(this.hips.value) * envelope;
        this.waveScale = 1 + 0.2 * pressure + 0.35 * rebound;
    }

    reset() {
        this.pressure.reset(); this.hips.reset(); this.rebound.reset(); this.support.reset();
        this.kickTarget = this.offsetY = this.chestPitch = this.hipPitch = 0;
        this.waveScale = 1;
    }
}
