// First-version tunable constants for the condition layer (heart-rate + energy).
// These values are NOT yet design-locked: the docs define the qualitative rules
// (doc 11.5/11.6/11.7 + 29.x) but leave concrete magnitudes open. The numbers
// below are the v1 starting point discussed during design and are expected to be
// tuned. Keep all magic numbers here so logic stays clean and balance is adjustable.

import { HeartRateZone, RacePhase, SprintTier } from '../condition/ConditionTypes';

export const CONDITION_BALANCE = {
    energy: {
        // Total energy pool (absolute, 0..total). Doc 29 / dev-alignment: 100.
        total: 100,

        // Per-stroke energy drain by current heart-rate zone (during PACE).
        // OPTIMAL is the most efficient sustained zone; higher zones cost more.
        drainPerStroke: {
            [HeartRateZone.LOW]: 0.3,
            [HeartRateZone.OPTIMAL]: 1.0,
            [HeartRateZone.HIGH_PRESSURE]: 2.5,
            [HeartRateZone.OVERLOAD]: 5.0,
        } as Record<HeartRateZone, number>,

        // Sprint-phase multipliers applied on top of the per-stroke drain.
        sprintTierMultiplier: {
            [SprintTier.STEADY]: 1.0,
            [SprintTier.PUSH]: 2.0,
            [SprintTier.GAMBLE]: 4.0,
        } as Record<SprintTier, number>,

        // When energy is empty: quality/efficiency penalties (doc: no loss of control).
        depletedQualityPenalty: 0.3,
        depletedEfficiencyPenalty: 0.5,
    },

    heartRate: {
        // Equilibrium model (0..100 scale): HR continuously eases toward a target
        // determined by sustained effort. Steady controlled effort settles in OPTIMAL
        // and stays there; only over-driving climbs into HIGH_PRESSURE / OVERLOAD.
        // Replaces the old one-way ratchet that only fell when fully idle.
        restTargetHr: 30,         // HR target with no effort (drifts down to here)
        maxEffortTargetHr: 90,    // HR target at max sustained effort
        effortDecayPerSecond: 1.1, // sustained-effort sample fade rate when not stroking
        easeUpPerSecond: 18,      // climb rate when HR is below target
        easeDownPerSecond: 12,    // recovery rate when HR is above target

        // Startup wobble window: first N strokes use DiveResult.heartRateStabilityModifier.
        startupStrokeWindow: 5,
    },

    quality: {
        // qualityModifier by zone: OPTIMAL gives the best ceiling/tolerance,
        // LOW is soft, OVERLOAD trades ceiling for risk (doc 11.6).
        zoneModifier: {
            [HeartRateZone.LOW]: 0.85,
            [HeartRateZone.OPTIMAL]: 1.1,
            [HeartRateZone.HIGH_PRESSURE]: 1.0,
            [HeartRateZone.OVERLOAD]: 0.9,
        } as Record<HeartRateZone, number>,
    },

    efficiency: {
        // efficiencyModifier by zone: OPTIMAL is the most cost-effective (doc 11.5).
        zoneModifier: {
            [HeartRateZone.LOW]: 0.8,
            [HeartRateZone.OPTIMAL]: 1.0,
            [HeartRateZone.HIGH_PRESSURE]: 0.85,
            [HeartRateZone.OVERLOAD]: 0.7,
        } as Record<HeartRateZone, number>,
    },
};

// Phase-scoped drift tuning. Kept separate so phases can be tuned independently
// without expanding the main object (doc 13.x: heart-rate is phase-interpreted).
export const CONDITION_PHASE_TUNING: Record<RacePhase, { hrPushScale: number; hrDriftScale: number }> = {
    [RacePhase.START]: { hrPushScale: 1.0, hrDriftScale: 0.8 },
    [RacePhase.PACE]: { hrPushScale: 1.0, hrDriftScale: 1.0 },
    [RacePhase.SPRINT]: { hrPushScale: 1.4, hrDriftScale: 0.6 },
    [RacePhase.RESULT]: { hrPushScale: 0.0, hrDriftScale: 1.5 },
};
