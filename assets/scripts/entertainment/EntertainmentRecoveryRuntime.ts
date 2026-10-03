import { Mesh } from 'cc';
import type { EntertainmentRacerBinding } from '../app/EntertainmentRaceRuntime';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { laneCenterZ } from '../venue/LaneLayout';
import { RecoveryFloatPresentation } from '../character/RecoveryFloatPresentation';
import { FloatingItemRenderer } from './FloatingItemRenderer';
import { EntertainmentRecoveryController, EntertainmentRecoveryPhase, EntertainmentRecoveryReason,
    ENTERTAINMENT_RECOVERY_TUNING, entertainmentRecoveryBodyVisible } from './EntertainmentRecoveryController';

/** 本地娱乐共用的身体、AI 和扶圈接线；玩法只请求击倒，不各自复制恢复流程。 */
export class EntertainmentRecoveryRuntime {
    readonly rules: EntertainmentRecoveryController;
    private readonly bindings: (EntertainmentRacerBinding | null)[];
    private readonly rings: (RecoveryFloatPresentation | null)[];
    private disposed = false;
    constructor(course: RaceCourseLayout, private readonly racers: readonly EntertainmentRacerBinding[],
        private readonly raceDistance: number, ringMesh: Mesh, rendering: FloatingItemRenderer) {
        this.bindings = new Array(course.laneCount).fill(null);
        this.rings = new Array(course.laneCount).fill(null);
        for (const binding of racers) this.bindings[binding.lane] = binding;
        this.rules = new EntertainmentRecoveryController(course.laneCount, {
            onKnocked: lane => {
                const binding = this.bindings[lane]; if (!binding) return;
                // 先暂停 Motor，再松开 AI 的划水，避免松手结算多余推进。
                binding.swimmer.beginEntertainmentKnockout(); binding.ai?.stopSwimming();
            },
            onRespawn: (lane, state) => {
                const binding = this.bindings[lane];
                if (!binding?.swimmer.node.isValid || !binding.swimmer.node.active || binding.swimmer.distance >= raceDistance) return;
                binding.swimmer.respawnAfterEntertainmentHit(state.distance, laneCenterZ(lane, course), ENTERTAINMENT_RECOVERY_TUNING.respawnSpeed);
                if (binding.swimmer.isRacing) binding.ai?.startSwimming();
                this.rings[lane]?.hide();
            },
            onRecovered: lane => this.bindings[lane]?.swimmer.endEntertainmentInvulnerability(),
        });
        try {
            for (const binding of racers) {
                binding.swimmer.cartoonRig?.prepareEntertainmentRecovery();
                const ring = new RecoveryFloatPresentation(binding.swimmer.node, ringMesh, rendering);
                this.rings[binding.lane] = ring;
                if (binding.swimmer.cartoonRig) binding.swimmer.cartoonRig.onEntertainmentRecoveryFloat = (pose, weight) => ring.update(pose, weight);
            }
        } catch (error) { this.dispose(); throw error; }
    }
    knockDown(lane: number, reason: EntertainmentRecoveryReason, distance: number): boolean {
        const binding = this.bindings[lane];
        return !this.disposed && !!binding?.swimmer.canHitSprayBuoy && binding.swimmer.distance < this.raceDistance
            && !!this.rules.tryKnockDown(lane, reason, distance);
    }
    update(dt: number): void {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
        for (const binding of this.racers) {
            const s = binding.swimmer;
            if (!s.node.isValid || !s.node.active || s.distance >= this.raceDistance || (!s.isRacing && !s.isEntertainmentKnocked)) {
                this.rules.retireLane(binding.lane); this.rings[binding.lane]?.hide(); s.resetEntertainmentRecovery();
            }
        }
        this.rules.update(dt);
        for (const binding of this.racers) {
            const state = this.rules.stateForLane(binding.lane)!;
            if (state.phase === EntertainmentRecoveryPhase.KNOCKED) {
                binding.swimmer.syncEntertainmentKnockoutPresentation(ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds - state.remainingSeconds);
            }
            const visible = entertainmentRecoveryBodyVisible(state.phase, state.remainingSeconds);
            binding.swimmer.syncEntertainmentRecoveryBodyVisibility(visible); this.rings[binding.lane]?.setBlinkVisible(visible);
        }
    }
    reset(): void {
        if (this.disposed) return;
        for (const binding of this.racers) {
            binding.swimmer.resetEntertainmentRecovery(); this.rings[binding.lane]?.hide(); this.rings[binding.lane]?.setBlinkVisible(true);
        }
        this.rules.reset();
    }
    dispose(): void {
        if (this.disposed) return;
        this.reset(); this.disposed = true;
        for (const binding of this.racers) {
            if (binding.swimmer.cartoonRig) binding.swimmer.cartoonRig.onEntertainmentRecoveryFloat = null;
            this.rings[binding.lane]?.dispose();
        }
    }
}
