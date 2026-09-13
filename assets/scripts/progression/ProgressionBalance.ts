// Progression balance: level cap, per-level coin cost, and race coin reward.
// Coins are the single currency: races award coins, spending coins levels a
// character. No XP stat exists - coinCostForLevel is the cost to go from `level`
// to `level + 1` directly.
export const PROGRESSION_BALANCE = {
    maxLevel: 30,
} as const;

// 存档、旧档迁移和界面读取共用等级边界。
export function normalizeCharacterLevel(level: unknown): number {
    return typeof level === 'number' && Number.isFinite(level)
        ? Math.max(1, Math.min(PROGRESSION_BALANCE.maxLevel, Math.floor(level)))
        : 1;
}

// Coin cost to advance from level `level` to `level + 1`.
// 原型成长曲线：首级约两场，后续平滑递增；50金币取整便于阅读。
export function coinCostForLevel(level: number): number {
    if (level < 1 || level >= PROGRESSION_BALANCE.maxLevel) {
        return 0;
    }
    return Math.round((500 + 250 * level + 30 * level * level) / 50) * 50;
}

export const COIN_REWARDS = {
    finishBase: 200,
    placement: {
        values: [200, 140, 100, 70] as const,
        fallback: 40,
    },
    performance: {
        accuracy: 70,
        stability: 30,
    },
} as const;

export type RacePerformanceInput = {
    placement: number;
    racerCount: number;
    maxCombo: number;
    perfectCount: number;
    goodCount: number;
    finished: boolean;
    missCount?: number;
    distance?: 200 | 400;
    factor?: number;
};

// Coins awarded for a race. DNF (finished === false) awards nothing.
export function calculateRaceCoins(input: RacePerformanceInput): number {
    if (!input.finished) {
        return 0;
    }
    const placementIndex = Math.max(0, input.placement - 1);
    const placementCoins = placementIndex < COIN_REWARDS.placement.values.length
        ? COIN_REWARDS.placement.values[placementIndex]
        : COIN_REWARDS.placement.fallback;
    const total = input.perfectCount + input.goodCount + (input.missCount ?? 0);
    const perfCoins = total > 0 ? Math.min(100, Math.round(
        COIN_REWARDS.performance.accuracy * input.perfectCount / total
        + COIN_REWARDS.performance.stability * Math.min(1, input.maxCombo / total))) : 0;
    return Math.round((COIN_REWARDS.finishBase + placementCoins + perfCoins)
        * (input.distance === 400 ? 2.2 : 1) * (input.factor ?? 1));
}
