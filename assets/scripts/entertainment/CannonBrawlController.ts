import { SeededRandom } from '../core/SharedRNG';
import { CANNON_BRAWL_TUNING } from '../core/EntertainmentBalance';
export { CANNON_BRAWL_TUNING } from '../core/EntertainmentBalance';

export type CannonRacerState = { active: boolean; finished: boolean; damageable: boolean; distance: number; lateral: number; speed: number };
export type CannonLaunch = { strikeId: number; targetDistance: number; targetZ: number; warningSeconds: number; revision: number };
export type CannonImpact = { strikeId: number; hitMask: number; knockedLane: number; knockedDistance: number; targetZ: number; revision: number };
export const CANNON_STRIKE_TRIGGERS: readonly number[] = [25, 48, 70, 82, 104, 116, 138, 148, 158, 170];

/** 本地单发／双发规则。落点使用独立种子，不消耗主干公共随机流。 */
export class CannonBrawlController {
    private revision = 0;
    private nextStrike = 0;
    private launch: CannonLaunch | null = null;
    private remaining = 0;
    private secondaryLaunch: CannonLaunch | null = null;
    private secondaryRemaining = 0;
    private secondsSinceLaunch = Infinity;
    private lastTargetLane = -1;
    private cancelled = false;
    constructor(private readonly laneCount: number, private readonly seed: number, private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => CannonRacerState | null,
        private readonly onLaunch: (launch: CannonLaunch) => void, private readonly onImpact: (impact: CannonImpact) => void,
        private readonly finishSafeDistance: number, private readonly distanceToWorldX: (distance: number) => number,
        private readonly triggers: readonly number[] = CANNON_STRIKE_TRIGGERS,
        private readonly maxConcurrentLaunches: 1 | 2 = 1, private readonly minimumLaunchIntervalSeconds = 0) {}
    reset(): void {
        this.revision = this.nextStrike = this.remaining = this.secondaryRemaining = 0;
        this.lastTargetLane = -1; this.launch = this.secondaryLaunch = null;
        this.secondsSinceLaunch = Infinity; this.cancelled = false;
    }
    stopNewStrikes(): void { this.cancelled = true; }
    currentLaunch(): CannonLaunch | null { return this.launch; }
    currentRemainingSeconds(): number { return this.remaining; }
    currentSecondaryLaunch(): CannonLaunch | null { return this.secondaryLaunch; }
    currentSecondaryRemainingSeconds(): number { return this.secondaryRemaining; }
    update(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0) return;
        this.secondsSinceLaunch += dt;
        // 先扣两发计时，再分别落水；第一发结束后第二发保留自己的剩余时间。
        const primary = this.launch, secondary = this.secondaryLaunch;
        if (primary) this.remaining = Math.max(0, this.remaining - dt);
        if (secondary) this.secondaryRemaining = Math.max(0, this.secondaryRemaining - dt);
        const primaryDue = !!primary && this.remaining <= 0, secondaryDue = !!secondary && this.secondaryRemaining <= 0;
        if (primaryDue) this.resolveImpact(primary!);
        if (secondaryDue) this.resolveImpact(secondary!);
        if (this.cancelled || this.nextStrike >= this.triggers.length
            || (this.launch ? 1 : 0) + (this.secondaryLaunch ? 1 : 0) >= this.maxConcurrentLaunches
            || this.secondsSinceLaunch < this.minimumLaunchIntervalSeconds) return;
        let leader = 0;
        for (let lane = 0; lane < this.laneCount; lane++) if (this.eligible(lane)) leader = Math.max(leader, this.racerForLane(lane)!.distance);
        const strikeId = this.nextStrike;
        if (leader < this.triggers[strikeId]) return;
        const targetLane = this.pickTargetLane(strikeId);
        const racer = targetLane >= 0 ? this.racerForLane(targetLane) : null;
        if (!racer) return;
        const rng = this.randomForStrike(strikeId);
        const halfWidth = Math.max(.8, this.poolWidth * .5 - .7);
        const lead = Math.max(CANNON_BRAWL_TUNING.targetLeadMinimum,
            Math.min(CANNON_BRAWL_TUNING.targetLeadMaximum, Math.max(0, racer.speed) * CANNON_BRAWL_TUNING.warningSeconds));
        const targetDistance = Math.min(this.finishSafeDistance, Math.max(0, racer.distance + lead + rng.range(-.35, .35)));
        let targetZ = Math.max(-halfWidth, Math.min(halfWidth, racer.lateral + rng.range(-.16, .16)));
        if (this.launch) {
            const separation = CANNON_BRAWL_TUNING.splashLateralRadius * 2 + .7;
            const firstZ = this.launch.targetZ;
            if (Math.abs(targetZ - firstZ) < separation) {
                const negative = firstZ - separation, positive = firstZ + separation;
                if (negative >= -halfWidth && positive <= halfWidth) targetZ = Math.abs(targetZ - negative) < Math.abs(targetZ - positive) ? negative : positive;
                else if (negative >= -halfWidth) targetZ = negative;
                else if (positive <= halfWidth) targetZ = positive;
                else { this.nextStrike++; return; }
            }
        }
        const launch: CannonLaunch = { strikeId,
            targetDistance,
            targetZ,
            warningSeconds: CANNON_BRAWL_TUNING.warningSeconds, revision: ++this.revision };
        if (this.launch) { this.secondaryLaunch = launch; this.secondaryRemaining = launch.warningSeconds; }
        else { this.launch = launch; this.remaining = launch.warningSeconds; }
        this.nextStrike++; this.secondsSinceLaunch = 0;
        // 来源 applyLaunch 按最终落点重新找最近选手，保留该行为。
        let bestDistance = Infinity;
        for (let lane = 0; lane < this.laneCount; lane++) if (this.eligible(lane)) {
            const gap = Math.abs(this.racerForLane(lane)!.lateral - launch.targetZ);
            if (gap < bestDistance) { bestDistance = gap; this.lastTargetLane = lane; }
        }
        this.onLaunch(launch);
    }
    targetZForAi(distance: number, currentZ: number, discipline: number): number | null {
        const first = this.launch, second = this.secondaryLaunch;
        const reactionDelay = .58 - Math.max(0, Math.min(1, discipline)) * .43;
        const racerX = this.distanceToWorldX(distance), relevantRange = CANNON_BRAWL_TUNING.splashAlongRadius + 2;
        const firstRelevant = !!first && first.warningSeconds - this.remaining >= reactionDelay
            && Math.abs(racerX - this.distanceToWorldX(first.targetDistance)) <= relevantRange;
        const secondRelevant = !!second && second.warningSeconds - this.secondaryRemaining >= reactionDelay
            && Math.abs(racerX - this.distanceToWorldX(second.targetDistance)) <= relevantRange;
        const launch = firstRelevant ? first : secondRelevant ? second : null;
        if (!launch) return null;
        const halfWidth = Math.max(.8, this.poolWidth * .5 - .7);
        const margin = CANNON_BRAWL_TUNING.splashLateralRadius + CANNON_BRAWL_TUNING.aiSafetyMargin;
        const positive = Math.min(halfWidth, launch.targetZ + margin), negative = Math.max(-halfWidth, launch.targetZ - margin);
        const positiveRoom = halfWidth - launch.targetZ, negativeRoom = launch.targetZ + halfWidth;
        const preferred = positiveRoom > negativeRoom ? positive : negativeRoom > positiveRoom ? negative : currentZ >= launch.targetZ ? positive : negative;
        const other = launch === first ? second : first;
        if (!other || Math.abs(racerX - this.distanceToWorldX(other.targetDistance)) > relevantRange
            || Math.abs(preferred - other.targetZ) >= margin) return preferred;
        let best = preferred, bestTravel = Infinity;
        for (let index = 0; index < 4; index++) {
            const candidate = index === 0 ? negative : index === 1 ? positive : index === 2 ? -halfWidth : halfWidth;
            if (Math.abs(candidate - launch.targetZ) < margin || Math.abs(candidate - other.targetZ) < margin) continue;
            const travel = Math.abs(candidate - currentZ);
            if (travel < bestTravel) { best = candidate; bestTravel = travel; }
        }
        return best;
    }
    private eligible(lane: number): boolean {
        const r = this.racerForLane(lane);
        return !!r?.active && !r.finished && r.damageable && Number.isFinite(r.distance) && Number.isFinite(r.lateral) && Number.isFinite(r.speed);
    }
    private pickTargetLane(strikeId: number): number {
        let active = 0;
        for (let lane = 0; lane < this.laneCount; lane++) if (this.eligible(lane)) active++;
        const skipLast = active > 1 && this.lastTargetLane >= 0;
        let candidates = 0;
        for (let lane = 0; lane < this.laneCount; lane++) if (this.eligible(lane) && (!skipLast || lane !== this.lastTargetLane)) candidates++;
        if (!candidates) return -1;
        let pick = this.randomForStrike(strikeId).int(candidates);
        for (let lane = 0; lane < this.laneCount; lane++) if (this.eligible(lane) && (!skipLast || lane !== this.lastTargetLane) && pick-- === 0) return lane;
        return -1;
    }
    private resolveImpact(launch: CannonLaunch): void {
        let hitMask = 0, knockedLane = -1, bestCoreDistance = Infinity;
        for (let lane = 0; lane < this.laneCount; lane++) {
            if (!this.eligible(lane)) continue;
            const racer = this.racerForLane(lane)!;
            const along = this.distanceToWorldX(racer.distance) - this.distanceToWorldX(launch.targetDistance), across = racer.lateral - launch.targetZ;
            if (ellipseSquared(along, across, CANNON_BRAWL_TUNING.splashAlongRadius, CANNON_BRAWL_TUNING.splashLateralRadius) > 1) continue;
            hitMask |= 1 << lane;
            const core = ellipseSquared(along, across, CANNON_BRAWL_TUNING.coreAlongRadius, CANNON_BRAWL_TUNING.coreLateralRadius);
            if (core <= 1 && (core < bestCoreDistance || (core === bestCoreDistance && lane < knockedLane))) { bestCoreDistance = core; knockedLane = lane; }
        }
        const impact: CannonImpact = { strikeId: launch.strikeId, hitMask: hitMask >>> 0, knockedLane,
            knockedDistance: knockedLane >= 0 ? this.racerForLane(knockedLane)!.distance : 0, targetZ: launch.targetZ, revision: ++this.revision };
        if (this.launch === launch) {
            this.launch = this.secondaryLaunch; this.remaining = this.secondaryRemaining;
            this.secondaryLaunch = null; this.secondaryRemaining = 0;
        } else { this.secondaryLaunch = null; this.secondaryRemaining = 0; }
        this.onImpact(impact);
    }
    private randomForStrike(strikeId: number): SeededRandom { return new SeededRandom((this.seed ^ Math.imul(strikeId + 1, 0x6d2b79f5)) >>> 0); }
}
function ellipseSquared(x: number, z: number, radiusX: number, radiusZ: number): number {
    return (x / Math.max(.01, radiusX)) ** 2 + (z / Math.max(.01, radiusZ)) ** 2;
}
