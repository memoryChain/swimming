import { StrokeType, TARGET_INTERVAL } from '../core/GameConstants';

const INPUT_RATE_WINDOW = 1.2;
const TARGET_LIMB_RATE = 1 / (TARGET_INTERVAL * 2);

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
        const times = type === StrokeType.ARM ? this._armInputTimes : this._kickInputTimes;
        times.push(this._motionClock);
        this.pruneInputTimes(times);
    }

    private calculateEffortScore(armRate: number, kickRate: number): number {
        return clamp01(((armRate + kickRate) * 0.5) / TARGET_LIMB_RATE);
    }

    private calculateSyncScore(armRate: number, kickRate: number): number {
        const maxRate = Math.max(armRate, kickRate);
        if (maxRate < 0.15) {
            return 0;
        }
        const minRate = Math.min(armRate, kickRate);
        const balance = minRate / maxRate;
        const rateMatch = 1 - clamp01(Math.abs(armRate - kickRate) / (TARGET_LIMB_RATE * 1.1));
        return clamp01(rateMatch * 0.68 + balance * 0.32);
    }

    private inputRatePerSecond(times: number[]): number {
        return times.length / INPUT_RATE_WINDOW;
    }

    private pruneInputTimes(times: number[]) {
        while (times.length > 0 && this._motionClock - times[0] > INPUT_RATE_WINDOW) {
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
        return TARGET_LIMB_RATE;
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
    return clamp(value, 0, 1);
}
