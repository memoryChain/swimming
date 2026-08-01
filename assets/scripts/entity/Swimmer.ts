import { _decorator, Component, Node, Quat, Tween, Vec3, tween } from 'cc';
import { SWIMMER_ACTION_TUNING } from '../character/CharacterMotionTuning';
import type { CharacterAction } from '../character/CharacterActionConfig';
import {
    Rating,
    StrokeType,
} from '../core/GameConstants';
import { DIVE_BALANCE, SWIMMER_BALANCE, getRaceDistance } from '../core/GameBalance';
import { STEERING_TUNING } from '../core/SteeringTuning';
import type { RhythmResult, RhythmStats } from '../core/RhythmTypes';
import { DiveEntryStyle, DiveResult } from '../core/DiveResult';
import { StrokeMetrics } from '../swimmer/StrokeMetrics';
import { StrokeConditionInput } from '../condition/ConditionTypes';
import { ratingForStrokeQuality, rhythmResultFromStrokeQuality } from '../core/StrokeQualityScoring';
import { scaledDelta } from '../core/TimeScale';
import { StrokeQualityResult, StrokeTimingGuide, SwimmerMotor } from '../swimmer/SwimmerMotor';
import {
    DEFAULT_RACE_COURSE_LAYOUT,
    RaceCourseLayout,
} from '../venue/RaceCourseLayout';
import { CartoonSwimmerRig } from './CartoonSwimmerRig';
import { SwimmerRacePhases } from './SwimmerRacePhases';

const { ccclass, property } = _decorator;
const PERFECT_COMBO_IDLE_SECONDS = 1;
// Scratch vector for net-race render interpolation (avoids per-frame allocation on
// the WeChat Mini Game heap).
const _tmpNetLerpPos = new Vec3();
// After a large position correction (catch-up SNAP), suppress this swimmer's collisions
// for this long — a collision push would fight the snap. When positions are well-synced
// (only small eased corrections, no snap), collisions stay on.
const NET_CATCHUP_COLLISION_SUPPRESS_MS = 400;

@ccclass('Swimmer')
export class Swimmer extends Component {
    @property(CartoonSwimmerRig) public cartoonRig: CartoonSwimmerRig = null;
    @property public isAI = false;
    @property public swimmerName = 'Swimmer';

    private readonly _motor = new SwimmerMotor();
    private _startPosition = new Vec3();
    private _hasStartPosition = false;
    private _strokeQualityCombo = 0;    private _maxStrokeQualityCombo = 0;
    private _perfectComboIdleSeconds = 0;
    private _perfectStrokeQualityCount = 0;
    private _goodStrokeQualityCount = 0;
    private _missStrokeQualityCount = 0;
    private readonly _pendingRhythmResults: RhythmResult[] = [];
    private readonly _strokeMetrics = new StrokeMetrics();
    private readonly _pendingConditionInputs: StrokeConditionInput[] = [];
    private _courseLayout: RaceCourseLayout = DEFAULT_RACE_COURSE_LAYOUT;
    private readonly _phases = new SwimmerRacePhases(this);
    private readonly _swimBoundaryWorldPositions = [
        new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(),
        new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(),
    ];
    private readonly _tmpCourseRotation = new Quat();
    private _lateralMinWorld = Number.NEGATIVE_INFINITY;
    private _lateralMaxWorld = Number.POSITIVE_INFINITY;
    // Internal accessors for the race-phase controller (SwimmerRacePhases).
    get motor(): SwimmerMotor {
        return this._motor;
    }

    get courseLayout(): RaceCourseLayout {
        return this._courseLayout;
    }

    get startPosition(): Vec3 {
        return this._startPosition;
    }

    // True while this swimmer should take part in swimmer-vs-swimmer collision:
    // racing, on-screen, and not in a phase (flip turn / dive-underwater glide)
    // that scripts its own position and race distance. See
    // entity/SwimmerCollisionResolver.ts.
    get isCollisionActive(): boolean {
        return this._motor.isRacing
            && this.node.active
            && !this._phases.isFlipTurnActive
            && !this._phases.isUnderwater;
    }

    // Displace the swimmer by (pushX, pushZ) world metres to resolve a collision.
    // Bodies are impassable, so both axes move: Z via the motor lateral offset
    // (clamped to the pool walls) and X via race distance (X is derived from
    // distance, so nudging distance is the only push that survives the next
    // frame). Both mutate the motor so the separation persists, and the node is
    // repositioned for same-frame consistency.
    applyCollisionPush(pushX: number, pushZ: number) {
        if (Math.abs(pushZ) > 1e-6) {
            this._motor.setLateralOffset(this._motor.lateralOffset + pushZ);
        }
        if (Math.abs(pushX) > 1e-6) {
            const direction = this._courseLayout.finishDirectionAtDistance(this._motor.distance);
            this._motor.nudgeDistance(pushX * direction);
        }
        const visualDistance = Math.min(this._motor.distance, getRaceDistance());
        const x = this._courseLayout.clampSwimWorldX(this._courseLayout.distanceToWorldX(visualDistance));
        const pos = this.node.position;
        this.node.setPosition(x, pos.y, this._startPosition.z + this._motor.lateralOffset);
    }

    // Flash the body red for a moment when bumping into another swimmer.
    flashCollision() {
        this.cartoonRig?.flashCollision();
    }

    // NETWORKED RACE ONLY: lateral offset for authoritative position snapshots.
    get netLateralOffset(): number {
        return this._motor.lateralOffset;
    }

    // NETWORKED RACE ONLY: steering heading (radians) for authoritative snapshots.
    get netHeading(): number {
        return this._motor.heading;
    }

    // NETWORKED RACE ONLY: ease this swimmer's steering heading toward the host's
    // authoritative value so its facing/steering matches on every client.
    applyNetHeading(targetHeading: number, blend: number) {
        if (!this._motor.isRacing) {
            return;
        }
        this._motor.correctHeading(targetHeading, blend);
    }

    // NETWORKED RACE ONLY: keep this swimmer just short of the finish wall. Used on the
    // client for remote/AI swimmers until the host's authoritative snapshot reports them
    // finished, so a client can't latch a finish (finishes are latched) that the host
    // never had — which would make the two ends disagree on the final placement.
    holdBeforeFinishLine() {
        if (!this._motor.isRacing) {
            return;
        }
        const cap = getRaceDistance() - 0.03;
        if (this._motor.distance > cap) {
            this._motor.nudgeDistance(cap - this._motor.distance);
        }
    }

    // NETWORKED RACE ONLY (host-authoritative sync): nudge this swimmer's race
    // progress + lane offset toward the host's authoritative values. Small errors
    // ease smoothly; large errors (e.g. after a collision the host resolved
    // differently) snap so clients converge quickly. The swimmer's own update()
    // repositions the node from the corrected motor state, so we only touch the motor.
    applyNetCorrection(targetDistance: number, targetLateral: number, distanceBlend: number, lateralBlend: number) {
        if (!this._motor.isRacing) {
            return;
        }
        const errD = targetDistance - this._motor.distance;
        const snappedD = Math.abs(errD) > 3;
        if (snappedD) {
            this._motor.nudgeDistance(errD);
        } else if (Math.abs(errD) > 1e-3) {
            this._motor.nudgeDistance(errD * distanceBlend);
        }
        const curLateral = this._motor.lateralOffset;
        const errL = targetLateral - curLateral;
        const snappedL = Math.abs(errL) > 1;
        if (snappedL) {
            this._motor.setLateralOffset(targetLateral);
        } else if (Math.abs(errL) > 1e-4) {
            this._motor.setLateralOffset(curLateral + errL * lateralBlend);
        }
        // A snap means this swimmer is teleporting to catch up to its authoritative
        // position; suppress its collisions briefly so a collision push can't fight it.
        if (snappedD || snappedL) {
            this._netSnappedAtMs = Date.now();
        }
    }

    // NETWORKED RACE: true briefly after a large catch-up snap. While catching up the
    // swimmer is jumping toward its authoritative position, so it is excluded from
    // collision resolution (a push would fight the snap). When positions are well-synced
    // (only small eased corrections) this stays false and collisions apply normally.
    get netCatchingUp(): boolean {
        return Date.now() - this._netSnappedAtMs < NET_CATCHUP_COLLISION_SUPPRESS_MS;
    }

    start() {
        this.captureStartPosition();
    }

    configureCourse(courseLayout: RaceCourseLayout) {
        this._courseLayout = courseLayout;
        this._startPosition = this._courseLayout.swimPosition(0, this.node.position.z);
        this._hasStartPosition = true;
        this.node.setPosition(this._startPosition);
        this.cartoonRig?.setWaterY(this._courseLayout.waterY);
        this.configureSteering();
    }

    // Steering is a shared mechanic: enable it for player AND AI (the AI drives
    // it through the same stroke path, only choosing which side to stroke). Clamp
    // lateral drift to the pool side walls (lane ropes have no collision, so the
    // whole pool width is traversable).
    private configureSteering() {
        this._motor.setSteeringEnabled(true);
        const halfWidth = Math.max(0, this._courseLayout.poolWidth * 0.5 - STEERING_TUNING.poolWallClearance);
        this.setLateralWorldBounds(-halfWidth, halfWidth);
    }

    setLaneLockdownBounds(safeMinZ: number, safeMaxZ: number) {
        this.setLateralWorldBounds(safeMinZ, safeMaxZ);
    }

    clearLaneLockdownBounds() {
        const halfWidth = Math.max(0, this._courseLayout.poolWidth * 0.5 - STEERING_TUNING.poolWallClearance);
        this.setLateralWorldBounds(-halfWidth, halfWidth);
    }

    swimBoundaryZRange() {
        const count = this.cartoonRig?.getSwimBoundaryWorldPositions(this._swimBoundaryWorldPositions) ?? 0;
        if (count <= 0) {
            return { min: this.node.position.z - 0.9, max: this.node.position.z + 0.9 };
        }
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < count; index++) {
            const z = this._swimBoundaryWorldPositions[index].z;
            min = Math.min(min, z);
            max = Math.max(max, z);
        }
        return { min, max };
    }

    eliminate() {
        this.stopRace();
        this.node.active = false;
    }

    // NETWORKED RACE: whether the motor is racing (for the stuck-dive redundancy check).
    get isNetRacing(): boolean {
        return this._motor.isRacing;
    }

    // NETWORKED RACE redundancy: force a remote copy straight into racing at a distance
    // when its dive was lost/failed or got stuck mid-tween but its owner's authoritative
    // position keeps advancing. Cancels any half-finished dive tween and skips the
    // (already-missed) dive animation; the position correction then keeps it in sync.
    forceEnterRaceAt(distance: number): void {
        if (this._motor.isRacing) {
            return;
        }
        Tween.stopAllByTarget(this.node);
        this.startRace(Math.max(0, distance));
    }

    // Signed steering heading as a fraction of maxHeading (-1..1). The AI reads
    // this to sense how far off course it is.
    get steeringHeadingRatio(): number {
        return this._motor.steeringHeadingRatio;
    }

    // The stroke side that pulls the heading back toward straight (lap-aware).
    correctiveStrokeSide(): StrokeType {
        return this._motor.correctiveStrokeSide();
    }

    startRace(initialDistance = 0, initialSpeed = SWIMMER_BALANCE.baseSpeed, fromDiveEntry = false) {
        this.captureStartPosition();
        this._phases.clearFlipTurnPhase(true);
        if (fromDiveEntry) {
            this._phases.startDiveUnderwaterPhase();
        } else {
            this._phases.clearDiveUnderwaterPhase();
        }
        const maxSpeed = SWIMMER_BALANCE.maxSpeed;
        const initialSpeedCapBonus = Math.max(0, initialSpeed - maxSpeed);
        this._motor.startRace(initialDistance, initialSpeed, initialSpeedCapBonus);
        this.cartoonRig?.setPerfectGlowActive(false);
        this.applyCoursePosition(initialDistance);
        this.cartoonRig?.setDiveReady(false);
        if (fromDiveEntry) {
            this.cartoonRig?.setDiveStreamlinePose();
        } else {
            this.resetPose();
            this.cartoonRig?.setActiveSwimming(true);
        }
    }

    prepareDive() {
        this.captureStartPosition();
        Tween.stopAllByTarget(this.node);
        this._motor.reset();
        this.cartoonRig?.setPerfectGlowActive(false);
        this._phases.clearDiveUnderwaterPhase();
        this.node.setPosition(this.divePlatformPosition());
        this.node.setRotationFromEuler(0, this._courseLayout.direction > 0 ? 0 : 180, 0);
        // Preserve the currently displayed procedural pose so the rig can blend
        // from showcase standing into dive-ready instead of snapping via base pose.
        this.resetPose(true);
        this.cartoonRig?.setDiveReady(true);
    }

    prepareShowcaseStanding() {
        this.captureStartPosition();
        Tween.stopAllByTarget(this.node);
        this._motor.reset();
        this.cartoonRig?.setPerfectGlowActive(false);
        this._phases.clearDiveUnderwaterPhase();
        this.node.setPosition(this.divePlatformPosition());
        this.node.setRotationFromEuler(0, this._courseLayout.direction > 0 ? 0 : 180, 0);
        this.resetPose();
        this.cartoonRig?.setActiveSwimming(false);
        this.cartoonRig?.setShowcaseStanding();
    }

    setShowcaseAction(action: CharacterAction): boolean {
        return this.cartoonRig?.setShowcaseAction(action) ?? false;
    }

    performDive(result: DiveResult): number {
        this.captureStartPosition();
        const divePower = result.power;
        const launchSpeed = result.launchSpeed;
        const crouchDuration = lerp(SWIMMER_ACTION_TUNING.diveCrouchSecondsMax, SWIMMER_ACTION_TUNING.diveCrouchSecondsMin, divePower);
        const direction = this._courseLayout.direction;
        const start = this.divePlatformPosition();
        const launchStart = new Vec3(
            start.x - SWIMMER_ACTION_TUNING.diveCrouchBackOffset * direction,
            start.y - SWIMMER_ACTION_TUNING.diveCrouchDrop,
            start.z,
        );
        const entryY = this._courseLayout.swimY - SWIMMER_ACTION_TUNING.diveEntryDepth;
        const launchAngle = degreesToRadians(DIVE_BALANCE.launchAngleDegrees);
        const horizontalSpeed = launchSpeed * Math.cos(launchAngle);
        const verticalSpeed = launchSpeed * Math.sin(launchAngle);
        const projectileFlightDuration = projectileTimeToY(launchStart.y, entryY, verticalSpeed, DIVE_BALANCE.launchGravity);
        const distance = horizontalSpeed * projectileFlightDuration;
        const entry = this._courseLayout.entryPosition(distance, this._startPosition.z);
        entry.y = entryY;
        const poseTransitionDuration = projectileFlightDuration * SWIMMER_ACTION_TUNING.diveExtensionRatio;
        const launchDelayDuration = poseTransitionDuration * SWIMMER_ACTION_TUNING.diveLaunchDelayRatio;
        const totalDuration = crouchDuration + launchDelayDuration + projectileFlightDuration;

        Tween.stopAllByTarget(this.node);
        this.node.setPosition(start);
        this.node.setRotationFromEuler(0, direction > 0 ? 0 : 180, 0);
        this.cartoonRig?.setDiveReady(true);
        tween(this.node)
            .to(crouchDuration, {
                position: launchStart,
                eulerAngles: new Vec3(0, direction > 0 ? 0 : 180, -5),
            }, { easing: 'quadIn' })
            .call(() => {
                this.cartoonRig?.startDiveStreamlineTransition(poseTransitionDuration);
            })
            .delay(launchDelayDuration)
            .to(projectileFlightDuration, {}, {
                onUpdate: (_target?: Node, ratio = 0) => {
                    this.applyDiveProjectile(launchStart, horizontalSpeed, verticalSpeed, DIVE_BALANCE.launchGravity, direction, ratio, projectileFlightDuration);
                },
            })
            .call(() => {
                this._phases.setDiveEntryLean(this.diveProjectileLean(horizontalSpeed, verticalSpeed, DIVE_BALANCE.launchGravity, projectileFlightDuration));
                this.applyDiveProjectile(launchStart, horizontalSpeed, verticalSpeed, DIVE_BALANCE.launchGravity, direction, 1, projectileFlightDuration);
                this.cartoonRig?.setDiveStreamlinePose();
                this.startRace(distance, horizontalSpeed, true);
                this.flashSplash(splashRatingForEntryStyle(result.entryStyle));
            })
            .start();

        return totalDuration;
    }

    private applyDiveProjectile(start: Vec3, horizontalSpeed: number, verticalSpeed: number, gravity: number, direction: number, ratio: number, duration: number) {
        const t = Math.max(0, Math.min(1, ratio));
        const seconds = duration * t;
        const x = start.x + horizontalSpeed * seconds * direction;
        const y = start.y + verticalSpeed * seconds - gravity * seconds * seconds * 0.5;
        const lean = this.diveProjectileLean(horizontalSpeed, verticalSpeed, gravity, seconds);
        this.node.setPosition(x, y, start.z);
        this.node.setRotationFromEuler(0, direction > 0 ? 0 : 180, lean);
    }

    private diveProjectileLean(horizontalSpeed: number, verticalSpeed: number, gravity: number, seconds: number): number {
        return radiansToDegrees(Math.atan2(verticalSpeed - gravity * seconds, horizontalSpeed));
    }

    stopRace() {
        Tween.stopAllByTarget(this.node);
        this._phases.clearFlipTurnPhase(true);
        this._motor.stopRace();
        this._phases.clearDiveUnderwaterPhase();
        this.cartoonRig?.setActiveSwimming(false);
        this.cartoonRig?.setPerfectGlowActive(false);
    }

    // NETWORKED RACE ONLY: when true this swimmer is stepped in deterministic fixed
    // steps by the net driver (used for AI, which have no network input and the same
    // seed, so a fixed step makes them identical across clients without correction).
    // The engine update() then skips it. Defaults false → single-player / players run
    // on the normal engine dt.
    public netFixedStep = false;

    // --- Networked-race render interpolation (position only) ---------------------
    // The net sim advances in FIXED 33ms steps (30/s) but we render at 45fps, so a
    // net-driven body's forward glide would visibly step. We smooth ONLY the root
    // translation by lerping between the last two step positions each render frame.
    // Rotation/pose stay at step cadence: their stepping is far less visible, and
    // interpolating rotation would spin the body across the 180° flip-turn / finish
    // snaps. Cost per body/frame: one Vec3.lerp + setPosition (net-mode only, ~7 bodies,
    // no allocation) — negligible for WeChat. Player + single-player never use this.
    private readonly _netLerpFrom = new Vec3();
    private readonly _netLerpTo = new Vec3();
    private _netLerpReady = false;
    // Wall-clock ms of the last catch-up SNAP (large position correction); collisions are
    // suppressed for NET_CATCHUP_COLLISION_SUPPRESS_MS after it.
    private _netSnappedAtMs = 0;

    // Called by the net driver right BEFORE a fixed step: carry the last step target
    // forward as the new interpolation origin.
    netStepBegin() {
        if (!this._netLerpReady) {
            this._netLerpTo.set(this.node.position);
            this._netLerpReady = true;
        }
        this._netLerpFrom.set(this._netLerpTo);
    }

    // Called right AFTER a fixed step: capture the fresh authoritative position.
    netStepEnd() {
        this._netLerpTo.set(this.node.position);
    }

    // Called every render frame with the step-phase fraction f∈[0,1]: show the tween
    // position so the 30/s sim renders smoothly at 45fps. No-op unless racing so the
    // authoritative position stands during dives/turns/finish.
    netRenderLerp(f: number) {
        if (!this._netLerpReady || !this._motor.isRacing) {
            return;
        }
        const t = f < 0 ? 0 : f > 1 ? 1 : f;
        Vec3.lerp(_tmpNetLerpPos, this._netLerpFrom, this._netLerpTo, t);
        this.node.setPosition(_tmpNetLerpPos);
    }

    update(dt: number) {
        // Fixed-step (AI in a net race): stepped by the net driver instead of here.
        if (this.netFixedStep) {
            return;
        }
        this.stepSimulation(scaledDelta(dt));
    }

    // One simulation step. Single-player: engine-driven on variable (bullet-time
    // scaled) dt. Networked race: fixed-step (NET_SIM_STEP) from the deterministic
    // net driver. `dt` is already the final step length (scaling applied by caller).
    stepSimulation(dt: number) {
        if (!this._motor.isRacing) {
            return;
        }
        if (this._phases.tick(dt)) {
            return;
        }
        this.updatePerfectComboIdle(dt);
        const finished = this._motor.update(dt, {
            isAI: this.isAI,
        });
        this.updatePerfectZoneGlow();
        if (!this.isAI) {
            this._strokeMetrics.update(dt);
        }
        this._phases.updateDiveUnderwaterTimer(dt);
        this.applyCoursePosition(this._motor.distance);
        this.updateBodyMotion(dt);
        this.enforcePoolWallBoundary();
        for (const strokeQualityResult of this._motor.consumeStrokeQualityResults()) {
            const result = this.makeStrokeQualityResult(strokeQualityResult.type, strokeQualityResult);
            if (result) {
                this._pendingRhythmResults.push(result);
                this.flashSplash(result.rating);
            }
        }

        if (finished) {
            this.node.emit('swimmer-finished', this);
        }
    }

    handleStroke(type: StrokeType): RhythmResult | null {
        if (!this._motor.isRacing) {
            return null;
        }
        if (this._phases.isFlipTurnActive) {
            // Keep the complete pose sequence input-locked, including the
            // keyframe-2-to-swim recovery blend.
            return null;
        }
        if (this._phases.isDiveGlidePoseActive) {
            // Player presses already kick on key/touch down. AI input enters here
            // directly, so register the same cadence-based underwater kick.
            const recorded = this.isAI ? this._motor.recordKickTap(type) : false;
            if (recorded) {
                this.cartoonRig?.triggerKick();
            }
            return null;
        }

        const queued = this._motor.recordStroke(type);
        if (!queued) {
            return null;
        }
        if (!this.isAI) {
            this._strokeMetrics.recordStroke(type);
        }
        this.playStroke(type, Rating.GOOD);
        return null;
    }

    canAcceptStroke(type: StrokeType): boolean {
        if (!this._motor.isRacing) {
            return false;
        }
        if (this._phases.isFlipTurnActive) {
            return false;
        }
        return this._phases.isDiveGlidePoseActive || this._motor.canRecordStroke(type);
    }

    handleKickStroke(type: StrokeType): void {
        if (!this._motor.isRacing) {
            return;
        }
        if (this._phases.isFlipTurnActive) {
            return;
        }
        if (this._phases.isDiveGlidePoseActive) {
            const recorded = this._motor.recordKickTap(type);
            if (recorded) {
                this.cartoonRig?.triggerKick();
            }
            return;
        }
        if (this._motor.recordKickTap(type)) {
            this.cartoonRig?.triggerKick();
        }
    }

    handleStrokeHeld(type: StrokeType, held: boolean, preHeldSeconds = 0): RhythmResult | null {
        if (this._phases.isFlipTurnActive) {
            return null;
        }
        if (this._phases.isDiveGlidePoseActive) {
            return null;
        }
        const strokeQualityResult = this._motor.setStrokeHeld(type, held, preHeldSeconds);
        this.cartoonRig?.setStrokeHeld(type, held);
        this.updatePerfectZoneGlow();
        if (held) {
            if (!this.isAI) {
                this._strokeMetrics.recordStroke(type);
            }
            return null;
        }
        // A press too short to be a real stroke was reinterpreted as a leg-kick
        // tap by the motor: play a kick, don't surface a miss rating.
        if (strokeQualityResult?.downgradedToKick) {
            this.cartoonRig?.triggerKick();
            return null;
        }
        return this.makeStrokeQualityResult(type, strokeQualityResult);
    }

    setSplashCulled(culled: boolean) {
        this.cartoonRig?.setSplashCulled(culled);
    }

    setMotionThrottleStride(stride: number) {
        this.cartoonRig?.setMotionThrottleStride(stride);
    }

    setSplashParticlesEnabled(enabled: boolean) {
        this.cartoonRig?.setSplashParticlesEnabled(enabled);
    }

    setBodyFeedbackEnabled(enabled: boolean) {
        this.cartoonRig?.setBodyFeedbackEnabled(enabled);
    }

    // Release progress (0..1) of the AI's active arm stroke on a side, or -1 when
    // none is active. The simulated-input AI polls this to time its release the
    // same way a player watches the on-screen pull. Drives nothing on its own.
    aiActiveStrokeProgress(type: StrokeType): number {
        return this._motor.activeStrokeReleaseProgress(type);
    }

    playFinishRagdoll() {
        this.playFinishTouch();
    }

    playFinishTouch() {
        const finishPosition = this.node.position.clone();
        const direction = this._courseLayout.finishDirectionAtDistance(getRaceDistance());
        const inwardDirection = -direction;
        Tween.stopAllByTarget(this.node);
        this._motor.stopRace();
        this.cartoonRig?.setPerfectGlowActive(false);
        this.node.setRotationFromEuler(0, inwardDirection > 0 ? 0 : 180, 0);
        this.cartoonRig?.setFinishFloating();
        const x = this.finishFloatX(direction);
        this.node.setPosition(x, finishPosition.y + 0.01, finishPosition.z);
    }

    reset() {
        this.captureStartPosition();
        Tween.stopAllByTarget(this.node);
        this._phases.clearFlipTurnPhase(true);
        this._motor.reset();
        this._phases.clearDiveUnderwaterPhase();
        this._strokeQualityCombo = 0;
        this._maxStrokeQualityCombo = 0;
        this._perfectComboIdleSeconds = 0;
        this._perfectStrokeQualityCount = 0;
        this._goodStrokeQualityCount = 0;
        this._missStrokeQualityCount = 0;
        this._pendingRhythmResults.length = 0;
        this._pendingConditionInputs.length = 0;
        this._strokeMetrics.reset();
        this.node.setPosition(this.divePlatformPosition());
        this.node.setRotationFromEuler(0, this._courseLayout.direction > 0 ? 0 : 180, 0);
        this.resetPose();
        this.cartoonRig?.setActiveSwimming(false);
        this.cartoonRig?.setDiveReady(true);
        this.cartoonRig?.setPerfectGlowActive(false);
    }

    presentStanding(position: Vec3, facingY: number) {
        Tween.stopAllByTarget(this.node);
        this._motor.reset();
        this._phases.clearDiveUnderwaterPhase();
        this.node.setPosition(position);
        this.node.setRotationFromEuler(0, facingY, 0);
        this.resetPose();
        this.cartoonRig?.setActiveSwimming(false);
        this.cartoonRig?.setShowcaseStanding();
        this.cartoonRig?.setPerfectGlowActive(false);
    }

    private updatePerfectZoneGlow() {
        if (this.isAI) {
            return;
        }
        const leftHeld = this._motor.isActiveStrokeHeld(StrokeType.LEFT);
        const rightHeld = this._motor.isActiveStrokeHeld(StrokeType.RIGHT);
        const leftPerfect = leftHeld && this._motor.isActiveStrokeInPerfectZone(StrokeType.LEFT);
        const rightPerfect = rightHeld && this._motor.isActiveStrokeInPerfectZone(StrokeType.RIGHT);
        // The body is a shared guide for both hands. If both are held, yellow is
        // only truthful when releasing either one would currently score PERFECT.
        const active = (leftHeld || rightHeld)
            && (!leftHeld || leftPerfect)
            && (!rightHeld || rightPerfect);
        if (active) {
            if (leftHeld) {
                this._motor.markPerfectGuidePresented(StrokeType.LEFT);
            }
            if (rightHeld) {
                this._motor.markPerfectGuidePresented(StrokeType.RIGHT);
            }
        }
        this.cartoonRig?.setPerfectGlowActive(active);
    }

    private playStroke(type: StrokeType, rating: Rating) {
        this.cartoonRig?.triggerStroke(type);
        this.flashSplash(rating);
    }

    private makeStrokeQualityResult(type: StrokeType, strokeQualityResult: StrokeQualityResult | null): RhythmResult | null {
        if (!strokeQualityResult) {
            return null;
        }
        const rating = ratingForStrokeQuality(strokeQualityResult.strokeQuality);
        if (rating === Rating.PERFECT) {
            this._strokeQualityCombo += 1;
            this._perfectComboIdleSeconds = 0;
            this._perfectStrokeQualityCount += 1;
        } else {
            this._strokeQualityCombo = 0;
            this._perfectComboIdleSeconds = 0;
            if (rating === Rating.GOOD) {
                this._goodStrokeQualityCount += 1;
            } else {
                this._missStrokeQualityCount += 1;
            }
        }
        this._maxStrokeQualityCombo = Math.max(this._maxStrokeQualityCombo, this._strokeQualityCombo);
        if (!this.isAI) {
            this._pendingConditionInputs.push({
                strokeAccepted: true,
                qualityScore: strokeQualityResult.strokeQuality,
                pressureScore: this._strokeMetrics.effortScore,
                dt: 0,
            });
        }
        const result = rhythmResultFromStrokeQuality(strokeQualityResult, this._strokeQualityCombo);
        return result;
    }

    private updatePerfectComboIdle(dt: number) {
        if (this._strokeQualityCombo <= 0) {
            return;
        }
        const holdingArmStroke = this._motor.isActiveStrokeHeld(StrokeType.LEFT)
            || this._motor.isActiveStrokeHeld(StrokeType.RIGHT);
        if (holdingArmStroke) {
            return;
        }
        this._perfectComboIdleSeconds += Math.max(0, dt);
        if (this._perfectComboIdleSeconds >= PERFECT_COMBO_IDLE_SECONDS) {
            this._strokeQualityCombo = 0;
            this._perfectComboIdleSeconds = 0;
        }
    }

    updateBodyMotion(dt: number) {
        if (!this.cartoonRig) {
            return;
        }
        if (this._phases.isDiveGlidePoseActive) {
            this.cartoonRig.setLegSplashSuppressed(true);
            this.cartoonRig.updateUnderwaterKickFromMotor(dt, this._motor, this.raceDirection);
        } else {
            this.cartoonRig.setLegSplashSuppressed(false);
            this.cartoonRig.updateFreestyleFromMotor(dt, this._motor, this.raceDirection);
        }
    }

    private flashSplash(rating: Rating) {
        const scale = rating === Rating.PERFECT ? 1.15 : rating === Rating.BAD ? 0.55 : 0.85;
        this.cartoonRig?.triggerSplashBurst(scale);
    }

    private resetPose(preserveCartoonPose = false) {
        if (!preserveCartoonPose) {
            this.cartoonRig?.resetPose();
        }
    }

    private captureStartPosition() {
        if (this._hasStartPosition) {
            return;
        }
        this._startPosition = this._courseLayout.swimPosition(0, this.node.position.z);
        this.node.setPosition(this._startPosition);
        this._hasStartPosition = true;
    }

    private divePlatformPosition(): Vec3 {
        return this._courseLayout.platformStandingPosition(this._startPosition.z);
    }

    private applyCoursePosition(distance: number) {
        const visualDistance = Math.min(distance, getRaceDistance());
        const direction = this._courseLayout.finishDirectionAtDistance(visualDistance);
        this._motor.setCourseDirection(direction);
        const x = this._courseLayout.clampSwimWorldX(this._courseLayout.distanceToWorldX(visualDistance));
        // Lateral steering drift (player only; AI keeps 0). Yaw the whole body to
        // face the direction it is actually travelling, and bank slightly into it.
        const z = this._startPosition.z + this._motor.lateralOffset;
        const headingDegrees = this._motor.heading * 180 / Math.PI;
        const baseYaw = direction > 0 ? 0 : 180;
        const yaw = baseYaw - direction * headingDegrees;
        // Compose the orientation as explicit quaternion steps instead of one
        // setRotationFromEuler call: feeding a large steering yaw together with
        // the dive-recovery pitch into a single Euler conversion gimbal-couples
        // them and tilts the body's forward axis far out of horizontal. Here we
        // yaw about world up, then apply the dive-recovery pitch about the body's
        // lateral axis.
        const pitch = this._phases.diveRecoveryLean();
        const deg2rad = Math.PI / 180;
        Quat.fromEuler(this._tmpCourseRotation, 0, yaw, 0);
        Quat.rotateZ(this._tmpCourseRotation, this._tmpCourseRotation, pitch * deg2rad);
        this.node.setPosition(x, this._phases.visualSwimY(), z);
        this.node.setRotation(this._tmpCourseRotation);
    }

    // Root-only clamping is insufficient once the swimmer yaws: the long body
    // axis and animated arms project sideways and can cross the pool wall while
    // the root is still inside. Sample the current pose and shift the root just
    // enough to keep every boundary joint inside both walls.
    private enforcePoolWallBoundary() {
        const bounds = this.swimBoundaryZRange();
        const minZ = bounds.min;
        const maxZ = bounds.max;
        let correctionZ = 0;
        if (minZ < this._lateralMinWorld) {
            correctionZ = this._lateralMinWorld - minZ;
        }
        if (maxZ + correctionZ > this._lateralMaxWorld) {
            correctionZ += this._lateralMaxWorld - (maxZ + correctionZ);
        }
        if (Math.abs(correctionZ) <= 1e-5) {
            return;
        }

        this._motor.setLateralOffset(this._motor.lateralOffset + correctionZ);
        this._motor.returnToLaneFromPoolWall();
        this.node.setPosition(
            this.node.position.x,
            this.node.position.y,
            this._startPosition.z + this._motor.lateralOffset,
        );
    }

    private setLateralWorldBounds(minZ: number, maxZ: number) {
        this._lateralMinWorld = Math.min(minZ, maxZ);
        this._lateralMaxWorld = Math.max(minZ, maxZ);
        this._motor.setLateralOffsetBounds(
            this._lateralMinWorld - this._startPosition.z,
            this._lateralMaxWorld - this._startPosition.z,
        );
    }

    private finishFloatX(direction: number): number {
        const edgeX = direction > 0 ? this._courseLayout.poolFinishX : this._courseLayout.poolStartX;
        const poolMinX = Math.min(this._courseLayout.poolStartX, this._courseLayout.poolFinishX);
        const poolMaxX = Math.max(this._courseLayout.poolStartX, this._courseLayout.poolFinishX);
        const nearEdgeX = edgeX - direction * SWIMMER_ACTION_TUNING.finishFloatPoolEdgeClearance;
        const swimEdgeX = direction > 0
            ? Math.max(this._courseLayout.startX, this._courseLayout.finishX)
            : Math.min(this._courseLayout.startX, this._courseLayout.finishX);
        const closerThanSwimEdgeX = direction > 0
            ? Math.max(swimEdgeX, nearEdgeX)
            : Math.min(swimEdgeX, nearEdgeX);
        return Math.max(poolMinX, Math.min(poolMaxX, closerThanSwimEdgeX));
    }

    get currentSpeed(): number {
        return this._motor.currentSpeed;
    }

    // Splash effect root, owned by the rig. Exposed so the refraction overlay can
    // keep the splash nodes on the swimmer layer alongside the body.
    get splashNode(): Node | null {
        return this.cartoonRig?.splashNode ?? null;
    }

    get isUnderwater(): boolean {
        return this._phases.isUnderwater;
    }

    // Sustained limb effort (0..1), used by the flow layer to read sprint intent.
    get effortScore(): number {
        return this._strokeMetrics.effortScore;
    }

    get kickCadenceHz(): number {
        return this._motor.kickCadenceHz;
    }

    get isArmStrokeActive(): boolean {
        return this._motor.isArmStrokeActive;
    }

    get swimWorldY(): number {
        return this._courseLayout.swimY;
    }

    get waterWorldY(): number {
        return this._courseLayout.waterY;
    }

    get actionCycleSeconds(): number {
        return this._motor.actionCycleSeconds;
    }

    get strokeTimingGuide(): StrokeTimingGuide {
        return this._motor.strokeTimingGuide;
    }

    strokeTimingGuideForSide(type: StrokeType): StrokeTimingGuide {
        return this._motor.strokeTimingGuideForSide(type);
    }

    get distance(): number {
        return this._motor.distance;
    }

    get raceDirection(): number {
        return this._courseLayout.directionAtDistance(this._motor.distance);
    }

    // Radians away from the current lane direction. Combined with raceDirection,
    // this is the swimmer's actual world-space movement direction.
    get movementHeading(): number {
        return this._motor.heading;
    }

    getCameraUpperBodyWorldPosition(out: Vec3): Vec3 {
        if (this.cartoonRig?.getUpperBodyWorldPosition(out)) {
            return out;
        }
        out.set(this.node.worldPosition);
        out.y += 0.54;
        return out;
    }

    get isRacing(): boolean {
        return this._motor.isRacing;
    }

    get isFlipTurning(): boolean {
        return this._phases.isFlipTurnActive;
    }

    get isFlipTurnCameraActive(): boolean {
        return this._phases.isFlipTurnCameraActive;
    }

    get rhythmStats(): RhythmStats {
        return {
            maxCombo: this._maxStrokeQualityCombo,
            perfectCount: this._perfectStrokeQualityCount,
            goodCount: this._goodStrokeQualityCount,
            missCount: this._missStrokeQualityCount,
        };
    }

    applyConditionSpeedScale(scale: number) {
        this._motor.setConditionSpeedScale(scale);
    }

    applyConditionQualityScale(scale: number) {
        this._motor.setConditionQualityScale(scale);
    }

    consumeConditionInputs(): StrokeConditionInput[] {
        if (this._pendingConditionInputs.length === 0) {
            return [];
        }
        return this._pendingConditionInputs.splice(0);
    }

    consumeRhythmResults(): RhythmResult[] {
        if (this._pendingRhythmResults.length === 0) {
            return [];
        }
        return this._pendingRhythmResults.splice(0);
    }
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function degreesToRadians(degrees: number): number {
    return degrees * Math.PI / 180;
}

function radiansToDegrees(radians: number): number {
    return radians * 180 / Math.PI;
}

function projectileTimeToY(startY: number, targetY: number, initialVerticalSpeed: number, gravity: number): number {
    const drop = startY - targetY;
    const safeGravity = Math.max(0.01, gravity);
    return Math.max(0.01, (initialVerticalSpeed + Math.sqrt(initialVerticalSpeed * initialVerticalSpeed + 2 * safeGravity * drop)) / safeGravity);
}

function splashRatingForEntryStyle(style: DiveEntryStyle): Rating {
    if (style === DiveEntryStyle.CLEAN) {
        return Rating.PERFECT;
    }
    if (style === DiveEntryStyle.NORMAL) {
        return Rating.GOOD;
    }
    return Rating.BAD;
}
