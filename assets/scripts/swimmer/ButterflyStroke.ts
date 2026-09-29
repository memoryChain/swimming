import { BUTTERFLY_TUNING } from '../core/ButterflyTuning';

/** 整拍时钟与单次结算。无引擎依赖，输入、物理和动作消费同一进度。 */
export class ButterflyStroke {
    active = false;
    held = false;
    progress = 0;
    elapsed = 0;
    duration = 1;
    perfectStart = 0;
    perfectEnd = 0;
    timeout = 0.6;
    quality = -1;
    sequence = 0;
    settledSequence = 0;
    lastQuality = -1;
    timedOut = false;
    lastTimedOut = false;

    start(cadenceScale = 1): boolean {
        if (this.active) return false;
        this.active = this.held = true;
        this.progress = this.elapsed = 0;
        this.quality = -1;
        this.timedOut = false;
        this.duration = Math.max(0.35, BUTTERFLY_TUNING.cycleSeconds / Math.max(0.25, cadenceScale));
        this.timeout = Math.max(0.35, Math.min(0.8, BUTTERFLY_TUNING.timeoutProgress));
        this.perfectStart = Math.max(0.12, Math.min(this.timeout - 0.08, BUTTERFLY_TUNING.perfectStart));
        this.perfectEnd = Math.max(this.perfectStart + 0.02, Math.min(this.timeout - 0.02, BUTTERFLY_TUNING.perfectEnd));
        this.sequence++;
        return true;
    }

    release(): boolean {
        if (!this.active || !this.held) return false;
        this.held = false;
        this.quality = this.progress >= this.perfectStart && this.progress <= this.perfectEnd ? 1
            : this.progress >= 0.16 && this.progress < this.timeout ? 0.5 : 0;
        this.lastQuality = this.quality;
        this.lastTimedOut = false;
        this.settledSequence = this.sequence;
        return true;
    }

    /** 返回本步是否刚刚超时；长按不会自动开启下一拍。 */
    advance(dt: number): boolean {
        if (!this.active || !Number.isFinite(dt) || dt <= 0) return false;
        this.elapsed += dt;
        this.progress = Math.min(1, this.elapsed / this.duration);
        const timeout = this.held && this.progress >= this.timeout;
        if (timeout) { this.release(); this.timedOut = this.lastTimedOut = true; }
        if (this.progress >= 1) this.active = false;
        return timeout;
    }

    reset() {
        this.active = this.held = false;
        this.progress = this.elapsed = this.sequence = this.settledSequence = 0;
        this.quality = this.lastQuality = -1;
        this.timedOut = this.lastTimedOut = false;
    }
}
