import { GameState } from './GameConstants';
import { SeededRandom } from './SharedRNG';

export type MineRelayRacerState = {
    active: boolean;
    finished: boolean;
    distance: number;
    lateral: number;
};

export type MineRelayArm = {
    roundId: number;
    carrierLane: number;
    fuseSeconds: number;
    revision: number;
};

export type MineRelayTransfer = {
    roundId: number;
    fromLane: number;
    toLane: number;
    remainingSeconds: number;
    revision: number;
};

export type MineRelayResolution = {
    roundId: number;
    carrierLane: number;
    exploded: boolean;
    distance: number;
    revision: number;
};

export type MineRelayState = {
    revision: number;
    completedRoundMask: number;
    explodedRoundMask: number;
    resolvedCarrierLanesPacked: number;
    activeRoundId: number;
    carrierLane: number;
    previousCarrierLane: number;
    lastStarterLane: number;
    remainingSeconds: number;
    transferCooldownSeconds: number;
    returnProtectionSeconds: number;
    recoverySeconds: number;
};

export type MineRelaySnapshotApplyResult = {
    activeChanged: boolean;
    carrierChanged: boolean;
    newlyExplodedMask: number;
};

export const MINE_RELAY_ROUNDS: ReadonlyArray<{ triggerDistance: number; fuseSeconds: number }> = [
    { triggerDistance: 24, fuseSeconds: 8 },
    { triggerDistance: 52, fuseSeconds: 7.2 },
    { triggerDistance: 82, fuseSeconds: 6.5 },
    { triggerDistance: 112, fuseSeconds: 5.8 },
    { triggerDistance: 142, fuseSeconds: 5.2 },
    { triggerDistance: 168, fuseSeconds: 4.6 },
];

export const MINE_RELAY_TUNING = {
    transferAlongRadius: 1.25,
    transferLateralRadius: 0.9,
    transferCooldownSeconds: 0.7,
    returnProtectionSeconds: 1.1,
    lockSeconds: 0.8,
    recoverySeconds: 2,
    aiReactionSlowSeconds: 0.62,
    aiReactionFastSeconds: 0.16,
    aiAvoidAlongDistance: 4.6,
    aiAvoidLateralDistance: 3.4,
    aiAvoidOffset: 2.1,
    explosionBackwardImpulse: 1.8,
    explosionLateralImpulse: 2.85,
    explosionAxialImpulse: 5.6,
    explosionPitchImpulse: 3.25,
    explosionSoftnessLateralImpulse: 1.8,
    explosionSoftnessForwardImpulse: -0.95,
};

/**
 * 定时炸弹模式的单机／房主权威规则。访客只推进显示计时，并应用可靠事件和快照。
 * 判定使用赛道坐标中的椭圆身体胶囊，不依赖各设备的碰撞数组顺序。
 */
export class MineRelayBrawlController {
    private revision = 0;
    private completedRoundMask = 0;
    private explodedRoundMask = 0;
    private appliedExplosionMask = 0;
    private resolvedCarrierLanesPacked = 0;
    private activeArm: MineRelayArm | null = null;
    private remainingSeconds = 0;
    private transferCooldownSeconds = 0;
    private returnProtectionSeconds = 0;
    private recoverySeconds = 0;
    private previousCarrierLane = -1;
    private lastStarterLane = -1;

    constructor(
        private readonly laneCount: number,
        private readonly seed: number,
        private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => MineRelayRacerState | null,
        private readonly onArm: (event: MineRelayArm) => void,
        private readonly onTransfer: (event: MineRelayTransfer) => void,
        private readonly onResolution: (event: MineRelayResolution) => void,
    ) {}

    reset(): void {
        this.revision = 0;
        this.completedRoundMask = 0;
        this.explodedRoundMask = 0;
        this.appliedExplosionMask = 0;
        this.resolvedCarrierLanesPacked = 0;
        this.activeArm = null;
        this.remainingSeconds = 0;
        this.transferCooldownSeconds = 0;
        this.returnProtectionSeconds = 0;
        this.recoverySeconds = 0;
        this.previousCarrierLane = -1;
        this.lastStarterLane = -1;
    }

    update(dt: number, state: GameState, authoritative: boolean): void {
        if (state !== GameState.RACING) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.recoverySeconds = Math.max(0, this.recoverySeconds - step);
        if (this.activeArm) {
            this.remainingSeconds = Math.max(0, this.remainingSeconds - step);
            this.transferCooldownSeconds = Math.max(0, this.transferCooldownSeconds - step);
            this.returnProtectionSeconds = Math.max(0, this.returnProtectionSeconds - step);
            if (!authoritative) return;
            const carrier = this.racerForLane(this.activeArm.carrierLane);
            if (!carrier?.active || carrier.finished) {
                this.resolveActiveRound(false);
                return;
            }
            if (this.remainingSeconds <= 0) {
                this.resolveActiveRound(true);
                return;
            }
            if (!this.isLocked() && this.transferCooldownSeconds <= 0) {
                const nextCarrier = this.pickTransferTarget(this.activeArm.carrierLane);
                if (nextCarrier >= 0) this.transferTo(nextCarrier);
            }
            return;
        }
        if (!authoritative || this.recoverySeconds > 0 || this.activeCount() <= 1) return;
        const roundId = this.nextRoundId();
        if (roundId < 0 || this.leaderDistance() < MINE_RELAY_ROUNDS[roundId].triggerDistance) return;
        const carrierLane = this.pickStarterLane(roundId);
        if (carrierLane < 0) {
            this.completedRoundMask |= 1 << roundId;
            return;
        }
        const arm: MineRelayArm = {
            roundId,
            carrierLane,
            fuseSeconds: MINE_RELAY_ROUNDS[roundId].fuseSeconds,
            revision: this.revision + 1,
        };
        this.applyArm(arm);
        this.onArm(arm);
    }

    applyArm(event: MineRelayArm): boolean {
        if (!isValidArm(event) || event.roundId >= MINE_RELAY_ROUNDS.length
            || event.carrierLane >= this.laneCount || event.revision <= this.revision
            || (this.completedRoundMask & (1 << event.roundId)) !== 0) return false;
        this.revision = event.revision;
        this.activeArm = { ...event };
        this.remainingSeconds = event.fuseSeconds;
        this.transferCooldownSeconds = MINE_RELAY_TUNING.transferCooldownSeconds;
        this.returnProtectionSeconds = 0;
        this.previousCarrierLane = -1;
        this.lastStarterLane = event.carrierLane;
        return true;
    }

    applyTransfer(event: MineRelayTransfer): boolean {
        if (!isValidTransfer(event) || event.revision <= this.revision
            || event.toLane >= this.laneCount || event.fromLane >= this.laneCount
            || this.activeArm?.roundId !== event.roundId
            || this.activeArm.carrierLane !== event.fromLane
            || event.remainingSeconds <= MINE_RELAY_TUNING.lockSeconds) return false;
        this.revision = event.revision;
        this.previousCarrierLane = event.fromLane;
        this.activeArm = { ...this.activeArm, carrierLane: event.toLane, revision: event.revision };
        this.remainingSeconds = event.remainingSeconds;
        this.transferCooldownSeconds = MINE_RELAY_TUNING.transferCooldownSeconds;
        this.returnProtectionSeconds = MINE_RELAY_TUNING.returnProtectionSeconds;
        return true;
    }

    applyResolution(event: MineRelayResolution): boolean {
        const bit = 1 << event.roundId;
        if (!isValidResolution(event) || event.roundId >= MINE_RELAY_ROUNDS.length
            || event.carrierLane >= this.laneCount || event.revision < this.revision
            || (event.exploded
                ? (this.appliedExplosionMask & bit) !== 0
                : (this.completedRoundMask & bit) !== 0)) return false;
        if (this.activeArm && this.activeArm.roundId !== event.roundId) return false;
        this.revision = Math.max(this.revision, event.revision);
        this.completedRoundMask |= bit;
        this.resolvedCarrierLanesPacked = writePackedLane(
            this.resolvedCarrierLanesPacked, event.roundId, event.carrierLane,
        );
        if (event.exploded) {
            this.explodedRoundMask |= bit;
            this.appliedExplosionMask |= bit;
        }
        this.activeArm = null;
        this.remainingSeconds = 0;
        this.transferCooldownSeconds = 0;
        this.returnProtectionSeconds = 0;
        this.previousCarrierLane = -1;
        this.recoverySeconds = MINE_RELAY_TUNING.recoverySeconds;
        return true;
    }

    applySnapshotState(state: MineRelayState): MineRelaySnapshotApplyResult {
        if (!isValidState(state) || state.revision < this.revision) {
            return { activeChanged: false, carrierChanged: false, newlyExplodedMask: 0 };
        }
        const previousRound = this.activeArm?.roundId ?? -1;
        const previousCarrier = this.activeArm?.carrierLane ?? -1;
        const previousRemaining = this.remainingSeconds;
        const previousTransferCooldown = this.transferCooldownSeconds;
        const previousReturnProtection = this.returnProtectionSeconds;
        const previousRecovery = this.recoverySeconds;
        const sameRevision = state.revision === this.revision;
        const newlyExplodedMask = state.explodedRoundMask & ~this.appliedExplosionMask;
        this.revision = state.revision;
        this.completedRoundMask |= state.completedRoundMask;
        this.explodedRoundMask |= state.explodedRoundMask;
        this.resolvedCarrierLanesPacked = state.resolvedCarrierLanesPacked;
        this.appliedExplosionMask |= state.explodedRoundMask;
        this.previousCarrierLane = state.previousCarrierLane;
        this.lastStarterLane = state.lastStarterLane;
        this.transferCooldownSeconds = sameRevision
            ? Math.min(previousTransferCooldown, state.transferCooldownSeconds)
            : state.transferCooldownSeconds;
        this.returnProtectionSeconds = sameRevision
            ? Math.min(previousReturnProtection, state.returnProtectionSeconds)
            : state.returnProtectionSeconds;
        this.recoverySeconds = sameRevision
            ? Math.min(previousRecovery, state.recoverySeconds)
            : state.recoverySeconds;
        if (state.activeRoundId >= 0 && state.activeRoundId < MINE_RELAY_ROUNDS.length
            && state.carrierLane >= 0 && state.carrierLane < this.laneCount
            && (this.completedRoundMask & (1 << state.activeRoundId)) === 0) {
            this.activeArm = {
                roundId: state.activeRoundId,
                carrierLane: state.carrierLane,
                fuseSeconds: MINE_RELAY_ROUNDS[state.activeRoundId].fuseSeconds,
                revision: state.revision,
            };
            this.remainingSeconds = sameRevision
                && previousRound === state.activeRoundId
                && previousCarrier === state.carrierLane
                ? Math.min(previousRemaining, state.remainingSeconds)
                : state.remainingSeconds;
        } else {
            this.activeArm = null;
            this.remainingSeconds = 0;
        }
        return {
            activeChanged: previousRound !== (this.activeArm?.roundId ?? -1),
            carrierChanged: previousCarrier !== (this.activeArm?.carrierLane ?? -1),
            newlyExplodedMask,
        };
    }

    snapshotState(): MineRelayState {
        return {
            revision: this.revision,
            completedRoundMask: this.completedRoundMask >>> 0,
            explodedRoundMask: this.explodedRoundMask >>> 0,
            resolvedCarrierLanesPacked: this.resolvedCarrierLanesPacked >>> 0,
            activeRoundId: this.activeArm?.roundId ?? -1,
            carrierLane: this.activeArm?.carrierLane ?? -1,
            previousCarrierLane: this.previousCarrierLane,
            lastStarterLane: this.lastStarterLane,
            remainingSeconds: this.activeArm ? this.remainingSeconds : 0,
            transferCooldownSeconds: this.transferCooldownSeconds,
            returnProtectionSeconds: this.returnProtectionSeconds,
            recoverySeconds: this.recoverySeconds,
        };
    }

    currentArm(): MineRelayArm | null { return this.activeArm; }
    currentCarrierLane(): number { return this.activeArm?.carrierLane ?? -1; }
    currentRemainingSeconds(): number { return this.remainingSeconds; }
    isLocked(): boolean { return !!this.activeArm && this.remainingSeconds <= MINE_RELAY_TUNING.lockSeconds; }
    completedRoundCount(): number { return countBits(this.completedRoundMask, MINE_RELAY_ROUNDS.length); }
    remainingRoundCount(): number { return Math.max(0, MINE_RELAY_ROUNDS.length - this.completedRoundCount()); }
    resolvedCarrierLane(roundId: number): number {
        return roundId >= 0 && roundId < MINE_RELAY_ROUNDS.length
            ? readPackedLane(this.resolvedCarrierLanesPacked, roundId)
            : -1;
    }

    targetZForAi(lane: number, discipline: number): number | null {
        if (lane < 0 || lane >= this.laneCount) return null;
        const arm = this.activeArm;
        const racer = this.racerForLane(lane);
        if (!arm || !racer?.active || racer.finished || this.isLocked()) return null;
        const elapsed = MINE_RELAY_ROUNDS[arm.roundId].fuseSeconds - this.remainingSeconds;
        const clampedDiscipline = clamp(discipline, 0, 1);
        const reaction = MINE_RELAY_TUNING.aiReactionSlowSeconds
            + (MINE_RELAY_TUNING.aiReactionFastSeconds - MINE_RELAY_TUNING.aiReactionSlowSeconds) * clampedDiscipline;
        if (elapsed < reaction) return null;
        const halfWidth = Math.max(0.8, this.poolWidth * 0.5 - 0.7);
        const carrier = this.racerForLane(arm.carrierLane);
        if (!carrier) return null;
        if (lane === arm.carrierLane) {
            const target = this.nearestPassTarget(lane);
            return target >= 0 ? clamp(this.racerForLane(target)!.lateral, -halfWidth, halfWidth) : null;
        }
        if (Math.abs(racer.distance - carrier.distance) > MINE_RELAY_TUNING.aiAvoidAlongDistance
            || Math.abs(racer.lateral - carrier.lateral) > MINE_RELAY_TUNING.aiAvoidLateralDistance) return null;
        const direction = racer.lateral === carrier.lateral
            ? (lane & 1 ? 1 : -1)
            : Math.sign(racer.lateral - carrier.lateral);
        return clamp(carrier.lateral + direction * MINE_RELAY_TUNING.aiAvoidOffset, -halfWidth, halfWidth);
    }

    private transferTo(toLane: number): void {
        const arm = this.activeArm;
        if (!arm) return;
        const event: MineRelayTransfer = {
            roundId: arm.roundId,
            fromLane: arm.carrierLane,
            toLane,
            remainingSeconds: this.remainingSeconds,
            revision: this.revision + 1,
        };
        if (this.applyTransfer(event)) this.onTransfer(event);
    }

    private resolveActiveRound(exploded: boolean): void {
        const arm = this.activeArm;
        if (!arm) return;
        const event: MineRelayResolution = {
            roundId: arm.roundId,
            carrierLane: arm.carrierLane,
            exploded,
            distance: Math.max(0, this.racerForLane(arm.carrierLane)?.distance ?? 0),
            revision: this.revision + 1,
        };
        if (this.applyResolution(event)) this.onResolution(event);
    }

    private pickTransferTarget(carrierLane: number): number {
        const carrier = this.racerForLane(carrierLane);
        if (!carrier) return -1;
        let bestLane = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (lane === carrierLane || !this.isEligibleLane(lane)) continue;
            if (lane === this.previousCarrierLane && this.returnProtectionSeconds > 0) continue;
            const racer = this.racerForLane(lane)!;
            const normalized = ellipseDistanceSquared(
                racer.distance - carrier.distance,
                racer.lateral - carrier.lateral,
                MINE_RELAY_TUNING.transferAlongRadius,
                MINE_RELAY_TUNING.transferLateralRadius,
            );
            if (normalized > 1) continue;
            if (normalized < bestDistance || (normalized === bestDistance && lane < bestLane)) {
                bestDistance = normalized;
                bestLane = lane;
            }
        }
        return bestLane;
    }

    private nearestPassTarget(carrierLane: number): number {
        const carrier = this.racerForLane(carrierLane);
        if (!carrier) return -1;
        let bestLane = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (lane === carrierLane || !this.isEligibleLane(lane)) continue;
            if (lane === this.previousCarrierLane && this.returnProtectionSeconds > 0) continue;
            const racer = this.racerForLane(lane)!;
            const along = racer.distance - carrier.distance;
            const lateral = racer.lateral - carrier.lateral;
            const distance = along * along + lateral * lateral;
            if (distance < bestDistance || (distance === bestDistance && lane < bestLane)) {
                bestDistance = distance;
                bestLane = lane;
            }
        }
        return bestLane;
    }

    private pickStarterLane(roundId: number): number {
        let candidates = 0;
        const skipLast = this.activeCount() > 1 && this.lastStarterLane >= 0;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (skipLast && lane === this.lastStarterLane) continue;
            if (this.isEligibleLane(lane)) candidates++;
        }
        if (candidates <= 0) return skipLast && this.isEligibleLane(this.lastStarterLane) ? this.lastStarterLane : -1;
        let pick = this.randomForRound(roundId).int(candidates);
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (skipLast && lane === this.lastStarterLane) continue;
            if (!this.isEligibleLane(lane)) continue;
            if (pick-- === 0) return lane;
        }
        return -1;
    }

    private nextRoundId(): number {
        for (let id = 0; id < MINE_RELAY_ROUNDS.length; id++) {
            if ((this.completedRoundMask & (1 << id)) === 0) return id;
        }
        return -1;
    }

    private leaderDistance(): number {
        let leader = 0;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (this.isEligibleLane(lane)) leader = Math.max(leader, this.racerForLane(lane)!.distance);
        }
        return leader;
    }

    private activeCount(): number {
        let count = 0;
        for (let lane = 0; lane < this.laneCount; lane++) if (this.isEligibleLane(lane)) count++;
        return count;
    }

    private isEligibleLane(lane: number): boolean {
        const racer = this.racerForLane(lane);
        return lane >= 0 && lane < this.laneCount && !!racer?.active && !racer.finished
            && Number.isFinite(racer.distance) && Number.isFinite(racer.lateral);
    }

    private randomForRound(roundId: number): SeededRandom {
        return new SeededRandom((this.seed ^ Math.imul(roundId + 1, 0x45d9f3b)) >>> 0);
    }
}

function ellipseDistanceSquared(along: number, lateral: number, alongRadius: number, lateralRadius: number): number {
    const x = along / Math.max(0.01, alongRadius);
    const z = lateral / Math.max(0.01, lateralRadius);
    return x * x + z * z;
}

function countBits(mask: number, length: number): number {
    let count = 0;
    for (let i = 0; i < length; i++) if ((mask & (1 << i)) !== 0) count++;
    return count;
}

function writePackedLane(packed: number, roundId: number, lane: number): number {
    const shift = roundId * 4;
    const clearMask = ~(0xf << shift);
    return ((packed & clearMask) | ((lane + 1) << shift)) >>> 0;
}

function readPackedLane(packed: number, roundId: number): number {
    return ((packed >>> (roundId * 4)) & 0xf) - 1;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function isValidArm(event: MineRelayArm): boolean {
    return !!event
        && Number.isSafeInteger(event.roundId) && event.roundId >= 0
        && Number.isSafeInteger(event.carrierLane) && event.carrierLane >= 0
        && Number.isFinite(event.fuseSeconds) && event.fuseSeconds > 0
        && Number.isSafeInteger(event.revision) && event.revision >= 0;
}

function isValidTransfer(event: MineRelayTransfer): boolean {
    return !!event
        && Number.isSafeInteger(event.roundId) && event.roundId >= 0
        && Number.isSafeInteger(event.fromLane) && event.fromLane >= 0
        && Number.isSafeInteger(event.toLane) && event.toLane >= 0 && event.toLane !== event.fromLane
        && Number.isFinite(event.remainingSeconds) && event.remainingSeconds >= 0
        && Number.isSafeInteger(event.revision) && event.revision >= 0;
}

function isValidResolution(event: MineRelayResolution): boolean {
    return !!event
        && Number.isSafeInteger(event.roundId) && event.roundId >= 0
        && Number.isSafeInteger(event.carrierLane) && event.carrierLane >= 0
        && typeof event.exploded === 'boolean'
        && Number.isFinite(event.distance) && event.distance >= 0
        && Number.isSafeInteger(event.revision) && event.revision >= 0;
}

function isValidState(state: MineRelayState): boolean {
    return !!state
        && Number.isSafeInteger(state.revision) && state.revision >= 0
        && Number.isSafeInteger(state.completedRoundMask) && state.completedRoundMask >= 0
        && Number.isSafeInteger(state.explodedRoundMask) && state.explodedRoundMask >= 0
        && Number.isSafeInteger(state.resolvedCarrierLanesPacked) && state.resolvedCarrierLanesPacked >= 0
        && Number.isSafeInteger(state.activeRoundId) && state.activeRoundId >= -1
        && Number.isSafeInteger(state.carrierLane) && state.carrierLane >= -1
        && Number.isSafeInteger(state.previousCarrierLane) && state.previousCarrierLane >= -1
        && Number.isSafeInteger(state.lastStarterLane) && state.lastStarterLane >= -1
        && Number.isFinite(state.remainingSeconds) && state.remainingSeconds >= 0
        && Number.isFinite(state.transferCooldownSeconds) && state.transferCooldownSeconds >= 0
        && Number.isFinite(state.returnProtectionSeconds) && state.returnProtectionSeconds >= 0
        && Number.isFinite(state.recoverySeconds) && state.recoverySeconds >= 0;
}
