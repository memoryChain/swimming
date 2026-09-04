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
import {
    CONDITION_BALANCE,
    CONDITION_PHASE_TUNING,
    conditionEfficiencyScale,
    conditionQualityScale,
    energyDepletionCadenceScale,
} from '../core/ConditionBalance';
import { DiveResult } from '../core/DiveResult';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function smoothstep01(value: number): number {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
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
    private _cadenceModifier = 1;
    private _energyTotalOverride: number | null = null;
    private _depletionCooldown = 0;
    // Phase-local clock used only for the SPRINT heart-rate ramp. It never
    // participates in the uniform continuous-swim load.
    private _phaseElapsed = 0;

    // Internal drift bookkeeping (doc 27.2: not exposed).
    private _lastQualityScore = 0;
    private _timeSinceLastStroke = 0;
    private _effortSample = 0;
    // Slow, uniform extra target-HR accumulated only while accepted strokes keep
    // arriving inside the configured continuity window. Unlike the effort sample,
    // this deliberately carries across a long continuous swim.
    private _sustainedLoadHr = 0;
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
        this._cadenceModifier = 1;
        this._lastQualityScore = 0;
        this._timeSinceLastStroke = 0;
        this._effortSample = 0;
        this._sustainedLoadHr = 0;
        this._strokesSinceDive = 0;
        this._startupWobbleModifier = 1;
        this._optimalEntryStrokes = 0;
        this._depletionCooldown = 0;
        this._phaseElapsed = 0;
    }

    setProgressionOverrides(opts: { energyTotal?: number } | null) {
        this._energyTotalOverride = opts?.energyTotal ?? null;
    }

    private get _effectiveEnergyTotal(): number {
        return this._energyTotalOverride ?? CONDITION_BALANCE.energy.total;
    }

    setPhase(phase: RacePhase) {
        if (this._phase !== phase) {
            this._phaseElapsed = 0;
        }
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

    // Event-driven: a successful dolphin jump adds an immediate heart-rate spike.
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

    // Per-frame: immediate effort and long-term continuous-swim load combine into
    // the target heart rate. The long-term layer intentionally ignores race phase,
    // so entering SPRINT does not accelerate its accumulation.
    tick(dt: number) {
        const step = Math.max(0, dt);
        this._phaseElapsed += step;
        this._timeSinceLastStroke += step;
        const hr = CONDITION_BALANCE.heartRate;
        const phaseTuning = CONDITION_PHASE_TUNING[this._phase];

        // The effort sample fades when strokes stop, so the HR target falls back
        // toward rest and the swimmer recovers between bursts.
        this._effortSample = Math.max(0, this._effortSample - hr.effortDecayPerSecond * step);

        const sustainedSwimActive = this._strokesSinceDive > 0
            && this._timeSinceLastStroke <= Math.max(0, hr.sustainedLoadStrokeGraceSeconds);
        const sustainedLoadDelta = sustainedSwimActive
            ? Math.max(0, hr.sustainedLoadGainBpmPerSecond) * step
            : -Math.max(0, hr.sustainedLoadRecoveryBpmPerSecond) * step;
        this._sustainedLoadHr = clamp(
            this._sustainedLoadHr + sustainedLoadDelta,
            0,
            Math.max(0, hr.sustainedLoadMaxBpm),
        );

        // Target HR is interpolated from sustained effort. SPRINT begins at the
        // PACE scale and smoothly ramps its extra pressure in, so crossing the
        // phase threshold no longer produces an unexplained target jump.
        let pushScale = phaseTuning.hrPushScale;
        if (this._phase === RacePhase.SPRINT) {
            const sprint = CONDITION_BALANCE.sprint;
            const rampSeconds = Math.max(0.01, sprint.heartRateRampSeconds);
            const ramp = smoothstep01(this._phaseElapsed / rampSeconds);
            pushScale += (Math.max(pushScale, sprint.heartRatePushScaleMax) - pushScale) * ramp;
        }
        const effort = clamp(this._effortSample * pushScale, 0, 1.8);
        const immediateTarget = clamp(
            hr.restTargetHr + (hr.maxEffortTargetHr - hr.restTargetHr) * effort,
            HEART_RATE_BOUNDS.min,
            HEART_RATE_BOUNDS.max,
        );
        const target = clamp(
            immediateTarget + this._sustainedLoadHr,
            HEART_RATE_BOUNDS.min,
            Math.min(HEART_RATE_BOUNDS.max, Math.max(HEART_RATE_BOUNDS.min, hr.targetHrCap)),
        );

        // Ease toward the target; climbing is faster than recovery (driftScale tunes recovery).
        if (this._heartRate < target) {
            this._heartRate = Math.min(target, this._heartRate + hr.easeUpPerSecond * step);
        } else {
            const recoveryStep = hr.easeDownPerSecond * phaseTuning.hrDriftScale * step;
            this._heartRate = Math.max(target, this._heartRate - recoveryStep);
        }
        this._heartRate = clamp(this._heartRate, HEART_RATE_BOUNDS.min, HEART_RATE_BOUNDS.max);

        this._heartRateZone = zoneForHeartRate(this._heartRate);

        // Energy regeneration: all heart-rate zones regen (LOW strongest).
        // SPRINT boosts all zones so the finish is an all-out peak, not a crawl.
        if (this._depletionCooldown > 0) {
            this._depletionCooldown = Math.max(0, this._depletionCooldown - step);
        }
        this.regenEnergy(step);
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
            this._depletionCooldown = energyCfg.depletionCooldownSeconds;
        }
    }

    private refreshModifiers() {
        // Quality axis: driven ONLY by heart-rate zone (hand stability).
        // Energy depletion does NOT affect quality - the two axes are orthogonal.
        this._qualityModifier = conditionQualityScale(this._heartRate);

        // Efficiency axis: driven by ENERGY (muscle fuel), not heart rate.
        // Slow-start curve: efficiency = floor + (1-floor) * ratio^exponent.
        const ratio = clamp(this._energy / this._effectiveEnergyTotal, 0, 1);
        this._efficiencyModifier = conditionEfficiencyScale(ratio);
        this._cadenceModifier = energyDepletionCadenceScale(ratio);
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
    get strokeCadenceScale(): number { return this._cadenceModifier; }
    // This is a phase reward, not a heart-rate reward: it stays active even if
    // accumulated load later moves the swimmer out of the OPTIMAL HR zone.
    get sprintPropulsionScale(): number {
        return this._phase === RacePhase.SPRINT
            ? Math.max(1, CONDITION_BALANCE.sprint.propulsionScale)
            : 1;
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
