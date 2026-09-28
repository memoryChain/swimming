import type { Node } from 'cc';
import type { Swimmer } from '../entity/Swimmer';
import type { ForcedLaunchStart } from '../swimmer/ForcedLaunchModel';
import type { GeyserWorldState } from '../net/NetGeyserSnapshot';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { GEYSER_TUNING, geyserBurstHeight, geyserBurstOverlap, geyserPhaseAt, geyserSpec, geyserPulseStart, geyserHitId,
    geyserSweptHit, planGeyserVents, type GeyserHitStrength,
    type GeyserTuning, type GeyserIntensity, type GeyserVent } from './GeyserBrawlRules';
import { GeyserBrawlPresentation } from './GeyserBrawlPresentation';

/** 喷口时钟和权威命中；画面从相同时钟重建，不参与判定。 */
export class GeyserBrawlController {
    readonly vents: readonly GeyserVent[];
    readonly spec;
    private readonly visual: GeyserBrawlPresentation;
    private readonly previousX: Float32Array;
    private readonly previousZ: Float32Array;
    private age = 0;
    private stoppedAt = Number.POSITIVE_INFINITY;
    private authoritative = true;

    constructor(parent: Node, private readonly course: RaceCourseLayout,
        private readonly swimmers: readonly (Swimmer | null)[], seed: number,
        private readonly serial: number, private readonly intensity: GeyserIntensity,
        private readonly anchorDistance: number,
        private readonly onHit?: (lane: number, hitId: number, strength: 1 | 2,
            age: number, start: ForcedLaunchStart | null) => void,
        private readonly tuning: GeyserTuning = GEYSER_TUNING,
    ) {
        this.spec = geyserSpec(intensity);
        for (const swimmer of swimmers) if (swimmer) swimmer.geyserTuning = tuning;
        // 首排完整预警后可达，后排沿前进方向展开，不能固定往世界坐标正向排。
        const futureDistance = anchorDistance + 6;
        const anchorX = course.distanceToWorldX(futureDistance);
        const minX = Math.min(course.startX, course.finishX) + 5;
        const maxX = Math.max(course.startX, course.finishX) - 5;
        const direction = Math.sign(course.distanceToWorldX(futureDistance + 0.5) - anchorX) || course.direction;
        const extent = Math.floor((this.spec.ventCount - 1) / 4) * 3.4 + 0.2;
        const centerX = Math.max(minX + (direction < 0 ? extent : 0),
            Math.min(maxX - (direction > 0 ? extent : 0), anchorX));
        this.vents = planGeyserVents(seed, serial, intensity, centerX, 0,
            Math.abs(course.finishX - course.startX) * 0.5, course.poolWidth * 0.5, direction);
        this.previousX = new Float32Array(swimmers.length);
        this.previousZ = new Float32Array(swimmers.length);
        this.capturePositions();
        this.visual = new GeyserBrawlPresentation(parent, course.swimY, this.spec.ventCount, course.waterY);
    }

    get elapsedSeconds(): number { return this.age; }
    get isDone(): boolean { return this.age >= this.spec.actionSeconds; }
    setAuthority(authoritative: boolean): void { this.authoritative = authoritative; }
    stopNewPulses(): void { this.stoppedAt = Math.min(this.stoppedAt, this.age); }

    snapshotWorld(active = true): GeyserWorldState {
        return { serial: this.serial, intensity: this.intensity, anchorDistance: this.anchorDistance,
            age: this.age, stoppedAt: Number.isFinite(this.stoppedAt) ? this.stoppedAt : -1, active };
    }

    restoreWorld(state: GeyserWorldState, lateSeconds: number): void {
        if (state.serial !== this.serial) return;
        if (state.stoppedAt >= 0) this.stoppedAt = Math.min(this.stoppedAt, state.stoppedAt);
        // 恢复只推进表现和采样基线，不能补算断流期间经过的历史喷口。
        this.age = Math.min(this.spec.actionSeconds, Math.max(this.age, state.age + Math.max(0, lateSeconds)));
        this.visual.update(this.vents, this.age, this.spec.pulseCount, this.stoppedAt, this.tuning);
        this.capturePositions();
    }

    update(dt: number, authoritativeAge?: number): void {
        const previousAge = this.age;
        this.age = Math.min(this.spec.actionSeconds,
            Number.isFinite(authoritativeAge) ? Math.max(this.age, authoritativeAge!)
                : this.age + Math.max(0, Number.isFinite(dt) ? dt : 0));
        this.visual.update(this.vents, this.age, this.spec.pulseCount, this.stoppedAt, this.tuning);
        if (this.authoritative) this.resolveHits(previousAge, this.age);
        this.capturePositions();
    }

    dispose(): void { this.visual.dispose(); }

    targetZForAi(swimmer: Swimmer | null): number | null {
        if (!swimmer || this.isDone || swimmer.isForcedLaunchActive) return null;
        const x = this.course.distanceToWorldX(swimmer.distance);
        const z = swimmer.node.position.z;
        const direction = Math.sign(this.course.distanceToWorldX(swimmer.distance + 0.5) - x) || 1;
        let nearest = 8;
        let target: number | null = null;
        for (const vent of this.vents) {
            const phase = geyserPhaseAt(vent, this.age, this.spec.pulseCount, this.tuning);
            if (phase !== 'warning' && phase !== 'burst') continue;
            if ((vent.x - x) * direction < -0.5) continue;
            const distance = Math.abs(x - vent.x);
            if (distance >= nearest || Math.abs(z - vent.z) > 2.2) continue;
            nearest = distance;
            const away = z >= vent.z ? 1 : -1;
            const bound = this.course.poolWidth * 0.5 - 0.8;
            target = Math.max(-bound, Math.min(bound, vent.z + away * 2.2));
        }
        return target;
    }

    private capturePositions(): void {
        for (let lane = 0; lane < this.swimmers.length; lane++) {
            const swimmer = this.swimmers[lane];
            if (!swimmer) continue;
            this.previousX[lane] = this.course.distanceToWorldX(swimmer.distance);
            this.previousZ[lane] = swimmer.startPosition.z + swimmer.motor.lateralOffset;
        }
    }

    private resolveHits(fromAge: number, toAge: number): void {
        if (toAge <= fromAge) return;
        for (let lane = 0; lane < this.swimmers.length; lane++) {
            const swimmer = this.swimmers[lane];
            if (!swimmer?.geyserHitEligible) continue;
            const toX = this.course.distanceToWorldX(swimmer.distance);
            const toZ = swimmer.startPosition.z + swimmer.motor.lateralOffset;
            let best: GeyserHitStrength = 0;
            let bestId = -1;
            for (const vent of this.vents) {
                for (let pulse = 0; pulse < this.spec.pulseCount; pulse++) {
                    if (geyserPulseStart(vent, pulse, this.tuning) > this.stoppedAt) continue;
                    if (geyserBurstOverlap(vent, pulse, fromAge, toAge, this.tuning) <= 0) continue;
                    const burstStart = geyserPulseStart(vent, pulse, this.tuning) + this.tuning.warningSeconds;
                    const overlapStart = Math.max(fromAge, burstStart);
                    const overlapEnd = Math.min(toAge, burstStart + this.tuning.burstSeconds);
                    const mid = Math.max(overlapStart,
                        Math.min(overlapEnd, burstStart + this.tuning.burstRiseSeconds));
                    const height = geyserBurstHeight(vent, pulse, mid, this.tuning);
                    const topY = this.course.swimY - 1.4 + height * 2.7;
                    if (swimmer.node.position.y > topY + 0.35) continue;
                    const span = Math.max(0.00001, toAge - fromAge);
                    const fromX = this.previousX[lane], fromZ = this.previousZ[lane];
                    const displacementSq = (toX - fromX) ** 2 + (toZ - fromZ) ** 2;
                    // A network correction is not a physical traverse through every vent between two positions.
                    const startRatio = displacementSq > 16 ? 1 : (overlapStart - fromAge) / span;
                    const endRatio = displacementSq > 16 ? 1 : (overlapEnd - fromAge) / span;
                    const strength = geyserSweptHit(vent,
                        fromX + (toX - fromX) * startRatio,
                        fromZ + (toZ - fromZ) * startRatio,
                        fromX + (toX - fromX) * endRatio,
                        fromZ + (toZ - fromZ) * endRatio, this.tuning);
                    if (strength > best) {
                        best = strength;
                        bestId = geyserHitId(this.serial, pulse, vent.id, lane);
                    }
                }
            }
            if (best && bestId > 0 && swimmer.applyGeyserHit(bestId, best)) {
                this.onHit?.(lane, bestId, best, toAge, swimmer.forcedLaunchStart);
            }
        }
    }
}
