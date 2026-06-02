import { RACE_DISTANCE, SWIMMER_BALANCE } from '../core/GameBalance';
import { StrokeType } from '../core/GameConstants';
import { MOTION_TUNING } from '../core/InputTuning';
import { StrokeMetrics } from './StrokeMetrics';
import { SwimPhysicsModel } from './SwimPhysicsModel';

const CYCLE_AMOUNT = Math.PI * 2;

export type SwimmerMotorOptions = {
    isAI: boolean;
    aiPower: number;
    aiMaxSpeedScale: number;
    rhythmBonus: number;
};

export class SwimmerMotor {
    private readonly _metrics = new StrokeMetrics();
    private readonly _physics = new SwimPhysicsModel();
    private _currentSpeed = 0;
    private _distance = 0;
    private _isRacing = false;
    private _bodyPhase = 0;
    private _fatigue = 0;
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

    startRace(initialDistance = 0, initialSpeed = SWIMMER_BALANCE.baseSpeed) {
        this._isRacing = true;
        this._currentSpeed = initialSpeed;
        this.resetRaceState(initialDistance);
    }

    stopRace() {
        this._isRacing = false;
    }

    reset() {
        this._currentSpeed = 0;
        this._isRacing = false;
        this.resetRaceState();
    }

    recordStroke(type: StrokeType) {
        this._metrics.recordStroke(type);
        if (type === StrokeType.LEFT) {
            this._leftArmMotionRemaining += CYCLE_AMOUNT;
            this._rightKickMotionRemaining += CYCLE_AMOUNT;
        } else if (type === StrokeType.RIGHT) {
            this._rightArmMotionRemaining += CYCLE_AMOUNT;
            this._leftKickMotionRemaining += CYCLE_AMOUNT;
        } else {
            this._leftArmMotionRemaining += CYCLE_AMOUNT;
            this._rightArmMotionRemaining += CYCLE_AMOUNT;
            this._leftKickMotionRemaining += CYCLE_AMOUNT;
            this._rightKickMotionRemaining += CYCLE_AMOUNT;
        }
        this._armAction = 1;
        this._kickAction = 1;
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

    update(dt: number, options: SwimmerMotorOptions): boolean {
        if (!this._isRacing) {
            return false;
        }

        this._armAction = Math.max(0, this._armAction - dt * 4.6);
        this._kickAction = Math.max(0, this._kickAction - dt * 6.8);
        this._metrics.update(dt);
        const next = this._physics.step(
            {
                currentSpeed: this._currentSpeed,
                distance: this._distance,
                fatigue: this._fatigue,
            },
            {
                dt,
                isAI: options.isAI,
                aiPower: options.aiPower,
                aiMaxSpeedScale: options.aiMaxSpeedScale,
                rhythmBonus: options.rhythmBonus,
                effortScore: this._metrics.effortScore,
                syncScore: this._metrics.syncScore,
                armInputRate: this._metrics.armInputRate,
                kickInputRate: this._metrics.kickInputRate,
                targetLimbRate: this._metrics.targetLimbRate,
            },
        );
        this._currentSpeed = next.currentSpeed;
        this._fatigue = next.fatigue;
        this._distance = Math.min(RACE_DISTANCE, this._distance + this._currentSpeed * dt);
        this.updateMotionCycles(dt);

        if (this._distance >= RACE_DISTANCE) {
            this._isRacing = false;
            return true;
        }
        return false;
    }

    private resetRaceState(initialDistance = 0) {
        this._distance = Math.max(0, initialDistance);
        this._fatigue = 0;
        this._bodyPhase = 0;
        this._leftArmCycle = 0;
        this._rightArmCycle = 0;
        this._leftKickCycle = 0;
        this._rightKickCycle = 0;
        this._leftArmMotionRemaining = 0;
        this._rightArmMotionRemaining = 0;
        this._leftKickMotionRemaining = 0;
        this._rightKickMotionRemaining = 0;
        this._armAction = 0;
        this._kickAction = 0;
        this._leftStrokeHeld = false;
        this._rightStrokeHeld = false;
        this._metrics.reset();
    }

    private updateMotionCycles(dt: number) {
        const armCycleSpeed = this.motionSpeedForRate(this._metrics.armInputRate, CYCLE_AMOUNT, MOTION_TUNING.armMinCyclesPerSecond, MOTION_TUNING.maxCyclesPerSecond);
        const kickCycleSpeed = this.motionSpeedForRate(this._metrics.kickInputRate, CYCLE_AMOUNT, MOTION_TUNING.kickMinCyclesPerSecond, MOTION_TUNING.maxCyclesPerSecond);

        this._bodyPhase += dt * Math.max(6, this._currentSpeed * 1.2);
        this._leftArmCycle += this.advanceQueuedMotion(dt, armCycleSpeed, '_leftArmMotionRemaining', this.motionSpeedScaleForSide(StrokeType.LEFT));
        this._rightArmCycle += this.advanceQueuedMotion(dt, armCycleSpeed, '_rightArmMotionRemaining', this.motionSpeedScaleForSide(StrokeType.RIGHT));
        this._leftKickCycle += this.advanceQueuedMotion(dt, kickCycleSpeed, '_leftKickMotionRemaining', this.motionSpeedScaleForSide(StrokeType.RIGHT));
        this._rightKickCycle += this.advanceQueuedMotion(dt, kickCycleSpeed, '_rightKickMotionRemaining', this.motionSpeedScaleForSide(StrokeType.LEFT));
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

    private motionSpeedScaleForSide(type: StrokeType): number {
        const held = type === StrokeType.LEFT ? this._leftStrokeHeld : this._rightStrokeHeld;
        const sideScale = held ? MOTION_TUNING.heldMotionSpeedScale : MOTION_TUNING.releasedMotionSpeedScale;
        return sideScale * MOTION_TUNING.animationSpeedScale;
    }

    private motionSpeedForRate(ratePerSecond: number, cycleAmount: number, minCyclesPerSecond: number, maxCyclesPerSecond: number): number {
        const cyclesPerSecond = Math.max(minCyclesPerSecond, Math.min(maxCyclesPerSecond, ratePerSecond));
        return cycleAmount * cyclesPerSecond;
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
}
