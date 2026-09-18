import { GameState } from './GameConstants';
import { SeededRandom } from './SharedRNG';

export type CannonRacerState = {
    active: boolean;
    finished: boolean;
    damageable: boolean;
    distance: number;
    lateral: number;
    speed: number;
};

export type CannonLaunch = {
    strikeId: number;
    targetDistance: number;
    targetZ: number;
    warningSeconds: number;
    revision: number;
};

export type CannonImpact = {
    strikeId: number;
    hitMask: number;
    knockedLane: number;
    knockedDistance: number;
    revision: number;
};

export type CannonBrawlState = {
    revision: number;
    completedStrikeMask: number;
    activeStrikeId: number;
    targetDistance: number;
    targetZ: number;
    remainingSeconds: number;
};

export type CannonSnapshotApplyResult = {
    activeChanged: boolean;
};

export const CANNON_STRIKE_TRIGGERS: readonly number[] = [
    25, 48,
    70, 82,
    104, 116,
    138, 148, 158, 170,
] as const;

export const CANNON_BRAWL_TUNING = {
    warningSeconds: 1.25,
    coreAlongRadius: 1.05,
    coreLateralRadius: 0.82,
    splashAlongRadius: 3.4,
    splashLateralRadius: 2.85,
    targetLeadMinimum: 1.7,
    targetLeadMaximum: 5.2,
    finishSafeDistance: 180,
    aiSafetyMargin: 0.7,
};

/**
 * 炮火逃生赛的单机／房主权威规则。访客只应用可靠事件及快照，不自行决定落点或命中。
 * 所有随机只来自本玩法基于房主种子的独立 SeededRandom，不消耗其他系统的共享随机流。
 */
export class CannonBrawlController {
    private revision = 0;
    private completedStrikeMask = 0;
    private appliedImpactMask = 0;
    private activeLaunch: CannonLaunch | null = null;
    private activeRemainingSeconds = 0;
    private lastTargetLane = -1;

    constructor(
        private readonly laneCount: number,
        private readonly seed: number,
        private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => CannonRacerState | null,
        private readonly onLaunch: (launch: CannonLaunch) => void,
        private readonly onImpact: (impact: CannonImpact) => void,
        private readonly strikeTriggers: readonly number[] = CANNON_STRIKE_TRIGGERS,
        private readonly finishSafeDistance: number = CANNON_BRAWL_TUNING.finishSafeDistance,
    ) {}

    reset(): void {
        this.revision = 0;
        this.completedStrikeMask = 0;
        this.appliedImpactMask = 0;
        this.activeLaunch = null;
        this.activeRemainingSeconds = 0;
        this.lastTargetLane = -1;
    }

    update(dt: number, state: GameState, authoritative: boolean): void {
        if (state !== GameState.RACING) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        if (this.activeLaunch) {
            this.activeRemainingSeconds = Math.max(0, this.activeRemainingSeconds - step);
            if (authoritative && this.activeRemainingSeconds <= 0) this.resolveActiveStrike();
            return;
        }
        if (!authoritative || this.activeCount() <= 0) return;
        const strikeId = this.nextStrikeId();
        if (strikeId < 0 || this.leaderDistance() < this.strikeTriggers[strikeId]) return;
        const launch = this.createLaunch(strikeId);
        if (!launch) {
            this.completedStrikeMask |= 1 << strikeId;
            return;
        }
        this.applyLaunch(launch);
        this.onLaunch(launch);
    }

    applyLaunch(launch: CannonLaunch): boolean {
        if (!isValidLaunch(launch) || launch.revision <= this.revision
            || launch.strikeId >= this.strikeTriggers.length) return false;
        this.revision = launch.revision;
        this.activeLaunch = { ...launch };
        this.activeRemainingSeconds = launch.warningSeconds;
        this.lastTargetLane = this.nearestActiveLane(launch.targetZ);
        return true;
    }

    applyImpact(impact: CannonImpact): boolean {
        const impactBit = 1 << impact.strikeId;
        if (!isValidImpact(impact) || impact.revision < this.revision
            || (this.appliedImpactMask & impactBit) !== 0
            || impact.strikeId >= this.strikeTriggers.length) return false;
        this.revision = Math.max(this.revision, impact.revision);
        this.completedStrikeMask |= impactBit;
        this.appliedImpactMask |= impactBit;
        if (this.activeLaunch?.strikeId === impact.strikeId) {
            this.activeLaunch = null;
            this.activeRemainingSeconds = 0;
        }
        return true;
    }

    applySnapshotState(state: CannonBrawlState): CannonSnapshotApplyResult {
        if (!isValidState(state) || state.revision < this.revision) {
            return { activeChanged: false };
        }
        const previousActive = this.activeLaunch?.strikeId ?? -1;
        this.revision = state.revision;
        this.completedStrikeMask |= state.completedStrikeMask;
        if (state.activeStrikeId >= 0
            && state.activeStrikeId < this.strikeTriggers.length
            && (this.completedStrikeMask & (1 << state.activeStrikeId)) === 0) {
            this.activeLaunch = {
                strikeId: state.activeStrikeId,
                targetDistance: state.targetDistance,
                targetZ: state.targetZ,
                warningSeconds: Math.max(0, state.remainingSeconds),
                revision: state.revision,
            };
            this.activeRemainingSeconds = Math.max(0, state.remainingSeconds);
            this.lastTargetLane = this.nearestActiveLane(state.targetZ);
        } else {
            this.activeLaunch = null;
            this.activeRemainingSeconds = 0;
        }
        return {
            activeChanged: previousActive !== (this.activeLaunch?.strikeId ?? -1),
        };
    }

    snapshotState(): CannonBrawlState {
        return {
            revision: this.revision,
            completedStrikeMask: this.completedStrikeMask >>> 0,
            activeStrikeId: this.activeLaunch?.strikeId ?? -1,
            targetDistance: this.activeLaunch?.targetDistance ?? 0,
            targetZ: this.activeLaunch?.targetZ ?? 0,
            remainingSeconds: this.activeLaunch ? this.activeRemainingSeconds : 0,
        };
    }

    currentLaunch(): CannonLaunch | null {
        return this.activeLaunch;
    }

    currentRemainingSeconds(): number {
        return this.activeRemainingSeconds;
    }

    completedStrikeCount(): number {
        let count = 0;
        for (let i = 0; i < this.strikeTriggers.length; i++) {
            if ((this.completedStrikeMask & (1 << i)) !== 0) count++;
        }
        return count;
    }

    remainingStrikeCount(): number {
        return Math.max(0, this.strikeTriggers.length - this.completedStrikeCount());
    }

    activeCount(): number {
        let count = 0;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (this.isEligibleLane(lane)) count++;
        }
        return count;
    }

    threatForRacer(distance: number, lateral: number): 'core' | 'splash' | 'safe' {
        const launch = this.activeLaunch;
        if (!launch) return 'safe';
        if (insideEllipse(
            distance - launch.targetDistance,
            lateral - launch.targetZ,
            CANNON_BRAWL_TUNING.coreAlongRadius,
            CANNON_BRAWL_TUNING.coreLateralRadius,
        )) return 'core';
        return insideEllipse(
            distance - launch.targetDistance,
            lateral - launch.targetZ,
            CANNON_BRAWL_TUNING.splashAlongRadius,
            CANNON_BRAWL_TUNING.splashLateralRadius,
        ) ? 'splash' : 'safe';
    }

    targetZForAi(distance: number, currentZ: number, discipline: number): number | null {
        const launch = this.activeLaunch;
        if (!launch) return null;
        const elapsed = CANNON_BRAWL_TUNING.warningSeconds - this.activeRemainingSeconds;
        const reactionDelay = 0.58 - Math.max(0, Math.min(1, discipline)) * 0.43;
        if (elapsed < reactionDelay
            || Math.abs(distance - launch.targetDistance) > CANNON_BRAWL_TUNING.splashAlongRadius + 2) return null;
        const halfWidth = Math.max(0.8, this.poolWidth * 0.5 - 0.7);
        const margin = CANNON_BRAWL_TUNING.splashLateralRadius + CANNON_BRAWL_TUNING.aiSafetyMargin;
        const positiveTarget = Math.min(halfWidth, launch.targetZ + margin);
        const negativeTarget = Math.max(-halfWidth, launch.targetZ - margin);
        const positiveRoom = halfWidth - launch.targetZ;
        const negativeRoom = launch.targetZ + halfWidth;
        if (positiveRoom > negativeRoom) return positiveTarget;
        if (negativeRoom > positiveRoom) return negativeTarget;
        return currentZ >= launch.targetZ ? positiveTarget : negativeTarget;
    }

    private createLaunch(strikeId: number): CannonLaunch | null {
        const targetLane = this.pickTargetLane(strikeId);
        const racer = targetLane >= 0 ? this.racerForLane(targetLane) : null;
        if (!racer) return null;
        const rng = this.randomForStrike(strikeId);
        const halfWidth = Math.max(0.8, this.poolWidth * 0.5 - 0.7);
        const lead = Math.max(
            CANNON_BRAWL_TUNING.targetLeadMinimum,
            Math.min(
                CANNON_BRAWL_TUNING.targetLeadMaximum,
                Math.max(0, racer.speed) * CANNON_BRAWL_TUNING.warningSeconds,
            ),
        );
        const targetDistance = Math.min(
            this.finishSafeDistance,
            Math.max(0, racer.distance + lead + rng.range(-0.35, 0.35)),
        );
        const targetZ = Math.max(-halfWidth, Math.min(halfWidth, racer.lateral + rng.range(-0.16, 0.16)));
        this.lastTargetLane = targetLane;
        return {
            strikeId,
            targetDistance,
            targetZ,
            warningSeconds: CANNON_BRAWL_TUNING.warningSeconds,
            revision: this.revision + 1,
        };
    }

    private pickTargetLane(strikeId: number): number {
        const active = this.activeCount();
        if (active <= 0) return -1;
        const skipLast = active > 1 && this.lastTargetLane >= 0;
        let candidates = 0;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (skipLast && lane === this.lastTargetLane) continue;
            if (this.isEligibleLane(lane)) candidates++;
        }
        if (candidates <= 0) return this.lastTargetLane;
        let pick = this.randomForStrike(strikeId).int(candidates);
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (skipLast && lane === this.lastTargetLane) continue;
            if (!this.isEligibleLane(lane)) continue;
            if (pick-- === 0) return lane;
        }
        return -1;
    }

    private resolveActiveStrike(): void {
        const launch = this.activeLaunch;
        if (!launch) return;
        let hitMask = 0;
        let knockedLane = -1;
        let bestCoreDistance = Number.POSITIVE_INFINITY;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (!this.isEligibleLane(lane)) continue;
            const racer = this.racerForLane(lane)!;
            const along = racer.distance - launch.targetDistance;
            const lateral = racer.lateral - launch.targetZ;
            if (!insideEllipse(
                along,
                lateral,
                CANNON_BRAWL_TUNING.splashAlongRadius,
                CANNON_BRAWL_TUNING.splashLateralRadius,
            )) continue;
            hitMask |= 1 << lane;
            if (!insideEllipse(
                along,
                lateral,
                CANNON_BRAWL_TUNING.coreAlongRadius,
                CANNON_BRAWL_TUNING.coreLateralRadius,
            )) continue;
            const normalized = ellipseDistanceSquared(
                along,
                lateral,
                CANNON_BRAWL_TUNING.coreAlongRadius,
                CANNON_BRAWL_TUNING.coreLateralRadius,
            );
            if (normalized < bestCoreDistance || (normalized === bestCoreDistance && lane < knockedLane)) {
                bestCoreDistance = normalized;
                knockedLane = lane;
            }
        }
        const impact = {
            strikeId: launch.strikeId,
            hitMask: hitMask >>> 0,
            knockedLane,
            knockedDistance: knockedLane >= 0 ? this.racerForLane(knockedLane)?.distance ?? 0 : 0,
            revision: this.revision + 1,
        };
        this.applyImpact(impact);
        this.onImpact(impact);
    }

    private nextStrikeId(): number {
        for (let id = 0; id < this.strikeTriggers.length; id++) {
            if ((this.completedStrikeMask & (1 << id)) === 0) return id;
        }
        return -1;
    }

    private leaderDistance(): number {
        let leader = 0;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (!this.isEligibleLane(lane)) continue;
            leader = Math.max(leader, this.racerForLane(lane)!.distance);
        }
        return leader;
    }

    private isEligibleLane(lane: number): boolean {
        const racer = this.racerForLane(lane);
        return !!racer?.active && !racer.finished && racer.damageable
            && Number.isFinite(racer.distance) && Number.isFinite(racer.lateral);
    }

    private nearestActiveLane(targetZ: number): number {
        let bestLane = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (!this.isEligibleLane(lane)) continue;
            const distance = Math.abs(this.racerForLane(lane)!.lateral - targetZ);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestLane = lane;
            }
        }
        return bestLane;
    }

    private randomForStrike(strikeId: number): SeededRandom {
        return new SeededRandom((this.seed ^ Math.imul(strikeId + 1, 0x6d2b79f5)) >>> 0);
    }
}

function ellipseDistanceSquared(along: number, lateral: number, alongRadius: number, lateralRadius: number): number {
    const x = along / Math.max(0.01, alongRadius);
    const z = lateral / Math.max(0.01, lateralRadius);
    return x * x + z * z;
}

function insideEllipse(along: number, lateral: number, alongRadius: number, lateralRadius: number): boolean {
    return ellipseDistanceSquared(along, lateral, alongRadius, lateralRadius) <= 1;
}

function isValidLaunch(launch: CannonLaunch): boolean {
    return !!launch
        && Number.isSafeInteger(launch.strikeId) && launch.strikeId >= 0
        && Number.isSafeInteger(launch.revision) && launch.revision >= 0
        && Number.isFinite(launch.targetDistance) && launch.targetDistance >= 0
        && Number.isFinite(launch.targetZ)
        && Number.isFinite(launch.warningSeconds) && launch.warningSeconds >= 0;
}

function isValidImpact(impact: CannonImpact): boolean {
    return !!impact
        && Number.isSafeInteger(impact.strikeId) && impact.strikeId >= 0
        && Number.isSafeInteger(impact.hitMask) && impact.hitMask >= 0
        && Number.isSafeInteger(impact.knockedLane) && impact.knockedLane >= -1
        && Number.isFinite(impact.knockedDistance) && impact.knockedDistance >= 0
        && Number.isSafeInteger(impact.revision) && impact.revision >= 0;
}

function isValidState(state: CannonBrawlState): boolean {
    return !!state
        && Number.isSafeInteger(state.revision) && state.revision >= 0
        && Number.isSafeInteger(state.completedStrikeMask) && state.completedStrikeMask >= 0
        && Number.isSafeInteger(state.activeStrikeId) && state.activeStrikeId >= -1
        && Number.isFinite(state.targetDistance) && state.targetDistance >= 0
        && Number.isFinite(state.targetZ)
        && Number.isFinite(state.remainingSeconds) && state.remainingSeconds >= 0;
}
