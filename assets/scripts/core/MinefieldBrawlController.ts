import { GameState } from './GameConstants';
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
    courseX: number;
    lateral: number;
    respawnSeconds: number;
};

export type MinefieldImpact = {
    mineId: number;
    hitLane: number;
    courseX: number;
    lateral: number;
    revision: number;
};

export type MinefieldSnapshotState = {
    revision: number;
    elapsedSeconds: number;
    activeMask: number;
    respawnSeconds: readonly number[];
};

export const MINEFIELD_TUNING = {
    mineCount: 7,
    contactAlongRadius: 1.35,
    contactLateralRadius: 1.05,
    driftAlongRadius: 0.75,
    driftLateralRadius: 0.58,
    driftSpeed: 0.72,
    respawnSeconds: 4.2,
    aiLookAhead: 5.5,
    aiAvoidOffset: 1.75,
};

const ANCHOR_X = [6.5, 12.5, 19.5, 27, 34.5, 41, 46] as const;
const ANCHOR_Z_RATIOS = [-0.54, 0.34, -0.12, 0.58, -0.4, 0.1, 0.46] as const;

/** 房主负责命中结果；访客只同步同一组确定性水雷的视觉和可靠命中事件。 */
export class MinefieldBrawlController {
    private revision = 0;
    private elapsed = 0;
    private readonly mineStates: MinefieldMineState[] = [];
    private readonly anchorCourseX: number[] = [];
    private readonly anchorLateral: number[] = [];
    private readonly phaseAlong: number[] = [];
    private readonly phaseLateral: number[] = [];
    private readonly previousRacerCourseX: number[];
    private readonly previousRacerLateral: number[];

    constructor(
        private readonly laneCount: number,
        seed: number,
        private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => MinefieldRacerState | null,
        private readonly onImpact: (impact: MinefieldImpact) => void,
    ) {
        const random = new SeededRandom((seed ^ 0x6d696e65) >>> 0);
        const halfWidth = Math.max(1, poolWidth * 0.5 - 0.8);
        const xOrder = random.shuffle([...ANCHOR_X]);
        const zOrder = random.shuffle([...ANCHOR_Z_RATIOS]);
        for (let id = 0; id < MINEFIELD_TUNING.mineCount; id++) {
            const anchorX = xOrder[id % xOrder.length];
            const anchorZ = zOrder[id % zOrder.length] * halfWidth;
            this.anchorCourseX.push(anchorX);
            this.anchorLateral.push(anchorZ);
            this.mineStates.push({
                id,
                active: true,
                courseX: anchorX,
                lateral: anchorZ,
                respawnSeconds: 0,
            });
            this.phaseAlong.push(random.range(0, Math.PI * 2));
            this.phaseLateral.push(random.range(0, Math.PI * 2));
        }
        this.previousRacerCourseX = new Array(laneCount).fill(Number.NaN);
        this.previousRacerLateral = new Array(laneCount).fill(Number.NaN);
        this.updateMinePositions();
    }

    reset(): void {
        this.revision = 0;
        this.elapsed = 0;
        for (const mine of this.mineStates) {
            mine.active = true;
            mine.respawnSeconds = 0;
        }
        this.previousRacerCourseX.fill(Number.NaN);
        this.previousRacerLateral.fill(Number.NaN);
        this.updateMinePositions();
    }

    update(dt: number, state: GameState, authoritative: boolean): void {
        if (state !== GameState.RACING) return;
        const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
        this.elapsed += step;
        for (const mine of this.mineStates) {
            if (!mine.active) {
                mine.respawnSeconds = Math.max(0, mine.respawnSeconds - step);
                if (mine.respawnSeconds <= 0) mine.active = true;
            }
        }
        this.updateMinePositions();
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
        const respawnSeconds: number[] = [];
        for (let id = 0; id < this.mineStates.length; id++) {
            const mine = this.mineStates[id];
            if (mine.active) activeMask |= 1 << id;
            respawnSeconds.push(mine.respawnSeconds);
        }
        return {
            revision: this.revision,
            elapsedSeconds: this.elapsed,
            activeMask,
            respawnSeconds,
        };
    }

    applySnapshotState(state: MinefieldSnapshotState): boolean {
        if (!Number.isSafeInteger(state.revision) || state.revision < this.revision
            || !Number.isFinite(state.elapsedSeconds) || state.elapsedSeconds < 0
            || !Number.isSafeInteger(state.activeMask) || state.activeMask < 0
            || state.respawnSeconds.length !== this.mineStates.length) return false;
        for (const remaining of state.respawnSeconds) {
            if (!Number.isFinite(remaining) || remaining < 0) return false;
        }
        this.revision = state.revision;
        this.elapsed = state.elapsedSeconds;
        for (let id = 0; id < this.mineStates.length; id++) {
            const mine = this.mineStates[id];
            mine.active = (state.activeMask & (1 << id)) !== 0;
            mine.respawnSeconds = mine.active ? 0 : state.respawnSeconds[id];
        }
        this.updateMinePositions();
        return true;
    }

    applyImpact(impact: MinefieldImpact): boolean {
        if (!Number.isSafeInteger(impact.mineId) || impact.mineId < 0 || impact.mineId >= this.mineStates.length
            || !Number.isSafeInteger(impact.hitLane) || impact.hitLane < 0 || impact.hitLane >= this.laneCount
            || !Number.isSafeInteger(impact.revision) || impact.revision <= this.revision
            || !Number.isFinite(impact.courseX) || !Number.isFinite(impact.lateral)) return false;
        this.revision = impact.revision;
        const mine = this.mineStates[impact.mineId];
        mine.active = false;
        mine.respawnSeconds = MINEFIELD_TUNING.respawnSeconds;
        return true;
    }

    targetZForAi(lane: number): number | null {
        const racer = this.racerForLane(lane);
        if (!racer?.active || racer.finished) return null;
        const courseX = courseOffset(racer.distance);
        let nearest: MinefieldMineState | null = null;
        let nearestAhead = Infinity;
        for (const mine of this.mineStates) {
            if (!mine.active) continue;
            const along = Math.abs(mine.courseX - courseX);
            if (along > MINEFIELD_TUNING.aiLookAhead || along >= nearestAhead) continue;
            if (Math.abs(mine.lateral - racer.lateral) > MINEFIELD_TUNING.contactLateralRadius * 2.2) continue;
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
            if (!mine.active) continue;
            const hit = Number.isFinite(previousX) && Math.abs(courseX - previousX) <= 5
                ? segmentHitsEllipse(previousX, previousZ, courseX, lateral, mine.courseX, mine.lateral)
                : ellipseContains(courseX, lateral, mine.courseX, mine.lateral);
            if (!hit) continue;
            const impact: MinefieldImpact = {
                mineId: mine.id,
                hitLane: lane,
                courseX: mine.courseX,
                lateral: mine.lateral,
                revision: this.revision + 1,
            };
            if (this.applyImpact(impact)) this.onImpact(impact);
            return;
        }
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
}

function ellipseContains(x: number, z: number, centerX: number, centerZ: number): boolean {
    const nx = (x - centerX) / MINEFIELD_TUNING.contactAlongRadius;
    const nz = (z - centerZ) / MINEFIELD_TUNING.contactLateralRadius;
    return nx * nx + nz * nz <= 1;
}

function segmentHitsEllipse(ax: number, az: number, bx: number, bz: number, centerX: number, centerZ: number): boolean {
    const sx = (ax - centerX) / MINEFIELD_TUNING.contactAlongRadius;
    const sz = (az - centerZ) / MINEFIELD_TUNING.contactLateralRadius;
    const ex = (bx - centerX) / MINEFIELD_TUNING.contactAlongRadius;
    const ez = (bz - centerZ) / MINEFIELD_TUNING.contactLateralRadius;
    const dx = ex - sx;
    const dz = ez - sz;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? clamp(-(sx * dx + sz * dz) / lengthSq, 0, 1) : 0;
    const px = sx + dx * t;
    const pz = sz + dz * t;
    return px * px + pz * pz <= 1;
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
