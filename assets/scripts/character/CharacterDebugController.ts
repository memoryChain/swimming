import { FreestylePoseController } from './FreestylePoseController';
import { StrokeType } from '../core/GameConstants';
import { MOTION_TUNING } from '../core/InputTuning';

export class CharacterDebugController {
    private _enabled = false;
    private _leftArmPhase = 0;
    private _rightArmPhase = 0;
    private _leftKickPhase = 0;
    private _rightKickPhase = 0;
    private _leftArmPower = 0;
    private _rightArmPower = 0;
    private _leftKickPower = 0;
    private _rightKickPower = 0;
    private _leftArmCycleRemaining = 0;
    private _rightArmCycleRemaining = 0;
    private _leftKickCycleRemaining = 0;
    private _rightKickCycleRemaining = 0;
    private _leftStrokeHeld = false;
    private _rightStrokeHeld = false;
    private _motionClock = 0;
    private _speedScale = 1;
    private _logTimer = 0;
    private readonly _armInputTimes: number[] = [];
    private readonly _kickInputTimes: number[] = [];

    constructor(private readonly _pose: FreestylePoseController) {}

    setEnabled(active: boolean) {
        this._enabled = active;
        this.resetMotion();
    }

    triggerArmStroke() {
        this.triggerStroke(StrokeType.LEFT);
    }

    triggerKick() {
        this.triggerStroke(StrokeType.RIGHT);
    }

    triggerStroke(type: StrokeType) {
        this.queueInput(this._armInputTimes);
        this.queueInput(this._kickInputTimes);
        if (type === StrokeType.LEFT) {
            this._leftArmCycleRemaining += Math.PI * 2;
            this._rightKickCycleRemaining += Math.PI * 2;
            this._leftArmPower = 1;
            this._rightKickPower = 1;
        } else if (type === StrokeType.RIGHT) {
            this._rightArmCycleRemaining += Math.PI * 2;
            this._leftKickCycleRemaining += Math.PI * 2;
            this._rightArmPower = 1;
            this._leftKickPower = 1;
        } else {
            this._leftArmCycleRemaining += Math.PI * 2;
            this._rightArmCycleRemaining += Math.PI * 2;
            this._leftKickCycleRemaining += Math.PI * 2;
            this._rightKickCycleRemaining += Math.PI * 2;
            this._leftArmPower = 1;
            this._rightArmPower = 1;
            this._leftKickPower = 1;
            this._rightKickPower = 1;
        }
        console.log(`[SpeedSwimming] model debug arm stroke trigger rate=${this.inputRatePerSecond(this._armInputTimes).toFixed(1)}/s`);
        console.log(`[SpeedSwimming] model debug leg kick trigger rate=${this.inputRatePerSecond(this._kickInputTimes).toFixed(1)}/s`);
    }

    setStrokeHeld(type: StrokeType, held: boolean) {
        if (type === StrokeType.LEFT) {
            this._leftStrokeHeld = held;
        } else if (type === StrokeType.RIGHT) {
            this._rightStrokeHeld = held;
        } else {
            this._leftStrokeHeld = held;
            this._rightStrokeHeld = held;
        }
    }

    update(dt: number) {
        if (!this._enabled) {
            return;
        }
        const actionDt = dt * this._speedScale;
        this._motionClock += dt;
        this.pruneInputTimes(this._armInputTimes);
        this.pruneInputTimes(this._kickInputTimes);

        const armRate = this.inputRatePerSecond(this._armInputTimes);
        const kickRate = this.inputRatePerSecond(this._kickInputTimes);
        const armSpeed = this.motionSpeedForRate(armRate, Math.PI * 2, MOTION_TUNING.debugArmMinCyclesPerSecond, MOTION_TUNING.debugMaxCyclesPerSecond);
        const kickSpeed = this.motionSpeedForRate(kickRate, Math.PI * 2, MOTION_TUNING.debugKickMinCyclesPerSecond, MOTION_TUNING.debugMaxCyclesPerSecond);
        this._leftArmPower = this.advanceMotion(actionDt, armSpeed, '_leftArmCycleRemaining', '_leftArmPhase', 0, this.motionSpeedScaleForSide(StrokeType.LEFT));
        this._rightArmPower = this.advanceMotion(actionDt, armSpeed, '_rightArmCycleRemaining', '_rightArmPhase', 0, this.motionSpeedScaleForSide(StrokeType.RIGHT));
        this._leftKickPower = this.advanceMotion(actionDt, kickSpeed, '_leftKickCycleRemaining', '_leftKickPhase', 0, this.motionSpeedScaleForSide(StrokeType.RIGHT));
        this._rightKickPower = this.advanceMotion(actionDt, kickSpeed, '_rightKickCycleRemaining', '_rightKickPhase', 0, this.motionSpeedScaleForSide(StrokeType.LEFT));

        const leftArmPower = 1 + this._leftArmPower * 1.45;
        const rightArmPower = 1 + this._rightArmPower * 1.45;
        const leftKickPower = 1 + this._leftKickPower * 1.6;
        const rightKickPower = 1 + this._rightKickPower * 1.6;
        const armReach = this._pose.armReachSignal(this._leftArmPhase, this._rightArmPhase);
        const upperBodyPower = 1 + Math.max(this._leftArmPower, this._rightArmPower) * 1.2;

        if (
            this._leftArmPower <= 0
            && this._rightArmPower <= 0
            && this._leftKickPower <= 0
            && this._rightKickPower <= 0
        ) {
            this._pose.applyModelDebugPose();
            this.logSample(dt, 0, 0);
            return;
        }

        this._pose.applyDebugPose(
            armReach,
            upperBodyPower,
            this._leftArmPhase,
            this._rightArmPhase,
            leftArmPower,
            rightArmPower,
            this._leftKickPhase,
            this._rightKickPhase,
            leftKickPower,
            rightKickPower,
        );
        const armPhase = Math.max(Math.abs(Math.sin(this._leftArmPhase) * this._leftArmPower), Math.abs(Math.sin(this._rightArmPhase) * this._rightArmPower));
        const kickPhase = Math.max(Math.abs(Math.sin(this._leftKickPhase) * this._leftKickPower), Math.abs(Math.sin(this._rightKickPhase) * this._rightKickPower));
        this.logSample(dt, armPhase, kickPhase);
    }

    setSpeedScale(scale: number) {
        this._speedScale = Math.max(0.1, Math.min(1.5, scale));
        console.log(`[SpeedSwimming] model debug speed=${this._speedScale.toFixed(2)}x`);
    }

    get speedScale(): number {
        return this._speedScale;
    }

    private resetMotion() {
        this._leftArmPhase = 0;
        this._rightArmPhase = 0;
        this._leftKickPhase = 0;
        this._rightKickPhase = 0;
        this._leftArmPower = 0;
        this._rightArmPower = 0;
        this._leftKickPower = 0;
        this._rightKickPower = 0;
        this._leftArmCycleRemaining = 0;
        this._rightArmCycleRemaining = 0;
        this._leftKickCycleRemaining = 0;
        this._rightKickCycleRemaining = 0;
        this._leftStrokeHeld = false;
        this._rightStrokeHeld = false;
        this._motionClock = 0;
        this._logTimer = 0;
        this._armInputTimes.length = 0;
        this._kickInputTimes.length = 0;
    }

    private queueInput(times: number[]) {
        times.push(this._motionClock);
        this.pruneInputTimes(times);
    }

    private advanceMotion(
        dt: number,
        speed: number,
        remainingKey: '_leftArmCycleRemaining' | '_rightArmCycleRemaining' | '_leftKickCycleRemaining' | '_rightKickCycleRemaining',
        phaseKey: '_leftArmPhase' | '_rightArmPhase' | '_leftKickPhase' | '_rightKickPhase',
        restPhase: number,
        speedScale: number,
    ): number {
        if (this[remainingKey] <= 0) {
            this[phaseKey] = restPhase;
            return 0;
        }
        const step = Math.min(this[remainingKey], dt * speed * speedScale);
        this[phaseKey] += step;
        this[remainingKey] -= step;
        return Math.max(0.25, Math.min(1, this[remainingKey] / (Math.PI * 2)));
    }

    private motionSpeedScaleForSide(type: StrokeType): number {
        const held = type === StrokeType.LEFT ? this._leftStrokeHeld : this._rightStrokeHeld;
        return held ? MOTION_TUNING.heldMotionSpeedScale : MOTION_TUNING.releasedMotionSpeedScale;
    }

    private motionSpeedForRate(ratePerSecond: number, cycleAmount: number, minCyclesPerSecond: number, maxCyclesPerSecond: number): number {
        const cyclesPerSecond = Math.max(minCyclesPerSecond, Math.min(maxCyclesPerSecond, ratePerSecond));
        return cycleAmount * cyclesPerSecond;
    }

    private inputRatePerSecond(times: number[]): number {
        return times.length;
    }

    private pruneInputTimes(times: number[]) {
        while (times.length > 0 && this._motionClock - times[0] > 1) {
            times.shift();
        }
    }

    private logSample(dt: number, armPhase: number, kickPhase: number) {
        this._logTimer += dt;
        if (this._logTimer < 0.75) {
            return;
        }
        this._logTimer = 0;
        console.log(
            `[SpeedSwimming] model debug sample arm=${armPhase.toFixed(2)} kick=${kickPhase.toFixed(2)} ` +
            `speed=${this._speedScale.toFixed(2)} armRate=${this.inputRatePerSecond(this._armInputTimes).toFixed(1)}/s kickRate=${this.inputRatePerSecond(this._kickInputTimes).toFixed(1)}/s ` +
            `leftArmPower=${this._leftArmPower.toFixed(2)} rightArmPower=${this._rightArmPower.toFixed(2)} leftKickPower=${this._leftKickPower.toFixed(2)} rightKickPower=${this._rightKickPower.toFixed(2)} ` +
            `leftArmEuler=${this._pose.leftArmEuler} leftLegEuler=${this._pose.leftLegEuler}`,
        );
    }
}
