// 玩家体力按结算计数；心率只同步 Motor 的实际划频模型。

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
    energyAfterStrokes,
    energyAfterCost,
    conditionEfficiencyScale,
    conditionQualityScale,
    energyDepletionCadenceScale,
} from '../core/ConditionBalance';
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
    private _cadenceModifier = 1;
    private _energyTotalOverride: number | null = null;

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

    // 入水质量不再改变心率；初始值由 Motor 在开赛时统一重置为 80。
    applyDiveResult(_result: DiveResult) {}
    applyDolphinJumpStrain(_strainHr: number) {}

    // 成功技能一次性扣费，与划水计数独立；立即刷新耗尽倍率供同帧输入/快照使用。
    consumeEnergy(cost: number) {
        this._energy = energyAfterCost(this._energy, cost);
        this._energyDepleted = this._energy <= 0;
        this.refreshModifiers();
    }

    // 结算只扣体力，开始次数由 Motor 计算，避免同一划被重复计数。
    updateFromStroke(input: StrokeConditionInput) {
        if (!input.strokeAccepted) return;
        this.drainEnergyForStroke();
        this.refreshModifiers();
    }

    // 心率只消费实际运动模型，不能另跑一条显示曲线。
    syncHeartRate(value: number) {
        if (!Number.isFinite(value)) return;
        this._heartRate = clamp(value, HEART_RATE_BOUNDS.min, HEART_RATE_BOUNDS.max);
        this._heartRateZone = zoneForHeartRate(this._heartRate);
    }
    tick(_dt: number) { this.refreshModifiers(); }

    // Driven by the flow layer during SPRINT (doc 27.2).
    updateSprintState(input: SprintConditionInput) {
        this._sprintTier = input.sprintTier;
    }

    private drainEnergyForStroke() {
        this._energy = energyAfterStrokes(this._energy, 1);
        this._energyDepleted = this._energy <= 0;
    }

    private refreshModifiers() {
        // PERFECT 由 Motor 按每划心率快照处理，旧倍率保持中性。
        this._qualityModifier = conditionQualityScale(this._heartRate);

        // 只区分有体力与已耗尽，不随剩余比例逐渐衰减。
        const ratio = clamp(this._energy / this._effectiveEnergyTotal, 0, 1);
        this._efficiencyModifier = conditionEfficiencyScale(ratio);
        this._cadenceModifier = energyDepletionCadenceScale(ratio);
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
