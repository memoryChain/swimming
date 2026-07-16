import { Node, Vec3 } from 'cc';
import { CHARACTER_POSE_TUNING, SWIMMER_ACTION_TUNING } from '../character/CharacterMotionTuning';
import { SWIMMER_BALANCE, getRaceDistance } from '../core/GameBalance';
import { StrokeType } from '../core/GameConstants';
import { SwimmerMotor } from '../swimmer/SwimmerMotor';
import { COURSE_DISTANCE_EPSILON, RaceCourseLayout } from '../venue/RaceCourseLayout';
import { CartoonSwimmerRig } from './CartoonSwimmerRig';

export type UnderwaterPhaseKind = 'none' | 'dive' | 'flipTurn';

/**
 * The pieces of the owning Swimmer that the race-phase controller needs. Kept
 * as a narrow interface so the phase logic stays decoupled from the component.
 * 关卡阶段控制器需要访问的 Swimmer 部件。用窄接口保持阶段逻辑与组件解耦。
 */
export interface SwimmerRacePhaseHost {
    readonly node: Node;
    readonly motor: SwimmerMotor;
    readonly cartoonRig: CartoonSwimmerRig | null;
    readonly courseLayout: RaceCourseLayout;
    readonly startPosition: Readonly<Vec3>;
    updateBodyMotion(dt: number): void;
}

/**
 * Owns the dive-entry, flip-turn, and underwater glide/rise phases for a single
 * swimmer: their state flags, the wall-turn motion, and the underwater depth and
 * lean curves. The Swimmer component delegates here and reads the phase flags to
 * gate input and camera behaviour.
 *
 * 负责单个运动员的入水、翻滚转身、水下滑行/上浮阶段：状态标记、蹬墙运动、水下深度与
 * 倾角曲线。Swimmer 组件把这些逻辑委托到这里，并读取阶段标记来门控输入与相机行为。
 */
export class SwimmerRacePhases {
    private _diveUnderwaterActive = false;
    private _diveGlidePoseActive = false;
    private _diveUnderwaterElapsed = 0;
    private _diveEntryLeanDegrees = 0;
    private _underwaterPhaseKind: UnderwaterPhaseKind = 'none';
    private _flipTurnActive = false;
    private _flipTurnWallDistance = 0;
    private _flipTurnStartDistance = 0;
    private _flipTurnIncomingDirection = 1;
    // Extra world-X the root reaches past the swim boundary so the tucked feet
    // touch the actual pool wall at keyframe 2. Eased back to 0 during the push.
    private _flipTurnMaxReach = 0;
    private _flipTurnEntrySpeed = 0;
    private _flipTurnPushSpeed = 0;
    private _lastCompletedFlipTurnWallDistance = Number.NEGATIVE_INFINITY;

    constructor(private readonly _host: SwimmerRacePhaseHost) {}

    get isFlipTurnActive(): boolean {
        return this._flipTurnActive;
    }

    get isDiveGlidePoseActive(): boolean {
        return this._diveGlidePoseActive;
    }

    get isUnderwater(): boolean {
        return this._diveUnderwaterActive;
    }

    // True through the whole flip-turn and the following underwater phase so the
    // camera holds its underwater view from wall approach until the swimmer rises.
    get isFlipTurnCameraActive(): boolean {
        return this._flipTurnActive || this._underwaterPhaseKind === 'flipTurn';
    }

    // Set by the dive launch before startRace so the head-down entry lean is
    // preserved into the underwater straighten.
    setDiveEntryLean(degrees: number) {
        this._diveEntryLeanDegrees = degrees;
    }

    // Runs the wall turn if it is active or should start this frame. Returns true
    // when the turn consumed the frame so the caller can skip normal swim update.
    tick(dt: number): boolean {
        if (this._flipTurnActive) {
            this.updateFlipTurnPhase(dt);
            return true;
        }
        if (this.tryStartFlipTurnPhase(dt)) {
            this.updateFlipTurnPhase(dt);
            return true;
        }
        return false;
    }

    startDiveUnderwaterPhase() {
        this._underwaterPhaseKind = 'dive';
        this._diveUnderwaterActive = true;
        this._diveGlidePoseActive = true;
        this._diveUnderwaterElapsed = 0;
        this._host.motor.setGlidePhase(true);
        this._host.cartoonRig?.setLegSplashSuppressed(true);
    }

    clearDiveUnderwaterPhase() {
        this._diveUnderwaterActive = false;
        this._diveGlidePoseActive = false;
        this._diveUnderwaterElapsed = 0;
        this._diveEntryLeanDegrees = 0;
        this._underwaterPhaseKind = 'none';
        this._host.motor.setGlidePhase(false);
        this._host.cartoonRig?.setLegSplashSuppressed(false);
    }

    clearFlipTurnPhase(resetCompletedWalls = false) {
        this._flipTurnActive = false;
        this._flipTurnEntrySpeed = 0;
        this._flipTurnPushSpeed = 0;
        this._host.motor.setGlidePhase(false);
        if (resetCompletedWalls) {
            this._lastCompletedFlipTurnWallDistance = Number.NEGATIVE_INFINITY;
        }
        this._host.cartoonRig?.finishRaceFlipTurn();
    }

    updateDiveUnderwaterTimer(dt: number) {
        if (!this._diveUnderwaterActive) {
            return;
        }
        this._diveUnderwaterElapsed += Math.max(0, dt);
    }

    // Underwater depth offset from the surface for the current phase and elapsed
    // time. Returns the swim-surface Y when not underwater. Ends the phase and
    // resumes surface swimming once the rise completes.
    visualSwimY(): number {
        const startY = this._host.startPosition.y;
        if (!this._diveUnderwaterActive) {
            return startY;
        }
        const swimY = this._host.courseLayout.swimY;
        const descentSeconds = this.underwaterDescentSeconds();
        const startUnderwaterY = swimY - this.underwaterStartDepth();
        const underwaterY = swimY - this.underwaterDepth();
        const elapsed = this._diveUnderwaterElapsed;
        if (descentSeconds > 0 && elapsed < descentSeconds) {
            return lerp(startUnderwaterY, underwaterY, smoothStep(elapsed / descentSeconds));
        }
        const phaseElapsed = Math.max(0, elapsed - descentSeconds);
        const holdSeconds = this.underwaterHoldSeconds();
        if (phaseElapsed <= holdSeconds) {
            return underwaterY;
        }
        const riseSeconds = this.underwaterRiseSeconds();
        const ratio = (phaseElapsed - holdSeconds) / riseSeconds;
        if (ratio >= 1) {
            this.clearDiveUnderwaterPhase();
            this.beginSurfaceSwimming();
            return startY;
        }
        return lerp(underwaterY, startY, smoothStep(ratio));
    }

    diveRecoveryLean(): number {
        if (!this._diveUnderwaterActive) {
            return 0;
        }
        const descentSeconds = this.underwaterDescentSeconds();
        const elapsed = this._diveUnderwaterElapsed;
        if (descentSeconds > 0 && elapsed < descentSeconds) {
            const descentRatio = Math.max(0, Math.min(1, elapsed / descentSeconds));
            return -Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveTiltDegrees)
                * Math.sin(Math.PI * descentRatio);
        }
        const phaseElapsed = Math.max(0, elapsed - descentSeconds);
        const holdSeconds = this.underwaterHoldSeconds();
        const riseSeconds = this.underwaterRiseSeconds();
        if (phaseElapsed <= holdSeconds) {
            if (this._underwaterPhaseKind === 'flipTurn') {
                return 0;
            }
            // Straighten from the head-down entry lean to horizontal early in the hold,
            // so the body does not linger in the diagonal-down pose.
            const straightenSeconds = Math.max(0.01, holdSeconds * SWIMMER_ACTION_TUNING.diveStraightenRatio);
            const ratio = Math.max(0, Math.min(1, elapsed / straightenSeconds));
            return lerp(this._diveEntryLeanDegrees, 0, smoothStep(ratio));
        }
        // Ascent: tilt head-up toward the surface, then level out as it breaks the surface.
        const riseRatio = Math.max(0, Math.min(1, (phaseElapsed - holdSeconds) / riseSeconds));
        return this.underwaterRiseTiltDegrees() * Math.sin(Math.PI * riseRatio);
    }

    private beginSurfaceSwimming() {
        this._diveGlidePoseActive = false;
        this._host.motor.setGlidePhase(false);
        this._host.cartoonRig?.setLegSplashSuppressed(false);
        if (this._host.motor.isRacing) {
            this._host.cartoonRig?.setActiveSwimming(true);
        }
    }

    private tryStartFlipTurnPhase(dt: number): boolean {
        const rig = this._host.cartoonRig;
        const courseLayout = this._host.courseLayout;
        const motor = this._host.motor;
        if (!rig || this._diveUnderwaterActive) {
            return false;
        }
        const distance = motor.distance;
        const raceDistance = getRaceDistance();
        const wallDistance = courseLayout.nextInternalTurnDistance(distance, raceDistance);
        // The final wall is intentionally excluded: the swimmer touches it and
        // transitions to the finish floating/treading pose instead of turning.
        if (wallDistance === null
            || wallDistance <= this._lastCompletedFlipTurnWallDistance + COURSE_DISTANCE_EPSILON) {
            return false;
        }
        const remaining = wallDistance - distance;
        const keyframe2Seconds = Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnToKeyframe1Seconds)
            + Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnToKeyframe2Seconds);
        const entrySpeed = finiteNonNegative(motor.currentSpeed);
        // The approach distance is exactly the integral of the decelerating lane
        // speed, so the wall push starts with zero velocity discontinuity and the
        // lane speed reaches 0 precisely when the feet plant. The reach offset
        // (below) covers the beyond-boundary distance to the wall instead of
        // padding the approach, so no fixed extra distance is added here. Clamp
        // the effective exponent to [1, 2] so the cubic Hermite approach curve
        // stays monotonic (no backward drift near the wall).
        const decelerationExponent = Math.min(2, Math.max(1, finitePower(SWIMMER_BALANCE.flipTurnDecelerationExponent)));
        const integratedDecelerationDistance = entrySpeed * keyframe2Seconds
            / (decelerationExponent + 1);
        // Never let extreme tuning make the next turn start on the previous wall.
        const approachDistance = Math.min(
            Math.max(0.1, integratedDecelerationDistance),
            Math.max(0.1, courseLayout.courseLength - COURSE_DISTANCE_EPSILON),
        );
        // Include this frame's possible travel so a low frame rate or a temporary
        // speed spike cannot step across an internal wall before the next check.
        const projectedFrameTravel = entrySpeed * finiteNonNegative(dt);
        if (remaining > approachDistance
            && remaining > projectedFrameTravel + COURSE_DISTANCE_EPSILON) {
            return false;
        }

        const footContactOffset = rig.startRaceFlipTurn();
        if (footContactOffset === null || !Number.isFinite(footContactOffset) || footContactOffset < 0) {
            rig.finishRaceFlipTurn();
            return false;
        }
        const incomingDirection = courseLayout.finishDirectionAtDistance(wallDistance);
        const wallX = courseLayout.wallWorldXAtDistance(wallDistance);
        const contactX = wallX - incomingDirection * footContactOffset;
        const exitX = courseLayout.distanceToWorldX(wallDistance);
        this._flipTurnActive = true;
        this._flipTurnWallDistance = wallDistance;
        this._flipTurnStartDistance = distance;
        this._flipTurnIncomingDirection = incomingDirection;
        this._flipTurnMaxReach = incomingDirection * (contactX - exitX);
        this._flipTurnEntrySpeed = entrySpeed;
        this._flipTurnPushSpeed = finiteNonNegative(SWIMMER_BALANCE.flipTurnPushLaunchSpeed);
        motor.beginFlipTurnPhase();
        rig.setStrokeHeld(StrokeType.LEFT, false);
        rig.setStrokeHeld(StrokeType.RIGHT, false);
        rig.setPerfectGlowActive(false);
        return true;
    }

    private updateFlipTurnPhase(dt: number) {
        const rig = this._host.cartoonRig;
        const courseLayout = this._host.courseLayout;
        const motor = this._host.motor;
        const node = this._host.node;
        const state = rig?.updateRaceFlipTurn(dt);
        if (!state) {
            this.clearFlipTurnPhase();
            return;
        }
        const keyframe2Seconds = Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnToKeyframe1Seconds)
            + Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnToKeyframe2Seconds);
        const returnSeconds = Math.max(0.001, CHARACTER_POSE_TUNING.flipTurnReturnToSwimSeconds);
        // The wall push accelerates 0 -> pushSpeed and travels the integral of that
        // curve, so the launch flows seamlessly into the post-turn underwater glide
        // with no stall-then-rocket. Clamp the exponent to [1, 2] so the cubic
        // Hermite push curve stays monotonic (no backward drift off the wall).
        const accelerationExponent = Math.min(2, Math.max(1, finitePower(SWIMMER_BALANCE.flipTurnAccelerationExponent)));
        const pushDistance = this._flipTurnPushSpeed * returnSeconds / (accelerationExponent + 1);

        let distance: number;
        let laneSpeed: number;
        let reachRatio: number;
        if (!state.keyframe2Reached) {
            // Approach: decelerate from the real entry speed to exactly 0 at the
            // wall. Cubic Hermite keeps velocity continuous at the turn onset and
            // guarantees zero lane speed the instant the feet plant.
            const tau = Math.max(0, Math.min(1, state.approachTimeRatio));
            const span = this._flipTurnWallDistance - this._flipTurnStartDistance;
            const motion = cubicHermitePosition(this._flipTurnEntrySpeed, 0, span, keyframe2Seconds, tau);
            distance = this._flipTurnStartDistance + Math.min(span, motion.position);
            laneSpeed = motion.speed;
            // Reach eases in with zero initial slope so the world-X velocity at the
            // turn onset stays exactly the incoming lane speed (no lurch).
            reachRatio = smoothStep(tau);
        } else {
            // Wall push: accelerate from 0 to the launch burst, advancing into the
            // new lap while the reach offset eases back to the swim line.
            const tau = Math.max(0, Math.min(1, state.returnTimeRatio));
            const motion = cubicHermitePosition(0, this._flipTurnPushSpeed, pushDistance, returnSeconds, tau);
            distance = this._flipTurnWallDistance + motion.position;
            laneSpeed = motion.speed;
            reachRatio = 1 - smoothStep(tau);
        }
        const baseX = courseLayout.distanceToWorldX(distance);
        const x = baseX + this._flipTurnIncomingDirection * this._flipTurnMaxReach * reachRatio;
        node.setPosition(x, courseLayout.swimY, this._host.startPosition.z);
        node.setRotationFromEuler(0, this._flipTurnIncomingDirection > 0 ? 0 : 180, 0);
        motor.setFlipTurnDistance(distance);
        motor.setFlipTurnSpeed(laneSpeed);
        if (!state.complete) {
            return;
        }

        // Hand off to the underwater dive at the launch speed and depth, so the
        // wall push continues like a race-start entry: descend to the glide point
        // then rise back to the surface. The camera stays underwater throughout
        // because the flip-turn underwater phase keeps isFlipTurnCameraActive true.
        const outgoingDirection = -this._flipTurnIncomingDirection;
        const handoffDistance = this._flipTurnWallDistance + pushDistance;
        const underwaterY = courseLayout.swimY
            - Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth);
        node.setPosition(courseLayout.distanceToWorldX(handoffDistance), underwaterY, this._host.startPosition.z);
        node.setRotationFromEuler(0, outgoingDirection > 0 ? 0 : 180, 0);
        rig?.finishRaceFlipTurn();
        motor.completeFlipTurnPhase(handoffDistance, this._flipTurnPushSpeed);
        this._lastCompletedFlipTurnWallDistance = this._flipTurnWallDistance;
        this._flipTurnActive = false;
        this.startFlipTurnUnderwaterPhase();
        // Drive the underwater glide pose on this same frame. Without it the rig
        // would render one frame frozen on the static exit-swim snapshot before
        // the normal update path takes over next frame, which reads as a hitch
        // right as the push-off recovers into the underwater glide.
        this._host.updateBodyMotion(dt);
    }

    private startFlipTurnUnderwaterPhase() {
        this._underwaterPhaseKind = 'flipTurn';
        this._diveUnderwaterActive = true;
        this._diveGlidePoseActive = true;
        this._diveUnderwaterElapsed = 0;
        this._diveEntryLeanDegrees = 0;
        this._host.motor.setGlidePhase(
            true,
            SWIMMER_BALANCE.flipTurnUnderwaterGlideDrag,
        );
        this._host.cartoonRig?.setLegSplashSuppressed(true);
    }

    private underwaterStartDepth(): number {
        return this._underwaterPhaseKind === 'flipTurn'
            ? Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth)
            : Math.max(0, SWIMMER_ACTION_TUNING.diveEntryDepth);
    }

    private underwaterDepth(): number {
        return this._underwaterPhaseKind === 'flipTurn'
            ? Math.max(
                this.underwaterStartDepth(),
                Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterGlideDepth),
            )
            : Math.max(0, SWIMMER_ACTION_TUNING.diveEntryDepth);
    }

    private underwaterDescentSeconds(): number {
        return this._underwaterPhaseKind === 'flipTurn'
            ? Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveSeconds)
            : 0;
    }

    private underwaterHoldSeconds(): number {
        return this._underwaterPhaseKind === 'flipTurn'
            ? Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterHoldSeconds)
            : Math.max(0, SWIMMER_ACTION_TUNING.diveUnderwaterHoldSeconds);
    }

    private underwaterRiseSeconds(): number {
        return this._underwaterPhaseKind === 'flipTurn'
            ? Math.max(0.01, CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseSeconds)
            : Math.max(0.01, SWIMMER_ACTION_TUNING.diveUnderwaterRiseSeconds);
    }

    private underwaterRiseTiltDegrees(): number {
        return this._underwaterPhaseKind === 'flipTurn'
            ? Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseTiltDegrees)
            : Math.max(0, SWIMMER_ACTION_TUNING.diveUnderwaterRiseTiltDegrees);
    }
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function finiteNonNegative(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finitePower(value: number): number {
    return Number.isFinite(value) ? Math.max(1, value) : 1;
}

function smoothStep(value: number): number {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
}

function cubicHermitePosition(
    startSpeed: number,
    endSpeed: number,
    distance: number,
    seconds: number,
    tau: number,
): { position: number; speed: number } {
    const duration = Math.max(0.001, seconds);
    const t = Math.max(0, Math.min(1, tau));
    // Cubic s(t) with s(0)=0, s(1)=distance, s'(0)=startSpeed, s'(1)=endSpeed.
    // Endpoint speeds are per second, converted into the normalized t domain via
    // the segment duration. This guarantees the lane velocity is continuous at
    // both ends (entry speed into the turn, launch speed out of it).
    const v0 = startSpeed * duration;
    const v1 = endSpeed * duration;
    const c1 = v0;
    const c2 = 3 * distance - 2 * v0 - v1;
    const c3 = v0 + v1 - 2 * distance;
    const position = c1 * t + c2 * t * t + c3 * t * t * t;
    const speed = (c1 + 2 * c2 * t + 3 * c3 * t * t) / duration;
    return { position, speed: Math.max(0, speed) };
}
