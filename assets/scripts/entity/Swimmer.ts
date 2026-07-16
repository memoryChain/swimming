import { _decorator, Component, Node, Tween, Vec3, tween } from 'cc';
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

@ccclass('Swimmer')
export class Swimmer extends Component {
    @property(CartoonSwimmerRig) public cartoonRig: CartoonSwimmerRig = null;
    @property public isAI = false;
    @property public swimmerName = 'Swimmer';

    private readonly _motor = new SwimmerMotor();
    private _startPosition = new Vec3();
    private _hasStartPosition = false;
    private _strokeQualityCombo = 0;    private _maxStrokeQualityCombo = 0;
    private _perfectStrokeQualityCount = 0;
    private _goodStrokeQualityCount = 0;
    private _missStrokeQualityCount = 0;
    private readonly _pendingRhythmResults: RhythmResult[] = [];
    private readonly _strokeMetrics = new StrokeMetrics();
    private readonly _pendingConditionInputs: StrokeConditionInput[] = [];
    private _courseLayout: RaceCourseLayout = DEFAULT_RACE_COURSE_LAYOUT;
    private readonly _phases = new SwimmerRacePhases(this);

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

    // Steering is a player-only comedy mechanic: enable it for the human swimmer
    // and clamp its lateral drift to the pool side walls (lane ropes have no
    // collision, so the whole pool width is traversable). AI opponents don't
    // steer by strokes; they get a smooth random weave so they also drift a bit
    // instead of tracking a robotically perfect straight line.
    private configureSteering() {
        this._motor.setSteeringEnabled(!this.isAI);
        if (this.isAI) {
            const base = Math.max(0, STEERING_TUNING.aiWobbleAmount);
            const variation = Math.max(0, STEERING_TUNING.aiWobbleVariation);
            const varied = base * (1 + (Math.random() * 2 - 1) * variation);
            this._motor.setAiSteeringWobble(Math.max(0, Math.min(1, varied)));
        }
        const halfWidth = Math.max(0, this._courseLayout.poolWidth * 0.5 - STEERING_TUNING.poolWallClearance);
        const laneZ = this._startPosition.z;
        this._motor.setLateralOffsetBounds(-halfWidth - laneZ, halfWidth - laneZ);
    }

    // Scale this AI's weave by its competitiveness: strong opponents (high
    // difficulty) swim almost straight, weak ones wander more. Called by the
    // competitor manager once each lane's difficulty is assigned.
    applyAiSteeringDifficulty(difficulty: number) {
        if (!this.isAI) {
            return;
        }
        const d = Math.max(0, Math.min(1, difficulty));
        const base = Math.max(0, STEERING_TUNING.aiWobbleAmount);
        const variation = Math.max(0, STEERING_TUNING.aiWobbleVariation);
        // (1 - d) * 2: a mid AI (d=0.5) weaves at the full base amount, a top AI
        // (d>=1) is basically straight, a weak AI (d<0.5) weaves even more.
        const skillFactor = Math.max(0, Math.min(1, (1 - d) * 2));
        const amount = base * skillFactor * (1 + (Math.random() * 2 - 1) * variation);
        this._motor.setAiSteeringWobble(Math.max(0, Math.min(1, amount)));
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

    update(dt: number) {
        if (!this._motor.isRacing) {
            return;
        }

        // Bullet-time: swimmer simulation + motion run on the scaled delta.
        dt = scaledDelta(dt);
        if (this._phases.tick(dt)) {
            return;
        }
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

    handleStrokeHeld(type: StrokeType, held: boolean): RhythmResult | null {
        if (this._phases.isFlipTurnActive) {
            return null;
        }
        if (this._phases.isDiveGlidePoseActive) {
            return null;
        }
        const strokeQualityResult = this._motor.setStrokeHeld(type, held);
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
        const active = this._motor.isActiveStrokeInPerfectZone(StrokeType.LEFT)
            || this._motor.isActiveStrokeInPerfectZone(StrokeType.RIGHT);
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
            this._perfectStrokeQualityCount += 1;
        } else if (rating === Rating.GOOD) {
            this._goodStrokeQualityCount += 1;
        } else {
            this._strokeQualityCombo = 0;
            this._missStrokeQualityCount += 1;
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
        const roll = this._phases.diveRecoveryLean() - headingDegrees * STEERING_TUNING.bankScale;
        this.node.setPosition(x, this._phases.visualSwimY(), z);
        this.node.setRotationFromEuler(0, yaw, roll);
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
