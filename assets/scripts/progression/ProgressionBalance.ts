// Progression balance: level cap, per-level coin cost, and race coin reward.
// Coins are the single currency: races award coins, spending coins levels a
// character. No XP stat exists - coinCostForLevel is the cost to go from `level`
// to `level + 1` directly.
export const PROGRESSION_BALANCE = {
    maxLevel: 60,
} as const;

// Coin cost to advance from level `level` to `level + 1`.
// Curve: 800 * n^1.15 - level 1 needs ~2 races (1st place), steepens gradually.
// (Mirrors the previous XP curve verbatim; only the unit semantics changed.)
export function coinCostForLevel(level: number): number {
    if (level < 1 || level >= PROGRESSION_BALANCE.maxLevel) {
        return 0;
    }
    return Math.round(800 * Math.pow(level, 1.15));
}

export const COIN_REWARDS = {
    finishBase: 100,
    placement: {
        values: [200, 120, 80, 40] as const,
        fallback: 40,
    },
    performance: {
        perMaxCombo: 3,
        perPerfect: 2,
        perGood: 1,
    },
} as const;

export type RacePerformanceInput = {
    placement: number;
    racerCount: number;
    maxCombo: number;
    perfectCount: number;
    goodCount: number;
    finished: boolean;
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
    const perfCoins = Math.max(0, input.maxCombo) * COIN_REWARDS.performance.perMaxCombo
        + Math.max(0, input.perfectCount) * COIN_REWARDS.performance.perPerfect
        + Math.max(0, input.goodCount) * COIN_REWARDS.performance.perGood;
    return COIN_REWARDS.finishBase + placementCoins + perfCoins;
}