// 固有能力独立于养成；角色目录只引用稳定 ID，运动层不判断角色名称。
export type CharacterAbilityId = 'none' | 'frogSense' | 'frogHop' | 'powerKick'
    | 'catBalance' | 'precision' | 'breathControl' | 'wallKick' | 'kickDive'
    | 'perfectChain' | 'exoskeleton' | 'heavyBody';

export const CHARACTER_ABILITY_TUNING = {
    frogPerfectWidth: 1.4,
    frogPerfectReward: 0.8,
    frogEnergyGain: 1.5,
    frogDolphinSpeed: 0.8,
    frogDolphinCost: 0.4,
    legKickAcceleration: 1.4,
    legKickSpeed: 1.15,
    legStrokePower: 0.85,
    catRecovery: 1.8,
    ninjaPerfectWidth: 0.7,
    ninjaPerfectReward: 1.35,
    ninjaOtherReward: 0.75,
    coachMaxStrokeHz: 2,
    coachHeartLoad: 0.65,
    wallLaunch: 1.2,
    wallStrokePower: 0.9,
    diverDepth: 0.8,
    diverCollisionDepth: 0.45,
    diverDescentSpeed: 1.4,
    diverAscentSpeed: 1.6,
    diverKickHoldSeconds: 0.65,
    chainMaxStacks: 5,
    chainSpeedPerStack: 0.02,
    chainIdleCycles: 2,
};

export function validAbilityId(id: unknown): CharacterAbilityId {
    switch (id) {
        case 'frogSense': case 'frogHop': case 'powerKick': case 'catBalance':
        case 'precision': case 'breathControl': case 'wallKick': case 'kickDive':
        case 'perfectChain': case 'exoskeleton': case 'heavyBody': return id;
        default: return 'none';
    }
}

// 即使调参被脚本写入异常值也不让 NaN、负倍率进入物理或快照。
export function abilityValue(key: keyof typeof CHARACTER_ABILITY_TUNING, min = 0, max = 10): number {
    const value = CHARACTER_ABILITY_TUNING[key];
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}
