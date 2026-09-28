import { Node, Vec3 } from 'cc';
import { StrokeType } from './GameConstants';
import { getRaceDistance, SWIMMER_BALANCE } from './GameBalance';
import { CHARACTER_POSE_TUNING } from '../character/CharacterMotionTuning';
import type { Swimmer } from '../entity/Swimmer';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import type { NetTurtleBusState } from '../net/NetTurtleBusSnapshot';
import { TurtleBusVisual } from './TurtleBusPresentation';
import { TURTLE_BUS_LAYOUT } from './TurtleBusLayout';
import { SeededRandom } from './SharedRNG';
import {
    TURTLE_BUS_CONFIG, TURTLE_BUS_LEFT_HAND, TURTLE_BUS_RIGHT_HAND,
    TURTLE_BUS_RING_FORWARD_OFFSETS, turtleBusRingWorldLateral,
    TURTLE_BUS_SEAT_COUNT, TURTLE_BUS_MAX_SWIMMERS, TurtleBusSeats,
    turtleBusEstimateClaimAge, turtleBusHasBoardingWindow, turtleBusPositionAt,
    turtleBusSpeedAt, turtleBusUnloadingAge, turtleBusDoneAge, turtleBusPhaseAt, type TurtleBusDirection,
    type TurtleBusFeel, turtleBusFeelSnapshot, turtleBusCatchInterval,
} from './TurtleBusRules';

type MutableSample = {
    seat: number; direction: TurtleBusDirection; offset: number; lateral: number;
    forwardSpeed: number; racing: boolean; boardEligible: boolean; rootBack: number;
    boardReadyAfterSeconds: number;
};
const ROUTE_CENTERS = [-4, 0, 4] as const;
const FORMAL_LAUNCH_WAIT_SECONDS = 18;
const REPLICA_TARGET_TIMEOUT_SECONDS = 0.7;
const REPLICA_TOW_TIMEOUT_SECONDS = 1.2;

/** 单机与联机共用班车控制器；位置由规则账本和马达决定，模型只作可见参照。 */
export class TurtleBusController {
    readonly seats: TurtleBusSeats;
    private readonly swimmers: (Swimmer | null)[] = new Array(TURTLE_BUS_MAX_SWIMMERS).fill(null);
    private readonly bound: (Swimmer | null)[] = new Array(TURTLE_BUS_MAX_SWIMMERS).fill(null);
    private readonly previousStroke: (((side: StrokeType, sequence: number) => void) | null)[]
        = new Array(TURTLE_BUS_MAX_SWIMMERS).fill(null);
    private readonly strokeWrappers: (((side: StrokeType, sequence: number) => void) | null)[]
        = new Array(TURTLE_BUS_MAX_SWIMMERS).fill(null);
    private readonly samples: MutableSample[] = Array.from({ length: TURTLE_BUS_MAX_SWIMMERS }, (_, seat) => ({
        seat, direction: 1, offset: 0, lateral: 0, forwardSpeed: 0, racing: false, boardEligible: false,
        rootBack: TURTLE_BUS_LAYOUT.passengerRootBack,
        boardReadyAfterSeconds: 0,
    }));
    private readonly catchSeconds = new Float32Array(TURTLE_BUS_MAX_SWIMMERS * TURTLE_BUS_SEAT_COUNT);
    private readonly previousGap = new Float32Array(TURTLE_BUS_MAX_SWIMMERS * TURTLE_BUS_SEAT_COUNT).fill(NaN);
    private readonly previousLateral = new Float32Array(TURTLE_BUS_MAX_SWIMMERS * TURTLE_BUS_SEAT_COUNT);
    private readonly catchInterval = { enter: 0, exit: 0 };
    private readonly claimTimes = new Float64Array(TURTLE_BUS_MAX_SWIMMERS * TURTLE_BUS_SEAT_COUNT).fill(Infinity);
    private readonly claimDistances = new Float32Array(TURTLE_BUS_MAX_SWIMMERS * TURTLE_BUS_SEAT_COUNT);
    private readonly outOfReachSeconds = new Float32Array(TURTLE_BUS_MAX_SWIMMERS);
    private readonly knownRiding = new Uint8Array(TURTLE_BUS_MAX_SWIMMERS);
    private readonly knownHands = new Uint8Array(TURTLE_BUS_MAX_SWIMMERS);
    private readonly tripBase = new Float32Array(TURTLE_BUS_MAX_SWIMMERS);
    private readonly localReleasedHands = new Uint8Array(TURTLE_BUS_MAX_SWIMMERS);
    private readonly visual: TurtleBusVisual;
    private readonly ringWorld = new Vec3();
    private readonly rootBack = new Float32Array(TURTLE_BUS_MAX_SWIMMERS);
    private started = false;
    private plannerElapsed = 0;
    private launchWait = 0;
    private aiPlannerElapsed = 0;
    private direction: TurtleBusDirection = 1;
    private routeZ = 0;
    private startOffset: number = TURTLE_BUS_CONFIG.startOffset;
    private cancelAge: number | undefined;
    private readonly launchDelaySeconds: number;
    private readonly firstCandidate: number;
    private readonly firstRoute: number;
    private authoritative = true;
    private acceptNewPassengers = true;
    private snapshotSilenceSeconds = 0;
    private replicaTowExpired = false;
    private replicaTargetsExpired = false;

    constructor(
        root: Node,
        private readonly course: RaceCourseLayout,
        private readonly player: Swimmer,
        private readonly ais: readonly Swimmer[],
        seed: number,
        private readonly onPreview?: (direction: TurtleBusDirection) => void,
        private readonly onBoarding?: () => void,
        private readonly onGripChanged?: (seat: number, riding: boolean) => void,
        private readonly onAiTarget?: (seat: number, targetZ: number | null) => void,
        private readonly onHandsChanged?: (seat: number, hands: number) => void,
        private readonly formalMode = false,
        private readonly onUnavailable?: () => void,
        private readonly laneBySeat?: readonly number[],
        private readonly tripId = 1,
        private readonly feel: TurtleBusFeel = turtleBusFeelSnapshot(true),
    ) {
        const random = new SeededRandom((seed ^ Math.imul(tripId, 0x9e3779b1)) >>> 0);
        this.launchDelaySeconds = 0.5 + random.int(200) / 100;
        this.firstCandidate = random.int(TURTLE_BUS_MAX_SWIMMERS);
        this.firstRoute = random.int(ROUTE_CENTERS.length);
        this.seats = new TurtleBusSeats(feel);
        this.visual = new TurtleBusVisual(root, player.node.layer, course);
        this.bindSwimmers();
    }

    reset(): void {
        for (let i = 0; i < this.swimmers.length; i++) this.swimmers[i]?.motor.clearTurtleTow();
        for (let i = 0; i < this.knownRiding.length; i++) {
            if (this.knownRiding[i]) { this.knownRiding[i] = 0; this.onGripChanged?.(i, false); }
            if (this.knownHands[i]) { this.knownHands[i] = 0; this.onHandsChanged?.(i, 0); }
        }
        this.seats.reset();
        this.startOffset = TURTLE_BUS_CONFIG.startOffset;
        this.cancelAge = undefined;
        this.started = false;
        this.plannerElapsed = 0;
        this.launchWait = 0;
        this.aiPlannerElapsed = 0;
        if (this.onAiTarget) for (let i = 0; i < this.swimmers.length; i++) this.onAiTarget(i, null);
        this.catchSeconds.fill(0);
        this.previousGap.fill(NaN);
        this.outOfReachSeconds.fill(0);
        this.localReleasedHands.fill(0);
        this.acceptNewPassengers = true;
        this.snapshotSilenceSeconds = 0;
        this.replicaTowExpired = false;
        this.replicaTargetsExpired = false;
        this.visual.reset();
    }

    stopNewBoarding(): void {
        if (!this.acceptNewPassengers) return;
        this.acceptNewPassengers = false;
        if (this.onAiTarget) {
            for (let seat = 0; seat < this.swimmers.length; seat++) this.onAiTarget(seat, null);
        }
        if (!this.started) {
            this.started = true;
            this.seats.phase = 'done';
            this.visual.hide();
        } else if (this.seats.phase === 'preview') {
            this.seats.releaseAll('unload', this.seats.age);
            this.cancelAge = this.seats.age;
            this.seats.phase = 'submerging';
            this.syncGripChanges();
        }
    }

    setAuthority(authoritative: boolean): void {
        if (this.authoritative === authoritative) return;
        this.authoritative = authoritative;
        this.localReleasedHands.fill(0);
        this.snapshotSilenceSeconds = 0;
        this.replicaTowExpired = false;
        this.replicaTargetsExpired = false;
        if (authoritative) {
            for (let seat = 0; seat < this.swimmers.length; seat++) {
                if (this.seats.ringOfSwimmer[seat] >= 0 && this.seats.hands[seat] === 0) {
                    this.seats.detach(seat, 'disconnect', this.seats.age);
                    this.swimmers[seat]?.motor.clearTurtleTow();
                }
            }
            this.syncGripChanges();
        }
    }

    get isDone(): boolean { return this.seats.phase === 'done'; }
    get visualNode(): Node { return this.visual.node; }

    private worldScale(): number {
        return Math.abs(this.course.finishX - this.course.startX) / this.course.courseLength;
    }
    private passengerOffset(seat: number, ring: number): number {
        const swimmer = this.swimmers[seat];
        this.rootBack[seat] = swimmer?.cartoonRig?.turtleBusRootOffset ?? TURTLE_BUS_LAYOUT.passengerRootBack;
        return (TURTLE_BUS_RING_FORWARD_OFFSETS[ring] - this.rootBack[seat]) / this.worldScale();
    }
    private updateGripTarget(seat: number, ring: number): void {
        this.visual.ringWorld(ring, this.ringWorld);
        this.swimmers[seat]?.cartoonRig?.setTurtleBusRingTarget(
            this.ringWorld.x, this.ringWorld.y, this.ringWorld.z, this.direction);
    }

    snapshotState(): NetTurtleBusState | null {
        if (!this.started || !this.authoritative || this.seats.tripId <= 0) return null;
        const occupants = [-1, -1, -1, -1];
        const hands = [0, 0, 0, 0];
        const gripProtectedUntil = [0, 0, 0, 0];
        for (let ring = 0; ring < TURTLE_BUS_SEAT_COUNT; ring++) {
            const seat = this.seats.occupants[ring];
            if (seat < 0) continue;
            occupants[ring] = this.laneBySeat?.[seat] ?? seat;
            hands[ring] = this.seats.hands[seat];
            gripProtectedUntil[ring] = this.seats.gripProtectedUntil[seat];
        }
        return { tripId: this.seats.tripId, phase: this.seats.phase, age: this.seats.age,
            direction: this.direction, routeZ: this.routeZ, startOffset: this.startOffset,
            occupants, hands, gripProtectedUntil, ...(this.cancelAge === undefined ? {} : { cancelAge: this.cancelAge }) };
    }

    applyNetSnapshot(state: NetTurtleBusState): void {
        if (this.authoritative || state.tripId < this.seats.tripId) return;
        this.bindSwimmers();
        const newTrip = state.tripId > this.seats.tripId;
        const previousPhase = this.seats.phase;
        if (newTrip) {
            this.seats.start(state.tripId, state.startOffset);
            this.localReleasedHands.fill(0);
        }
        this.started = true;
        this.snapshotSilenceSeconds = 0;
        this.replicaTowExpired = false;
        this.replicaTargetsExpired = false;
        this.direction = state.direction;
        this.routeZ = state.routeZ;
        this.startOffset = state.startOffset;
        this.cancelAge = state.cancelAge;
        this.seats.startOffset = state.startOffset;
        // 接受权威进度，采样间隙由 updateReplica 小步外推。
        this.seats.age = Math.max(state.age, this.seats.age - 0.2);
        this.seats.phase = state.phase;
        // 快照中消失或换圈的乘客仍需留下离圈冷却，供房主切换时继续仲裁。
        if (!newTrip) {
            for (let seat = 0; seat < this.swimmers.length; seat++) {
                const oldRing = this.seats.ringOfSwimmer[seat];
                if (oldRing < 0 || state.occupants[oldRing] === (this.laneBySeat?.[seat] ?? seat)) continue;
                this.seats.detach(seat, 'disconnect', this.seats.age);
            }
        }
        this.seats.occupants.fill(-1);
        this.seats.ringOfSwimmer.fill(-1);
        this.seats.hands.fill(0);
        this.seats.gripProtectedUntil.fill(0);
        for (let ring = 0; ring < TURTLE_BUS_SEAT_COUNT; ring++) {
            const lane = state.occupants[ring];
            if (lane < 0) continue;
            const seat = this.localSeatForLane(lane);
            if (seat < 0 || !this.swimmers[seat]) continue;
            this.seats.occupants[ring] = seat;
            this.seats.ringOfSwimmer[seat] = ring;
            const hands = state.hands[ring] & ~this.localReleasedHands[seat];
            this.seats.hands[seat] = hands;
            // 采用房主截止时刻，重复快照和房主迁移不重新计时。
            this.seats.gripProtectedUntil[seat] = state.gripProtectedUntil?.[ring] ?? 0;
            this.seats.lastStrokeSequence[seat] = Math.max(this.seats.lastStrokeSequence[seat],
                this.swimmers[seat]!.motor.armStrokeSequence);
            this.tripBase[seat] = Math.max(0, Math.round((this.swimmers[seat]!.distance
                - turtleBusPositionAt(this.seats.age, this.startOffset) - this.passengerOffset(seat, ring))
                / this.course.courseLength)) * this.course.courseLength;
        }
        if (state.occupants.every(lane => lane !== (this.laneBySeat?.[0] ?? 0))) {
            this.localReleasedHands[0] = 0;
        }
        for (let seat = 0; seat < this.swimmers.length; seat++) {
            if (this.seats.ringOfSwimmer[seat] < 0 || this.seats.hands[seat] === 0) {
                this.swimmers[seat]?.motor.clearTurtleTow();
            }
        }
        this.syncGripChanges();
        if (state.phase === 'done') this.visual.hide();
        else this.visual.update(this.seats.age, this.direction, this.routeZ, this.startOffset, this.cancelAge);
        if (state.phase === 'done' && this.onAiTarget) {
            for (let seat = 0; seat < this.swimmers.length; seat++) this.onAiTarget(seat, null);
        }
        if (newTrip && state.phase === 'preview') this.onPreview?.(state.direction);
        if ((newTrip || previousPhase === 'preview')
            && (state.phase === 'boarding' || state.phase === 'accelerating'
                || state.phase === 'cruising')) this.onBoarding?.();
    }

    updateReplica(dt: number): void {
        if (this.authoritative || !this.started || this.seats.phase === 'done') return;
        this.snapshotSilenceSeconds += Math.max(0, dt);
        if (!this.replicaTargetsExpired
            && this.snapshotSilenceSeconds >= REPLICA_TARGET_TIMEOUT_SECONDS) {
            this.replicaTargetsExpired = true;
            if (this.onAiTarget) {
                for (let seat = 0; seat < this.swimmers.length; seat++) this.onAiTarget(seat, null);
            }
        }
        if (!this.replicaTowExpired
            && this.snapshotSilenceSeconds >= REPLICA_TOW_TIMEOUT_SECONDS) {
            this.replicaTowExpired = true;
            if (this.seats.ringOfSwimmer[0] >= 0) this.localReleasedHands[0] = 3;
            for (let seat = 0; seat < this.swimmers.length; seat++) {
                if (this.seats.hands[seat] === 0) continue;
                this.seats.hands[seat] = 0;
                this.swimmers[seat]?.motor.clearTurtleTow();
            }
            this.syncGripChanges();
        }
        const doneAge = this.cancelAge === undefined ? turtleBusDoneAge(this.startOffset) : this.cancelAge + TURTLE_BUS_CONFIG.submergeSeconds;
        this.seats.age = Math.min(doneAge, this.seats.age + Math.max(0, dt));
        this.seats.phase = this.cancelAge === undefined ? turtleBusPhaseAt(this.seats.age, this.startOffset)
            : this.seats.age >= doneAge ? 'done' : 'submerging';
        if (this.seats.phase === 'submerging' || this.seats.phase === 'done') {
            // 到站已由权威起点和时间确定；下一包延迟时也必须先放人再潜圈。
            if (this.seats.ringOfSwimmer[0] >= 0) this.localReleasedHands[0] = 3;
            for (let seat = 0; seat < this.swimmers.length; seat++) {
                this.seats.hands[seat] = 0;
                this.swimmers[seat]?.motor.clearTurtleTow();
            }
            this.syncGripChanges();
        }
        if (this.seats.phase === 'done') { this.visual.hide(); return; }
        this.visual.update(this.seats.age, this.direction, this.routeZ, this.startOffset, this.cancelAge);
        this.applySoftAvoidance(Math.max(0, dt), true);
        if (this.onAiTarget && !this.replicaTargetsExpired) {
            this.aiPlannerElapsed += dt;
            if (this.aiPlannerElapsed >= 0.15) {
                this.aiPlannerElapsed %= 0.15;
                for (let seat = 0; seat < this.swimmers.length; seat++) {
                    this.onAiTarget(seat, this.targetZForAi(seat));
                }
            }
        }
        const offset = turtleBusPositionAt(this.seats.age, this.startOffset);
        const speed = turtleBusSpeedAt(this.seats.age, this.startOffset);
        if (this.replicaTowExpired) return;
        for (let seat = 0; seat < this.swimmers.length; seat++) {
            const swimmer = this.swimmers[seat];
            const ring = this.seats.ringOfSwimmer[seat];
            if (!swimmer || ring < 0 || this.seats.hands[seat] === 0) continue;
            if (seat === 0) {
                const dx = Math.abs(this.tripBase[seat] + offset + this.passengerOffset(seat, ring) - swimmer.distance) * this.worldScale();
                const dz = Math.abs(swimmer.node.position.z - turtleBusRingWorldLateral(this.routeZ, this.direction, ring));
                this.outOfReachSeconds[seat] = dx > .5 || dz > .42 ? this.outOfReachSeconds[seat] + dt : 0;
                if (this.outOfReachSeconds[seat] >= .35) {
                    this.localReleasedHands[seat] |= this.seats.hands[seat]; this.seats.hands[seat] = 0;
                    swimmer.motor.clearTurtleTow(); this.syncGripChanges(); continue;
                }
            }
            this.updateGripTarget(seat, ring);
            swimmer.motor.setTurtleTowTarget(speed,
                this.tripBase[seat] + offset + this.passengerOffset(seat, ring),
                turtleBusRingWorldLateral(this.routeZ, this.direction, ring) - swimmer.startPosition.z);
        }
    }

    private localSeatForLane(lane: number): number {
        if (!this.laneBySeat) return lane;
        for (let seat = 0; seat < this.laneBySeat.length; seat++) {
            if (this.laneBySeat[seat] === lane) return seat;
        }
        return -1;
    }

    dispose(): void {
        this.reset();
        for (let i = 0; i < this.bound.length; i++) this.unbind(i);
        this.visual.dispose();
    }

    update(dt: number, racing: boolean): void {
        if (!racing || !this.authoritative) return;
        this.bindSwimmers();
        if (!this.started) {
            this.launchWait += dt;
            // The host seed picks a short departure delay; planning still waits for a safe, catchable leg.
            if (this.launchWait < this.launchDelaySeconds) return;
            this.plannerElapsed += dt;
            if (this.plannerElapsed >= 0.25) {
                this.plannerElapsed = 0;
                this.tryStart();
            }
            if (!this.started && this.formalMode && this.launchWait >= FORMAL_LAUNCH_WAIT_SECONDS) {
                this.started = true;
                this.seats.phase = 'done';
                this.onUnavailable?.();
            }
            return;
        }
        if (this.seats.phase === 'done') return;
        const previousPhase = this.seats.phase;
        if (this.cancelAge !== undefined) {
            this.seats.age += Math.max(0, dt);
            this.seats.phase = this.seats.age >= this.cancelAge + TURTLE_BUS_CONFIG.submergeSeconds ? 'done' : 'submerging';
        } else this.seats.advance(dt);
        const phase = this.seats.phase;
        const age = this.seats.age;
        if (phase === 'boarding' && previousPhase === 'preview') this.onBoarding?.();
        if (phase === 'submerging' && previousPhase !== 'submerging') {
            for (let i = 0; i < this.swimmers.length; i++) this.swimmers[i]?.motor.clearTurtleTow();
            this.syncGripChanges();
        }
        if (phase === 'done') {
            for (let i = 0; i < this.swimmers.length; i++) this.swimmers[i]?.motor.clearTurtleTow();
            this.syncGripChanges();
            if (this.onAiTarget) for (let i = 0; i < this.swimmers.length; i++) this.onAiTarget(i, null);
            this.visual.hide();
            return;
        }
        this.visual.update(age, this.direction, this.routeZ, this.startOffset, this.cancelAge);
        this.applySoftAvoidance(Math.max(0, dt), false);
        if (this.onAiTarget) {
            this.aiPlannerElapsed += dt;
            if (this.aiPlannerElapsed >= 0.15) {
                this.aiPlannerElapsed %= 0.15;
                for (let i = 0; i < this.swimmers.length; i++)
                    this.onAiTarget(i, this.targetZForAi(i));
            }
        }
        const busOffset = turtleBusPositionAt(age, this.startOffset);
        const busSpeed = turtleBusSpeedAt(age, this.startOffset);
        this.claimTimes.fill(Infinity);
        for (let i = 0; i < this.swimmers.length; i++) {
            const swimmer = this.swimmers[i];
            if (!swimmer) continue;
            const ring = this.seats.ringOfSwimmer[i];
            if (ring >= 0) {
                if (!this.isEligible(swimmer) || swimmer.raceDirection !== this.direction) {
                    this.detach(i, 'ability');
                    continue;
                }
                const ringDistance = this.tripBase[i] + busOffset + this.passengerOffset(i, ring);
                const ringZ = turtleBusRingWorldLateral(this.routeZ, this.direction, ring);
                const longitudinalError = Math.abs(ringDistance - swimmer.distance) * this.worldScale();
                const lateralError = Math.abs(ringZ - swimmer.node.position.z);
                this.outOfReachSeconds[i] = longitudinalError > 0.5 || lateralError > 0.42
                    ? this.outOfReachSeconds[i] + dt : 0;
                // 真人 owner 位置会按网络节奏校正；短抖动不能把刚上车的人甩掉。
                if (this.outOfReachSeconds[i] >= 0.35) {
                    this.detach(i, 'reach');
                    continue;
                }
                swimmer.motor.setTurtleTowTarget(busSpeed, ringDistance,
                    ringZ - swimmer.startPosition.z);
                this.updateGripTarget(i, ring);
                continue;
            }
            if (!this.acceptNewPassengers || (this.seats.phase !== 'boarding' && this.seats.phase !== 'accelerating'
                && this.seats.phase !== 'cruising')) continue;
            const offset = this.courseOffset(swimmer);
            let insideAny = false;
            for (let j = 0; j < TURTLE_BUS_SEAT_COUNT; j++) {
                const gap = (busOffset + this.passengerOffset(i, j) - offset) * this.worldScale();
                const lateralGap = swimmer.node.position.z
                    - turtleBusRingWorldLateral(this.routeZ, this.direction, j);
                const radius = this.feel.catchRadius;
                const inside = Math.abs(gap + .25) <= radius && Math.abs(lateralGap) <= radius;
                insideAny ||= inside;
                const key = i * TURTLE_BUS_SEAT_COUNT + j;
                const eligible = this.isEligible(swimmer) && swimmer.raceDirection === this.direction
                    && Math.abs(busSpeed - swimmer.currentSpeed) <= TURTLE_BUS_CONFIG.maximumClaimRelativeSpeed;
                const interval = this.catchInterval;
                const overlaps = eligible && turtleBusCatchInterval(this.previousGap[key], this.previousLateral[key],
                    gap, lateralGap, interval, radius);
                this.previousGap[key] = gap; this.previousLateral[key] = lateralGap;
                // 第一次采样已靠近也立即吸附，不要求先在圈外留下一帧历史。
                if (!eligible || (!overlaps && !inside) || !this.seats.canClaim(i, j, age, eligible)) { this.catchSeconds[key] = 0; continue; }
                if (!overlaps) { interval.enter = 0; interval.exit = 1; }
                const before = interval.enter > 0 ? 0 : this.catchSeconds[key];
                const touched = (interval.exit - interval.enter) * dt;
                this.catchSeconds[key] = interval.exit >= 1 ? before + touched : 0;
                // 宽容判定负责容易上车；占位时一次吸附到精确锚点，避免拉长手臂。
                if (!inside || before + touched < this.feel.claimConfirmSeconds) continue;
                this.claimTimes[key] = age - dt + interval.enter * dt + Math.max(0, this.feel.claimConfirmSeconds - before);
                this.claimDistances[key] = (gap * gap + lateralGap * lateralGap) / (radius * radius);
            }
            if (!insideAny) this.seats.leftCatchArea(i);
        }
        // 所有人先采样，再按真实确认时刻、归一化距离、稳定泳道身份分配。
        for (let pass = 0; pass < TURTLE_BUS_SEAT_COUNT; pass++) {
            let best = -1;
            for (let key = 0; key < this.claimTimes.length; key++) {
                if (!Number.isFinite(this.claimTimes[key])) continue;
                const seat = Math.floor(key / 4), ring = key % 4;
                if (!this.seats.canClaim(seat, ring, age, true)) continue;
                const bestSeat = Math.floor(best / 4);
                if (best < 0 || this.claimTimes[key] < this.claimTimes[best] - 1e-6
                    || (Math.abs(this.claimTimes[key] - this.claimTimes[best]) <= 1e-6
                        && (this.claimDistances[key] < this.claimDistances[best] - 1e-6
                            || (Math.abs(this.claimDistances[key] - this.claimDistances[best]) <= 1e-6
                                && (this.laneBySeat?.[seat] ?? seat) < (this.laneBySeat?.[bestSeat] ?? bestSeat))))) best = key;
            }
            if (best < 0) break;
            const seat = Math.floor(best / 4), ring = best % 4, swimmer = this.swimmers[seat]!;
            this.seats.claim(seat, ring, age, true, swimmer.motor.armStrokeSequence);
            this.tripBase[seat] = Math.floor(swimmer.distance / this.course.courseLength) * this.course.courseLength;
            swimmer.motor.beginTurtleGrip(); this.updateGripTarget(seat, ring); this.clearCatch(seat);
            this.capturePassenger(seat, ring);
            swimmer.motor.setTurtleTowTarget(busSpeed, this.tripBase[seat] + busOffset + this.passengerOffset(seat, ring),
                turtleBusRingWorldLateral(this.routeZ, this.direction, ring) - swimmer.startPosition.z);
        }
        this.syncGripChanges();
    }

    onResolvedImpact(first: Swimmer, firstImpulse: number, second: Swimmer, secondImpulse: number): void {
        if (!this.authoritative || !this.started || this.seats.phase === 'done') return;
        this.hit(first, firstImpulse);
        this.hit(second, secondImpulse);
    }

    private hit(swimmer: Swimmer, impulse: number): void {
        for (let i = 0; i < this.swimmers.length; i++) {
            if (this.swimmers[i] !== swimmer) continue;
            if (this.seats.hit(i, impulse, this.seats.age)) {
                swimmer.motor.clearTurtleTow();
                this.syncGripChanges();
            }
            return;
        }
    }

    private onStroke(i: number, side: StrokeType, sequence: number): void {
        if (!this.started || (!this.authoritative && i !== 0)) return;
        this.clearCatch(i);
        const hand = side === StrokeType.LEFT ? TURTLE_BUS_LEFT_HAND : TURTLE_BUS_RIGHT_HAND;
        const held = this.seats.strokeStarted(i, hand, sequence, this.seats.age);
        if (held && !this.authoritative && i === 0) this.localReleasedHands[i] |= hand;
        if (held) {
            if (this.seats.ringOfSwimmer[i] < 0) this.swimmers[i]?.motor.clearTurtleTow();
            this.syncGripChanges();
        }
    }

    private detach(i: number, reason: 'reach' | 'ability'): void {
        if (this.seats.detach(i, reason, this.seats.age)) {
            this.swimmers[i]?.motor.clearTurtleTow();
            this.syncGripChanges();
        }
    }

    private syncGripChanges(): void {
        for (let i = 0; i < this.knownRiding.length; i++) {
            const hands = this.seats.hands[i];
            if (hands !== this.knownHands[i]) {
                this.knownHands[i] = hands;
                this.onHandsChanged?.(i, hands);
            }
            const riding = this.seats.ringOfSwimmer[i] >= 0 && this.seats.hands[i] !== 0 ? 1 : 0;
            if (riding === this.knownRiding[i]) continue;
            this.knownRiding[i] = riding;
            if (riding && !this.authoritative && i === 0) {
                this.swimmers[i]?.motor.beginTurtleGrip();
                this.capturePassenger(i, this.seats.ringOfSwimmer[i]);
            }
            if (riding) this.onAiTarget?.(i, null);
            this.onGripChanged?.(i, riding === 1);
        }
    }

    private capturePassenger(seat: number, ring: number): void {
        const swimmer = this.swimmers[seat];
        if (!swimmer) return;
        const distance = this.tripBase[seat] + turtleBusPositionAt(this.seats.age, this.startOffset)
            + this.passengerOffset(seat, ring);
        const z = turtleBusRingWorldLateral(this.routeZ, this.direction, ring);
        // 访客延迟授予仍只允许近距离吸附，远处旧包交给原不可达兜底释放。
        if (Math.abs(distance - swimmer.distance) * this.worldScale() > this.feel.catchRadius + 1
            || Math.abs(z - swimmer.node.position.z) > this.feel.catchRadius + .3) return;
        swimmer.motor.captureTurtleGrip(distance, z - swimmer.startPosition.z);
        this.outOfReachSeconds[seat] = 0;
    }

    /** 低频评估可追上的空圈；AI仍用自己的正常划水和转向抢位。 */
    targetZForAi(seat: number): number | null {
        if (!this.started || !this.acceptNewPassengers || this.seats.phase === 'idle' || this.seats.phase === 'unloading'
            || this.seats.phase === 'submerging' || this.seats.phase === 'done'
            || seat < 0 || seat >= this.swimmers.length || this.seats.ringOfSwimmer[seat] >= 0) return null;
        const swimmer = this.swimmers[seat];
        if (!swimmer || !this.isEligible(swimmer)) return null;
        const sample = this.sampleApproach(seat, this.direction);
        let bestAge = Infinity;
        let bestGap = Infinity;
        let bestRing = -1;
        for (let ring = 0; ring < TURTLE_BUS_SEAT_COUNT; ring++) {
            if (this.seats.occupants[ring] >= 0) continue;
            const age = turtleBusEstimateClaimAge(sample, ring, this.direction,
                this.routeZ, this.seats.age, this.startOffset, this.worldScale(),
                swimmer.cartoonRig?.turtleBusRootOffset ?? TURTLE_BUS_LAYOUT.passengerRootBack);
            const gap = Math.abs(sample.lateral - turtleBusRingWorldLateral(this.routeZ, this.direction, ring));
            if (age < bestAge || (age === bestAge && Number.isFinite(age) && gap < bestGap)) {
                bestAge = age; bestGap = gap; bestRing = ring;
            }
        }
        return bestRing >= 0 ? turtleBusRingWorldLateral(this.routeZ, this.direction, bestRing) : null;
    }

    /** 面向指定池端规划：相向选手先到墙折返，再从圈后追上。 */
    private sampleApproach(seat: number, direction: TurtleBusDirection): MutableSample {
        const sample = this.samples[seat], swimmer = this.swimmers[seat];
        sample.racing = !!swimmer?.motor.isRacing && !!swimmer?.node.active;
        sample.boardEligible = false;
        if (!swimmer) return sample;
        sample.direction = direction;
        sample.offset = this.courseOffset(swimmer);
        sample.lateral = swimmer.node.position.z;
        sample.forwardSpeed = swimmer.currentSpeed * Math.max(0, Math.cos(swimmer.movementHeading));
        sample.rootBack = swimmer.cartoonRig?.turtleBusRootOffset ?? TURTLE_BUS_LAYOUT.passengerRootBack;
        sample.boardEligible = this.isEligible(swimmer);
        sample.boardReadyAfterSeconds = 0;
        if (swimmer.raceDirection !== direction) {
            const remaining = this.course.courseLength - sample.offset;
            // 最后一趟触壁是完赛，不能虚构一次折返来证明有人可搭。
            sample.boardEligible &&= swimmer.distance + remaining < getRaceDistance() - .01;
            const pose = CHARACTER_POSE_TUNING, balance = SWIMMER_BALANCE;
            const approach = pose.flipTurnToKeyframe1Seconds + pose.flipTurnToKeyframe2Seconds;
            const returning = pose.flipTurnReturnToSwimSeconds;
            const underwater = pose.flipTurnUnderwaterDiveSeconds + pose.flipTurnUnderwaterHoldSeconds
                + pose.flipTurnUnderwaterRiseSeconds;
            const approachTravel = sample.forwardSpeed * approach
                / (Math.min(2, Math.max(1, balance.flipTurnDecelerationExponent)) + 1);
            sample.boardReadyAfterSeconds = Math.max(0, remaining - approachTravel)
                / Math.max(.1, sample.forwardSpeed) + approach + returning + underwater;
            const launch = balance.flipTurnPushLaunchSpeed * (swimmer.motor.burstWallLaunchSpeedScale ?? 1);
            let travel = launch * returning / (Math.min(2, Math.max(1, balance.flipTurnAccelerationExponent)) + 1);
            let speed = launch;
            // 低频规划近似积分无划水滑行，不改变真实马达；强爆发角色不能被当作原地等候。
            for (let elapsed = 0; elapsed < underwater; elapsed += 1 / 30) {
                const step = Math.min(1 / 30, underwater - elapsed);
                const drag = balance.poolDeceleration + (balance.baseDrag + balance.flipTurnUnderwaterGlideDrag) * speed
                    + balance.highSpeedDrag * speed * speed;
                speed = Math.max(0, speed - drag * step);
                travel += speed * step;
            }
            sample.offset = travel - sample.forwardSpeed * sample.boardReadyAfterSeconds;
        }
        return sample;
    }

    private tryStart(): void {
        if (!this.player.motor.isRacing || !this.player.node.active) return;
        // 留出末排圈、最长角色身体和池壁余量；不随选手往中段平移。
        const candidateOffset = Math.ceil(TURTLE_BUS_CONFIG.entryWorldInset / this.worldScale() * 10) / 10;
        const preferred = this.swimmers[this.firstCandidate % (this.ais.length + 1)] ?? this.player;
        const firstDirection: TurtleBusDirection = preferred.raceDirection >= 0 ? 1 : -1;
        for (let side = 0; side < 2; side++) {
            const direction = (side === 0 ? firstDirection : -firstDirection) as TurtleBusDirection;
            for (let seat = 0; seat < this.samples.length; seat++) this.sampleApproach(seat, direction);
            let bestCenter = NaN, bestAge = Infinity, bestLateralGap = Infinity;
            for (let route = 0; route < ROUTE_CENTERS.length; route++) {
                const center = ROUTE_CENTERS[(this.firstRoute + route) % ROUTE_CENTERS.length];
                if (!this.entryFitsPool(center, candidateOffset)) continue;
                if (this.formalMode) {
                    if (!turtleBusHasBoardingWindow(this.samples, direction, center, candidateOffset,
                        this.worldScale(), TURTLE_BUS_CONFIG.launchClaimHorizonSeconds)) continue;
                    this.startTrip(direction, center, candidateOffset);
                    return;
                }
                // 独立试玩优先给玩家留空圈；已游远时等待下一池端窗口。
                for (let ring = 0; ring < TURTLE_BUS_SEAT_COUNT; ring++) {
                    const age = turtleBusEstimateClaimAge(this.samples[0], ring, direction, center,
                        0, candidateOffset, this.worldScale());
                    const gap = Math.abs(this.samples[0].lateral - turtleBusRingWorldLateral(center, direction, ring));
                    if (age <= TURTLE_BUS_CONFIG.launchClaimHorizonSeconds
                        && (gap < bestLateralGap || (gap === bestLateralGap && age < bestAge))) {
                        bestAge = age; bestCenter = center; bestLateralGap = gap;
                    }
                }
            }
            if (Number.isFinite(bestCenter)) {
                this.startTrip(direction, bestCenter, candidateOffset);
                return;
            }
        }
    }

    private startTrip(direction: TurtleBusDirection, center: number, startOffset: number): void {
        this.direction = direction;
        this.routeZ = center;
        this.startOffset = startOffset;
        this.started = true;
        this.seats.start(this.tripId, startOffset);
        this.visual.update(0, direction, center, startOffset);
        this.onPreview?.(direction);
    }

    private isEligible(swimmer: Swimmer): boolean {
        return swimmer.isCollisionActive && !swimmer.isEntertainmentInvulnerable
            && swimmer.motor.ability.depth <= 0.2;
    }

    private entryFitsPool(center: number, startOffset: number): boolean {
        const worldScale = this.worldScale();
        if (!Number.isFinite(startOffset) || startOffset < 1 || startOffset > 30) return false;
        if (startOffset * worldScale < 6.3 || startOffset >= TURTLE_BUS_CONFIG.unloadOffset - 5) return false;
        const halfPool = (this.course.poolWidth || 20) * .5;
        if (Math.abs(center) + Math.abs(TURTLE_BUS_LAYOUT.ringLateral[3]) + .95 > halfPool) return false;
        // 允许附近有人：本体从水下逐渐顶开，圈和绳索没有推挤体积。
        return true;
    }

    /** 只有海龟本体引导选手旁滑；泳圈和绳索不推人，保留自然靠近上车。 */
    private applySoftAvoidance(dt: number, ownerOnly: boolean): void {
        if (this.seats.phase === 'idle' || this.seats.phase === 'submerging' || this.seats.phase === 'done') return;
        const riseContact = Math.max(0, Math.min(1, (this.seats.age - .35) / .85));
        if (riseContact <= 0) return;
        const root = this.visual.node.position, limit = (this.course.poolWidth || 20) * .5 - .65;
        for (let seat = 0; seat < (ownerOnly ? 1 : this.swimmers.length); seat++) {
            const swimmer = this.swimmers[seat];
            if (!swimmer || !this.isEligible(swimmer) || this.seats.ringOfSwimmer[seat] >= 0) continue;
            const x = (swimmer.node.position.x - root.x) * this.direction;
            const z = swimmer.node.position.z;
            const obstacleZ = this.routeZ, radius = TURTLE_BUS_LAYOUT.bodyHalfWidth + .3;
            const dx = (x + swimmer.raceDirection * this.direction * .8) / (TURTLE_BUS_LAYOUT.bodyHalfLength + .5);
            const dz = (z - obstacleZ) / radius;
            const inside = dx * dx + dz * dz < 1;
            if (!inside) continue;
            const sign = Math.abs(z - obstacleZ) > .01 ? Math.sign(z - obstacleZ) : ((this.laneBySeat?.[seat] ?? seat) % 2 ? 1 : -1);
            const wanted = Math.max(-limit, Math.min(limit, obstacleZ + sign * radius * Math.sqrt(Math.max(0, 1 - dx * dx))));
            const maxPush = this.feel.bodySoftPushMax * dt * riseContact;
            const push = Math.max(-maxPush, Math.min(maxPush, wanted - z));
            if (Math.abs(push) > 1e-5) swimmer.applyCollisionPush(0, push);
        }
    }

    private courseOffset(swimmer: Swimmer): number {
        return ((swimmer.distance % this.course.courseLength) + this.course.courseLength)
            % this.course.courseLength;
    }

    private clearCatch(i: number): void {
        for (let j = 0; j < TURTLE_BUS_SEAT_COUNT; j++) {
            this.catchSeconds[i * TURTLE_BUS_SEAT_COUNT + j] = 0;
            this.previousGap[i * TURTLE_BUS_SEAT_COUNT + j] = NaN;
        }
    }

    private bindSwimmers(): void {
        this.swimmers[0] = this.player;
        for (let i = 1; i < this.swimmers.length; i++) this.swimmers[i] = this.ais[i - 1] ?? null;
        for (let i = 0; i < this.swimmers.length; i++) {
            const swimmer = this.swimmers[i];
            if (this.bound[i] === swimmer) continue;
            this.unbind(i);
            if (!swimmer) continue;
            const previous = swimmer.motor.onArmStrokeStarted;
            const wrapper = (side: StrokeType, sequence: number) => {
                previous?.(side, sequence);
                this.onStroke(i, side, sequence);
            };
            this.bound[i] = swimmer;
            this.previousStroke[i] = previous;
            this.strokeWrappers[i] = wrapper;
            swimmer.motor.onArmStrokeStarted = wrapper;
        }
    }

    private unbind(i: number): void {
        const swimmer = this.bound[i];
        if (swimmer && this.seats.ringOfSwimmer[i] >= 0) {
            this.seats.detach(i, 'reset', this.seats.age);
            swimmer.motor.clearTurtleTow();
            this.syncGripChanges();
        }
        if (swimmer?.motor.onArmStrokeStarted === this.strokeWrappers[i]) {
            swimmer.motor.onArmStrokeStarted = this.previousStroke[i];
        }
        this.bound[i] = null;
        this.previousStroke[i] = null;
        this.strokeWrappers[i] = null;
    }
}
