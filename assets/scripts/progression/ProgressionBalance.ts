// Progression balance: level cap, XP curve, and race reward formula.
export const PROGRESSION_BALANCE = {
    maxLevel: 60,
} as const;

// XP required to advance from level `level` to `level + 1`.
// Curve: 800 * n^1.15 - level 1 needs ~2 races (1st place), steepens gradually.
export function xpForLevel(level: number): number {
    if (level < 1 || level >= PROGRESSION_BALANCE.maxLevel) {
        return 0;
    }
    return Math.round(800 * Math.pow(level, 1.15));
}

export const XP_REWARDS = {
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

export function calculateRaceXp(input: RacePerformanceInput): number {
    if (!input.finished) {
        return 0;
    }
    const placementIndex = Math.max(0, input.placement - 1);
    const placementXp = placementIndex < XP_REWARDS.placement.values.length
        ? XP_REWARDS.placement.values[placementIndex]
        : XP_REWARDS.placement.fallback;
    const perfXp = Math.max(0, input.maxCombo) * XP_REWARDS.performance.perMaxCombo
        + Math.max(0, input.perfectCount) * XP_REWARDS.performance.perPerfect
        + Math.max(0, input.goodCount) * XP_REWARDS.performance.perGood;
    return XP_REWARDS.finishBase + placementXp + perfXp;
}
