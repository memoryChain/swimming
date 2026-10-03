import { advanceWaveBoost, sweptWaveWeight, type GiantWaveState, GIANT_WAVE_TUNING } from '../entertainment/GiantWaveRules';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';

/** 只在本地巨浪调试分配；助力与阻力共用一个有符号缓冲，不改基础游速和碰撞冲量。 */
export class GiantWaveSwimmerCurrent {
    eligible = false;
    riding = false;
    opposed = false;
    slowdown = 0;
    lift = 0;
    readonly output = { speed: 0, average: 0, positiveAverage: 0, negativeAverage: 0 };
    private previousX = NaN;
    private previousZ = 0;
    private direction = 0;
    constructor(readonly state: GiantWaveState, readonly tuning: Readonly<typeof GIANT_WAVE_TUNING>,
        readonly course: RaceCourseLayout, readonly laneZ: number) {}
    matches(state: GiantWaveState, tuning: Readonly<typeof GIANT_WAVE_TUNING>, course: RaceCourseLayout, laneZ: number): boolean {
        return this.state === state && this.tuning === tuning && this.course === course && this.laneZ === laneZ;
    }
    reset(): void {
        this.eligible = this.riding = this.opposed = false;
        this.previousX = NaN; this.direction = 0;
        this.slowdown = this.lift = 0;
        this.output.speed = this.output.average = this.output.positiveAverage = this.output.negativeAverage = 0;
    }
    setEligible(value: boolean): void { if (!value) { if (this.eligible) this.reset(); } else this.eligible = true; }
    advance(distance: number, lateral: number, dt: number): void {
        if (!this.eligible || !Number.isFinite(dt) || dt <= 0) return;
        const x = this.course.distanceToWorldX(distance), z = this.laneZ + lateral;
        const direction = this.course.directionAtDistance(distance);
        if (direction !== this.direction) { this.reset(); this.eligible = true; this.direction = direction; }
        const weight = sweptWaveWeight(this.state, x, z,
            Number.isFinite(this.previousX) ? this.previousX : x,
            Number.isFinite(this.previousX) ? this.previousZ : z, direction, dt);
        this.riding = weight > (this.riding ? .02 : .08);
        this.opposed = weight < (this.opposed ? -.02 : -.08);
        advanceWaveBoost(this.output.speed, weight * this.state.boost, this.state.boost, dt, this.output, this.tuning);
        this.slowdown = this.state.slowdown * Math.min(1, this.output.negativeAverage / Math.max(.01, this.state.boost));
        this.lift = Math.min(1, Math.abs(this.output.speed) / Math.max(.01, this.state.boost)) * this.tuning.height * .45;
        this.previousX = x; this.previousZ = z;
    }
}
