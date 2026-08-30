import { getRaceDistance, SWIMMER_BALANCE, DIVE_BALANCE } from '../core/GameBalance';
import { Rating, StrokeType } from '../core/GameConstants';
import { getRaceArmCycleSpeedScale, MOTION_TUNING, STROKE_QUALITY_TUNING } from '../core/InputTuning';
import { MAX_STEERING_HEADING_DEGREES, STEERING_TUNING } from '../core/SteeringTuning';
import { SwimPhysicsModel } from './SwimPhysicsModel';
import { SWIMMER_COLLISION } from '../entity/SwimmerCollisionResolver';
import type { PlayerBalanceOverrides } from '../progression/PlayerBalanceOverrides';
import { AxialRollModel } from './AxialRollModel';
import { CollisionPitchModel } from './CollisionPitchModel';
import { COLLISION_PITCH_TUNING } from '../core/CollisionPitchTuning';
import {
    DOLPHIN_JUMP_PROFILES,
    type DolphinJumpProfile,
} from '../core/DolphinJumpConfig';

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

type ReleaseRanges = { perfect: { start: number; end: number }; good: { start: number; end: number } };

export class SwimmerMotor {
    private readonly _physics = new SwimPhysicsModel();
    private readonly _axialRoll = new AxialRollModel();
    private readonly _collisionPitch = new CollisionPitchModel();
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
    private _playerBalance: PlayerBalanceOverrides | null = null;
    private _dolphinJumpProfile: DolphinJumpProfile = DOLPHIN_JUMP_PROFILES.lowPolyHuman2;
    private _conditionSpeedScale = 1;
    private _conditionQualityScale = 1;
    private _conditionCadenceScale = 1;
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
    // radians. A stroke injects yaw angular velocity, which survives release and
    // keeps bending the path until water drag or an opposite stroke removes it.
    private _heading = 0;
    private _headingTurnRate = 0;
    // Signed direction toward the pool interior while recovering from a side-wall
    // contact. The recovery drives the already-synced heading/turn-rate channels;
    // it adds no render-only state or per-frame allocation.
    private _poolWallRecoveryDirection = 0;
    private _courseDirection = 1;
    private _lateralOffset = 0;
    private _lateralOffsetMin = -1000;
    private _lateralOffsetMax = 1000;
    // Body weight for collision knockback (player from character def, AI from
    // competitor profile; default 1). Heavy bodies resist being shoved.
    private _weight = 1;
    // Decaying collision knockback, integrated into distance/lateralOffset each
    // frame (same channels nudgeDistance/setLateralOffset use). Stored in
    // distance-rate / lateral-rate space (m/s) so no per-frame direction
    // conversion is needed: the resolver folds each swimmer's lap direction
    // into the distance component at injection time.
    private _knockbackDistance = 0;
    private _knockbackLateral = 0;
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
        this._axialRoll.reset();
        this._collisionPitch.reset();
    }

    // Toggled by the Swimmer for post-dive and post-turn underwater glides.
    setGlidePhase(
        active: boolean,
        glideDrag = SWIMMER_BALANCE.glideDrag,
        preserveAxialBalance = false,
    ) {
        this._glidePhaseActive = active;
        this._glideDrag = active ? Math.max(0, glideDrag) : SWIMMER_BALANCE.glideDrag;
        if (active && !preserveAxialBalance) {
            this._axialRoll.reset();
        }
        if (active) {
            this._collisionPitch.reset();
        }
    }

    beginFlipTurnPhase() {
        // The flip turn is an input-locked movement phase. Discard any held or
        // queued stroke so it cannot resume halfway through the wall push.
        // A knockback impulse buffered just before the turn would freeze during
        // the scripted phase and jolt afterwards, so clear it here.
        this.clearKnockback();
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
        this._headingTurnRate = 0;
        this._poolWallRecoveryDirection = 0;
        this._axialRoll.reset();
        this._collisionPitch.reset();
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

    // Advance ONLY the limb animation cycles (arms/legs/body phase), leaving speed
    // and race distance untouched. Used by the dolphin-jump air phase, which drives
    // the swimmer's position from a scripted arc but still wants the freestyle
    // stroke to animate when the player inputs mid-air.
    advanceVisualAnimation(dt: number) {
        this._motionClock += dt;
        this._armAction = Math.max(0, this._armAction - dt * 4.6);
        this._kickAction = Math.max(0, this._kickAction - dt * 6.8);
        this.updateMotionCycles(dt, { isAI: false });
    }

    // Queue one visual arm-pull sweep (plus the contralateral leg kick) with no
    // propulsion, stroke-quality, or steering side effects. The dolphin-jump air
    // phase uses this so a mid-air stroke plays the normal in-water animation
    // without changing the scripted speed.
    queueVisualArmStroke(type: StrokeType) {
        if (type === StrokeType.RIGHT) {
            this.queueMotionCycle('_rightArmMotionRemaining');
        } else {
            this.queueMotionCycle('_leftArmMotionRemaining');
        }
        this.queueKickOnly(type);
        this._armAction = 1;
        this._kickAction = 1;
    }

    // End a scripted, presentation-only stroke sequence at a phase boundary.
    // Dolphin-jump air strokes are allowed to be mid-cycle at water entry, but
    // that partial phase must not become the origin of every later swim stroke.
    resetScriptedVisualMotion() {
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
        const perfect = this._effectiveReleaseRanges.perfect;
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
                (this._effectiveKickMaxSpeed - this._currentSpeed)
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
                maxSpeedOverride: this._playerBalance?.maxSpeed,
            },
        );
        this._currentAcceleration = dt > 0 ? (next.currentSpeed - this._currentSpeed) / dt : 0;
        this._currentSpeed = next.currentSpeed;
        this.decaySpeedCapBonus(dt, options);
        this.updateKickSteeringCorrection(dt, options);
        this.updateSteering(dt);
        // Advance the arm/action phase first so the torque sampled below belongs
        // to the exact pose rendered for this frame, not the previous frame's arm
        // position. Propulsion still settles after the physics step as before.
        this.updateMotionCycles(dt, options);
        this._axialRoll.update(
            dt,
            !this._glidePhaseActive,
            this.armCatchSupportForSide(StrokeType.LEFT),
            this.armCatchSupportForSide(StrokeType.RIGHT),
            this._kickCadenceHz,
        );
        this._collisionPitch.update(dt, !this._glidePhaseActive);
        const raceDistance = getRaceDistance();
        // Forward race progress uses only the along-lane component; veering with a
        // large heading is naturally slower (this is the whole steering cost).
        // Race distance is monotonic by contract. The steering hard cap keeps
        // cos(heading) positive; max(0, ...) is a second line of defence so even
        // corrupted runtime state can never make the swimmer turn back.
        const forwardSpeed = this._currentSpeed
            * Math.max(0, Math.cos(this._heading))
            * this._axialRoll.forwardScale
            * this._collisionPitch.forwardScale;
        this._distance = Math.min(raceDistance, this._distance + forwardSpeed * dt);
        // Lateral drift accumulates the sideways component, clamped to the pool.
        const requestedLateralOffset = this._lateralOffset + this._currentSpeed * Math.sin(this._heading) * dt;
        this._lateralOffset = clamp(requestedLateralOffset, this._lateralOffsetMin, this._lateralOffsetMax);
        const wallCorrection = this._lateralOffset - requestedLateralOffset;
        if (Math.abs(wallCorrection) > 1e-6) {
            this.returnToLaneFromPoolWall(wallCorrection);
        }
        this.integrateKnockback(dt, raceDistance);
        if (!options.isAI) {
            this.checkArmStrokeTimeout();
        }

        if (this._distance >= raceDistance) {
            this._isRacing = false;
            this.clearKnockback();
            return true;
        }
        return false;
    }

    private resetRaceState(initialDistance = 0) {
        this.clearKnockback();
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
        this._conditionCadenceScale = 1;
        this._lastStrokeQuality = 0;
        this._currentAcceleration = 0;
        this._kickCadenceHz = 0;
        this._lastKickTapClock = -1;
        this._heading = 0;
        this._headingTurnRate = 0;
        this._poolWallRecoveryDirection = 0;
        this._lateralOffset = 0;
        this._axialRoll.reset();
        this._collisionPitch.reset();
    }

    setConditionSpeedScale(scale: number) {
        this._conditionSpeedScale = clamp(scale, 0, 2);
    }

    setPlayerBalance(overrides: PlayerBalanceOverrides | null) {
        this._playerBalance = overrides;
        this._weight = overrides?.weight ?? 1;
    }

    setDolphinJumpProfile(profile: DolphinJumpProfile | null) {
        this._dolphinJumpProfile = profile ?? DOLPHIN_JUMP_PROFILES.lowPolyHuman2;
    }

    get dolphinJumpProfile(): DolphinJumpProfile {
        return this._dolphinJumpProfile;
    }

    // Burst-driven multiplier for the dolphin-jump launch speed. Reuses the same
    // ratio the dive uses (diveMaxLaunchSpeed / base), so a high-爆发力 / higher
    // level character launches farther. Returns 1 for swimmers without progression
    // overrides (AI), keeping opponents on the raw DOLPHIN_JUMP.launchSpeed.
    get dolphinLaunchSpeedScale(): number {
        const base = DIVE_BALANCE.maxLaunchSpeed;
        if (!this._playerBalance || !(base > 0)) {
            return 1;
        }
        return this._playerBalance.diveMaxLaunchSpeed / base;
    }

    private get _effectiveMaxSpeed(): number {
        return this._playerBalance?.maxSpeed ?? SWIMMER_BALANCE.maxSpeed;
    }

    private get _effectiveKickMaxSpeed(): number {
        return this._playerBalance?.kickMaxSpeed ?? SWIMMER_BALANCE.kickMaxSpeed;
    }

    private get _effectiveComboMaxOvercap(): number {
        return this._playerBalance?.perfectComboMaxOvercap ?? SWIMMER_BALANCE.perfectComboMaxOvercap;
    }

    private get _effectiveComboOvercapDecay(): number {
        // Intentionally not progression-overridable: the overcap AMOUNT scales
        // with character burst (see _effectiveComboMaxOvercap), but the DECAY rate
        // is a global physics constant shared by player and AI.
        return Math.max(0, SWIMMER_BALANCE.perfectComboOvercapDecay);
    }

    private get _effectiveStrokeQualityAccel(): number {
        return this._playerBalance?.strokeQualityAccel ?? SWIMMER_BALANCE.strokeQualityAccel;
    }

    // Quality-axis sweet-zone scaling: the heart-rate zone modifier widens or
    // narrows the PERFECT release window. Only PERFECT width is scaled (relative
    // to its center, clamped inside the GOOD window); GOOD stays fixed so the
    // invariant good.start <= perfect.start <= perfect.end <= good.end holds.
    private get _effectiveReleaseRanges(): ReleaseRanges {
        const strength = clamp01(STROKE_QUALITY_TUNING.qualityZoneScaleStrength);
        const scale = 1 + (clamp(this._conditionQualityScale, 0, 2) - 1) * strength;
        const perfectBase = normalizedReleaseRange(STROKE_QUALITY_TUNING.perfectStart, STROKE_QUALITY_TUNING.perfectEnd);
        const goodBase = normalizedReleaseRange(STROKE_QUALITY_TUNING.goodStart, STROKE_QUALITY_TUNING.goodEnd);
        const pCenter = (perfectBase.start + perfectBase.end) * 0.5;
        const pHalf = (perfectBase.end - perfectBase.start) * 0.5 * scale;
        return {
            perfect: {
                start: clamp(Math.max(goodBase.start, pCenter - pHalf), 0, 1),
                end: clamp(Math.min(goodBase.end, pCenter + pHalf), 0, 1),
            },
            good: goodBase,
        };
    }

    setConditionQualityScale(scale: number) {
        this._conditionQualityScale = clamp(scale, 0, 2);
    }

    setConditionCadenceScale(scale: number) {
        this._conditionCadenceScale = clamp(scale, 0.1, 2);
    }

    private decaySpeedCapBonus(dt: number, options: SwimmerMotorOptions) {
        if (this._speedCapBonus <= 0) {
            return;
        }
        const decay = Math.max(0, this._effectiveComboOvercapDecay) * Math.max(0, dt);
        const maxSpeed = this._effectiveMaxSpeed;
        const neededForCurrentSpeed = Math.max(0, this._currentSpeed - maxSpeed);
        const comboMax = Math.max(0, this._effectiveComboMaxOvercap);
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
        const ranges = this._effectiveReleaseRanges;
        const perfect = ranges.perfect;
        const good = ranges.good;
        const secondsSinceYellow = releasedAt - action.perfectGuidePresentedAt;
        const releasedJustAfterVisiblePerfect = releaseProgress > perfect.end
            && releaseProgress <= Math.min(good.end, perfect.end + 0.03)
            && action.perfectGuidePresentedAt >= 0
            && secondsSinceYellow >= 0
            && secondsSinceYellow <= Math.max(0, STROKE_QUALITY_TUNING.perfectVisualReleaseGraceSeconds);
        const strokeQuality = holdTimeValid
            ? (releasedJustAfterVisiblePerfect ? 1 : strokeQualityFromReleaseProgress(releaseProgress, ranges))
            : 0;
        const badReason = strokeQuality <= 0
            ? describeReleaseBadReason(releaseProgress, holdTimeValid, holdSeconds, minHoldSeconds, ranges)
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
        const qualityAccel = Math.max(0, strokeQuality) * this._effectiveStrokeQualityAccel * this._conditionSpeedScale;
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
        const center = perfectReleaseCenter(this._effectiveReleaseRanges);
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
        return CYCLE_AMOUNT * getRaceArmCycleSpeedScale() * this._conditionCadenceScale * lerp(
            STROKE_QUALITY_TUNING.armCycleLowSpeedPerSecond,
            STROKE_QUALITY_TUNING.armCycleHighSpeedPerSecond,
            t,
        );
    }

    private speedRatio(): number {
        const ms = this._effectiveMaxSpeed; return ms > 0 ? clamp01(this._currentSpeed / ms) : 0;
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
        return maxHeading > 0 ? clamp(this._heading / maxHeading, -1, 1) : 0;
    }

    // The stroke side whose steering nudge pulls the heading back toward straight.
    // Depends on lap direction and whether axial roll has mirrored the swimmer's
    // anatomical left/right in world space. When already straight either side
    // works; returns the alternation-neutral LEFT.
    correctiveStrokeSide(): StrokeType {
        const steeringSignal = Math.abs(this._heading) > 1e-4
            ? this._heading
            : this._headingTurnRate;
        const targetSign = steeringSignal >= 0 ? 1 : -1;
        const rollSign = this.axialSteeringProjection() >= 0 ? 1 : -1;
        const leftDirSign = (this._courseDirection >= 0 ? 1 : -1) * rollSign;
        // We want a stroke whose angular impulse opposes the current bend.
        return leftDirSign === -targetSign ? StrokeType.LEFT : StrokeType.RIGHT;
    }

    get heading(): number {
        return this._heading;
    }

    get headingTurnRate(): number {
        return this._headingTurnRate;
    }

    get axialRollRadians(): number {
        return this._axialRoll.angleRadians;
    }

    get axialRollAngularVelocity(): number {
        return this._axialRoll.angularVelocityRadians;
    }

    get axialStableAngleRadians(): number {
        return this._axialRoll.stableAngleRadians;
    }

    // Presentation-only direction for the arm circle. The physical input/action
    // phase remains unchanged; once the powered roll settles into the supine basin,
    // the authored freestyle circle must play backward to read as backstroke.
    get visualArmCycleDirection(): number {
        return Math.abs(this._axialRoll.angleRadians) > Math.PI * 0.5 ? -1 : 1;
    }

    get collisionPitchRadians(): number {
        return this._collisionPitch.angleRadians;
    }

    get collisionPitchAngularVelocity(): number {
        return this._collisionPitch.angularVelocityRadians;
    }

    // Scripted dolphin phases sample collision impulses while their path owns the
    // root transform. The rates remain in the same race-distance/lateral axes used
    // by normal knockback, so the phase can inherit them without allocating a
    // temporary vector or converting through world space.
    get collisionKnockbackDistanceRate(): number {
        return this._knockbackDistance;
    }

    get collisionKnockbackLateralRate(): number {
        return this._knockbackLateral;
    }

    clearDolphinImpactCarry() {
        this.clearKnockback();
        this._axialRoll.reset();
        this._collisionPitch.reset();
    }

    get permitsUprightTreadWater(): boolean {
        return this._axialRoll.permitsUprightTreadWater
            && this._collisionPitch.permitsUprightTreadWater;
    }

    restoreAxialBalance(angleRadians: number) {
        this._axialRoll.setState(angleRadians, 0);
    }

    // Hand the remaining collision pose back from a scripted deep-dive route once
    // surface collision has already been restored. This prevents a late contact in
    // the final ascent from snapping upright on the completion frame.
    restoreDolphinCollisionState(
        axialAngleRadians: number,
        axialAngularVelocity: number,
        pitchAngleRadians: number,
        pitchAngularVelocity: number,
    ) {
        this._axialRoll.setState(axialAngleRadians, axialAngularVelocity);
        this._collisionPitch.correct(pitchAngleRadians, pitchAngularVelocity, 1);
    }

    // NETWORKED RACE: correct the periodic roll state and its continuous inertia.
    correctAxialRoll(targetAngle: number, targetAngularVelocity: number, blend: number) {
        if (!this._isRacing) {
            return;
        }
        this._axialRoll.correct(targetAngle, targetAngularVelocity, blend);
    }

    restoreCollisionPitch() {
        this._collisionPitch.reset();
    }

    correctCollisionPitch(targetAngle: number, targetAngularVelocity: number, blend: number) {
        if (!this._isRacing) {
            return;
        }
        this._collisionPitch.correct(targetAngle, targetAngularVelocity, blend);
    }

    // NETWORKED RACE: correct both heading and persistent angular velocity.
    correctHeading(targetHeading: number, targetTurnRate: number, blend: number) {
        const max = safeMaxHeadingRadians();
        const t = clamp(finiteOr(targetHeading, 0), -max, max);
        const useBlend = clamp(blend, 0, 1);
        this._heading = clamp(finiteOr(this._heading + (t - this._heading) * useBlend, 0), -max, max);
        const maxRate = safeMaxTurnRateRadians();
        const targetRate = clamp(finiteOr(targetTurnRate, 0), -maxRate, maxRate);
        this._headingTurnRate = clamp(
            finiteOr(this._headingTurnRate + (targetRate - this._headingTurnRate) * useBlend, 0),
            -maxRate,
            maxRate,
        );
    }

    get lateralOffset(): number {
        return this._lateralOffset;
    }

    setLateralOffset(offset: number) {
        this._lateralOffset = clamp(offset, this._lateralOffsetMin, this._lateralOffsetMax);
    }

    // Start a critically damped recovery toward a small inward escape angle.
    // Cancelling outward angular velocity immediately prevents continued pressure
    // into the wall; the wall-only speed cap and target brake prevent overshoot.
    returnToLaneFromPoolWall(inwardDirection: number) {
        const inwardSign = inwardDirection >= 0 ? 1 : -1;
        const escapeHeading = safePoolWallEscapeHeadingRadians();
        const inwardHeading = this._heading * inwardSign;
        const inwardTurnRate = this._headingTurnRate * inwardSign;

        // Already facing far enough inward: only cancel curvature that would turn
        // back into the wall. Do not override intentional inward player steering.
        if (inwardHeading >= escapeHeading) {
            if (inwardTurnRate < 0) {
                this._headingTurnRate = 0;
            }
            this._poolWallRecoveryDirection = 0;
            return;
        }

        const wallMaxRate = safePoolWallMaxTurnRateRadians();
        const correctionRate = Math.max(0, finiteOr(STEERING_TUNING.poolWallHeadingCorrectionRate, 0));
        if (wallMaxRate <= 0 || correctionRate <= 0) {
            // A zero value disables automatic recovery. Still discard outward
            // curvature while preserving player-generated inward steering so an
            // intentionally disabled helper cannot trap the swimmer at the wall.
            this._headingTurnRate = inwardSign * Math.max(0, inwardTurnRate);
            this._poolWallRecoveryDirection = 0;
            return;
        }
        const requiredRate = (escapeHeading - inwardHeading) * correctionRate;
        this._headingTurnRate = inwardSign * Math.min(
            wallMaxRate,
            Math.max(0, inwardTurnRate, requiredRate),
        );
        this._poolWallRecoveryDirection = inwardSign;
    }

    // Shift race progress by a small amount (used by swimmer-vs-swimmer collision
    // to push bodies apart along the swim axis). Clamped to the race bounds.
    nudgeDistance(delta: number) {
        this._distance = Math.max(0, Math.min(getRaceDistance(), this._distance + delta));
    }
    get weight(): number {
        return this._weight;
    }

    setWeight(weight: number) {
        this._weight = Math.max(0.1, weight);
    }

    // Add a decaying collision impulse (distance-rate + lateral-rate, m/s) to the
    // knockback buffer. Capped so a multi-body pile-up can't explode the slide.
    applyCollisionImpulse(distRate: number, latRate: number) {
        if (!SWIMMER_COLLISION.knockbackEnabled) {
            return;
        }
        const cap = SWIMMER_COLLISION.knockbackMaxImpulse;
        this._knockbackDistance = clamp(this._knockbackDistance + distRate, -cap, cap);
        this._knockbackLateral = clamp(this._knockbackLateral + latRate, -cap, cap);
    }

    applyCollisionAxialImpulse(angularVelocityDeltaRadians: number) {
        if (!this._isRacing || this._glidePhaseActive || SWIMMER_COLLISION.axialRollEnabled < 0.5) {
            return;
        }
        this._axialRoll.applyAngularImpulse(angularVelocityDeltaRadians);
    }

    applyCollisionPitchImpulse(angularVelocityDeltaRadians: number) {
        if (!this._isRacing || this._glidePhaseActive || COLLISION_PITCH_TUNING.enabled < 0.5) {
            return;
        }
        this._collisionPitch.applyAngularImpulse(angularVelocityDeltaRadians);
    }

    clearKnockback() {
        this._knockbackDistance = 0;
        this._knockbackLateral = 0;
    }

    // Integrate the decaying knockback into distance/lateralOffset (same channels
    // nudgeDistance/setLateralOffset use), then exponentially decay the buffer.
    private integrateKnockback(dt: number, raceDistance: number) {
        if (this._knockbackDistance === 0 && this._knockbackLateral === 0) {
            return;
        }
        if (this._knockbackDistance !== 0) {
            this._distance = Math.max(0, Math.min(raceDistance, this._distance + this._knockbackDistance * dt));
        }
        if (this._knockbackLateral !== 0) {
            this._lateralOffset = clamp(
                this._lateralOffset + this._knockbackLateral * dt,
                this._lateralOffsetMin,
                this._lateralOffsetMax,
            );
        }
        const decay = Math.exp(-dt / Math.max(0.01, SWIMMER_COLLISION.knockbackDecaySeconds));
        this._knockbackDistance *= decay;
        this._knockbackLateral *= decay;
        if (Math.abs(this._knockbackDistance) < 0.01) {
            this._knockbackDistance = 0;
        }
        if (Math.abs(this._knockbackLateral) < 0.01) {
            this._knockbackLateral = 0;
        }
    }

    // Integrate persistent yaw angular velocity. A released stroke therefore keeps
    // bending the path; water drag slowly relaxes curvature instead of freezing the
    // swimmer onto a fixed diagonal.
    private updateSteering(dt: number) {
        const maxHeading = safeMaxHeadingRadians();
        this._heading = clamp(finiteOr(this._heading, 0), -maxHeading, maxHeading);
        const maxRate = safeMaxTurnRateRadians();
        this._headingTurnRate = clamp(finiteOr(this._headingTurnRate, 0), -maxRate, maxRate);
        const step = Math.max(0, dt);
        this.updatePoolWallRecovery(step);
        this._heading += this._headingTurnRate * step;
        this.finishPoolWallRecoveryIfReady();
        if (this._heading >= maxHeading) {
            this._heading = maxHeading;
            if (this._headingTurnRate > 0) {
                this._headingTurnRate = 0;
            }
        } else if (this._heading <= -maxHeading) {
            this._heading = -maxHeading;
            if (this._headingTurnRate < 0) {
                this._headingTurnRate = 0;
            }
        }
        const drag = Math.max(0, finiteOr(STEERING_TUNING.turnAngularDrag, 0));
        this._headingTurnRate *= Math.exp(-drag * step);
        if (Math.abs(this._headingTurnRate) < 1e-5) {
            this._headingTurnRate = 0;
        }
    }

    private updatePoolWallRecovery(step: number) {
        const inwardSign = this._poolWallRecoveryDirection;
        if (inwardSign === 0 || step <= 0) {
            return;
        }
        const correctionRate = Math.max(0, finiteOr(STEERING_TUNING.poolWallHeadingCorrectionRate, 0));
        if (correctionRate <= 0) {
            this._poolWallRecoveryDirection = 0;
            return;
        }
        const target = inwardSign * safePoolWallEscapeHeadingRadians();
        const angularAcceleration = (target - this._heading) * correctionRate * correctionRate
            - this._headingTurnRate * correctionRate * 2;
        const wallMaxRate = safePoolWallMaxTurnRateRadians();
        this._headingTurnRate = clamp(
            this._headingTurnRate + angularAcceleration * step,
            -wallMaxRate,
            wallMaxRate,
        );
    }

    private finishPoolWallRecoveryIfReady() {
        const inwardSign = this._poolWallRecoveryDirection;
        if (inwardSign === 0) {
            return;
        }
        const target = inwardSign * safePoolWallEscapeHeadingRadians();
        const remaining = (target - this._heading) * inwardSign;
        const reachedTarget = remaining <= 0;
        const settledNearTarget = remaining <= 0.5 * DEG2RAD
            && Math.abs(this._headingTurnRate) <= 2 * DEG2RAD;
        if (!reachedTarget && !settledNearTarget) {
            return;
        }
        this._heading = target;
        this._headingTurnRate = 0;
        this._poolWallRecoveryDirection = 0;
    }

    // Optional damped recovery spring toward the lane axis. It defaults to zero,
    // so normal kicking does not erase the persistent S-curve momentum.
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
        if (correctionRate <= 0) {
            return;
        }
        const step = Math.max(0, dt);
        const angularAccel = -this._heading * correctionRate * correctionRate
            - this._headingTurnRate * correctionRate * 2;
        const maxRate = safeMaxTurnRateRadians();
        this._headingTurnRate = clamp(
            this._headingTurnRate + angularAccel * step,
            -maxRate,
            maxRate,
        );
    }

    // Effective underwater pull for one arm, aligned to the authored freestyle
    // contact window. Torque eases in just before the visible catch, stays full
    // through the main pull, then releases with the hand exit. Keeping the curve in
    // deterministic motor phase space avoids sampling render bones in gameplay.
    private armCatchSupportForSide(type: StrokeType): number {
        const action = type === StrokeType.LEFT ? this._leftActions[0] : this._rightActions[0];
        if (!action || action.startedAt < 0) {
            return 0;
        }
        const progress = clamp01(action.progress / CYCLE_AMOUNT);
        return smoothPulse01(progress, 0.36, 0.46, 0.78, 0.92);
    }

    // A settled arm stroke injects yaw angular velocity. The velocity survives hand
    // release and keeps rotating heading, so the path remains curved. Opposite strokes
    // subtract/reverse that velocity; same-instant opposite strokes cancel exactly.
    // The sign is flipped by lap direction and continuously projected through the
    // current axial roll: it fades to zero side-on, then reverses after capsizing.
    // powerFactor (0..1) scales the turn by how hard/long the stroke was pulled.
    private applyStrokeSteering(type: StrokeType, powerFactor: number) {
        if (!this._steeringEnabled) {
            return;
        }
        const minFactor = clamp01(STEERING_TUNING.turnPowerMinFactor);
        const factor = minFactor + (1 - minFactor) * clamp01(powerFactor);
        const turnImpulse = Math.max(0, finiteOr(STEERING_TUNING.turnAngularImpulse, 0))
            * DEG2RAD
            * factor;
        const dir = (type === StrokeType.LEFT ? 1 : -1) * this._courseDirection;
        const signedImpulse = dir * turnImpulse * this.axialSteeringProjection();
        const maxRate = safeMaxTurnRateRadians();
        this._headingTurnRate = clamp(
            finiteOr(this._headingTurnRate, 0) + signedImpulse,
            -maxRate,
            maxRate,
        );
    }

    // Anatomical left/right projected onto the pool's horizontal plane. cos(roll)
    // gives +1 prone, 0 on either side, and -1 inverted, so steering changes side
    // without a discontinuous sign switch at the 90-degree tipping point.
    private axialSteeringProjection(): number {
        return Math.cos(this._axialRoll.angleRadians);
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
        return ratingForGuideStrokeQuality(strokeQualityFromReleaseProgress(progress, this._effectiveReleaseRanges));
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

function smoothPulse01(value: number, start: number, fullStart: number, fullEnd: number, end: number): number {
    const v = clamp01(value);
    if (v <= start || v >= end) {
        return 0;
    }
    if (v < fullStart) {
        return smoothRange01(v, start, fullStart);
    }
    if (v <= fullEnd) {
        return 1;
    }
    return 1 - smoothRange01(v, fullEnd, end);
}

function smoothRange01(value: number, start: number, end: number): number {
    const t = clamp01((value - start) / Math.max(0.0001, end - start));
    return t * t * (3 - 2 * t);
}

function finiteOr(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function safeMaxHeadingRadians(): number {
    const configuredDegrees = Math.max(0, finiteOr(STEERING_TUNING.maxHeading, 65));
    return Math.min(configuredDegrees, MAX_STEERING_HEADING_DEGREES) * DEG2RAD;
}

function safeMaxTurnRateRadians(): number {
    return Math.max(0, finiteOr(STEERING_TUNING.maxTurnRate, 95)) * DEG2RAD;
}

function safePoolWallMaxTurnRateRadians(): number {
    const configured = Math.max(0, finiteOr(STEERING_TUNING.poolWallMaxTurnRate, 48)) * DEG2RAD;
    return Math.min(configured, safeMaxTurnRateRadians());
}

function safePoolWallEscapeHeadingRadians(): number {
    const configured = Math.max(0, finiteOr(STEERING_TUNING.poolWallEscapeHeadingDegrees, 10)) * DEG2RAD;
    return Math.min(configured, safeMaxHeadingRadians());
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

function strokeQualityFromReleaseProgress(progress: number, ranges: ReleaseRanges): number {
    const p = clamp01(progress);
    const perfect = ranges.perfect;
    if (p >= perfect.start && p <= perfect.end) {
        return 1;
    }
    const good = ranges.good;
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

function describeReleaseBadReason(releaseProgress: number, holdTimeValid: boolean, holdSeconds: number, minHoldSeconds: number, ranges: ReleaseRanges): string {
    if (!holdTimeValid) {
        return `hold_too_short(${holdSeconds.toFixed(2)}<${minHoldSeconds.toFixed(2)})`;
    }
    if (releaseProgress < perfectReleaseCenter(ranges)) {
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

function perfectReleaseCenter(ranges: ReleaseRanges): number {
    return clamp01((ranges.perfect.start + ranges.perfect.end) * 0.5);
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
