/** 海龟班车的赛果规则；本文件不依赖 Cocos 节点或渲染帧率。 */
export type TurtleBusDirection = -1 | 1;
export type TurtleBusPhase = 'idle' | 'preview' | 'boarding' | 'accelerating'
    | 'cruising' | 'unloading' | 'submerging' | 'done';
export type TurtleBusDetachReason = 'stroke' | 'impact' | 'reach' | 'ability'
    | 'unload' | 'recovery' | 'disconnect' | 'reset';

export const TURTLE_BUS_SEAT_COUNT = 4;
export const TURTLE_BUS_MAX_SWIMMERS = 8;
export const TURTLE_BUS_LEFT_HAND = 1;
export const TURTLE_BUS_RIGHT_HAND = 2;
export const TURTLE_BUS_BOTH_HANDS = 3;

export const TURTLE_BUS_CONFIG = {
    previewSeconds: 3,
    riseSeconds: 1.2,
    boardingSeconds: 0.6,
    boardingSpeed: 1.85,
    accelerationSeconds: 0.6,
    cruiseSpeed: 2,
    startOffset: 16,
    unloadOffset: 42,
    unloadSeconds: 0.6,
    submergeSeconds: 1.4,
    claimConfirmSeconds: 0.12,
    reachSeconds: 0.25,
    claimNetworkReserveSeconds: 0.4,
    minimumRideSeconds: 2,
    maximumClaimRelativeSpeed: 4,
    maximumLateralRate: 0.65,
    regrabCooldownSeconds: 0.8,
    detachImpulseBoth: 1.4,
    detachImpulseSingle: 0.9,
    maximumTripSeconds: 30,
} as const;

/** 本地调试手感参数。联网对局始终使用默认值，避免各端私有调参影响仲裁。 */
export const TURTLE_BUS_TUNING = {
    claimConfirmSeconds: TURTLE_BUS_CONFIG.claimConfirmSeconds as number,
    detachImpulseBoth: TURTLE_BUS_CONFIG.detachImpulseBoth as number,
    detachImpulseSingle: TURTLE_BUS_CONFIG.detachImpulseSingle as number,
    regrabCooldownSeconds: TURTLE_BUS_CONFIG.regrabCooldownSeconds as number,
};
export type TurtleBusFeel = Readonly<typeof TURTLE_BUS_TUNING>;
export function turtleBusFeelSnapshot(networked = false): TurtleBusFeel {
    const source = networked ? TURTLE_BUS_CONFIG : TURTLE_BUS_TUNING;
    return {
        claimConfirmSeconds: source.claimConfirmSeconds,
        detachImpulseBoth: source.detachImpulseBoth,
        detachImpulseSingle: Math.min(source.detachImpulseSingle, source.detachImpulseBoth),
        regrabCooldownSeconds: source.regrabCooldownSeconds,
    };
}

/** 坐标以本趟出发端为零点，方向换算只发生在场地适配层。 */
export const TURTLE_BUS_RING_FORWARD_OFFSETS: readonly number[] = [-3.8, -4.6, -4.6, -3.8];
export const TURTLE_BUS_RING_LATERAL_OFFSETS: readonly number[] = [-3.6, -1.2, 1.2, 3.6];

/** 海龟反向行驶时整个模型绕 Y 轴旋转 180 度，圈的横向坐标也必须同步镜像。 */
export function turtleBusRingWorldLateral(routeLateral: number, direction: TurtleBusDirection,
    ring: number): number {
    return routeLateral + direction * TURTLE_BUS_RING_LATERAL_OFFSETS[ring];
}

export type TurtleBusRacerSample = Readonly<{
    /** 稳定参赛座位编号，范围 0..7。 */
    seat: number;
    /** 当前正式泳段的世界前进方向。 */
    direction: TurtleBusDirection;
    /** 从本趟出发端起算的赛程米，不是累计比赛距离。 */
    offset: number;
    /** 世界横向坐标。 */
    lateral: number;
    /** 近期正常前进速率，单位赛程米/秒。 */
    forwardSpeed: number;
    /** 未完赛且仍在比赛。 */
    racing: boolean;
    /** 能在本步从水面抓圈。 */
    boardEligible: boolean;
}>;

const BOARDING_START = TURTLE_BUS_CONFIG.previewSeconds;
const ACCELERATING_START = BOARDING_START + TURTLE_BUS_CONFIG.boardingSeconds;
const CRUISE_START = ACCELERATING_START + TURTLE_BUS_CONFIG.accelerationSeconds;
const CRUISE_TRAVEL = TURTLE_BUS_CONFIG.boardingSpeed * TURTLE_BUS_CONFIG.boardingSeconds
    + (TURTLE_BUS_CONFIG.boardingSpeed + TURTLE_BUS_CONFIG.cruiseSpeed)
        * TURTLE_BUS_CONFIG.accelerationSeconds * 0.5;
const unloadStart = (startOffset: number) => CRUISE_START
    + (TURTLE_BUS_CONFIG.unloadOffset - startOffset - CRUISE_TRAVEL) / TURTLE_BUS_CONFIG.cruiseSpeed;
const submergeStart = (startOffset: number) => unloadStart(startOffset) + TURTLE_BUS_CONFIG.unloadSeconds;

export function turtleBusUnloadingAge(startOffset: number = TURTLE_BUS_CONFIG.startOffset): number { return unloadStart(startOffset); }
export function turtleBusDoneAge(startOffset: number = TURTLE_BUS_CONFIG.startOffset): number {
    return submergeStart(startOffset) + TURTLE_BUS_CONFIG.submergeSeconds;
}

export function turtleBusSpeedAt(age: number, startOffset: number = TURTLE_BUS_CONFIG.startOffset): number {
    if (!Number.isFinite(age) || age < BOARDING_START || age >= submergeStart(startOffset)) return 0;
    if (age < ACCELERATING_START) return TURTLE_BUS_CONFIG.boardingSpeed;
    if (age < CRUISE_START) {
        return TURTLE_BUS_CONFIG.boardingSpeed
            + (TURTLE_BUS_CONFIG.cruiseSpeed - TURTLE_BUS_CONFIG.boardingSpeed)
                * (age - ACCELERATING_START) / TURTLE_BUS_CONFIG.accelerationSeconds;
    }
    if (age < unloadStart(startOffset)) return TURTLE_BUS_CONFIG.cruiseSpeed;
    return TURTLE_BUS_CONFIG.cruiseSpeed
        + (TURTLE_BUS_CONFIG.boardingSpeed - TURTLE_BUS_CONFIG.cruiseSpeed)
            * (age - unloadStart(startOffset)) / TURTLE_BUS_CONFIG.unloadSeconds;
}

/** 所有端通过同一分段函数算位置；预告上浮阶段不前进。 */
export function turtleBusPositionAt(age: number, startOffset: number = TURTLE_BUS_CONFIG.startOffset): number {
    const t = Math.max(0, Number.isFinite(age) ? age : 0);
    if (t < BOARDING_START) return startOffset;
    if (t < ACCELERATING_START) {
        return startOffset
            + TURTLE_BUS_CONFIG.boardingSpeed * (t - BOARDING_START);
    }
    if (t < CRUISE_START) {
        const u = t - ACCELERATING_START;
        const acceleration = (TURTLE_BUS_CONFIG.cruiseSpeed - TURTLE_BUS_CONFIG.boardingSpeed)
            / TURTLE_BUS_CONFIG.accelerationSeconds;
        return startOffset
            + TURTLE_BUS_CONFIG.boardingSpeed * TURTLE_BUS_CONFIG.boardingSeconds
            + TURTLE_BUS_CONFIG.boardingSpeed * u + acceleration * u * u * 0.5;
    }
    if (t < unloadStart(startOffset)) {
        return startOffset + CRUISE_TRAVEL + TURTLE_BUS_CONFIG.cruiseSpeed * (t - CRUISE_START);
    }
    if (t < submergeStart(startOffset)) {
        const u = t - unloadStart(startOffset);
        const deceleration = (TURTLE_BUS_CONFIG.cruiseSpeed - TURTLE_BUS_CONFIG.boardingSpeed)
            / TURTLE_BUS_CONFIG.unloadSeconds;
        return TURTLE_BUS_CONFIG.unloadOffset
            + TURTLE_BUS_CONFIG.cruiseSpeed * u - deceleration * u * u * 0.5;
    }
    return TURTLE_BUS_CONFIG.unloadOffset
        + (TURTLE_BUS_CONFIG.cruiseSpeed + TURTLE_BUS_CONFIG.boardingSpeed)
            * TURTLE_BUS_CONFIG.unloadSeconds * 0.5;
}

export function turtleBusPhaseAt(age: number, startOffset: number = TURTLE_BUS_CONFIG.startOffset): TurtleBusPhase {
    if (!Number.isFinite(age) || age < 0) return 'idle';
    if (age < BOARDING_START) return 'preview';
    if (age < ACCELERATING_START) return 'boarding';
    if (age < CRUISE_START) return 'accelerating';
    if (age < unloadStart(startOffset)) return 'cruising';
    if (age < submergeStart(startOffset)) return 'unloading';
    if (age < turtleBusDoneAge(startOffset)) return 'submerging';
    return 'done';
}

/** 返回抓稳时刻；无法在下客前获得至少两秒搭乘机会时返回 Infinity。 */
export function turtleBusEstimateClaimAge(
    racer: TurtleBusRacerSample, ring: number, direction: TurtleBusDirection,
    routeLateral: number, currentAge = 0, startOffset: number = TURTLE_BUS_CONFIG.startOffset,
): number {
    if (!racer.racing || !racer.boardEligible || racer.direction !== direction
        || ring < 0 || ring >= TURTLE_BUS_SEAT_COUNT
        || !Number.isFinite(racer.offset) || !Number.isFinite(racer.lateral)
        || !Number.isFinite(racer.forwardSpeed) || !Number.isFinite(currentAge)
        || currentAge < 0) return Infinity;
    const speed = Math.max(0, Math.min(4, racer.forwardSpeed));
    const lateralGap = Math.abs(racer.lateral - turtleBusRingWorldLateral(routeLateral, direction, ring));
    const lateralReady = Math.max(BOARDING_START,
        currentAge + lateralGap / TURTLE_BUS_CONFIG.maximumLateralRate);
    const claimOverhead = TURTLE_BUS_CONFIG.claimConfirmSeconds + TURTLE_BUS_CONFIG.reachSeconds
        + TURTLE_BUS_CONFIG.claimNetworkReserveSeconds;
    // 0.05 秒采样仅发生在发车规划（≤4 Hz）；运行时抓取用实际轨迹扫掠。
    for (let t = Math.max(BOARDING_START, currentAge);
        t < unloadStart(startOffset) - TURTLE_BUS_CONFIG.minimumRideSeconds; t += 0.05) {
        if (t < lateralReady) continue;
        const ringOffset = turtleBusPositionAt(t, startOffset) + TURTLE_BUS_RING_FORWARD_OFFSETS[ring];
        const swimmerOffset = racer.offset + speed * (t - currentAge);
        if (ringOffset < swimmerOffset) continue;
        if (ringOffset - swimmerOffset > TURTLE_BUS_CONFIG.maximumClaimRelativeSpeed * 0.2) continue;
        const claimedAt = t + claimOverhead;
        if (unloadStart(startOffset) - claimedAt >= TURTLE_BUS_CONFIG.minimumRideSeconds) return claimedAt;
    }
    return Infinity;
}

/** 4 圈小规模二分匹配，避免用同一空位证明多个人都能搭上。 */
export function turtleBusHasBoardingWindow(
    racers: readonly TurtleBusRacerSample[], direction: TurtleBusDirection,
    routeLateral: number, startOffset: number = TURTLE_BUS_CONFIG.startOffset,
): boolean {
    const viable = new Uint8Array(1 << TURTLE_BUS_SEAT_COUNT);
    viable[0] = 1;
    let eligibleRacers = 0;
    let racingRacers = 0;
    for (let i = 0; i < racers.length; i++) {
        const racer = racers[i];
        if (!racer.racing) continue;
        racingRacers++;
        let ringMask = 0;
        for (let ring = 0; ring < TURTLE_BUS_SEAT_COUNT; ring++) {
            if (Number.isFinite(turtleBusEstimateClaimAge(racer, ring, direction, routeLateral, 0, startOffset))) {
                ringMask |= 1 << ring;
            }
        }
        if (ringMask === 0) continue;
        eligibleRacers++;
        for (let mask = viable.length - 1; mask >= 0; mask--) {
            if (!viable[mask]) continue;
            for (let ring = 0; ring < TURTLE_BUS_SEAT_COUNT; ring++) {
                const bit = 1 << ring;
                if ((ringMask & bit) !== 0 && (mask & bit) === 0) viable[mask | bit] = 1;
            }
        }
    }
    const required = Math.min(2, racingRacers);
    if (required === 0 || eligibleRacers < required) return false;
    for (let mask = 1; mask < viable.length; mask++) {
        if (!viable[mask]) continue;
        let count = 0;
        for (let bits = mask; bits !== 0; bits &= bits - 1) count++;
        if (count >= required) return true;
    }
    return false;
}

/** 房主/单机的座位账本。移动和视觉位置由外层控制器驱动。 */
export class TurtleBusSeats {
    readonly occupants = new Int8Array(TURTLE_BUS_SEAT_COUNT);
    readonly ringOfSwimmer = new Int8Array(TURTLE_BUS_MAX_SWIMMERS);
    readonly hands = new Uint8Array(TURTLE_BUS_MAX_SWIMMERS);
    readonly occupantRevision = new Uint16Array(TURTLE_BUS_SEAT_COUNT);
    readonly lastStrokeSequence = new Uint32Array(TURTLE_BUS_MAX_SWIMMERS);
    readonly regrabUntil = new Float64Array(TURTLE_BUS_MAX_SWIMMERS);
    readonly mustExitCatchArea = new Uint8Array(TURTLE_BUS_MAX_SWIMMERS);
    phase: TurtleBusPhase = 'idle';
    tripId = 0;
    age = 0;
    startOffset: number = TURTLE_BUS_CONFIG.startOffset;
    constructor(private readonly feel: TurtleBusFeel = turtleBusFeelSnapshot(true)) { this.reset(); }

    reset(): void {
        this.occupants.fill(-1);
        this.ringOfSwimmer.fill(-1);
        this.hands.fill(0);
        this.occupantRevision.fill(0);
        this.lastStrokeSequence.fill(0);
        this.regrabUntil.fill(0);
        this.mustExitCatchArea.fill(0);
        this.tripId = 0;
        this.age = 0;
        this.startOffset = TURTLE_BUS_CONFIG.startOffset;
        this.phase = 'idle';
    }

    start(tripId: number, startOffset: number = TURTLE_BUS_CONFIG.startOffset): void {
        this.reset();
        this.tripId = tripId >>> 0;
        this.startOffset = startOffset;
        this.phase = 'preview';
    }

    advance(dt: number): TurtleBusPhase {
        if (this.phase === 'idle' || this.phase === 'done') return this.phase;
        this.age += Math.max(0, Number.isFinite(dt) ? dt : 0);
        const next = turtleBusPhaseAt(this.age, this.startOffset);
        if ((next === 'submerging' || next === 'done')
            && this.phase !== 'submerging') {
            this.releaseAll('unload', this.age);
        }
        this.phase = next;
        return next;
    }

    canClaim(swimmer: number, ring: number, age: number, eligible: boolean): boolean {
        return Number.isInteger(swimmer) && swimmer >= 0 && swimmer < TURTLE_BUS_MAX_SWIMMERS
            && Number.isInteger(ring) && ring >= 0 && ring < TURTLE_BUS_SEAT_COUNT
            && (this.phase === 'boarding' || this.phase === 'accelerating' || this.phase === 'cruising')
            && eligible && this.occupants[ring] < 0 && this.ringOfSwimmer[swimmer] < 0
            && this.mustExitCatchArea[swimmer] === 0
            && Number.isFinite(age)
            && age >= this.regrabUntil[swimmer];
    }

    claim(swimmer: number, ring: number, age: number, eligible: boolean, latestStrokeSequence: number): boolean {
        if (!this.canClaim(swimmer, ring, age, eligible)) return false;
        this.occupants[ring] = swimmer;
        this.ringOfSwimmer[swimmer] = ring;
        this.hands[swimmer] = TURTLE_BUS_BOTH_HANDS;
        this.occupantRevision[ring]++;
        this.lastStrokeSequence[swimmer] = latestStrokeSequence >>> 0;
        return true;
    }

    /** 返回 true 表示这次起划改变了抓握状态；重复/旧动作无效。 */
    strokeStarted(swimmer: number, hand: number, sequence: number, age: number): boolean {
        if (swimmer < 0 || swimmer >= TURTLE_BUS_MAX_SWIMMERS
            || this.ringOfSwimmer[swimmer] < 0
            || (hand !== TURTLE_BUS_LEFT_HAND && hand !== TURTLE_BUS_RIGHT_HAND)
            || !Number.isSafeInteger(sequence) || sequence <= this.lastStrokeSequence[swimmer]) return false;
        this.lastStrokeSequence[swimmer] = sequence;
        if ((this.hands[swimmer] & hand) === 0) return false;
        this.hands[swimmer] &= ~hand;
        if (this.hands[swimmer] === 0) this.detach(swimmer, 'stroke', age);
        return true;
    }

    hit(swimmer: number, actualImpulse: number, age: number): boolean {
        if (swimmer < 0 || swimmer >= TURTLE_BUS_MAX_SWIMMERS
            || this.ringOfSwimmer[swimmer] < 0 || !Number.isFinite(actualImpulse)) return false;
        const threshold = this.hands[swimmer] === TURTLE_BUS_BOTH_HANDS
            ? this.feel.detachImpulseBoth : this.feel.detachImpulseSingle;
        return actualImpulse >= threshold && this.detach(swimmer, 'impact', age);
    }

    detach(swimmer: number, _reason: TurtleBusDetachReason, age: number): boolean {
        if (swimmer < 0 || swimmer >= TURTLE_BUS_MAX_SWIMMERS) return false;
        const ring = this.ringOfSwimmer[swimmer];
        if (ring < 0) return false;
        this.occupants[ring] = -1;
        this.ringOfSwimmer[swimmer] = -1;
        this.hands[swimmer] = 0;
        this.occupantRevision[ring]++;
        this.regrabUntil[swimmer] = Math.max(0, age) + this.feel.regrabCooldownSeconds;
        this.mustExitCatchArea[swimmer] = 1;
        return true;
    }

    /** 人真正离开原圈抓取范围后才重新布防。 */
    leftCatchArea(swimmer: number): void {
        if (swimmer >= 0 && swimmer < TURTLE_BUS_MAX_SWIMMERS) this.mustExitCatchArea[swimmer] = 0;
    }

    releaseAll(reason: TurtleBusDetachReason, age: number): void {
        for (let swimmer = 0; swimmer < TURTLE_BUS_MAX_SWIMMERS; swimmer++) {
            this.detach(swimmer, reason, age);
        }
    }
}
