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

// Heart-rate zones on the gameplay 80..180 scale.
export enum HeartRateZone {
    LOW = 'LOW',
    OPTIMAL = 'OPTIMAL',
    HIGH_PRESSURE = 'HIGH_PRESSURE',
    OVERLOAD = 'OVERLOAD',
}

// Heart-rate zone boundaries on a gameplay 80..180 scale.
// 轻松 80–100，发力 101–139，高压 140–159，极限 160–180。
export const HEART_RATE_BOUNDS = {
    min: 80,
    max: 180,
    optimalLower: 101,
    highPressureLower: 140,
    overloadLower: 160,
};

export function zoneForHeartRate(heartRate: number): HeartRateZone {
    heartRate = Math.round(heartRate);
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
// qualityScore = StrokeQualityResult.strokeQuality (0..1).
// pressureScore = StrokeMetrics.effortScore (0..1).
export interface StrokeConditionInput {
    strokeAccepted: boolean;
    qualityScore: number;
    pressureScore: number;
    dt: number;
}

// Per-frame input for the AI condition model (design doc 27.3).
export interface AiConditionInput {
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
    qualityModifier: number;
    efficiencyModifier: number;
}
