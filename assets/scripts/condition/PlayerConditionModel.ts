// PlayerConditionModel: the player heart-rate + energy state layer (doc 23/27).
// Pure data object, no Cocos types. Driven by the flow/game layer, never holds
// a back-reference to Swimmer. Inputs arrive via updateFromStroke (event-driven)
// and tick (per-frame drift); outputs are read through the getters.

import {
    ConditionReadout,
    HeartRateZone,
    RacePhase,
    SprintTier,
    StrokeConditionInput,
    SprintConditionInput,
    HEART_RATE_BOUNDS,
    zoneForHeartRate,
} from './ConditionTypes';
import { CONDITION_BALANCE, CONDITION_PHASE_TUNING, energyDepletionCadenceScale } from '../core/ConditionBalance';
import { DiveResult } from '../core/DiveResult';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export class PlayerConditionModel {
    private _phase: RacePhase = RacePhase.START;
    private _heartRate = HEART_RATE_BOUNDS.min;
    private _heartRateZone: HeartRateZone = HeartRateZone.LOW;
    private _energy = CONDITION_BALANCE.energy.total;
    private _energyDepleted = false;
    private _sprintTier: SprintTier = SprintTier.STEADY;
    private _qualityModifier = 1;
    private _efficiencyModifier = 1;
    private _energyTotalOverride: number | null = null;
    private _depletionCooldown = 0;

    // Internal drift bookkeeping (doc 27.2: not exposed).
    private _lastQualityScore = 0;
    private _timeSinceLastStroke = 0;
    private _effortSample = 0;
    private _strokesSinceDive = 0;
    private _startupWobbleModifier = 1;
    private _optimalEntryStrokes = 0;

    reset() {
        this._phase = RacePhase.START;
        this._heartRate = HEART_RATE_BOUNDS.min;
        this._heartRateZone = HeartRateZone.LOW;
        this._energy = this._effectiveEnergyTotal;
        this._energyDepleted = false;
        this._sprintTier = SprintTier.STEADY;
        this._qualityModifier = 1;
        this._efficiencyModifier = 1;
        this._lastQualityScore = 0;
        this._timeSinceLastStroke = 0;
        this._effortSample = 0;
        this._strokesSinceDive = 0;
        this._startupWobbleModifier = 1;
        this._optimalEntryStrokes = 0;
        this._depletionCooldown = 0;
    }

    setProgressionOverrides(opts: { energyTotal?: number } | null) {
        this._energyTotalOverride = opts?.energyTotal ?? null;
    }

    private get _effectiveEnergyTotal(): number {
        return this._energyTotalOverride ?? CONDITION_BALANCE.energy.total;
    }

    setPhase(phase: RacePhase) {
        this._phase = phase;
        if (phase !== RacePhase.SPRINT) {
            this._sprintTier = SprintTier.STEADY;
        }
        this.refreshModifiers();
    }

    // Maps the dive outcome onto the opening heart-rate state (doc 24.4 / 29.3).
    applyDiveResult(result: DiveResult) {
        this._heartRate = clamp(result.heartRateStartModifier, HEART_RATE_BOUNDS.min, HEART_RATE_BOUNDS.max);
        this._heartRateZone = zoneForHeartRate(this._heartRate);
        this._startupWobbleModifier = result.heartRateStartupWobbleModifier;
        this._optimalEntryStrokes = result.optimalZoneEntryModifier;
        this._strokesSinceDive = 0;
        this.refreshModifiers();
    }

    // 海豚跃起跳瞬间的心率爆发：从当前心率加 strainHr、封顶 200，不碰体力。
    // 只在起跳上升沿调用一次；之后心率按 tick 自然回落（空中不再抑制）。
    applyDolphinJumpStrain(strainHr: number) {
        if (!Number.isFinite(strainHr) || strainHr <= 0) {
            return;
        }
        this._heartRate = clamp(this._heartRate + strainHr, HEART_RATE_BOUNDS.min, HEART_RATE_BOUNDS.max);
        this._heartRateZone = zoneForHeartRate(this._heartRate);
        this.refreshModifiers();
    }

    // Event-driven: called once per stroke settlement (doc 27.2).
    updateFromStroke(input: StrokeConditionInput) {
        if (!input.strokeAccepted) {
            return;
        }
        this._lastQualityScore = input.qualityScore;
        this._timeSinceLastStroke = 0;
        this._strokesSinceDive += 1;

        const hr = CONDITION_BALANCE.heartRate;

        // Startup wobble: first strokes after a dive use the dive wobble modifier,
        // which inflates the effort sample so HR is jittery right after entry.
        const inStartupWindow = this._strokesSinceDive <= hr.startupStrokeWindow;
        const wobble = inStartupWindow ? this._startupWobbleModifier : 1;

        // Strokes refresh the *sustained effort* sample (0..~1) instead of directly
        // adding HR. tick() then eases HR toward a target derived from this sample,
        // so a steady rhythm reaches an equilibrium rather than ratcheting to 100.
        const effort = clamp(input.pressureScore * wobble, 0, 1.8);
        this._effortSample = Math.max(this._effortSample, effort);

        this.drainEnergyForStroke();
        this._heartRateZone = zoneForHeartRate(this._heartRate);
        this.refreshModifiers();
    }

    // Per-frame: natural heart-rate drift toward LOW when not stroking (doc 27.2).
    tick(dt: number) {
        this._timeSinceLastStroke += dt;
        const hr = CONDITION_BALANCE.heartRate;
        const phaseTuning = CONDITION_PHASE_TUNING[this._phase];

        // The effort sample fades when strokes stop, so the HR target falls back
        // toward rest and the swimmer recovers between bursts.
        this._effortSample = Math.max(0, this._effortSample - hr.effortDecayPerSecond * dt);

        // Target HR is interpolated from sustained effort; phase push-scale biases
        // it upward (SPRINT runs hotter).
        const effort = clamp(this._effortSample * phaseTuning.hrPushScale, 0, 1.8);
        const target = clamp(
            hr.restTargetHr + (hr.maxEffortTargetHr - hr.restTargetHr) * effort,
            HEART_RATE_BOUNDS.min,
            HEART_RATE_BOUNDS.max,
        );

        // Ease toward the target; climbing is faster than recovery (driftScale tunes recovery).
        if (this._heartRate < target) {
            this._heartRate = Math.min(target, this._heartRate + hr.easeUpPerSecond * dt);
        } else {
            const step = hr.easeDownPerSecond * phaseTuning.hrDriftScale * dt;
            this._heartRate = Math.max(target, this._heartRate - step);
        }
        this._heartRate = clamp(this._heartRate, HEART_RATE_BOUNDS.min, HEART_RATE_BOUNDS.max);

        this._heartRateZone = zoneForHeartRate(this._heartRate);

        // Energy regeneration: all heart-rate zones regen (LOW strongest).
        // SPRINT boosts all zones so the finish is an all-out peak, not a crawl.
        if (this._depletionCooldown > 0) {
            this._depletionCooldown = Math.max(0, this._depletionCooldown - dt);
        }
        this.regenEnergy(dt);
        this.refreshModifiers();
    }

    // Driven by the flow layer during SPRINT (doc 27.2).
    updateSprintState(input: SprintConditionInput) {
        this._sprintTier = input.sprintTier;
    }

    private drainEnergyForStroke() {
        const energyCfg = CONDITION_BALANCE.energy;
        let drain = energyCfg.drainPerStroke[this._heartRateZone];
        if (this._phase === RacePhase.SPRINT) {
            drain *= energyCfg.sprintTierMultiplier[this._sprintTier];
        }
        const wasPositive = this._energy > 0;
        this._energy = clamp(this._energy - drain, 0, this._effectiveEnergyTotal);
        this._energyDepleted = this._energy <= 0;
        if (wasPositive && this._energyDepleted && this._depletionCooldown <= 0) {
            this._depletionCooldown = CONDITION_BALANCE.energy.depletionCooldownSeconds;
        }
    }

    private refreshModifiers() {
        // Quality axis: driven ONLY by heart-rate zone (hand stability).
        // Energy depletion does NOT affect quality - the two axes are orthogonal.
        this._qualityModifier = CONDITION_BALANCE.quality.zoneModifier[this._heartRateZone];

        // Efficiency axis: driven by ENERGY (muscle fuel), not heart rate.
        // Slow-start curve: efficiency = floor + (1-floor) * ratio^exponent.
        const eff = CONDITION_BALANCE.efficiency;
        const ratio = clamp(this._energy / this._effectiveEnergyTotal, 0, 1);
        this._efficiencyModifier = eff.energyFloor + (1 - eff.energyFloor) * Math.pow(ratio, eff.curveExponent);
    }

    // Energy regen: all zones regen (LOW strongest); SPRINT boosts all zones.
    private regenEnergy(dt: number) {
        if (this._depletionCooldown > 0) {
            return;
        }
        const energyCfg = CONDITION_BALANCE.energy;
        // All zones regen, but LOW regenerates the most. SPRINT boosts all zones
        // so the finish feels like an all-out peak regardless of how hard you push.
        let rate = energyCfg.regenPerZone[this._heartRateZone];
        if (this._phase === RacePhase.SPRINT) {
            rate += energyCfg.regenSprintBoost;
        }
        this._energy = clamp(this._energy + rate * dt, 0, this._effectiveEnergyTotal);
        this._energyDepleted = this._energy <= 0;
    }

    // --- Query getters (doc 27.4) ---
    get phase(): RacePhase { return this._phase; }
    get heartRate(): number { return this._heartRate; }
    get heartRateZone(): HeartRateZone { return this._heartRateZone; }
    get energy(): number { return this._energy; }
    get energyRatio(): number { return clamp(this._energy / this._effectiveEnergyTotal, 0, 1); }
    get energyDepleted(): boolean { return this._energyDepleted; }
    get sprintTier(): SprintTier { return this._sprintTier; }
    get qualityModifier(): number { return this._qualityModifier; }
    get efficiencyModifier(): number { return this._efficiencyModifier; }

    get strokeCadenceScale(): number {
        return energyDepletionCadenceScale(this.energyRatio);
    }

    get speedCapScale(): number {
        const eff = CONDITION_BALANCE.efficiency;
        const ratio = clamp(this._energy / this._effectiveEnergyTotal, 0, 1);
        return eff.speedCapFloor + (1 - eff.speedCapFloor) * Math.pow(ratio, eff.curveExponent);
    }

    // --- Derived helpers (doc 23.8) ---
    isOptimal(): boolean {
        return this._heartRateZone === HeartRateZone.OPTIMAL;
    }

    isOverloaded(): boolean {
        return this._heartRateZone === HeartRateZone.OVERLOAD;
    }

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
