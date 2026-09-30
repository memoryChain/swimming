import { BUTTERFLY_TUNING } from '../core/ButterflyTuning';
import { perfectWidthScale } from '../core/ConditionBalance';
import { ButterflyBuoyancy } from './ButterflyBuoyancy';

/** 整拍时钟与单次结算。无引擎依赖，输入、物理和动作消费同一进度。 */
export class ButterflyStroke {
    readonly buoyancy = new ButterflyBuoyancy();
    private releaseProgress = -1;
    active = false;
    held = false;
    progress = 0;
    elapsed = 0;
    duration = 1;
    perfectStart = 0;
    perfectEnd = 0;
    heartRate = 80;
    perfectWidthScale = 1;
    timeout = 0.6;
    quality = -1;
    sequence = 0;
    settledSequence = 0;
    lastQuality = -1;
    timedOut = false;
    lastTimedOut = false;
    /** 上一拍的结算读数；计费尚未按剩余体力截断，蓄气为实际到账。 */
    lastEnergyCost = 0;
    lastUltimateGain = 0;

    start(cadenceScale = 1, heartRate = 80, characterWidth = 1): boolean {
        if (this.active) return false;
        this.active = this.held = true;
        this.progress = this.elapsed = 0;
        this.quality = -1;
        this.timedOut = false;
        this.releaseProgress = -1;
        this.buoyancy.start();
        this.duration = Math.max(0.35, BUTTERFLY_TUNING.cycleSeconds / Math.max(0.25, cadenceScale));
        this.timeout = Math.max(0.35, Math.min(0.8, BUTTERFLY_TUNING.timeoutProgress));
        this.perfectStart = Math.max(0.16, Math.min(this.timeout - 0.08, BUTTERFLY_TUNING.perfectStart));
        this.perfectEnd = Math.max(this.perfectStart + 0.02, Math.min(this.timeout - 0.02, BUTTERFLY_TUNING.perfectEnd));
        // 和自由泳一样，在起划时锁定心率与窗口；同一拍内不会突然移动判定边界。
        this.heartRate = Number.isFinite(heartRate) ? Math.round(Math.max(80, Math.min(180, heartRate)) * 100) / 100 : 80;
        const width = Number.isFinite(characterWidth) ? Math.max(0.1, Math.min(3, characterWidth)) : 1;
        this.perfectWidthScale = perfectWidthScale(this.heartRate) * width;
        const center = (this.perfectStart + this.perfectEnd) * 0.5;
        const halfWidth = Math.min(center - 0.16, this.timeout - center,
            (this.perfectEnd - this.perfectStart) * 0.5 * this.perfectWidthScale);
        this.perfectStart = center - halfWidth;
        this.perfectEnd = center + halfWidth;
        this.sequence++;
        return true;
    }

    release(): boolean {
        if (!this.active || !this.held) return false;
        this.held = false;
        this.releaseProgress = this.progress;
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
        const previous = this.progress;
        this.elapsed += dt;
        this.progress = Math.min(1, this.elapsed / this.duration);
        const timeout = this.held && this.progress >= this.timeout;
        if (timeout) { this.release(); this.timedOut = this.lastTimedOut = true; }
        this.buoyancy.advance(previous, this.progress, this.duration,
            this.timedOut ? this.timeout : this.releaseProgress, this.quality, this.timeout);
        if (this.progress >= 1) this.active = false;
        return timeout;
    }

    reset() {
        this.active = this.held = false;
        this.progress = this.elapsed = this.sequence = this.settledSequence = 0;
        this.quality = this.lastQuality = -1;
        this.timedOut = this.lastTimedOut = false;
        this.lastEnergyCost = this.lastUltimateGain = 0;
        this.releaseProgress = -1;
        this.heartRate = 80;
        this.perfectWidthScale = 1;
        this.buoyancy.reset();
    }
}
