import { Vec3 } from 'cc';

export const RACE_DISTANCE = 200 as const;
export const RACE_COURSE_LENGTH = 50;

// Once the first racer touches the finish wall, remaining swimmers get this many
// seconds to also finish. Anyone still in the water when it elapses is recorded
// as 未完成 (DNF) and shares the last placement.
export const FINISH_STRAGGLER_COUNTDOWN_SECONDS = 10;

export type RaceDifficulty = 'beginner' | 'competitive' | 'championship';

export type RaceDifficultyConfig = {
    id: RaceDifficulty;
    label: string;
    // Uniform multiplier on every lane's base difficulty (accuracy + cadence).
    aiDifficultyScale: number;
    // Strategy-layer multipliers, applied on top of AI_STRATEGY_TUNING so each
    // tier feels distinct beyond raw speed:
    //   rubberBandScale — how hard the pack chases the player when it falls behind
    //                     (low = you can pull away; high = they cling to you).
    //   duelScale       — extra push when an AI is neck-and-neck with the player.
    //   weaveScale      — personality weave amount (high = more wobble/mistakes,
    //                     low = cleaner, more professional lines).
    rubberBandScale: number;
    duelScale: number;
    weaveScale: number;
    // Whether this tier enables the dynamic lane-lockdown race modifier.
    laneLockdownEnabled: boolean;
};

export const RACE_DIFFICULTY_OPTIONS: readonly RaceDifficultyConfig[] = [
    // 入门：整体慢、几乎不追赶、对手爱蛇形犯错 → 玩家轻松领先并甩开。
    { id: 'beginner', label: '入门', aiDifficultyScale: 0.6, rubberBandScale: 0.35, duelScale: 0.3, weaveScale: 1.6, laneLockdownEnabled: false },
    // 竞技：均衡基准，策略参数原样。
    { id: 'competitive', label: '竞技', aiDifficultyScale: 0.82, rubberBandScale: 1, duelScale: 1, weaveScale: 1, laneLockdownEnabled: false },
    // 世锦赛：快、咬得死、路线干净专业 → 领先也会被反复追平、缠斗。
    { id: 'championship', label: '世锦赛', aiDifficultyScale: 1, rubberBandScale: 1.6, duelScale: 1.7, weaveScale: 0.45, laneLockdownEnabled: true },
];

let currentRaceDifficulty: RaceDifficulty = 'competitive';

export function getRaceDistance(): number {
    return RACE_DISTANCE;
}

export function getRaceDifficulty(): RaceDifficulty {
    return currentRaceDifficulty;
}

export function setRaceDifficulty(difficulty: RaceDifficulty): RaceDifficulty {
    currentRaceDifficulty = RACE_DIFFICULTY_OPTIONS.some((option) => option.id === difficulty)
        ? difficulty
        : 'competitive';
    return currentRaceDifficulty;
}

export function getRaceDifficultyConfig(difficulty = currentRaceDifficulty): RaceDifficultyConfig {
    return RACE_DIFFICULTY_OPTIONS.find((option) => option.id === difficulty)
        ?? RACE_DIFFICULTY_OPTIONS[1];
}

export function raceDistanceToCourseX(distance: number): number {
    const lap = Math.floor(Math.max(0, distance) / RACE_COURSE_LENGTH);
    const lapDistance = Math.max(0, distance) % RACE_COURSE_LENGTH;
    return lap % 2 === 0 ? lapDistance : RACE_COURSE_LENGTH - lapDistance;
}

export function raceDistanceDirection(distance: number): number {
    const lap = Math.floor(Math.max(0, distance) / RACE_COURSE_LENGTH);
    return lap % 2 === 0 ? 1 : -1;
}

export function raceFinishDirection(distance: number): number {
    return raceDistanceDirection(Math.max(0, distance - 0.001));
}
export const COUNTDOWN_SECONDS = 3;
export const GLIDE_SECONDS = 0.72;

export const SWIMMER_BALANCE = {
    baseSpeed: 0.8,
    maxSpeed: 4,
    minSpeed: 0,
    // Initial burst produced by pushing off the wall. This is intentionally
    // independent of entry speed and decays during underwater glide like a dive.
    flipTurnPushLaunchSpeed: 5.2,
    // Streamlined wall-push glide has much less extra drag than the normal dive
    // phase. Base/high-speed water drag still slows the burst naturally.
    flipTurnUnderwaterGlideDrag: 0.05,
    // Power used by the normalized approach ease-out curve. 1 is linear;
    // higher values shed speed earlier and settle more gently into the wall.
    flipTurnDecelerationExponent: 2,
    // Wall-push speed uses the same front-loaded power shape: accelerate strongly
    // just after wall contact, then ease gently into the launch burst.
    flipTurnAccelerationExponent: 2,
    strokeBaseAccel: 0.05,
    strokeQualityAccel: 1.6,
    strokeAccelDurationRatio: 0.4,
    // Stroke impulse punchiness (redesign, "冲刺感"): 0 = flat accel over the
    // whole pulse (smooth). Higher = the accel is front-loaded into a spike right
    // after the stroke, then fades — so the swimmer lunges forward and drag pulls
    // it back. Same total momentum; only the feel changes.
    strokeImpulseSharpness: 0,
    // Kick propulsion (redesign): kicking no longer gives a per-tap impulse.
    // Instead the legs produce a CONTINUOUS acceleration proportional to the
    // current kick frequency (taps/sec), so fast tapping accelerates fast and
    // slow tapping accelerates slowly. Kicking alone tops out at kickMaxSpeed
    // (well below the arm-driven maxSpeed) — arms remain the true engine.
    // 踢腿推进（重构）：不再按次给脉冲，而是按当前踢腿频率（次/秒）产生连续加速度——
    // 点得快加速快、点得慢加速慢。单靠踢腿速度封顶在 kickMaxSpeed（远低于手臂的 maxSpeed），
    // 手臂才是真正的发动机。
    // Acceleration per Hz of kick cadence (m/s² per tap/second).
    kickAccelPerHz: 0.34,
    // PROPULSION cadence cap: kick frequency above this doesn't add more speed, so
    // a burst of extremely fast taps can't spike the pace. Only limits propulsion;
    // the leg animation tracks the raw finger rhythm (see kickCadenceMeasureMaxHz).
    kickCadenceMaxHz: 8,
    // SAFETY cap applied when measuring cadence (1/interval), high enough that real
    // tapping never reaches it — it only stops a near-zero gap between two taps from
    // blowing the value up. The leg animation uses this (effectively uncapped).
    kickCadenceMeasureMaxHz: 20,
    // Speed ceiling reachable by kicking alone.
    kickMaxSpeed: 2.1,
    // Speed band below kickMaxSpeed over which the kick acceleration fades to 0,
    // so kicking eases into its ceiling instead of hard-clamping.
    kickCeilingBand: 0.5,
    poolDeceleration: 0.06,
    baseDrag: 0.03,
    highSpeedDrag: 0.03,
    // Underwater-glide drag (redesign): while the swimmer is still in the
    // post-dive underwater glide (before surfacing), an EXTRA drag proportional to
    // current speed is applied on top of the normal drag. So a fast dive entry
    // bleeds off quickly unless the player keeps flutter-kicking. Underwater kick
    // propulsion uses the same cadence gain above without the surface speed ceiling.
    // Only affects the glide phase; surface swimming is unchanged. Set to 0 to disable.
    // 水下滑行阻力（重构）：跳水入水后、露出水面前的潜水滑行阶段，在常规阻力之外再叠加一份
    // 与当前速度成正比的额外阻力。于是入水速度很快就会衰减，除非玩家持续抖腿踢水（每次潜水
    // 踢腿推进由上面的点击频率参数计算）。只作用于滑行阶段，水面游泳不受影响；设 0 关闭。
    glideDrag: 0.35,
    // Overspeed cap/decay: a strong dive can launch above maxSpeed; these clamp
    // how far over and how fast it bleeds back down. (Legacy name kept.)
    perfectComboMaxOvercap: 0.9,
    perfectComboOvercapDecay: 0.45,
};

export const DIVE_BALANCE = {
    platformNodeOffset: new Vec3(-1.37, 0.53, 0),
    minLaunchSpeed: 4.2,
    maxLaunchSpeed: 8.2,
    launchAngleDegrees: 16,
    launchGravity: 6.2,
    minHoldSeconds: 0.08,
    maxHoldSeconds: 1.1,
    minPower: 0.18,
    chargeCycleSeconds: 1.6,
    defaultFallbackHoldSeconds: 0.12,
    defaultAiPower: 0.72,
    defaultAiReactionSeconds: 0.14,
    aiReactionRandomSeconds: 0.08,
    aiPowerVariance: 0.08,
    aiPowerMin: 0.38,
    aiPowerMax: 0.96,
};

export const RHYTHM_BALANCE = {
    targetBpm: 156,
    maxComboBonus: 1.55,
    comboPerfectBonus: 0.045,
    comboGoodBonus: 0.015,
    holdPerfectBonus: 0.08,
    holdGoodBonus: 0.035,
    holdMissPenalty: 1,
    comboMissPenalty: 3,
    aiDifficulty: 0.86,
    aiBpmVariance: 12,
};

export const TARGET_INTERVAL = 60 / RHYTHM_BALANCE.targetBpm;

export function getTargetInterval(): number {
    return 60 / RHYTHM_BALANCE.targetBpm;
}
