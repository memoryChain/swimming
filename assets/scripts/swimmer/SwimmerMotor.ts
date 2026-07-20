import { getRaceDistance, SWIMMER_BALANCE } from '../core/GameBalance';
import { Rating, StrokeType } from '../core/GameConstants';
import { getRaceArmCycleSpeedScale, MOTION_TUNING, STROKE_QUALITY_TUNING } from '../core/InputTuning';
import { MAX_STEERING_HEADING_DEGREES, STEERING_TUNING } from '../core/SteeringTuning';
import { SwimPhysicsModel } from './SwimPhysicsModel';

const CYCLE_AMOUNT = Math.PI * 2;
const MAX_QUEUED_MOTION = CYCLE_AMOUNT * 2;
const DEG2RAD = Math.PI / 180;

export type StrokeQualityResult = {
    type: StrokeType;
    strokeQuality: number;
    badReason?: string;
    holdSeconds: number;
    actionSeconds: number;
    minHoldSeconds: number;
    holdTimeValid: boolean;
    holdRatio: number;
    inputFreshness: number;
    inputLeadSeconds: number;
    inputLeadRatio: number;
    meanRatio: number;
    ratioStdDev: number;
    sampleCount: number;
    // Redesign: set when a released press was too short to be a real arm stroke
    // and was reinterpreted as a leg-kick tap. The flow layer suppresses the
    // miss feedback and plays a kick instead of scoring this as a bad stroke.
    downgradedToKick?: boolean;
};

type StrokeAction = {
    queuedAt: number;
    startedAt: number;
    pressedAt: number;
    releasedAt: number;
    progress: number;
    baseAccelerationStarted: boolean;
    strokeQualitySettled: boolean;
    alternationQuality: number;
    inputFreshness: number;
    inputLeadSeconds: number;
    inputLeadRatio: number;
    // Last simulation time at which this exact action contributed to a visible
    // whole-body yellow guide. -1 means the player was never shown PERFECT for it.
    perfectGuidePresentedAt: number;
};

type QueueSideStrokeResult = {
    queued: boolean;
    startedImmediately: boolean;
};

export type SwimmerMotorOptions = {
    isAI: boolean;
};

export type StrokeTimingGuideInterval = {
    rating: Rating;
    startRatio: number;
    endRatio: number;
};

export type StrokeTimingGuide = {
    active: boolean;
    currentRatio: number;
    holdSeconds: number;
    actionSeconds: number;
    minHoldRatio: number;
    intervals: StrokeTimingGuideInterval[];
};

export class SwimmerMotor {
    private readonly _physics = new SwimPhysicsModel();
    private _currentSpeed = 0;
    private _distance = 0;
    private _isRacing = false;
    private _bodyPhase = 0;
    private _leftArmCycle = 0;
    private _rightArmCycle = 0;
    private _leftKickCycle = 0;
    private _rightKickCycle = 0;
    private _leftArmMotionRemaining = 0;
    private _rightArmMotionRemaining = 0;
    private _leftKickMotionRemaining = 0;
    private _rightKickMotionRemaining = 0;
    private _armAction = 0;
    private _kickAction = 0;
    private _leftStrokeHeld = false;
    private _rightStrokeHeld = false;
    private _motionClock = 0;
    private _leftPressStartedAt = -1;
    private _rightPressStartedAt = -1;
    private readonly _leftActions: StrokeAction[] = [];
    private readonly _rightActions: StrokeAction[] = [];
    private readonly _pendingStrokeQualityResults: StrokeQualityResult[] = [];
    private _strokeAcceleration = 0;
    private _strokeAccelerationSeconds = 0;
    private _strokeAccelerationTotalSeconds = 0;
    private _speedCapBonus = 0;
    private _conditionSpeedScale = 1;
    private _conditionQualityScale = 1;
    private _lastStrokeQuality = 0;
    private _currentAcceleration = 0;
    // Underwater-glide flag: while true (post-dive, before surfacing) the physics
    // step applies SWIMMER_BALANCE.glideDrag so an un-kicked glide bleeds off fast.
    private _glidePhaseActive = false;
    private _glideDrag = SWIMMER_BALANCE.glideDrag;
    // Kick propulsion is driven by the CURRENT tap frequency, not per-tap pulses.
    // _kickCadenceHz is estimated from the interval between taps (and decays when
    // tapping stops); each frame it produces a continuous acceleration that fades
    // into the kickMaxSpeed ceiling. So fast tapping accelerates fast, slow
    // tapping accelerates slowly, and legs alone can't exceed the kick ceiling.
    private _kickCadenceHz = 0;
    private _lastKickTapClock = -1;
    // Steering (蛇形转向): heading is the yaw offset from straight-ahead, in
    // radians. A stroke nudges it left/right; forward progress is speed*cos and
    // the lateral offset accumulates speed*sin. Player AND AI use the same
    // stroke-driven steering (AI just controls which side it strokes). See
    // core/SteeringTuning.ts.
    private _heading = 0;
    private _headingTarget = 0;
    private _courseDirection = 1;
    private _lateralOffset = 0;
    private _lateralOffsetMin = -1000;
    private _lateralOffsetMax = 1000;
    private _steeringEnabled = false;
    // Kick pulse budget (radians left to sweep) per leg, driven by discrete taps.
    // Reuses the *KickMotionRemaining fields below. A tap on the contralateral
    // input tops these up; the leg sweeps through them at a fixed fast cadence.

    startRace(initialDistance = 0, initialSpeed = SWIMMER_BALANCE.baseSpeed, initialSpeedCapBonus = 0) {
        this._isRacing = true;
        this._currentSpeed = initialSpeed;
        this.resetRaceState(initialDistance);
        this._speedCapBonus = Math.max(0, initialSpeedCapBonus);
    }

    stopRace() {
        this._isRacing = false;
        this._glidePhaseActive = false;
        this._glideDrag = SWIMMER_BALANCE.glideDrag;
    }

    // Toggled by the Swimmer for post-dive and post-turn underwater glides.
    setGlidePhase(
        active: boolean,
        glideDrag = SWIMMER_BALANCE.glideDrag,
    ) {
        this._glidePhaseActive = active;
        this._glideDrag = active ? Math.max(0, glideDrag) : SWIMMER_BALANCE.glideDrag;
    }

    beginFlipTurnPhase() {
        // The flip turn is an input-locked movement phase. Discard any held or
        // queued stroke so it cannot resume halfway through the wall push.
        this._leftStrokeHeld = false;
        this._rightStrokeHeld = false;
        this._leftPressStartedAt = -1;
        this._rightPressStartedAt = -1;
        this._leftActions.length = 0;
        this._rightActions.length = 0;
        // Do not let visual motion queued before the wall survive until the
        // post-turn underwater update. It would overwrite the completed return
        // pose on its first frame and make the transition appear truncated.
        this._leftArmMotionRemaining = 0;
        this._rightArmMotionRemaining = 0;
        this._leftKickMotionRemaining = 0;
        this._rightKickMotionRemaining = 0;
        this._leftArmCycle = 0;
        this._rightArmCycle = 0;
        this._leftKickCycle = 0;
        this._rightKickCycle = Math.PI;
        this._bodyPhase = 0;
        this._armAction = 0;
        this._kickAction = 0;
        this._strokeAcceleration = 0;
        this._strokeAccelerationSeconds = 0;
        this._strokeAccelerationTotalSeconds = 0;
        this._kickCadenceHz = 0;
        this._lastKickTapClock = -1;
        this._currentAcceleration = 0;
        // Push off the wall straight ahead; the player steers again after the turn.
        this._heading = 0;
        this._headingTarget = 0;
    }

    setFlipTurnSpeed(speed: number) {
        this._currentSpeed = Math.max(0, speed);
        this._currentAcceleration = 0;
        this._speedCapBonus = Math.max(0, this._currentSpeed - SWIMMER_BALANCE.maxSpeed);
    }

    setFlipTurnDistance(distance: number) {
        this._distance = Math.max(0, Math.min(getRaceDistance(), distance));
    }

    completeFlipTurnPhase(distance: number, speed: number) {
        this.setFlipTurnDistance(distance);
        this.setFlipTurnSpeed(speed);
    }

    reset() {
        this._currentSpeed = 0;
        this._isRacing = false;
        this._glidePhaseActive = false;
        this._glideDrag = SWIMMER_BALANCE.glideDrag;
        this.resetRaceState();
    }

    recordStroke(type: StrokeType): boolean {
        let queued = false;
        if (type === StrokeType.LEFT) {
            const left = this.queueSideStroke(StrokeType.LEFT);
            queued = left.queued || queued;
        } else if (type === StrokeType.RIGHT) {
            const right = this.queueSideStroke(StrokeType.RIGHT);
            queued = right.queued || queued;
        } else {
            const left = this.queueSideStroke(StrokeType.LEFT);
            const right = this.queueSideStroke(StrokeType.RIGHT);
            queued = left.queued || right.queued || queued;
        }
        if (!queued) {
            return false;
        }
        this._armAction = 1;
        this._kickAction = 1;
        return true;
    }

    canRecordStroke(type: StrokeType): boolean {
        if (type === StrokeType.LEFT) {
            return this.canQueueSideStroke(StrokeType.LEFT);
        }
        if (type === StrokeType.RIGHT) {
            return this.canQueueSideStroke(StrokeType.RIGHT);
        }
        return this.canQueueSideStroke(StrokeType.LEFT) || this.canQueueSideStroke(StrokeType.RIGHT);
    }

    // The active (front-of-queue) arm StrokeAction's release progress for a side,
    // as a fraction of a full cycle (0..1), or -1 when no stroke is active/started.
    // The simulated-input AI watches this to decide when to release, exactly the
    // way a player watches the on-screen pull to time a release.
    activeStrokeReleaseProgress(type: StrokeType): number {
        const action = type === StrokeType.LEFT ? this._leftActions[0] : this._rightActions[0];
        if (!action || action.startedAt < 0) {
            return -1;
        }
        return clamp01(action.progress / CYCLE_AMOUNT);
    }

    // True only while this hand is still held and its pull progress is currently
    // inside the shared PERFECT release window. Keeping this per-hand lets visual
    // feedback combine both hands without one hand turning it off for the other.
    isActiveStrokeInPerfectZone(type: StrokeType): boolean {
        const action = type === StrokeType.LEFT ? this._leftActions[0] : this._rightActions[0];
        if (!action || action.startedAt < 0 || action.releasedAt >= 0 || action.strokeQualitySettled) {
            return false;
        }
        const progress = clamp01(action.progress / CYCLE_AMOUNT);
        const perfect = normalizedReleaseRange(STROKE_QUALITY_TUNING.perfectStart, STROKE_QUALITY_TUNING.perfectEnd);
        return progress >= perfect.start && progress <= perfect.end;
    }

    isActiveStrokeHeld(type: StrokeType): boolean {
        const action = type === StrokeType.LEFT ? this._leftActions[0] : this._rightActions[0];
        return !!action && action.startedAt >= 0 && action.releasedAt < 0 && !action.strokeQualitySettled;
    }

    // Called only after the player model has actually been told to show yellow.
    // Recording presentation separately from the zone query prevents an unseen
    // hand (or the other hand) from receiving visual-latency forgiveness.
    markPerfectGuidePresented(type: StrokeType) {
        const action = type === StrokeType.LEFT ? this._leftActions[0] : this._rightActions[0];
        if (action && action.startedAt >= 0 && action.releasedAt < 0 && !action.strokeQualitySettled) {
            action.perfectGuidePresentedAt = this._motionClock;
        }
    }

    // A leg-kick tap adds visual kick budget and registers cadence. During
    // underwater glide the same cadence propulsion runs without the surface cap.
    recordKickTap(type: StrokeType): boolean {
        const queued = this.queueKickOnly(type);
        if (!queued) {
            return false;
        }
        this._kickAction = 1;
        // queueKickOnly already added one kick pulse of budget to the
        // contralateral leg; it sweeps through it at the fixed pulse cadence, so
        // rapid taps whip the legs at the player's finger rhythm. Propulsion comes
        // from the resulting kick FREQUENCY (registerKickCadence), not this tap.
        this.registerKickCadence();
        return true;
    }

    // Estimate the current kick frequency from the interval since the last tap.
    // instHz = 1/interval is exactly the tapping rate. It is clamped only by a
    // high SAFETY cap (kickCadenceMeasureMaxHz) so a near-zero gap between two taps
    // can't blow the value up — real human tapping never reaches it, so the leg
    // animation is effectively uncapped. Propulsion applies its own, lower cap
    // (kickCadenceMaxHz) separately in computeKickAcceleration.
    private registerKickCadence() {
        const now = this._motionClock;
        if (this._lastKickTapClock >= 0) {
            const interval = now - this._lastKickTapClock;
            const instHz = interval > 0
                ? clamp(1 / interval, 0, SWIMMER_BALANCE.kickCadenceMeasureMaxHz)
                : SWIMMER_BALANCE.kickCadenceMeasureMaxHz;
            this._kickCadenceHz = instHz;
        }
        this._lastKickTapClock = now;
    }

    // Each frame, if no tap arrived by the time the current cadence implies one,
    // the player has slowed or stopped tapping — ramp the cadence down toward the
    // fastest rate still consistent with the silence (1/sinceTap → 0 over time).
    private updateKickCadence() {
        if (this._lastKickTapClock < 0) {
            this._kickCadenceHz = 0;
            return;
        }
        const sinceTap = Math.max(0, this._motionClock - this._lastKickTapClock);
        const impliedInterval = this._kickCadenceHz > 0 ? 1 / this._kickCadenceHz : Infinity;
        if (sinceTap > impliedInterval) {
            this._kickCadenceHz = Math.min(this._kickCadenceHz, 1 / Math.max(sinceTap, 0.0001));
        }
    }

    // Continuous kick acceleration = per-Hz gain × current cadence. Surface
    // swimming fades it at the kick-only ceiling; an underwater dive already
    // enters above that ceiling, so applying the surface fade there would make
    // every kick produce exactly zero propulsion.
    private computeKickAcceleration(): number {
        if (this._kickCadenceHz <= 0) {
            return 0;
        }
        const fade = this._glidePhaseActive
            ? 1
            : clamp01(
                (SWIMMER_BALANCE.kickMaxSpeed - this._currentSpeed)
                    / Math.max(0.01, SWIMMER_BALANCE.kickCeilingBand),
            );
        if (fade <= 0) {
            return 0;
        }
        const propulsionHz = Math.min(this._kickCadenceHz, SWIMMER_BALANCE.kickCadenceMaxHz);
        return SWIMMER_BALANCE.kickAccelPerHz * propulsionHz * fade;
    }

    setStrokeHeld(type: StrokeType, held: boolean, preHeldSeconds = 0): StrokeQualityResult | null {
        let result: StrokeQualityResult | null = null;
        if (type === StrokeType.LEFT) {
            result = this.setSideHeld(StrokeType.LEFT, held, preHeldSeconds);
        } else if (type === StrokeType.RIGHT) {
            result = this.setSideHeld(StrokeType.RIGHT, held, preHeldSeconds);
        } else {
            const left = this.setSideHeld(StrokeType.LEFT, held, preHeldSeconds);
            const right = this.setSideHeld(StrokeType.RIGHT, held, preHeldSeconds);
            result = strongerStrokeQuality(left, right);
        }
        return result;
    }

    update(dt: number, options: SwimmerMotorOptions): boolean {
        if (!this._isRacing) {
            return false;
        }

        this._motionClock += dt;
        this._armAction = Math.max(0, this._armAction - dt * 4.6);
        this._kickAction = Math.max(0, this._kickAction - dt * 6.8);
        const strokeAcceleration = this.consumeStrokeAcceleration(dt);
        // Normal-dive player and AI inputs both register discrete kick taps. AI
        // uses the same cadence-derived underwater propulsion instead of a tiny
        // one-off pulse that cannot overcome glide drag.
        this.updateKickCadence();
        const kickAcceleration = this.computeKickAcceleration();
        const next = this._physics.step(
            {
                currentSpeed: this._currentSpeed,
                distance: this._distance,
            },
            {
                dt,
                strokeAcceleration,
                kickAcceleration,
                speedCapBonus: this._speedCapBonus,
                glideDrag: this._glidePhaseActive ? this._glideDrag : 0,
            },
        );
        this._currentAcceleration = dt > 0 ? (next.currentSpeed - this._currentSpeed) / dt : 0;
        this._currentSpeed = next.currentSpeed;
        this.decaySpeedCapBonus(dt, options);
        this.updateKickSteeringCorrection(dt, options);
        this.updateSteering(dt);
        const raceDistance = getRaceDistance();
        // Forward race progress uses only the along-lane component; veering with a
        // large heading is naturally slower (this is the whole steering cost).
        // Race distance is monotonic by contract. The steering hard cap keeps
        // cos(heading) positive; max(0, ...) is a second line of defence so even
        // corrupted runtime state can never make the swimmer turn back.
        const forwardSpeed = this._currentSpeed * Math.max(0, Math.cos(this._heading));
        this._distance = Math.min(raceDistance, this._distance + forwardSpeed * dt);
        // Lateral drift accumulates the sideways component, clamped to the pool.
        const requestedLateralOffset = this._lateralOffset + this._currentSpeed * Math.sin(this._heading) * dt;
        this._lateralOffset = clamp(requestedLateralOffset, this._lateralOffsetMin, this._lateralOffsetMax);
        if (Math.abs(this._lateralOffset - requestedLateralOffset) > 1e-6) {
            this.returnToLaneFromPoolWall();
        }
        this.updateMotionCycles(dt, options);
        if (!options.isAI) {
            this.checkArmStrokeTimeout();
        }

        if (this._distance >= raceDistance) {
            this._isRacing = false;
            return true;
        }
        return false;
    }

    private resetRaceState(initialDistance = 0) {
        this._distance = Math.max(0, initialDistance);
        this._bodyPhase = 0;
        this._leftArmCycle = 0;
        this._rightArmCycle = 0;
        this._leftKickCycle = 0;
        // Start the right leg half a cycle out of phase so the continuous flutter
        // alternates (one leg up while the other is down).
        this._rightKickCycle = Math.PI;
        this._leftArmMotionRemaining = 0;
        this._rightArmMotionRemaining = 0;
        this._leftKickMotionRemaining = 0;
        this._rightKickMotionRemaining = 0;
        this._armAction = 0;
        this._kickAction = 0;
        this._leftStrokeHeld = false;
        this._rightStrokeHeld = false;
        this._motionClock = 0;
        this._leftPressStartedAt = -1;
        this._rightPressStartedAt = -1;
        this._leftActions.length = 0;
        this._rightActions.length = 0;
        this._pendingStrokeQualityResults.length = 0;
        this._strokeAcceleration = 0;
        this._strokeAccelerationSeconds = 0;
        this._strokeAccelerationTotalSeconds = 0;
        this._speedCapBonus = 0;
        this._conditionSpeedScale = 1;
        this._conditionQualityScale = 1;
        this._lastStrokeQuality = 0;
        this._currentAcceleration = 0;
        this._kickCadenceHz = 0;
        this._lastKickTapClock = -1;
        this._heading = 0;
        this._headingTarget = 0;
        this._lateralOffset = 0;
    }

    setConditionSpeedScale(scale: number) {
        this._conditionSpeedScale = clamp(scale, 0, 2);
    }

    setConditionQualityScale(scale: number) {
        this._conditionQualityScale = clamp(scale, 0, 2);
    }

    private decaySpeedCapBonus(dt: number, options: SwimmerMotorOptions) {
        if (this._speedCapBonus <= 0) {
            return;
        }
        const decay = Math.max(0, SWIMMER_BALANCE.perfectComboOvercapDecay) * Math.max(0, dt);
        const maxSpeed = SWIMMER_BALANCE.maxSpeed;
        const neededForCurrentSpeed = Math.max(0, this._currentSpeed - maxSpeed);
        const comboMax = Math.max(0, SWIMMER_BALANCE.perfectComboMaxOvercap);
        const decayedBonus = Math.max(0, this._speedCapBonus - decay);
        this._speedCapBonus = Math.max(neededForCurrentSpeed, Math.min(decayedBonus, comboMax));
    }

    private updateMotionCycles(dt: number, options: SwimmerMotorOptions) {
        const speedRatio = this.speedRatio();
        const armCycleSpeed = this.currentActionCycleSpeed();
        const actionCycleSpeed = armCycleSpeed;

        this._bodyPhase += dt * Math.max(6, this._currentSpeed * 1.2);
        if (options.isAI) {
            // AI has no discrete kick taps: its legs still use the speed-driven
            // continuous flutter. Its ARMS, however, now run the exact same path as
            // the player — queued arm motion plus real StrokeActions that advance
            // through the cycle and settle stroke quality — so AI propulsion comes from
            // the same release-timing sweet zone the player uses.
            this.advanceAiFlutter(dt, speedRatio);
            const leftScale = this.motionSpeedScaleForSide(StrokeType.LEFT);
            const rightScale = this.motionSpeedScaleForSide(StrokeType.RIGHT);
            this._leftArmCycle += this.advanceQueuedMotion(dt, armCycleSpeed, '_leftArmMotionRemaining', leftScale);
            this._rightArmCycle += this.advanceQueuedMotion(dt, armCycleSpeed, '_rightArmMotionRemaining', rightScale);
            this.advanceSideActions(dt, actionCycleSpeed, StrokeType.LEFT, leftScale);
            this.advanceSideActions(dt, actionCycleSpeed, StrokeType.RIGHT, rightScale);
            return;
        }
        const leftArmDelta = this.advanceQueuedMotion(dt, armCycleSpeed, '_leftArmMotionRemaining', this.motionSpeedScaleForSide(StrokeType.LEFT));
        const rightArmDelta = this.advanceQueuedMotion(dt, armCycleSpeed, '_rightArmMotionRemaining', this.motionSpeedScaleForSide(StrokeType.RIGHT));
        this._leftArmCycle += leftArmDelta;
        this._rightArmCycle += rightArmDelta;
        this.advanceSideActions(dt, actionCycleSpeed, StrokeType.LEFT, this.motionSpeedScaleForSide(StrokeType.LEFT));
        this.advanceSideActions(dt, actionCycleSpeed, StrokeType.RIGHT, this.motionSpeedScaleForSide(StrokeType.RIGHT));
        // Legs are contralateral: the left leg mirrors the RIGHT arm, the right
        // leg mirrors the LEFT arm. Each follows its arm's motion while that arm
        // is stroking, otherwise sweeps through discrete tap pulses, otherwise
        // settles to a straight glide.
        this.advancePlayerKicks(dt, leftArmDelta, rightArmDelta);
    }

    // AI-only continuous flutter, driven purely by swim speed (kept from the old
    // model so AI swimmers keep flutter-kicking as they move). Both legs advance
    // by the same step to preserve their π phase offset set at reset.
    private advanceAiFlutter(dt: number, speedRatio: number) {
        const idle = clamp01(MOTION_TUNING.kickFlutterIdleFraction);
        const cadenceFraction = idle + (1 - idle) * clamp01(speedRatio);
        const cadence = CYCLE_AMOUNT * MOTION_TUNING.kickFlutterMaxCyclesPerSecond * cadenceFraction;
        const step = cadence * dt;
        this._leftKickCycle += step;
        this._rightKickCycle += step;
        this._leftKickMotionRemaining = 0;
        this._rightKickMotionRemaining = 0;
    }

    // Player legs (contralateral): the left leg mirrors the RIGHT arm, the right
    // leg mirrors the LEFT arm. While the arm is stroking the leg eases to finish
    // its current cycle exactly when the arm finishes this stroke (no drift, no
    // extra cycle); otherwise it sweeps queued tap pulses at the finger rhythm, or
    // settles to a straight-leg glide when idle.
    private advancePlayerKicks(dt: number, leftArmDelta: number, rightArmDelta: number) {
        const leftArmStroking = this._leftActions.length > 0;
        const rightArmStroking = this._rightActions.length > 0;
        // Left leg ↔ right arm
        this._leftKickCycle += this.advancePlayerLeg(
            dt, '_leftKickMotionRemaining', this._leftKickCycle, rightArmStroking, this._rightArmCycle, rightArmDelta,
        );
        // Right leg ↔ left arm
        this._rightKickCycle += this.advancePlayerLeg(
            dt, '_rightKickMotionRemaining', this._rightKickCycle, leftArmStroking, this._leftArmCycle, leftArmDelta,
        );
    }

    private advancePlayerLeg(
        dt: number,
        budgetKey: '_leftKickMotionRemaining' | '_rightKickMotionRemaining',
        cycle: number,
        armStroking: boolean,
        armCycle: number,
        armDelta: number,
    ): number {
        if (armStroking) {
            // The contralateral arm is mid-stroke. The tap that started this stroke
            // already moved the leg a little; the leg now EASES so it finishes its
            // current cycle exactly when the arm finishes this stroke's cycle. Each
            // frame the leg advances its remaining-to-cycle-end by the same fraction
            // the arm advances of ITS remaining-to-cycle-end (visual-phase remainder,
            // measured at frame start). Because that fraction integrates to 1 at the
            // boundary, both hit the cycle end together, then realign at 0 — so
            // consecutive strokes never drift, and the arm speeding up on release
            // (releasedMotionSpeedScale) is followed automatically with no special
            // case. Kick budget is NOT dropped here: extra taps during the stroke
            // stay queued and play as kicks once the stroke completes (input queue),
            // instead of restarting the leg mid-cycle.
            if (armDelta <= 0) {
                return 0;
            }
            // Frame-start phases: armCycle already includes this frame's delta, so
            // subtract it back out; cycle is the leg phase before this frame's step.
            const armPhaseStart = positiveMod(armCycle - armDelta, CYCLE_AMOUNT);
            const legPhaseStart = positiveMod(cycle, CYCLE_AMOUNT);
            const armRemaining = CYCLE_AMOUNT - armPhaseStart;
            const legRemaining = CYCLE_AMOUNT - legPhaseStart;
            if (armRemaining <= 0.0001) {
                return legRemaining;
            }
            const fraction = Math.min(1, armDelta / armRemaining);
            return legRemaining * fraction;
        }
        const budget = this[budgetKey];
        if (budget > 0) {
            // Discrete tap pulse: the sweep cadence TRACKS the player's actual tap
            // frequency (_kickCadenceHz), so tapping faster whips the legs faster
            // with no fixed ceiling other than kickCadenceMaxHz. Floored so a
            // single/slow tap still plays a visibly quick kick. The legs match the
            // finger rhythm one-to-one instead of lagging behind it.
            const cyclesPerSecond = Math.max(MOTION_TUNING.kickPulseMinCyclesPerSecond, this._kickCadenceHz);
            const cadence = CYCLE_AMOUNT * cyclesPerSecond;
            const step = Math.min(budget, cadence * dt);
            this[budgetKey] = budget - step;
            return step;
        }
        // Idle (no input, no stroke): finish the current partial kick to the next
        // neutral (hip-level, straight-ish) pose, then hold still — a pure glide.
        // The kick pose returns to hip=0 every half cycle (π), so settle to the
        // next multiple of π regardless of which leg's rest phase (0 or π) it is.
        const half = Math.PI;
        const frac = cycle - Math.floor(cycle / half) * half;
        if (frac <= 0.0001) {
            return 0;
        }
        const toNeutral = half - frac;
        const settle = CYCLE_AMOUNT * MOTION_TUNING.kickSettleCyclesPerSecond;
        return Math.min(toNeutral, settle * dt);
    }

    private setSideHeld(type: StrokeType, held: boolean, preHeldSeconds: number): StrokeQualityResult | null {
        const isLeft = type === StrokeType.LEFT;
        const actions = isLeft ? this._leftActions : this._rightActions;
        const pressStartedAt = held
            ? this._motionClock - Math.max(0, preHeldSeconds)
            : -1;
        if (isLeft) {
            this._leftStrokeHeld = held;
            this._leftPressStartedAt = pressStartedAt;
        } else {
            this._rightStrokeHeld = held;
            this._rightPressStartedAt = pressStartedAt;
        }

        if (!held) {
            for (const action of actions) {
                if (action.releasedAt < 0) {
                    action.releasedAt = this._motionClock;
                }
            }
            const activeAction = actions[0];
            if (activeAction?.startedAt >= 0 && !activeAction.strokeQualitySettled) {
                return this.settleActionStrokeQuality(type, activeAction, this.predictedActionSecondsAfterRelease(activeAction), false);
            }
        }
        return null;
    }

    private finishAction(type: StrokeType, action: StrokeAction, completedAt: number) {
        const actionSeconds = Math.max(0.001, completedAt - action.startedAt);
        if (action.strokeQualitySettled) {
            return;
        }
        this.settleActionStrokeQuality(type, action, actionSeconds, true);
    }

    // Redesign: while a stroke is still held and the pull has progressed past the
    // timeout fraction (hand out of the water), auto-end it as a timeout miss.
    // Non-destructive: routes a dedicated miss result instead of the normal
    // hold-ratio settlement, and does not pollute the consistency history.
    private checkArmStrokeTimeout() {
        this.checkSideArmStrokeTimeout(StrokeType.LEFT);
        this.checkSideArmStrokeTimeout(StrokeType.RIGHT);
    }

    private checkSideArmStrokeTimeout(type: StrokeType) {
        const action = type === StrokeType.LEFT ? this._leftActions[0] : this._rightActions[0];
        if (!action || action.strokeQualitySettled || action.startedAt < 0) {
            return;
        }
        // Only held strokes (never released) can time out.
        if (action.releasedAt >= 0 || action.pressedAt < 0) {
            return;
        }
        const timeoutProgress = clamp01(STROKE_QUALITY_TUNING.armStrokeTimeoutProgress) * CYCLE_AMOUNT;
        if (action.progress < timeoutProgress) {
            return;
        }
        this.forceArmStrokeTimeout(type, action);
    }

    private forceArmStrokeTimeout(type: StrokeType, action: StrokeAction) {
        action.releasedAt = this._motionClock;
        action.strokeQualitySettled = true;
        this._lastStrokeQuality = 0;
        this.startStrokeAcceleration(Math.max(0, STROKE_QUALITY_TUNING.armStrokeTimeoutAccel), false);
        const actionSeconds = this.predictedActionSecondsAfterRelease(action);
        this._pendingStrokeQualityResults.push({
            type,
            strokeQuality: 0,
            badReason: 'timeout',
            holdSeconds: this.currentHoldSeconds(action),
            actionSeconds,
            minHoldSeconds: Math.max(0, STROKE_QUALITY_TUNING.minHoldSeconds),
            holdTimeValid: true,
            holdRatio: 1,
            inputFreshness: 1,
            inputLeadSeconds: 0,
            inputLeadRatio: 0,
            meanRatio: 1,
            ratioStdDev: 0,
            sampleCount: 0,
        });
    }

    private settleActionStrokeQuality(type: StrokeType, action: StrokeAction, actionSeconds: number, queueResult: boolean): StrokeQualityResult {
        const completedAt = action.startedAt + actionSeconds;
        const releasedAt = action.releasedAt >= 0 ? action.releasedAt : completedAt;
        const holdStart = action.pressedAt >= 0 ? action.pressedAt : action.startedAt;
        const holdEnd = Math.min(releasedAt, completedAt);
        const holdSeconds = action.pressedAt >= 0 ? Math.max(0, holdEnd - holdStart) : 0;
        const minHoldSeconds = Math.max(0, STROKE_QUALITY_TUNING.minHoldSeconds);
        const holdTimeValid = holdSeconds >= minHoldSeconds;
        // Release progress = how far the pull arc had advanced when released,
        // as a fraction of a full cycle. This is the axis the sweet zone lives on.
        const releaseProgress = clamp01(action.progress / CYCLE_AMOUNT);

        // Redesign: an active release (queueResult === false) that is too short to
        // be a real arm stroke is reinterpreted as a leg-kick tap — the player is
        // tapping, not stroking. Give kick-tap propulsion and flag it so the flow
        // layer suppresses the miss feedback. Auto-completed strokes never downgrade.
        if (!holdTimeValid && !queueResult) {
            action.strokeQualitySettled = true;
            this._lastStrokeQuality = 0;
            // Propulsion for this reinterpreted kick comes from the kick-cadence
            // system (the press already registered a tap), not a one-off pulse.
            return {
                type,
                strokeQuality: 0,
                badReason: undefined,
                holdSeconds,
                actionSeconds,
                minHoldSeconds,
                holdTimeValid: false,
                holdRatio: releaseProgress,
                inputFreshness: 1,
                inputLeadSeconds: 0,
                inputLeadRatio: 0,
                meanRatio: releaseProgress,
                ratioStdDev: 0,
                sampleCount: 0,
                downgradedToKick: true,
            };
        }

        // Single-stroke quality is purely the release-timing sweet zone now
        // (no cross-stroke consistency, no alternation, no input-freshness).
        const perfect = normalizedReleaseRange(STROKE_QUALITY_TUNING.perfectStart, STROKE_QUALITY_TUNING.perfectEnd);
        const good = normalizedReleaseRange(STROKE_QUALITY_TUNING.goodStart, STROKE_QUALITY_TUNING.goodEnd);
        const secondsSinceYellow = releasedAt - action.perfectGuidePresentedAt;
        const releasedJustAfterVisiblePerfect = releaseProgress > perfect.end
            && releaseProgress <= Math.min(good.end, perfect.end + 0.03)
            && action.perfectGuidePresentedAt >= 0
            && secondsSinceYellow >= 0
            && secondsSinceYellow <= Math.max(0, STROKE_QUALITY_TUNING.perfectVisualReleaseGraceSeconds);
        const strokeQuality = holdTimeValid
            ? (releasedJustAfterVisiblePerfect ? 1 : strokeQualityFromReleaseProgress(releaseProgress))
            : 0;
        const badReason = strokeQuality <= 0
            ? describeReleaseBadReason(releaseProgress, holdTimeValid, holdSeconds, minHoldSeconds)
            : undefined;
        this._lastStrokeQuality = strokeQuality;
        this.startSettledStrokeAcceleration(strokeQuality, actionSeconds);
        action.strokeQualitySettled = true;
        // Steering nudge fires when a real stroke settles (“松手” for a tap, or a
        // held cycle completing). The turn scales with pull strength: the further
        // the pull travelled before release (longer hold), the bigger the turn.
        const turnPower = clamp01(releaseProgress / Math.max(0.01, STROKE_QUALITY_TUNING.armStrokeTimeoutProgress));
        this.applyStrokeSteering(type, turnPower);
        const result = {
            type,
            strokeQuality,
            badReason,
            holdSeconds,
            actionSeconds,
            minHoldSeconds,
            holdTimeValid,
            holdRatio: releaseProgress,
            inputFreshness: 1,
            inputLeadSeconds: 0,
            inputLeadRatio: 0,
            meanRatio: releaseProgress,
            ratioStdDev: 0,
            sampleCount: 0,
        };
        if (queueResult) {
            this._pendingStrokeQualityResults.push(result);
        }
        return result;
    }

    private predictedActionSecondsAfterRelease(action: StrokeAction): number {
        const elapsed = Math.max(0, this._motionClock - action.startedAt);
        const remainingProgress = Math.max(0, CYCLE_AMOUNT - action.progress);
        const releaseSpeed = this.currentActionCycleSpeed() * MOTION_TUNING.releasedMotionSpeedScale;
        const remainingSeconds = releaseSpeed > 0 ? remainingProgress / releaseSpeed : 0;
        return Math.max(0.001, elapsed + remainingSeconds);
    }

    private startActionBaseAcceleration(type: StrokeType, action: StrokeAction) {
        action.baseAccelerationStarted = true;
        // Base propulsion is paid when the stroke settles, after release timing is
        // known, so it can be normalized by the stroke's occupied action time.
    }

    private startSettledStrokeAcceleration(strokeQuality: number, actionSeconds: number) {
        const baseAccel = Math.max(0, SWIMMER_BALANCE.strokeBaseAccel);
        const qualityAccel = Math.max(0, strokeQuality) * SWIMMER_BALANCE.strokeQualityAccel * this._conditionSpeedScale;
        const accel = (baseAccel + qualityAccel) * this.strokeActionTimeScale(actionSeconds);
        if (accel <= 0) {
            return;
        }
        this.startStrokeAcceleration(accel, false);
    }

    private strokeActionTimeScale(actionSeconds: number): number {
        const referenceSeconds = this.referenceSweetCenterActionSeconds();
        return referenceSeconds > 0 ? Math.max(0, actionSeconds) / referenceSeconds : 1;
    }

    private referenceSweetCenterActionSeconds(): number {
        const cycleSpeed = Math.max(0.0001, this.currentActionCycleSpeed());
        const heldScale = Math.max(0.0001, MOTION_TUNING.heldMotionSpeedScale);
        const releaseScale = Math.max(0.0001, MOTION_TUNING.releasedMotionSpeedScale);
        const center = perfectReleaseCenter();
        return (CYCLE_AMOUNT * center) / (cycleSpeed * heldScale)
            + (CYCLE_AMOUNT * (1 - center)) / (cycleSpeed * releaseScale);
    }

    private startStrokeAcceleration(accel: number, additive: boolean) {
        if (accel <= 0) {
            return;
        }
        if (additive) {
            this._strokeAcceleration = Math.max(this._strokeAcceleration + accel, accel);
        } else {
            this._strokeAcceleration = Math.max(this._strokeAcceleration, accel);
        }
        this._strokeAccelerationSeconds = Math.max(
            this._strokeAccelerationSeconds,
            this.currentCycleSeconds() * SWIMMER_BALANCE.strokeAccelDurationRatio,
        );
        this._strokeAccelerationTotalSeconds = this._strokeAccelerationSeconds;
    }

    private consumeStrokeAcceleration(dt: number): number {
        if (this._strokeAccelerationSeconds <= 0) {
            this._strokeAcceleration = 0;
            this._strokeAccelerationTotalSeconds = 0;
            return 0;
        }
        // Impulse shape: distribute the same total momentum as a front-loaded
        // spike (redesign, "冲刺感"). remainingRatio goes 1→0 over the pulse.
        // shape = 1 + sharpness*(2r-1): peaks at 1+sharpness right after the
        // stroke, fades to 1-sharpness at the end, mean stays 1 so overall speed
        // is unchanged — only the punchiness changes. 0 = flat (old behavior).
        const total = Math.max(0.0001, this._strokeAccelerationTotalSeconds);
        const remainingRatio = clamp01(this._strokeAccelerationSeconds / total);
        this._strokeAccelerationSeconds = Math.max(0, this._strokeAccelerationSeconds - dt);
        const sharpness = clamp01(SWIMMER_BALANCE.strokeImpulseSharpness);
        const shape = Math.max(0, 1 + sharpness * (2 * remainingRatio - 1));
        const acceleration = this._strokeAcceleration * shape;
        if (this._strokeAccelerationSeconds <= 0) {
            this._strokeAcceleration = 0;
            this._strokeAccelerationTotalSeconds = 0;
        }
        return acceleration;
    }

    private currentCycleSeconds(): number {
        return CYCLE_AMOUNT / Math.max(0.05, this.currentActionCycleSpeed());
    }

    private currentActionCycleSpeed(): number {
        // Redesign: arm-stroke cadence ramps linearly from the low-speed floor to
        // the high-speed ceiling as current speed crosses the window
        // [armCycleSpeedStart, armCycleSpeedFull], clamped at both ends. The sweet
        // zone stays a fixed fraction of a cycle, so a faster cycle = a tighter
        // timing window. The selected race difficulty scales the whole cadence
        // range, so easier races provide wider real-time release windows.
        const start = STROKE_QUALITY_TUNING.armCycleSpeedStart;
        const full = STROKE_QUALITY_TUNING.armCycleSpeedFull;
        const span = Math.max(0.01, full - start);
        const t = clamp01((this._currentSpeed - start) / span);
        return CYCLE_AMOUNT * getRaceArmCycleSpeedScale() * lerp(
            STROKE_QUALITY_TUNING.armCycleLowSpeedPerSecond,
            STROKE_QUALITY_TUNING.armCycleHighSpeedPerSecond,
            t,
        );
    }

    private speedRatio(): number {
        return SWIMMER_BALANCE.maxSpeed > 0 ? clamp01(this._currentSpeed / SWIMMER_BALANCE.maxSpeed) : 0;
    }

    // Steering is enabled for both the player and AI; both drive it through the
    // same stroke path (the AI controller only decides which side to stroke).
    setSteeringEnabled(enabled: boolean) {
        this._steeringEnabled = enabled;
    }

    // Lateral offset bounds (relative to the swimmer's lane centre) so the drift
    // clamps at the pool side walls. Set by the owning Swimmer from the course.
    setLateralOffsetBounds(min: number, max: number) {
        this._lateralOffsetMin = Math.min(min, max);
        this._lateralOffsetMax = Math.max(min, max);
    }

    // Current lap travel direction (+1 outbound, -1 on the return lap). Steering
    // is flipped by this so "right hand -> screen-left" stays consistent after the
    // turn, when the chase camera is facing the other way.
    setCourseDirection(direction: number) {
        this._courseDirection = direction >= 0 ? 1 : -1;
    }

    // Signed steering heading as a fraction of the maximum (-1..1). Used by the
    // AI to sense how far off course it is and decide which side to stroke.
    get steeringHeadingRatio(): number {
        const maxHeading = safeMaxHeadingRadians();
        return maxHeading > 0 ? clamp(this._headingTarget / maxHeading, -1, 1) : 0;
    }

    // The stroke side whose steering nudge pulls the heading back toward straight.
    // Depends on lap direction (dir(LEFT) = +courseDirection). When already
    // straight either side works; returns the alternation-neutral LEFT.
    correctiveStrokeSide(): StrokeType {
        const targetSign = this._headingTarget >= 0 ? 1 : -1;
        const leftDirSign = this._courseDirection >= 0 ? 1 : -1;
        // We want a stroke whose dir sign is the opposite of the current target.
        return leftDirSign === -targetSign ? StrokeType.LEFT : StrokeType.RIGHT;
    }

    get heading(): number {
        return this._heading;
    }

    get lateralOffset(): number {
        return this._lateralOffset;
    }

    setLateralOffset(offset: number) {
        this._lateralOffset = clamp(offset, this._lateralOffsetMin, this._lateralOffsetMax);
    }

    // A pool wall absorbs lateral motion. Clearing the target lets the existing
    // steering easing return the swimmer to the lane without a visual snap.
    returnToLaneFromPoolWall() {
        this._headingTarget = 0;
    }

    // Shift race progress by a small amount (used by swimmer-vs-swimmer collision
    // to push bodies apart along the swim axis). Clamped to the race bounds.
    nudgeDistance(delta: number) {
        this._distance = Math.max(0, Math.min(getRaceDistance(), this._distance + delta));
    }

    // Ease the actual heading toward the stroke-set target so a stroke turns the
    // body GRADUALLY after release. No auto-recenter: heading only returns toward
    // straight when the swimmer strokes the other side (player and AI alike).
    private updateSteering(dt: number) {
        const maxHeading = safeMaxHeadingRadians();
        // Re-clamp every frame because debug tuning can change while racing and
        // persisted JSON bypasses the UI slider's min/max metadata.
        this._headingTarget = clamp(finiteOr(this._headingTarget, 0), -maxHeading, maxHeading);
        this._heading = clamp(finiteOr(this._heading, 0), -maxHeading, maxHeading);
        const ease = Math.max(0, finiteOr(STEERING_TUNING.turnEaseRate, 0));
        this._heading += ease > 0
            ? (this._headingTarget - this._heading) * Math.min(1, ease * dt)
            : (this._headingTarget - this._heading);
        this._heading = clamp(finiteOr(this._heading, 0), -maxHeading, maxHeading);
        if (Math.abs(this._heading - this._headingTarget) < 1e-4) {
            this._heading = this._headingTarget;
        }
    }

    // Rapid player kick taps act as a gradual recovery aid: they pull only the
    // steering target back toward the lane. updateSteering then eases the body
    // after it, preserving the existing smooth turn and avoiding a snap.
    private updateKickSteeringCorrection(dt: number, options: SwimmerMotorOptions) {
        if (options.isAI) {
            return;
        }
        if (this._kickCadenceHz <= 0) {
            return;
        }
        const minCadence = Math.max(0, finiteOr(STEERING_TUNING.kickStraightenMinCadenceHz, 0));
        if (this._kickCadenceHz < minCadence) {
            return;
        }
        const correctionRate = Math.max(0, finiteOr(STEERING_TUNING.kickStraightenRate, 0));
        this._headingTarget += (0 - this._headingTarget) * Math.min(1, correctionRate * Math.max(0, dt));
    }

    // A settled arm stroke nudges the heading TARGET; the actual heading eases
    // toward it (see updateSteering) so the body turns gradually AFTER release,
    // not on press. RIGHT hand -> drift toward screen-left; LEFT -> screen-right.
    // The sign is flipped by lap direction so it stays consistent after the turn.
    // powerFactor (0..1) scales the turn by how hard/long the stroke was pulled.
    private applyStrokeSteering(type: StrokeType, powerFactor: number) {
        if (!this._steeringEnabled) {
            return;
        }
        const minFactor = clamp01(STEERING_TUNING.turnPowerMinFactor);
        const factor = minFactor + (1 - minFactor) * clamp01(powerFactor);
        const turn = Math.max(0, finiteOr(STEERING_TUNING.turnPerStroke, 0)) * DEG2RAD * factor;
        const maxHeading = safeMaxHeadingRadians();
        const dir = (type === StrokeType.LEFT ? 1 : -1) * this._courseDirection;
        this._headingTarget = clamp(finiteOr(this._headingTarget, 0) + dir * turn, -maxHeading, maxHeading);
    }

    private queueSideStroke(type: StrokeType): QueueSideStrokeResult {
        const isLeft = type === StrokeType.LEFT;
        const actions = isLeft ? this._leftActions : this._rightActions;
        const armKey = isLeft ? '_leftArmMotionRemaining' : '_rightArmMotionRemaining';
        if (!this.canQueueSideStroke(type)) {
            return { queued: false, startedImmediately: false };
        }

        // Only the arm is queued here; the contralateral leg follows this arm's
        // motion automatically (see advancePlayerKicks), so no separate kick queue.
        this.queueMotionCycle(armKey);
        const held = isLeft ? this._leftStrokeHeld : this._rightStrokeHeld;
        const pressedAt = held ? Math.max(0, isLeft ? this._leftPressStartedAt : this._rightPressStartedAt) : -1;
        const startedImmediately = actions.length === 0;
        actions.push({
            queuedAt: this._motionClock,
            startedAt: startedImmediately ? this._motionClock : -1,
            pressedAt,
            releasedAt: held ? -1 : this._motionClock,
            progress: 0,
            baseAccelerationStarted: false,
            strokeQualitySettled: false,
            alternationQuality: 0,
            inputFreshness: 1,
            inputLeadSeconds: 0,
            inputLeadRatio: 0,
            perfectGuidePresentedAt: -1,
        });
        if (startedImmediately) {
            this.startActionBaseAcceleration(type, actions[actions.length - 1]);
            // This press became an arm stroke, so its contralateral leg is now
            // driven by the arm. Drop the tap pulse this same press added to that
            // leg (via beginPress→recordKickTap) so it isn't replayed as an extra
            // kick after the stroke — one press = exactly one kick. Later taps
            // during the stroke keep their budget and play once the stroke ends.
            const contraLegKey = isLeft ? '_rightKickMotionRemaining' : '_leftKickMotionRemaining';
            this[contraLegKey] = 0;
        }
        return { queued: true, startedImmediately };
    }

    // Continuation stroke: called when a stroke's cycle finishes while its key is
    // still held. Starts the next stroke right away, timing its hold from the
    // completion moment (atTime) instead of the earlier press that arrived while
    // the previous stroke was still playing. Returns true if a stroke was started.
    private tryStartHeldStroke(type: StrokeType, atTime: number): boolean {
        const isLeft = type === StrokeType.LEFT;
        const held = isLeft ? this._leftStrokeHeld : this._rightStrokeHeld;
        if (!held) {
            return false;
        }
        const actions = isLeft ? this._leftActions : this._rightActions;
        const armKey = isLeft ? '_leftArmMotionRemaining' : '_rightArmMotionRemaining';
        if (actions.length >= 1 || !this.canQueueMotionCycle(armKey)) {
            return false;
        }
        // Reset this side's press start so hold duration is measured from now.
        if (isLeft) {
            this._leftPressStartedAt = atTime;
        } else {
            this._rightPressStartedAt = atTime;
        }
        this.queueMotionCycle(armKey);
        const action: StrokeAction = {
            queuedAt: atTime,
            startedAt: atTime,
            pressedAt: atTime,
            releasedAt: -1,
            progress: 0,
            baseAccelerationStarted: false,
            strokeQualitySettled: false,
            alternationQuality: 0,
            inputFreshness: 1,
            inputLeadSeconds: 0,
            inputLeadRatio: 0,
            perfectGuidePresentedAt: -1,
        };
        actions.push(action);
        this.startActionBaseAcceleration(type, action);
        this._armAction = 1;
        this._kickAction = 1;
        return true;
    }

    private canQueueSideStroke(type: StrokeType): boolean {
        const isLeft = type === StrokeType.LEFT;
        const actions = isLeft ? this._leftActions : this._rightActions;
        const armKey = isLeft ? '_leftArmMotionRemaining' : '_rightArmMotionRemaining';
        // Input queue disabled (试): only the currently-playing stroke is allowed
        // per side; a new press while one is still playing is rejected instead of
        // queued behind it. (Was `< 2` to allow one queued stroke.)
        return actions.length < 1 && this.canQueueMotionCycle(armKey);
    }

    // A leg-kick tap adds one kick pulse of budget to the CONTRALATERAL leg
    // (LEFT input → right leg, RIGHT input → left leg), capped so rapid taps only
    // buffer a few pulses and the legs stop quickly once tapping stops.
    private queueKickOnly(type: StrokeType): boolean {
        if (type === StrokeType.LEFT) {
            return this.addKickPulse('_rightKickMotionRemaining');
        }
        if (type === StrokeType.RIGHT) {
            return this.addKickPulse('_leftKickMotionRemaining');
        }
        const leftQueued = this.addKickPulse('_leftKickMotionRemaining');
        const rightQueued = this.addKickPulse('_rightKickMotionRemaining');
        return leftQueued || rightQueued;
    }

    private addKickPulse(key: '_leftKickMotionRemaining' | '_rightKickMotionRemaining'): boolean {
        const cap = Math.max(1, MOTION_TUNING.kickPulseMaxCycles) * CYCLE_AMOUNT;
        const next = Math.min(cap, this[key] + CYCLE_AMOUNT);
        if (next <= this[key]) {
            return false;
        }
        this[key] = next;
        return true;
    }

    private canQueueMotionCycle(
        remainingKey: '_leftArmMotionRemaining' | '_rightArmMotionRemaining' | '_leftKickMotionRemaining' | '_rightKickMotionRemaining',
    ): boolean {
        return this[remainingKey] + CYCLE_AMOUNT <= MAX_QUEUED_MOTION + 0.0001;
    }

    private queueMotionCycle(
        remainingKey: '_leftArmMotionRemaining' | '_rightArmMotionRemaining' | '_leftKickMotionRemaining' | '_rightKickMotionRemaining',
    ): boolean {
        const next = Math.min(MAX_QUEUED_MOTION, this[remainingKey] + CYCLE_AMOUNT);
        if (next <= this[remainingKey]) {
            return false;
        }
        this[remainingKey] = next;
        return true;
    }

    private advanceQueuedMotion(
        dt: number,
        speed: number,
        remainingKey: '_leftArmMotionRemaining' | '_rightArmMotionRemaining' | '_leftKickMotionRemaining' | '_rightKickMotionRemaining',
        speedScale: number,
    ): number {
        const remaining = this[remainingKey];
        if (remaining <= 0) {
            return 0;
        }

        const step = Math.min(remaining, speed * speedScale * dt);
        this[remainingKey] -= step;
        return step;
    }

    private advanceSideActions(dt: number, speed: number, type: StrokeType, speedScale: number) {
        const actions = type === StrokeType.LEFT ? this._leftActions : this._rightActions;
        if (actions.length === 0) {
            return;
        }
        const scaledSpeed = speed * speedScale;
        if (scaledSpeed <= 0) {
            return;
        }

        const frameStartedAt = this._motionClock - dt;
        let remainingStep = scaledSpeed * dt;
        let elapsed = 0;
        while (remainingStep > 0.00001 && actions.length > 0) {
            const action = actions[0];
            if (action.startedAt < 0) {
                action.startedAt = frameStartedAt + elapsed;
                if (!action.baseAccelerationStarted) {
                    this.startActionBaseAcceleration(type, action);
                }
            }
            const needed = CYCLE_AMOUNT - action.progress;
            const consumed = Math.min(needed, remainingStep);
            action.progress += consumed;
            remainingStep -= consumed;
            elapsed += consumed / scaledSpeed;

            if (action.progress >= CYCLE_AMOUNT - 0.00001) {
                actions.shift();
                this.finishAction(type, action, frameStartedAt + elapsed);
                // Continuation: if the key is still held when this stroke's cycle
                // completes, start the next stroke immediately (its hold is timed
                // from this moment). This rescues a press that arrived slightly
                // early — while the previous stroke was still finishing — which
                // would otherwise be dropped and stall the arm for a full cycle.
                if (this.tryStartHeldStroke(type, frameStartedAt + elapsed)) {
                    break;
                }
            }
        }
    }

    private motionSpeedScaleForSide(type: StrokeType): number {
        const activeAction = type === StrokeType.LEFT ? this._leftActions[0] : this._rightActions[0];
        if (activeAction && activeAction.releasedAt >= 0) {
            return MOTION_TUNING.releasedMotionSpeedScale;
        }
        const held = type === StrokeType.LEFT ? this._leftStrokeHeld : this._rightStrokeHeld;
        const sideScale = held ? MOTION_TUNING.heldMotionSpeedScale : MOTION_TUNING.releasedMotionSpeedScale;
        return sideScale;
    }

    get currentSpeed(): number {
        return this._currentSpeed;
    }

    get distance(): number {
        return this._distance;
    }

    get isRacing(): boolean {
        return this._isRacing;
    }

    get bodyPhase(): number {
        return this._bodyPhase;
    }

    get armCycle(): number {
        return this._leftArmCycle;
    }

    get kickCycle(): number {
        return this._rightKickCycle;
    }

    get leftArmCycle(): number {
        return this._leftArmCycle;
    }

    get rightArmCycle(): number {
        return this._rightArmCycle;
    }

    get leftKickCycle(): number {
        return this._leftKickCycle;
    }

    get rightKickCycle(): number {
        return this._rightKickCycle;
    }

    get armAction(): number {
        return this._armAction;
    }

    get kickAction(): number {
        return this._kickAction;
    }

    // Camera/read-only presentation signal. The cadence is established by the
    // interval between kick taps and decays after tapping stops.
    get kickCadenceHz(): number {
        return this._kickCadenceHz;
    }

    // Keep the full queued arm motion classified as a stroke, including its
    // released follow-through, so the camera does not pull back mid-recovery.
    get isArmStrokeActive(): boolean {
        return this._leftActions.length > 0 || this._rightActions.length > 0;
    }

    get lastStrokeQuality(): number {
        return this._lastStrokeQuality;
    }

    get currentAcceleration(): number {
        return this._currentAcceleration;
    }

    get actionCycleSeconds(): number {
        return this.currentCycleSeconds();
    }

    get strokeTimingGuide(): StrokeTimingGuide {
        return this.buildGuideFromAction(this.currentGuideAction());
    }

    // Per-side timing guide: left and right arms are independent stroke queues,
    // so each hand has its own release-progress marker. The combined getter above
    // still returns whichever side is currently active (earliest-started); this
    // one is scoped to a single hand so the UI can show one dial per hand.
    strokeTimingGuideForSide(type: StrokeType): StrokeTimingGuide {
        const action = type === StrokeType.LEFT ? this._leftActions[0] : this._rightActions[0];
        const usable = action && action.startedAt >= 0 && !action.strokeQualitySettled ? action : null;
        return this.buildGuideFromAction(usable);
    }

    private buildGuideFromAction(action: StrokeAction | null): StrokeTimingGuide {
        const actionSeconds = action ? this.predictedActionSecondsAfterRelease(action) : this.currentCycleSeconds();
        const holdSeconds = action ? this.currentHoldSeconds(action) : 0;
        // Redesign: the guide axis is the pull-arc progress (release progress),
        // i.e. how far the stroke has pulled as a fraction of a full cycle. The
        // sweet zone and the moving marker both live on this axis now.
        const releaseProgress = action ? clamp01(action.progress / CYCLE_AMOUNT) : 0;
        return {
            active: !!action && action.releasedAt < 0,
            currentRatio: releaseProgress,
            holdSeconds,
            actionSeconds,
            minHoldRatio: clamp01(STROKE_QUALITY_TUNING.minHoldSeconds / Math.max(0.001, actionSeconds)),
            intervals: this.timingGuideIntervals(action, actionSeconds),
        };
    }

    consumeStrokeQualityResults(): StrokeQualityResult[] {
        if (this._pendingStrokeQualityResults.length === 0) {
            return [];
        }
        return this._pendingStrokeQualityResults.splice(0);
    }

    private currentGuideAction(): StrokeAction | null {
        const left = this._leftActions[0];
        const right = this._rightActions[0];
        const candidates = [left, right].filter((action) => action && action.startedAt >= 0 && !action.strokeQualitySettled);
        if (candidates.length === 0) {
            return null;
        }
        candidates.sort((a, b) => a.startedAt - b.startedAt);
        return candidates[0];
    }

    private currentHoldSeconds(action: StrokeAction): number {
        if (action.pressedAt < 0 || action.startedAt < 0) {
            return 0;
        }
        const holdStart = Math.max(action.pressedAt, action.startedAt);
        const holdEnd = action.releasedAt >= 0 ? Math.min(action.releasedAt, this._motionClock) : this._motionClock;
        return Math.max(0, holdEnd - holdStart);
    }

    private timingGuideIntervals(action: StrokeAction | null, actionSeconds: number): StrokeTimingGuideInterval[] {
        const intervals: StrokeTimingGuideInterval[] = [];
        const steps = 96;
        let openRating = this.ratingForGuideRatio(0.5 / steps, action, actionSeconds);
        let openStart = 0;
        for (let i = 1; i <= steps; i++) {
            const start = i / steps;
            const end = Math.min(1, (i + 1) / steps);
            const rating = i < steps ? this.ratingForGuideRatio((start + end) * 0.5, action, actionSeconds) : openRating;
            if (i >= steps || rating !== openRating) {
                intervals.push({
                    rating: openRating,
                    startRatio: openStart,
                    endRatio: start,
                });
                openRating = rating;
                openStart = start;
            }
        }
        return intervals;
    }

    private ratingForGuideRatio(holdRatio: number, action: StrokeAction | null, actionSeconds: number): Rating {
        // The guide axis is release progress (fraction of a full cycle). Map it
        // through the same release-timing sweet zone used for scoring so the
        // on-screen guide shows exactly where PERFECT / GOOD land. Progress past
        // the overhold-timeout point can never be a valid release (auto miss).
        const progress = clamp01(holdRatio);
        if (progress >= clamp01(STROKE_QUALITY_TUNING.armStrokeTimeoutProgress)) {
            return Rating.BAD;
        }
        return ratingForGuideStrokeQuality(strokeQualityFromReleaseProgress(progress));
    }
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * clamp01(t);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
    return clamp(value, 0, 1);
}

function finiteOr(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function safeMaxHeadingRadians(): number {
    const configuredDegrees = Math.max(0, finiteOr(STEERING_TUNING.maxHeading, 65));
    return Math.min(configuredDegrees, MAX_STEERING_HEADING_DEGREES) * DEG2RAD;
}

// Map a value into [0, modulo) with a proper positive remainder, used to read a
// cycle's phase (0..2π) out of a continuously accumulating cycle counter.
function positiveMod(value: number, modulo: number): number {
    if (modulo <= 0) {
        return 0;
    }
    return value - Math.floor(value / modulo) * modulo;
}

function strongerStrokeQuality(a: StrokeQualityResult | null, b: StrokeQualityResult | null): StrokeQualityResult | null {
    if (!a) {
        return b;
    }
    if (!b) {
        return a;
    }
    return a.strokeQuality >= b.strokeQuality ? a : b;
}

function strokeQualityFromReleaseProgress(progress: number): number {
    const p = clamp01(progress);
    const perfect = normalizedReleaseRange(STROKE_QUALITY_TUNING.perfectStart, STROKE_QUALITY_TUNING.perfectEnd);
    if (p >= perfect.start && p <= perfect.end) {
        return 1;
    }
    const good = normalizedReleaseRange(STROKE_QUALITY_TUNING.goodStart, STROKE_QUALITY_TUNING.goodEnd);
    if (p < good.start || p > good.end) {
        return 0;
    }
    // GOOD ramps up toward the nearest PERFECT edge, but remains below PERFECT.
    if (p < perfect.start) {
        const span = Math.max(0.001, perfect.start - good.start);
        return clamp01((p - good.start) / span) * 0.98;
    }
    if (p > perfect.end) {
        const span = Math.max(0.001, good.end - perfect.end);
        return clamp01((good.end - p) / span) * 0.98;
    }
    return 0.98;
}

function describeReleaseBadReason(releaseProgress: number, holdTimeValid: boolean, holdSeconds: number, minHoldSeconds: number): string {
    if (!holdTimeValid) {
        return `hold_too_short(${holdSeconds.toFixed(2)}<${minHoldSeconds.toFixed(2)})`;
    }
    if (releaseProgress < perfectReleaseCenter()) {
        return `released_early(${(releaseProgress * 100).toFixed(0)}%)`;
    }
    return `released_late(${(releaseProgress * 100).toFixed(0)}%)`;
}

function normalizedReleaseRange(startValue: number, endValue: number): { start: number; end: number } {
    return {
        start: clamp01(Math.min(startValue, endValue)),
        end: clamp01(Math.max(startValue, endValue)),
    };
}

function perfectReleaseCenter(): number {
    const perfect = normalizedReleaseRange(STROKE_QUALITY_TUNING.perfectStart, STROKE_QUALITY_TUNING.perfectEnd);
    return clamp01((perfect.start + perfect.end) * 0.5);
}

function ratingForGuideStrokeQuality(strokeQuality: number): Rating {
    if (strokeQuality >= 0.999) {
        return Rating.PERFECT;
    }
    if (strokeQuality > 0) {
        return Rating.GOOD;
    }
    return Rating.BAD;
}
