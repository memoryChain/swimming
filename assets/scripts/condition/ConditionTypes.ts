// Shared types for the condition layer (heart-rate + energy state).
// Pure data/enums, no Cocos dependencies.

// Race phase as seen by the condition layer. Distinct from GameState:
// GameState COUNTDOWN/DIVING/GLIDING -> START, RACING -> PACE then SPRINT,
// FINISHED -> RESULT. Mapping is owned by the flow layer, not here.
export enum RacePhase {
    START = 'START',
    PACE = 'PACE',
    SPRINT = 'SPRINT',
    RESULT = 'RESULT',
}

// Heart-rate zones on the 0..100 scale (design doc 29.1).
export enum HeartRateZone {
    LOW = 'LOW',
    OPTIMAL = 'OPTIMAL',
    HIGH_PRESSURE = 'HIGH_PRESSURE',
    OVERLOAD = 'OVERLOAD',
}

// Sprint intensity tiers, meaningful only during SPRINT (design doc 23.5).
export enum SprintTier {
    STEADY = 'STEADY',
    PUSH = 'PUSH',
    GAMBLE = 'GAMBLE',
}

// Heart-rate zone boundaries on the 0..100 scale (design doc 29.1).
// LOW: 0-50, OPTIMAL: 50-80, HIGH_PRESSURE: 80-92, OVERLOAD: 92-100.
export const HEART_RATE_BOUNDS = {
    min: 0,
    max: 100,
    optimalLower: 50,
    highPressureLower: 80,
    overloadLower: 92,
};

export function zoneForHeartRate(heartRate: number): HeartRateZone {
    if (heartRate >= HEART_RATE_BOUNDS.overloadLower) {
        return HeartRateZone.OVERLOAD;
    }
    if (heartRate >= HEART_RATE_BOUNDS.highPressureLower) {
        return HeartRateZone.HIGH_PRESSURE;
    }
    if (heartRate >= HEART_RATE_BOUNDS.optimalLower) {
        return HeartRateZone.OPTIMAL;
    }
    return HeartRateZone.LOW;
}

// Event-driven input produced at each stroke settlement (design doc 24.6).
// qualityScore = StrokeStabilityResult.stability (0..1).
// pressureScore = StrokeMetrics.effortScore (0..1).
export interface StrokeConditionInput {
    strokeAccepted: boolean;
    qualityScore: number;
    pressureScore: number;
    dt: number;
}

// Driven by the flow layer during the sprint phase (design doc 27.2).
export interface SprintConditionInput {
    sprintTier: SprintTier;
}

// Per-frame input for the AI condition model (design doc 27.3).
export interface AiConditionInput {
    aiPower: number;
    difficulty: number;
    progress: number;
    dt: number;
}

// Read-only snapshot exposed by any condition model (player or AI).
export interface ConditionReadout {
    heartRate: number;
    heartRateZone: HeartRateZone;
    energy: number;
    energyDepleted: boolean;
    sprintTier: SprintTier;
    qualityModifier: number;
    efficiencyModifier: number;
}
