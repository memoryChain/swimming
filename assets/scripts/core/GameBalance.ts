import { Vec3 } from 'cc';

export const RACE_DISTANCE_OPTIONS = [50, 100, 200] as const;
export type RaceDistanceMode = typeof RACE_DISTANCE_OPTIONS[number];
export const RACE_DISTANCE: RaceDistanceMode = 100;
export const RACE_COURSE_LENGTH = 50;
let currentRaceDistance: RaceDistanceMode = RACE_DISTANCE;

export function getRaceDistance(): RaceDistanceMode {
    return currentRaceDistance;
}

export function setRaceDistance(distance: number): RaceDistanceMode {
    const supported = RACE_DISTANCE_OPTIONS.find((value) => value === distance) ?? RACE_DISTANCE;
    currentRaceDistance = supported;
    return currentRaceDistance;
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
    strokeBaseAccel: 0.05,
    strokeStabilityAccel: 1.6,
    strokeAccelDurationRatio: 0.4,
    // Stroke impulse punchiness (redesign, "冲刺感"): 0 = flat accel over the
    // whole pulse (smooth). Higher = the accel is front-loaded into a spike right
    // after the stroke, then fades — so the swimmer lunges forward and drag pulls
    // it back. Same total momentum; only the feel changes.
    strokeImpulseSharpness: 0,
    diveUnderwaterKickAccel: 0.18,
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
    aiCruiseAccel: 2.2,
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
