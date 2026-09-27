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
    /** 本发爆心，迟到命中不能借用下一发落点。 */
    targetZ?: number;
    elapsedSeconds?: number;
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
    private secondaryLaunch: CannonLaunch | null = null;
    private secondaryRemainingSeconds = 0;
    private secondsSinceLaunch = Number.POSITIVE_INFINITY;
    private launchedCount = 0;
    private lastTargetLane = -1;

    constructor(
        private readonly laneCount: number,
        private readonly seed: number,
        private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => CannonRacerState | null,
        private readonly onLaunch: (launch: CannonLaunch) => void,
        private readonly onImpact: (impact: CannonImpact) => void,
        private strikeTriggers: readonly number[] = CANNON_STRIKE_TRIGGERS,
        private readonly finishSafeDistance: number = CANNON_BRAWL_TUNING.finishSafeDistance,
        // 独立规则调用可直接传空间坐标；比赛必须注入实际场景的折返换算。
        private readonly distanceToWorldX: (distance: number) => number = distance => distance,
        private readonly maxConcurrentLaunches: 1 | 2 = 1,
        private readonly minimumLaunchIntervalSeconds = 0,
    ) {}

    reset(): void {
        this.revision = 0;
        this.completedStrikeMask = 0;
        this.appliedImpactMask = 0;
        this.activeLaunch = null;
        this.activeRemainingSeconds = 0;
        this.secondaryLaunch = null;
        this.secondaryRemainingSeconds = 0;
        this.secondsSinceLaunch = Number.POSITIVE_INFINITY;
        this.launchedCount = 0;
        this.lastTargetLane = -1;
    }

    restart(strikeTriggers: readonly number[] = this.strikeTriggers): void {
        this.strikeTriggers = strikeTriggers;
        this.reset();
    }

    /** 主导演截止后保留已经发射的水球，取消尚未开始的计划。 */
    cancelPendingStrikesAfterCurrent(): void {
        const previous = this.completedStrikeMask;
        for (let id = 0; id < this.strikeTriggers.length; id++) {
            if (this.activeLaunch?.strikeId === id || this.secondaryLaunch?.strikeId === id) continue;
            this.completedStrikeMask |= 1 << id;
        }
        if (this.completedStrikeMask !== previous) this.revision++;
    }

    update(dt: number, state: GameState, authoritative: boolean): void {
        if (state !== GameState.RACING) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.secondsSinceLaunch += step;
        const primary = this.activeLaunch;
        const secondary = this.secondaryLaunch;
        if (primary) {
            this.activeRemainingSeconds = Math.max(0, this.activeRemainingSeconds - step);
        }
        if (secondary) {
            this.secondaryRemainingSeconds = Math.max(0, this.secondaryRemainingSeconds - step);
        }
        const primaryDue = !!primary && this.activeRemainingSeconds <= 0;
        const secondaryDue = !!secondary && this.secondaryRemainingSeconds <= 0;
        if (authoritative && primaryDue) this.resolveActiveStrike(primary!);
        if (authoritative && secondaryDue
            && (this.activeLaunch?.strikeId === secondary!.strikeId
                || this.secondaryLaunch?.strikeId === secondary!.strikeId)) this.resolveActiveStrike(secondary!);
        if (!authoritative) return;
        if ((this.activeLaunch ? 1 : 0) + (this.secondaryLaunch ? 1 : 0) >= this.maxConcurrentLaunches
            || this.secondsSinceLaunch < this.minimumLaunchIntervalSeconds) return;
        const strikeId = this.nextStrikeId();
        if (strikeId < 0 || this.activeCount() <= 0
            || this.leaderDistance() < this.strikeTriggers[strikeId]) return;
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
        if (this.activeLaunch && (this.maxConcurrentLaunches !== 2 || this.secondaryLaunch)) return false;
        this.revision = launch.revision;
        if (this.activeLaunch && this.maxConcurrentLaunches === 2 && !this.secondaryLaunch) {
            this.secondaryLaunch = { ...launch };
            this.secondaryRemainingSeconds = launch.warningSeconds;
        } else if (!this.activeLaunch) {
            this.activeLaunch = { ...launch };
            this.activeRemainingSeconds = launch.warningSeconds;
        } else return false;
        this.secondsSinceLaunch = 0;
        this.launchedCount++;
        this.lastTargetLane = this.nearestActiveLane(launch.targetZ);
        return true;
    }

    applyImpact(impact: CannonImpact, raceElapsedSeconds?: number): boolean {
        const impactBit = 1 << impact.strikeId;
        if (!isValidImpact(impact)
            || (this.appliedImpactMask & impactBit) !== 0
            || impact.strikeId >= this.strikeTriggers.length) return false;
        if (impact.elapsedSeconds !== undefined
            && (!Number.isFinite(impact.elapsedSeconds) || impact.elapsedSeconds < 0
                || (raceElapsedSeconds !== undefined && raceElapsedSeconds - impact.elapsedSeconds > 3))) return false;
        this.revision = Math.max(this.revision, impact.revision);
        this.completedStrikeMask |= impactBit;
        this.appliedImpactMask |= impactBit;
        if (this.activeLaunch?.strikeId === impact.strikeId) {
            this.activeLaunch = this.secondaryLaunch;
            this.activeRemainingSeconds = this.secondaryRemainingSeconds;
            this.secondaryLaunch = null;
            this.secondaryRemainingSeconds = 0;
        } else if (this.secondaryLaunch?.strikeId === impact.strikeId) {
            this.secondaryLaunch = null;
            this.secondaryRemainingSeconds = 0;
        }
        return true;
    }

    isLatestImpact(impact: CannonImpact): boolean {
        return impact.revision === this.revision;
    }

    applySnapshotState(state: CannonBrawlState): CannonSnapshotApplyResult {
        if (!isValidState(state) || state.revision < this.revision) {
            return { activeChanged: false };
        }
        const previousActive = this.activeLaunch?.strikeId ?? -1;
        const previousRevision = this.revision;
        const previousRemainingSeconds = this.activeRemainingSeconds;
        const previousWarningSeconds = this.activeLaunch?.warningSeconds ?? 0;
        this.revision = state.revision;
        this.completedStrikeMask |= state.completedStrikeMask;
        if (state.activeStrikeId >= 0
            && state.activeStrikeId < this.strikeTriggers.length
            && (this.completedStrikeMask & (1 << state.activeStrikeId)) === 0) {
            const sameCountdown = state.revision === previousRevision
                && state.activeStrikeId === previousActive;
            this.activeLaunch = {
                strikeId: state.activeStrikeId,
                targetDistance: state.targetDistance,
                targetZ: state.targetZ,
                warningSeconds: sameCountdown
                    ? previousWarningSeconds
                    : Math.max(0, state.remainingSeconds),
                revision: state.revision,
            };
            const nextRemainingSeconds = Math.max(0, state.remainingSeconds);
            this.activeRemainingSeconds = sameCountdown
                ? Math.min(previousRemainingSeconds, nextRemainingSeconds)
                : nextRemainingSeconds;
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

    currentSecondaryLaunch(): CannonLaunch | null { return this.secondaryLaunch; }
    currentSecondaryRemainingSeconds(): number { return this.secondaryRemainingSeconds; }
    launchedStrikeCount(): number { return this.launchedCount; }

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
        let splash = false;
        const worldX = this.distanceToWorldX(distance);
        for (let index = 0; index < 2; index++) {
            const launch = index === 0 ? this.activeLaunch : this.secondaryLaunch;
            if (!launch) continue;
            const along = worldX - this.distanceToWorldX(launch.targetDistance);
            const across = lateral - launch.targetZ;
            if (insideEllipse(along, across,
                CANNON_BRAWL_TUNING.coreAlongRadius, CANNON_BRAWL_TUNING.coreLateralRadius)) return 'core';
            if (insideEllipse(along, across,
                CANNON_BRAWL_TUNING.splashAlongRadius, CANNON_BRAWL_TUNING.splashLateralRadius)) splash = true;
        }
        return splash ? 'splash' : 'safe';
    }

    targetZForAi(distance: number, currentZ: number, discipline: number): number | null {
        const reactionDelay = 0.58 - Math.max(0, Math.min(1, discipline)) * 0.43;
        const first = this.activeLaunch;
        const second = this.secondaryLaunch;
        const racerX = this.distanceToWorldX(distance);
        const firstRelevant = !!first
            && CANNON_BRAWL_TUNING.warningSeconds - this.activeRemainingSeconds >= reactionDelay
            && Math.abs(racerX - this.distanceToWorldX(first.targetDistance))
                <= CANNON_BRAWL_TUNING.splashAlongRadius + 2;
        const secondRelevant = !!second
            && CANNON_BRAWL_TUNING.warningSeconds - this.secondaryRemainingSeconds >= reactionDelay
            && Math.abs(racerX - this.distanceToWorldX(second.targetDistance))
                <= CANNON_BRAWL_TUNING.splashAlongRadius + 2;
        const launch = firstRelevant ? first : secondRelevant ? second : null;
        if (!launch) return null;
        const halfWidth = Math.max(0.8, this.poolWidth * 0.5 - 0.7);
        const margin = CANNON_BRAWL_TUNING.splashLateralRadius + CANNON_BRAWL_TUNING.aiSafetyMargin;
        const positiveTarget = Math.min(halfWidth, launch.targetZ + margin);
        const negativeTarget = Math.max(-halfWidth, launch.targetZ - margin);
        const positiveRoom = halfWidth - launch.targetZ;
        const negativeRoom = launch.targetZ + halfWidth;
        const preferred = positiveRoom > negativeRoom ? positiveTarget
            : negativeRoom > positiveRoom ? negativeTarget
                : currentZ >= launch.targetZ ? positiveTarget : negativeTarget;
        const other = launch === first ? second : first;
        if (!other || Math.abs(racerX - this.distanceToWorldX(other.targetDistance))
            > CANNON_BRAWL_TUNING.splashAlongRadius + 2) return preferred;
        if (Math.abs(preferred - other.targetZ) >= margin) return preferred;
        let best = preferred;
        let bestTravel = Number.POSITIVE_INFINITY;
        for (let index = 0; index < 4; index++) {
            const candidate = index === 0 ? negativeTarget : index === 1 ? positiveTarget
                : index === 2 ? -halfWidth : halfWidth;
            if (Math.abs(candidate - launch.targetZ) < margin
                || Math.abs(candidate - other.targetZ) < margin) continue;
            const travel = Math.abs(candidate - currentZ);
            if (travel < bestTravel) {
                best = candidate;
                bestTravel = travel;
            }
        }
        return best;
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
        let targetZ = Math.max(-halfWidth, Math.min(halfWidth, racer.lateral + rng.range(-0.16, 0.16)));
        // 双发之间至少留出一条横移通道；放不下时取消本发，不制造必中的封路。
        if (this.activeLaunch) {
            const separation = CANNON_BRAWL_TUNING.splashLateralRadius * 2 + 0.7;
            const firstZ = this.activeLaunch.targetZ;
            if (Math.abs(targetZ - firstZ) < separation) {
                const negative = firstZ - separation;
                const positive = firstZ + separation;
                if (negative >= -halfWidth && positive <= halfWidth) {
                    targetZ = Math.abs(targetZ - negative) < Math.abs(targetZ - positive) ? negative : positive;
                } else if (negative >= -halfWidth) targetZ = negative;
                else if (positive <= halfWidth) targetZ = positive;
                else return null;
            }
        }
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

    private resolveActiveStrike(launch: CannonLaunch): void {
        let hitMask = 0;
        let knockedLane = -1;
        let bestCoreDistance = Number.POSITIVE_INFINITY;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (!this.isEligibleLane(lane)) continue;
            const racer = this.racerForLane(lane)!;
            const along = this.distanceToWorldX(racer.distance) - this.distanceToWorldX(launch.targetDistance);
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
            targetZ: launch.targetZ,
        };
        this.applyImpact(impact);
        this.onImpact(impact);
    }

    private nextStrikeId(): number {
        for (let id = 0; id < this.strikeTriggers.length; id++) {
            if ((this.completedStrikeMask & (1 << id)) === 0
                && this.activeLaunch?.strikeId !== id && this.secondaryLaunch?.strikeId !== id) return id;
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
        && (impact.targetZ === undefined || Number.isFinite(impact.targetZ))
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
