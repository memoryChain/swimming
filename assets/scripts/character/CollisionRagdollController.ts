import { COLLISION_RAGDOLL_TUNING } from './CollisionRagdollTuning';

const RAD2DEG = 180 / Math.PI;
const TAU = Math.PI * 2;

// Engine-independent, allocation-free presentation state. The controller never
// writes gameplay state; CartoonSwimmerRig samples these scalar outputs after the
// normal freestyle pose has already been built.
export class CollisionRagdollController {
    private _stableSeed = 1;
    private _phaseLeftArm = 0;
    private _phaseRightArm = 0;
    private _phaseLeftLeg = 0;
    private _phaseRightLeg = 0;
    private _leftArmScale = 1;
    private _rightArmScale = 1;
    private _leftLegScale = 1;
    private _rightLegScale = 1;

    private _triggerTime = Number.NEGATIVE_INFINITY;
    private _minimumActiveUntil = Number.NEGATIVE_INFINITY;
    private _lastUpdateTime = Number.NaN;
    private _impactStrength = 0;
    private _impactRollSign = 1;
    private _impactPitchSign = 1;
    private _impactPhase = 0;
    private _snapshotRetriggerEnabled = true;
    private _weight = 0;
    private _curlWeight = 0;
    private _hasVelocitySample = false;
    private _lastRollVelocity = 0;
    private _lastPitchVelocity = 0;

    private _leftArmSwing = 0;
    private _rightArmSwing = 0;
    private _leftForearmSwing = 0;
    private _rightForearmSwing = 0;
    private _leftElbowBend = 0;
    private _rightElbowBend = 0;
    private _leftLegSwing = 0;
    private _rightLegSwing = 0;
    private _leftCalfSwing = 0;
    private _rightCalfSwing = 0;
    private _leftKneeBend = 0;
    private _rightKneeBend = 0;
    private _spinePitch = 0;
    private _spineRoll = 0;
    private _headPitch = 0;
    private _headRoll = 0;

    constructor() {
        this.setStableSeed(1);
    }

    setStableSeed(seed: number) {
        const next = Number.isFinite(seed) ? Math.trunc(seed) : 1;
        if (next === this._stableSeed && this._phaseRightArm !== 0) {
            return;
        }
        this._stableSeed = next || 1;
        this._phaseLeftArm = unitHash(this._stableSeed, 11) * TAU;
        this._phaseRightArm = unitHash(this._stableSeed, 23) * TAU;
        this._phaseLeftLeg = unitHash(this._stableSeed, 37) * TAU;
        this._phaseRightLeg = unitHash(this._stableSeed, 53) * TAU;
        this._leftArmScale = 0.84 + unitHash(this._stableSeed, 67) * 0.30;
        this._rightArmScale = 0.84 + unitHash(this._stableSeed, 79) * 0.30;
        this._leftLegScale = 0.86 + unitHash(this._stableSeed, 97) * 0.24;
        this._rightLegScale = 0.86 + unitHash(this._stableSeed, 109) * 0.24;
    }

    setSnapshotRetriggerEnabled(enabled: boolean) {
        this._snapshotRetriggerEnabled = enabled;
    }

    trigger(
        absoluteTime: number,
        linearImpulseMagnitude: number,
        axialVelocityDeltaRadians: number,
        pitchVelocityDeltaRadians: number,
    ): boolean {
        if (COLLISION_RAGDOLL_TUNING.enabled < 0.5) {
            return false;
        }
        const time = finite(absoluteTime);
        const angularDegrees = Math.hypot(
            finite(axialVelocityDeltaRadians),
            finite(pitchVelocityDeltaRadians),
        ) * RAD2DEG;
        const angularStrength = angularDegrees
            / Math.max(1, finite(COLLISION_RAGDOLL_TUNING.fullAngularSpeedDegrees));
        const linearStrength = Math.max(0, finite(linearImpulseMagnitude))
            / Math.max(0.01, finite(COLLISION_RAGDOLL_TUNING.linearImpulseForFullReaction));
        const strength = clamp01(Math.max(angularStrength, linearStrength));
        if (strength <= 0) {
            return false;
        }

        const frequency = Math.max(0.1, finite(COLLISION_RAGDOLL_TUNING.swingFrequencyHz));
        return this.beginReaction(
            time,
            strength,
            stableSign(axialVelocityDeltaRadians, this._stableSeed, 131),
            stableSign(pitchVelocityDeltaRadians, this._stableSeed, 149),
            positiveModulo(time * frequency * TAU, TAU),
        );
    }

    triggerSynchronized(
        absoluteTime: number,
        eventAgeSeconds: number,
        normalizedStrength: number,
        rollSign: number,
        pitchSign: number,
        impactPhase: number,
    ): boolean {
        if (COLLISION_RAGDOLL_TUNING.enabled < 0.5) {
            return false;
        }
        const maximum = Math.max(
            0.01,
            finite(COLLISION_RAGDOLL_TUNING.maximumReactionSeconds),
        );
        const age = clamp(finite(eventAgeSeconds), 0, maximum);
        const strength = clamp01(normalizedStrength);
        if (strength <= 0 || age >= maximum) {
            return false;
        }
        return this.beginReaction(
            finite(absoluteTime) - age,
            strength,
            finite(rollSign) >= 0 ? 1 : -1,
            finite(pitchSign) >= 0 ? 1 : -1,
            positiveModulo(finite(impactPhase), TAU),
        );
    }

    private beginReaction(
        time: number,
        strength: number,
        rollSign: number,
        pitchSign: number,
        impactPhase: number,
    ): boolean {

        // Preserve only the still-visible portion of an older reaction. Without
        // this, a tiny follow-up contact could reset the clock and revive the
        // full strength of a collision that had already almost faded out.
        const retainedImpactStrength = this._impactStrength * this.reactionFade(time);
        this._triggerTime = time;
        this._minimumActiveUntil = time + Math.max(
            0,
            finite(COLLISION_RAGDOLL_TUNING.minimumReactionSeconds),
        );
        this._impactStrength = Math.max(retainedImpactStrength, strength);
        this._impactRollSign = rollSign;
        this._impactPitchSign = pitchSign;
        this._impactPhase = impactPhase;
        this._weight = Math.max(this._weight, strength * 0.4);
        this._lastUpdateTime = time;
        return true;
    }

    update(
        absoluteTime: number,
        axialRollVelocityRadians: number,
        collisionPitchVelocityRadians: number,
        allowed: boolean,
    ) {
        const time = finite(absoluteTime);
        const rollVelocity = finite(axialRollVelocityRadians);
        const pitchVelocity = finite(collisionPitchVelocityRadians);

        if (COLLISION_RAGDOLL_TUNING.enabled < 0.5) {
            this.clearReaction();
            this._lastUpdateTime = time;
            this._lastRollVelocity = rollVelocity;
            this._lastPitchVelocity = pitchVelocity;
            this._hasVelocitySample = true;
            return;
        }
        if (!allowed) {
            this.decaySuppressed(time);
            this._lastRollVelocity = rollVelocity;
            this._lastPitchVelocity = pitchVelocity;
            this._hasVelocitySample = true;
            return;
        }

        const dt = Number.isFinite(this._lastUpdateTime)
            ? Math.max(0, time - this._lastUpdateTime)
            : 0;
        if (this._snapshotRetriggerEnabled
            && this._hasVelocitySample
            && dt <= Math.max(0.01, finite(COLLISION_RAGDOLL_TUNING.snapshotRetriggerMaxGapSeconds))) {
            // Pitch is collision-only; axial roll can also come from an ordinary
            // same-side stroke. Restrict snapshot recovery to pitch so a delayed
            // remote stroke correction cannot masquerade as a collision event.
            const pitchVelocityJumpDegrees = Math.abs(
                pitchVelocity - this._lastPitchVelocity,
            ) * RAD2DEG;
            if (pitchVelocityJumpDegrees >= Math.max(
                1,
                finite(COLLISION_RAGDOLL_TUNING.snapshotRetriggerDeltaDegrees),
            )) {
                this.trigger(
                    time,
                    0,
                    rollVelocity - this._lastRollVelocity,
                    pitchVelocity - this._lastPitchVelocity,
                );
            }
        }
        this._lastRollVelocity = rollVelocity;
        this._lastPitchVelocity = pitchVelocity;
        this._hasVelocitySample = true;

        this._lastUpdateTime = time;

        const angularSpeedDegrees = Math.hypot(rollVelocity, pitchVelocity) * RAD2DEG;
        const enter = Math.max(0, finite(COLLISION_RAGDOLL_TUNING.enterAngularSpeedDegrees));
        const full = Math.max(enter + 0.01, finite(COLLISION_RAGDOLL_TUNING.fullAngularSpeedDegrees));
        const motionStrength = smoothStep(clamp01((angularSpeedDegrees - enter) / (full - enter)));
        const reactionLatched = time <= this._minimumActiveUntil
            || this._impactStrength > 0.001
            || this._weight > 0.001;
        const reactionFade = this.reactionFade(time);
        const target = reactionLatched
            ? Math.max(motionStrength, this._impactStrength) * reactionFade
            : 0;

        if (target >= this._weight) {
            const attack = 1 - Math.exp(-Math.max(0, dt) * 18);
            this._weight += (target - this._weight) * attack;
        } else {
            const recovery = Math.max(0.01, finite(COLLISION_RAGDOLL_TUNING.recoverySeconds));
            this._weight *= Math.exp(-Math.max(0, dt) / recovery);
            if (this._weight < target) {
                this._weight = target;
            }
        }
        // reactionFade contains the forced exit window, so the presentation
        // cannot lag behind it and remain visibly folded after the deadline.
        this._weight = Math.min(clamp01(this._weight), reactionFade);

        const curlSeconds = Math.max(0.01, finite(COLLISION_RAGDOLL_TUNING.impactCurlSeconds));
        const curlProgress = clamp01((time - this._triggerTime) / curlSeconds);
        this._curlWeight = time >= this._triggerTime && curlProgress < 1
            ? Math.sin(curlProgress * Math.PI) * this._impactStrength
            : 0;

        if (this._weight <= 0.001 && target <= 0.001) {
            this.clearReaction();
            return;
        }

        this.samplePose(time, rollVelocity, pitchVelocity);
    }

    reset() {
        this.clearReaction();
        this._lastUpdateTime = Number.NaN;
        this._hasVelocitySample = false;
        this._lastRollVelocity = 0;
        this._lastPitchVelocity = 0;
    }

    private decaySuppressed(time: number) {
        const dt = Number.isFinite(this._lastUpdateTime)
            ? Math.max(0, time - this._lastUpdateTime)
            : 0;
        this._lastUpdateTime = time;
        const recovery = Math.max(0.01, finite(COLLISION_RAGDOLL_TUNING.recoverySeconds));
        const decay = Math.exp(-dt / recovery);
        this._weight *= decay;
        this._impactStrength *= decay;
        this._curlWeight = 0;
        if (this._weight <= 0.001 && this._impactStrength <= 0.001) {
            this.clearReaction();
        }
    }

    private reactionFade(time: number): number {
        const elapsed = time - this._triggerTime;
        if (elapsed < 0) {
            return 0;
        }
        const hold = Math.max(0.01, finite(COLLISION_RAGDOLL_TUNING.minimumReactionSeconds));
        if (elapsed <= hold) {
            return 1;
        }
        const recovery = Math.max(0.01, finite(COLLISION_RAGDOLL_TUNING.recoverySeconds));
        const maximum = Math.max(
            hold + 0.01,
            finite(COLLISION_RAGDOLL_TUNING.maximumReactionSeconds),
        );
        if (elapsed >= maximum) {
            return 0;
        }
        const forcedExitWindow = Math.min(recovery, maximum - hold);
        const forcedExit = smoothStep(clamp01(
            (maximum - elapsed) / Math.max(0.01, forcedExitWindow),
        ));
        return Math.exp(-(elapsed - hold) / recovery) * forcedExit;
    }

    private samplePose(time: number, rollVelocity: number, pitchVelocity: number) {
        const tuning = COLLISION_RAGDOLL_TUNING;
        const frequency = Math.max(0.1, finite(tuning.swingFrequencyHz));
        const armSwingDegrees = Math.max(0, finite(tuning.armSwingDegrees));
        const forearmSwingDegrees = Math.max(0, finite(tuning.forearmSwingDegrees));
        const elbowBendDegrees = Math.max(0, finite(tuning.elbowBendDegrees));
        const legSwingDegrees = Math.max(0, finite(tuning.legSwingDegrees));
        const calfSwingDegrees = Math.max(0, finite(tuning.calfSwingDegrees));
        const kneeBendDegrees = Math.max(0, finite(tuning.kneeBendDegrees));
        const spineLagDegrees = Math.max(0, finite(tuning.spineLagDegrees));
        const headLagDegrees = Math.max(0, finite(tuning.headLagDegrees));
        const phase = (time - this._triggerTime) * frequency * TAU + this._impactPhase;
        const rollRatio = clamp(
            rollVelocity * RAD2DEG / Math.max(1, finite(tuning.fullAngularSpeedDegrees)),
            -1,
            1,
        );
        const pitchRatio = clamp(
            pitchVelocity * RAD2DEG / Math.max(1, finite(tuning.fullAngularSpeedDegrees)),
            -1,
            1,
        );
        const rollDrive = Math.abs(rollRatio) > 0.01 ? Math.sign(rollRatio) : this._impactRollSign;
        const pitchDrive = Math.abs(pitchRatio) > 0.01 ? Math.sign(pitchRatio) : this._impactPitchSign;

        const leftArmWave = Math.sin(phase * 1.03 + this._phaseLeftArm);
        const rightArmWave = Math.sin(phase * 0.91 + this._phaseRightArm);
        const leftLegWave = Math.sin(phase * 0.82 + this._phaseLeftLeg);
        const rightLegWave = Math.sin(phase * 0.76 + this._phaseRightLeg);

        this._leftArmSwing = armSwingDegrees * this._leftArmScale
            * clamp(leftArmWave + rollDrive * 0.22 - pitchDrive * 0.14, -1, 1);
        this._rightArmSwing = armSwingDegrees * this._rightArmScale
            * clamp(rightArmWave - rollDrive * 0.22 - pitchDrive * 0.14, -1, 1);
        this._leftForearmSwing = forearmSwingDegrees
            * clamp(Math.sin(phase * 1.19 + this._phaseLeftArm + 0.72), -1, 1);
        this._rightForearmSwing = forearmSwingDegrees
            * clamp(Math.sin(phase * 1.11 + this._phaseRightArm + 0.86), -1, 1);
        this._leftElbowBend = elbowBendDegrees
            * clamp01(0.62 + leftArmWave * 0.18 + this._curlWeight * 0.35);
        this._rightElbowBend = elbowBendDegrees
            * clamp01(0.62 + rightArmWave * 0.18 + this._curlWeight * 0.35);

        this._leftLegSwing = legSwingDegrees * this._leftLegScale
            * clamp(leftLegWave - pitchDrive * 0.18, -1, 1);
        this._rightLegSwing = legSwingDegrees * this._rightLegScale
            * clamp(rightLegWave - pitchDrive * 0.18, -1, 1);
        this._leftCalfSwing = calfSwingDegrees
            * clamp(Math.sin(phase * 0.94 + this._phaseLeftLeg + 0.68), -1, 1);
        this._rightCalfSwing = calfSwingDegrees
            * clamp(Math.sin(phase * 0.88 + this._phaseRightLeg + 0.81), -1, 1);
        this._leftKneeBend = kneeBendDegrees
            * clamp01(0.58 + leftLegWave * 0.2 + this._curlWeight * 0.28);
        this._rightKneeBend = kneeBendDegrees
            * clamp01(0.58 + rightLegWave * 0.2 + this._curlWeight * 0.28);

        this._spinePitch = -pitchDrive * spineLagDegrees
            * clamp(Math.abs(pitchRatio) + this._curlWeight * 0.25, 0, 1);
        this._spineRoll = -rollDrive * spineLagDegrees
            * clamp(Math.abs(rollRatio) + this._curlWeight * 0.2, 0, 1);
        this._headPitch = -pitchDrive * headLagDegrees
            * clamp(Math.abs(pitchRatio) + this._curlWeight * 0.4, 0, 1);
        this._headRoll = -rollDrive * headLagDegrees
            * clamp(Math.abs(rollRatio) + this._curlWeight * 0.3, 0, 1);
    }

    private clearReaction() {
        this._triggerTime = Number.NEGATIVE_INFINITY;
        this._minimumActiveUntil = Number.NEGATIVE_INFINITY;
        this._impactStrength = 0;
        this._weight = 0;
        this._curlWeight = 0;
        this.clearReactionOutputs();
    }

    private clearReactionOutputs() {
        this._leftArmSwing = 0;
        this._rightArmSwing = 0;
        this._leftForearmSwing = 0;
        this._rightForearmSwing = 0;
        this._leftElbowBend = 0;
        this._rightElbowBend = 0;
        this._leftLegSwing = 0;
        this._rightLegSwing = 0;
        this._leftCalfSwing = 0;
        this._rightCalfSwing = 0;
        this._leftKneeBend = 0;
        this._rightKneeBend = 0;
        this._spinePitch = 0;
        this._spineRoll = 0;
        this._headPitch = 0;
        this._headRoll = 0;
    }

    get weight(): number { return this._weight; }
    get impactStrength(): number { return this._impactStrength; }
    get impactRollSign(): number { return this._impactRollSign; }
    get impactPitchSign(): number { return this._impactPitchSign; }
    get impactPhase(): number { return this._impactPhase; }
    get curlWeight(): number { return this._curlWeight; }
    get strokePoseWeight(): number {
        return 1 - this._weight * (1 - clamp01(COLLISION_RAGDOLL_TUNING.minimumStrokePoseWeight));
    }
    get leftArmSwing(): number { return this._leftArmSwing; }
    get rightArmSwing(): number { return this._rightArmSwing; }
    get leftForearmSwing(): number { return this._leftForearmSwing; }
    get rightForearmSwing(): number { return this._rightForearmSwing; }
    get leftElbowBend(): number { return this._leftElbowBend; }
    get rightElbowBend(): number { return this._rightElbowBend; }
    get leftLegSwing(): number { return this._leftLegSwing; }
    get rightLegSwing(): number { return this._rightLegSwing; }
    get leftCalfSwing(): number { return this._leftCalfSwing; }
    get rightCalfSwing(): number { return this._rightCalfSwing; }
    get leftKneeBend(): number { return this._leftKneeBend; }
    get rightKneeBend(): number { return this._rightKneeBend; }
    get spinePitch(): number { return this._spinePitch; }
    get spineRoll(): number { return this._spineRoll; }
    get headPitch(): number { return this._headPitch; }
    get headRoll(): number { return this._headRoll; }
}

// Estimates how much of a candidate arm overlay can remain without pulling the
// wrist farther into the head than the authored stroke pose. Distances are in
// world space, while the guard radius is derived from the arm itself so all
// character scales share the same behavior.
export function collisionRagdollHeadGuardWeight(
    sourceHandHeadDistance: number,
    candidateHandHeadDistance: number,
    armLength: number,
): number {
    const source = Math.max(0, finite(sourceHandHeadDistance));
    const candidate = Math.max(0, finite(candidateHandHeadDistance));
    const length = Math.max(0, finite(armLength));
    const guardRatio = clamp(
        finite(COLLISION_RAGDOLL_TUNING.handHeadGuardArmLengthRatio),
        0,
        1,
    );
    const guardDistance = length * guardRatio;
    if (guardDistance <= 0.0001
        || candidate >= guardDistance
        || candidate >= source - 0.0001) {
        return 1;
    }
    if (source <= guardDistance) {
        return 0;
    }
    const estimatedSafeWeight = (source - guardDistance)
        / Math.max(0.0001, source - candidate);
    return clamp01(estimatedSafeWeight * 0.85);
}

export const COLLISION_RAGDOLL_ELBOW_FLEX_LIMIT_DEGREES = 35;
export const COLLISION_RAGDOLL_KNEE_FLEX_LIMIT_DEGREES = 28;
export const COLLISION_RAGDOLL_SPINE_FLEX_LIMIT_DEGREES = 12;

// Elbows and knees are treated as one-direction hinges. The phase term can
// loosen/tighten flexion, but it can never create hyperextension or exceed the
// conservative presentation limit.
export function collisionRagdollHingeFlexionDegrees(
    bendDegrees: number,
    phaseVariationDegrees: number,
    maximumDegrees: number,
): number {
    return clamp(
        finite(bendDegrees) - finite(phaseVariationDegrees),
        0,
        Math.max(0, finite(maximumDegrees)),
    );
}

// The collision overlay may curl the waist slightly forward, but never reverse
// it or add a sideways break. Whole-body somersaulting remains on the swimmer
// root and is intentionally independent from this local anatomical limit.
export function collisionRagdollSpineFlexionDegrees(signedLagDegrees: number): number {
    return -clamp(
        Math.abs(finite(signedLagDegrees)),
        0,
        COLLISION_RAGDOLL_SPINE_FLEX_LIMIT_DEGREES,
    );
}

function stableSign(value: number, seed: number, salt: number): number {
    const use = finite(value);
    if (Math.abs(use) > 1e-6) {
        return use >= 0 ? 1 : -1;
    }
    return unitHash(seed, salt) >= 0.5 ? 1 : -1;
}

function unitHash(seed: number, salt: number): number {
    let value = (Math.trunc(seed) ^ Math.imul(salt, 0x45d9f3b)) | 0;
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value ^= value >>> 16;
    return (value >>> 0) / 0x100000000;
}

function finite(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
    return clamp(finite(value), 0, 1);
}

function positiveModulo(value: number, divisor: number): number {
    const remainder = finite(value) % divisor;
    return remainder < 0 ? remainder + divisor : remainder;
}

function smoothStep(value: number): number {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}
