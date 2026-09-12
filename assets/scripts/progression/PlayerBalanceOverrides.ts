import { HeartRateTraitId } from '../core/ConditionBalance';
import { BURST_BALANCE, SWIMMER_BALANCE } from '../core/GameBalance';

// Resolved balance overrides for the player's active character + level.
// Applied to the player's motor / condition model / dive resolver only; the AI
// keeps reading the raw global constants, so progression never affects opponents.
//
// 体力直接使用赛内点数；技巧与爆发力继续使用各自的属性映射。
//   stamina  -> energyTotal（显示值与赛内上限相同）
//   technique -> perfectComboMaxOvercap + strokeQualityAccel (rhythm/combo)
//   burst    -> burstLaunchSpeedScale / burstWallLaunchSpeedScale（仅三种起跳初速）

export type PlayerBalanceOverrides = {
    energyTotal: number;
    perfectComboMaxOvercap: number;
    strokeQualityAccel: number;
    burstLaunchSpeedScale: number;
    burstWallLaunchSpeedScale: number;
    // Body weight (from the character definition). Pass-through, not leveled.
    weight: number;
    // 蓄气资质（from the character definition）. Pass-through, not leveled.
    energyGainAptitude: number;
    heartRateTrait: HeartRateTraitId;
};

export type CharacterStats = {
    stamina: number;
    technique: number;
    burst: number;
};

export type CharacterDisplayStats = CharacterStats;

// 养成只增加玩家可见的整数属性；物理参数由成长后的属性统一解析。
export const PROGRESSION_PER_LEVEL = {
    stamina: 1,
    technique: 1,
    burst: 1,
} as const;

// 技巧维持每点 0.3%；爆发力使用独立的三种起跳配置。
function attributeMultiplier(value: number): number {
    return 1 + (value - 50) * 0.003;
}

// 面板与赛内共用成长结果；体力直接作为赛内上限。
export function resolveCharacterDisplayStats(
    stats: CharacterStats,
    level: number,
    maxLevel: number,
): CharacterDisplayStats {
    const clampedLevel = Number.isFinite(level)
        ? Math.max(1, Math.min(maxLevel, Math.floor(level))) : 1;
    const levelsAbove1 = clampedLevel - 1;
    return {
        stamina: Math.round(stats.stamina) + PROGRESSION_PER_LEVEL.stamina * levelsAbove1,
        technique: Math.round(stats.technique) + PROGRESSION_PER_LEVEL.technique * levelsAbove1,
        burst: Math.round(stats.burst) + PROGRESSION_PER_LEVEL.burst * levelsAbove1,
    };
}

export function resolvePlayerBalance(
    stats: CharacterStats,
    level: number,
    maxLevel: number,
    weight: number,
    energyGainAptitude: number,
    heartRateTrait: HeartRateTraitId = 'balanced',
): PlayerBalanceOverrides {
    const grown = resolveCharacterDisplayStats(stats, level, maxLevel);
    const energyTotal = grown.stamina;
    const perfectComboMaxOvercap = SWIMMER_BALANCE.perfectComboMaxOvercap * attributeMultiplier(grown.technique);
    const strokeQualityAccel = SWIMMER_BALANCE.strokeQualityAccel * attributeMultiplier(grown.technique);
    const burstLaunchSpeedScale = 1 + (grown.burst - BURST_BALANCE.referenceAttribute) * BURST_BALANCE.speedGainPerPoint;
    const burstWallLaunchSpeedScale = 1 + (grown.burst - BURST_BALANCE.referenceAttribute) * BURST_BALANCE.wallSpeedGainPerPoint;

    return {
        energyTotal,
        perfectComboMaxOvercap,
        strokeQualityAccel,
        burstLaunchSpeedScale,
        burstWallLaunchSpeedScale,
        weight,
        energyGainAptitude,
        heartRateTrait,
    };
}
