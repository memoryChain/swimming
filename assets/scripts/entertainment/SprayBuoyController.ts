import { SPRAY_BUOY_TUNING } from '../core/EntertainmentBalance';
import { GameState } from '../core/GameConstants';
import { expandedEllipseContains, segmentHitsExpandedEllipse } from './RaceContactGeometry';
import { SeededRandom } from '../core/SharedRNG';
type ObstacleBuoyAnchor = Readonly<{ courseX: number; lateral: number }>;

export type SprayBuoyRacerState = {
    active: boolean;
    finished: boolean;
    distance: number;
    lateral: number;
};

export type SprayBuoyMineState = {
    id: number;
    generation: number;
    active: boolean;
    armed: boolean;
    courseX: number;
    lateral: number;
};

export type SprayBuoyImpact = {
    elapsedSeconds?: number;
    mineId: number;
    hitLane: number;
    courseX: number;
    lateral: number;
    hitMask: number;
    revision: number;
};

export { SPRAY_BUOY_TUNING } from '../core/EntertainmentBalance';

const ANCHOR_X = [6.5, 12.5, 19.5, 27, 34.5, 41, 46] as const;
const ANCHOR_Z_RATIOS = [-0.54, 0.34, -0.12, 0.58, -0.4, 0.1, 0.46] as const;
const INTENSE_ANCHOR_X = [...ANCHOR_X, 9, 16, 23, 37, 44] as const;
const INTENSE_ANCHOR_Z_RATIOS = [...ANCHOR_Z_RATIOS, 0.65, -0.65, 0.02, -0.22, 0.22] as const;

type SprayBuoyWaveLayout = {
    lateral: number[];
    phaseAlong: number[];
    phaseLateral: number[];
};

/** 浮标原有的布局、漂移、出生安全与范围命中；本批仅由本地娱乐调试创建。 */
export class SprayBuoyController {
    private revision = 0;
    private elapsed = 0;
    private waveIndex = 0;
    private activeMineCount = 0;
    private armedOnceCount = 0;
    private readonly mineStates: SprayBuoyMineState[] = [];
    private readonly anchorCourseX: number[] = [];
    private readonly anchorLateral: number[] = [];
    private readonly phaseAlong: number[] = [];
    private readonly phaseLateral: number[] = [];
    private readonly spawnClearSeconds: number[] = [];
    private readonly previousRacerCourseX: number[];
    private readonly previousRacerLateral: number[];
    private readonly waveLayouts: SprayBuoyWaveLayout[] = [];

    constructor(
        private readonly laneCount: number,
        seed: number,
        private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => SprayBuoyRacerState | null,
        private readonly onImpact: (impact: SprayBuoyImpact) => void,
        mineCount: number = SPRAY_BUOY_TUNING.mineCount,
        private readonly waveTriggerDistances: readonly number[] = [],
        plannedAnchors?: readonly ObstacleBuoyAnchor[],
        private readonly courseLength = 50,
    ) {
        const random = new SeededRandom((seed ^ 0x6d696e65) >>> 0);
        const halfWidth = Math.max(1, poolWidth * 0.5 - 0.8);
        const count = plannedAnchors
            ? Math.min(INTENSE_ANCHOR_X.length, plannedAnchors.length)
            : Math.max(1, Math.min(INTENSE_ANCHOR_X.length, Math.floor(mineCount)));
        const xOrder = random.shuffle([...(count <= ANCHOR_X.length ? ANCHOR_X : INTENSE_ANCHOR_X)]);
        const zOrder = random.shuffle([...(count <= ANCHOR_Z_RATIOS.length
            ? ANCHOR_Z_RATIOS : INTENSE_ANCHOR_Z_RATIOS)]);
        const candidates = plannedAnchors
            ? plannedAnchors.map(anchor => ({ anchorX: anchor.courseX, anchorZ: anchor.lateral }))
            : xOrder.map((anchorX, index) => ({
                anchorX: anchorX * courseLength / 50,
                anchorZ: zOrder[index % zOrder.length] * halfWidth,
            }));
        for (let id = 0; id < count; id++) {
            const { anchorX, anchorZ } = candidates[id];
            this.anchorCourseX.push(anchorX);
            this.anchorLateral.push(anchorZ);
            this.mineStates.push({
                id,
                generation: 0,
                active: true,
                armed: false,
                courseX: anchorX,
                lateral: anchorZ,
            });
            this.phaseAlong.push(random.range(0, Math.PI * 2));
            this.phaseLateral.push(random.range(0, Math.PI * 2));
            this.spawnClearSeconds.push(0);
        }
        this.waveLayouts.push({
            lateral: [...this.anchorLateral],
            phaseAlong: [...this.phaseAlong],
            phaseLateral: [...this.phaseLateral],
        });
        for (let wave = 1; wave <= this.waveTriggerDistances.length; wave++) {
            const waveRandom = new SeededRandom((seed ^ 0x6d696e65 ^ Math.imul(wave, 0x9e3779b1)) >>> 0);
            const waveZOrder = waveRandom.shuffle([...(count <= ANCHOR_Z_RATIOS.length
                ? ANCHOR_Z_RATIOS : INTENSE_ANCHOR_Z_RATIOS)]);
            const lateral: number[] = [];
            const phaseAlong: number[] = [];
            const phaseLateral: number[] = [];
            for (let id = 0; id < count; id++) {
                lateral.push(waveZOrder[id % waveZOrder.length] * halfWidth);
                phaseAlong.push(waveRandom.range(0, Math.PI * 2));
                phaseLateral.push(waveRandom.range(0, Math.PI * 2));
            }
            this.waveLayouts.push({ lateral, phaseAlong, phaseLateral });
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
        this.waveIndex = 0;
        this.activeMineCount = this.mineStates.length;
        this.armedOnceCount = 0;
        for (const mine of this.mineStates) {
            mine.generation = 0;
            mine.active = true;
            mine.armed = false;
        }
        this.applyWaveLayoutToAllSlots(0);
        this.spawnClearSeconds.fill(0);
        this.previousRacerCourseX.fill(Number.NaN);
        this.previousRacerLateral.fill(Number.NaN);
        this.updateMinePositions();
        this.resetSpawnSafety();
    }

    update(
        dt: number,
        state: GameState,
        leaderDistance = 0,
        allowNewWaves = true,
    ): void {
        if (state !== GameState.RACING) return;
        const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
        this.elapsed += step;
        this.updateMinePositions();
        if (allowNewWaves) this.updateWaves(leaderDistance);
        if (this.activeMineCount <= 0) return;
        this.updateSpawnSafety(step);
        for (let lane = 0; lane < this.laneCount; lane++) {
            const racer = this.racerForLane(lane);
            const courseX = courseOffset(racer?.distance ?? 0, this.courseLength);
            const lateral = racer?.lateral ?? 0;
            if (racer?.active && !racer.finished) {
                this.testRacer(lane, courseX, lateral);
            }
            this.previousRacerCourseX[lane] = racer?.active && !racer.finished ? courseX : Number.NaN;
            this.previousRacerLateral[lane] = racer?.active && !racer.finished ? lateral : Number.NaN;
        }
    }

    mines(): readonly SprayBuoyMineState[] { return this.mineStates; }
    armedMineCount(): number { return this.armedOnceCount; }

    /** 事件截止时撤销仍因出生安全而隐藏的浮标；已经上浮的浮标自然驻留。 */
    cancelUnarmedMines(): void {
        let changed = false;
        for (const mine of this.mineStates) {
            if (!mine.active || mine.armed) continue;
            mine.active = false;
            this.activeMineCount--;
            changed = true;
        }
        if (changed) this.revision++;
    }

    applyImpact(impact: SprayBuoyImpact): boolean {
        if (!Number.isSafeInteger(impact.mineId) || impact.mineId < 0 || impact.mineId >= this.mineStates.length
            || !Number.isSafeInteger(impact.hitLane) || impact.hitLane < 0 || impact.hitLane >= this.laneCount
            || !Number.isSafeInteger(impact.hitMask) || impact.hitMask < 0
            || !Number.isSafeInteger(impact.revision) || impact.revision <= 0
            || !Number.isFinite(impact.courseX) || !Number.isFinite(impact.lateral)) return false;
        if (impact.elapsedSeconds !== undefined
            && (!Number.isFinite(impact.elapsedSeconds) || this.elapsed - impact.elapsedSeconds > 3)) return false;
        if (impact.revision <= this.revision) return false;
        this.revision = Math.max(this.revision, impact.revision);
        const mine = this.mineStates[impact.mineId];
        if (mine.active) this.activeMineCount = Math.max(0, this.activeMineCount - 1);
        mine.active = false;
        mine.armed = false;
        return true;
    }

    targetZForAi(lane: number): number | null {
        const racer = this.racerForLane(lane);
        if (!racer?.active || racer.finished) return null;
        const courseX = courseOffset(racer.distance, this.courseLength);
        let nearest: SprayBuoyMineState | null = null;
        let nearestAhead = Infinity;
        for (const mine of this.mineStates) {
            if (!mine.active || !mine.armed) continue;
            const along = Math.abs(mine.courseX - courseX);
            if (along > SPRAY_BUOY_TUNING.aiLookAhead || along >= nearestAhead) continue;
            const contactLateralRadius = SPRAY_BUOY_TUNING.mineItemLateralRadius
                + SPRAY_BUOY_TUNING.swimmerContactLateralRadius;
            if (Math.abs(mine.lateral - racer.lateral) > contactLateralRadius * 2.2) continue;
            nearest = mine;
            nearestAhead = along;
        }
        if (!nearest) return null;
        const halfWidth = Math.max(0.8, this.poolWidth * 0.5 - 0.7);
        const side = racer.lateral <= nearest.lateral ? -1 : 1;
        return clamp(nearest.lateral + side * SPRAY_BUOY_TUNING.aiAvoidOffset, -halfWidth, halfWidth);
    }

    private testRacer(lane: number, courseX: number, lateral: number): void {
        const previousX = this.previousRacerCourseX[lane];
        const previousZ = this.previousRacerLateral[lane];
        for (const mine of this.mineStates) {
            if (!mine.active || !mine.armed) continue;
            const hit = Number.isFinite(previousX) && Math.abs(courseX - previousX) <= 5
                ? segmentHitsExpandedEllipse(
                    previousX, previousZ, courseX, lateral, mine.courseX, mine.lateral,
                    SPRAY_BUOY_TUNING.mineItemAlongRadius,
                    SPRAY_BUOY_TUNING.mineItemLateralRadius,
                    SPRAY_BUOY_TUNING.swimmerContactAlongRadius,
                    SPRAY_BUOY_TUNING.swimmerContactLateralRadius,
                )
                : expandedEllipseContains(
                    courseX, lateral, mine.courseX, mine.lateral,
                    SPRAY_BUOY_TUNING.mineItemAlongRadius,
                    SPRAY_BUOY_TUNING.mineItemLateralRadius,
                    SPRAY_BUOY_TUNING.swimmerContactAlongRadius,
                    SPRAY_BUOY_TUNING.swimmerContactLateralRadius,
                );
            if (!hit) continue;
            const impact: SprayBuoyImpact = {
                mineId: mine.id,
                hitLane: lane,
                courseX: mine.courseX,
                lateral: mine.lateral,
                hitMask: this.blastHitMask(mine.courseX, mine.lateral, lane),
                revision: this.revision + 1,
                elapsedSeconds: this.elapsed,
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
            const dx = (courseOffset(racer.distance, this.courseLength) - courseX) / SPRAY_BUOY_TUNING.blastAlongRadius;
            const dz = (racer.lateral - lateral) / SPRAY_BUOY_TUNING.blastLateralRadius;
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
                baseX + Math.sin(this.elapsed * SPRAY_BUOY_TUNING.driftSpeed + this.phaseAlong[id]) * SPRAY_BUOY_TUNING.driftAlongRadius,
                2.5, Math.max(2.5, this.courseLength - 2.5),
            );
            mine.lateral = clamp(
                baseZ + Math.sin(this.elapsed * SPRAY_BUOY_TUNING.driftSpeed * 1.37 + this.phaseLateral[id]) * SPRAY_BUOY_TUNING.driftLateralRadius,
                -halfWidth, halfWidth,
            );
        }
    }

    private updateWaves(leaderDistance: number): void {
        const safeLeaderDistance = Number.isFinite(leaderDistance) ? Math.max(0, leaderDistance) : 0;
        while (this.waveIndex < this.waveTriggerDistances.length
            && safeLeaderDistance >= this.waveTriggerDistances[this.waveIndex]) {
            this.refillWave(this.waveIndex + 1);
        }
    }

    private refillWave(nextWave: number): void {
        if (nextWave <= this.waveIndex || nextWave >= this.waveLayouts.length) return;
        this.waveIndex = nextWave;
        this.revision++;
        for (let id = 0; id < this.mineStates.length; id++) {
            const mine = this.mineStates[id];
            if (mine.active) continue;
            this.configureSlotForWave(id, nextWave);
            mine.active = true;
            mine.armed = false;
            this.spawnClearSeconds[id] = 0;
            this.activeMineCount++;
        }
        this.updateMinePositions();
    }

    private applyWaveLayoutToAllSlots(wave: number): void {
        for (let id = 0; id < this.mineStates.length; id++) this.configureSlotForWave(id, wave);
    }

    private configureSlotForWave(id: number, wave: number): void {
        const layout = this.waveLayouts[wave];
        const mine = this.mineStates[id];
        if (!layout || !mine) return;
        mine.generation = wave;
        this.anchorLateral[id] = layout.lateral[id];
        this.phaseAlong[id] = layout.phaseAlong[id];
        this.phaseLateral[id] = layout.phaseLateral[id];
    }

    /**
     * 动态事件激活时，如果水雷正压在任一选手身上，先保持隐藏且无碰撞；
     * 只有扩大后的出生安全区连续清空后才启用，避免刷新同帧直接爆炸。
     */
    private resetSpawnSafety(): void {
        this.armedOnceCount = 0;
        for (let id = 0; id < this.mineStates.length; id++) {
            const mine = this.mineStates[id];
            mine.armed = mine.active && !this.isSpawnBlocked(mine);
            if (mine.armed) this.armedOnceCount++;
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
            if (clearSeconds >= SPRAY_BUOY_TUNING.spawnClearSeconds) {
                mine.armed = true;
                this.armedOnceCount++;
            }
        }
    }

    private isSpawnBlocked(mine: SprayBuoyMineState): boolean {
        for (let lane = 0; lane < this.laneCount; lane++) {
            const racer = this.racerForLane(lane);
            if (!racer?.active || racer.finished) continue;
            const dx = (courseOffset(racer.distance, this.courseLength) - mine.courseX)
                / SPRAY_BUOY_TUNING.spawnClearAlongRadius;
            const dz = (racer.lateral - mine.lateral)
                / SPRAY_BUOY_TUNING.spawnClearLateralRadius;
            if (dx * dx + dz * dz <= 1) return true;
        }
        return false;
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function courseOffset(distance: number, courseLength: number): number {
    const safe = Math.max(0, Number.isFinite(distance) ? distance : 0);
    const lap = Math.floor(safe / courseLength);
    const withinLap = safe % courseLength;
    return lap % 2 === 0 ? withinLap : courseLength - withinLap;
}
