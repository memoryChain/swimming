import { FreestylePoseController } from './FreestylePoseController';

export class CharacterDebugController {
    private _enabled = false;
    private _armPhase = 0;
    private _kickPhase = 0;
    private _armPower = 0;
    private _kickPower = 0;
    private _armCycleRemaining = 0;
    private _kickCycleRemaining = 0;
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
        this.queueMotion(this._armInputTimes, Math.PI * 2);
        this._armPower = 1;
        console.log(`[SpeedSwimming] model debug arm stroke trigger rate=${this.inputRatePerSecond(this._armInputTimes).toFixed(1)}/s`);
    }

    triggerKick() {
        this.queueMotion(this._kickInputTimes, Math.PI * 2);
        this._kickPower = 1;
        console.log(`[SpeedSwimming] model debug leg kick trigger rate=${this.inputRatePerSecond(this._kickInputTimes).toFixed(1)}/s`);
    }

    update(dt: number) {
        if (!this._enabled) {
            return;
        }
        const actionDt = dt * this._speedScale;
        this._motionClock += dt;
        this.pruneInputTimes(this._armInputTimes);
        this.pruneInputTimes(this._kickInputTimes);

        if (this._armCycleRemaining > 0) {
            const armRate = this.inputRatePerSecond(this._armInputTimes);
            const step = Math.min(this._armCycleRemaining, actionDt * this.motionSpeedForRate(armRate, Math.PI * 2, 0.7, 5.2));
            this._armPhase += step;
            this._armCycleRemaining -= step;
            this._armPower = Math.max(0.25, Math.min(1, this._armCycleRemaining / (Math.PI * 2)));
        } else {
            this._armPower = 0;
            this._armPhase = 0;
        }

        if (this._kickCycleRemaining > 0) {
            const kickRate = this.inputRatePerSecond(this._kickInputTimes);
            const step = Math.min(this._kickCycleRemaining, actionDt * this.motionSpeedForRate(kickRate, Math.PI * 2, 0.82, 5.2));
            this._kickPhase += step;
            this._kickCycleRemaining -= step;
            this._kickPower = Math.max(0.25, Math.min(1, this._kickCycleRemaining / (Math.PI * 2)));
        } else {
            this._kickPower = 0;
            this._kickPhase = 0;
        }

        const armPower = 1 + this._armPower * 1.45;
        const kickPower = 1 + this._kickPower * 1.6;
        const armActive = this._armCycleRemaining > 0;
        const armPhase = armActive ? Math.sin(this._armPhase) : 0;
        const armReach = armActive ? this._pose.armReachSignal(this._armPhase) : 0;
        const leftArmCycle = armActive ? this._armPhase : 0;
        const kickPhase = this._kickPower > 0 ? Math.sin(this._kickPhase) : 0;
        const leftKickCycle = this._kickPower > 0 ? this._kickPhase : 0;

        this._pose.applyDebugPose(armReach, armPower, leftArmCycle, kickPower, leftKickCycle);
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
        this._armPhase = 0;
        this._kickPhase = 0;
        this._armPower = 0;
        this._kickPower = 0;
        this._armCycleRemaining = 0;
        this._kickCycleRemaining = 0;
        this._motionClock = 0;
        this._logTimer = 0;
        this._armInputTimes.length = 0;
        this._kickInputTimes.length = 0;
    }

    private queueMotion(times: number[], cycleAmount: number) {
        times.push(this._motionClock);
        this.pruneInputTimes(times);
        if (times === this._armInputTimes) {
            this._armCycleRemaining += cycleAmount;
        } else {
            this._kickCycleRemaining += cycleAmount;
        }
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
            `armPower=${this._armPower.toFixed(2)} kickPower=${this._kickPower.toFixed(2)} ` +
            `leftArmEuler=${this._pose.leftArmEuler} leftLegEuler=${this._pose.leftLegEuler}`,
        );
    }
}
