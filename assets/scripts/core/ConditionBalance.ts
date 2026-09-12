// 体力按结算次数消耗，心率按实际开始次数计算。

export const RACE_PHASE_BALANCE = {
    sprintDistanceFromFinish: 25,
};

export const CONDITION_BALANCE = {
    energy: {
        total: 100,
        drainPerStroke: 1,
        exhaustedPropulsionScale: 0.15,
        exhaustedCadenceScale: 0.6,
    },
};

// 真实划频驱动心率，心率只缩窄 PERFECT，不改变体力成本与推进倍率。
export const HEART_RATE_TUNING = {
    sampleSeconds: 2,
    bpmPerStrokeHz: 40,
    riseSeconds: 8,
    recoverySeconds: 2.5,
    quickRiseSeconds: 6,
    quickRecoverySeconds: 1.5,
    steadyRiseSeconds: 10,
    steadyRecoverySeconds: 3.5,
    slowRiseSeconds: 12,
    slowRecoverySeconds: 4.5,
    widthAt120: 0.8,
    widthAt140: 0.55,
    widthAt160: 0.4,
    minimumWidth: 0.3,
};

// 固有特性只决定追随目标心率的速度；独立于体重、等级及体力。
// 按参数键读取，调试面板修改后立即生效，不缓存旧时间常数。
export const HEART_RATE_TRAITS = {
    quick: { label: '快升快降', riseKey: 'quickRiseSeconds', recoveryKey: 'quickRecoverySeconds' },
    balanced: { label: '均衡', riseKey: 'riseSeconds', recoveryKey: 'recoverySeconds' },
    steady: { label: '慢升慢降', riseKey: 'steadyRiseSeconds', recoveryKey: 'steadyRecoverySeconds' },
    slow: { label: '极慢升降', riseKey: 'slowRiseSeconds', recoveryKey: 'slowRecoverySeconds' },
} as const;

export type HeartRateTraitId = keyof typeof HEART_RATE_TRAITS;

export function perfectWidthScale(heartRate: number): number {
    const h = Number.isFinite(heartRate) ? heartRate : 80;
    const w120 = Math.max(0.01, Math.min(1, HEART_RATE_TUNING.widthAt120));
    const w140 = Math.max(0.01, Math.min(w120, HEART_RATE_TUNING.widthAt140));
    const w160 = Math.max(0.01, Math.min(w140, HEART_RATE_TUNING.widthAt160));
    const minimum = Math.max(0.01, Math.min(w160, HEART_RATE_TUNING.minimumWidth));
    if (h <= 100) return 1;
    if (h < 120) return 1 + (w120 - 1) * (h - 100) / 20;
    if (h < 140) return w120 + (w140 - w120) * (h - 120) / 20;
    if (h < 160) return w140 + (w160 - w140) * (h - 140) / 20;
    return w160 + (minimum - w160) * Math.min(1, (h - 160) / 20);
}

// 保留共享接口，供本地玩家、AI 和远端 owner 状态使用。
export function conditionEfficiencyScale(energyRatio: number): number {
    return Number.isFinite(energyRatio) && energyRatio <= 0
        ? Math.max(0, Math.min(1, CONDITION_BALANCE.energy.exhaustedPropulsionScale))
        : 1;
}

export function conditionQualityScale(_heartRate: number): number {
    return 1;
}

export function energyDepletionCadenceScale(energyRatio: number): number {
    return Number.isFinite(energyRatio) && energyRatio <= 0
        ? Math.max(0.1, Math.min(1, CONDITION_BALANCE.energy.exhaustedCadenceScale))
        : 1;
}


// 小数消耗和网络比例还原可能留下极小浮点余数，不能因此多获得一划满力。
// 固定技能成本与普通划水扣费共用零点边界；异常/负数成本不增加体力。
export function energyAfterCost(energy: number, cost: number): number {
    if (!Number.isFinite(cost) || cost <= 0) return energy;
    const remaining = energy - cost;
    return remaining <= 1e-8 ? 0 : remaining;
}

export function energyAfterStrokes(energy: number, count: number): number {
    const remaining = energy - Math.max(0, Math.floor(count)) * Math.max(0, CONDITION_BALANCE.energy.drainPerStroke);
    return remaining <= 1e-8 ? 0 : remaining;
}
