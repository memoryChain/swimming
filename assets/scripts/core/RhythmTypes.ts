import { Rating, StrokeType } from './GameConstants';

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
