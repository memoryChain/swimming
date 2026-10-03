import { Mesh, Node, Prefab } from 'cc';
import { GameState } from '../core/GameConstants';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { EntertainmentRecoveryRuntime } from './EntertainmentRecoveryRuntime';
import type { EntertainmentRacerBinding } from '../app/EntertainmentRaceRuntime';
import { SprayBuoyController, SprayBuoyRacerState, SprayBuoyImpact, SPRAY_BUOY_TUNING } from './SprayBuoyController';
import { EntertainmentRecoveryReason } from './EntertainmentRecoveryController';
import { SprayBuoyPresentation } from './SprayBuoyPresentation';
import { SprayBuoySplashPool } from './SprayBuoySplashPool';
import { FloatingItemRenderer, FloatingItemLayers } from './FloatingItemRenderer';

/** 本地娱乐浮标与共用恢复的生命周期。全部资源已在赛前加载。 */
export class SprayBuoyRaceController {
    private readonly states: SprayBuoyRacerState[];
    private readonly bindings: (EntertainmentRacerBinding | null)[];
    private recoveryRuntime: EntertainmentRecoveryRuntime | null = null;
    readonly rules: SprayBuoyController;
    get recovery() { return this.recoveryRuntime!.rules; }
    private presentation: SprayBuoyPresentation | null = null;
    private splashes: SprayBuoySplashPool | null = null;
    private newWaves = true;
    private disposed = false;
    constructor(world: Node, private readonly course: RaceCourseLayout, private readonly racers: readonly EntertainmentRacerBinding[],
        seed: number, private readonly raceDistance: number, buoy: Prefab, ringMesh: Mesh, splashMeshes: readonly Mesh[],
        rendering: FloatingItemRenderer, layers: FloatingItemLayers | null) {
        this.states = Array.from({ length: course.laneCount }, () => ({ active: false, finished: false, distance: 0, lateral: 0 }));
        this.bindings = new Array(course.laneCount).fill(null);
        for (const binding of racers) this.bindings[binding.lane] = binding;
        this.rules = new SprayBuoyController(course.laneCount, seed, course.poolWidth, lane => this.states[lane],
            impact => this.onImpact(impact), SPRAY_BUOY_TUNING.mineCount,
            [SPRAY_BUOY_TUNING.waveSecondDistance, SPRAY_BUOY_TUNING.waveThirdDistance].filter(distance => distance < raceDistance),
            undefined, course.courseLength);
        try {
            this.splashes = new SprayBuoySplashPool(world, splashMeshes, layers);
            this.presentation = new SprayBuoyPresentation(world, course, this.rules.mines().length, this.splashes, buoy, rendering);
            this.recoveryRuntime = new EntertainmentRecoveryRuntime(course, racers, raceDistance, ringMesh, rendering);
        } catch (error) { this.dispose(); throw error; }
    }
    reset(): void {
        if (this.disposed) return;
        this.recoveryRuntime?.reset(); this.refreshStates(); this.rules.reset();
        this.presentation?.reset(); this.splashes?.reset(); this.newWaves = true;
    }
    stopNewWaves(): void { if (this.newWaves) { this.newWaves = false; this.rules.cancelUnarmedMines(); } }
    update(dt: number, leader: number): void {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
        const step = Math.min(.1, dt);
        this.recoveryRuntime?.update(step);
        this.refreshStates();
        this.rules.update(step, GameState.RACING, leader, this.newWaves);
        this.presentation?.update(step, this.rules.mines(), true); this.splashes?.update(step);
    }
    targetZForAi(lane: number): number | null { return this.disposed ? null : this.rules.targetZForAi(lane); }
    hide(): void { if (this.disposed) return; this.recoveryRuntime?.reset(); this.presentation?.reset(); this.splashes?.reset(); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.recoveryRuntime?.dispose();
        // 前面的模型池若先失败，恢复拥有者还未创建，仍清空本局旧挂钩。
        for (const binding of this.racers) if (binding.swimmer.cartoonRig) binding.swimmer.cartoonRig.onEntertainmentRecoveryFloat = null;
        this.presentation?.dispose(); this.splashes?.dispose();
    }
    private refreshStates(): void {
        for (const binding of this.racers) {
            const s = binding.swimmer, state = this.states[binding.lane];
            state.active = s.canHitSprayBuoy && this.recovery.isDamageable(binding.lane);
            state.finished = s.distance >= this.raceDistance; state.distance = s.distance; state.lateral = s.node.position.z;
        }
    }
    private onImpact(impact: SprayBuoyImpact): void {
        this.presentation?.showImpact(impact, this.rules.mines()[impact.mineId], impact.revision);
        const direct = this.bindings[impact.hitLane];
        if (direct) {
            direct.swimmer.cartoonRig?.triggerBigSplash(2.45);
            if (this.recoveryRuntime?.knockDown(impact.hitLane, EntertainmentRecoveryReason.MINEFIELD, direct.swimmer.distance)) this.states[impact.hitLane].active = false;
        }
        // 原玩法只有直接接触者扶圈恢复；范围内其他人消费主干碰撞反应。
        for (const binding of this.racers) {
            const lane = binding.lane, s = binding.swimmer;
            if (lane === impact.hitLane || !(impact.hitMask & (1 << lane)) || !s.canHitSprayBuoy || !this.recovery.isDamageable(lane)) continue;
            const away = Math.sign(s.node.position.z - impact.lateral) || (lane & 1 ? 1 : -1);
            s.applyCollisionImpulse(-1.05, away * 2.25); s.applyCollisionAxialImpulse(away * 4.2);
            s.applyCollisionPitchImpulse(-2.6); s.applyCollisionSoftnessImpulse(away * 1.35, -.7);
            s.cartoonRig?.triggerBigSplash(1.75);
        }
    }
}
