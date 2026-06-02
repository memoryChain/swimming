import { StrokeType } from '../core/GameConstants';
import { INPUT_TUNING, getTargetLimbRate } from '../core/InputTuning';

export class StrokeMetrics {
    private _motionClock = 0;
    private readonly _armInputTimes: number[] = [];
    private readonly _kickInputTimes: number[] = [];
    private _armInputRate = 0;
    private _kickInputRate = 0;
    private _syncScore = 0;
    private _effortScore = 0;

    reset() {
        this._motionClock = 0;
        this._armInputTimes.length = 0;
        this._kickInputTimes.length = 0;
        this._armInputRate = 0;
        this._kickInputRate = 0;
        this._syncScore = 0;
        this._effortScore = 0;
    }

    update(dt: number) {
        this._motionClock += dt;
        this.pruneInputTimes(this._armInputTimes);
        this.pruneInputTimes(this._kickInputTimes);
        this._armInputRate = this.inputRatePerSecond(this._armInputTimes);
        this._kickInputRate = this.inputRatePerSecond(this._kickInputTimes);
        this._effortScore = this.calculateEffortScore(this._armInputRate, this._kickInputRate);
        this._syncScore = this.calculateSyncScore(this._armInputRate, this._kickInputRate);
    }

    recordStroke(type: StrokeType) {
        this._armInputTimes.push(this._motionClock);
        this._kickInputTimes.push(this._motionClock);
        this.pruneInputTimes(this._armInputTimes);
        this.pruneInputTimes(this._kickInputTimes);
    }

    private calculateEffortScore(armRate: number, kickRate: number): number {
        return clamp01(((armRate + kickRate) * 0.5) / getTargetLimbRate());
    }

    private calculateSyncScore(armRate: number, kickRate: number): number {
        const maxRate = Math.max(armRate, kickRate);
        if (maxRate < 0.15) {
            return 0;
        }
        const minRate = Math.min(armRate, kickRate);
        const balance = minRate / maxRate;
        const rateMatch = 1 - clamp01(Math.abs(armRate - kickRate) / (getTargetLimbRate() * 1.1));
        return clamp01(rateMatch * 0.68 + balance * 0.32);
    }

    private inputRatePerSecond(times: number[]): number {
        return times.length / INPUT_TUNING.inputRateWindowSeconds;
    }

    private pruneInputTimes(times: number[]) {
        while (times.length > 0 && this._motionClock - times[0] > INPUT_TUNING.inputRateWindowSeconds) {
            times.shift();
        }
    }

    get armInputRate(): number {
        return this._armInputRate;
    }

    get kickInputRate(): number {
        return this._kickInputRate;
    }

    get syncScore(): number {
        return this._syncScore;
    }

    get effortScore(): number {
        return this._effortScore;
    }

    get targetLimbRate(): number {
        return getTargetLimbRate();
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
    return clamp(value, 0, 1);
}
