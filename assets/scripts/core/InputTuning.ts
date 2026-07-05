import { TARGET_INTERVAL, getTargetInterval } from './GameBalance';

export const INPUT_TUNING = {
    padStrokeDedupeMs: 45,
    chordMergeWindowMs: 70,
    inputRateWindowSeconds: 1.2,
    rhythmPerfectWindowSeconds: 0.08,
    rhythmGoodWindowSeconds: 0.18,
    rhythmLooseWindowSeconds: 0.52,
    bothRhythmPerfectWindowSeconds: 0.055,
    bothRhythmGoodWindowSeconds: 0.12,
    holdPerfectWindowSeconds: 0.045,
    holdGoodWindowSeconds: 0.105,
    holdLooseWindowSeconds: 0.18,
    bothHoldPerfectWindowSeconds: 0.035,
    bothHoldGoodWindowSeconds: 0.08,
    chordReleaseWindowMs: 90,
};

export const MOTION_TUNING = {
    // Global visual animation speed multiplier shared by race and model debug.
    // 比赛和模型调试共用的整体动作表现倍率。
    animationSpeedScale: 0.8,

    // Motion speed multiplier while a stroke side is held.
    // 单侧划水按住期间的动作速度倍率。
    heldMotionSpeedScale: 1,

    // Motion speed multiplier after a stroke side is released.
    // 单侧划水松开后的动作释放速度倍率。
    releasedMotionSpeedScale: 2,

    // Minimum arm cycle speed at low swim speed.
    // 低游速时手臂循环的最低频率。
    armMinCyclesPerSecond: 0.82,

    // Minimum kick cycle speed at low swim speed.
    // 低游速时腿部打水循环的最低频率。
    kickMinCyclesPerSecond: 0.82,

    // Maximum limb cycle speed at high swim speed.
    // 高游速时肢体循环的最高频率。
    maxCyclesPerSecond: 2.8,

    // Base whole-body pitch while swimming.
    // 游泳时整个人物身体的基础俯仰角。
    swimBodyPitchDegrees: -3,

    // Whole-body vertical offset relative to water surface.
    // 人物身体相对水面的整体高度偏移。
    swimBodyYOffset: -0.08,

    // Palm rotation amount used to turn the hand into the water.
    // 手掌入水/划水时的翻掌角度。
    handPalmTurnDegrees: 130,

    // Side clearance for the forward-reaching arm.
    // 手臂前伸时避开身体侧面的距离。
    forwardArmSideClearance: 0.3,

    // Head turn amount for right-side breathing.
    // 右侧换气时头部转动角度。
    rightBreathTurnDegrees: 70,

    // Body roll added during right-side breathing.
    // 右侧换气时额外叠加的身体滚转角度。
    rightBreathBodyRollDegrees: 18,
};

export const STABILITY_TUNING = {
    sampleWindowSize: 5,
    perfectStdDev: 0.09,
    badStdDev: 0.185,
    minHoldSeconds: 0.16,
    minUsefulRatio: 0.28,
    maxUsefulRatio: 0.9,
    usefulRatioEdgeWindow: 0.08,
    inputFreshnessGraceRatio: 0.08,
    inputFreshnessPenaltyRatio: 0.35,
    inputFreshnessMinScale: 0.05,
};

export const TARGET_LIMB_RATE = 1 / TARGET_INTERVAL;

export function getTargetLimbRate(): number {
    return 1 / getTargetInterval();
}
