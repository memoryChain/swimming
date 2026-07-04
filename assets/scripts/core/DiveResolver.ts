// DiveResolver: pure function turning a normalized dive power into a DiveResult.
// No Cocos dependencies, no side effects. Both the player chain
// (GameFlowController.commitDive -> RaceManager.startFromDive) and the AI chain
// (GameFlowController.prepareAndScheduleAiDives -> Swimmer.performDive) call this
// so the dive outcome is produced in exactly one place.

import { DIVE_BALANCE } from './GameBalance';
import { DiveEntryStyle, DiveQualityTier, DiveResult } from './DiveResult';

const HIGH_POWER_THRESHOLD = 0.72;
const OK_POWER_THRESHOLD = 0.42;

// Heart-rate startup range (absolute, 0..200 scale). resting ~70, OPTIMAL starts at 110.
const HEART_RATE_START_MIN = 75;  // low-power dive: near resting HR
const HEART_RATE_START_MAX = 108; // clean dive: just under OPTIMAL (110), still needs a few strokes

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function classifyTier(power: number): DiveQualityTier {
    if (power > HIGH_POWER_THRESHOLD) {
        return DiveQualityTier.HIGH;
    }
    if (power > OK_POWER_THRESHOLD) {
        return DiveQualityTier.OK;
    }
    return DiveQualityTier.LOW;
}

function styleForTier(tier: DiveQualityTier): DiveEntryStyle {
    switch (tier) {
        case DiveQualityTier.HIGH:
            return DiveEntryStyle.CLEAN;
        case DiveQualityTier.OK:
            return DiveEntryStyle.NORMAL;
        default:
            return DiveEntryStyle.MESSY;
    }
}

// First-strokes wobble multiplier by tier (design doc 29.3).
function stabilityModifierForTier(tier: DiveQualityTier): number {
    switch (tier) {
        case DiveQualityTier.HIGH:
            return 0.3;
        case DiveQualityTier.OK:
            return 0.6;
        default:
            return 1.0;
    }
}

// Strokes required to reach OPTIMAL by tier (design doc 29.3).
function optimalEntryStrokesForTier(tier: DiveQualityTier): number {
    switch (tier) {
        case DiveQualityTier.HIGH:
            return 2;
        case DiveQualityTier.OK:
            return 4;
        default:
            return 7;
    }
}

export function resolveDiveResult(power: number): DiveResult {
    const divePower = clamp01(power);
    const tier = classifyTier(divePower);
    const entryStyle = styleForTier(tier);

    return {
        power: divePower,
        launchSpeed: lerp(DIVE_BALANCE.minLaunchSpeed, DIVE_BALANCE.maxLaunchSpeed, divePower),
        entrySpeed: lerp(DIVE_BALANCE.minSpeed, DIVE_BALANCE.maxSpeed, divePower),
        qualityTier: tier,
        entryStyle,
        heartRateStartModifier: lerp(HEART_RATE_START_MIN, HEART_RATE_START_MAX, divePower),
        heartRateStabilityModifier: stabilityModifierForTier(tier),
        optimalZoneEntryModifier: optimalEntryStrokesForTier(tier),
    };
}
