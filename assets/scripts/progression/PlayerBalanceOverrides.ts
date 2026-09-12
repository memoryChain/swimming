import { HeartRateTraitId } from '../core/ConditionBalance';
import { SWIMMER_BALANCE, DIVE_BALANCE } from '../core/GameBalance';

// Resolved balance overrides for the player's active character + level.
// Applied to the player's motor / condition model / dive resolver only; the AI
// keeps reading the raw global constants, so progression never affects opponents.
//
// 体力直接使用赛内点数；技巧与爆发力继续使用各自的属性映射。
//   stamina  -> energyTotal（显示值与赛内上限相同）
//   technique -> perfectComboMaxOvercap + strokeQualityAccel (rhythm/combo)
//   burst    -> maxSpeed + diveMaxLaunchSpeed (speed/burst)

export type PlayerBalanceOverrides = {
    maxSpeed: number;
    energyTotal: number;
    perfectComboMaxOvercap: number;
    strokeQualityAccel: number;
    diveMaxLaunchSpeed: number;
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

// 技巧、爆发力每点对应 0.3% 的基础参数增幅，以 50 点为基准。
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
    const maxSpeed = SWIMMER_BALANCE.maxSpeed * attributeMultiplier(grown.burst);
    const energyTotal = grown.stamina;
    const perfectComboMaxOvercap = SWIMMER_BALANCE.perfectComboMaxOvercap * attributeMultiplier(grown.technique);
    const strokeQualityAccel = SWIMMER_BALANCE.strokeQualityAccel * attributeMultiplier(grown.technique);
    const diveMaxLaunchSpeed = DIVE_BALANCE.maxLaunchSpeed * attributeMultiplier(grown.burst);

    return {
        maxSpeed,
        energyTotal,
        perfectComboMaxOvercap,
        strokeQualityAccel,
        diveMaxLaunchSpeed,
        weight,
        energyGainAptitude,
        heartRateTrait,
    };
}
