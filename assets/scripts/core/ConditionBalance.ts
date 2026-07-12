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

        // Per-stroke energy drain by current heart-rate zone (during PACE).
        // OPTIMAL is the most efficient sustained zone; higher zones cost more.
        drainPerStroke: {
            [HeartRateZone.LOW]: 0.3,
            [HeartRateZone.OPTIMAL]: 1.0,
            [HeartRateZone.HIGH_PRESSURE]: 1.5,
            [HeartRateZone.OVERLOAD]: 2.5,
        } as Record<HeartRateZone, number>,

        // Sprint-phase multipliers applied on top of the per-stroke drain.
        sprintTierMultiplier: {
            [SprintTier.STEADY]: 1.0,
            [SprintTier.PUSH]: 1.6,
            [SprintTier.GAMBLE]: 2.5,
        } as Record<SprintTier, number>,

        // When energy is empty: quality/efficiency penalties (doc: no loss of control).
        depletedQualityPenalty: 0.3,
        depletedEfficiencyPenalty: 0.5,
    },

    heartRate: {
        // Equilibrium model (physiological 0..200 scale): HR continuously eases
        // toward a target driven by sustained effort. Steady controlled effort settles
        // in the OPTIMAL sweet zone (110-150); only over-driving climbs into
        // HIGH_PRESSURE / OVERLOAD. Replaces the old one-way ratchet.
        restTargetHr: 70,         // resting HR with no effort (drifts down to here)
        maxEffortTargetHr: 140,   // perfect steady effort settles high in OPTIMAL (sweet zone)
        effortDecayPerSecond: 1.1, // sustained-effort sample fade rate when not stroking
        easeUpPerSecond: 42,      // climb rate when HR is below target (HR points/sec)
        easeDownPerSecond: 26,    // recovery rate when HR is above target

        // Startup wobble window: first N strokes use DiveResult.heartRateStartupWobbleModifier.
        startupStrokeWindow: 5,
    },

    quality: {
        // qualityModifier by zone: OPTIMAL gives the best ceiling/tolerance,
        // LOW is soft, OVERLOAD trades ceiling for risk (doc 11.6).
        zoneModifier: {
            [HeartRateZone.LOW]: 0.7,
            [HeartRateZone.OPTIMAL]: 1.25,
            [HeartRateZone.HIGH_PRESSURE]: 1.0,
            [HeartRateZone.OVERLOAD]: 0.8,
        } as Record<HeartRateZone, number>,
    },

    efficiency: {
        // efficiencyModifier by zone: OPTIMAL is the most cost-effective (doc 11.5).
        zoneModifier: {
            [HeartRateZone.LOW]: 0.65,
            [HeartRateZone.OPTIMAL]: 1.2,
            [HeartRateZone.HIGH_PRESSURE]: 0.95,
            [HeartRateZone.OVERLOAD]: 0.78,
        } as Record<HeartRateZone, number>,
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
