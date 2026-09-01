import { COLLISION_PITCH_TUNING } from '../core/CollisionPitchTuning';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const TAU = Math.PI * 2;

// One-degree-of-freedom powered ragdoll around the swimmer's lateral axis.
// Normal strokes never drive this model; contact-begin collision impulses are the
// only energy source. It stays allocation-free and deterministic enough for local
// prediction, with angle + velocity corrected by network snapshots.
export class CollisionPitchModel {
    private _angle = 0;
    private _angularVelocity = 0;

    reset() {
        this._angle = 0;
        this._angularVelocity = 0;
    }

    update(rawDt: number, surfaceActive: boolean) {
        const dt = clamp(finite(rawDt), 0, 0.05);
        if (dt <= 0) {
            return;
        }
        if (!isEnabled()) {
            this.easeToNeutral(dt);
            return;
        }
        if (!surfaceActive) {
            this.easeToNeutral(dt);
            return;
        }

        const tuning = COLLISION_PITCH_TUNING;
        let angularAccel = -Math.sin(this._angle)
            * Math.max(0, finite(tuning.rightingTorque))
            * DEG2RAD;
        const absoluteAngleDegrees = Math.abs(this._angle) * RAD2DEG;
        const invertedStart = clamp(
            finite(tuning.invertedEscapeStartDegrees),
            0,
            179.9,
        );
        const invertedAngleWeight = smoothStep(clamp01(
            (absoluteAngleDegrees - invertedStart) / (180 - invertedStart),
        ));
        const invertedMaxSpeed = Math.max(
            1,
            finite(tuning.invertedEscapeMaxAngularSpeed),
        );
        const invertedSpeedWeight = 1 - smoothStep(clamp01(
            Math.abs(this._angularVelocity) * RAD2DEG / invertedMaxSpeed,
        ));
        // Always use the same positive direction at both +PI and -PI. Those two
        // numbers describe the same physical orientation, and network mrad
        // quantization must not make different devices choose opposite exits.
        angularAccel += invertedAngleWeight
            * invertedSpeedWeight
            * Math.max(0, finite(tuning.invertedEscapeTorque))
            * DEG2RAD;
        angularAccel -= this._angularVelocity * Math.max(0, finite(tuning.angularDrag));

        this._angularVelocity += angularAccel * dt;
        this.clampVelocity();
        this._angle = normalizeAngle(this._angle + this._angularVelocity * dt);
        this.sanitize();
    }

    applyAngularImpulse(angularVelocityDeltaRadians: number) {
        if (!isEnabled()) {
            return;
        }
        this._angularVelocity += finite(angularVelocityDeltaRadians);
        this.clampVelocity();
        this.sanitize();
    }

    correct(targetAngle: number, targetAngularVelocity: number, blend: number) {
        const t = clamp01(finite(blend));
        const target = normalizeAngle(finite(targetAngle));
        const delta = normalizeAngle(target - this._angle);
        this._angle = normalizeAngle(this._angle + delta * t);
        this._angularVelocity = lerp(
            this._angularVelocity,
            clampAngularVelocity(finite(targetAngularVelocity)),
            t,
        );
        this.sanitize();
    }

    private easeToNeutral(dt: number) {
        const blend = Math.min(1, dt * 8);
        this._angle = normalizeAngle(this._angle + normalizeAngle(-this._angle) * blend);
        this._angularVelocity += (0 - this._angularVelocity) * blend;
        if (Math.abs(this._angle) < 1e-4 && Math.abs(this._angularVelocity) < 1e-4) {
            this.reset();
        }
    }

    private clampVelocity() {
        this._angularVelocity = clampAngularVelocity(this._angularVelocity);
    }

    private sanitize() {
        this._angle = normalizeAngle(finite(this._angle));
        this._angularVelocity = clampAngularVelocity(finite(this._angularVelocity));
    }

    get angleRadians(): number {
        return this._angle;
    }

    get angularVelocityRadians(): number {
        return this._angularVelocity;
    }

    get permitsUprightTreadWater(): boolean {
        return Math.abs(this._angle) < Math.max(
            1,
            finite(COLLISION_PITCH_TUNING.treadWaterToleranceDegrees),
        ) * DEG2RAD;
    }

    get forwardScale(): number {
        const tuning = COLLISION_PITCH_TUNING;
        const angularSpeed = Math.abs(this._angularVelocity) * RAD2DEG;
        const start = Math.max(0, finite(tuning.tumblePenaltyStartAngularSpeed));
        const full = Math.max(start + 0.01, finite(tuning.tumblePenaltyFullAngularSpeed));
        const speedWaste = smoothStep(clamp01((angularSpeed - start) / (full - start)));
        const angleWaste = smoothStep(Math.abs(Math.sin(this._angle)));
        const waste = Math.max(speedWaste, angleWaste);
        return lerp(1, clamp01(finite(tuning.minForwardScale)), waste);
    }
}

function clampAngularVelocity(value: number): number {
    const max = Math.max(0, finite(COLLISION_PITCH_TUNING.maxAngularSpeed)) * DEG2RAD;
    return clamp(finite(value), -max, max);
}

function normalizeAngle(value: number): number {
    let result = finite(value) % TAU;
    if (result > Math.PI) {
        result -= TAU;
    } else if (result < -Math.PI) {
        result += TAU;
    }
    return result;
}

function isEnabled(): boolean {
    return finite(COLLISION_PITCH_TUNING.enabled) >= 0.5;
}

function finite(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
    return clamp(value, 0, 1);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function smoothStep(t: number): number {
    const useT = clamp01(t);
    return useT * useT * (3 - 2 * useT);
}
