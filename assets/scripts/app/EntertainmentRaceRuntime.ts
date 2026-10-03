import { CannonRaceController } from '../entertainment/CannonRaceController';
import { SprayBuoyRaceController } from '../entertainment/SprayBuoyRaceController';
import { GiantWaveRaceController } from '../entertainment/GiantWaveRaceController';
import type { GiantWaveIntensity } from '../entertainment/GiantWaveRules';
import { EffectAsset, Mesh, Node, Prefab } from 'cc';
import { GeyserRaceController } from '../entertainment/GeyserRaceController';
import type { GeyserIntensity } from '../entertainment/GeyserBrawlRules';
import { buildLightWhirlpoolSpawn, buildWhirlpoolDebugSpawns, whirlpoolTargetZForAi, WhirlpoolSpawn } from '../entertainment/WhirlpoolBrawlRules';
import { WhirlpoolRacePresentation } from '../entertainment/WhirlpoolRacePresentation';
import { GameState } from '../core/GameConstants';
import { laneCenterZ } from '../venue/LaneLayout';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { Swimmer } from '../entity/Swimmer';
import { AISwimmerController } from '../entity/AISwimmerController';
import { PlayerConditionModel } from '../condition/PlayerConditionModel';
import { AiConditionModel } from '../condition/AiConditionModel';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { ENTERTAINMENT_DEBUG_TUNING, LITTER_BRAWL_TUNING, STIMULANT_BRAWL_TUNING, WHIRLPOOL_BRAWL_TUNING } from '../core/EntertainmentBalance';
import { buildEntertainmentDebugPlan, CannonDebugPlan, EntertainmentDebugMode } from '../entertainment/EntertainmentDebugPlan';
import { buildGradedStimulantSchedule } from '../entertainment/StimulantBrawlRules';
import { EntertainmentRacerState, SupplyRaceController } from '../entertainment/SupplyRaceController';
import { SupplyRacePresentation } from '../entertainment/SupplyRacePresentation';
import { LitterBrawlController, LitterRacerState } from '../entertainment/LitterBrawlController';
import { LitterBrawlPresentation } from '../entertainment/LitterBrawlPresentation';
import { FloatingItemRenderer, FloatingItemLayers } from '../entertainment/FloatingItemRenderer';
import type { EntertainmentLightPlan } from '../entertainment/EntertainmentLightPlan';
import { readEntertainmentItemMesh } from '../entertainment/EntertainmentItemAssets';

const DEBRIS_PATHS = [RESOURCE_PATHS.entertainmentDebris.cola, RESOURCE_PATHS.entertainmentDebris.water,
    RESOURCE_PATHS.entertainmentDebris.sport, RESOURCE_PATHS.entertainmentDebris.tray] as const;
const GIANT_WAVE_PATHS = [RESOURCE_PATHS.giantWave.body, RESOURCE_PATHS.giantWave.wake, RESOURCE_PATHS.giantWave.shore] as const;
const SPRAY_SPLASH_PATHS = [RESOURCE_PATHS.sprayBuoy.entryBody, RESOURCE_PATHS.sprayBuoy.entryRing,
    RESOURCE_PATHS.sprayBuoy.splashBody, RESOURCE_PATHS.sprayBuoy.splashRing, RESOURCE_PATHS.sprayBuoy.splashCore] as const;
const GEYSER_PATHS = [RESOURCE_PATHS.geyser.foam, RESOURCE_PATHS.geyser.jet, RESOURCE_PATHS.geyser.drops] as const;

const CANNON_PATHS = [RESOURCE_PATHS.cannon.base, RESOURCE_PATHS.cannon.nozzle, RESOURCE_PATHS.cannon.ball, RESOURCE_PATHS.cannon.warning,
    RESOURCE_PATHS.sprayBuoy.ring, RESOURCE_PATHS.sprayBuoy.splashBody, RESOURCE_PATHS.sprayBuoy.splashRing, RESOURCE_PATHS.sprayBuoy.splashCore] as const;

export type EntertainmentRacerBinding = {
    lane: number;
    swimmer: Swimmer;
    condition: PlayerConditionModel | AiConditionModel;
    ai: AISwimmerController | null;
};
/** 本地调试生命周期拥有者；普通比赛不会创建此实例。 */
export class EntertainmentRaceRuntime {
    private readonly states: EntertainmentRacerState[];
    private readonly litterStates: LitterRacerState[];
    private readonly supplies: SupplyRaceController | null;
    private readonly litter: LitterBrawlController | null;
    private supplyPresentation: SupplyRacePresentation | null = null;
    private litterPresentation: LitterBrawlPresentation | null = null;
    private rendering: FloatingItemRenderer | null = null;
    private readonly referenceIndex: number;
    private readonly whirlpools: readonly WhirlpoolSpawn[];
    private whirlpoolPresentation: WhirlpoolRacePresentation | null = null;
    private readonly useSprayBuoy: boolean;
    private readonly useCannon: boolean;
    private readonly cannonPlan: CannonDebugPlan | null;
    private cannon: CannonRaceController | null = null;
    private sprayBuoy: SprayBuoyRaceController | null = null;
    private geyser: GeyserRaceController | null = null;
    private giantWave: GiantWaveRaceController | null = null;
    private readonly useGiantWave: boolean;
    private readonly giantWaveIntensity: GiantWaveIntensity;
    private readonly useGeyser: boolean;
    private readonly geyserIntensity: GeyserIntensity;
    private readonly seed: number;
    private readonly light: EntertainmentLightPlan | null;
    private leaderDistance = 0;
    private whirlpoolActive = false;
    private routeClock = 1;
    private disposed = false;
    private previousState: GameState | null = null;
    private prepareDone: ((error?: Error | null) => void) | null = null;
    constructor(private readonly world: Node, private readonly course: RaceCourseLayout, mode: EntertainmentDebugMode,
        seed: number, private readonly raceDistance: number, private readonly racers: readonly EntertainmentRacerBinding[],
        private readonly waterLayers: FloatingItemLayers | null = null) {
        this.referenceIndex = Math.max(0, racers.findIndex(racer => !racer.ai));
        this.states = racers.map(() => ({ active: false, canContact: false, finished: false, distance: 0, lateral: 0, heading: 0 }));
        this.litterStates = Array.from({ length: course.laneCount }, () => ({ active: false, finished: false, distance: 0, lateral: 0 }));
        const centers = Array.from({ length: course.laneCount }, (_, lane) => laneCenterZ(lane, course));
        const plan = buildEntertainmentDebugPlan(mode, raceDistance, seed);
        this.light = plan.light; this.whirlpoolActive = !this.light;
        this.useSprayBuoy = plan.sprayBuoy; this.useCannon = plan.cannon;
        this.cannonPlan = plan.cannonPlan;
        this.useGiantWave = plan.giantWave;
        this.giantWaveIntensity = plan.giantWaveIntensity;
        this.useGeyser = plan.geyser; this.seed = seed;
        this.geyserIntensity = plan.geyserIntensity;
        this.whirlpools = plan.whirlpool ? this.light
            ? buildLightWhirlpoolSpawn(seed, this.light.waterEventDistance, raceDistance, course.courseLength)
            : buildWhirlpoolDebugSpawns(seed, raceDistance, course.courseLength, plan.whirlpoolSelection) : [];
        this.supplies = plan.supplies.length ? new SupplyRaceController(
            buildGradedStimulantSchedule(seed, course.laneCount, raceDistance, course.courseLength, plan.supplies, this.light?.suppliesPerWave ?? 3),
            centers, course.courseLength, this.states, (index, kind) => {
                const racer = this.racers[index];
                if (kind === 'heartbeat-soda') racer.condition.restoreEnergyRatio(STIMULANT_BRAWL_TUNING.energyRestoreRatio);
                racer.swimmer.motor.applyEntertainmentSupply(kind);
                racer.condition.syncHeartRate(racer.swimmer.heartRate);
                // 体力从耗尽恢复时立即更新 Motor，不等待下个 HUD/条件采样。
                racer.swimmer.applyConditionSpeedScale(racer.condition.efficiencyModifier);
                racer.swimmer.applyConditionCadenceScale(racer.condition.strokeCadenceScale);
            }) : null;
        this.litter = plan.debris.length ? new LitterBrawlController(course.laneCount, seed, course.poolWidth,
            lane => this.litterStates[lane] ?? null, {
                onRigidImpact: impact => {
                    for (const racer of this.racers) if (racer.lane === impact.lane) {
                        racer.swimmer.motor.applyEnvironmentSpeedRetain(LITTER_BRAWL_TUNING.rigidSpeedRetain);
                        racer.swimmer.applyCollisionImpulse(-LITTER_BRAWL_TUNING.rigidBackwardImpulse,
                            impact.away * LITTER_BRAWL_TUNING.rigidLateralImpulse);
                        break;
                    }
                },
                schedule: { waveDistances: plan.debris, waveCounts: this.light?.debrisWaveCounts, landingLeadDistance: LITTER_BRAWL_TUNING.landingLeadDistance },
                intensity: { itemsPerWave: this.light?.debrisPerWave ?? ENTERTAINMENT_DEBUG_TUNING.debrisItemsPerWave,
                    poolSize: this.light?.debrisPoolSize ?? ENTERTAINMENT_DEBUG_TUNING.debrisPoolSize },
                canSpawnWave: this.light ? () => !this.waterEventBusy() : undefined,
                isWaveSafe: this.light ? row => this.backgroundRowSafe(row) : undefined,
                followLeaderOnDeferredWave: !!this.light,
                minimumWaveIntervalSeconds: 8,
                maxWaveDelayDistance: 12,
                courseLength: course.courseLength,
            }) : null;
        for (const racer of racers) {
            racer.swimmer.motor.configureEntertainment(true, !!this.supplies);
            racer.swimmer.motor.configureEntertainmentWhirlpools(this.whirlpools, course.poolWidth, laneCenterZ(racer.lane, course));
        }
    }
    prepare(done: (error?: Error | null) => void) {
        if (this.disposed || !this.world?.isValid) { done(new Error('娱乐调试场景已失效')); return; }
        this.prepareDone = done;
        try {
            if (!this.litter && !this.supplies && !this.useSprayBuoy && !this.useCannon) { this.prepareWaterEvent(); return; }
            loadRaceAsset(RESOURCE_PATHS.venueHeightShadeEffect, EffectAsset, (error, effect) => {
                if (this.disposed) return;
                if (error || !effect || !this.world.isValid) { this.finishPrepare(error ?? new Error('漂浮物水线材质缺失')); return; }
                try {
                    this.rendering = new FloatingItemRenderer(effect, this.course.waterY, this.waterLayers);
                    this.prepareDebris();
                } catch (e) { this.finishPrepare(e instanceof Error ? e : new Error(String(e))); }
            });
        } catch (e) { this.finishPrepare(e instanceof Error ? e : new Error(String(e))); }
    }
    /** 先完成固定漂浮物池，再准备本局实际使用的水面事件；全部就绪后只放行一次。 */
    private prepareWaterEvent() {
        if (this.disposed) return;
        if (this.useSprayBuoy) { this.prepareSprayBuoy(); return; }
        if (this.useCannon) {
            this.prepareEffectMeshes(CANNON_PATHS, meshes => {
                this.cannon = new CannonRaceController(this.world, this.course, this.racers, this.seed, this.raceDistance, meshes, this.rendering!, this.waterLayers, this.cannonPlan!);
            }); return;
        }
        if (this.useGiantWave) {
            this.prepareEffectMeshes(GIANT_WAVE_PATHS, meshes => {
                this.giantWave = new GiantWaveRaceController(this.world, this.course, this.racers.map(r => r.swimmer),
                    this.seed, this.raceDistance, { body: meshes[0], wake: meshes[1], shore: meshes[2] }, this.waterLayers,
                    this.light?.waterEventDistance ?? null, this.giantWaveIntensity);
            }); return;
        }
        if (this.useGeyser) {
            this.prepareEffectMeshes(GEYSER_PATHS, meshes => {
                this.geyser = new GeyserRaceController(this.world, this.course, this.racers.map(r => r.swimmer),
                    this.seed, this.raceDistance, { foam: meshes[0], jet: meshes[1], drops: meshes[2] }, this.waterLayers,
                    this.light?.waterEventDistance ?? null, this.geyserIntensity);
                for (const racer of this.racers) racer.swimmer.configureEntertainmentGeyser(true);
            }); return;
        }
        if (this.whirlpools.length) {
            loadRaceAsset(RESOURCE_PATHS.whirlpoolFunnelEffect, EffectAsset, (error, effect) => {
                if (this.disposed) return;
                if (error || !effect || !this.world.isValid) { this.finishPrepare(error ?? new Error('漩涡材质缺失')); return; }
                try {
                    this.whirlpoolPresentation = new WhirlpoolRacePresentation(this.world, this.course, this.whirlpools, effect, this.waterLayers);
                    this.finishPrepare();
                } catch (e) { this.finishPrepare(e instanceof Error ? e : new Error(String(e))); }
            }); return;
        }
        this.finishPrepare();
    }
    private prepareSprayBuoy(): void {
        loadRaceAsset(RESOURCE_PATHS.sprayBuoy.model, Prefab, (error, buoy) => {
            if (this.disposed) return;
            if (error || !buoy || !this.world.isValid) { this.finishPrepare(error ?? new Error('喷雾浮标模型缺失')); return; }
            loadRaceAsset(RESOURCE_PATHS.sprayBuoy.ring, Prefab, (ringError, ring) => {
                if (this.disposed) return;
                if (ringError || !ring || !this.world.isValid) { this.finishPrepare(ringError ?? new Error('恢复浮圈模型缺失')); return; }
                try {
                    const ringMesh = readEntertainmentItemMesh(ring, RESOURCE_PATHS.sprayBuoy.ring);
                    this.prepareEffectMeshes(SPRAY_SPLASH_PATHS, meshes => {
                        this.sprayBuoy = new SprayBuoyRaceController(this.world, this.course, this.racers, this.seed, this.raceDistance,
                            buoy, ringMesh, meshes, this.rendering!, this.waterLayers);
                    });
                } catch (e) { this.finishPrepare(e instanceof Error ? e : new Error(String(e))); }
            });
        });
    }
    private prepareEffectMeshes(paths: readonly string[], build: (meshes: Mesh[]) => void, index = 0, meshes: Mesh[] = []) {
        const path = paths[index];
        loadRaceAsset(path, Prefab, (error, prefab) => {
            if (this.disposed) return;
            if (error || !prefab || !this.world.isValid) {
                this.finishPrepare(error ?? new Error(`娱乐模型缺失：${path}`)); return;
            }
            try {
                meshes.push(readEntertainmentItemMesh(prefab, path));
                if (index + 1 < paths.length) { this.prepareEffectMeshes(paths, build, index + 1, meshes); return; }
                build(meshes);
                this.finishPrepare();
            } catch (e) { this.finishPrepare(e instanceof Error ? e : new Error(String(e))); }
        });
    }
    private prepareDebris(index = 0, meshes: Mesh[] = []) {
        if (!this.litter) { this.prepareSupplies(); return; }
        loadRaceAsset(DEBRIS_PATHS[index], Prefab, (error, prefab) => {
            if (this.disposed) return;
            if (error || !prefab || !this.world.isValid) {
                this.finishPrepare(error ?? new Error(`杂物模型缺失：${DEBRIS_PATHS[index]}`)); return;
            }
            try {
                meshes.push(readEntertainmentItemMesh(prefab, DEBRIS_PATHS[index]));
                if (index + 1 < DEBRIS_PATHS.length) { this.prepareDebris(index + 1, meshes); return; }
                this.litterPresentation = new LitterBrawlPresentation(this.world, this.course,
                    this.litter.clusters().length, this.rendering!,
                    { bottles: [meshes[0], meshes[1], meshes[2]], tray: meshes[3] });
                this.prepareSupplies();
            } catch (e) { this.finishPrepare(e instanceof Error ? e : new Error(String(e))); }
        });
    }
    private prepareSupplies() {
        if (!this.supplies) { this.prepareWaterEvent(); return; }
        loadRaceAsset(RESOURCE_PATHS.entertainmentSupplies.soda, Prefab, (error, soda) => {
            if (this.disposed) return;
            if (error || !soda) { this.finishPrepare(error ?? new Error('苏打模型缺失')); return; }
            loadRaceAsset(RESOURCE_PATHS.entertainmentSupplies.slush, Prefab, (slushError, slush) => {
                if (this.disposed) return;
                if (slushError || !slush || !this.world.isValid) { this.finishPrepare(slushError ?? new Error('冰沙模型缺失')); return; }
                try {
                    this.supplyPresentation = new SupplyRacePresentation(this.world, this.course, this.supplies!.slots.length,
                        soda, slush, this.rendering!);
                    this.prepareWaterEvent();
                } catch (e) { this.finishPrepare(e instanceof Error ? e : new Error(String(e))); }
            });
        });
    }
    onStateChanged(state: GameState) {
        if (this.disposed || state === this.previousState) return;
        this.previousState = state;
        if (state === GameState.COUNTDOWN) {
            this.leaderDistance = 0; this.whirlpoolActive = !this.light;
            this.supplies?.reset(); this.litter?.reset();
            this.supplyPresentation?.reset(); this.litterPresentation?.reset(); this.whirlpoolPresentation?.reset(); this.geyser?.reset(); this.giantWave?.reset(); this.sprayBuoy?.reset(); this.cannon?.reset(); this.routeClock = 1;
            for (const racer of this.racers) { racer.swimmer.motor.configureEntertainment(true, !!this.supplies);
                racer.swimmer.motor.configureEntertainmentWhirlpools(this.whirlpools, this.course.poolWidth, laneCenterZ(racer.lane, this.course)); if (this.useGeyser) racer.swimmer.resetEntertainmentGeyser(); racer.ai?.setEntertainmentTargetZ(null); }
        } else if (state !== GameState.RACING) { this.clearInfluence(); this.whirlpoolPresentation?.reset(); this.geyser?.reset(); this.giantWave?.reset(); this.sprayBuoy?.hide(); this.cannon?.hide(); }
        for (const racer of this.racers) racer.swimmer.motor.setEntertainmentWhirlpoolActive(state === GameState.RACING && this.whirlpoolActive);
    }
    update(dt: number, state: GameState) {
        if (this.disposed) return;
        if (state !== GameState.RACING) {
            this.supplyPresentation?.update(0, this.supplies!.slots, false);
            this.litterPresentation?.update(0, this.litter!.clusters(), false);
            return;
        }
        if (!Number.isFinite(dt) || dt <= 0) return;
        let finisher = false;
        this.leaderDistance = 0;
        for (let i = 0; i < this.racers.length; i++) {
            const binding = this.racers[i], s = binding.swimmer, target = this.states[i];
            target.active = s.node.isValid && s.node.active;
            target.canContact = s.isCollisionActive;
            target.finished = s.distance >= this.raceDistance;
            target.distance = s.distance; target.lateral = s.node.position.z; target.heading = s.movementHeading;
            const litter = this.litterStates[binding.lane];
            litter.active = target.active && target.canContact; litter.finished = target.finished;
            litter.distance = target.distance; litter.lateral = target.lateral;
            if (target.active) this.leaderDistance = Math.max(this.leaderDistance, target.distance);
            if (target.finished) finisher = true;
        }
        if (finisher) { this.supplies?.cancelPending(); this.litter?.cancelPendingWaves(); this.geyser?.stopNewPulses(); this.sprayBuoy?.stopNewWaves(); this.cannon?.stopNewStrikes(); }
        const whirlpoolActive = this.whirlpoolActive || !this.light || this.leaderDistance >= this.light.waterEventDistance;
        if (this.whirlpoolActive !== whirlpoolActive) {
            this.whirlpoolActive = whirlpoolActive;
            for (const binding of this.racers) binding.swimmer.motor.setEntertainmentWhirlpoolActive(whirlpoolActive);
        }
        this.sprayBuoy?.update(dt, this.leaderDistance);
        this.cannon?.update(dt);
        this.giantWave?.update(dt);
        this.geyser?.update(dt, this.light ? this.leaderDistance : this.states[this.referenceIndex]?.distance ?? 0);
        this.supplies?.update(dt); this.litter?.update(dt, state);
        for (const binding of this.racers) binding.swimmer.motor.setEntertainmentDrag(this.litter?.environmentDragForLane(binding.lane) ?? 0);
        this.routeClock += dt;
        if (this.routeClock >= .1) {
            this.routeClock = 0;
            for (let i = 0; i < this.racers.length; i++) {
                const binding = this.racers[i];
                if (!binding.ai) continue;
                // 避让杂物优先于追逐补给；不会覆盖 Boss 或房间 AI。
                const whirlpool = this.whirlpoolActive && this.whirlpools.length && !this.states[i].finished && this.states[i].canContact
                    ? whirlpoolTargetZForAi(this.states[i].distance, this.states[i].lateral, this.course.poolWidth, this.whirlpools) : null;
                const litter = this.litter?.targetZForAi(binding.lane) ?? null;
                // 组合中先避眼前杂物，避免为了借浪加速撞向硬障碍。
                const avoid = this.cannon?.targetZForAi(binding.lane, binding.ai.intelligence.discipline) ?? this.sprayBuoy?.targetZForAi(binding.lane) ?? (this.light ? litter : null) ?? this.giantWave?.targetZForAi(i) ?? this.geyser?.targetZForAi(binding.swimmer) ?? whirlpool ?? litter;
                const supply = avoid === null ? this.supplies?.targetZForAi(i, binding.condition.energyRatio, binding.swimmer.heartRate) ?? null : null;
                binding.ai.setEntertainmentTargetZ(avoid ?? supply);
            }
        }
        this.whirlpoolPresentation?.update(this.states[this.referenceIndex]?.distance ?? 0, dt, this.whirlpoolActive);
        if (this.supplies) this.supplyPresentation?.update(dt, this.supplies.slots, true);
        if (this.litter) this.litterPresentation?.update(dt, this.litter.clusters(), true);
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true; this.clearInfluence();
        for (const binding of this.racers) binding.swimmer.motor.configureEntertainment(false);
        this.supplyPresentation?.dispose(); this.litterPresentation?.dispose(); this.litter?.dispose();
        this.sprayBuoy?.dispose(); this.cannon?.dispose(); this.geyser?.dispose(); this.giantWave?.dispose();
        if (this.useGeyser) for (const binding of this.racers) binding.swimmer.configureEntertainmentGeyser(false);
        this.whirlpoolPresentation?.dispose();
        this.rendering?.dispose(); this.rendering = null;
        this.finishPrepare(new Error('娱乐调试加载已取消'));
    }
    private waterEventBusy(): boolean {
        if (this.giantWave?.isBusy || this.geyser?.isBusy) return true;
        const spawn = this.whirlpools[0];
        return !!this.light && !!spawn && this.whirlpoolActive && this.leaderDistance < spawn.distance + 14;
    }
    private backgroundRowSafe(courseX: number): boolean {
        const worldX = this.course.distanceToWorldX(courseX);
        // 为主事件与杂物的短期漂移留空，不能只验证投下时的中心点。
        const padding = LITTER_BRAWL_TUNING.rigidItemAlongRadius + LITTER_BRAWL_TUNING.swimmerContactAlongRadius
            + LITTER_BRAWL_TUNING.driftAlongRadius + LITTER_BRAWL_TUNING.spawnWhirlpoolAlongMargin;
        const scale = Math.abs(this.course.finishX - this.course.startX) / this.course.courseLength;
        for (const spawn of this.whirlpools) {
            if (Math.abs(worldX - this.course.distanceToWorldX(spawn.distance))
                <= (WHIRLPOOL_BRAWL_TUNING.alongRadius * (spawn.radiusScale ?? 1) + padding) * scale) return false;
        }
        return this.geyser?.isBackgroundRowSafe(worldX, padding * scale) ?? true;
    }
    private clearInfluence() {
        for (const binding of this.racers) { if (this.useGeyser) binding.swimmer.resetEntertainmentGeyser(); if (this.useGiantWave) binding.swimmer.resetEntertainmentGiantWave(); binding.swimmer.motor.setEntertainmentDrag(0); binding.swimmer.motor.setEntertainmentWhirlpoolActive(false); binding.ai?.setEntertainmentTargetZ(null); }
    }
    private finishPrepare(error?: Error) {
        const done = this.prepareDone; this.prepareDone = null;
        if (error && !this.disposed) this.dispose();
        done?.(error);
    }
}
