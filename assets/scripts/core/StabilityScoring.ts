import { Rating, StrokeType } from './GameConstants';
import type { RhythmResult } from './RhythmEvaluator';
import type { StrokeStabilityResult } from '../swimmer/SwimmerMotor';

export function ratingForStability(stability: number): Rating {
    if (stability >= 0.999) {
        return Rating.PERFECT;
    }
    if (stability > 0) {
        return Rating.GOOD;
    }
    return Rating.BAD;
}

export function nextStabilityCombo(combo: number, rating: Rating): number {
    if (rating === Rating.PERFECT) {
        return combo + 1;
    }
    if (rating === Rating.BAD) {
        return 0;
    }
    return combo;
}

export function rhythmResultFromStability(stability: StrokeStabilityResult, combo: number): RhythmResult {
    const rating = ratingForStability(stability.stability);
    return {
        rating,
        badReason: stability.badReason,
        speedMultiplier: 1 + stability.stability,
        combo,
        interval: stability.holdSeconds,
        expectedNext: stability.type === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT,
        holdSeconds: stability.holdSeconds,
        minHoldSeconds: stability.minHoldSeconds,
        holdTimeValid: stability.holdTimeValid,
        actionSeconds: stability.actionSeconds,
        holdRatio: stability.holdRatio,
        inputFreshness: stability.inputFreshness,
        inputLeadSeconds: stability.inputLeadSeconds,
        inputLeadRatio: stability.inputLeadRatio,
        meanRatio: stability.meanRatio,
        ratioStdDev: stability.ratioStdDev,
        sampleCount: stability.sampleCount,
    };
}

export function formatStabilityLog(prefix: string, result: RhythmResult): string {
    const comboBoost = result.comboSpeedBonus && result.comboSpeedBonus > 0 ? ` comboBoost=+${result.comboSpeedBonus.toFixed(2)}m/s` : '';
    return `${prefix} rating=${result.rating} badReason=${result.badReason ?? 'none'} hold=${(result.holdSeconds ?? 0).toFixed(2)} holdOk=${result.holdTimeValid !== false} action=${(result.actionSeconds ?? 0).toFixed(2)} ratio=${((result.holdRatio ?? 0) * 100).toFixed(0)}% fresh=${((result.inputFreshness ?? 1) * 100).toFixed(0)}% std=${(result.ratioStdDev ?? 0).toFixed(3)} samples=${result.sampleCount ?? 0} combo=${result.combo}${comboBoost}`;
}
