import { GameState } from '../core/GameConstants';
import {
    expandedEllipseContains,
    expandedEllipseDistanceSquared,
    segmentHitsExpandedEllipse,
} from './RaceContactGeometry';
import { SeededRandom } from '../core/SharedRNG';

export type MineRelayRacerState = {
    active: boolean;
    /** 临时受控／恢复保护不是离场；携带者保留水球并暂停，其他人不可接球。 */
    recovering?: boolean;
    speed?: number;
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
    lateral: number;
    hitMask: number;
    revision: number;
};

import { MINE_RELAY_TUNING } from '../core/EntertainmentBalance';
export { MINE_RELAY_TUNING } from '../core/EntertainmentBalance';

export const MINE_RELAY_ROUNDS: ReadonlyArray<{ triggerDistance: number; fuseSeconds: number }> = [
    { triggerDistance: 24, fuseSeconds: 8 },
    { triggerDistance: 52, fuseSeconds: 7.2 },
    { triggerDistance: 82, fuseSeconds: 6.5 },
    { triggerDistance: 112, fuseSeconds: 5.8 },
    { triggerDistance: 142, fuseSeconds: 5.2 },
    { triggerDistance: 168, fuseSeconds: 4.6 },
];

/** 本地水球接力规则；接触、短传和发放沿用来源，网络账本另行接入。 */
export class MineRelayBrawlController {
    private revision = 0;
    private completedRoundMask = 0;
    private activeArm: MineRelayArm | null = null;
    private armedRoundCount = 0;
    private remainingSeconds = 0;
    private paused = false;
    private transferCooldownSeconds = 0;
    private returnProtectionSeconds = 0;
    private recoverySeconds = 0;
    private previousCarrierLane = -1;
    private lastStarterLane = -1;
    private assistedPassTargetLane = -1;
    private assistedPassSeconds = 0;
    private readonly previousRacerWorldX: number[];
    private readonly previousRacerLateral: number[];

    constructor(
        private readonly laneCount: number,
        private readonly seed: number,
        private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => MineRelayRacerState | null,
        private readonly onArm: (event: MineRelayArm) => void,
        private readonly onTransfer: (event: MineRelayTransfer) => void,
        private readonly onResolution: (event: MineRelayResolution) => void,
        private rounds: ReadonlyArray<{ triggerDistance: number; fuseSeconds: number }> = MINE_RELAY_ROUNDS,
        private readonly hasPhysicalContact: ((laneA: number, laneB: number) => boolean) | null = null,
        private readonly distanceToWorldX: (distance: number) => number = distance => distance,
        private readonly directionAtDistance: (distance: number) => number = () => 1,
    ) {
        this.previousRacerWorldX = new Array(laneCount).fill(Number.NaN);
        this.previousRacerLateral = new Array(laneCount).fill(Number.NaN);
    }

    reset(): void {
        this.paused = false;
        this.revision = 0;
        this.completedRoundMask = 0;
        this.activeArm = null;
        this.armedRoundCount = 0;
        this.remainingSeconds = 0;
        this.transferCooldownSeconds = 0;
        this.returnProtectionSeconds = 0;
        this.recoverySeconds = 0;
        this.previousCarrierLane = -1;
        this.lastStarterLane = -1;
        this.resetAssistedPass();
        this.previousRacerWorldX.fill(Number.NaN);
        this.previousRacerLateral.fill(Number.NaN);
    }

    restart(rounds: ReadonlyArray<{ triggerDistance: number; fuseSeconds: number }> = this.rounds): void {
        this.rounds = rounds;
        this.reset();
    }

    /** 首位完赛取消后续轮次；已发放水球继续结算。 */
    cancelPendingRoundsAfterCurrent(): boolean {
        const roundMask = this.rounds.length >= 31
            ? 0x7fffffff
            : (1 << this.rounds.length) - 1;
        const activeBit = this.activeArm ? 1 << this.activeArm.roundId : 0;
        const nextCompletedMask = (this.completedRoundMask | (roundMask & ~activeBit)) >>> 0;
        if (nextCompletedMask === this.completedRoundMask) return false;
        this.completedRoundMask = nextCompletedMask;
        this.revision++;
        return true;
    }

    update(dt: number, state: GameState = GameState.RACING): void {
        if (state !== GameState.RACING) {
            this.previousRacerWorldX.fill(Number.NaN);
            this.previousRacerLateral.fill(Number.NaN);
            return;
        }
        try {
            const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
            this.recoverySeconds = Math.max(0, this.recoverySeconds - step);
            if (this.activeArm) {
                const carrier = this.racerForLane(this.activeArm.carrierLane);
                if (!carrier?.active || carrier.finished) {
                    this.resolveActiveRound(false);
                    return;
                }
                const paused = carrier.recovering === true;
                if (paused !== this.paused) {
                    this.paused = paused;
                    this.revision++;
                    this.resetAssistedPass();
                    if (!paused) this.transferCooldownSeconds = Math.max(this.transferCooldownSeconds,
                        MINE_RELAY_TUNING.initialTransferCooldownSeconds);
                }
                if (this.paused) return;
                const cooldownBeforeStep = this.transferCooldownSeconds;
                this.remainingSeconds = Math.max(0, this.remainingSeconds - step);
                this.transferCooldownSeconds = Math.max(0, this.transferCooldownSeconds - step);
                this.returnProtectionSeconds = Math.max(0, this.returnProtectionSeconds - step);
                if (this.remainingSeconds <= 0) {
                    this.resolveActiveRound(true);
                    return;
                }
                if (!this.isLocked() && this.transferCooldownSeconds <= 0) {
                    const nextCarrier = this.pickPhysicalContactTarget(this.activeArm.carrierLane)
                        ?? this.pickTransferTarget(this.activeArm.carrierLane);
                    if (nextCarrier >= 0) {
                        this.resetAssistedPass();
                        this.transferTo(nextCarrier);
                    } else {
                        const assistedTarget = this.pickAssistedPassTarget(this.activeArm.carrierLane);
                        const availableStep = Math.max(0, step - cooldownBeforeStep);
                        if (assistedTarget !== this.assistedPassTargetLane) {
                            this.assistedPassTargetLane = assistedTarget;
                            this.assistedPassSeconds = 0;
                        } else if (assistedTarget >= 0) {
                            this.assistedPassSeconds += availableStep;
                        }
                        if (assistedTarget >= 0
                            && this.assistedPassSeconds >= MINE_RELAY_TUNING.assistedPassConfirmSeconds) {
                            this.resetAssistedPass();
                            this.transferTo(assistedTarget);
                        }
                    }
                } else {
                    this.resetAssistedPass();
                }
                return;
            }
            if (this.recoverySeconds > 0 || this.activeCount() <= 1) return;
            const roundId = this.nextRoundId();
            if (roundId < 0 || this.leaderDistance() < this.rounds[roundId].triggerDistance) return;
            const carrierLane = this.pickStarterLane(roundId);
            if (carrierLane < 0) {
                this.completedRoundMask |= 1 << roundId;
                this.revision++;
                return;
            }
            const arm: MineRelayArm = {
                roundId,
                carrierLane,
                fuseSeconds: this.rounds[roundId].fuseSeconds,
                revision: this.revision + 1,
            };
            this.applyArm(arm);
            this.onArm(arm);
        } finally {
            this.rememberRacerPositions();
        }
    }

    private applyArm(event: MineRelayArm): void {
        this.revision = event.revision;
        this.activeArm = event;
        this.paused = false;
        this.armedRoundCount++;
        this.remainingSeconds = event.fuseSeconds;
        this.transferCooldownSeconds = MINE_RELAY_TUNING.initialTransferCooldownSeconds;
        this.returnProtectionSeconds = 0;
        this.previousCarrierLane = -1;
        this.lastStarterLane = event.carrierLane;
        this.resetAssistedPass();
    }
    private applyTransfer(event: MineRelayTransfer): void {
        this.revision = event.revision;
        this.previousCarrierLane = event.fromLane;
        this.activeArm = { ...this.activeArm!, carrierLane: event.toLane, revision: event.revision };
        this.paused = false;
        this.remainingSeconds = event.remainingSeconds;
        this.transferCooldownSeconds = MINE_RELAY_TUNING.transferCooldownSeconds;
        this.returnProtectionSeconds = MINE_RELAY_TUNING.returnProtectionSeconds;
        this.resetAssistedPass();
    }
    private applyResolution(event: MineRelayResolution): void {
        this.revision = event.revision;
        this.completedRoundMask |= 1 << event.roundId;
        this.activeArm = null;
        this.paused = false;
        this.remainingSeconds = this.transferCooldownSeconds = this.returnProtectionSeconds = 0;
        this.previousCarrierLane = -1;
        this.recoverySeconds = MINE_RELAY_TUNING.recoverySeconds;
        this.resetAssistedPass();
    }
    currentArm(): MineRelayArm | null { return this.activeArm; }
    currentCarrierLane(): number { return this.activeArm?.carrierLane ?? -1; }
    currentRemainingSeconds(): number { return this.remainingSeconds; }
    startedRoundCount(): number { return this.armedRoundCount; }
    isLocked(): boolean { return !!this.activeArm && this.remainingSeconds <= MINE_RELAY_TUNING.lockSeconds; }

    isPaused(): boolean { return !!this.activeArm && this.paused; }
    completedRoundCount(): number { return countBits(this.completedRoundMask, this.rounds.length); }
    remainingRoundCount(): number { return Math.max(0, this.rounds.length - this.completedRoundCount()); }
    targetZForAi(lane: number, discipline: number): number | null {
        if (lane < 0 || lane >= this.laneCount) return null;
        const arm = this.activeArm;
        const racer = this.racerForLane(lane);
        if (!arm || !racer?.active || racer.finished || racer.recovering || this.paused || this.isLocked()) return null;
        const elapsed = this.rounds[arm.roundId].fuseSeconds - this.remainingSeconds;
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
        // 刚发放或刚完成交接时给新携带者一个可读、可接近的窗口，避免附近 AI 立即同步散开。
        if (this.transferCooldownSeconds > 0) return null;
        if (Math.abs(this.distanceToWorldX(racer.distance) - this.distanceToWorldX(carrier.distance)) > MINE_RELAY_TUNING.aiAvoidAlongDistance
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
        this.applyTransfer(event); this.onTransfer(event);
    }

    private resolveActiveRound(exploded: boolean): void {
        const arm = this.activeArm;
        if (!arm) return;
        const carrier = this.racerForLane(arm.carrierLane);
        const event: MineRelayResolution = {
            roundId: arm.roundId,
            carrierLane: arm.carrierLane,
            exploded,
            distance: Math.max(0, carrier?.distance ?? 0),
            lateral: carrier?.lateral ?? 0,
            hitMask: exploded ? this.blastHitMask(arm.carrierLane) : 0,
            revision: this.revision + 1,
        };
        this.applyResolution(event); this.onResolution(event);
    }

    private blastHitMask(carrierLane: number): number {
        const carrier = this.racerForLane(carrierLane);
        if (!carrier) return 1 << carrierLane;
        let mask = 0;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (!this.isEligibleLane(lane)) continue;
            const racer = this.racerForLane(lane)!;
            if (ellipseDistanceSquared(
                this.distanceToWorldX(racer.distance) - this.distanceToWorldX(carrier.distance),
                racer.lateral - carrier.lateral,
                MINE_RELAY_TUNING.blastAlongRadius,
                MINE_RELAY_TUNING.blastLateralRadius,
            ) <= 1) mask |= 1 << lane;
        }
        return (mask | (1 << carrierLane)) >>> 0;
    }

    private pickTransferTarget(carrierLane: number): number {
        const carrier = this.racerForLane(carrierLane);
        if (!carrier) return -1;
        const previousCarrierWorldX = this.previousRacerWorldX[carrierLane];
        const previousCarrierLateral = this.previousRacerLateral[carrierLane];
        let bestLane = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (lane === carrierLane || !this.isEligibleLane(lane)) continue;
            if (lane === this.previousCarrierLane && this.returnProtectionSeconds > 0) continue;
            const racer = this.racerForLane(lane)!;
            const along = this.distanceToWorldX(racer.distance) - this.distanceToWorldX(carrier.distance);
            const lateral = racer.lateral - carrier.lateral;
            const inside = expandedEllipseContains(
                along, lateral, 0, 0,
                MINE_RELAY_TUNING.transferBodyAlongRadius,
                MINE_RELAY_TUNING.transferBodyLateralRadius,
                MINE_RELAY_TUNING.transferBodyAlongRadius,
                MINE_RELAY_TUNING.transferBodyLateralRadius,
            );
            const previousAlong = this.previousRacerWorldX[lane] - previousCarrierWorldX;
            const previousLateral = this.previousRacerLateral[lane] - previousCarrierLateral;
            const relativeSweepAlong = along - previousAlong;
            const relativeSweepLateral = lateral - previousLateral;
            const maxSweep = MINE_RELAY_TUNING.transferMaxSweepDistance;
            const canSweep = Number.isFinite(previousAlong) && Number.isFinite(previousLateral)
                && relativeSweepAlong * relativeSweepAlong + relativeSweepLateral * relativeSweepLateral
                    <= maxSweep * maxSweep;
            const swept = canSweep && segmentHitsExpandedEllipse(
                previousAlong, previousLateral, along, lateral, 0, 0,
                MINE_RELAY_TUNING.transferBodyAlongRadius,
                MINE_RELAY_TUNING.transferBodyLateralRadius,
                MINE_RELAY_TUNING.transferBodyAlongRadius,
                MINE_RELAY_TUNING.transferBodyLateralRadius,
            );
            if (!inside && !swept) continue;
            const normalized = inside ? expandedEllipseDistanceSquared(
                along, lateral, 0, 0,
                MINE_RELAY_TUNING.transferBodyAlongRadius,
                MINE_RELAY_TUNING.transferBodyLateralRadius,
                MINE_RELAY_TUNING.transferBodyAlongRadius,
                MINE_RELAY_TUNING.transferBodyLateralRadius,
            ) : 1;
            if (normalized < bestDistance || (normalized === bestDistance && lane < bestLane)) {
                bestDistance = normalized;
                bestLane = lane;
            }
        }
        return bestLane;
    }

    private pickPhysicalContactTarget(carrierLane: number): number | null {
        if (!this.hasPhysicalContact) return null;
        const carrier = this.racerForLane(carrierLane);
        if (!carrier) return null;
        let bestLane = -1;
        let bestDistanceSq = Number.POSITIVE_INFINITY;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (lane === carrierLane || !this.isEligibleLane(lane)) continue;
            if (lane === this.previousCarrierLane && this.returnProtectionSeconds > 0) continue;
            if (!this.hasPhysicalContact(carrierLane, lane)) continue;
            const racer = this.racerForLane(lane)!;
            const along = this.distanceToWorldX(racer.distance) - this.distanceToWorldX(carrier.distance);
            const lateral = racer.lateral - carrier.lateral;
            const distanceSq = along * along + lateral * lateral;
            if (distanceSq < bestDistanceSq || (distanceSq === bestDistanceSq && lane < bestLane)) {
                bestDistanceSq = distanceSq;
                bestLane = lane;
            }
        }
        return bestLane >= 0 ? bestLane : null;
    }

    private pickAssistedPassTarget(carrierLane: number): number {
        const carrier = this.racerForLane(carrierLane);
        if (!carrier) return -1;
        let bestLane = -1;
        let bestScore = Number.POSITIVE_INFINITY;
        const minAhead = Math.max(0, MINE_RELAY_TUNING.assistedPassMinAheadDistance);
        const maxAhead = Math.max(0.01, MINE_RELAY_TUNING.assistedPassMaxAheadDistance);
        const maxLateral = Math.max(0.01, MINE_RELAY_TUNING.assistedPassLateralDistance);
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (lane === carrierLane || !this.isEligibleLane(lane)) continue;
            if (lane === this.previousCarrierLane && this.returnProtectionSeconds > 0) continue;
            const racer = this.racerForLane(lane)!;
            // 短传只交给同向且位于身体前方的人；贴身接触仍允许迎面交接。
            const direction = this.directionAtDistance(carrier.distance);
            if (this.directionAtDistance(racer.distance) !== direction) continue;
            const ahead = (this.distanceToWorldX(racer.distance) - this.distanceToWorldX(carrier.distance)) * direction;
            const lateral = Math.abs(racer.lateral - carrier.lateral);
            if (ahead < minAhead
                || ahead > maxAhead || lateral > maxLateral) continue;
            const normalizedAhead = ahead / maxAhead;
            const normalizedLateral = lateral / maxLateral;
            const score = normalizedAhead * normalizedAhead + normalizedLateral * normalizedLateral;
            if (score < bestScore || (score === bestScore && lane < bestLane)) {
                bestScore = score;
                bestLane = lane;
            }
        }
        return bestLane;
    }

    private resetAssistedPass(): void {
        this.assistedPassTargetLane = -1;
        this.assistedPassSeconds = 0;
    }

    private rememberRacerPositions(): void {
        for (let lane = 0; lane < this.laneCount; lane++) {
            const racer = this.racerForLane(lane);
            this.previousRacerWorldX[lane] = racer?.active && !racer.finished
                ? this.distanceToWorldX(racer.distance)
                : Number.NaN;
            this.previousRacerLateral[lane] = racer?.active && !racer.finished
                ? racer.lateral
                : Number.NaN;
        }
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
            const along = this.distanceToWorldX(racer.distance) - this.distanceToWorldX(carrier.distance);
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
        const skipLast = this.activeCount() > 1 && this.lastStarterLane >= 0;
        const candidates = this.countStarterCandidates(skipLast, true);
        if (candidates <= 0) return skipLast && this.isEligibleLane(this.lastStarterLane)
            && this.hasNearbyStarterTarget(this.lastStarterLane) ? this.lastStarterLane : -1;
        let pick = this.randomForRound(roundId).int(candidates);
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (skipLast && lane === this.lastStarterLane) continue;
            if (!this.isEligibleLane(lane)) continue;
            if (!this.hasNearbyStarterTarget(lane)) continue;
            if (pick-- === 0) return lane;
        }
        return -1;
    }

    private countStarterCandidates(skipLast: boolean, requireNearbyTarget: boolean): number {
        let count = 0;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (skipLast && lane === this.lastStarterLane) continue;
            if (!this.isEligibleLane(lane)) continue;
            if (requireNearbyTarget && !this.hasNearbyStarterTarget(lane)) continue;
            count++;
        }
        return count;
    }

    private hasNearbyStarterTarget(carrierLane: number): boolean {
        const carrier = this.racerForLane(carrierLane);
        if (!carrier) return false;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (lane === carrierLane || !this.isEligibleLane(lane)) continue;
            const racer = this.racerForLane(lane)!;
            if (Math.abs(this.distanceToWorldX(racer.distance) - this.distanceToWorldX(carrier.distance)) <= MINE_RELAY_TUNING.starterNearbyAlongDistance
                && Math.abs(racer.lateral - carrier.lateral) <= MINE_RELAY_TUNING.starterNearbyLateralDistance
                && this.starterCanApproach(carrier, racer)) {
                return true;
            }
        }
        return false;
    }

    /** 发放前的保守接近估计；不扩大实际传球范围，不在比赛热路径建立轨迹数组。 */
    private starterCanApproach(carrier: MineRelayRacerState, target: MineRelayRacerState): boolean {
        if (!Number.isFinite(carrier.speed) || !Number.isFinite(target.speed)) return true;
        const direction = this.directionAtDistance(carrier.distance);
        const targetDirection = this.directionAtDistance(target.distance);
        const x = this.distanceToWorldX(carrier.distance);
        const scale = Math.max(0.01, Math.abs(this.distanceToWorldX(carrier.distance + 0.01) - x) / 0.01);
        const relativeX = (this.distanceToWorldX(target.distance) - x) * direction;
        const relativeSpeed = ((target.speed ?? 0) * targetDirection * direction - (carrier.speed ?? 0)) * scale;
        const round = this.rounds[this.nextRoundId()];
        const available = Math.max(0, (round?.fuseSeconds ?? 0) - MINE_RELAY_TUNING.lockSeconds
            - MINE_RELAY_TUNING.initialTransferCooldownSeconds - MINE_RELAY_TUNING.assistedPassConfirmSeconds);
        for (let time = 0; time <= available; time += 0.25) {
            const ahead = relativeX + relativeSpeed * time;
            const alongReachable = direction === targetDirection
                ? ahead >= -MINE_RELAY_TUNING.transferBodyAlongRadius * 2
                    && ahead <= MINE_RELAY_TUNING.assistedPassMaxAheadDistance
                : Math.abs(ahead) <= MINE_RELAY_TUNING.transferBodyAlongRadius * 2;
            const lateralReach = MINE_RELAY_TUNING.assistedPassLateralDistance
                + Math.max(0.4, (carrier.speed ?? 0) * scale * 0.35) * time;
            if (alongReachable && Math.abs(target.lateral - carrier.lateral) <= lateralReach) return true;
        }
        return false;
    }

    private nextRoundId(): number {
        for (let id = 0; id < this.rounds.length; id++) {
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

    activeCount(): number {
        let count = 0;
        for (let lane = 0; lane < this.laneCount; lane++) if (this.isEligibleLane(lane)) count++;
        return count;
    }

    private isEligibleLane(lane: number): boolean {
        const racer = this.racerForLane(lane);
        return lane >= 0 && lane < this.laneCount && !!racer?.active && !racer.finished
            && !racer.recovering
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

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
