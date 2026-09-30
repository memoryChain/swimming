import { BUTTERFLY_TUNING } from '../core/ButterflyTuning';
import { perfectWidthScale } from '../core/ConditionBalance';
import { STROKE_QUALITY_TUNING } from '../core/InputTuning';
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
    targetPerfectStart = 0;
    targetPerfectEnd = 0;
    windowTransitionEndProgress = 0.12;
    private initialPerfectStart = 0;
    private initialPerfectEnd = 0;
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
        this.prepareWindow(cadenceScale, heartRate, characterWidth);
        this.active = this.held = true;
        this.progress = this.elapsed = 0;
        this.quality = -1;
        this.timedOut = false;
        this.releaseProgress = -1;
        this.buoyancy.start();
        this.sequence++;
        return true;
    }

    /** 候选提示和真实起划共用计算；已经起划的判定不允许被预览刷新。 */
    prepareWindow(cadenceScale = 1, heartRate = 80, characterWidth = 1) {
        if (this.active) return;
        this.duration = Math.max(0.35, BUTTERFLY_TUNING.cycleSeconds / Math.max(0.25, cadenceScale));
        this.timeout = Math.max(0.35, Math.min(0.8, BUTTERFLY_TUNING.timeoutProgress));
        const targetStart = Math.max(0.16, Math.min(this.timeout - 0.08, BUTTERFLY_TUNING.perfectStart));
        const targetEnd = Math.max(targetStart + 0.02, Math.min(this.timeout - 0.02, BUTTERFLY_TUNING.perfectEnd));
        // 锁定本拍心率、角色倍率和过渡两端；仅前段按预定曲线收束。
        this.heartRate = Number.isFinite(heartRate) ? Math.round(Math.max(80, Math.min(180, heartRate)) * 100) / 100 : 80;
        const width = Number.isFinite(characterWidth) ? Math.max(0.1, Math.min(3, characterWidth)) : 1;
        this.perfectWidthScale = perfectWidthScale(this.heartRate) * width;
        const maxHalf = Math.max(0, (this.timeout - 0.01 - 0.16) * 0.5);
        const targetHalf = Math.min(maxHalf, (targetEnd - targetStart) * 0.5 * this.perfectWidthScale);
        // 宽区先保留宽度，再减小下移幅度；保留超时前的安全间隔。
        const targetCenter = Math.max(0.16 + targetHalf, Math.min(this.timeout - 0.01 - targetHalf, (targetStart + targetEnd) * 0.5));
        this.targetPerfectStart = targetCenter - targetHalf;
        this.targetPerfectEnd = targetCenter + targetHalf;
        const freeStart = Math.min(STROKE_QUALITY_TUNING.perfectStart, STROKE_QUALITY_TUNING.perfectEnd);
        const freeEnd = Math.max(STROKE_QUALITY_TUNING.perfectStart, STROKE_QUALITY_TUNING.perfectEnd);
        const initialHalf = Math.min(maxHalf, (freeEnd - freeStart) * 0.5 * this.perfectWidthScale);
        const initialCenter = Math.max(0.16 + initialHalf, Math.min(this.timeout - 0.01 - initialHalf, (freeStart + freeEnd) * 0.5));
        this.initialPerfectStart = initialCenter - initialHalf;
        this.initialPerfectEnd = initialCenter + initialHalf;
        const transition = BUTTERFLY_TUNING.windowTransitionEndProgress;
        this.windowTransitionEndProgress = Math.max(0.04, Math.min(0.15, Number.isFinite(transition) ? transition : 0.12));
        this.perfectStart = this.initialPerfectStart;
        this.perfectEnd = this.initialPerfectEnd;
    }

    private updateWindow() {
        if (this.progress >= this.windowTransitionEndProgress) {
            this.perfectStart = this.targetPerfectStart;
            this.perfectEnd = this.targetPerfectEnd;
            return;
        }
        const t = Math.min(1, Math.max(0, this.progress / this.windowTransitionEndProgress));
        const eased = t * t * (3 - 2 * t);
        this.perfectStart = this.initialPerfectStart + (this.targetPerfectStart - this.initialPerfectStart) * eased;
        this.perfectEnd = this.initialPerfectEnd + (this.targetPerfectEnd - this.initialPerfectEnd) * eased;
    }

    release(): boolean {
        if (!this.active || !this.held) return false;
        this.updateWindow();
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
        this.updateWindow();
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
        this.perfectStart = this.perfectEnd = this.targetPerfectStart = this.targetPerfectEnd = 0;
        this.initialPerfectStart = this.initialPerfectEnd = 0;
        this.buoyancy.reset();
    }
}
