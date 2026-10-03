import { hasSwimmerCollisionContact } from '../entity/SwimmerCollisionResolver';
import { Mesh, Node, Prefab, Vec3 } from 'cc';
import type { EntertainmentRacerBinding } from '../app/EntertainmentRaceRuntime';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { MineRelayArm, MineRelayBrawlController, MineRelayRacerState, MineRelayResolution } from './MineRelayBrawlController';
import { MINE_RELAY_TUNING } from '../core/EntertainmentBalance';
import { MineRelayBrawlPresentation } from './MineRelayBrawlPresentation';
import { EntertainmentRecoveryRuntime } from './EntertainmentRecoveryRuntime';
import { EntertainmentRecoveryReason } from './EntertainmentRecoveryController';
import { FloatingItemLayers, FloatingItemRenderer } from './FloatingItemRenderer';
import { SprayBuoySplashPool } from './SprayBuoySplashPool';
import { MineRelayBrawlHud } from '../ui/MineRelayBrawlHud';

/** 本地水球的比赛接线；普通赛和联机不创建。 */
export class MineRelayRaceController {
    readonly rules: MineRelayBrawlController;
    private readonly states: MineRelayRacerState[];
    private readonly bindings: (EntertainmentRacerBinding | null)[];
    private recovery: EntertainmentRecoveryRuntime | null = null;
    private presentation: MineRelayBrawlPresentation | null = null;
    private splashes: SprayBuoySplashPool | null = null;
    private hud: MineRelayBrawlHud | null = null;
    private readonly explosionPosition = new Vec3();
    private disposed = false;
    constructor(world: Node, private readonly course: RaceCourseLayout, private readonly racers: readonly EntertainmentRacerBinding[],
        seed: number, private readonly raceDistance: number, balloon: Prefab, meshes: readonly Mesh[], rendering: FloatingItemRenderer,
        layers: FloatingItemLayers | null, hudParent: Node | null) {
        this.states = Array.from({ length: course.laneCount }, () => ({ active: false, recovering: false, finished: false, distance: 0, lateral: 0, speed: 0 }));
        this.bindings = new Array(course.laneCount).fill(null);
        const byNode = new Map<Node, EntertainmentRacerBinding>();
        for (const binding of racers) { this.bindings[binding.lane] = binding; byNode.set(binding.swimmer.node, binding); }
        this.rules = new MineRelayBrawlController(course.laneCount, seed, course.poolWidth, lane => this.states[lane],
            arm => this.presentation?.attach(arm, this.carrierNode(arm), true),
            transfer => this.presentation?.transfer(this.rules.currentArm()!, this.bindings[transfer.fromLane]?.swimmer.node ?? null,
                this.bindings[transfer.toLane]?.swimmer.node ?? null), event => this.onResolution(event), undefined,
            (a, b) => hasSwimmerCollisionContact(this.bindings[a]?.swimmer ?? null, this.bindings[b]?.swimmer ?? null),
            distance => course.distanceToWorldX(distance), distance => course.directionAtDistance(distance));
        try {
            this.recovery = new EntertainmentRecoveryRuntime(course, racers, raceDistance, meshes[0], rendering);
            for (const binding of racers) binding.swimmer.cartoonRig?.prepareTimedWaterBalloonMount();
            this.splashes = new SprayBuoySplashPool(world, [meshes[1], meshes[2], meshes[1], meshes[2], meshes[3]], layers, 0, 1);
            this.presentation = new MineRelayBrawlPresentation(world, course, this.splashes,
                node => byNode.get(node)?.swimmer.cartoonRig?.prepareTimedWaterBalloonMount() ?? null, balloon, rendering);
            if (hudParent) this.hud = new MineRelayBrawlHud(hudParent);
        } catch (error) { this.dispose(); throw error; }
    }
    reset(): void { if (!this.disposed) { this.recovery?.reset(); this.rules.reset(); this.presentation?.reset(); this.splashes?.reset(); this.hud?.setRacing(false); } }
    setRacing(racing: boolean): void { this.hud?.setRacing(racing); }
    stopNewRounds(): void { this.rules.cancelPendingRoundsAfterCurrent(); }
    update(dt: number): void {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
        const step = Math.min(.1, dt);
        this.recovery?.update(step);
        for (const binding of this.racers) {
            const s = binding.swimmer, r = this.states[binding.lane];
            r.active = s.node.isValid && s.node.active && (s.isRacing || s.isEntertainmentKnocked);
            r.recovering = !s.canHitSprayBuoy || !this.recovery?.rules.isDamageable(binding.lane);
            r.finished = s.distance >= this.raceDistance; r.distance = s.distance; r.lateral = s.node.position.z; r.speed = s.currentSpeed;
        }
        this.rules.update(step);
        const arm = this.rules.currentArm();
        this.presentation?.update(step, arm, this.carrierNode(arm), this.rules.currentRemainingSeconds(), this.rules.isLocked(), true);
        this.splashes?.update(step);
        this.hud?.update(step, this.rules.currentCarrierLane(), this.rules.currentRemainingSeconds(), this.rules.isLocked(), this.rules.isPaused(), this.rules.remainingRoundCount());
    }
    targetZForAi(lane: number, discipline: number): number | null {
        return this.disposed ? null : this.rules.targetZForAi(lane, discipline);
    }
    hide(): void { this.reset(); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.recovery?.dispose(); this.presentation?.dispose(); this.splashes?.dispose(); this.hud?.dispose();
        for (const binding of this.racers) binding.swimmer.cartoonRig?.releaseTimedWaterBalloonMount();
    }
    private carrierNode(arm: MineRelayArm | null): Node | null { return arm ? this.bindings[arm.carrierLane]?.swimmer.node ?? null : null; }
    private onResolution(event: MineRelayResolution): void {
        this.explosionPosition.set(this.course.distanceToWorldX(event.distance), this.course.waterY + .035, event.lateral);
        this.presentation?.showResolution(event.exploded, event.exploded ? this.explosionPosition : null);
        if (!event.exploded) return;
        for (const binding of this.racers) {
            const lane = binding.lane, s = binding.swimmer;
            if (!(event.hitMask & (1 << lane)) || !s.canHitSprayBuoy || !this.recovery?.rules.isDamageable(lane)) continue;
            if (lane === event.carrierLane) {
                const away = Math.sign(s.node.position.z) || (lane & 1 ? 1 : -1), t = MINE_RELAY_TUNING;
                s.applyCollisionImpulse(-t.explosionBackwardImpulse, away * t.explosionLateralImpulse);
                s.applyCollisionAxialImpulse(away * t.explosionAxialImpulse); s.applyCollisionPitchImpulse(-t.explosionPitchImpulse);
                s.applyCollisionSoftnessImpulse(away * t.explosionSoftnessLateralImpulse, t.explosionSoftnessForwardImpulse);
                s.cartoonRig?.triggerBigSplash(2.45);
                if (this.recovery.knockDown(lane, EntertainmentRecoveryReason.TIMED_BOMB, event.distance)) this.states[lane].recovering = true;
            } else {
                const away = Math.sign(s.node.position.z - event.lateral) || (lane & 1 ? 1 : -1);
                s.applyCollisionImpulse(-1.05, away * 2.25); s.applyCollisionAxialImpulse(away * 4.2);
                s.applyCollisionPitchImpulse(-2.6); s.applyCollisionSoftnessImpulse(away * 1.35, -.7); s.cartoonRig?.triggerBigSplash(1.75);
            }
        }
    }
}
