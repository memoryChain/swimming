import { BASE_SPEED, RACE_DISTANCE, StrokeType } from '../core/GameConstants';
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
    private _armCycle = 0;
    private _kickCycle = 0;
    private _armMotionRemaining = 0;
    private _kickMotionRemaining = 0;
    private _armAction = 0;
    private _kickAction = 0;

    startRace(initialDistance = 0, initialSpeed = BASE_SPEED) {
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
        if (type === StrokeType.ARM) {
            this._armMotionRemaining += CYCLE_AMOUNT;
            this._armAction = 1;
        } else {
            this._kickMotionRemaining += CYCLE_AMOUNT;
            this._kickAction = 1;
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
        this._armCycle = 0;
        this._kickCycle = 0;
        this._armMotionRemaining = 0;
        this._kickMotionRemaining = 0;
        this._armAction = 0;
        this._kickAction = 0;
        this._metrics.reset();
    }

    private updateMotionCycles(dt: number) {
        const armCycleSpeed = this.motionSpeedForRate(this._metrics.armInputRate, CYCLE_AMOUNT, 0.82, 5.2);
        const kickCycleSpeed = this.motionSpeedForRate(this._metrics.kickInputRate, CYCLE_AMOUNT, 0.82, 5.2);

        this._bodyPhase += dt * Math.max(6, this._currentSpeed * 1.2);
        this._armCycle += this.advanceQueuedMotion(dt, armCycleSpeed, true);
        this._kickCycle += this.advanceQueuedMotion(dt, kickCycleSpeed, false);
    }

    private advanceQueuedMotion(dt: number, speed: number, arm: boolean): number {
        const remaining = arm ? this._armMotionRemaining : this._kickMotionRemaining;
        if (remaining <= 0) {
            return 0;
        }

        const step = Math.min(remaining, speed * dt);
        if (arm) {
            this._armMotionRemaining -= step;
        } else {
            this._kickMotionRemaining -= step;
        }
        return step;
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
        return this._armCycle;
    }

    get kickCycle(): number {
        return this._kickCycle;
    }

    get armAction(): number {
        return this._armAction;
    }

    get kickAction(): number {
        return this._kickAction;
    }
}
