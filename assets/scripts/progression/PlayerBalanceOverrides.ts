import { SWIMMER_BALANCE, DIVE_BALANCE } from '../core/GameBalance';
import { CONDITION_BALANCE } from '../core/ConditionBalance';
import type { PlayerCharacterId } from '../app/PlayerCharacterConfig';

// Resolved balance overrides for the player's active character + level.
// Applied to the player's motor / condition model / dive resolver only; the AI
// keeps reading the raw global constants, so progression never affects opponents.
//
// The three display attributes (stamina/technique/burst, 0-100) are mapped to
// real game values:
//   stamina  -> energy.total (endurance pool)
//   technique -> perfectComboMaxOvercap + strokeQualityAccel (rhythm/combo)
//   burst    -> maxSpeed + diveMaxLaunchSpeed (speed/burst)

export type PlayerBalanceOverrides = {
    maxSpeed: number;
    energyTotal: number;
    perfectComboMaxOvercap: number;
    strokeQualityAccel: number;
    kickMaxSpeed: number;
    diveMaxLaunchSpeed: number;
    // Body weight (from the character definition). Pass-through, not leveled.
    weight: number;
    // 蓄气资质（from the character definition）. Pass-through, not leveled.
    energyGainAptitude: number;
};

export type CharacterStats = {
    stamina: number;
    technique: number;
    burst: number;
    kick: number;
};

// Per-level increments (micro - a maxed character is stronger but never broken).
export const PROGRESSION_PER_LEVEL = {
    maxSpeed: 0.007,             // +0.42 at 60 (+10.5%)
    energyTotal: 0.33,           // +19.8 at 60 (+20%)
    perfectComboMaxOvercap: 0.0009, // +0.054 at 60 (+6%)
    strokeQualityAccel: 0.006,   // +0.36 at 60 (+22.5%)
    kickMaxSpeed: 0.005,         // +0.3 at 60 (+14.3%)
    diveMaxLaunchSpeed: 0.012,   // +0.72 at 60 (+8.8%)
} as const;

// Convert a 0-100 display attribute to a 0..1 multiplier centered at 0.5 (=50).
// At 50 the character is neutral; above 50 gets a bonus, below 50 gets a penalty.
// The bonus/penalty scale is tuned so a 100-stat character gets ~+15% and a
// 0-stat character gets ~-15%.
function attributeMultiplier(value: number): number {
    return 1 + (value - 50) * 0.003;
}

export function resolvePlayerBalance(
    stats: CharacterStats,
    level: number,
    maxLevel: number,
    weight: number,
    energyGainAptitude: number,
    kickAptitude: number,
): PlayerBalanceOverrides {
    const clampedLevel = Math.max(1, Math.min(maxLevel, level));
    const levelsAbove1 = clampedLevel - 1;
    const per = PROGRESSION_PER_LEVEL;

    const maxSpeed = SWIMMER_BALANCE.maxSpeed * attributeMultiplier(stats.burst)
        + per.maxSpeed * levelsAbove1;
    const energyTotal = CONDITION_BALANCE.energy.total * attributeMultiplier(stats.stamina)
        + per.energyTotal * levelsAbove1;
    const perfectComboMaxOvercap = SWIMMER_BALANCE.perfectComboMaxOvercap * attributeMultiplier(stats.technique)
        + per.perfectComboMaxOvercap * levelsAbove1;
    const strokeQualityAccel = SWIMMER_BALANCE.strokeQualityAccel * attributeMultiplier(stats.technique)
        + per.strokeQualityAccel * levelsAbove1;
    const kickMaxSpeed = SWIMMER_BALANCE.kickMaxSpeed * attributeMultiplier(kickAptitude)
        + per.kickMaxSpeed * levelsAbove1;
    const diveMaxLaunchSpeed = DIVE_BALANCE.maxLaunchSpeed * attributeMultiplier(stats.burst)
        + per.diveMaxLaunchSpeed * levelsAbove1;

    return {
        maxSpeed,
        energyTotal,
        perfectComboMaxOvercap,
        strokeQualityAccel,
        kickMaxSpeed,
        diveMaxLaunchSpeed,
        weight,
        energyGainAptitude,
    };
}
