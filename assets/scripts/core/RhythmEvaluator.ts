import { _decorator, Component } from 'cc';
import {
    COMBO_GOOD_BONUS,
    COMBO_MISS_PENALTY,
    COMBO_PERFECT_BONUS,
    GOOD_WINDOW,
    MAX_COMBO_BONUS,
    PERFECT_WINDOW,
    Rating,
    RHYTHM_WINDOW,
    StrokeType,
    TARGET_INTERVAL,
} from './GameConstants';

const { ccclass } = _decorator;

export interface RhythmResult {
    rating: Rating;
    speedMultiplier: number;
    combo: number;
    interval: number;
    expectedNext: StrokeType;
}

@ccclass('RhythmEvaluator')
export class RhythmEvaluator extends Component {
    private _lastStrokeType: StrokeType | null = null;
    private _lastStrokeTime = 0;
    private _combo = 0;
    private _strokeCount = 0;

    evaluate(type: StrokeType): RhythmResult {
        const now = Date.now() / 1000;
        const interval = this._lastStrokeTime > 0 ? now - this._lastStrokeTime : 0;
        const repeatedSide = this._lastStrokeType === type;

        let rating = Rating.GOOD;
        if (repeatedSide) {
            rating = Rating.MISS;
        } else if (this._strokeCount > 0) {
            const deviation = Math.abs(interval - TARGET_INTERVAL);
            if (deviation <= PERFECT_WINDOW) {
                rating = Rating.PERFECT;
            } else if (deviation <= GOOD_WINDOW || interval <= RHYTHM_WINDOW) {
                rating = Rating.GOOD;
            } else {
                rating = Rating.MISS;
            }
        }

        if (!repeatedSide) {
            this._lastStrokeType = type;
            this._strokeCount++;
        }
        this._lastStrokeTime = now;

        if (rating === Rating.PERFECT) {
            this._combo += 1;
        } else if (rating === Rating.GOOD) {
            this._combo = Math.max(0, this._combo);
        } else {
            this._combo = Math.max(0, this._combo - COMBO_MISS_PENALTY);
        }

        const perfectBonus = this._combo * COMBO_PERFECT_BONUS;
        const goodBonus = rating === Rating.GOOD ? COMBO_GOOD_BONUS : 0;
        const speedMultiplier = Math.min(MAX_COMBO_BONUS, 1 + perfectBonus + goodBonus);
        const expectedNext = type === StrokeType.ARM ? StrokeType.LEG : StrokeType.ARM;

        return { rating, speedMultiplier, combo: this._combo, interval, expectedNext };
    }

    reset() {
        this._lastStrokeType = null;
        this._lastStrokeTime = 0;
        this._combo = 0;
        this._strokeCount = 0;
    }

    get combo(): number {
        return this._combo;
    }
}
