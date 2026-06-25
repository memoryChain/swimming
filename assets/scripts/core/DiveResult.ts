// DiveResult: the resolved outcome of a dive, consumed by both the physical
// launch (Swimmer.performDive) and the condition layer (heart-rate startup).
// Produced by DiveResolver as a pure value object; carries no Cocos types.

export enum DiveQualityTier {
    LOW = 'LOW',
    OK = 'OK',
    HIGH = 'HIGH',
}

export enum DiveEntryStyle {
    MESSY = 'MESSY',
    NORMAL = 'NORMAL',
    CLEAN = 'CLEAN',
}

export interface DiveResult {
    // Raw normalized charge power in 0..1 that produced this dive.
    power: number;

    // Physical launch fields (same lerp sources Swimmer.performDive already uses).
    entryDistance: number;
    entrySpeed: number;

    // Quality classification (reuses the existing power thresholds).
    qualityTier: DiveQualityTier;
    entryStyle: DiveEntryStyle;

    // Condition-layer (heart-rate) startup modifiers. No-op for AI swimmers.
    // Starting heart-rate value, absolute on the 0..200 scale (range ~75..108).
    heartRateStartModifier: number;
    // First-strokes wobble multiplier (0..1); higher means noisier startup.
    heartRateStabilityModifier: number;
    // Number of strokes required to reach the OPTIMAL zone.
    optimalZoneEntryModifier: number;
}
