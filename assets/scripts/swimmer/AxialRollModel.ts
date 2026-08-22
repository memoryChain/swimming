import { AXIAL_ROLL_TUNING } from '../core/AxialRollTuning';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const TAU = Math.PI * 2;

// Low-dimensional powered ragdoll around the swimmer's head-to-feet axis.
// No engine Rigidbody objects are created: this stays allocation-free, cheap for
// seven swimmers, and independent of render-rate bone sampling.
export class AxialRollModel {
    private _angle = 0;
    private _angularVelocity = 0;
    private _catchTorqueSignal = 0;

    reset() {
        this._angle = 0;
        this._angularVelocity = 0;
        this._catchTorqueSignal = 0;
    }

    update(
        rawDt: number,
        surfaceActive: boolean,
        leftCatchSupport: number,
        rightCatchSupport: number,
        kickCadenceHz: number,
    ) {
        const dt = clamp(finite(rawDt), 0, 0.05);
        if (dt <= 0) {
            return;
        }
        if (!isEnabled()) {
            this.easeToNeutral(dt);
            return;
        }
        if (!surfaceActive) {
            this.holdOrientation(dt);
            return;
        }

        const tuning = AXIAL_ROLL_TUNING;
        const angleDegrees = this._angle * RAD2DEG;
        const magnitudeDegrees = Math.abs(angleDegrees);
        const sinRoll = Math.sin(this._angle);
        const halfWidth = Math.max(0.01, finite(tuning.shoulderHalfWidth));
        const leftShoulderY = halfWidth * sinRoll;
        const rightShoulderY = -leftShoulderY;
        const leftSubmerged = shoulderSubmergedFraction(leftShoulderY);
        const rightSubmerged = shoulderSubmergedFraction(rightShoulderY);
        const minimumCatch = clamp01(finite(tuning.minimumExposedArmCatch));
        const leftWaterFactor = minimumCatch + (1 - minimumCatch) * leftSubmerged;
        const rightWaterFactor = minimumCatch + (1 - minimumCatch) * rightSubmerged;

        // LEFT adds positive roll, RIGHT negative, matching the existing dolphin
        // corkscrew convention. The raised arm loses some leverage while the
        // submerged opposite arm remains able to brake and reverse the roll.
        let catchDifference = clamp01(finite(leftCatchSupport)) * leftWaterFactor
            - clamp01(finite(rightCatchSupport)) * rightWaterFactor;
        const response = Math.max(0, finite(tuning.catchTorqueResponseRate));
        const torqueBlend = response > 0 ? 1 - Math.exp(-response * dt) : 1;
        this._catchTorqueSignal += (catchDifference - this._catchTorqueSignal) * torqueBlend;
        let angularAccel = this._catchTorqueSignal
            * Math.max(0, finite(tuning.armCatchTorque))
            * DEG2RAD;

        const sinRollMoment = Math.sin(this._angle);
        angularAccel -= sinRollMoment
            * Math.max(0, finite(tuning.waterRightingTorque))
            * DEG2RAD;
        const tippingStart = Math.max(0, finite(tuning.tippingStartDegrees));
        const tippingFull = Math.max(tippingStart + 0.01, finite(tuning.tippingFullDegrees));
        const capsizeRatio = smoothStep(clamp01(
            (magnitudeDegrees - tippingStart) / (tippingFull - tippingStart),
        ));
        // Once the center of buoyancy passes the narrow stable window, the same
        // water force that used to right the body now finishes the capsize. It
        // fades to zero near inverted, making supine the second balance state.
        angularAccel += Math.sign(angleDegrees)
            * Math.abs(sinRollMoment)
            * Math.max(0, finite(tuning.capsizeTorque))
            * capsizeRatio
            * DEG2RAD;
        const drag = Math.max(0, finite(tuning.angularDrag))
            + Math.max(0, finite(kickCadenceHz))
                * Math.max(0, finite(tuning.kickAngularDragPerHz));
        angularAccel -= this._angularVelocity * drag;

        this._angularVelocity += angularAccel * dt;
        this.clampVelocity();
        this._angle = normalizeAngle(this._angle + this._angularVelocity * dt);
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

    // Instantaneous angular-velocity change from an external contact. Keeping
    // collision response inside this model means it shares the same drag,
    // capsize curve, velocity cap and network correction as stroke-driven roll.
    applyAngularImpulse(angularVelocityDeltaRadians: number) {
        if (!isEnabled()) {
            return;
        }
        this._angularVelocity += finite(angularVelocityDeltaRadians);
        this.clampVelocity();
        this.sanitize();
    }

    private easeToNeutral(dt: number) {
        this._catchTorqueSignal += (0 - this._catchTorqueSignal) * Math.min(1, dt * 7);
        this._angle += (0 - this._angle) * Math.min(1, dt * 7);
        this._angularVelocity += (0 - this._angularVelocity) * Math.min(1, dt * 7);
        if (Math.abs(this._angle) < 1e-4 && Math.abs(this._angularVelocity) < 1e-4) {
            this.reset();
        }
    }

    private holdOrientation(dt: number) {
        const blend = Math.min(1, dt * 8);
        this._catchTorqueSignal += (0 - this._catchTorqueSignal) * blend;
        this._angularVelocity += (0 - this._angularVelocity) * blend;
    }

    private clampVelocity() {
        this._angularVelocity = clampAngularVelocity(this._angularVelocity);
    }

    private sanitize() {
        this._angle = normalizeAngle(finite(this._angle));
        this._angularVelocity = clampAngularVelocity(finite(this._angularVelocity));
        this._catchTorqueSignal = clamp(finite(this._catchTorqueSignal), -1, 1);
    }

    get angleRadians(): number {
        return this._angle;
    }

    get angularVelocityRadians(): number {
        return this._angularVelocity;
    }

    get angleDegrees(): number {
        return this._angle * RAD2DEG;
    }

    // The two valid balance states are prone (0) and supine (+/-pi). Side-on
    // angles belong to the nearer basin but remain dynamically unstable.
    get stableAngleRadians(): number {
        if (Math.abs(this._angle) < Math.PI * 0.5) {
            return 0;
        }
        return this._angle >= 0 ? Math.PI : -Math.PI;
    }

    get permitsUprightTreadWater(): boolean {
        return Math.abs(this.angleDegrees) < Math.max(1, finite(AXIAL_ROLL_TUNING.tippingStartDegrees));
    }

    setState(angleRadians: number, angularVelocityRadians = 0) {
        this._angle = normalizeAngle(finite(angleRadians));
        this._angularVelocity = clampAngularVelocity(finite(angularVelocityRadians));
        this._catchTorqueSignal = 0;
    }

    get forwardScale(): number {
        const tuning = AXIAL_ROLL_TUNING;
        const absoluteAngle = Math.abs(this.angleDegrees);
        // Propulsion loss depends on distance from the NEAREST stable state.
        // Both prone (0°) and supine (180°) therefore regain full efficiency;
        // side-on around 90° is the slowest point.
        const magnitude = Math.min(absoluteAngle, Math.max(0, 180 - absoluteAngle));
        const start = Math.max(0, finite(tuning.speedPenaltyStartDegrees));
        const full = Math.max(start + 0.01, finite(tuning.speedPenaltyFullDegrees));
        const ratio = smoothStep(clamp01((magnitude - start) / (full - start)));
        return lerp(1, clamp01(finite(tuning.minForwardScale)), ratio);
    }
}

function shoulderSubmergedFraction(pointY: number): number {
    const band = Math.max(0.01, finite(AXIAL_ROLL_TUNING.shoulderWaterBand));
    return clamp01(0.5 - finite(pointY) / (band * 2));
}

function clampAngularVelocity(value: number): number {
    const max = Math.max(0, finite(AXIAL_ROLL_TUNING.maxAngularSpeed)) * DEG2RAD;
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
    return finite(AXIAL_ROLL_TUNING.enabled) >= 0.5;
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
