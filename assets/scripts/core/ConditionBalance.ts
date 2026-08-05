// First-version tunable constants for the condition layer (heart-rate + energy).
// These values are NOT yet design-locked: the docs define the qualitative rules
// (doc 11.5/11.6/11.7 + 29.x) but leave concrete magnitudes open. The numbers
// below are the v1 starting point discussed during design and are expected to be
// tuned. Keep all magic numbers here so logic stays clean and balance is adjustable.

import { HeartRateZone, RacePhase, SprintTier } from '../condition/ConditionTypes';

export const RACE_PHASE_BALANCE = {
    // Enter SPRINT when this many metres remain. The finish top-view camera is a
    // nested presentation beat and does not end the sprint phase.
    sprintDistanceFromFinish: 25,
};

export const CONDITION_BALANCE = {
    energy: {
        // Total energy pool (absolute, 0..total). Doc 29 / dev-alignment: 100.
        total: 100,

        // Per-stroke energy drain by current heart-rate zone (all phases;
        // SPRINT multiplies this by sprintTierMultiplier).
        // OPTIMAL is the most efficient sustained zone; higher zones cost more.
        drainPerStroke: {
            [HeartRateZone.LOW]: 0.5,
            [HeartRateZone.OPTIMAL]: 1.0,
            [HeartRateZone.HIGH_PRESSURE]: 1.3,
            [HeartRateZone.OVERLOAD]: 1.8,
        } as Record<HeartRateZone, number>,

        // Sprint-phase multipliers applied on top of the per-stroke drain.
        sprintTierMultiplier: {
            [SprintTier.STEADY]: 1.0,
            [SprintTier.PUSH]: 1.6,
            [SprintTier.GAMBLE]: 2.5,
        } as Record<SprintTier, number>,

        // Energy regeneration by heart-rate zone (energy points per second).
        // LOW is the strongest recovery zone; higher zones regen less. During SPRINT
        // the finish is an all-out peak: all zones regen (boosted), so the player
        // feels energy rising regardless of how hard they push, not just in LOW.
        regenPerZone: {
            [HeartRateZone.LOW]: 0.8,
            [HeartRateZone.OPTIMAL]: 0.5,
            [HeartRateZone.HIGH_PRESSURE]: 0.3,
            [HeartRateZone.OVERLOAD]: 0.15,
        } as Record<HeartRateZone, number>,
        regenSprintBoost: 1.0,
        // Depletion cooldown: when energy hits zero, regen is paused for this many
        // seconds so the depleted state sticks instead of bouncing back instantly.
        depletionCooldownSeconds: 1.5,
        // Energy depletion only affects the efficiency curve below;
        // the quality axis (heart-rate) is fully orthogonal.
    },

    heartRate: {
        // Equilibrium model (physiological 0..200 scale): HR continuously eases
        // toward a target driven by sustained effort. Steady controlled effort settles
        // in the OPTIMAL sweet zone (110-150); only over-driving climbs into
        // HIGH_PRESSURE / OVERLOAD. Replaces the old one-way ratchet.
        restTargetHr: 70,         // resting HR with no effort (drifts down to here)
        maxEffortTargetHr: 140,   // perfect steady effort settles high in OPTIMAL (sweet zone)
        effortDecayPerSecond: 0.35, // sustained-effort sample fade rate when not stroking
        easeUpPerSecond: 16,      // climb rate when HR is below target (HR points/sec)
        easeDownPerSecond: 6,    // recovery rate when HR is above target

        // Startup wobble window: first N strokes use DiveResult.heartRateStartupWobbleModifier.
        startupStrokeWindow: 5,
    },

    quality: {
        // qualityModifier by zone: OPTIMAL gives the best ceiling/tolerance,
        // LOW is soft, OVERLOAD trades ceiling for risk (doc 11.6).
        zoneModifier: {
            [HeartRateZone.LOW]: 0.7,
            [HeartRateZone.OPTIMAL]: 1.25,
            [HeartRateZone.HIGH_PRESSURE]: 1.05,
            [HeartRateZone.OVERLOAD]: 0.85,
        } as Record<HeartRateZone, number>,
    },

    efficiency: {
        // efficiencyModifier is now derived from ENERGY (the muscle-fuel axis),
        // NOT from heart-rate zone. HR drives quality; energy drives efficiency.
        // Curve: efficiency = floor + (1 - floor) * (energyRatio ^ exponent).
        //   energyRatio = energy / total (0..1).
        // exponent 0.3 gives a slow-start curve: high energy barely affects
        // efficiency, the last ~10% drops off steeply to the floor.
        energyFloor: 0.5,   // efficiency at zero energy
        speedCapFloor: 0.75, // max-speed scale at zero energy (decoupled from accel)
        curveExponent: 0.3, // <1 = slow-start (flat near full, steep near empty)
        // Arm-stroke cadence scale as energy drops. Segment-linear:
        // above cadenceWarningRatio no slowdown; between warning and exhausted
        // eases down to cadenceWarningScale; below exhausted eases to
        // cadenceExhaustedScale at zero energy. Makes the swimmer look heavy.
        cadenceWarningRatio: 0.15,
        cadenceExhaustedRatio: 0.05,
        cadenceWarningScale: 0.85,
        cadenceExhaustedScale: 0.6,
    },
};

// Phase-scoped drift tuning. Kept separate so phases can be tuned independently
// without expanding the main object (doc 13.x: heart-rate is phase-interpreted).
export const CONDITION_PHASE_TUNING: Record<RacePhase, { hrPushScale: number; hrDriftScale: number }> = {
    [RacePhase.START]: { hrPushScale: 1.0, hrDriftScale: 0.8 },
    [RacePhase.PACE]: { hrPushScale: 1.0, hrDriftScale: 1.0 },
    [RacePhase.SPRINT]: { hrPushScale: 1.5, hrDriftScale: 0.6 },
    [RacePhase.RESULT]: { hrPushScale: 0.0, hrDriftScale: 1.5 },
};

// Arm-stroke cadence multiplier for a given energy ratio (0..1). 1 = normal,
// drops segment-linearly through the warning tier to the exhausted floor.
export function energyDepletionCadenceScale(energyRatio: number): number {
    const eff = CONDITION_BALANCE.efficiency;
    const ratio = Math.max(0, Math.min(1, energyRatio));
    if (ratio >= eff.cadenceWarningRatio) {
        return 1;
    }
    if (ratio >= eff.cadenceExhaustedRatio) {
        const span = eff.cadenceWarningRatio - eff.cadenceExhaustedRatio;
        const t = span > 0 ? (ratio - eff.cadenceExhaustedRatio) / span : 0;
        return eff.cadenceExhaustedScale + (eff.cadenceWarningScale - eff.cadenceExhaustedScale) * t;
    }
    const span = eff.cadenceExhaustedRatio;
    const t = span > 0 ? ratio / span : 0;
    return eff.cadenceExhaustedScale + (eff.cadenceWarningScale - eff.cadenceExhaustedScale) * t;
}
