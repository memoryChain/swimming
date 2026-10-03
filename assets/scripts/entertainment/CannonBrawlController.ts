import { SeededRandom } from '../core/SharedRNG';
import { CANNON_BRAWL_TUNING } from '../core/EntertainmentBalance';
export { CANNON_BRAWL_TUNING } from '../core/EntertainmentBalance';

export type CannonRacerState = { active: boolean; finished: boolean; damageable: boolean; distance: number; lateral: number; speed: number };
export type CannonLaunch = { strikeId: number; targetDistance: number; targetZ: number; warningSeconds: number; revision: number };
export type CannonImpact = { strikeId: number; hitMask: number; knockedLane: number; knockedDistance: number; targetZ: number; revision: number };
export const CANNON_STRIKE_TRIGGERS: readonly number[] = [25, 48, 70, 82, 104, 116, 138, 148, 158, 170];

/** 原版单发规则。只在本地调试创建；落点使用独立种子，不消耗主干公共随机流。 */
export class CannonBrawlController {
    private revision = 0;
    private completed = 0;
    private launch: CannonLaunch | null = null;
    private remaining = 0;
    private lastTargetLane = -1;
    private cancelled = false;
    constructor(private readonly laneCount: number, private readonly seed: number, private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => CannonRacerState | null,
        private readonly onLaunch: (launch: CannonLaunch) => void, private readonly onImpact: (impact: CannonImpact) => void,
        private readonly finishSafeDistance: number, private readonly distanceToWorldX: (distance: number) => number,
        private readonly triggers: readonly number[] = CANNON_STRIKE_TRIGGERS) {}
    reset(): void { this.revision = this.completed = this.remaining = 0; this.lastTargetLane = -1; this.launch = null; this.cancelled = false; }
    stopNewStrikes(): void { this.cancelled = true; }
    currentLaunch(): CannonLaunch | null { return this.launch; }
    currentRemainingSeconds(): number { return this.remaining; }
    update(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0) return;
        if (this.launch) {
            this.remaining = Math.max(0, this.remaining - dt);
            if (this.remaining <= 0) this.resolveImpact(this.launch);
        }
        if (this.launch || this.cancelled || this.completed >= this.triggers.length) return;
        let leader = 0;
        for (let lane = 0; lane < this.laneCount; lane++) if (this.eligible(lane)) leader = Math.max(leader, this.racerForLane(lane)!.distance);
        const strikeId = this.completed;
        if (leader < this.triggers[strikeId]) return;
        const targetLane = this.pickTargetLane(strikeId);
        const racer = targetLane >= 0 ? this.racerForLane(targetLane) : null;
        if (!racer) return;
        const rng = this.randomForStrike(strikeId);
        const halfWidth = Math.max(.8, this.poolWidth * .5 - .7);
        const lead = Math.max(CANNON_BRAWL_TUNING.targetLeadMinimum,
            Math.min(CANNON_BRAWL_TUNING.targetLeadMaximum, Math.max(0, racer.speed) * CANNON_BRAWL_TUNING.warningSeconds));
        const launch = this.launch = { strikeId,
            targetDistance: Math.min(this.finishSafeDistance, Math.max(0, racer.distance + lead + rng.range(-.35, .35))),
            targetZ: Math.max(-halfWidth, Math.min(halfWidth, racer.lateral + rng.range(-.16, .16))),
            warningSeconds: CANNON_BRAWL_TUNING.warningSeconds, revision: ++this.revision };
        this.remaining = launch.warningSeconds;
        // 来源 applyLaunch 按最终落点重新找最近选手，保留该行为。
        let bestDistance = Infinity;
        for (let lane = 0; lane < this.laneCount; lane++) if (this.eligible(lane)) {
            const gap = Math.abs(this.racerForLane(lane)!.lateral - launch.targetZ);
            if (gap < bestDistance) { bestDistance = gap; this.lastTargetLane = lane; }
        }
        this.onLaunch(launch);
    }
    targetZForAi(distance: number, currentZ: number, discipline: number): number | null {
        const launch = this.launch;
        const reactionDelay = .58 - Math.max(0, Math.min(1, discipline)) * .43;
        if (!launch || launch.warningSeconds - this.remaining < reactionDelay
            || Math.abs(this.distanceToWorldX(distance) - this.distanceToWorldX(launch.targetDistance)) > CANNON_BRAWL_TUNING.splashAlongRadius + 2) return null;
        const halfWidth = Math.max(.8, this.poolWidth * .5 - .7);
        const margin = CANNON_BRAWL_TUNING.splashLateralRadius + CANNON_BRAWL_TUNING.aiSafetyMargin;
        const positive = Math.min(halfWidth, launch.targetZ + margin), negative = Math.max(-halfWidth, launch.targetZ - margin);
        const positiveRoom = halfWidth - launch.targetZ, negativeRoom = launch.targetZ + halfWidth;
        return positiveRoom > negativeRoom ? positive : negativeRoom > positiveRoom ? negative : currentZ >= launch.targetZ ? positive : negative;
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
        this.completed++; this.launch = null; this.remaining = 0;
        this.onImpact(impact);
    }
    private randomForStrike(strikeId: number): SeededRandom { return new SeededRandom((this.seed ^ Math.imul(strikeId + 1, 0x6d2b79f5)) >>> 0); }
}
function ellipseSquared(x: number, z: number, radiusX: number, radiusZ: number): number {
    return (x / Math.max(.01, radiusX)) ** 2 + (z / Math.max(.01, radiusZ)) ** 2;
}
