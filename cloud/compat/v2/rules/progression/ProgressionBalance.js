"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateRaceCoins = exports.COIN_REWARDS = exports.coinCostForLevel = exports.normalizeCharacterLevel = exports.PROGRESSION_BALANCE = void 0;
// Progression balance: level cap, per-level coin cost, and race coin reward.
// Coins are the single currency: races award coins, spending coins levels a
// character. No XP stat exists - coinCostForLevel is the cost to go from `level`
// to `level + 1` directly.
exports.PROGRESSION_BALANCE = {
    maxLevel: 30,
};
// 存档、旧档迁移和界面读取共用等级边界。
function normalizeCharacterLevel(level) {
    return typeof level === 'number' && Number.isFinite(level)
        ? Math.max(1, Math.min(exports.PROGRESSION_BALANCE.maxLevel, Math.floor(level)))
        : 1;
}
exports.normalizeCharacterLevel = normalizeCharacterLevel;
// Coin cost to advance from level `level` to `level + 1`.
// 原型成长曲线：首级约两场，后续平滑递增；50金币取整便于阅读。
function coinCostForLevel(level) {
    if (level < 1 || level >= exports.PROGRESSION_BALANCE.maxLevel) {
        return 0;
    }
    return Math.round((500 + 250 * level + 30 * level * level) / 50) * 50;
}
exports.coinCostForLevel = coinCostForLevel;
exports.COIN_REWARDS = {
    finishBase: 200,
    placement: {
        values: [200, 140, 100, 70],
        fallback: 40,
    },
    performance: {
        accuracy: 70,
        stability: 30,
    },
};
// Coins awarded for a race. DNF (finished === false) awards nothing.
function calculateRaceCoins(input) {
    if (!input.finished) {
        return 0;
    }
    const placementIndex = Math.max(0, input.placement - 1);
    const placementCoins = placementIndex < exports.COIN_REWARDS.placement.values.length
        ? exports.COIN_REWARDS.placement.values[placementIndex]
        : exports.COIN_REWARDS.placement.fallback;
    const total = input.perfectCount + input.goodCount + (input.missCount ?? 0);
    const perfCoins = total > 0 ? Math.min(100, Math.round(exports.COIN_REWARDS.performance.accuracy * input.perfectCount / total
        + exports.COIN_REWARDS.performance.stability * Math.min(1, input.maxCombo / total))) : 0;
    return Math.round((exports.COIN_REWARDS.finishBase + placementCoins + perfCoins)
        * (input.distance === 400 ? 2.2 : 1) * (input.factor ?? 1));
}
exports.calculateRaceCoins = calculateRaceCoins;
