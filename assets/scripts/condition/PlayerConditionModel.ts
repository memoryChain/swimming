import { TUTORIAL_RUNTIME } from '../tutorial/TutorialSession';
// 玩家体力按结算计数；心率只同步 Motor 的实际划频模型。

import {
    ConditionReadout,
    HeartRateZone,
    RacePhase,
    StrokeConditionInput,
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
    private _tutorialEnergyEnd: number | null = null;
    // 教学以实际泳程分配固定体力预算，保证不同养成、失误次数、踢水玩法都在末段耗尽。
    setTutorialEnergyCourse(endDistance: number | null) {
        if (endDistance !== null && !TUTORIAL_RUNTIME.active) return;
        this._tutorialEnergyEnd = endDistance;
        this._tutorialDistance = 0;
    }
    private _tutorialDistance = 0;
    advanceTutorialEnergyCourse(distance: number) {
        if (!TUTORIAL_RUNTIME.active || this._tutorialEnergyEnd === null) return;
        this._tutorialDistance = Math.max(this._tutorialDistance, distance);
    }
    private consumeTutorialEnergy(): boolean {
        if (!this.tutorialEnergyCourse) return false;
        // 预算只在真实划水/技能扣费时兑现，踢水、停手和滑行不会自己扣体力。
        const ratio = Math.max(0, 1 - this._tutorialDistance / this._tutorialEnergyEnd!);
        if (ratio < this.energyRatio) this.setTutorialEnergyRatio(ratio);
        return true;
    }
    private get tutorialEnergyCourse(): boolean {
        return TUTORIAL_RUNTIME.active && this._tutorialEnergyEnd !== null;
    }
    private _infiniteStamina = false;
    setInfiniteStamina(value: boolean) { this._infiniteStamina = value; }
    private _phase: RacePhase = RacePhase.START;
    private _heartRate = HEART_RATE_BOUNDS.min;
    private _heartRateZone: HeartRateZone = HeartRateZone.LOW;
    private _energy = CONDITION_BALANCE.energy.total;
    private _energyDepleted = false;
    private _qualityModifier = 1;
    private _efficiencyModifier = 1;
    private _cadenceModifier = 1;
    private _energyTotalOverride: number | null = null;

    reset() {
        this._tutorialDistance = 0;
        // 起跳也会 reset；教学预算和角色能力一样由场景生命周期配置，离场再清除。
        this._phase = RacePhase.START;
        this._heartRate = HEART_RATE_BOUNDS.min;
        this._heartRateZone = HeartRateZone.LOW;
        this._energy = this._effectiveEnergyTotal;
        this._energyDepleted = false;
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
        this.refreshModifiers();
    }

    // 入水质量不再改变心率；初始值由 Motor 在开赛时统一重置为 80。
    applyDiveResult(_result: DiveResult) {}
    applyDolphinJumpStrain(_strainHr: number) {}

    // 成功技能一次性扣费，与划水计数独立；立即刷新耗尽倍率供同帧输入/快照使用。
    consumeEnergy(cost: number) {
        if (this._infiniteStamina || (cost > 0 && this.consumeTutorialEnergy())) return;
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

    private drainEnergyForStroke() {
        if (this._infiniteStamina || this.consumeTutorialEnergy()) return;
        this._energy = energyAfterStrokes(this._energy, 1);
        this._energyDepleted = this._energy <= 0;
    }

    private refreshModifiers() {
        // PERFECT 由 Motor 按每划心率快照处理，旧倍率保持中性。
        this._qualityModifier = conditionQualityScale(this._heartRate);

        // 只区分有体力与已耗尽；耗尽后推进与动作轮速一起减弱，不按剩余比例渐变。
        const ratio = clamp(this._energy / this._effectiveEnergyTotal, 0, 1);
        this._efficiencyModifier = conditionEfficiencyScale(ratio);
        this._cadenceModifier = energyDepletionCadenceScale(ratio);
    }

    // 教学状态对照只修改本场真实体力，不写账号养成或正式比赛参数。
    setTutorialEnergyRatio(ratio: number) {
        if (!TUTORIAL_RUNTIME.active || !Number.isFinite(ratio)) return;
        this._energy = this._effectiveEnergyTotal * clamp(ratio, 0, 1);
        this._energyDepleted = this._energy <= 0;
        this.refreshModifiers();
    }

    // --- Query getters (doc 27.4) ---
    get phase(): RacePhase { return this._phase; }
    get heartRate(): number { return this._heartRate; }
    get heartRateZone(): HeartRateZone { return this._heartRateZone; }
    get energy(): number { return this._energy; }
    get energyRatio(): number { return clamp(this._energy / this._effectiveEnergyTotal, 0, 1); }
    get energyDepleted(): boolean { return this._energyDepleted; }
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
            qualityModifier: this._qualityModifier,
            efficiencyModifier: this._efficiencyModifier,
        };
    }
}
