import { GameState } from './GameConstants';
import { expandedEllipseContains, segmentHitsExpandedEllipse } from './RaceContactGeometry';

export const LITTER_BRAWL_TUNING = {
    poolSize: 10,
    waveDistances: [18, 48, 82, 118, 154] as readonly number[],
    waveCount: 2,
    landingLeadDistance: 7,
    fallingSeconds: 1.35,
    contactAlongRadius: 1.25,
    contactLateralRadius: 0.75,
    maxEnvironmentDrag: 0.78,
    swimmerContactAlongRadius: 0.68,
    swimmerContactLateralRadius: 0.4,
    rigidItemAlongRadius: 0.42,
    rigidItemLateralRadius: 0.18,
    softPushContactAlongRadius: 0.48,
    softPushContactLateralRadius: 0.28,
    rigidSpeedRetain: 0.72,
    rigidBackwardImpulse: 0.22,
    rigidLateralImpulse: 0.52,
    rigidDebrisBounceSpeed: 2.45,
    softDebrisPushSpeed: 0.95,
    softDebrisPushDamping: 1.65,
    aiLookAhead: 8,
    safeHalfWidth: 1.45,
    spawnSafetyRetrySeconds: 0.25,
    maxSpawnDelaySeconds: 3,
    spawnSwimmerClearAlongRadius: 2.6,
    spawnMineAlongMargin: 1.25,
    spawnMineLateralMargin: 0.55,
    spawnWhirlpoolAlongMargin: 1.1,
    spawnWhirlpoolLateralMargin: 0.35,
    waterEdgeMargin: 0.9,
    driftAlongRadius: 0.42,
    driftLateralRadius: 0.34,
    driftSpeed: 0.46,
    floatingLifetime: 13.5,
    retireSeconds: 4.2,
};

/** 统一娱乐模式只覆盖投放数量和赛程锚点，垃圾本体规则继续共用。 */
export const LITTER_BRAWL_ENTERTAINMENT_TUNING = {
    shortWaveOffsets: [0, 7] as readonly number[],
    longWaveOffsets: [0, 6, 12] as readonly number[],
    finishSafetyDistance: 2,
};

export type LitterBrawlSchedule = Readonly<{
    waveDistances: readonly number[];
    landingLeadDistance: number;
}>;

export const LITTER_BRAWL_INDEPENDENT_SCHEDULE: LitterBrawlSchedule = {
    waveDistances: LITTER_BRAWL_TUNING.waveDistances,
    landingLeadDistance: LITTER_BRAWL_TUNING.landingLeadDistance,
};

/** 仅在事件激活边沿调用；返回的新数组不会进入比赛帧热路径。 */
export function buildEntertainmentLitterSchedule(
    anchorDistance: number,
    raceDistance: number,
): LitterBrawlSchedule {
    const safeRaceDistance = Number.isFinite(raceDistance) ? Math.max(1, raceDistance) : 200;
    const safeAnchor = Number.isFinite(anchorDistance) ? Math.max(0, anchorDistance) : 0;
    const offsets = safeRaceDistance >= 400
        ? LITTER_BRAWL_ENTERTAINMENT_TUNING.longWaveOffsets
        : LITTER_BRAWL_ENTERTAINMENT_TUNING.shortWaveOffsets;
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
    safeCenter: number;
    throwSide: -1 | 1;
    visualVariant: number;
    impactRevision: number;
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
    kind: LitterKind;
    bounceAlongVelocity: number;
    bounceLateralVelocity: number;
};

export type LitterSnapshotSlot = Readonly<{
    id: number;
    generation: number;
    wave: number;
    kind: LitterKind;
    phase: LitterPhase;
    age: number;
    courseX: number;
    lateral: number;
    anchorCourseX: number;
    anchorLateral: number;
    safeCenter: number;
    throwSide: -1 | 1;
    visualVariant: number;
    impactRevision: number;
    driftPhase: number;
    spawnOrder: number;
    insideMask: number;
    bounceAlongVelocity: number;
    bounceLateralVelocity: number;
    retireStartCourseX: number;
    retireStartLateral: number;
}>;

export type LitterSnapshotState = Readonly<{
    revision: number;
    elapsedSeconds: number;
    nextWave: number;
    spawnOrder: number;
    randomState: number;
    spawnRetryRemaining: number;
    blockedWaveSeconds: number;
    cancelledWaveCount: number;
    slots: readonly LitterSnapshotSlot[];
}>;

export type LitterSnapshotApplyResult = Readonly<{
    applied: boolean;
    activeChanged: boolean;
}>;

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
    anchorCourseX: number;
    anchorLateral: number;
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
export class LitterBrawlController {
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
    private lastSnapshotRevision = -1;
    private lastSnapshotElapsed = -1;
    private waveDistances: readonly number[] = LITTER_BRAWL_INDEPENDENT_SCHEDULE.waveDistances;
    private landingLeadDistance = LITTER_BRAWL_INDEPENDENT_SCHEDULE.landingLeadDistance;
    private readonly previousRacerCourseX: number[];
    private readonly previousRacerLateral: number[];

    constructor(
        private readonly laneCount: number,
        seed: number,
        private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => LitterRacerState | null,
        private readonly onWave?: (wave: number) => void,
        private readonly onRigidImpact?: (impact: LitterRigidImpact) => void,
        schedule: LitterBrawlSchedule = LITTER_BRAWL_INDEPENDENT_SCHEDULE,
        private readonly isWaveSafe?: LitterWaveSafetyCheck,
        private readonly onContact?: (contact: LitterContact) => void,
    ) {
        this.randomSeed = ((seed ^ 0x6c697474) >>> 0) || 0x9e3779b9;
        this.randomState = this.randomSeed;
        this.slots = Array.from({ length: LITTER_BRAWL_TUNING.poolSize }, (_, id): LitterSlot => ({
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
        this.lastSnapshotRevision = -1;
        this.lastSnapshotElapsed = -1;
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

    snapshotState(): LitterSnapshotState {
        const slots: LitterSnapshotSlot[] = [];
        for (const slot of this.slots) {
            if (!slot.active) continue;
            slots.push({
                id: slot.id,
                generation: slot.generation,
                wave: slot.wave,
                kind: slot.kind,
                phase: slot.phase,
                age: slot.age,
                courseX: slot.courseX,
                lateral: slot.lateral,
                anchorCourseX: slot.anchorCourseX,
                anchorLateral: slot.anchorLateral,
                safeCenter: slot.safeCenter,
                throwSide: slot.throwSide,
                visualVariant: slot.visualVariant,
                impactRevision: slot.impactRevision,
                driftPhase: slot.driftPhase,
                spawnOrder: slot.spawnOrder,
                insideMask: slot.insideMask,
                bounceAlongVelocity: slot.bounceAlongVelocity,
                bounceLateralVelocity: slot.bounceLateralVelocity,
                retireStartCourseX: slot.retireStartCourseX,
                retireStartLateral: slot.retireStartLateral,
            });
        }
        return {
            revision: this.revision,
            elapsedSeconds: this.elapsedSeconds,
            nextWave: this.nextWave,
            spawnOrder: this.spawnOrder,
            randomState: this.randomState >>> 0,
            spawnRetryRemaining: this.spawnRetryRemaining,
            blockedWaveSeconds: this.blockedWaveSeconds,
            cancelledWaveCount: this.cancelledWaveCount,
            slots,
        };
    }

    applySnapshotState(state: LitterSnapshotState): LitterSnapshotApplyResult {
        if (!this.validSnapshotState(state)
            || state.revision < this.revision
            || state.revision < this.lastSnapshotRevision
            || (state.revision === this.lastSnapshotRevision
                && state.elapsedSeconds < this.lastSnapshotElapsed)) {
            return { applied: false, activeChanged: false };
        }
        let activeMask = 0;
        for (const source of state.slots) {
            const bit = 1 << source.id;
            if ((activeMask & bit) !== 0) return { applied: false, activeChanged: false };
            activeMask |= bit;
        }
        const previousActiveMask = this.activeMask();
        this.lastSnapshotRevision = state.revision;
        this.lastSnapshotElapsed = state.elapsedSeconds;
        this.revision = state.revision;
        this.elapsedSeconds = state.elapsedSeconds;
        this.nextWave = state.nextWave;
        this.spawnOrder = state.spawnOrder;
        this.randomState = state.randomState >>> 0;
        this.spawnRetryRemaining = state.spawnRetryRemaining;
        this.blockedWaveSeconds = state.blockedWaveSeconds;
        this.cancelledWaveCount = state.cancelledWaveCount;
        this.activeSlotCount = state.slots.length;
        for (const slot of this.slots) {
            slot.active = false;
            slot.insideMask = 0;
        }
        for (const source of state.slots) this.applySnapshotSlot(this.slots[source.id], source);
        this.previousRacerCourseX.fill(Number.NaN);
        this.previousRacerLateral.fill(0);
        return { applied: true, activeChanged: previousActiveMask !== activeMask };
    }

    applyContact(contact: LitterContact): boolean {
        if (!contact || !Number.isSafeInteger(contact.slotId)
            || contact.slotId < 0 || contact.slotId >= this.slots.length
            || !Number.isSafeInteger(contact.generation) || contact.generation < 0
            || !Number.isSafeInteger(contact.lane) || contact.lane < 0 || contact.lane >= this.laneCount
            || (contact.away !== -1 && contact.away !== 1)
            || (contact.kind !== 'rigid' && contact.kind !== 'soft')
            || !Number.isFinite(contact.courseX) || !Number.isFinite(contact.lateral)
            || !Number.isFinite(contact.bounceAlongVelocity)
            || !Number.isFinite(contact.bounceLateralVelocity)
            || !Number.isSafeInteger(contact.revision) || contact.revision <= this.revision) return false;
        const slot = this.slots[contact.slotId];
        if (!slot.active || slot.generation !== contact.generation || slot.kind !== contact.kind) return false;
        this.revision = contact.revision;
        slot.courseX = contact.courseX;
        slot.lateral = contact.lateral;
        slot.anchorCourseX = contact.courseX;
        slot.anchorLateral = contact.lateral;
        slot.bounceAlongVelocity = contact.bounceAlongVelocity;
        slot.bounceLateralVelocity = contact.bounceLateralVelocity;
        slot.impactRevision++;
        slot.insideMask |= 1 << contact.lane;
        return true;
    }

    update(dt: number, state: GameState, authoritative = true): void {
        if (state !== GameState.RACING) return;
        if (this.nextWave >= this.waveDistances.length && this.activeCount() === 0) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.elapsedSeconds += step;
        const leaderDistance = this.leaderDistance();
        if (authoritative) this.updatePendingWaves(step, leaderDistance);
        for (const slot of this.slots) {
            if (!slot.active) continue;
            slot.age += step;
            if (slot.age < LITTER_BRAWL_TUNING.fallingSeconds) {
                slot.phase = 'falling';
                slot.phaseProgress = clamp01(slot.age / LITTER_BRAWL_TUNING.fallingSeconds);
                slot.courseX = slot.anchorCourseX;
                slot.lateral = slot.anchorLateral;
                continue;
            }
            const driftTime = slot.age - LITTER_BRAWL_TUNING.fallingSeconds;
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
                slot.courseX = clamp(slot.retireStartCourseX + courseWander, 1.2, 48.8);
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
            slot.anchorCourseX = clamp(slot.anchorCourseX + slot.bounceAlongVelocity * step, 1.2, 48.8);
            slot.anchorLateral = clamp(slot.anchorLateral + slot.bounceLateralVelocity * step,
                -this.usableHalfWidth(), this.usableHalfWidth());
            // 轻塑料瓶快速滚开；零食袋初速度更低，但会被水流带得更久。
            const bounceDamping = slot.kind === 'soft' ? LITTER_BRAWL_TUNING.softDebrisPushDamping : 2.8;
            const bounceDecay = Math.exp(-bounceDamping * step);
            slot.bounceAlongVelocity *= bounceDecay;
            slot.bounceLateralVelocity *= bounceDecay;
            slot.courseX = clamp(
                slot.anchorCourseX
                    + Math.sin(driftTime * LITTER_BRAWL_TUNING.driftSpeed + slot.driftPhase)
                        * LITTER_BRAWL_TUNING.driftAlongRadius * 0.72
                    + Math.sin(driftTime * LITTER_BRAWL_TUNING.driftSpeed * 0.37 + slot.driftPhase * 1.83)
                        * LITTER_BRAWL_TUNING.driftAlongRadius * 0.28,
                1.2,
                48.8,
            );
            const halfWidth = this.usableHalfWidth();
            slot.lateral = clamp(
                slot.anchorLateral
                    + Math.cos(driftTime * LITTER_BRAWL_TUNING.driftSpeed * 0.81 + slot.driftPhase * 1.17)
                        * LITTER_BRAWL_TUNING.driftLateralRadius * 0.68
                    + Math.sin(driftTime * LITTER_BRAWL_TUNING.driftSpeed * 0.29 + slot.driftPhase * 2.11)
                        * LITTER_BRAWL_TUNING.driftLateralRadius * 0.32,
                -halfWidth,
                halfWidth,
            );
        }
        if (authoritative) this.resolveLitterContacts();
        this.rememberRacerPositions();
    }

    environmentDragForLane(lane: number): number {
        const racer = this.racerForLane(lane);
        if (!racer?.active || racer.finished) return 0;
        const courseX = courseOffset(racer.distance);
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
        const racer = this.racerForLane(lane);
        if (!racer?.active || racer.finished) return null;
        const courseX = courseOffset(racer.distance);
        const direction = courseDirection(racer.distance);
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
        if (this.nextWave >= this.waveDistances.length
            || leaderDistance < this.waveDistances[this.nextWave]) return;
        this.blockedWaveSeconds += step;
        this.spawnRetryRemaining = Math.max(0, this.spawnRetryRemaining - step);
        if (this.spawnRetryRemaining > 0) return;
        const wave = this.nextWave;
        if (this.spawnWave(wave)) {
            this.onWave?.(wave);
            this.nextWave++;
            this.revision++;
            this.spawnRetryRemaining = 0;
            this.blockedWaveSeconds = 0;
            // 跳过多个赛程锚点时仍允许同帧补齐，但最多受固定预设波数约束。
            this.updatePendingWaves(0, leaderDistance);
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

    private spawnWave(wave: number): boolean {
        const halfWidth = this.usableHalfWidth();
        const randomStateBeforePlan = this.randomState;
        const safeCenter = lerp(-halfWidth + LITTER_BRAWL_TUNING.safeHalfWidth,
            halfWidth - LITTER_BRAWL_TUNING.safeHalfWidth, this.nextRandom());
        const raceAnchor = this.waveDistances[wave] + this.landingLeadDistance;
        const courseX = courseOffset(raceAnchor);
        if (this.isWaveSafe && !this.isWaveSafe(courseX, safeCenter, LITTER_BRAWL_TUNING.safeHalfWidth)) {
            // 等待期间必须保留同一候选通道，不能因帧数不同持续重抽并让联机布局分叉。
            this.randomState = randomStateBeforePlan;
            return false;
        }
        const candidates = this.lateralCandidates(safeCenter, halfWidth);
        for (let index = 0; index < LITTER_BRAWL_TUNING.waveCount; index++) {
            const slot = this.nextSlot();
            if (!slot) break;
            const candidateIndex = Math.min(candidates.length - 1, Math.floor(this.nextRandom() * candidates.length));
            const lateral = candidates.splice(candidateIndex, 1)[0] ?? (index === 0 ? -halfWidth * 0.7 : halfWidth * 0.7);
            slot.active = true;
            this.activeSlotCount++;
            slot.generation++;
            slot.wave = wave;
            slot.phase = 'falling';
            slot.phaseProgress = 0;
            slot.kind = index % 2 === 0 ? 'rigid' : 'soft';
            slot.age = 0;
            slot.anchorCourseX = clamp(courseX + (this.nextRandom() - 0.5) * 2.2, 1.2, 48.8);
            slot.anchorLateral = lateral;
            slot.courseX = slot.anchorCourseX;
            slot.lateral = lateral;
            slot.safeCenter = safeCenter;
            slot.throwSide = lateral >= 0 ? 1 : -1;
            slot.visualVariant = Math.floor(this.nextRandom() * 3);
            slot.impactRevision = 0;
            slot.driftPhase = this.nextRandom() * Math.PI * 2;
            slot.spawnOrder = this.spawnOrder++;
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
                const courseX = courseOffset(racer.distance);
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
                    slot.bounceAlongVelocity = courseDirection(racer.distance) * LITTER_BRAWL_TUNING.rigidDebrisBounceSpeed;
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
                        slot.bounceAlongVelocity + courseDirection(racer.distance) * pushSpeed,
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
            this.previousRacerCourseX[lane] = racer?.active ? courseOffset(racer.distance) : Number.NaN;
            this.previousRacerLateral[lane] = racer?.lateral ?? 0;
        }
    }

    private lateralCandidates(safeCenter: number, halfWidth: number): number[] {
        const result: number[] = [];
        const step = Math.max(1.5, this.poolWidth / Math.max(4, this.laneCount));
        for (let z = -halfWidth + 0.5; z <= halfWidth - 0.5; z += step) {
            if (Math.abs(z - safeCenter) >= LITTER_BRAWL_TUNING.safeHalfWidth + 0.45) result.push(z);
        }
        if (result.length < LITTER_BRAWL_TUNING.waveCount) {
            result.push(-halfWidth * 0.75, halfWidth * 0.75);
        }
        return result;
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

    private activeMask(): number {
        let mask = 0;
        for (const slot of this.slots) if (slot.active) mask |= 1 << slot.id;
        return mask;
    }

    private validSnapshotState(state: LitterSnapshotState): boolean {
        if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0
            || !Number.isFinite(state.elapsedSeconds) || state.elapsedSeconds < 0
            || !Number.isSafeInteger(state.nextWave) || state.nextWave < 0
            || state.nextWave > this.waveDistances.length
            || !Number.isSafeInteger(state.spawnOrder) || state.spawnOrder < 0
            || !Number.isSafeInteger(state.randomState) || state.randomState < 0
            || state.randomState > 0xffffffff
            || !Number.isFinite(state.spawnRetryRemaining) || state.spawnRetryRemaining < 0
            || !Number.isFinite(state.blockedWaveSeconds) || state.blockedWaveSeconds < 0
            || !Number.isSafeInteger(state.cancelledWaveCount) || state.cancelledWaveCount < 0
            || !Array.isArray(state.slots) || state.slots.length > this.slots.length) return false;
        for (const slot of state.slots) {
            if (!slot || !Number.isSafeInteger(slot.id) || slot.id < 0 || slot.id >= this.slots.length
                || !Number.isSafeInteger(slot.generation) || slot.generation < 0
                || !Number.isSafeInteger(slot.wave) || slot.wave < 0 || slot.wave >= this.waveDistances.length
                || (slot.kind !== 'rigid' && slot.kind !== 'soft')
                || (slot.phase !== 'falling' && slot.phase !== 'floating' && slot.phase !== 'retiring')
                || !Number.isFinite(slot.age) || slot.age < 0
                || !Number.isFinite(slot.courseX) || !Number.isFinite(slot.lateral)
                || !Number.isFinite(slot.anchorCourseX) || !Number.isFinite(slot.anchorLateral)
                || !Number.isFinite(slot.safeCenter) || (slot.throwSide !== -1 && slot.throwSide !== 1)
                || !Number.isSafeInteger(slot.visualVariant) || slot.visualVariant < 0 || slot.visualVariant > 2
                || !Number.isSafeInteger(slot.impactRevision) || slot.impactRevision < 0
                || !Number.isFinite(slot.driftPhase)
                || !Number.isSafeInteger(slot.spawnOrder) || slot.spawnOrder < 0
                || !Number.isSafeInteger(slot.insideMask) || slot.insideMask < 0
                || !Number.isFinite(slot.bounceAlongVelocity) || !Number.isFinite(slot.bounceLateralVelocity)
                || !Number.isFinite(slot.retireStartCourseX) || !Number.isFinite(slot.retireStartLateral)) return false;
        }
        return true;
    }

    private applySnapshotSlot(slot: LitterSlot, source: LitterSnapshotSlot): void {
        slot.active = true;
        slot.generation = source.generation;
        slot.wave = source.wave;
        slot.kind = source.kind;
        slot.phase = source.phase;
        slot.phaseProgress = source.phase === 'falling'
            ? clamp01(source.age / LITTER_BRAWL_TUNING.fallingSeconds)
            : source.phase === 'retiring'
                ? clamp01((source.age - LITTER_BRAWL_TUNING.fallingSeconds
                    - LITTER_BRAWL_TUNING.floatingLifetime) / LITTER_BRAWL_TUNING.retireSeconds)
                : 1;
        slot.age = source.age;
        slot.courseX = source.courseX;
        slot.lateral = source.lateral;
        slot.anchorCourseX = source.anchorCourseX;
        slot.anchorLateral = source.anchorLateral;
        slot.safeCenter = source.safeCenter;
        slot.throwSide = source.throwSide;
        slot.visualVariant = source.visualVariant;
        slot.impactRevision = source.impactRevision;
        slot.driftPhase = source.driftPhase;
        slot.spawnOrder = source.spawnOrder;
        slot.insideMask = source.insideMask;
        slot.bounceAlongVelocity = source.bounceAlongVelocity;
        slot.bounceLateralVelocity = source.bounceLateralVelocity;
        slot.retireStartCourseX = source.retireStartCourseX;
        slot.retireStartLateral = source.retireStartLateral;
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
        const maxWaves = Math.floor(LITTER_BRAWL_TUNING.poolSize / LITTER_BRAWL_TUNING.waveCount);
        const distances: number[] = [];
        const source = Array.isArray(schedule?.waveDistances) ? schedule.waveDistances : [];
        for (let index = 0; index < source.length && distances.length < maxWaves; index++) {
            const distance = source[index];
            if (!Number.isFinite(distance) || distance < 0) continue;
            if (distances.length > 0 && distance <= distances[distances.length - 1]) continue;
            distances.push(distance);
        }
        this.waveDistances = distances;
        this.landingLeadDistance = Number.isFinite(schedule?.landingLeadDistance)
            ? Math.max(0, schedule.landingLeadDistance)
            : LITTER_BRAWL_TUNING.landingLeadDistance;
    }
}

function courseOffset(distance: number): number {
    const safe = Math.max(0, Number.isFinite(distance) ? distance : 0);
    const lap = Math.floor(safe / 50);
    const withinLap = safe % 50;
    return lap % 2 === 0 ? withinLap : 50 - withinLap;
}

function courseDirection(distance: number): 1 | -1 {
    return Math.floor(Math.max(0, distance) / 50) % 2 === 0 ? 1 : -1;
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
