import { Mesh, Node } from 'cc';
import type { EntertainmentRacerBinding } from '../app/EntertainmentRaceRuntime';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { CannonBrawlController, CannonImpact, CannonRacerState } from './CannonBrawlController';
import { CannonBrawlPresentation } from './CannonBrawlPresentation';
import { EntertainmentRecoveryRuntime } from './EntertainmentRecoveryRuntime';
import { EntertainmentRecoveryReason } from './EntertainmentRecoveryController';
import { FloatingItemLayers, FloatingItemRenderer } from './FloatingItemRenderer';
import { SprayBuoySplashPool } from './SprayBuoySplashPool';

/** 单发炮击的本地接线，不依赖 GameManager 内部对象、网络或云结算。 */
export class CannonRaceController {
    readonly rules: CannonBrawlController;
    private readonly states: CannonRacerState[];
    private recovery: EntertainmentRecoveryRuntime | null = null;
    private presentation: CannonBrawlPresentation | null = null;
    private splashes: SprayBuoySplashPool | null = null;
    private disposed = false;
    constructor(world: Node, course: RaceCourseLayout, private readonly racers: readonly EntertainmentRacerBinding[],
        seed: number, private readonly raceDistance: number, meshes: readonly Mesh[], rendering: FloatingItemRenderer,
        layers: FloatingItemLayers | null) {
        this.states = Array.from({ length: course.laneCount }, () => ({ active: false, finished: false, damageable: false, distance: 0, lateral: 0, speed: 0 }));
        this.rules = new CannonBrawlController(course.laneCount, seed, course.poolWidth, lane => this.states[lane],
            launch => this.presentation?.showLaunch(launch), impact => this.onImpact(impact),
            Math.max(0, raceDistance - 20), distance => course.distanceToWorldX(distance));
        try {
            this.recovery = new EntertainmentRecoveryRuntime(course, racers, raceDistance, meshes[4], rendering);
            // 单发之间最短仍有1.25秒，只预建一个0.95秒的喷水槽，不建浮标入水池。
            this.splashes = new SprayBuoySplashPool(world, [meshes[5], meshes[6], meshes[5], meshes[6], meshes[7]], layers, 0, 1);
            this.presentation = new CannonBrawlPresentation(world, course, meshes, this.splashes, rendering, layers);
        } catch (error) { this.dispose(); throw error; }
    }
    reset(): void { if (!this.disposed) { this.recovery?.reset(); this.rules.reset(); this.presentation?.reset(); this.splashes?.reset(); } }
    stopNewStrikes(): void { this.rules.stopNewStrikes(); }
    update(dt: number): void {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
        const step = Math.min(.1, dt);
        this.recovery?.update(step);
        for (const binding of this.racers) {
            const s = binding.swimmer, r = this.states[binding.lane];
            r.active = s.node.isValid && s.node.active && s.isRacing;
            r.damageable = s.canHitSprayBuoy && !!this.recovery?.rules.isDamageable(binding.lane);
            r.finished = s.distance >= this.raceDistance; r.distance = s.distance; r.lateral = s.node.position.z; r.speed = s.currentSpeed;
        }
        this.rules.update(step);
        this.presentation?.update(step, this.rules.currentLaunch(), this.rules.currentRemainingSeconds()); this.splashes?.update(step);
    }
    targetZForAi(lane: number, discipline: number): number | null {
        const r = this.states[lane];
        return this.disposed || !r?.active || r.finished || !r.damageable ? null : this.rules.targetZForAi(r.distance, r.lateral, discipline);
    }
    hide(): void { if (!this.disposed) { this.recovery?.reset(); this.rules.reset(); this.presentation?.hide(); this.splashes?.reset(); } }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.recovery?.dispose(); this.presentation?.dispose(); this.splashes?.dispose();
    }
    private onImpact(impact: CannonImpact): void {
        this.presentation?.showImpact(impact);
        for (const binding of this.racers) {
            const lane = binding.lane, s = binding.swimmer;
            if (!(impact.hitMask & (1 << lane)) || !s.canHitSprayBuoy || !this.recovery?.rules.isDamageable(lane)) continue;
            if (lane === impact.knockedLane) {
                if (this.recovery.knockDown(lane, EntertainmentRecoveryReason.CANNON, impact.knockedDistance)) s.cartoonRig?.triggerBigSplash(2.8);
            } else {
                const away = Math.sign(s.node.position.z - impact.targetZ) || (lane & 1 ? 1 : -1);
                s.applyCollisionImpulse(-1.05, away * 2.25); s.applyCollisionAxialImpulse(away * 4.2);
                s.applyCollisionPitchImpulse(-2.6); s.applyCollisionSoftnessImpulse(away * 1.35, -.7); s.cartoonRig?.triggerBigSplash(1.75);
            }
        }
    }
}
