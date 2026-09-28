import { Material, Mesh, MeshRenderer, Node, utils } from 'cc';
import { StrokeType } from './GameConstants';
import type { Swimmer } from '../entity/Swimmer';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import type { NetTurtleBusState } from '../net/NetTurtleBusSnapshot';
import { TURTLE_BUS_GEOMETRY } from './TurtleBusGeometry';
import { SeededRandom } from './SharedRNG';
import {
    TURTLE_BUS_CONFIG, TURTLE_BUS_LEFT_HAND, TURTLE_BUS_RIGHT_HAND,
    TURTLE_BUS_RING_FORWARD_OFFSETS, turtleBusRingWorldLateral,
    TURTLE_BUS_SEAT_COUNT, TURTLE_BUS_MAX_SWIMMERS, TurtleBusSeats,
    turtleBusEstimateClaimAge, turtleBusHasBoardingWindow, turtleBusPositionAt,
    turtleBusSpeedAt, turtleBusUnloadingAge, turtleBusDoneAge, type TurtleBusDirection,
    type TurtleBusFeel, turtleBusFeelSnapshot,
} from './TurtleBusRules';

type MutableSample = {
    seat: number; direction: TurtleBusDirection; offset: number; lateral: number;
    forwardSpeed: number; racing: boolean; boardEligible: boolean;
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
    }));
    private readonly catchSeconds = new Float32Array(TURTLE_BUS_MAX_SWIMMERS * TURTLE_BUS_SEAT_COUNT);
    private readonly outOfReachSeconds = new Float32Array(TURTLE_BUS_MAX_SWIMMERS);
    private readonly knownRiding = new Uint8Array(TURTLE_BUS_MAX_SWIMMERS);
    private readonly knownHands = new Uint8Array(TURTLE_BUS_MAX_SWIMMERS);
    private readonly tripBase = new Float32Array(TURTLE_BUS_MAX_SWIMMERS);
    private readonly localReleasedHands = new Uint8Array(TURTLE_BUS_MAX_SWIMMERS);
    private readonly visual: TurtleBusVisual;
    private started = false;
    private plannerElapsed = 0;
    private launchWait = 0;
    private aiPlannerElapsed = 0;
    private direction: TurtleBusDirection = 1;
    private routeZ = 0;
    private startOffset: number = TURTLE_BUS_CONFIG.startOffset;
    private readonly launchDelaySeconds: number;
    private readonly firstCandidate: number;
    private readonly firstRoute: number;
    private readonly candidateJitter = new Float32Array(TURTLE_BUS_MAX_SWIMMERS);
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
        for (let seat = 0; seat < this.candidateJitter.length; seat++) {
            this.candidateJitter[seat] = random.int(70) / 100;
        }
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
        this.started = false;
        this.plannerElapsed = 0;
        this.launchWait = 0;
        this.aiPlannerElapsed = 0;
        if (this.onAiTarget) for (let i = 0; i < this.swimmers.length; i++) this.onAiTarget(i, null);
        this.catchSeconds.fill(0);
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

    snapshotState(): NetTurtleBusState | null {
        if (!this.started || !this.authoritative || this.seats.tripId <= 0) return null;
        const occupants = [-1, -1, -1, -1];
        const hands = [0, 0, 0, 0];
        for (let ring = 0; ring < TURTLE_BUS_SEAT_COUNT; ring++) {
            const seat = this.seats.occupants[ring];
            if (seat < 0) continue;
            occupants[ring] = this.laneBySeat?.[seat] ?? seat;
            hands[ring] = this.seats.hands[seat];
        }
        return { tripId: this.seats.tripId, phase: this.seats.phase, age: this.seats.age,
            direction: this.direction, routeZ: this.routeZ, startOffset: this.startOffset,
            occupants, hands };
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
        for (let ring = 0; ring < TURTLE_BUS_SEAT_COUNT; ring++) {
            const lane = state.occupants[ring];
            if (lane < 0) continue;
            const seat = this.localSeatForLane(lane);
            if (seat < 0 || !this.swimmers[seat]) continue;
            this.seats.occupants[ring] = seat;
            this.seats.ringOfSwimmer[seat] = ring;
            const hands = state.hands[ring] & ~this.localReleasedHands[seat];
            this.seats.hands[seat] = hands;
            this.seats.lastStrokeSequence[seat] = Math.max(this.seats.lastStrokeSequence[seat],
                this.swimmers[seat]!.motor.armStrokeSequence);
            this.tripBase[seat] = Math.max(0, Math.round((this.swimmers[seat]!.distance
                - turtleBusPositionAt(this.seats.age, this.startOffset) - TURTLE_BUS_RING_FORWARD_OFFSETS[ring])
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
        else this.visual.update(this.seats.age, this.direction, this.routeZ, this.startOffset);
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
        this.seats.age = Math.min(turtleBusDoneAge(this.startOffset), this.seats.age + Math.max(0, dt));
        this.visual.update(this.seats.age, this.direction, this.routeZ, this.startOffset);
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
            swimmer.motor.setTurtleTowTarget(speed,
                this.tripBase[seat] + offset + TURTLE_BUS_RING_FORWARD_OFFSETS[ring],
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
        const phase = this.seats.advance(dt);
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
        this.visual.update(age, this.direction, this.routeZ, this.startOffset);
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
        for (let i = 0; i < this.swimmers.length; i++) {
            const swimmer = this.swimmers[i];
            if (!swimmer) continue;
            const ring = this.seats.ringOfSwimmer[i];
            if (ring >= 0) {
                if (!this.isEligible(swimmer) || swimmer.raceDirection !== this.direction) {
                    this.detach(i, 'ability');
                    continue;
                }
                const ringDistance = this.tripBase[i] + busOffset + TURTLE_BUS_RING_FORWARD_OFFSETS[ring];
                const ringZ = turtleBusRingWorldLateral(this.routeZ, this.direction, ring);
                const longitudinalError = Math.abs(ringDistance - swimmer.distance);
                const lateralError = Math.abs(ringZ - swimmer.node.position.z);
                this.outOfReachSeconds[i] = longitudinalError > 1.7 || lateralError > 1.15
                    ? this.outOfReachSeconds[i] + dt : 0;
                // 真人 owner 位置会按网络节奏校正；短抖动不能把刚上车的人甩掉。
                if (this.outOfReachSeconds[i] >= 0.35) {
                    this.detach(i, 'reach');
                    continue;
                }
                swimmer.motor.setTurtleTowTarget(busSpeed, ringDistance,
                    ringZ - swimmer.startPosition.z);
                continue;
            }
            if (!this.acceptNewPassengers || (this.seats.phase !== 'boarding' && this.seats.phase !== 'accelerating'
                && this.seats.phase !== 'cruising')) continue;
            const offset = this.courseOffset(swimmer);
            let insideAny = false;
            for (let j = 0; j < TURTLE_BUS_SEAT_COUNT; j++) {
                const gap = busOffset + TURTLE_BUS_RING_FORWARD_OFFSETS[j] - offset;
                const lateralGap = Math.abs(swimmer.node.position.z
                    - turtleBusRingWorldLateral(this.routeZ, this.direction, j));
                const inside = gap >= -0.35 && gap <= 0.9 && lateralGap <= 0.78;
                insideAny ||= inside;
                const key = i * TURTLE_BUS_SEAT_COUNT + j;
                const eligible = this.isEligible(swimmer) && swimmer.raceDirection === this.direction
                    && Math.abs(busSpeed - swimmer.currentSpeed) <= TURTLE_BUS_CONFIG.maximumClaimRelativeSpeed;
                this.catchSeconds[key] = inside && eligible ? this.catchSeconds[key] + dt : 0;
                if (this.catchSeconds[key] < this.feel.claimConfirmSeconds) continue;
                if (!this.seats.claim(i, j, age, eligible, swimmer.motor.armStrokeSequence)) continue;
                this.tripBase[i] = Math.floor(swimmer.distance / this.course.courseLength)
                    * this.course.courseLength;
                swimmer.motor.beginTurtleGrip();
                this.syncGripChanges();
                swimmer.motor.setTurtleTowTarget(busSpeed,
                    this.tripBase[i] + busOffset + TURTLE_BUS_RING_FORWARD_OFFSETS[j],
                    turtleBusRingWorldLateral(this.routeZ, this.direction, j) - swimmer.startPosition.z);
                this.clearCatch(i);
                break;
            }
            if (!insideAny) this.seats.leftCatchArea(i);
        }
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
        const hand = side === StrokeType.LEFT ? TURTLE_BUS_LEFT_HAND : TURTLE_BUS_RIGHT_HAND;
        const held = this.seats.strokeStarted(i, hand, sequence, this.seats.age);
        if (held && !this.authoritative && i === 0) this.localReleasedHands[i] |= hand;
        if (held && this.seats.ringOfSwimmer[i] < 0) {
            this.swimmers[i]?.motor.clearTurtleTow();
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
            if (riding) this.onAiTarget?.(i, null);
            this.onGripChanged?.(i, riding === 1);
        }
    }

    /** 低频评估可追上的空圈；AI仍用自己的正常划水和转向抢位。 */
    targetZForAi(seat: number): number | null {
        if (!this.started || !this.acceptNewPassengers || this.seats.phase === 'idle' || this.seats.phase === 'unloading'
            || this.seats.phase === 'submerging' || this.seats.phase === 'done'
            || seat < 0 || seat >= this.swimmers.length || this.seats.ringOfSwimmer[seat] >= 0) return null;
        const swimmer = this.swimmers[seat];
        if (!swimmer || !this.isEligible(swimmer) || swimmer.raceDirection !== this.direction) return null;
        const sample = this.samples[seat];
        sample.racing = true;
        sample.direction = this.direction;
        sample.offset = this.courseOffset(swimmer);
        sample.lateral = swimmer.node.position.z;
        sample.forwardSpeed = swimmer.currentSpeed * Math.max(0, Math.cos(swimmer.movementHeading));
        sample.boardEligible = true;
        let bestAge = Infinity;
        let bestGap = Infinity;
        let bestRing = -1;
        for (let ring = 0; ring < TURTLE_BUS_SEAT_COUNT; ring++) {
            if (this.seats.occupants[ring] >= 0) continue;
            const age = turtleBusEstimateClaimAge(sample, ring, this.direction,
                this.routeZ, this.seats.age, this.startOffset);
            const gap = Math.abs(sample.lateral - turtleBusRingWorldLateral(this.routeZ, this.direction, ring));
            if (age < bestAge || (age === bestAge && Number.isFinite(age) && gap < bestGap)) {
                bestAge = age; bestGap = gap; bestRing = ring;
            }
        }
        return bestRing >= 0 ? turtleBusRingWorldLateral(this.routeZ, this.direction, bestRing) : null;
    }

    private tryStart(): void {
        // 起跳已结算、进入水下滑行即可预告上浮；真正抓圈仍检查水面资格。
        if (!this.player.motor.isRacing || !this.player.node.active) return;
        for (let i = 0; i < this.samples.length; i++) {
            const swimmer = this.swimmers[i];
            const sample = this.samples[i];
            sample.racing = !!swimmer?.motor.isRacing && !!swimmer?.node.active;
            if (!swimmer) continue;
            sample.direction = swimmer.raceDirection >= 0 ? 1 : -1;
            sample.offset = this.courseOffset(swimmer);
            sample.lateral = swimmer.node.position.z;
            sample.forwardSpeed = swimmer.currentSpeed * Math.max(0, Math.cos(swimmer.movementHeading));
            sample.boardEligible = this.isEligible(swimmer);
        }
        const direction = this.samples[0].direction;
        if (this.formalMode) {
            // Randomized candidate order, then actual reachability. A late majority cannot force a late launch.
            for (let attempt = 0; attempt < this.samples.length; attempt++) {
                const sample = this.samples[(this.firstCandidate + attempt) % this.samples.length];
                if (!sample.racing || !sample.boardEligible || sample.offset > 24) continue;
                const candidateOffset = this.candidateStartOffset(sample);
                for (let route = 0; route < ROUTE_CENTERS.length; route++) {
                    const center = ROUTE_CENTERS[(this.firstRoute + route) % ROUTE_CENTERS.length];
                    if (!this.bodySpawnClear(sample.direction, center, candidateOffset)) continue;
                    if (!turtleBusHasBoardingWindow(this.samples, sample.direction, center, candidateOffset)) continue;
                    this.startTrip(sample.direction, center, candidateOffset);
                    return;
                }
            }
            return;
        }
        const candidateOffset = this.candidateStartOffset(this.samples[0]);
        let bestCenter = NaN;
        let bestAge = Infinity;
        let bestLateralGap = Infinity;
        // P1独立调试入口先确保玩家有一圈可搭；正式导演另做多人机会和出生安全规划。
        for (const center of ROUTE_CENTERS) {
            for (let ring = 0; ring < TURTLE_BUS_SEAT_COUNT; ring++) {
                const age = turtleBusEstimateClaimAge(this.samples[0], ring, direction, center,
                    0, candidateOffset);
                const lateralGap = Math.abs(this.samples[0].lateral
                    - turtleBusRingWorldLateral(center, direction, ring));
                if (Number.isFinite(age) && (lateralGap < bestLateralGap
                    || (lateralGap === bestLateralGap && age < bestAge))) {
                    bestAge = age; bestCenter = center; bestLateralGap = lateralGap;
                }
            }
        }
        // 预告时玩家还在水下，严格抓圈资格暂时为假。灰模先按最近路线
        // 浮起，真正抓取仍走水面判定；正式导演需预测出水后的可达窗口。
        if (!Number.isFinite(bestCenter) && this.player.distance < this.course.courseLength) {
            let bestLateralGap = Infinity;
            for (const center of ROUTE_CENTERS) {
                for (let ring = 0; ring < TURTLE_BUS_SEAT_COUNT; ring++) {
                    const gap = Math.abs(this.samples[0].lateral
                        - turtleBusRingWorldLateral(center, direction, ring));
                    if (gap < bestLateralGap) { bestLateralGap = gap; bestCenter = center; }
                }
            }
        }
        if (!Number.isFinite(bestCenter)) return;
        this.startTrip(direction, bestCenter, candidateOffset);
    }

    private candidateStartOffset(sample: MutableSample): number {
        const speed = Math.max(2.3, Math.min(3.5, sample.forwardSpeed));
        const jitter = this.candidateJitter[sample.seat];
        return Math.round(Math.max(10, Math.min(30,
            sample.offset + speed * TURTLE_BUS_CONFIG.previewSeconds + 5.4 + jitter)) * 10) / 10;
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

    private bodySpawnClear(direction: TurtleBusDirection, center: number, startOffset: number): boolean {
        const origin = direction === this.course.direction ? this.course.startX : this.course.finishX;
        const worldScale = Math.abs(this.course.finishX - this.course.startX) / this.course.courseLength;
        const bodyX = origin + direction * startOffset * worldScale;
        for (let seat = 0; seat < this.swimmers.length; seat++) {
            const swimmer = this.swimmers[seat];
            if (!swimmer?.node.active || !swimmer.motor.isRacing) continue;
            if (Math.abs(swimmer.node.position.x - bodyX) < 2.7 * worldScale
                && Math.abs(swimmer.node.position.z - center) < 2.1) return false;
        }
        return true;
    }

    private courseOffset(swimmer: Swimmer): number {
        return ((swimmer.distance % this.course.courseLength) + this.course.courseLength)
            % this.course.courseLength;
    }

    private clearCatch(i: number): void {
        for (let j = 0; j < TURTLE_BUS_SEAT_COUNT; j++)
            this.catchSeconds[i * TURTLE_BUS_SEAT_COUNT + j] = 0;
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

/** Blender 作者源离线导出的单材质五组网格；比赛中只更新整体与鳍的变换。 */
class TurtleBusVisual {
    private readonly root: Node;
    private lastX = NaN;
    private lastY = NaN;
    private lastZ = NaN;
    private lastDirection: TurtleBusDirection = 1;
    private readonly meshes: Mesh[] = [];
    private readonly material: Material;
    private readonly frontFins: Node;
    private readonly rearFins: Node;
    private lastFlapSample = -1;

    get node(): Node { return this.root; }

    constructor(
        private readonly parent: Node,
        private readonly layer: number,
        private readonly course: RaceCourseLayout,
    ) {
        this.root = new Node('TurtleBus');
        this.root.setParent(parent);
        this.root.layer = layer;
        this.material = new Material();
        this.material.initialize({ effectName: 'builtin-unlit', defines: { USE_VERTEX_COLOR: true } });
        this.add('Body', TURTLE_BUS_GEOMETRY.body);
        this.frontFins = this.add('FrontFins', TURTLE_BUS_GEOMETRY.frontFins);
        this.rearFins = this.add('RearFins', TURTLE_BUS_GEOMETRY.rearFins);
        this.add('TowRings', TURTLE_BUS_GEOMETRY.rings);
        this.add('TowRopes', TURTLE_BUS_GEOMETRY.ropes);
        this.hide();
    }

    update(age: number, direction: TurtleBusDirection, routeZ: number,
        startOffset: number = TURTLE_BUS_CONFIG.startOffset): void {
        if (!this.root.active) this.root.active = true;
        if (direction !== this.lastDirection) {
            this.root.setRotationFromEuler(0, direction === 1 ? 0 : 180, 0);
            this.lastDirection = direction;
        }
        const offset = turtleBusPositionAt(age, startOffset);
        const origin = direction === this.course.direction ? this.course.startX : this.course.finishX;
        const worldScale = Math.abs(this.course.finishX - this.course.startX) / this.course.courseLength;
        const rise = Math.min(1, age / TURTLE_BUS_CONFIG.riseSeconds);
        const submergeStart = turtleBusUnloadingAge(startOffset) + TURTLE_BUS_CONFIG.unloadSeconds;
        const sink = age > submergeStart
            ? Math.min(1, (age - submergeStart) / TURTLE_BUS_CONFIG.submergeSeconds) : 0;
        const x = origin + direction * offset * worldScale;
        const y = this.course.waterY + 0.08 - (1 - rise) * 0.9 - sink * 1.1;
        const flapSample = Math.floor(age * 20);
        if (flapSample !== this.lastFlapSample) {
            const phase = age * 2 * Math.PI * 1.25;
            this.frontFins.setRotationFromEuler(Math.sin(phase) * 11, 0, 0);
            this.rearFins.setRotationFromEuler(Math.sin(phase + 1.3) * 6, 0, 0);
            this.lastFlapSample = flapSample;
        }
        if (x !== this.lastX || y !== this.lastY || routeZ !== this.lastZ) {
            this.root.setPosition(x, y, routeZ);
            this.lastX = x; this.lastY = y; this.lastZ = routeZ;
        }
    }

    hide(): void { if (this.root.active) this.root.active = false; }

    reset(): void {
        this.hide();
        this.lastX = NaN; this.lastY = NaN; this.lastZ = NaN;
        this.lastFlapSample = -1;
    }

    dispose(): void {
        this.root.destroy();
        for (const mesh of this.meshes) mesh.destroy();
        this.material.destroy();
    }

    private add(name: string, data: typeof TURTLE_BUS_GEOMETRY.body): Node {
        const node = new Node(name);
        node.setParent(this.root);
        node.layer = this.root.layer;
        const mesh = utils.createMesh(data);
        this.meshes.push(mesh);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(this.material, 0);
        return node;
    }
}
