import { Rating, StrokeType } from './GameConstants';
import type { RhythmResult } from './RhythmTypes';
import type { StrokeQualityResult } from '../swimmer/SwimmerMotor';

export function ratingForStrokeQuality(strokeQuality: number): Rating {
    if (strokeQuality >= 0.999) {
        return Rating.PERFECT;
    }
    if (strokeQuality > 0) {
        return Rating.GOOD;
    }
    return Rating.BAD;
}

export function nextStrokeQualityCombo(combo: number, rating: Rating): number {
    if (rating === Rating.PERFECT) {
        return combo + 1;
    }
    return 0;
}

export function rhythmResultFromStrokeQuality(result: StrokeQualityResult, combo: number): RhythmResult {
    const rating = ratingForStrokeQuality(result.strokeQuality);
    return {
        rating,
        badReason: result.badReason,
        speedMultiplier: 1 + result.strokeQuality,
        combo,
        interval: result.holdSeconds,
        expectedNext: result.type === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT,
        holdSeconds: result.holdSeconds,
        minHoldSeconds: result.minHoldSeconds,
        holdTimeValid: result.holdTimeValid,
        actionSeconds: result.actionSeconds,
        holdRatio: result.holdRatio,
        inputFreshness: result.inputFreshness,
        inputLeadSeconds: result.inputLeadSeconds,
        inputLeadRatio: result.inputLeadRatio,
        meanRatio: result.meanRatio,
        ratioStdDev: result.ratioStdDev,
        sampleCount: result.sampleCount,
    };
}

export function formatStrokeQualityLog(prefix: string, result: RhythmResult): string {
    return `${prefix} rating=${result.rating} badReason=${result.badReason ?? 'none'} hold=${(result.holdSeconds ?? 0).toFixed(2)} holdOk=${result.holdTimeValid !== false} action=${(result.actionSeconds ?? 0).toFixed(2)} ratio=${((result.holdRatio ?? 0) * 100).toFixed(0)}% fresh=${((result.inputFreshness ?? 1) * 100).toFixed(0)}% std=${(result.ratioStdDev ?? 0).toFixed(3)} samples=${result.sampleCount ?? 0} combo=${result.combo}`;
}
