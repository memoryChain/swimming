import { _decorator, Component } from 'cc';
import { RHYTHM_BALANCE, getTargetInterval } from './GameBalance';
import { Rating, StrokeType } from './GameConstants';
import { INPUT_TUNING } from './InputTuning';

const { ccclass } = _decorator;

export interface RhythmResult {
    rating: Rating;
    badReason?: string;
    speedMultiplier: number;
    combo: number;
    interval: number;
    expectedNext: StrokeType;
    holdSeconds?: number;
    targetHoldSeconds?: number;
    minHoldSeconds?: number;
    holdTimeValid?: boolean;
    actionSeconds?: number;
    holdRatio?: number;
    inputFreshness?: number;
    inputLeadSeconds?: number;
    inputLeadRatio?: number;
    meanRatio?: number;
    ratioStdDev?: number;
    sampleCount?: number;
}

export interface RhythmStats {
    maxCombo: number;
    perfectCount: number;
    goodCount: number;
    missCount: number;
}

@ccclass('RhythmEvaluator')
export class RhythmEvaluator extends Component {
    private _lastStrokeType: StrokeType | null = null;
    private _lastStrokeTime = 0;
    private _combo = 0;
    private _maxCombo = 0;
    private _strokeCount = 0;
    private _perfectCount = 0;
    private _goodCount = 0;
    private _missCount = 0;
    private _leftHoldStartedAt = 0;
    private _rightHoldStartedAt = 0;
    private _leftHoldReleasedAt = 0;
    private _rightHoldReleasedAt = 0;
    private _leftHoldEligible = false;
    private _rightHoldEligible = false;
    private _bothHoldEligible = false;
    private _speedMultiplier = 1;

    evaluate(type: StrokeType): RhythmResult {
        const now = Date.now() / 1000;
        const interval = this._lastStrokeTime > 0 ? now - this._lastStrokeTime : 0;
        const repeatedSide = type !== StrokeType.BOTH && this._lastStrokeType === type;

        let rating = Rating.GOOD;
        let badReason: string | undefined;
        if (repeatedSide) {
            rating = Rating.BAD;
            badReason = 'repeat_side';
        } else if (this._strokeCount > 0) {
            const deviation = Math.abs(interval - getTargetInterval());
            const perfectWindow = type === StrokeType.BOTH ? INPUT_TUNING.bothRhythmPerfectWindowSeconds : INPUT_TUNING.rhythmPerfectWindowSeconds;
            const goodWindow = type === StrokeType.BOTH ? INPUT_TUNING.bothRhythmGoodWindowSeconds : INPUT_TUNING.rhythmGoodWindowSeconds;
            if (deviation <= perfectWindow) {
                rating = Rating.PERFECT;
            } else if (deviation <= goodWindow || (type !== StrokeType.BOTH && interval <= INPUT_TUNING.rhythmLooseWindowSeconds)) {
                rating = Rating.GOOD;
            } else {
                rating = Rating.BAD;
                badReason = `rhythm_window(interval=${interval.toFixed(2)})`;
            }
        }

        if (!repeatedSide) {
            this._lastStrokeType = type;
            this._strokeCount++;
        }
        this.setHoldEligible(type, rating !== Rating.BAD);
        this._lastStrokeTime = now;

        if (rating === Rating.PERFECT) {
            this._combo += 1;
            this._perfectCount += 1;
        } else if (rating === Rating.GOOD) {
            this._combo = Math.max(0, this._combo);
            this._goodCount += 1;
        } else {
            this._combo = Math.max(0, this._combo - RHYTHM_BALANCE.comboMissPenalty);
            this._missCount += 1;
        }
        this._maxCombo = Math.max(this._maxCombo, this._combo);

        const speedMultiplier = this.calculateSpeedMultiplier(rating);
        this._speedMultiplier = speedMultiplier;
        const expectedNext = this.expectedNextFor(type);

        return { rating, badReason, speedMultiplier, combo: this._combo, interval, expectedNext };
    }

    beginHold(type: StrokeType) {
        const now = Date.now() / 1000;
        if (type === StrokeType.LEFT) {
            this._leftHoldStartedAt = now;
            this._leftHoldReleasedAt = 0;
            this._leftHoldEligible = false;
            this._bothHoldEligible = false;
        } else if (type === StrokeType.RIGHT) {
            this._rightHoldStartedAt = now;
            this._rightHoldReleasedAt = 0;
            this._rightHoldEligible = false;
            this._bothHoldEligible = false;
        } else {
            this._leftHoldStartedAt = now;
            this._rightHoldStartedAt = now;
            this._leftHoldReleasedAt = 0;
            this._rightHoldReleasedAt = 0;
            this._bothHoldEligible = false;
        }
    }

    endHold(type: StrokeType): RhythmResult | null {
        const now = Date.now() / 1000;
        if (this._bothHoldEligible) {
            return this.endBothHold(type, now);
        }
        const startedAt = type === StrokeType.LEFT ? this._leftHoldStartedAt : this._rightHoldStartedAt;
        if (startedAt <= 0) {
            return null;
        }
        if (type === StrokeType.LEFT) {
            this._leftHoldStartedAt = 0;
            this._leftHoldReleasedAt = 0;
        } else {
            this._rightHoldStartedAt = 0;
            this._rightHoldReleasedAt = 0;
        }
        if (!this.holdEligible(type)) {
            return null;
        }

        return this.scoreHold(type, Math.max(0, now - startedAt));
    }

    reset() {
        this._lastStrokeType = null;
        this._lastStrokeTime = 0;
        this._combo = 0;
        this._maxCombo = 0;
        this._strokeCount = 0;
        this._perfectCount = 0;
        this._goodCount = 0;
        this._missCount = 0;
        this._leftHoldStartedAt = 0;
        this._rightHoldStartedAt = 0;
        this._leftHoldReleasedAt = 0;
        this._rightHoldReleasedAt = 0;
        this._leftHoldEligible = false;
        this._rightHoldEligible = false;
        this._bothHoldEligible = false;
        this._speedMultiplier = 1;
    }

    get combo(): number {
        return this._combo;
    }

    get speedMultiplier(): number {
        return this._speedMultiplier;
    }

    get stats(): RhythmStats {
        return {
            maxCombo: this._maxCombo,
            perfectCount: this._perfectCount,
            goodCount: this._goodCount,
            missCount: this._missCount,
        };
    }

    private calculateSpeedMultiplier(rating: Rating, holdTiming = false): number {
        const perfectBonus = this._combo * RHYTHM_BALANCE.comboPerfectBonus;
        const goodBonus = rating === Rating.GOOD ? RHYTHM_BALANCE.comboGoodBonus : 0;
        const holdBonus = holdTiming
            ? rating === Rating.PERFECT
                ? RHYTHM_BALANCE.holdPerfectBonus
                : rating === Rating.GOOD
                    ? RHYTHM_BALANCE.holdGoodBonus
                    : 0
            : 0;
        return Math.min(RHYTHM_BALANCE.maxComboBonus, 1 + perfectBonus + goodBonus + holdBonus);
    }

    private holdEligible(type: StrokeType): boolean {
        if (type === StrokeType.BOTH) {
            return this._bothHoldEligible;
        }
        return type === StrokeType.LEFT ? this._leftHoldEligible : this._rightHoldEligible;
    }

    private setHoldEligible(type: StrokeType, eligible: boolean) {
        if (type === StrokeType.LEFT) {
            this._leftHoldEligible = eligible;
            this._bothHoldEligible = false;
        } else if (type === StrokeType.RIGHT) {
            this._rightHoldEligible = eligible;
            this._bothHoldEligible = false;
        } else {
            this._bothHoldEligible = eligible && this.hasValidBothHoldStart();
            this._leftHoldEligible = false;
            this._rightHoldEligible = false;
        }
    }

    private endBothHold(type: StrokeType, now: number): RhythmResult | null {
        if (this._leftHoldStartedAt <= 0 || this._rightHoldStartedAt <= 0) {
            this.clearBothHold();
            return null;
        }
        if (type === StrokeType.LEFT) {
            this._leftHoldReleasedAt = now;
        } else if (type === StrokeType.RIGHT) {
            this._rightHoldReleasedAt = now;
        } else {
            this._leftHoldReleasedAt = now;
            this._rightHoldReleasedAt = now;
        }

        if (this._leftHoldReleasedAt <= 0 || this._rightHoldReleasedAt <= 0) {
            return null;
        }

        const holdSeconds = Math.max(
            0,
            Math.min(this._leftHoldReleasedAt, this._rightHoldReleasedAt) - Math.max(this._leftHoldStartedAt, this._rightHoldStartedAt),
        );
        const releaseSpread = Math.abs(this._leftHoldReleasedAt - this._rightHoldReleasedAt);
        const forcedRating = releaseSpread <= INPUT_TUNING.chordReleaseWindowMs / 1000 ? null : Rating.BAD;
        const forcedBadReason = forcedRating === Rating.BAD ? `chord_release_spread(${releaseSpread.toFixed(2)})` : undefined;
        this.clearBothHold();
        return this.scoreHold(StrokeType.BOTH, holdSeconds, forcedRating, forcedBadReason);
    }

    private clearBothHold() {
        this._leftHoldStartedAt = 0;
        this._rightHoldStartedAt = 0;
        this._leftHoldReleasedAt = 0;
        this._rightHoldReleasedAt = 0;
        this._bothHoldEligible = false;
    }

    private hasValidBothHoldStart(): boolean {
        if (this._leftHoldStartedAt <= 0 || this._rightHoldStartedAt <= 0) {
            return false;
        }
        return Math.abs(this._leftHoldStartedAt - this._rightHoldStartedAt) <= INPUT_TUNING.chordMergeWindowMs / 1000;
    }

    private scoreHold(type: StrokeType, holdSeconds: number, forcedRating: Rating | null = null, forcedBadReason?: string): RhythmResult {
        const targetHoldSeconds = getTargetInterval() * 0.5;
        const deviation = Math.abs(holdSeconds - targetHoldSeconds);
        const perfectWindow = type === StrokeType.BOTH ? INPUT_TUNING.bothHoldPerfectWindowSeconds : INPUT_TUNING.holdPerfectWindowSeconds;
        const goodWindow = type === StrokeType.BOTH ? INPUT_TUNING.bothHoldGoodWindowSeconds : INPUT_TUNING.holdGoodWindowSeconds;
        let rating = forcedRating ?? Rating.BAD;
        let badReason = forcedBadReason;
        if (forcedRating === null && deviation <= perfectWindow) {
            rating = Rating.PERFECT;
            this._perfectCount += 1;
        } else if (forcedRating === null && deviation <= goodWindow) {
            rating = Rating.GOOD;
            this._goodCount += 1;
        } else {
            this._missCount += 1;
            badReason = badReason ?? `hold_timing(hold=${holdSeconds.toFixed(2)} target=${targetHoldSeconds.toFixed(2)})`;
            if (forcedRating === Rating.BAD || deviation > INPUT_TUNING.holdLooseWindowSeconds) {
                this._combo = Math.max(0, this._combo - RHYTHM_BALANCE.holdMissPenalty);
            }
        }

        this._speedMultiplier = this.calculateSpeedMultiplier(rating, true);
        this._maxCombo = Math.max(this._maxCombo, this._combo);
        return {
            rating,
            badReason,
            speedMultiplier: this._speedMultiplier,
            combo: this._combo,
            interval: holdSeconds,
            expectedNext: this.expectedNextFor(type),
            holdSeconds,
            targetHoldSeconds,
        };
    }

    private expectedNextFor(type: StrokeType): StrokeType {
        if (type === StrokeType.BOTH) {
            return StrokeType.BOTH;
        }
        return type === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
    }
}
