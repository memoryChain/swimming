// 赛内“大招能量”（蓄气）平衡常量。
//
// 这是一局内 0-100 的临时资源：被动缓慢增长 + 操作（划水评级/连击/被撞补偿）积攒，
// 攒满后用于释放全角色共用的海豚跳大招；不足则完全无法触发。
// 每局开始重置为 0。纯数据文件，无 Cocos 依赖，可被调参面板覆盖。

export const ULTIMATE_ENERGY_BALANCE = {
    // 能量上限。
    maxEnergy: 100,

    // 所有角色共享的被动增长（点/秒）。提供低保，避免玩得差就完全攒不动。
    passivePerSecond: 1.2,

    // 单次划水评级的积攒（点）。BAD 给 0。
    perfectGain: 1.5,
    goodGain: 0.5,

    // 每 comboEvery 次连续 PERFECT 额外奖励 comboBonus 点（只在达成的那一击结算一次）。
    comboEvery: 5,
    comboBonus: 2,

    // 被撞飞时的补偿（点）。带节流，防止贴身摩擦反复刷能量。
    collisionBonus: 8,
    // 收到的击退冲量（m/s）超过该值才视为一次“被撞飞”，低于此不给补偿。
    collisionMinImpulse: 0.5,
    // 同一角色两次碰撞补偿的最小间隔（毫秒）。
    collisionCooldownMs: 500,

    // 海豚跳大招消耗（点）。必须蓄满整条能量槽才能触发，释放后清空。
    dolphinCost: 100,
};

// 0-100 的蓄气资质折算成积攒倍率：50 为基准（×1.0），每点 ±0.3%，即 ±15%。
export function energyGainMultiplier(aptitude: number): number {
    return 1 + (aptitude - 50) * 0.003;
}
