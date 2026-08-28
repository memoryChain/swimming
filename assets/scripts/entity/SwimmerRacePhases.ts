import { Node, Quat, Vec3 } from 'cc';
import { CHARACTER_POSE_TUNING, SWIMMER_ACTION_TUNING } from '../character/CharacterMotionTuning';
import { SWIMMER_BALANCE, getRaceDistance } from '../core/GameBalance';
import { DOLPHIN_JUMP } from '../core/DolphinJumpConfig';
import { StrokeType } from '../core/GameConstants';
import { SwimmerMotor } from '../swimmer/SwimmerMotor';
import { COURSE_DISTANCE_EPSILON, RaceCourseLayout } from '../venue/RaceCourseLayout';
import { CartoonSwimmerRig } from './CartoonSwimmerRig';

export type UnderwaterPhaseKind = 'none' | 'dive' | 'flipTurn' | 'dolphin';

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

    // --- Dolphin jump (海豚跃) -------------------------------------------------
    // A scripted dip -> airborne arc -> landing dive. While airborne the position
    // comes from the parabola below (not the motor), so it ignores drag/collision
    // and "flies far". Mid-air stroke input drives an axial roll and plays the
    // in-water stroke animation without changing the scripted speed.
    private _dolphinActive = false;
    // 0 = pre-launch dip, 1 = airborne arc.
    private _dolphinStage: 0 | 1 = 0;
    private _dolphinElapsed = 0;
    private _dolphinDirection = 1;
    private _dolphinBaseDistance = 0;
    // Steering heading (radians) captured at launch, so the whole arc flies in the
    // swimmer's actual travel direction (lane axis + heading), not straight down
    // the lane. The along-course and lateral (Z) components below come from it.
    private _dolphinHeading = 0;
    private _dolphinHeadingTurnRate = 0;
    // Lateral (Z) offset from the lane centre at the start of the current stage.
    private _dolphinBaseLateral = 0;
    private _dolphinEntrySpeed = 0;
    // Surface imbalance captured at activation and settled onto its current prone
    // or supine base through the take-off dip. Airborne corkscrew layers on top.
    private _dolphinEntryAxialRoll = 0;
    private _dolphinBaseAxialRoll = 0;
    private _dolphinHorizontalSpeed = 0;
    private _dolphinVerticalSpeed = 0;
    private _dolphinFlightSeconds = 0;
    // Landing-glide exit speed chosen for THIS jump. Follows the arc's forward speed
    // (the air horizontal speed) so the swimmer enters the water carrying its full
    // momentum and simply decelerates via drag — never a dead stop.
    private _dolphinLandingExitSpeed = 0;
    // Per-jump scale (0..1) on the underwater landing dip's durations + depth. 1 far
    // from a wall; shrinks toward 0 near a wall so the dip becomes a quick shallow bob
    // that fits the room while keeping the landing SPEED (see tryStartDolphinJump).
    private _dolphinLandingDurationScale = 1;
    // Accumulated axial-roll target and the eased current angle (radians). Left
    // strokes add +full turns, right strokes subtract them; the angle eases toward
    // the target so rapid input reads as a faster corkscrew.
    private _dolphinRollAngle = 0;
    private _dolphinRollTarget = 0;
    // Leftover roll carried into the landing dive, unwound to 0 so the swimmer
    // resurfaces on the normal swim axis.
    private _dolphinRollResidual = 0;
    private _dolphinRollResidualDecayPerSecond = 0;
    private _dolphinAirStroking = false;
    // Current airborne flight pitch (radians, + = ascending) = the parabola slope.
    // Read by the follow camera and speed lines so both tilt with the arc.
    private _dolphinFlightPitch = 0;
    private readonly _dolphinRotation = new Quat();

    constructor(private readonly _host: SwimmerRacePhaseHost) {}

    get isFlipTurnActive(): boolean {
        return this._flipTurnActive;
    }

    // True for the whole dolphin jump (dip + air). Gates collision and input.
    get isDolphinJumpActive(): boolean {
        return this._dolphinActive;
    }

    // True only while airborne, when mid-air stroke input is accepted (roll +
    // stroke animation, no speed change).
    get isDolphinAirActive(): boolean {
        return this._dolphinActive && this._dolphinStage === 1;
    }

    // True through the whole dolphin jump and its landing dive so the camera holds
    // the follow-behind view from launch until the swimmer rises.
    get isDolphinCameraActive(): boolean {
        return this._dolphinActive || this._underwaterPhaseKind === 'dolphin';
    }

    // Leftover roll (radians) applied on top of the course orientation during the
    // landing dive, decaying to 0 so the body returns to the normal swim axis.
    dolphinRollResidualRadians(): number {
        return this._dolphinRollResidual;
    }

    // Travel heading (radians off the lane axis) the dolphin jump is flying along.
    // The motor heading is zeroed during the scripted phase, so the follow camera
    // reads this instead to sit behind the swimmer's actual flight direction.
    dolphinTravelHeadingRadians(): number {
        return this._dolphinHeading;
    }

    // Airborne flight pitch (radians, + = ascending) — the parabola slope. The
    // camera and speed lines tilt with this so they follow the arc up and down.
    dolphinFlightPitchRadians(): number {
        return this._dolphinFlightPitch;
    }

    get isDiveGlidePoseActive(): boolean {
        return this._diveGlidePoseActive;
    }

    get isUnderwater(): boolean {
        return this._diveUnderwaterActive;
    }

    // True during the underwater swimming phases where friction bubbles read well:
    // the dive-start glide, the WHOLE flip turn (somersault + wall push-off
    // _flipTurnActive AND the glide after it), and the dolphin jump's landing
    // glide once it is back UNDERWATER (kind === 'dolphin'). Still excludes the
    // airborne part of the dolphin jump (_dolphinActive: dip + flight), where
    // there is no water to churn.
    get isSwimUnderwaterActive(): boolean {
        return (this._flipTurnActive || this._diveUnderwaterActive)
            && !this._dolphinActive;
    }

    // Normalized progress through the current underwater rise. Descent and hold
    // report 0; a completed/non-underwater phase reports 1. Camera presentation
    // can use this without ending the gameplay/input glide phase early.
    get underwaterRiseProgress(): number {
        if (!this._diveUnderwaterActive) {
            return 1;
        }
        const riseElapsed = this._diveUnderwaterElapsed
            - this.underwaterDescentSeconds()
            - this.underwaterHoldSeconds();
        if (riseElapsed <= 0) {
            return 0;
        }
        return Math.max(0, Math.min(1, riseElapsed / this.underwaterRiseSeconds()));
    }

    // Descent and the underwater hold remain kick-only. Arm strokes become
    // available on the first real ascent frame, while glide physics and the
    // underwater state continue until the swimmer actually reaches the surface.
    get canUseArmStroke(): boolean {
        return !this._diveGlidePoseActive || this.underwaterRiseProgress > 0;
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
        if (this._dolphinActive) {
            this.updateDolphinJumpPhase(dt);
            return true;
        }
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
        this._dolphinRollResidual = 0;
        this._host.motor.setGlidePhase(false);
        this._host.cartoonRig?.setLegSplashSuppressed(false);
    }

    clearFlipTurnPhase(resetCompletedWalls = false) {
        this._flipTurnActive = false;
        this._flipTurnEntrySpeed = 0;
        this._flipTurnPushSpeed = 0;
        this._dolphinActive = false;
        this._dolphinEntryAxialRoll = 0;
        this._dolphinBaseAxialRoll = 0;
        this._dolphinRollAngle = 0;
        this._dolphinRollTarget = 0;
        this._dolphinAirStroking = false;
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
        // Unwind any leftover dolphin-jump roll so the body returns to the normal
        // swim axis before it resurfaces.
        if (this._underwaterPhaseKind === 'dolphin' && this._dolphinRollResidual !== 0) {
            const step = this._dolphinRollResidualDecayPerSecond * Math.max(0, dt);
            if (Math.abs(this._dolphinRollResidual) <= step) {
                this._dolphinRollResidual = 0;
            } else {
                this._dolphinRollResidual -= Math.sign(this._dolphinRollResidual) * step;
            }
        }
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

        const incomingDirection = courseLayout.finishDirectionAtDistance(wallDistance);
        // Normalize the complete root BEFORE the rig samples its waist/feet. The
        // authored contact offset and vertical pivot are measured in a prone frame;
        // sampling them under a 180-degree parent roll produces the wrong height.
        motor.restoreAxialBalance(0);
        this._host.node.setRotationFromEuler(0, incomingDirection > 0 ? 0 : 180, 0);
        const footContactOffset = rig.startRaceFlipTurn();
        if (footContactOffset === null || !Number.isFinite(footContactOffset) || footContactOffset < 0) {
            rig.finishRaceFlipTurn();
            return false;
        }
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
        // Wall-turn assets are authored only for prone entry. Resetting here also
        // makes the very first scripted frame use the correct waist/foot height.
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
        // Keep the current lateral drift so the swimmer does not snap back to the
        // lane centre when the turn begins/ends (heading itself is reset to 0).
        const z = this._host.startPosition.z + motor.lateralOffset;
        node.setPosition(x, courseLayout.swimY, z);
        this.applyDolphinRotation(
            this._flipTurnIncomingDirection > 0 ? 0 : 180,
            0,
            0,
        );
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
        node.setPosition(courseLayout.distanceToWorldX(handoffDistance), underwaterY, z);
        this.applyDolphinRotation(
            outgoingDirection > 0 ? 0 : 180,
            0,
            0,
        );
        rig?.finishRaceFlipTurn();
        motor.completeFlipTurnPhase(handoffDistance, this._flipTurnPushSpeed);
        motor.restoreAxialBalance(0);
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
            true,
        );
        this._host.cartoonRig?.setLegSplashSuppressed(true);
    }

    // Try to begin a dolphin jump this frame. Rejected when already in another
    // scripted phase or when too little course distance remains before the next
    // turn wall or the finish. Returns true when the jump started.
    tryStartDolphinJump(): boolean {
        if (this._dolphinActive || this._flipTurnActive || this._diveUnderwaterActive) {
            return false;
        }
        const rig = this._host.cartoonRig;
        const motor = this._host.motor;
        const courseLayout = this._host.courseLayout;
        if (!rig || !motor.isRacing) {
            return false;
        }
        const distance = motor.distance;
        const raceDistance = getRaceDistance();
        const direction = courseLayout.finishDirectionAtDistance(distance);
        // Never let the arc cross a turn wall or overshoot the finish: cap the whole
        // maneuver to land inside the current lap length with a small margin.
        const nextWall = courseLayout.nextInternalTurnDistance(distance, raceDistance);
        let limit = raceDistance;
        if (nextWall !== null) {
            limit = Math.min(limit, nextWall);
        }
        limit = Math.max(0, limit - DOLPHIN_JUMP.endMargin);
        const available = limit - distance;
        if (available < DOLPHIN_JUMP.minAvailableDistance) {
            return false;
        }
        const entrySpeed = finiteNonNegative(motor.currentSpeed);
        // Fly in the swimmer's actual travel direction (lane axis rotated by the
        // current steering heading), not straight down the lane. cosH scales the
        // along-course progress; sinH scales the lateral (Z) drift.
        const heading = motor.heading;
        const cosH = Math.max(0.1, Math.cos(heading));
        const angle = DOLPHIN_JUMP.launchAngleDegrees * Math.PI / 180;
        // Launch speed scales with the character's 爆发力 (burst) + level, reusing
        // the same progression ratio the dive uses. AI keeps the raw base speed.
        const launchSpeed = DOLPHIN_JUMP.launchSpeed * motor.dolphinLaunchSpeedScale;
        const horizontalSpeed = Math.max(0.1, launchSpeed * Math.cos(angle));
        let verticalSpeed = Math.max(0.1, launchSpeed * Math.sin(angle));
        let flightSeconds = Math.max(0.1, (2 * verticalSpeed) / Math.max(0.1, DOLPHIN_JUMP.gravity));
        // Fit dip + air + the underwater landing glide inside the available room.
        // Distances are measured ALONG the course (the cosH component).
        const dipForward = entrySpeed * cosH * DOLPHIN_JUMP.dipSeconds;
        const fullLandingSeconds = DOLPHIN_JUMP.landingDescentSeconds
            + DOLPHIN_JUMP.landingHoldSeconds + DOLPHIN_JUMP.landingRiseSeconds;
        // Land carrying the arc's full forward momentum (never a dead stop): enter the
        // water at the same speed the swimmer was flying, then let water drag bleed it
        // back to cruise. The landing speed simply follows the air speed.
        const landingExit = horizontalSpeed;
        const fullLandingReserve = landingExit * fullLandingSeconds;
        const roomAfterDip = Math.max(0.5, available - dipForward);
        const fullArcForward = horizontalSpeed * cosH * flightSeconds;
        let airForward = fullArcForward;
        let landingDurationScale = 1;
        if (fullArcForward + fullLandingReserve > roomAfterDip) {
            // Not enough room for the full arc + full landing dip. This is a RACE, so
            // shrink BOTH together rather than stopping dead near a wall: flatten the arc
            // AND compress the landing dip (shorter + shallower) while KEEPING the landing
            // SPEED. So the swimmer flies in and glides on at ~full speed instead of
            // dropping to a crawl. Arc distance and landing distance scale by the same
            // ratio, so the whole maneuver still ends ~endMargin before the wall.
            const ratio = roomAfterDip / (fullArcForward + fullLandingReserve);
            airForward = Math.max(0.5, fullArcForward * ratio);
            // Flatten the arc to airForward: lower launch angle -> shorter, lower, less
            // airtime. flightSeconds stays coupled to verticalSpeed by
            // flightSeconds = 2·verticalSpeed / gravity, so the parabola lands at t = flightSeconds.
            flightSeconds = airForward / (horizontalSpeed * cosH);
            verticalSpeed = flightSeconds * DOLPHIN_JUMP.gravity / 2;
            // Compress the landing dip to the room left after the flattened arc, at the
            // preserved landing speed (distance = landingExit · fullLandingSeconds · scale).
            const landingRoom = Math.max(0, roomAfterDip - airForward);
            landingDurationScale = fullLandingReserve > 0
                ? clampScalar(landingRoom / fullLandingReserve, 0, 1)
                : 0;
        }
        this._dolphinLandingExitSpeed = landingExit;
        this._dolphinLandingDurationScale = landingDurationScale;

        this._dolphinActive = true;
        this._dolphinStage = 0;
        this._dolphinElapsed = 0;
        this._dolphinDirection = direction;
        this._dolphinHeading = heading;
        this._dolphinHeadingTurnRate = motor.headingTurnRate;
        this._dolphinBaseDistance = distance;
        this._dolphinBaseLateral = motor.lateralOffset;
        this._dolphinEntrySpeed = entrySpeed;
        this._dolphinEntryAxialRoll = motor.axialRollRadians;
        this._dolphinBaseAxialRoll = motor.axialStableAngleRadians;
        this._dolphinHorizontalSpeed = horizontalSpeed;
        this._dolphinVerticalSpeed = verticalSpeed;
        this._dolphinFlightSeconds = flightSeconds;
        this._dolphinRollAngle = 0;
        this._dolphinRollTarget = 0;
        this._dolphinRollResidual = 0;
        this._dolphinFlightPitch = 0;
        this._dolphinAirStroking = false;
        // Discard any held/queued strokes (heading is preserved above before this
        // wipe so the launch flies in the swimmer's actual travel direction).
        motor.beginFlipTurnPhase();
        rig.setDiveStreamlinePose();
        rig.setLegSplashSuppressed(true);
        rig.setPerfectGlowActive(false);
        rig.triggerSplashBurst(DOLPHIN_JUMP.dipSplashScale);
        return true;
    }

    // Register a mid-air stroke: add one full axial turn to the roll target (left
    // one way, right the other) and switch the pose to the in-water freestyle so
    // the arm-pull animation plays. Ignored outside the airborne stage.
    addDolphinRollImpulse(type: StrokeType) {
        if (!this.isDolphinAirActive) {
            return;
        }
        const turn = (DOLPHIN_JUMP.rollPerStrokeDegrees * Math.PI / 180)
            * (type === StrokeType.RIGHT ? -1 : 1);
        this._dolphinRollTarget += turn;
        if (!this._dolphinAirStroking) {
            this._dolphinAirStroking = true;
            this._host.cartoonRig?.setActiveSwimming(true);
        }
    }

    private updateDolphinJumpPhase(dt: number) {
        const rig = this._host.cartoonRig;
        const motor = this._host.motor;
        const courseLayout = this._host.courseLayout;
        const node = this._host.node;
        const raceDistance = getRaceDistance();
        const swimY = courseLayout.swimY;
        const direction = this._dolphinDirection;
        const heading = this._dolphinHeading;
        const cosH = Math.cos(heading);
        const sinH = Math.sin(heading);
        // Face the actual travel direction (same convention as applyCoursePosition):
        // yaw off the lane axis by the steering heading.
        const yaw = (direction > 0 ? 0 : 180) - direction * (heading * 180 / Math.PI);
        // Keep the lateral drift inside the pool side walls so the arc can't fly out.
        const halfWidth = Math.max(0.3, courseLayout.poolWidth * 0.5 - 0.5);
        this._dolphinElapsed += Math.max(0, dt);

        if (this._dolphinStage === 0) {
            // Dip: a quick porpoise gather below the surface, moving forward at the
            // entry speed in the travel direction. Nose dips then returns to level.
            const t = Math.max(0, Math.min(1, this._dolphinElapsed / Math.max(0.01, DOLPHIN_JUMP.dipSeconds)));
            const distance = Math.min(raceDistance, this._dolphinBaseDistance + this._dolphinEntrySpeed * cosH * this._dolphinElapsed);
            const lateral = this._dolphinBaseLateral + this._dolphinEntrySpeed * sinH * this._dolphinElapsed;
            const worldZ = clampScalar(this._host.startPosition.z + lateral, -halfWidth, halfWidth);
            const y = swimY - DOLPHIN_JUMP.dipDepth * Math.sin(Math.PI * t);
            const pitch = -DOLPHIN_JUMP.dipTiltDegrees * Math.sin(Math.PI * t);
            node.setPosition(courseLayout.distanceToWorldX(distance), y, worldZ);
            const entryRoll = lerpAngle(
                this._dolphinEntryAxialRoll,
                this._dolphinBaseAxialRoll,
                smoothStep(t),
            );
            this.applyDolphinRotation(yaw, pitch, entryRoll);
            motor.setFlipTurnDistance(distance);
            motor.setFlipTurnSpeed(this._dolphinEntrySpeed);
            if (t >= 1) {
                // Leave the water: big exaggerated launch plume, then the airborne arc.
                this._dolphinStage = 1;
                this._dolphinElapsed = 0;
                this._dolphinBaseDistance = distance;
                this._dolphinBaseLateral = worldZ - this._host.startPosition.z;
                rig?.triggerBigSplash(DOLPHIN_JUMP.takeoffSplashScale);
            }
            return;
        }

        // Airborne arc. Position comes from the parabola (no drag), so the arc is
        // exaggerated and ignores collision. Roll eases toward the input target.
        const t = this._dolphinElapsed;
        if (t >= this._dolphinFlightSeconds) {
            this.completeDolphinJump(dt);
            return;
        }
        const distance = Math.min(raceDistance, this._dolphinBaseDistance + this._dolphinHorizontalSpeed * cosH * t);
        const lateral = this._dolphinBaseLateral + this._dolphinHorizontalSpeed * sinH * t;
        const worldZ = clampScalar(this._host.startPosition.z + lateral, -halfWidth, halfWidth);
        const verticalVelocity = this._dolphinVerticalSpeed - DOLPHIN_JUMP.gravity * t;
        const y = swimY + this._dolphinVerticalSpeed * t - 0.5 * DOLPHIN_JUMP.gravity * t * t;
        // Parabola slope (nose up on the climb, down on the fall). Stored so the
        // camera and speed lines tilt along the arc, then reused for the body pitch.
        const arcPitchRad = Math.atan2(verticalVelocity, Math.max(0.1, this._dolphinHorizontalSpeed));
        this._dolphinFlightPitch = arcPitchRad;
        this._dolphinRollAngle += (this._dolphinRollTarget - this._dolphinRollAngle)
            * (1 - Math.exp(-Math.max(0, dt) * DOLPHIN_JUMP.rollEaseRate));
        node.setPosition(courseLayout.distanceToWorldX(distance), y, worldZ);
        this.applyDolphinRotation(
            yaw,
            arcPitchRad * 180 / Math.PI,
            this._dolphinBaseAxialRoll + this._dolphinRollAngle,
        );
        motor.setFlipTurnDistance(distance);
        motor.setFlipTurnSpeed(this._dolphinHorizontalSpeed);
        // Drive the freestyle stroke animation once the player has stroked mid-air.
        // Speed/distance are already scripted above, so this is animation only.
        // Go through the same presentation-phase mapper as normal swimming so its
        // source cursor cannot fall behind the pose displayed in the air.
        if (this._dolphinAirStroking && rig) {
            rig.setLegSplashSuppressed(true);
            motor.advanceVisualAnimation(dt);
            rig.updateFreestyleFromMotor(
                dt,
                motor,
                direction,
                this._dolphinFlightPitch,
                this._dolphinHeading,
                Math.cos(this._dolphinFlightPitch)
                    * Math.cos(this._dolphinBaseAxialRoll + this._dolphinRollAngle),
            );
        }
    }

    private completeDolphinJump(dt: number) {
        const rig = this._host.cartoonRig;
        const motor = this._host.motor;
        const courseLayout = this._host.courseLayout;
        const node = this._host.node;
        const raceDistance = getRaceDistance();
        const cosH = Math.cos(this._dolphinHeading);
        const sinH = Math.sin(this._dolphinHeading);
        const landingDistance = Math.min(
            raceDistance,
            this._dolphinBaseDistance + this._dolphinHorizontalSpeed * cosH * this._dolphinFlightSeconds,
        );
        const halfWidth = Math.max(0.3, courseLayout.poolWidth * 0.5 - 0.5);
        const landingLateral = this._dolphinBaseLateral + this._dolphinHorizontalSpeed * sinH * this._dolphinFlightSeconds;
        const worldZ = clampScalar(this._host.startPosition.z + landingLateral, -halfWidth, halfWidth);
        // Carry the ending lateral drift into the underwater glide so the swimmer
        // does not snap back to the lane centre on re-entry.
        motor.setLateralOffset(worldZ - this._host.startPosition.z);
        // Restore the launch heading so the underwater glide (and the surfacing
        // swim) keep travelling and facing the jump direction instead of snapping
        // back to the lane axis. beginFlipTurnPhase zeroed it at launch.
        motor.correctHeading(this._dolphinHeading, this._dolphinHeadingTurnRate, 1);
        const headingDeg = this._dolphinHeading * 180 / Math.PI;
        const yaw = (this._dolphinDirection > 0 ? 0 : 180) - this._dolphinDirection * headingDeg;
        // Carry over any leftover roll as a residual that unwinds to 0 (shortest
        // way) during the landing dive, so the body returns to the normal axis.
        const residual = normalizeAngle(this._dolphinRollAngle);
        this._dolphinRollResidual = residual;
        this._dolphinRollResidualDecayPerSecond = Math.abs(residual)
            / Math.max(0.01, DOLPHIN_JUMP.landingRollUnwindSeconds);
        node.setPosition(courseLayout.distanceToWorldX(landingDistance), courseLayout.swimY, worldZ);
        this.applyDolphinRotation(yaw, 0, this._dolphinBaseAxialRoll + residual);
        motor.completeFlipTurnPhase(landingDistance, this._dolphinLandingExitSpeed);
        motor.restoreAxialBalance(this._dolphinBaseAxialRoll);
        // Air strokes are presentation-only. If entry happens halfway through a
        // sweep, terminate it at the landing boundary and restore the canonical
        // glide pose instead of retaining that partial angle as the next origin.
        motor.resetScriptedVisualMotion();
        rig?.setDiveStreamlinePose();
        rig?.triggerBigSplash(DOLPHIN_JUMP.landingSplashScale);
        this._dolphinActive = false;
        this._dolphinAirStroking = false;
        this.startDolphinLandingUnderwaterPhase();
        // Render the underwater glide pose this same frame (mirrors the flip turn
        // handoff) so the re-entry does not freeze on the airborne snapshot.
        this._host.updateBodyMotion(dt);
    }

    private applyDolphinRotation(yawDegrees: number, pitchDegrees: number, rollRadians: number) {
        const deg2rad = Math.PI / 180;
        Quat.fromEuler(this._dolphinRotation, 0, yawDegrees, 0);
        if (Math.abs(pitchDegrees) > 1e-4) {
            Quat.rotateZ(this._dolphinRotation, this._dolphinRotation, pitchDegrees * deg2rad);
        }
        if (Math.abs(rollRadians) > 1e-4) {
            Quat.rotateX(this._dolphinRotation, this._dolphinRotation, rollRadians);
        }
        this._host.node.setRotation(this._dolphinRotation);
    }

    private startDolphinLandingUnderwaterPhase() {
        this._underwaterPhaseKind = 'dolphin';
        this._diveUnderwaterActive = true;
        this._diveGlidePoseActive = true;
        this._diveUnderwaterElapsed = 0;
        this._diveEntryLeanDegrees = 0;
        this._host.motor.setGlidePhase(
            true,
            SWIMMER_BALANCE.flipTurnUnderwaterGlideDrag,
            true,
        );
        this._host.cartoonRig?.setLegSplashSuppressed(true);
    }

    private underwaterStartDepth(): number {
        if (this._underwaterPhaseKind === 'flipTurn') {
            return Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth);
        }
        if (this._underwaterPhaseKind === 'dolphin') {
            // Re-enters at the surface, then sinks to the landing depth.
            return 0;
        }
        return Math.max(0, SWIMMER_ACTION_TUNING.diveEntryDepth);
    }

    private underwaterDepth(): number {
        if (this._underwaterPhaseKind === 'flipTurn') {
            return Math.max(
                this.underwaterStartDepth(),
                Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterGlideDepth),
            );
        }
        if (this._underwaterPhaseKind === 'dolphin') {
            return Math.max(0, DOLPHIN_JUMP.landingDepth * this._dolphinLandingDurationScale);
        }
        return Math.max(0, SWIMMER_ACTION_TUNING.diveEntryDepth);
    }

    private underwaterDescentSeconds(): number {
        if (this._underwaterPhaseKind === 'flipTurn') {
            return Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveSeconds);
        }
        if (this._underwaterPhaseKind === 'dolphin') {
            return Math.max(0, DOLPHIN_JUMP.landingDescentSeconds * this._dolphinLandingDurationScale);
        }
        return 0;
    }

    private underwaterHoldSeconds(): number {
        if (this._underwaterPhaseKind === 'flipTurn') {
            return Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterHoldSeconds);
        }
        if (this._underwaterPhaseKind === 'dolphin') {
            return Math.max(0, DOLPHIN_JUMP.landingHoldSeconds * this._dolphinLandingDurationScale);
        }
        return Math.max(0, SWIMMER_ACTION_TUNING.diveUnderwaterHoldSeconds);
    }

    private underwaterRiseSeconds(): number {
        if (this._underwaterPhaseKind === 'flipTurn') {
            return Math.max(0.01, CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseSeconds);
        }
        if (this._underwaterPhaseKind === 'dolphin') {
            return Math.max(0.01, DOLPHIN_JUMP.landingRiseSeconds * this._dolphinLandingDurationScale);
        }
        return Math.max(0.01, SWIMMER_ACTION_TUNING.diveUnderwaterRiseSeconds);
    }

    private underwaterRiseTiltDegrees(): number {
        if (this._underwaterPhaseKind === 'flipTurn') {
            return Math.max(0, CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseTiltDegrees);
        }
        if (this._underwaterPhaseKind === 'dolphin') {
            return Math.max(0, DOLPHIN_JUMP.landingRiseTiltDegrees);
        }
        return Math.max(0, SWIMMER_ACTION_TUNING.diveUnderwaterRiseTiltDegrees);
    }
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
    return normalizeAngle(a + normalizeAngle(b - a) * Math.max(0, Math.min(1, t)));
}

function clampScalar(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

// Wrap an angle to one physical turn. Prone and supine phase handoffs use the
// shortest path while airborne corkscrew residuals still unwind without a jump.
function normalizeAngle(angle: number): number {
    const twoPi = Math.PI * 2;
    let a = angle % twoPi;
    if (a > Math.PI) {
        a -= twoPi;
    } else if (a < -Math.PI) {
        a += twoPi;
    }
    return a;
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
