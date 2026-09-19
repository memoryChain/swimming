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
    waterEdgeMargin: 0.9,
    driftAlongRadius: 0.42,
    driftLateralRadius: 0.34,
    driftSpeed: 0.46,
    floatingLifetime: 13.5,
    retireSeconds: 4.2,
};

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
    lane: number;
    away: -1 | 1;
};

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
    private readonly previousRacerCourseX: number[];
    private readonly previousRacerLateral: number[];

    constructor(
        private readonly laneCount: number,
        seed: number,
        private readonly poolWidth: number,
        private readonly racerForLane: (lane: number) => LitterRacerState | null,
        private readonly onWave?: (wave: number) => void,
        private readonly onRigidImpact?: (impact: LitterRigidImpact) => void,
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
    }

    reset(): void {
        this.nextWave = 0;
        this.spawnOrder = 0;
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

    dispose(): void {
        this.reset();
    }

    clusters(): readonly LitterClusterState[] {
        return this.slots;
    }

    update(dt: number, state: GameState): void {
        if (state !== GameState.RACING) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const leaderDistance = this.leaderDistance();
        while (this.nextWave < LITTER_BRAWL_TUNING.waveDistances.length
            && leaderDistance >= LITTER_BRAWL_TUNING.waveDistances[this.nextWave]) {
            this.spawnWave(this.nextWave);
            this.onWave?.(this.nextWave);
            this.nextWave++;
        }
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
        this.resolveLitterContacts();
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

    private spawnWave(wave: number): void {
        const halfWidth = this.usableHalfWidth();
        const safeCenter = lerp(-halfWidth + LITTER_BRAWL_TUNING.safeHalfWidth,
            halfWidth - LITTER_BRAWL_TUNING.safeHalfWidth, this.nextRandom());
        const raceAnchor = LITTER_BRAWL_TUNING.waveDistances[wave] + LITTER_BRAWL_TUNING.landingLeadDistance;
        const courseX = courseOffset(raceAnchor);
        const candidates = this.lateralCandidates(safeCenter, halfWidth);
        for (let index = 0; index < LITTER_BRAWL_TUNING.waveCount; index++) {
            const slot = this.nextSlot();
            if (!slot) break;
            const candidateIndex = Math.min(candidates.length - 1, Math.floor(this.nextRandom() * candidates.length));
            const lateral = candidates.splice(candidateIndex, 1)[0] ?? (index === 0 ? -halfWidth * 0.7 : halfWidth * 0.7);
            slot.active = true;
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
                if (rigid) {
                    slot.bounceAlongVelocity = courseDirection(racer.distance) * LITTER_BRAWL_TUNING.rigidDebrisBounceSpeed;
                    slot.bounceLateralVelocity = -away * LITTER_BRAWL_TUNING.rigidDebrisBounceSpeed * 0.72;
                    this.onRigidImpact?.({ slotId: slot.id, lane, away });
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

    private nextRandom(): number {
        let state = this.randomState;
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        this.randomState = state >>> 0;
        return this.randomState / 0x100000000;
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
