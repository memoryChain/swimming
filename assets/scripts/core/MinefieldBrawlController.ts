import { GameState } from './GameConstants';
import { expandedEllipseContains, segmentHitsExpandedEllipse } from './RaceContactGeometry';
import { SeededRandom } from './SharedRNG';

export type MinefieldRacerState = {
    active: boolean;
    finished: boolean;
    distance: number;
    lateral: number;
};

export type MinefieldMineState = {
    id: number;
    active: boolean;
    armed: boolean;
    courseX: number;
    lateral: number;
};

export type MinefieldImpact = {
    mineId: number;
    hitLane: number;
    courseX: number;
    lateral: number;
    hitMask: number;
    revision: number;
};

export type MinefieldSnapshotState = {
    revision: number;
    elapsedSeconds: number;
    activeMask: number;
    armedMask: number;
};

export type MinefieldExclusionZone = {
    courseX: number;
    lateral: number;
    alongRadius: number;
    lateralRadius: number;
};

export const MINEFIELD_TUNING = {
    mineCount: 7,
    mineItemAlongRadius: 0.67,
    mineItemLateralRadius: 0.65,
    swimmerContactAlongRadius: 0.68,
    swimmerContactLateralRadius: 0.4,
    blastAlongRadius: 3.2,
    blastLateralRadius: 2.5,
    driftAlongRadius: 0.75,
    driftLateralRadius: 0.58,
    driftSpeed: 0.72,
    spawnClearAlongRadius: 2.85,
    spawnClearLateralRadius: 1.8,
    spawnClearSeconds: 0.45,
    aiLookAhead: 5.5,
    aiAvoidOffset: 1.75,
};

const ANCHOR_X = [6.5, 12.5, 19.5, 27, 34.5, 41, 46] as const;
const ANCHOR_Z_RATIOS = [-0.54, 0.34, -0.12, 0.58, -0.4, 0.1, 0.46] as const;

/** 房主使用水雷与人物身体的扩张椭圆负责命中；访客只同步确定性视觉和可靠命中事件。 */
export class MinefieldBrawlController {
    private revision = 0;
    private elapsed = 0;
    private activeMineCount = 0;
    private lastSnapshotRevision = -1;
    private lastSnapshotElapsed = -1;
    private readonly mineStates: MinefieldMineState[] = [];
    private readonly anchorCourseX: number[] = [];
    private readonly anchorLateral: number[] = [];
    private readonly phaseAlong: number[] = [];
    private readonly phaseLateral: number[] = [];
    private readonly spawnClearSeconds: number[] = [];
    private readonly previousRacerCourseX: number[];
    private readonly previousRacerLateral: number[];

    constructor(
        private readonly laneCount: number,
        seed: number,
        private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => MinefieldRacerState | null,
        private readonly onImpact: (impact: MinefieldImpact) => void,
        mineCount: number = MINEFIELD_TUNING.mineCount,
        exclusionZone: MinefieldExclusionZone | null = null,
    ) {
        const random = new SeededRandom((seed ^ 0x6d696e65) >>> 0);
        const halfWidth = Math.max(1, poolWidth * 0.5 - 0.8);
        const xOrder = random.shuffle([...ANCHOR_X]);
        const zOrder = random.shuffle([...ANCHOR_Z_RATIOS]);
        const count = Math.max(1, Math.min(ANCHOR_X.length, Math.floor(mineCount)));
        let candidates = xOrder.map((anchorX, index) => ({
            anchorX,
            anchorZ: zOrder[index % zOrder.length] * halfWidth,
        }));
        if (exclusionZone) {
            const safe = candidates.filter(candidate => !isMineAnchorExcluded(
                candidate.anchorX, candidate.anchorZ, exclusionZone,
            ));
            const reserved = candidates.filter(candidate => isMineAnchorExcluded(
                candidate.anchorX, candidate.anchorZ, exclusionZone,
            ));
            candidates = safe.concat(reserved);
        }
        for (let id = 0; id < count; id++) {
            const { anchorX, anchorZ } = candidates[id];
            this.anchorCourseX.push(anchorX);
            this.anchorLateral.push(anchorZ);
            this.mineStates.push({
                id,
                active: true,
                armed: false,
                courseX: anchorX,
                lateral: anchorZ,
            });
            this.phaseAlong.push(random.range(0, Math.PI * 2));
            this.phaseLateral.push(random.range(0, Math.PI * 2));
            this.spawnClearSeconds.push(0);
        }
        this.previousRacerCourseX = new Array(laneCount).fill(Number.NaN);
        this.previousRacerLateral = new Array(laneCount).fill(Number.NaN);
        this.activeMineCount = this.mineStates.length;
        this.updateMinePositions();
        this.resetSpawnSafety();
    }

    reset(): void {
        this.revision = 0;
        this.elapsed = 0;
        this.activeMineCount = this.mineStates.length;
        this.lastSnapshotRevision = -1;
        this.lastSnapshotElapsed = -1;
        for (const mine of this.mineStates) {
            mine.active = true;
            mine.armed = false;
        }
        this.spawnClearSeconds.fill(0);
        this.previousRacerCourseX.fill(Number.NaN);
        this.previousRacerLateral.fill(Number.NaN);
        this.updateMinePositions();
        this.resetSpawnSafety();
    }

    update(dt: number, state: GameState, authoritative: boolean): void {
        if (state !== GameState.RACING || this.activeMineCount <= 0) return;
        const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
        this.elapsed += step;
        this.updateMinePositions();
        if (authoritative) this.updateSpawnSafety(step);
        for (let lane = 0; lane < this.laneCount; lane++) {
            const racer = this.racerForLane(lane);
            const courseX = courseOffset(racer?.distance ?? 0);
            const lateral = racer?.lateral ?? 0;
            if (authoritative && racer?.active && !racer.finished) {
                this.testRacer(lane, courseX, lateral);
            }
            this.previousRacerCourseX[lane] = courseX;
            this.previousRacerLateral[lane] = lateral;
        }
    }

    mines(): readonly MinefieldMineState[] { return this.mineStates; }

    snapshotState(): MinefieldSnapshotState {
        let activeMask = 0;
        let armedMask = 0;
        for (let id = 0; id < this.mineStates.length; id++) {
            const mine = this.mineStates[id];
            if (mine.active) activeMask |= 1 << id;
            if (mine.active && mine.armed) armedMask |= 1 << id;
        }
        return {
            revision: this.revision,
            elapsedSeconds: this.elapsed,
            activeMask,
            armedMask,
        };
    }

    applySnapshotState(state: MinefieldSnapshotState): boolean {
        if (!Number.isSafeInteger(state.revision) || state.revision < this.revision
            || !Number.isFinite(state.elapsedSeconds) || state.elapsedSeconds < 0
            || !Number.isSafeInteger(state.activeMask) || state.activeMask < 0
            || !Number.isSafeInteger(state.armedMask) || state.armedMask < 0) return false;
        if (state.revision === this.lastSnapshotRevision
            && state.elapsedSeconds < this.lastSnapshotElapsed) return false;
        this.lastSnapshotRevision = state.revision;
        this.lastSnapshotElapsed = state.elapsedSeconds;
        this.revision = state.revision;
        // 已用最近一次权威快照时钟过滤乱序包；接受后允许轻微回正本地漂移。
        this.elapsed = state.elapsedSeconds;
        this.activeMineCount = 0;
        for (let id = 0; id < this.mineStates.length; id++) {
            const mine = this.mineStates[id];
            mine.active = (state.activeMask & (1 << id)) !== 0;
            mine.armed = mine.active && (state.armedMask & (1 << id)) !== 0;
            if (mine.active) this.activeMineCount++;
            this.spawnClearSeconds[id] = 0;
        }
        this.updateMinePositions();
        return true;
    }

    applyImpact(impact: MinefieldImpact): boolean {
        if (!Number.isSafeInteger(impact.mineId) || impact.mineId < 0 || impact.mineId >= this.mineStates.length
            || !Number.isSafeInteger(impact.hitLane) || impact.hitLane < 0 || impact.hitLane >= this.laneCount
            || !Number.isSafeInteger(impact.hitMask) || impact.hitMask < 0
            || !Number.isSafeInteger(impact.revision) || impact.revision <= this.revision
            || !Number.isFinite(impact.courseX) || !Number.isFinite(impact.lateral)) return false;
        this.revision = impact.revision;
        const mine = this.mineStates[impact.mineId];
        if (mine.active) this.activeMineCount = Math.max(0, this.activeMineCount - 1);
        mine.active = false;
        mine.armed = false;
        return true;
    }

    targetZForAi(lane: number): number | null {
        const racer = this.racerForLane(lane);
        if (!racer?.active || racer.finished) return null;
        const courseX = courseOffset(racer.distance);
        let nearest: MinefieldMineState | null = null;
        let nearestAhead = Infinity;
        for (const mine of this.mineStates) {
            if (!mine.active || !mine.armed) continue;
            const along = Math.abs(mine.courseX - courseX);
            if (along > MINEFIELD_TUNING.aiLookAhead || along >= nearestAhead) continue;
            const contactLateralRadius = MINEFIELD_TUNING.mineItemLateralRadius
                + MINEFIELD_TUNING.swimmerContactLateralRadius;
            if (Math.abs(mine.lateral - racer.lateral) > contactLateralRadius * 2.2) continue;
            nearest = mine;
            nearestAhead = along;
        }
        if (!nearest) return null;
        const halfWidth = Math.max(0.8, this.poolWidth * 0.5 - 0.7);
        const side = racer.lateral <= nearest.lateral ? -1 : 1;
        return clamp(nearest.lateral + side * MINEFIELD_TUNING.aiAvoidOffset, -halfWidth, halfWidth);
    }

    private testRacer(lane: number, courseX: number, lateral: number): void {
        const previousX = this.previousRacerCourseX[lane];
        const previousZ = this.previousRacerLateral[lane];
        for (const mine of this.mineStates) {
            if (!mine.active || !mine.armed) continue;
            const hit = Number.isFinite(previousX) && Math.abs(courseX - previousX) <= 5
                ? segmentHitsExpandedEllipse(
                    previousX, previousZ, courseX, lateral, mine.courseX, mine.lateral,
                    MINEFIELD_TUNING.mineItemAlongRadius,
                    MINEFIELD_TUNING.mineItemLateralRadius,
                    MINEFIELD_TUNING.swimmerContactAlongRadius,
                    MINEFIELD_TUNING.swimmerContactLateralRadius,
                )
                : expandedEllipseContains(
                    courseX, lateral, mine.courseX, mine.lateral,
                    MINEFIELD_TUNING.mineItemAlongRadius,
                    MINEFIELD_TUNING.mineItemLateralRadius,
                    MINEFIELD_TUNING.swimmerContactAlongRadius,
                    MINEFIELD_TUNING.swimmerContactLateralRadius,
                );
            if (!hit) continue;
            const impact: MinefieldImpact = {
                mineId: mine.id,
                hitLane: lane,
                courseX: mine.courseX,
                lateral: mine.lateral,
                hitMask: this.blastHitMask(mine.courseX, mine.lateral, lane),
                revision: this.revision + 1,
            };
            if (this.applyImpact(impact)) this.onImpact(impact);
            return;
        }
    }

    private blastHitMask(courseX: number, lateral: number, directLane: number): number {
        let mask = 0;
        for (let lane = 0; lane < this.laneCount; lane++) {
            const racer = this.racerForLane(lane);
            if (!racer?.active || racer.finished) continue;
            const dx = (courseOffset(racer.distance) - courseX) / MINEFIELD_TUNING.blastAlongRadius;
            const dz = (racer.lateral - lateral) / MINEFIELD_TUNING.blastLateralRadius;
            if (dx * dx + dz * dz <= 1) mask |= 1 << lane;
        }
        return (mask | (1 << directLane)) >>> 0;
    }

    private updateMinePositions(): void {
        const halfWidth = Math.max(1, this.poolWidth * 0.5 - 0.8);
        for (let id = 0; id < this.mineStates.length; id++) {
            const mine = this.mineStates[id];
            const baseX = this.anchorCourseX[id];
            const baseZ = this.anchorLateral[id];
            mine.courseX = clamp(
                baseX + Math.sin(this.elapsed * MINEFIELD_TUNING.driftSpeed + this.phaseAlong[id]) * MINEFIELD_TUNING.driftAlongRadius,
                2.5, 47.5,
            );
            mine.lateral = clamp(
                baseZ + Math.sin(this.elapsed * MINEFIELD_TUNING.driftSpeed * 1.37 + this.phaseLateral[id]) * MINEFIELD_TUNING.driftLateralRadius,
                -halfWidth, halfWidth,
            );
        }
    }

    /**
     * 动态事件激活时，如果水雷正压在任一选手身上，先保持隐藏且无碰撞；
     * 只有房主确认扩大后的出生安全区连续清空后才启用，避免刷新同帧直接爆炸。
     */
    private resetSpawnSafety(): void {
        for (let id = 0; id < this.mineStates.length; id++) {
            const mine = this.mineStates[id];
            mine.armed = mine.active && !this.isSpawnBlocked(mine);
            this.spawnClearSeconds[id] = 0;
        }
    }

    private updateSpawnSafety(dt: number): void {
        for (let id = 0; id < this.mineStates.length; id++) {
            const mine = this.mineStates[id];
            if (!mine.active || mine.armed) continue;
            if (this.isSpawnBlocked(mine)) {
                this.spawnClearSeconds[id] = 0;
                continue;
            }
            const clearSeconds = this.spawnClearSeconds[id] + dt;
            this.spawnClearSeconds[id] = clearSeconds;
            if (clearSeconds >= MINEFIELD_TUNING.spawnClearSeconds) mine.armed = true;
        }
    }

    private isSpawnBlocked(mine: MinefieldMineState): boolean {
        for (let lane = 0; lane < this.laneCount; lane++) {
            const racer = this.racerForLane(lane);
            if (!racer?.active || racer.finished) continue;
            const dx = (courseOffset(racer.distance) - mine.courseX)
                / MINEFIELD_TUNING.spawnClearAlongRadius;
            const dz = (racer.lateral - mine.lateral)
                / MINEFIELD_TUNING.spawnClearLateralRadius;
            if (dx * dx + dz * dz <= 1) return true;
        }
        return false;
    }
}

function isMineAnchorExcluded(
    courseX: number,
    lateral: number,
    zone: MinefieldExclusionZone,
): boolean {
    return Math.abs(courseX - zone.courseX) < Math.max(0, zone.alongRadius)
        && Math.abs(lateral - zone.lateral) < Math.max(0, zone.lateralRadius);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function courseOffset(distance: number): number {
    const safe = Math.max(0, Number.isFinite(distance) ? distance : 0);
    const lap = Math.floor(safe / 50);
    const withinLap = safe % 50;
    return lap % 2 === 0 ? withinLap : 50 - withinLap;
}
