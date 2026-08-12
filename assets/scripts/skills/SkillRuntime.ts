// Pure runtime state for the first shared ultimate skill. It intentionally has
// no Cocos dependency: Swimmer owns it and exposes only its resolved multipliers
// to SwimmerMotor. Future character-specific definitions can replace the single
// prototype balance below without changing the activation/sync lifecycle.

export const ULTIMATE_SKILL_BALANCE = {
    id: 'skill.prototype.burstSprint',
    name: '爆发冲刺',
    durationSeconds: 4,
    strokeAccelScale: 1.15,
    speedCapScale: 1.08,
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export class SkillRuntime {
    private _remainingSeconds = 0;

    get active(): boolean {
        return this._remainingSeconds > 0;
    }

    get remainingSeconds(): number {
        return this._remainingSeconds;
    }

    get normalizedRemaining(): number {
        const duration = Math.max(0.001, ULTIMATE_SKILL_BALANCE.durationSeconds);
        return clamp(this._remainingSeconds / duration, 0, 1);
    }

    get strokeAccelScale(): number {
        return this.active ? ULTIMATE_SKILL_BALANCE.strokeAccelScale : 1;
    }

    get speedCapScale(): number {
        return this.active ? ULTIMATE_SKILL_BALANCE.speedCapScale : 1;
    }

    reset(): void {
        this._remainingSeconds = 0;
    }

    activate(): boolean {
        if (this.active) {
            return false;
        }
        this._remainingSeconds = Math.max(0, ULTIMATE_SKILL_BALANCE.durationSeconds);
        return this.active;
    }

    tick(dt: number): void {
        if (!this.active || !Number.isFinite(dt) || dt <= 0) {
            return;
        }
        this._remainingSeconds = Math.max(0, this._remainingSeconds - dt);
    }

    // Owner-authoritative remaining time from a net self snapshot. It corrects
    // both a dropped activate event and fixed-step/render-step drift.
    applyNetRemaining(targetSeconds: number): void {
        if (!Number.isFinite(targetSeconds) || targetSeconds < 0) {
            return;
        }
        this._remainingSeconds = clamp(targetSeconds, 0, ULTIMATE_SKILL_BALANCE.durationSeconds);
    }
}
