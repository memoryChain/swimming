import { Node, Vec3, Quat } from 'cc';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { getRaceDistance } from '../core/GameBalance';
import { CHARACTER_POSE_TUNING } from '../character/CharacterMotionTuning';

/** 原 butterfly 落水表现，按共用恢复时间采样，不推进赛程。 */
export class EntertainmentKnockoutMotion {
    private active = false;
    private distance = 0;
    private heading = 0;
    private readonly _entertainmentLandingStartPosition = new Vec3();
    private readonly _entertainmentLandingEndPosition = new Vec3();
    private readonly _entertainmentLandingPosition = new Vec3();
    private readonly _entertainmentLandingStartRotation = new Quat();
    private readonly _entertainmentLandingEndRotation = new Quat();
    private readonly _entertainmentLandingRotation = new Quat();
    private _entertainmentLandingDuration = 0;
    private _entertainmentLandingPeakY = 0;
    private _entertainmentLandingRiseRatio = 0;
    private _entertainmentLandingImpactOffsetX = 0;
    private _entertainmentLandingImpactOffsetZ = 0;
    private _entertainmentLandingComplete = true;
    private _entertainmentLandingSampled = false;
    private _entertainmentLandingSplashPlayed = true;
    constructor(private readonly node: Node, private readonly _courseLayout: RaceCourseLayout,
        private readonly onPoseElapsed: (elapsed: number, landing: number) => void,
        private readonly onLandingSplash: (scale: number) => void) {}
    sample(elapsedSeconds: number): void {
        if (!this.active) return;
        const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
        const duration = this._entertainmentLandingDuration;
        if (duration > 0 && !this._entertainmentLandingComplete) {
            const firstSample = !this._entertainmentLandingSampled;
            this._entertainmentLandingSampled = true;
            const t = Math.min(1, elapsed / duration);
            const eased = t * t * (3 - 2 * t);
            Vec3.lerp(
                this._entertainmentLandingPosition,
                this._entertainmentLandingStartPosition,
                this._entertainmentLandingEndPosition,
                eased,
            );
            const impactArc = 4 * t * (1 - t);
            this._entertainmentLandingPosition.x += this._entertainmentLandingImpactOffsetX * impactArc;
            this._entertainmentLandingPosition.z += this._entertainmentLandingImpactOffsetZ * impactArc;
            this._entertainmentLandingPosition.x = this._courseLayout.clampSwimWorldX(
                this._entertainmentLandingPosition.x,
            );
            const halfPoolWidth = Math.max(0.3, this._courseLayout.poolWidth * 0.5 - 0.5);
            this._entertainmentLandingPosition.z = Math.max(
                -halfPoolWidth,
                Math.min(halfPoolWidth, this._entertainmentLandingPosition.z),
            );
            if (this._entertainmentLandingRiseRatio > 0 && t < this._entertainmentLandingRiseRatio) {
                const riseT = t / this._entertainmentLandingRiseRatio;
                const riseEase = 1 - (1 - riseT) * (1 - riseT);
                this._entertainmentLandingPosition.y = this._entertainmentLandingStartPosition.y
                    + (this._entertainmentLandingPeakY - this._entertainmentLandingStartPosition.y) * riseEase;
            } else {
                const fallStart = this._entertainmentLandingRiseRatio;
                const fallT = Math.max(0, Math.min(1, (t - fallStart) / Math.max(0.01, 1 - fallStart)));
                this._entertainmentLandingPosition.y = this._entertainmentLandingPeakY
                    + (this._entertainmentLandingEndPosition.y - this._entertainmentLandingPeakY) * fallT * fallT;
            }
            Quat.slerp(
                this._entertainmentLandingRotation,
                this._entertainmentLandingStartRotation,
                this._entertainmentLandingEndRotation,
                eased,
            );
            this.node.setPosition(this._entertainmentLandingPosition);
            this.node.setRotation(this._entertainmentLandingRotation);
            if (t >= 1) {
                this._entertainmentLandingComplete = true;
                if (!firstSample && !this._entertainmentLandingSplashPlayed) {
                    this._entertainmentLandingSplashPlayed = true;
                    this.onLandingSplash(
                        CHARACTER_POSE_TUNING.entertainmentKnockoutLandingSplashScale,
                    );
                }
            }
        }
        // 原始权威时间驱动失衡；落水时长只决定找圈何时开始，不能吞掉受击前段。
        this.onPoseElapsed(elapsed, duration);
    }

    begin(distance: number, heading: number): void {
        this.distance = distance; this.heading = heading; this.active = true;
        Vec3.copy(this._entertainmentLandingStartPosition, this.node.position);
        Vec3.copy(this._entertainmentLandingEndPosition, this._entertainmentLandingStartPosition);
        Quat.copy(this._entertainmentLandingStartRotation, this.node.rotation);
        const visualDistance = Math.min(this.distance, getRaceDistance());
        const direction = this._courseLayout.finishDirectionAtDistance(visualDistance);
        const headingDegrees = this.heading * 180 / Math.PI;
        const yaw = (direction > 0 ? 0 : 180) - direction * headingDegrees;
        Quat.fromEuler(this._entertainmentLandingEndRotation, 0, yaw, 0);
        const swimY = this._courseLayout.swimY;
        const height = this._entertainmentLandingStartPosition.y - swimY;
        this._entertainmentLandingImpactOffsetX = 0;
        this._entertainmentLandingImpactOffsetZ = 0;
        if (Math.abs(height) > CHARACTER_POSE_TUNING.entertainmentKnockoutAirborneThreshold) {
            this._entertainmentLandingEndPosition.y = swimY;
            this._entertainmentLandingPeakY = this._entertainmentLandingStartPosition.y;
            this._entertainmentLandingRiseRatio = 0;
            this._entertainmentLandingDuration = Math.min(
                CHARACTER_POSE_TUNING.entertainmentKnockoutLandingMaxSeconds,
                Math.max(
                    CHARACTER_POSE_TUNING.entertainmentKnockoutLandingMinSeconds,
                    CHARACTER_POSE_TUNING.entertainmentKnockoutLandingMinSeconds
                        + Math.abs(height) * CHARACTER_POSE_TUNING.entertainmentKnockoutLandingSecondsPerMeter,
                ),
            );
            this._entertainmentLandingComplete = false;
            this._entertainmentLandingSplashPlayed = false;
        } else {
            this._entertainmentLandingPeakY = this._entertainmentLandingStartPosition.y;
            this._entertainmentLandingRiseRatio = 0;
            this._entertainmentLandingDuration = 0;
            this._entertainmentLandingComplete = true;
            this._entertainmentLandingSplashPlayed = true;
            this.node.setRotation(this._entertainmentLandingEndRotation);
        }
        this._entertainmentLandingSampled = false;
    }

    reset(): void {
        this.active = false;
        this._entertainmentLandingDuration = 0;
        this._entertainmentLandingImpactOffsetX = 0;
        this._entertainmentLandingImpactOffsetZ = 0;
        this._entertainmentLandingComplete = true;
        this._entertainmentLandingSampled = false;
        this._entertainmentLandingSplashPlayed = true;
    }

}
