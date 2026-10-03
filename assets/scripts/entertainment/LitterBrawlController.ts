import { GameState } from '../core/GameConstants';
import { expandedEllipseContains, segmentHitsExpandedEllipse } from './RaceContactGeometry';

// 综合轻事件的补投保护间隔，不允许把被主事件挡住的多波连成垃圾雨。
export const ENTERTAINMENT_LITTER_MIN_WAVE_INTERVAL_SECONDS = 8;

import { LITTER_BRAWL_TUNING } from '../core/EntertainmentBalance';
export { LITTER_BRAWL_TUNING } from '../core/EntertainmentBalance';

/** 统一娱乐模式只覆盖投放数量和赛程锚点，垃圾本体规则继续共用。 */
export const LITTER_BRAWL_ENTERTAINMENT_TUNING = {
    shortWaveOffsets: [0, 7] as readonly number[],
    longWaveOffsets: [0, 6, 12] as readonly number[],
    finishSafetyDistance: 2,
};

export type LitterBrawlSchedule = Readonly<{
    waveDistances: readonly number[];
    /** Optional whole-race counts; absent for existing single-event and solo schedules. */
    waveCounts?: readonly number[];
    landingLeadDistance: number;
}>;

export type LitterBrawlIntensitySettings = Readonly<{
    itemsPerWave: number;
    poolSize: number;
}>;

export const LITTER_BRAWL_INDEPENDENT_SCHEDULE: LitterBrawlSchedule = {
    waveDistances: LITTER_BRAWL_TUNING.waveDistances,
    landingLeadDistance: LITTER_BRAWL_TUNING.landingLeadDistance,
};

/** 仅在事件激活边沿调用；返回的新数组不会进入比赛帧热路径。 */
export function buildEntertainmentLitterSchedule(
    anchorDistance: number,
    raceDistance: number,
    waveCount?: number,
): LitterBrawlSchedule {
    const safeRaceDistance = Number.isFinite(raceDistance) ? Math.max(1, raceDistance) : 200;
    const safeAnchor = Number.isFinite(anchorDistance) ? Math.max(0, anchorDistance) : 0;
    const defaultOffsets = safeRaceDistance >= 400
        ? LITTER_BRAWL_ENTERTAINMENT_TUNING.longWaveOffsets
        : LITTER_BRAWL_ENTERTAINMENT_TUNING.shortWaveOffsets;
    const offsets = waveCount === undefined ? defaultOffsets
        : Array.from({ length: Math.max(1, Math.min(6, Math.floor(waveCount))) }, (_, index) =>
            index * (safeRaceDistance >= 400 ? 6 : 7));
    const maxTriggerDistance = Math.max(0, safeRaceDistance
        - LITTER_BRAWL_TUNING.landingLeadDistance
        - LITTER_BRAWL_ENTERTAINMENT_TUNING.finishSafetyDistance);
    const waveDistances: number[] = [];
    for (const offset of offsets) {
        const distance = clamp(safeAnchor + offset, 0, maxTriggerDistance);
        if (waveDistances.length === 0 || distance > waveDistances[waveDistances.length - 1] + 0.01) {
            waveDistances.push(distance);
        }
    }
    return {
        waveDistances,
        landingLeadDistance: LITTER_BRAWL_TUNING.landingLeadDistance,
    };
}

export type LitterPhase = 'falling' | 'floating' | 'retiring';
export type LitterKind = 'rigid' | 'soft';

export type LitterClusterState = {
    readonly id: number;
    active: boolean;
    generation: number;
    wave: number;
    phase: LitterPhase;
    phaseProgress: number;
    kind: LitterKind;
    courseX: number;
    lateral: number;
    anchorCourseX: number;
    anchorLateral: number;
    safeCenter: number;
    throwSide: -1 | 1;
    visualVariant: number;
    impactRevision: number;
    spawnOrder: number;
};

export type LitterRigidImpact = {
    slotId: number;
    generation: number;
    lane: number;
    away: -1 | 1;
    courseX: number;
    lateral: number;
    revision: number;
};

export type LitterContact = LitterRigidImpact & {
    elapsedSeconds?: number;
    kind: LitterKind;
    bounceAlongVelocity: number;
    bounceLateralVelocity: number;
};

export type LitterWaveSafetyCheck = (
    courseX: number,
    safeCenter: number,
    safeHalfWidth: number,
) => boolean;

/** 事件激活边沿的纯计算；调用方直接传标量，避免在比赛帧里构造临时障碍对象。 */
export function litterCorridorOverlapsObstacle(
    courseX: number,
    safeCenter: number,
    safeHalfWidth: number,
    obstacleCourseX: number,
    obstacleLateral: number,
    obstacleAlongRadius: number,
    obstacleLateralRadius: number,
): boolean {
    return Math.abs(obstacleCourseX - courseX) <= Math.max(0, obstacleAlongRadius)
        && Math.abs(obstacleLateral - safeCenter)
            <= Math.max(0, safeHalfWidth) + Math.max(0, obstacleLateralRadius);
}

export type LitterRacerState = {
    active: boolean;
    finished: boolean;
    distance: number;
    lateral: number;
};

type LitterSlot = LitterClusterState & {
    age: number;
    driftPhase: number;
    spawnOrder: number;
    insideMask: number;
    bounceAlongVelocity: number;
    bounceLateralVelocity: number;
    retireStartCourseX: number;
    retireStartLateral: number;
};

/**
 * 单机调试模式的确定性垃圾波次。软垃圾输出连续环境阻力；
 * 硬垃圾只发出一次接触事件，由编排层结算反弹和瞬时减速。
 */
export type LitterBrawlOptions = Readonly<{
    schedule?: LitterBrawlSchedule;
    intensity?: LitterBrawlIntensitySettings;
    onWave?: (wave: number) => void;
    onRigidImpact?: (impact: LitterRigidImpact) => void;
    isWaveSafe?: LitterWaveSafetyCheck;
    onContact?: (contact: LitterContact) => void;
    plannedSafeCenter?: (wave: number, courseX: number) => number;
    isPlannedSpotSafe?: (courseX: number, lateral: number) => boolean;
    minimumWaveIntervalSeconds?: number;
    soloLandingSearchMeters?: number;
    canSpawnWave?: () => boolean;
    maxWaveDelayDistance?: number;
    followLeaderOnDeferredWave?: boolean;
    courseLength?: number;
}>;

export class LitterBrawlController {
    private readonly onWave: (wave: number) => void;
    private readonly onRigidImpact: (impact: LitterRigidImpact) => void;
    private readonly isWaveSafe: LitterWaveSafetyCheck;
    private readonly onContact: (contact: LitterContact) => void;
    private readonly plannedSafeCenter: (wave: number, courseX: number) => number;
    private readonly isPlannedSpotSafe: (courseX: number, lateral: number) => boolean;
    private readonly minimumWaveIntervalSeconds: number;
    private readonly soloLandingSearchMeters: number;
    private readonly canSpawnWave: () => boolean;
    private readonly maxWaveDelayDistance: number;
    private readonly followLeaderOnDeferredWave: boolean;
    private readonly courseLength: number;

    private readonly slots: LitterSlot[];
    private readonly randomSeed: number;
    private randomState: number;
    private nextWave = 0;
    private spawnOrder = 0;
    private activeSlotCount = 0;
    private spawnRetryRemaining = 0;
    private blockedWaveSeconds = 0;
    private cancelledWaveCount = 0;
    private revision = 0;
    private elapsedSeconds = 0;
    private waveDistances: readonly number[] = LITTER_BRAWL_INDEPENDENT_SCHEDULE.waveDistances;
    private waveCounts: readonly number[] | null = null;
    private waveStartOrders: readonly number[] = [];
    private landingLeadDistance = LITTER_BRAWL_INDEPENDENT_SCHEDULE.landingLeadDistance;
    private readonly previousRacerCourseX: number[];
    private readonly previousRacerLateral: number[];
    private readonly itemsPerWave: number;

    constructor(
        private readonly laneCount: number,
        seed: number,
        private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => LitterRacerState | null,
        options: LitterBrawlOptions = {},
    ) {
        const intensity = options.intensity;
        const schedule = options.schedule ?? LITTER_BRAWL_INDEPENDENT_SCHEDULE;
        this.onWave = options.onWave;
        this.onRigidImpact = options.onRigidImpact;
        this.isWaveSafe = options.isWaveSafe;
        this.onContact = options.onContact;
        this.plannedSafeCenter = options.plannedSafeCenter;
        this.isPlannedSpotSafe = options.isPlannedSpotSafe;
        this.minimumWaveIntervalSeconds = options.minimumWaveIntervalSeconds ?? 0;
        this.soloLandingSearchMeters = options.soloLandingSearchMeters ?? 0;
        this.canSpawnWave = options.canSpawnWave;
        this.maxWaveDelayDistance = options.maxWaveDelayDistance ?? Number.POSITIVE_INFINITY;
        this.followLeaderOnDeferredWave = options.followLeaderOnDeferredWave ?? false;
        this.courseLength = options.courseLength ?? 50;
        this.randomSeed = ((seed ^ 0x6c697474) >>> 0) || 0x9e3779b9;
        this.randomState = this.randomSeed;
        this.itemsPerWave = intensity?.itemsPerWave ?? LITTER_BRAWL_TUNING.waveCount;
        this.slots = Array.from({ length: intensity?.poolSize ?? LITTER_BRAWL_TUNING.poolSize }, (_, id): LitterSlot => ({
            id,
            active: false,
            generation: 0,
            wave: -1,
            phase: 'falling',
            phaseProgress: 0,
            kind: id % 2 === 0 ? 'rigid' : 'soft',
            courseX: 0,
            lateral: 0,
            safeCenter: 0,
            throwSide: 1,
            visualVariant: id % 3,
            impactRevision: 0,
            age: 0,
            anchorCourseX: 0,
            anchorLateral: 0,
            driftPhase: 0,
            spawnOrder: -1,
            insideMask: 0,
            bounceAlongVelocity: 0,
            bounceLateralVelocity: 0,
            retireStartCourseX: 0,
            retireStartLateral: 0,
        }));
        this.previousRacerCourseX = Array.from({ length: laneCount }, () => Number.NaN);
        this.previousRacerLateral = Array.from({ length: laneCount }, () => 0);
        this.applySchedule(schedule);
    }

    reset(): void {
        this.nextWave = 0;
        this.spawnOrder = 0;
        this.activeSlotCount = 0;
        this.spawnRetryRemaining = 0;
        this.blockedWaveSeconds = 0;
        this.cancelledWaveCount = 0;
        this.revision = 0;
        this.elapsedSeconds = 0;
        this.randomState = this.randomSeed;
        for (const slot of this.slots) {
            slot.active = false;
            slot.age = 0;
            slot.phase = 'falling';
            slot.phaseProgress = 0;
            slot.spawnOrder = -1;
            slot.insideMask = 0;
            slot.bounceAlongVelocity = 0;
            slot.bounceLateralVelocity = 0;
            slot.retireStartCourseX = 0;
            slot.retireStartLateral = 0;
        }
        this.previousRacerCourseX.fill(Number.NaN);
        this.previousRacerLateral.fill(0);
    }

    /** 切换赛程只重置本控制器实例，不修改独立玩法或全局调参。 */
    restart(schedule?: LitterBrawlSchedule): void {
        if (schedule) this.applySchedule(schedule);
        this.reset();
    }

    /** 首位完赛或导演收尾时只取消尚未投放的波次，已出现垃圾自然漂流和下沉。 */
    cancelPendingWaves(): void {
        if (this.nextWave >= this.waveDistances.length) return;
        this.cancelledWaveCount += this.waveDistances.length - this.nextWave;
        this.nextWave = this.waveDistances.length;
        this.spawnRetryRemaining = 0;
        this.blockedWaveSeconds = 0;
        this.revision++;
    }

    pendingWaveCount(): number {
        return Math.max(0, this.waveDistances.length - this.nextWave);
    }

    activeCount(): number {
        return this.activeSlotCount;
    }

    spawnedItemCount(): number { return this.spawnOrder; }

    cancelledCount(): number {
        return this.cancelledWaveCount;
    }

    isComplete(): boolean {
        return this.pendingWaveCount() === 0 && this.activeCount() === 0;
    }

    dispose(): void {
        this.reset();
    }

    clusters(): readonly LitterClusterState[] {
        return this.slots;
    }

    update(dt: number, state: GameState): void {
        if (state !== GameState.RACING) return;
        if (this.nextWave >= this.waveDistances.length && this.activeCount() === 0) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.elapsedSeconds += step;
        this.updatePendingWaves(step, this.leaderDistance());
        for (const slot of this.slots) {
            if (!slot.active) continue;
            slot.age += step;
            const activeAge = slot.age - this.burstDelayForSpawnOrder(slot.spawnOrder, slot.wave);
            if (activeAge < 0) {
                slot.phase = 'falling';
                slot.phaseProgress = -1;
                slot.courseX = slot.anchorCourseX;
                slot.lateral = slot.anchorLateral;
                continue;
            }
            if (activeAge < LITTER_BRAWL_TUNING.fallingSeconds) {
                slot.phase = 'falling';
                slot.phaseProgress = clamp01(activeAge / LITTER_BRAWL_TUNING.fallingSeconds);
                slot.courseX = slot.anchorCourseX;
                slot.lateral = slot.anchorLateral;
                continue;
            }
            const driftTime = activeAge - LITTER_BRAWL_TUNING.fallingSeconds;
            if (driftTime >= LITTER_BRAWL_TUNING.floatingLifetime) {
                if (slot.phase !== 'retiring') this.beginRetirement(slot);
                const retireProgress = clamp01(
                    (driftTime - LITTER_BRAWL_TUNING.floatingLifetime) / LITTER_BRAWL_TUNING.retireSeconds,
                );
                slot.phase = 'retiring';
                slot.phaseProgress = retireProgress;
                const settle = 1 - smoothstep(retireProgress);
                const courseWander = Math.sin(retireProgress * Math.PI) * 0.08 * settle
                    * (Math.sin(slot.driftPhase) >= 0 ? 1 : -1);
                const lateralWander = Math.sin(retireProgress * Math.PI * 1.3 + slot.driftPhase) * 0.1 * settle;
                slot.courseX = clamp(slot.retireStartCourseX + courseWander, 1.2, this.courseLength - 1.2);
                slot.lateral = clamp(
                    slot.retireStartLateral + lateralWander,
                    -this.usableHalfWidth(),
                    this.usableHalfWidth(),
                );
                if (retireProgress >= 1) {
                    slot.active = false;
                    slot.insideMask = 0;
                    this.activeSlotCount = Math.max(0, this.activeSlotCount - 1);
                }
                continue;
            }
            slot.phase = 'floating';
            slot.phaseProgress = 1;
            slot.anchorCourseX = clamp(slot.anchorCourseX + slot.bounceAlongVelocity * step, 1.2, this.courseLength - 1.2);
            slot.anchorLateral = clamp(slot.anchorLateral + slot.bounceLateralVelocity * step,
                -this.usableHalfWidth(), this.usableHalfWidth());
            // 轻塑料瓶快速滚开；泡沫餐盒初速度更低，但会被水流带得更久。
            const bounceDamping = slot.kind === 'soft' ? LITTER_BRAWL_TUNING.softDebrisPushDamping : 2.8;
            const bounceDecay = Math.exp(-bounceDamping * step);
            slot.bounceAlongVelocity *= bounceDecay;
            slot.bounceLateralVelocity *= bounceDecay;
            const driftEntryBlend = smoothstep(clamp01(
                driftTime / Math.max(0.01, LITTER_BRAWL_TUNING.driftEntryBlendSeconds),
            ));
            slot.courseX = clamp(
                slot.anchorCourseX
                    + (
                        Math.sin(driftTime * LITTER_BRAWL_TUNING.driftSpeed + slot.driftPhase) * 0.72
                        + Math.sin(driftTime * LITTER_BRAWL_TUNING.driftSpeed * 0.37 + slot.driftPhase * 1.83) * 0.28
                    ) * LITTER_BRAWL_TUNING.driftAlongRadius * driftEntryBlend,
                1.2,
                this.courseLength - 1.2,
            );
            const halfWidth = this.usableHalfWidth();
            slot.lateral = clamp(
                slot.anchorLateral
                    + (
                        Math.cos(driftTime * LITTER_BRAWL_TUNING.driftSpeed * 0.81 + slot.driftPhase * 1.17) * 0.68
                        + Math.sin(driftTime * LITTER_BRAWL_TUNING.driftSpeed * 0.29 + slot.driftPhase * 2.11) * 0.32
                    ) * LITTER_BRAWL_TUNING.driftLateralRadius * driftEntryBlend,
                -halfWidth,
                halfWidth,
            );
        }
        this.resolveLitterContacts();
        this.rememberRacerPositions();
    }

    environmentDragForLane(lane: number): number {
        if (this.activeSlotCount === 0) return 0;
        const racer = this.racerForLane(lane);
        if (!racer?.active || racer.finished) return 0;
        const courseX = courseOffset(racer.distance, this.courseLength);
        let strongest = 0;
        for (const slot of this.slots) {
            if (!slot.active || slot.phase !== 'floating' || slot.kind !== 'soft') continue;
            const nx = (courseX - slot.courseX) / LITTER_BRAWL_TUNING.contactAlongRadius;
            const nz = (racer.lateral - slot.lateral) / LITTER_BRAWL_TUNING.contactLateralRadius;
            const radiusSq = nx * nx + nz * nz;
            // 浮点运算可能让理论边界得到 0 附近的极小正值；边界外必须明确无阻力。
            if (radiusSq >= 1 - 1e-9) continue;
            const softness = 1 - radiusSq;
            strongest = Math.max(strongest, softness * softness * LITTER_BRAWL_TUNING.maxEnvironmentDrag);
        }
        return strongest;
    }

    targetZForAi(lane: number): number | null {
        if (this.activeSlotCount === 0) return null;
        const racer = this.racerForLane(lane);
        if (!racer?.active || racer.finished) return null;
        const courseX = courseOffset(racer.distance, this.courseLength);
        const direction = courseDirection(racer.distance, this.courseLength);
        let nearest: LitterSlot | null = null;
        let nearestAhead = Number.POSITIVE_INFINITY;
        for (const slot of this.slots) {
            if (!slot.active || slot.phase !== 'floating') continue;
            const ahead = (slot.courseX - courseX) * direction;
            if (ahead < -0.5 || ahead > LITTER_BRAWL_TUNING.aiLookAhead) continue;
            const lateralRadius = slot.kind === 'rigid'
                ? LITTER_BRAWL_TUNING.rigidItemLateralRadius + LITTER_BRAWL_TUNING.swimmerContactLateralRadius
                : Math.max(
                    LITTER_BRAWL_TUNING.contactLateralRadius,
                    LITTER_BRAWL_TUNING.softPushContactLateralRadius + LITTER_BRAWL_TUNING.swimmerContactLateralRadius,
                );
            if (Math.abs(racer.lateral - slot.lateral) > lateralRadius + (slot.kind === 'rigid' ? 0.75 : 0.2)) continue;
            if (ahead < nearestAhead) {
                nearest = slot;
                nearestAhead = ahead;
            }
        }
        return nearest ? clamp(nearest.safeCenter, -this.usableHalfWidth(), this.usableHalfWidth()) : null;
    }

    private updatePendingWaves(step: number, leaderDistance: number): void {
        // 先结算过期波次，再检查临时门控；主事件不能让过期计划无限积压。
        while (this.nextWave < this.waveDistances.length
            && leaderDistance > this.waveDistances[this.nextWave]
                + this.maxWaveDelayDistance * (this.nextWave === 0 ? 2 : 1)) {
            this.nextWave++;
            this.cancelledWaveCount++;
            this.revision++;
            this.blockedWaveSeconds = 0;
        }
        if (this.nextWave >= this.waveDistances.length) return;
        // 上一波入场间隔从实际投放时开始计时，不能等到下一进度锚点才开始倒计时。
        if (this.minimumWaveIntervalSeconds > 0 && this.nextWave > 0
            && this.blockedWaveSeconds === 0 && this.spawnRetryRemaining > 0) {
            this.spawnRetryRemaining = Math.max(0, this.spawnRetryRemaining - step);
        }
        if (leaderDistance < this.waveDistances[this.nextWave]) return;
        if (this.canSpawnWave && !this.canSpawnWave()) return;
        // 先守住两次实际投放的间隔；对象池等待不能覆盖已经保存的补投冷却。
        if (this.minimumWaveIntervalSeconds > 0 && this.nextWave > 0
            && this.blockedWaveSeconds === 0 && this.spawnRetryRemaining > 0) return;
        // 对象池暂满只意味着旧垃圾尚未完成下沉，不应把后续正式波次误判为安全取消。
        if (this.freeSlotCount() < this.itemsInWave(this.nextWave)) {
            this.spawnRetryRemaining = LITTER_BRAWL_TUNING.spawnSafetyRetrySeconds;
            return;
        }
        // 融合事件的上一波冷却占用现有快照字段，不能算作出生安全失败。
        this.blockedWaveSeconds += step;
        this.spawnRetryRemaining = Math.max(0, this.spawnRetryRemaining - step);
        if (this.spawnRetryRemaining > 0) return;
        const wave = this.nextWave;
        if (this.spawnWave(wave, leaderDistance)) {
            this.onWave?.(wave);
            this.nextWave++;
            this.revision++;
            this.spawnRetryRemaining = this.minimumWaveIntervalSeconds;
            this.blockedWaveSeconds = 0;
            // 旧独立规则仍允许同帧补齐；融合障碍分批投放，避免连续轰炸。
            if (this.minimumWaveIntervalSeconds <= 0) this.updatePendingWaves(0, leaderDistance);
            return;
        }
        if (this.blockedWaveSeconds >= LITTER_BRAWL_TUNING.maxSpawnDelaySeconds) {
            this.nextWave++;
            this.cancelledWaveCount++;
            this.revision++;
            this.spawnRetryRemaining = 0;
            this.blockedWaveSeconds = 0;
            return;
        }
        this.spawnRetryRemaining = LITTER_BRAWL_TUNING.spawnSafetyRetrySeconds;
    }

    private spawnWave(wave: number, leaderDistance: number): boolean {
        const itemsInWave = this.itemsInWave(wave);
        if (this.freeSlotCount() < itemsInWave) return false;
        const halfWidth = this.usableHalfWidth();
        const randomStateBeforePlan = this.randomState;
        // 综合模式把旧波次留给下一空档，实际落点仍在当前选手前方，不能投回过时的泳段。
        const raceAnchor = (this.followLeaderOnDeferredWave
            ? Math.max(this.waveDistances[wave], leaderDistance) : this.waveDistances[wave]) + this.landingLeadDistance;
        let courseX = courseOffset(raceAnchor, this.courseLength);
        let safeCenter = this.plannedSafeCenter
            ? this.plannedSafeCenter(wave, courseX)
            : lerp(-halfWidth + LITTER_BRAWL_TUNING.safeHalfWidth,
                halfWidth - LITTER_BRAWL_TUNING.safeHalfWidth, this.nextRandom());
        if (this.isWaveSafe && !this.isWaveSafe(courseX, safeCenter, LITTER_BRAWL_TUNING.safeHalfWidth)) {
            let found = false;
            const forward = courseDirection(raceAnchor, this.courseLength);
            // 独立长局里八名选手可能分散在同一条50米泳道，按稳定顺序寻找空闲落点。
            for (let offset = 2.5; offset <= this.soloLandingSearchMeters && !found; offset += 2.5) {
                for (let side = 1; side >= -1; side -= 2) {
                    const candidateX = courseX + forward * side * offset;
                    if (candidateX < 1.2 || candidateX > this.courseLength - 1.2) continue;
                    const candidateCenter = this.plannedSafeCenter
                        ? this.plannedSafeCenter(wave, candidateX) : safeCenter;
                    if (!this.isWaveSafe(candidateX, candidateCenter, LITTER_BRAWL_TUNING.safeHalfWidth)) continue;
                    courseX = candidateX;
                    safeCenter = candidateCenter;
                    found = true;
                    break;
                }
            }
            if (!found) {
                // 等待期间保留同一随机通道，正式联机仍使用原固定落点路径。
                this.randomState = randomStateBeforePlan;
                return false;
            }
        }
        const candidates = this.lateralCandidates(safeCenter, halfWidth);
        if (this.isPlannedSpotSafe) {
            for (let index = candidates.length - 1; index >= 0; index--) {
                if (!this.isPlannedSpotSafe(courseX, candidates[index])) candidates.splice(index, 1);
            }
        }
        if (itemsInWave > LITTER_BRAWL_TUNING.waveCount && candidates.length > 0) {
            // 高档把同一横向候选复用到错开的前后排；保留真实安全通道。
            const baseCount = candidates.length;
            while (candidates.length < itemsInWave) {
                candidates.push(candidates[candidates.length % baseCount]);
            }
        }
        if (candidates.length < itemsInWave) {
            this.randomState = randomStateBeforePlan;
            return false;
        }
        const bottleVariantOffset = Math.floor(this.nextRandom() * 3);
        const formationVariant = Math.floor(this.nextRandom() * 3);
        let bottleOrdinal = 0;
        for (let index = 0; index < itemsInWave; index++) {
            const slot = this.nextSlot();
            // 波次必须完整生成；前面的容量检查保证这里不会出现半波垃圾。
            if (!slot) return false;
            const candidateIndex = Math.min(candidates.length - 1, Math.floor(this.nextRandom() * candidates.length));
            const lateral = candidates.splice(candidateIndex, 1)[0];
            const kind: LitterKind = itemsInWave === LITTER_BRAWL_TUNING.waveCount
                ? (index === 1 || index === 4 ? 'soft' : 'rigid')
                : (index >= Math.floor(itemsInWave * 2 / 3) ? 'soft' : 'rigid');
            const localSpawnOrder = this.spawnOrder++;
            slot.active = true;
            this.activeSlotCount++;
            slot.generation++;
            slot.wave = wave;
            slot.phase = 'falling';
            slot.phaseProgress = this.burstDelayForSpawnOrder(index) > 0 ? -1 : 0;
            slot.kind = kind;
            slot.age = 0;
            slot.anchorCourseX = clamp(
                courseX + this.formationAlongOffset(formationVariant, index, itemsInWave) + (this.nextRandom() - 0.5) * 0.24,
                1.2,
                this.courseLength - 1.2,
            );
            slot.anchorLateral = lateral;
            slot.courseX = slot.anchorCourseX;
            slot.lateral = lateral;
            slot.safeCenter = safeCenter;
            slot.throwSide = lateral >= 0 ? 1 : -1;
            slot.visualVariant = kind === 'rigid' ? (bottleVariantOffset + bottleOrdinal++) % 3 : 0;
            slot.impactRevision = 0;
            slot.driftPhase = this.nextRandom() * Math.PI * 2;
            slot.spawnOrder = localSpawnOrder;
            slot.insideMask = 0;
            slot.bounceAlongVelocity = 0;
            slot.bounceLateralVelocity = 0;
            slot.retireStartCourseX = 0;
            slot.retireStartLateral = 0;
        }
        return true;
    }

    private resolveLitterContacts(): void {
        let impactedLanes = 0;
        for (const slot of this.slots) {
            if (!slot.active || slot.phase !== 'floating') continue;
            const rigid = slot.kind === 'rigid';
            const alongRadius = rigid
                ? LITTER_BRAWL_TUNING.rigidItemAlongRadius
                : LITTER_BRAWL_TUNING.softPushContactAlongRadius;
            const lateralRadius = rigid
                ? LITTER_BRAWL_TUNING.rigidItemLateralRadius
                : LITTER_BRAWL_TUNING.softPushContactLateralRadius;
            let nextMask = 0;
            for (let lane = 0; lane < this.laneCount; lane++) {
                const racer = this.racerForLane(lane);
                if (!racer?.active || racer.finished) continue;
                const courseX = courseOffset(racer.distance, this.courseLength);
                const previousX = this.previousRacerCourseX[lane];
                const previousZ = this.previousRacerLateral[lane];
                const inside = expandedEllipseContains(
                    courseX, racer.lateral, slot.courseX, slot.lateral,
                    alongRadius,
                    lateralRadius,
                    LITTER_BRAWL_TUNING.swimmerContactAlongRadius,
                    LITTER_BRAWL_TUNING.swimmerContactLateralRadius,
                );
                const swept = Number.isFinite(previousX) && Math.abs(courseX - previousX) <= 5
                    && segmentHitsExpandedEllipse(
                        previousX, previousZ, courseX, racer.lateral, slot.courseX, slot.lateral,
                        alongRadius,
                        lateralRadius,
                        LITTER_BRAWL_TUNING.swimmerContactAlongRadius,
                        LITTER_BRAWL_TUNING.swimmerContactLateralRadius,
                    );
                if (!inside && !swept) continue;
                // 穿越检测只补高速跨帧碰撞；只有帧末仍在碰撞区内才保持“接触中”。
                if (inside) nextMask |= 1 << lane;
                if ((slot.insideMask & (1 << lane)) !== 0) continue;
                if (rigid && (impactedLanes & (1 << lane)) !== 0) continue;
                if (rigid) impactedLanes |= 1 << lane;
                const away: -1 | 1 = racer.lateral === slot.lateral
                    ? (lane & 1 ? 1 : -1)
                    : racer.lateral > slot.lateral ? 1 : -1;
                slot.impactRevision++;
                this.revision++;
                if (rigid) {
                    slot.bounceAlongVelocity = courseDirection(racer.distance, this.courseLength) * LITTER_BRAWL_TUNING.rigidDebrisBounceSpeed;
                    slot.bounceLateralVelocity = -away * LITTER_BRAWL_TUNING.rigidDebrisBounceSpeed * 0.72;
                    this.onRigidImpact?.({
                        slotId: slot.id,
                        generation: slot.generation,
                        lane,
                        away,
                        courseX: slot.courseX,
                        lateral: slot.lateral,
                        revision: this.revision,
                    });
                } else {
                    const pushSpeed = LITTER_BRAWL_TUNING.softDebrisPushSpeed;
                    slot.bounceAlongVelocity = clamp(
                        slot.bounceAlongVelocity + courseDirection(racer.distance, this.courseLength) * pushSpeed,
                        -pushSpeed,
                        pushSpeed,
                    );
                    slot.bounceLateralVelocity = clamp(
                        slot.bounceLateralVelocity - away * pushSpeed * 0.55,
                        -pushSpeed * 0.7,
                        pushSpeed * 0.7,
                    );
                }
                this.onContact?.({
                    elapsedSeconds: this.elapsedSeconds,
                    slotId: slot.id,
                    generation: slot.generation,
                    lane,
                    away,
                    kind: slot.kind,
                    courseX: slot.courseX,
                    lateral: slot.lateral,
                    bounceAlongVelocity: slot.bounceAlongVelocity,
                    bounceLateralVelocity: slot.bounceLateralVelocity,
                    revision: this.revision,
                });
            }
            slot.insideMask = nextMask;
        }
    }

    private rememberRacerPositions(): void {
        for (let lane = 0; lane < this.laneCount; lane++) {
            const racer = this.racerForLane(lane);
            this.previousRacerCourseX[lane] = racer?.active ? courseOffset(racer.distance, this.courseLength) : Number.NaN;
            this.previousRacerLateral[lane] = racer?.lateral ?? 0;
        }
    }

    private lateralCandidates(safeCenter: number, halfWidth: number): number[] {
        const result: number[] = [];
        const step = 1.15;
        const corridorClearance = LITTER_BRAWL_TUNING.safeHalfWidth
            + Math.max(
                LITTER_BRAWL_TUNING.rigidItemLateralRadius + LITTER_BRAWL_TUNING.swimmerContactLateralRadius,
                LITTER_BRAWL_TUNING.softPushContactLateralRadius + LITTER_BRAWL_TUNING.swimmerContactLateralRadius,
                LITTER_BRAWL_TUNING.contactLateralRadius,
            )
            + LITTER_BRAWL_TUNING.driftLateralRadius;
        for (let z = -halfWidth + 0.45; z <= halfWidth - 0.45; z += step) {
            if (Math.abs(z - safeCenter) >= corridorClearance) result.push(z);
        }
        return result;
    }

    private freeSlotCount(): number {
        return this.slots.length - this.activeSlotCount;
    }

    private itemsInWave(wave: number): number {
        return this.waveCounts?.[wave] ?? this.itemsPerWave;
    }

    private burstDelayForSpawnOrder(spawnOrder: number, wave = -1): number {
        const indexInWave = this.waveCounts && wave >= 0
            ? Math.max(0, spawnOrder - (this.waveStartOrders[wave] ?? 0))
            : Math.max(0, spawnOrder) % this.itemsPerWave;
        return Math.floor(indexInWave / 2) * LITTER_BRAWL_TUNING.burstGroupIntervalSeconds;
    }

    private formationAlongOffset(variant: number, index: number, count: number): number {
        if (count === LITTER_BRAWL_TUNING.waveCount) {
            if (variant === 0) return (index - 2.5) * 0.34;
            if (variant === 1) return (Math.floor(index / 2) - 1) * 0.72 + (index % 2 === 0 ? -0.14 : 0.14);
            return (index % 2 === 0 ? -0.65 : 0.65) + (Math.floor(index / 2) - 1) * 0.18;
        }
        const pairs = Math.ceil(count / 2);
        const row = Math.floor(index / 2) - (pairs - 1) * 0.5;
        return row * (variant === 0 ? 0.72 : variant === 1 ? 0.8 : 0.88)
            + (index % 2 === 0 ? -0.16 : 0.16);
    }

    private beginRetirement(slot: LitterSlot): void {
        slot.retireStartCourseX = slot.courseX;
        slot.retireStartLateral = slot.lateral;
        slot.bounceAlongVelocity = 0;
        slot.bounceLateralVelocity = 0;
        slot.insideMask = 0;
    }

    private nextSlot(): LitterSlot | null {
        for (const slot of this.slots) if (!slot.active) return slot;
        return null;
    }

    private leaderDistance(): number {
        let leader = 0;
        for (let lane = 0; lane < this.laneCount; lane++) {
            const racer = this.racerForLane(lane);
            if (racer?.active) leader = Math.max(leader, racer.distance);
        }
        return leader;
    }

    private usableHalfWidth(): number {
        return Math.max(1.5, this.poolWidth * 0.5 - LITTER_BRAWL_TUNING.waterEdgeMargin);
    }

    private nextRandom(): number {
        let state = this.randomState;
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        this.randomState = state >>> 0;
        return this.randomState / 0x100000000;
    }

    private applySchedule(schedule: LitterBrawlSchedule): void {
        const distances: number[] = [];
        const source = Array.isArray(schedule?.waveDistances) ? schedule.waveDistances : [];
        for (let index = 0; index < source.length; index++) {
            const distance = source[index];
            if (!Number.isFinite(distance) || distance < 0) continue;
            if (distances.length > 0 && distance <= distances[distances.length - 1]) continue;
            distances.push(distance);
        }
        this.waveDistances = distances;
        this.waveCounts = schedule.waveCounts?.length === distances.length
            && schedule.waveCounts.every(count => Number.isInteger(count) && count > 0 && count <= this.slots.length)
            ? schedule.waveCounts : null;
        if (this.waveCounts) {
            const starts: number[] = [];
            let order = 0;
            for (const count of this.waveCounts) { starts.push(order); order += count; }
            this.waveStartOrders = starts;
        } else this.waveStartOrders = [];
        this.landingLeadDistance = Number.isFinite(schedule?.landingLeadDistance)
            ? Math.max(0, schedule.landingLeadDistance)
            : LITTER_BRAWL_TUNING.landingLeadDistance;
    }
}

function courseOffset(distance: number, courseLength = 50): number {
    const safe = Math.max(0, Number.isFinite(distance) ? distance : 0);
    const lap = Math.floor(safe / courseLength);
    const withinLap = safe % courseLength;
    return lap % 2 === 0 ? withinLap : courseLength - withinLap;
}

function courseDirection(distance: number, courseLength = 50): 1 | -1 {
    return Math.floor(Math.max(0, distance) / courseLength) % 2 === 0 ? 1 : -1;
}

function clamp01(value: number): number {
    return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function smoothstep(value: number): number {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}
