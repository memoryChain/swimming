import { FreestylePoseController } from './FreestylePoseController';
import { StrokeType } from '../core/GameConstants';
import { MOTION_TUNING } from '../core/InputTuning';

const CYCLE_AMOUNT = Math.PI * 2;
const MAX_QUEUED_MOTION = CYCLE_AMOUNT * 2;

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
    private _leftReleaseLockUntilRemaining = -1;
    private _rightReleaseLockUntilRemaining = -1;
    private _motionClock = 0;
    private _speedScale = 1;
    private _swimSpeedRatio = 0;
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

    triggerStroke(type: StrokeType, countsForMotionRate = true) {
        let armQueued = false;
        let kickQueued = false;
        if (type === StrokeType.LEFT) {
            armQueued = this.queueMotionCycle('_leftArmCycleRemaining');
            kickQueued = this.queueMotionCycle('_rightKickCycleRemaining');
            if (armQueued || kickQueued) {
                this.extendReleaseLockForQueuedInput(StrokeType.LEFT);
            }
            if (armQueued) {
                this._leftArmPower = 1;
            }
            if (kickQueued) {
                this._rightKickPower = 1;
            }
        } else if (type === StrokeType.RIGHT) {
            armQueued = this.queueMotionCycle('_rightArmCycleRemaining');
            kickQueued = this.queueMotionCycle('_leftKickCycleRemaining');
            if (armQueued || kickQueued) {
                this.extendReleaseLockForQueuedInput(StrokeType.RIGHT);
            }
            if (armQueued) {
                this._rightArmPower = 1;
            }
            if (kickQueued) {
                this._leftKickPower = 1;
            }
        } else {
            const leftArmQueued = this.queueMotionCycle('_leftArmCycleRemaining');
            const rightArmQueued = this.queueMotionCycle('_rightArmCycleRemaining');
            const leftKickQueued = this.queueMotionCycle('_leftKickCycleRemaining');
            const rightKickQueued = this.queueMotionCycle('_rightKickCycleRemaining');
            armQueued = leftArmQueued || rightArmQueued;
            kickQueued = leftKickQueued || rightKickQueued;
            if (leftArmQueued || rightKickQueued) {
                this.extendReleaseLockForQueuedInput(StrokeType.LEFT);
            }
            if (rightArmQueued || leftKickQueued) {
                this.extendReleaseLockForQueuedInput(StrokeType.RIGHT);
            }
            if (leftArmQueued) {
                this._leftArmPower = 1;
            }
            if (rightArmQueued) {
                this._rightArmPower = 1;
            }
            if (leftKickQueued) {
                this._leftKickPower = 1;
            }
            if (rightKickQueued) {
                this._rightKickPower = 1;
            }
        }
        if (countsForMotionRate && armQueued) {
            this.queueInput(this._armInputTimes);
        }
        if (countsForMotionRate && kickQueued) {
            this.queueInput(this._kickInputTimes);
        }
        console.log(`[SpeedSwimming] model debug arm stroke trigger rate=${this.inputRatePerSecond(this._armInputTimes).toFixed(1)}/s`);
        console.log(`[SpeedSwimming] model debug leg kick trigger rate=${this.inputRatePerSecond(this._kickInputTimes).toFixed(1)}/s`);
    }

    setStrokeHeld(type: StrokeType, held: boolean) {
        if (type === StrokeType.LEFT) {
            this._leftStrokeHeld = held;
            if (!held) {
                this._leftReleaseLockUntilRemaining = this.currentActionEndRemaining(StrokeType.LEFT);
            }
        } else if (type === StrokeType.RIGHT) {
            this._rightStrokeHeld = held;
            if (!held) {
                this._rightReleaseLockUntilRemaining = this.currentActionEndRemaining(StrokeType.RIGHT);
            }
        } else {
            this._leftStrokeHeld = held;
            this._rightStrokeHeld = held;
            if (!held) {
                this._leftReleaseLockUntilRemaining = this.currentActionEndRemaining(StrokeType.LEFT);
                this._rightReleaseLockUntilRemaining = this.currentActionEndRemaining(StrokeType.RIGHT);
            }
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

        const armSpeed = CYCLE_AMOUNT * lerp(MOTION_TUNING.armMinCyclesPerSecond, MOTION_TUNING.maxCyclesPerSecond, this._swimSpeedRatio);
        const kickSpeed = CYCLE_AMOUNT * lerp(MOTION_TUNING.kickMinCyclesPerSecond, MOTION_TUNING.maxCyclesPerSecond, this._swimSpeedRatio);
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

    setSwimSpeedRatio(ratio: number) {
        this._swimSpeedRatio = Math.max(0, Math.min(1, ratio));
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
        this._leftReleaseLockUntilRemaining = -1;
        this._rightReleaseLockUntilRemaining = -1;
        this._motionClock = 0;
        this._swimSpeedRatio = 0;
        this._logTimer = 0;
        this._armInputTimes.length = 0;
        this._kickInputTimes.length = 0;
    }

    private queueInput(times: number[]) {
        times.push(this._motionClock);
        this.pruneInputTimes(times);
    }

    private queueMotionCycle(
        remainingKey: '_leftArmCycleRemaining' | '_rightArmCycleRemaining' | '_leftKickCycleRemaining' | '_rightKickCycleRemaining',
    ): boolean {
        const next = Math.min(MAX_QUEUED_MOTION, this[remainingKey] + CYCLE_AMOUNT);
        if (next <= this[remainingKey]) {
            return false;
        }
        this[remainingKey] = next;
        return true;
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
        if (this.isReleaseLocked(type)) {
            return MOTION_TUNING.releasedMotionSpeedScale;
        }
        const held = type === StrokeType.LEFT ? this._leftStrokeHeld : this._rightStrokeHeld;
        return held ? MOTION_TUNING.heldMotionSpeedScale : MOTION_TUNING.releasedMotionSpeedScale;
    }

    private isReleaseLocked(type: StrokeType): boolean {
        const totalRemaining = this.sideMotionRemaining(type);
        if (type === StrokeType.LEFT) {
            if (this._leftReleaseLockUntilRemaining < 0) {
                return false;
            }
            if (totalRemaining > this._leftReleaseLockUntilRemaining + 0.0001) {
                return true;
            }
            this._leftReleaseLockUntilRemaining = -1;
            return false;
        }

        if (this._rightReleaseLockUntilRemaining < 0) {
            return false;
        }
        if (totalRemaining > this._rightReleaseLockUntilRemaining + 0.0001) {
            return true;
        }
        this._rightReleaseLockUntilRemaining = -1;
        return false;
    }

    private currentActionEndRemaining(type: StrokeType): number {
        const totalRemaining = this.sideMotionRemaining(type);
        if (totalRemaining <= 0) {
            return -1;
        }
        return totalRemaining > CYCLE_AMOUNT ? CYCLE_AMOUNT : 0;
    }

    private extendReleaseLockForQueuedInput(type: StrokeType) {
        if (type === StrokeType.LEFT && this._leftReleaseLockUntilRemaining >= 0) {
            this._leftReleaseLockUntilRemaining += CYCLE_AMOUNT;
        } else if (type === StrokeType.RIGHT && this._rightReleaseLockUntilRemaining >= 0) {
            this._rightReleaseLockUntilRemaining += CYCLE_AMOUNT;
        }
    }

    private sideMotionRemaining(type: StrokeType): number {
        if (type === StrokeType.LEFT) {
            return Math.max(this._leftArmCycleRemaining, this._rightKickCycleRemaining);
        }
        return Math.max(this._rightArmCycleRemaining, this._leftKickCycleRemaining);
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

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * Math.max(0, Math.min(1, t));
}
