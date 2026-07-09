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
    // Motion speed multiplier while a stroke side is held.
    // 单侧划水按住期间的动作速度倍率。
    heldMotionSpeedScale: 1,

    // Motion speed multiplier after a stroke side is released.
    // 单侧划水松开后的动作释放速度倍率。
    releasedMotionSpeedScale: 2,

    // AI-only continuous flutter-kick cadence at max swim speed (cycles/sec). AI
    // swimmers don't tap, so their legs still use a speed-driven flutter. The
    // player's legs are driven by discrete kick pulses / arm-follow instead.
    // 仅 AI 用的连续打腿在最高速时的频率（圈/秒）。AI 不点击，腿仍用速度驱动的连续打水；
    // 玩家的腿改由离散踢腿脉冲 / 跟随手臂驱动。
    kickFlutterMaxCyclesPerSecond: 3.2,

    // AI-only idle flutter cadence floor as a fraction of max, so AI legs keep a
    // faint motion until nearly stopped rather than freezing abruptly.
    // 仅 AI 用的打腿最低频率（占最高频率的比例），让 AI 腿在接近停止前保留一点微弱摆动。
    kickFlutterIdleFraction: 0.08,

    // Player leg-kick pulse cadence FLOOR (cycles/sec). Each tap fires one kick on
    // the contralateral leg (A→right leg, D→left leg). The sweep cadence tracks the
    // player's actual tap frequency (so tapping faster = legs kick faster, up to
    // kickCadenceMaxHz), but never drops below this floor so a single or slow tap
    // still plays a visibly quick kick. Not tied to swim speed — no input means no
    // leg motion (pure glide).
    // 玩家踢腿脉冲频率下限（圈/秒）。每次点击给对侧腿（A→右腿，D→左腿）触发一次踢腿。扫描频率
    // 会跟随你实际的点击频率（点得越快腿踢得越快，上限到 kickCadenceMaxHz），但不会低于这个下限，
    // 于是单点或慢点也有一个明显的快踢。与游速无关——不输入腿就不动（纯滑行）。
    kickPulseMinCyclesPerSecond: 3.5,

    // Max number of kick pulses that can be buffered per leg. Rapid taps beyond
    // this are dropped so releasing the taps stops the legs quickly (small = snappy stop).
    // 每条腿最多缓冲的踢腿脉冲数。超过的快速连点会被丢弃，于是停点后腿很快停下（越小=停得越干脆）。
    kickPulseMaxCycles: 2,

    // How fast a leg completes its current partial kick back to the neutral
    // (straight) pose when there's no input and no arm stroke (cycles/sec).
    // 无输入、无划水时，腿把当前这半下踢水补完回到中性（直腿）姿势的速度（圈/秒）。
    kickSettleCyclesPerSecond: 1.2,

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
    minHoldSeconds: 0.16,
    // Arm-stroke overhold timeout (redesign): while a stroke is still held and
    // its pull progresses past this fraction of a full cycle, the hand has left
    // the water — the stroke auto-ends as a timeout miss giving only a tiny
    // propulsion (armStrokeTimeoutAccel). 0.5 = half circle (end of the pull).
    armStrokeTimeoutProgress: 0.5,
    armStrokeTimeoutAccel: 0.08,
    // Release-timing sweet zones use explicit progress ranges on 0..1. If GOOD
    // and PERFECT overlap, the overlap scores as PERFECT.
    goodStart: 0.22,
    goodEnd: 0.5,
    perfectStart: 0.34,
    perfectEnd: 0.46,
    // Arm-stroke cadence vs. swim speed (redesign): the pull cadence ramps
    // linearly from armCycleLowSpeedPerSecond to armCycleHighSpeedPerSecond as
    // current speed crosses the window [armCycleSpeedStart, armCycleSpeedFull],
    // clamped at both ends. Below armCycleSpeedStart the cadence stays at the low
    // floor; at/above armCycleSpeedFull it stays at the high ceiling. The speed
    // range (0..maxSpeed) is intentionally wider than this window, so cadence
    // decouples from raw speed at the extremes. Because the sweet zone is a fixed
    // *fraction* of a cycle, a faster cycle means a shorter real-time release
    // window — so high speed demands tighter timing. AI and player share these
    // values; the AI only differs in how it drives input timing.
    armCycleLowSpeedPerSecond: 0.8,
    armCycleHighSpeedPerSecond: 2.5,
    armCycleSpeedStart: 1.0,
    armCycleSpeedFull: 4.5,
};

export const TARGET_LIMB_RATE = 1 / TARGET_INTERVAL;

export function getTargetLimbRate(): number {
    return 1 / getTargetInterval();
}
