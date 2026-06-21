import { TARGET_INTERVAL, getTargetInterval } from './GameBalance';

export const INPUT_TUNING = {
    padStrokeDedupeMs: 45,
    chordMergeWindowMs: 70,
    inputRateWindowSeconds: 1.2,
    rhythmPerfectWindowSeconds: 0.08,
    rhythmGoodWindowSeconds: 0.18,
    rhythmLooseWindowSeconds: 0.52,
    bothRhythmPerfectWindowSeconds: 0.055,
    bothRhythmGoodWindowSeconds: 0.12,
    holdPerfectWindowSeconds: 0.045,
    holdGoodWindowSeconds: 0.105,
    holdLooseWindowSeconds: 0.18,
    bothHoldPerfectWindowSeconds: 0.035,
    bothHoldGoodWindowSeconds: 0.08,
    chordReleaseWindowMs: 90,
};

export const MOTION_TUNING = {
    animationSpeedScale: 0.8,
    heldMotionSpeedScale: 1,
    releasedMotionSpeedScale: 2,
    armMinCyclesPerSecond: 0.82,
    kickMinCyclesPerSecond: 0.82,
    maxCyclesPerSecond: 2.8,
    handPalmTurnDegrees: 130,
    forwardArmSideClearance: 0.3,
    rightBreathTurnDegrees: 70,
    rightBreathBodyRollDegrees: 18,
};

export const STABILITY_TUNING = {
    sampleWindowSize: 5,
    perfectStdDev: 0.09,
    badStdDev: 0.185,
    minHoldSeconds: 0.16,
    minUsefulRatio: 0.28,
    maxUsefulRatio: 0.9,
    usefulRatioEdgeWindow: 0.08,
    inputFreshnessGraceRatio: 0.08,
    inputFreshnessPenaltyRatio: 0.35,
    inputFreshnessMinScale: 0.05,
};

export const TARGET_LIMB_RATE = 1 / TARGET_INTERVAL;

export function getTargetLimbRate(): number {
    return 1 / getTargetInterval();
}
