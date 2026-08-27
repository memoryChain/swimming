// AiConditionModel: simplified condition state for AI swimmers (doc 26/27.3).
// AI does NOT do the full input-driven gameplay: no updateFromStroke, no
// StrokeMetrics, no applyDiveResult. State is derived each frame from
// difficulty + aiPower + progress via tickAi. Output serves AI presentation
// only and is NOT shown to the player (doc 26.1/26.3). Implements the same
// readonly getter surface as PlayerConditionModel so callers stay uniform.

import {
    AiConditionInput,
    ConditionReadout,
    HeartRateZone,
    RacePhase,
    SprintTier,
    HEART_RATE_BOUNDS,
    zoneForHeartRate,
} from './ConditionTypes';
import {
    CONDITION_BALANCE,
    conditionEfficiencyScale,
    conditionQualityScale,
    energyDepletionCadenceScale,
} from '../core/ConditionBalance';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export class AiConditionModel {
    private _phase: RacePhase = RacePhase.START;
    private _heartRate = HEART_RATE_BOUNDS.min;
    private _heartRateZone: HeartRateZone = HeartRateZone.LOW;
    private _energy = CONDITION_BALANCE.energy.total;
    private _energyDepleted = false;
    private _sprintTier: SprintTier = SprintTier.STEADY;
    private _qualityModifier = 1;
    private _efficiencyModifier = 1;
    private _cadenceModifier = 1;
    private _depletionCooldown = 0;

    reset() {
        this._phase = RacePhase.START;
        this._heartRate = HEART_RATE_BOUNDS.min;
        this._heartRateZone = HeartRateZone.LOW;
        this._energy = CONDITION_BALANCE.energy.total;
        this._energyDepleted = false;
        this._sprintTier = SprintTier.STEADY;
        this._qualityModifier = 1;
        this._efficiencyModifier = 1;
        this._cadenceModifier = 1;
        this._depletionCooldown = 0;
    }

    setPhase(phase: RacePhase) {
        this._phase = phase;
        if (phase !== RacePhase.SPRINT) {
            this._sprintTier = SprintTier.STEADY;
        }
        this.refreshModifiers();
    }

    // Event-driven: keep AI on the same one-shot dolphin-jump heart-rate rule.
    applyDolphinJumpStrain(strainHr: number) {
        if (!Number.isFinite(strainHr) || strainHr <= 0) {
            return;
        }
        this._heartRate = clamp(this._heartRate + strainHr, HEART_RATE_BOUNDS.min, HEART_RATE_BOUNDS.max);
        this._heartRateZone = zoneForHeartRate(this._heartRate);
        this.refreshModifiers();
    }

    // Reconcile the locally stepped shadow state with the host-authoritative AI
    // condition carried by S|. Keeping a stepped shadow (instead of applying only
    // presentation modifiers) lets this client take over coherently after host
    // migration. New S| payloads transfer the exact cooldown remainder; the
    // edge-triggered fallback below is retained only for legacy payloads that do not
    // contain that appended field.
    applyAuthoritativeState(energyRatio: number, heartRate: number, depletionCooldown = -1) {
        if (!Number.isFinite(energyRatio) || !Number.isFinite(heartRate)) {
            return;
        }
        const energyCfg = CONDITION_BALANCE.energy;
        const wasPositive = this._energy > 0;
        const ratio = clamp(energyRatio, 0, 1);
        this._energy = ratio * energyCfg.total;
        this._heartRate = clamp(heartRate, HEART_RATE_BOUNDS.min, HEART_RATE_BOUNDS.max);
        this._heartRateZone = zoneForHeartRate(this._heartRate);
        this._energyDepleted = this._energy <= 0;
        if (Number.isFinite(depletionCooldown) && depletionCooldown >= 0) {
            // New S| packets carry the host's exact remaining cooldown so a client
            // promoted during exhaustion does not restart a full cooldown locally.
            this._depletionCooldown = Math.max(0, depletionCooldown);
        } else if (!this._energyDepleted) {
            this._depletionCooldown = 0;
        } else if (wasPositive && this._depletionCooldown <= 0) {
            this._depletionCooldown = energyCfg.depletionCooldownSeconds;
        }
        this.refreshModifiers();
    }

    // Clock-driven derivation. No input judging; pure curve over difficulty/progress.
    // Solo supplies render dt; network races supply the fixed simulation dt.
    tickAi(input: AiConditionInput) {
        const difficulty = clamp(input.difficulty, 0, 1);

        // Target heart-rate by phase. Higher difficulty settles closer to the
        // efficient OPTIMAL band and is steadier; sprint pushes higher.
        const targetHeartRate = this.targetHeartRate(difficulty, input.progress);
        // Higher difficulty -> faster, smoother approach to its target.
        const approach = clamp(lerp(0.6, 2.4, difficulty) * input.dt, 0, 1);
        this._heartRate = clamp(
            lerp(this._heartRate, targetHeartRate, approach),
            HEART_RATE_BOUNDS.min,
            HEART_RATE_BOUNDS.max,
        );
        this._heartRateZone = zoneForHeartRate(this._heartRate);

        if (this._depletionCooldown > 0) {
            this._depletionCooldown = Math.max(0, this._depletionCooldown - input.dt);
        }
        this.drainEnergy(difficulty, input.dt);
        this.regenEnergy(input.dt);
        this.refreshModifiers();
    }

    private targetHeartRate(difficulty: number, progress: number): number {
        const bounds = HEART_RATE_BOUNDS;
        if (this._phase === RacePhase.START) {
            // Climb toward the lower OPTIMAL edge quickly.
            return lerp(bounds.optimalLower - 6, bounds.optimalLower + 6, difficulty);
        }
        if (this._phase === RacePhase.SPRINT) {
            // Aggressive AI pushes into HIGH_PRESSURE / OVERLOAD near the finish.
            const base = lerp(bounds.optimalLower + 10, bounds.overloadLower, difficulty);
            const lateBoost = clamp(progress, 0, 1) * lerp(0, 8, difficulty);
            return clamp(base + lateBoost, bounds.min, bounds.max);
        }
        // PACE / RESULT: sit inside OPTIMAL, steadier at high difficulty.
        return lerp(bounds.optimalLower + 4, bounds.highPressureLower - 6, difficulty);
    }

    private drainEnergy(difficulty: number, dt: number) {
        // AI energy is a preset curve, not a gameplay result (doc 26.2).
        // Burn scales with current zone and is heavier in SPRINT for aggressive AI.
        const energyCfg = CONDITION_BALANCE.energy;
        const perSecond = energyCfg.drainPerStroke[this._heartRateZone] * 2;
        let drain = perSecond * dt;
        if (this._phase === RacePhase.SPRINT) {
            drain *= lerp(1.2, 3.0, difficulty);
        }
        const wasPositive = this._energy > 0;
        this._energy = clamp(this._energy - drain, 0, energyCfg.total);
        this._energyDepleted = this._energy <= 0;
        if (wasPositive && this._energyDepleted && this._depletionCooldown <= 0) {
            this._depletionCooldown = energyCfg.depletionCooldownSeconds;
        }
    }

    // Energy regen: same model as the player. All zones regen (LOW strongest);
    // SPRINT boosts all zones so AI also peaks at the finish instead of stalling.
    private regenEnergy(dt: number) {
        if (this._depletionCooldown > 0) {
            return;
        }
        const energyCfg = CONDITION_BALANCE.energy;
        let rate = energyCfg.regenPerZone[this._heartRateZone];
        if (this._phase === RacePhase.SPRINT) {
            rate += energyCfg.regenSprintBoost;
        }
        this._energy = clamp(this._energy + rate * dt, 0, energyCfg.total);
        this._energyDepleted = this._energy <= 0;
    }

    private refreshModifiers() {
        // Quality axis: driven ONLY by heart-rate zone (hand stability).
        this._qualityModifier = conditionQualityScale(this._heartRate);

        // Efficiency axis: energy curve, same formula as the player.
        const ratio = clamp(this._energy / CONDITION_BALANCE.energy.total, 0, 1);
        this._efficiencyModifier = conditionEfficiencyScale(ratio);
        this._cadenceModifier = energyDepletionCadenceScale(ratio);
    }

    // --- Readonly getters (same surface as PlayerConditionModel) ---
    get phase(): RacePhase { return this._phase; }
    get heartRate(): number { return this._heartRate; }
    get heartRateZone(): HeartRateZone { return this._heartRateZone; }
    get energy(): number { return this._energy; }
    get energyRatio(): number { return clamp(this._energy / CONDITION_BALANCE.energy.total, 0, 1); }
    get energyDepleted(): boolean { return this._energyDepleted; }
    get sprintTier(): SprintTier { return this._sprintTier; }
    get qualityModifier(): number { return this._qualityModifier; }
    get efficiencyModifier(): number { return this._efficiencyModifier; }
    get strokeCadenceScale(): number { return this._cadenceModifier; }
    get depletionCooldownRemaining(): number { return this._depletionCooldown; }

    readout(): ConditionReadout {
        return {
            heartRate: this._heartRate,
            heartRateZone: this._heartRateZone,
            energy: this._energy,
            energyDepleted: this._energyDepleted,
            sprintTier: this._sprintTier,
            qualityModifier: this._qualityModifier,
            efficiencyModifier: this._efficiencyModifier,
        };
    }
}
