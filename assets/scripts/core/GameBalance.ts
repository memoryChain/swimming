import { Vec3 } from 'cc';

export const RACE_DISTANCE = 200 as const;
export const RACE_COURSE_LENGTH = 50;

// Once the first racer touches the finish wall, remaining swimmers get this many
// seconds to also finish. Anyone still in the water when it elapses is recorded
// as 未完成 (DNF) and ranked by the distance already covered.
export const FINISH_STRAGGLER_COUNTDOWN_SECONDS = 10;

export type RaceDifficulty = 'beginner' | 'competitive' | 'championship';
export type RaceModeId = RaceDifficulty | 'stimulant-brawl' | 'shark-brawl'
    | 'whirlpool-brawl' | 'last-place-brawl' | 'timed-bomb-brawl' | 'minefield-brawl'
    | 'mine-relay-brawl';
export type RaceCategoryId = 'competitive' | 'entertainment';
export type RaceRulesetId = 'standard' | 'wild' | 'stimulant' | 'shark' | 'whirlpool' | 'cannon'
    | 'timed-bomb' | 'minefield';

export type RaceModeConfig = {
    id: RaceModeId;
    label: string;
    category: RaceCategoryId;
    distance: 200 | 400;
    ruleset: RaceRulesetId;
    // Whether this tier enables the dynamic lane-lockdown race modifier.
    laneLockdownEnabled: boolean;
    steeringEnabled: boolean;
};

// 保留稳定入口ID供存档和房间使用；AI等级与智力独立配置于 competitor/AiRaceConfig。
export const RACE_MODE_OPTIONS: readonly RaceModeConfig[] = [
    { id: 'beginner', label: '标准竞速', category: 'competitive', distance: 200, ruleset: 'standard', laneLockdownEnabled: false, steeringEnabled: false },
    { id: 'competitive', label: '狂野模式', category: 'competitive', distance: 200, ruleset: 'wild', laneLockdownEnabled: false, steeringEnabled: true },
    { id: 'championship', label: '狂野模式', category: 'competitive', distance: 400, ruleset: 'wild', laneLockdownEnabled: false, steeringEnabled: true },
    { id: 'stimulant-brawl', label: '兴奋剂大乱斗', category: 'entertainment', distance: 200, ruleset: 'stimulant', laneLockdownEnabled: false, steeringEnabled: true },
    { id: 'shark-brawl', label: '鲨鱼大乱斗', category: 'entertainment', distance: 200, ruleset: 'shark', laneLockdownEnabled: false, steeringEnabled: true },
    { id: 'whirlpool-brawl', label: '漩涡冲浪赛', category: 'entertainment', distance: 200, ruleset: 'whirlpool', laneLockdownEnabled: false, steeringEnabled: true },
    // 保留入口 ID，避免已有存档和联机房间选择失效；玩法本身已替换为炮火逃生赛。
    { id: 'last-place-brawl', label: '炮火逃生赛', category: 'entertainment', distance: 200, ruleset: 'cannon', laneLockdownEnabled: false, steeringEnabled: true },
    { id: 'timed-bomb-brawl', label: '定时炸弹模式', category: 'entertainment', distance: 200, ruleset: 'timed-bomb', laneLockdownEnabled: false, steeringEnabled: true },
    { id: 'minefield-brawl', label: '水雷模式', category: 'entertainment', distance: 200, ruleset: 'minefield', laneLockdownEnabled: false, steeringEnabled: true },
];
export const RACE_DIFFICULTY_OPTIONS: readonly RaceModeConfig[] = RACE_MODE_OPTIONS.filter((option) => option.category === 'competitive');

let currentRaceMode: RaceModeId = 'competitive';
let soloDistance: 200 | 400 | null = null;
export function setSoloRaceDistance(distance: 200 | 400 | null): void { soloDistance = distance; }

// 入口共用赛程映射；传入模式供准备页/房间预览，省略时读取当前比赛。
export function getRaceDistance(mode?: RaceModeId): number {
    if (mode === undefined && soloDistance !== null) return soloDistance;
    return getRaceModeConfig(mode ?? currentRaceMode).distance;
}

export function getRaceMode(): RaceModeId {
    return currentRaceMode;
}

export function setRaceMode(mode: RaceModeId): RaceModeId {
    const normalized = mode === 'mine-relay-brawl' ? 'timed-bomb-brawl' : mode;
    currentRaceMode = RACE_MODE_OPTIONS.some((option) => option.id === normalized)
        ? normalized
        : 'competitive';
    return currentRaceMode;
}

// 兼容现有调用名；新代码使用 RaceMode 命名，旧稳定 ID 与存档值保持不变。
export function getRaceDifficulty(): RaceModeId { return getRaceMode(); }
export function setRaceDifficulty(mode: RaceModeId): RaceModeId { return setRaceMode(mode); }

export function getRaceModeConfig(mode: RaceModeId = currentRaceMode): RaceModeConfig {
    const normalized = mode === 'mine-relay-brawl' ? 'timed-bomb-brawl' : mode;
    return RACE_MODE_OPTIONS.find((option) => option.id === normalized)
        ?? RACE_MODE_OPTIONS[1];
}
export const getRaceDifficultyConfig = getRaceModeConfig;

export function isRaceSteeringEnabled(): boolean {
    return getRaceModeConfig().steeringEnabled;
}

export function getRaceModeTitle(mode: RaceModeId = currentRaceMode): string {
    return getRaceModeConfig(mode).label;
}

export function isStimulantBrawlMode(mode: RaceModeId = currentRaceMode): boolean {
    return getRaceModeConfig(mode).ruleset === 'stimulant';
}

export function isSharkBrawlMode(mode: RaceModeId = currentRaceMode): boolean {
    return getRaceModeConfig(mode).ruleset === 'shark';
}

export function isWhirlpoolBrawlMode(mode: RaceModeId = currentRaceMode): boolean {
    return getRaceModeConfig(mode).ruleset === 'whirlpool';
}

export function isCannonBrawlMode(mode: RaceModeId = currentRaceMode): boolean {
    return getRaceModeConfig(mode).ruleset === 'cannon';
}

export function isTimedBombBrawlMode(mode: RaceModeId = currentRaceMode): boolean {
    return getRaceModeConfig(mode).ruleset === 'timed-bomb';
}

export function isMinefieldBrawlMode(mode: RaceModeId = currentRaceMode): boolean {
    return getRaceModeConfig(mode).ruleset === 'minefield';
}

/** @deprecated 旧入口只用于兼容仍未迁移的调用。 */
export const isMineRelayBrawlMode = isTimedBombBrawlMode;

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
    maxSpeed: 3.4,
    minSpeed: 0,
    // Initial burst produced by pushing off the wall. This is intentionally
    // independent of entry speed and decays during underwater glide like a dive.
    // 角色实际蹬墙初速 = 此基准 × 爆发倍率；不改变翻滚时长。
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
    strokeBaseAccel: 1.5,
    // 基础推进中允许在按住阶段预支的最大比例，松手结算扣除已支付部分。
    strokeHeldBaseRatio: 0.8,
    strokeQualityAccel: 2.6,
    // 只缩放 GOOD 的质量推进，不改变判定、连击、蓄气和按住阶段的基础推进。
    strokeGoodPropulsionScale: 0.6,
    // 0 为原完整动作耗时补偿，1 为标准按住周期补偿；不奖励实际空等时间。
    strokeTimeCompensation: 1,
    strokeAccelDurationRatio: 0.45,
    // Stroke impulse punchiness (redesign, "冲刺感"): 0 = flat accel over the
    // whole pulse (smooth). Higher = the accel is front-loaded into a spike right
    // after the stroke, then fades — so the swimmer lunges forward and drag pulls
    // it back. Same total momentum; only the feel changes.
    strokeImpulseSharpness: 0.3,
    // Kick propulsion (redesign): kicking no longer gives a per-tap impulse.
    // Instead the legs produce a CONTINUOUS acceleration proportional to the
    // current kick frequency (taps/sec), so fast tapping accelerates fast and
    // slow tapping accelerates slowly. Kicking alone tops out at kickMaxSpeed
    // (well below the arm-driven maxSpeed) — arms remain the true engine.
    // 踢腿推进（重构）：不再按次给脉冲，而是按当前踢腿频率（次/秒）产生连续加速度——
    // 点得快加速快、点得慢加速慢。单靠踢腿速度封顶在 kickMaxSpeed（远低于手臂的 maxSpeed），
    // 手臂才是真正的发动机。
    // Acceleration per Hz of kick cadence (m/s² per tap/second). Underwater
    // (post-dive/dolphin glide) this runs without the surface ceiling fade, so it
    // is the main way to hold speed after entering the water — keep it punchy
    // enough that flutter-kicking clearly propels instead of just slowing the bleed.
    kickAccelPerHz: 0.22,
    // PROPULSION cadence cap: kick frequency above this doesn't add more speed, so
    // a burst of extremely fast taps can't spike the pace. Only limits propulsion;
    // the leg animation tracks the raw finger rhythm (see kickCadenceMeasureMaxHz).
    kickCadenceMaxHz: 4.8,
    // SAFETY cap applied when measuring cadence (1/interval), high enough that real
    // tapping never reaches it — it only stops a near-zero gap between two taps from
    // blowing the value up. The leg animation uses this (effectively uncapped).
    kickCadenceMeasureMaxHz: 20,
    // Speed ceiling reachable by kicking alone.
    kickMaxSpeed: 2.7,
    // Speed band below kickMaxSpeed over which the kick acceleration fades to 0,
    // so kicking eases into its ceiling instead of hard-clamping.
    kickCeilingBand: 0.5,
    poolDeceleration: 0.03,
    baseDrag: 0.24,
    highSpeedDrag: 0.12,
    // Underwater-glide drag (redesign): while the swimmer is still in the
    // post-dive underwater glide (before surfacing), an EXTRA drag proportional to
    // current speed is applied on top of the normal drag. So a fast dive entry
    // bleeds off quickly unless the player keeps flutter-kicking. Underwater kick
    // propulsion uses the same cadence gain above without the surface speed ceiling.
    // Only affects the glide phase; surface swimming is unchanged. Set to 0 to disable.
    // 水下滑行阻力（重构）：跳水入水后、露出水面前的潜水滑行阶段，在常规阻力之外再叠加一份
    // 与当前速度成正比的额外阻力。于是入水速度很快就会衰减，除非玩家持续抖腿踢水（每次潜水
    // 踢腿推进由上面的点击频率参数计算）。只作用于滑行阶段，水面游泳不受影响；设 0 关闭。
    glideDrag: 0.22,
    // 已有超速状态回落时的共享余量参数，保护当前速度，不限制起跳初速。
    // 保留旧调参ID兼容存档；不再由技巧或PERFECT连击加成。
    perfectComboMaxOvercap: 0.9,
    perfectComboOvercapDecay: 0.45,
};

// 技巧只缩放完整手臂推进；基准保留旧84点技巧的质量奖励，普通AI仍使用原共享推进。
export const TECHNIQUE_BALANCE = {
    referenceAttribute: 84,
    referenceQualityScale: 1.102,
    // 标准PERFECT稳定游速的校准目标，非每帧直接乘速度。
    speedGainPerPoint: 0.003,
    // 真实输入回放拟合；仅用于把目标游速差换成推进倍率，不改变水阻或游速上限。
    propulsionExponent: 5.85,
    propulsionCurvature: 6,
};

// 爆发力只影响三种起跳初速，独立于技巧的推进成长。
export const BURST_BALANCE = {
    referenceAttribute: 50,
    // 每点相对 50 点增加 0.6% 基准初速；调参键 burst.speedGainPerPoint。
    speedGainPerPoint: 0.006,
    // 蹬墙单独放大爆发差异；不改变跳水和海豚跳的初速曲线。
    wallSpeedGainPerPoint: 0.018,
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
    // 从提交跳水到真正离台的固定准备时长；蓄力与爆发只改变初速。
    takeoffAnticipationSeconds: 0.32,
    aiPowerVariance: 0.08,
    aiPowerMin: 0.38,
    aiPowerMax: 0.96,
};

export const RHYTHM_BALANCE = {
    targetBpm: 156,
    aiDifficulty: 0.86,
};

export const TARGET_INTERVAL = 60 / RHYTHM_BALANCE.targetBpm;

export function getTargetInterval(): number {
    return 60 / RHYTHM_BALANCE.targetBpm;
}
