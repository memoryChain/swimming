// AI 按实际划水结算次数扣体力，心率与玩家共用 Motor 中的实际划频模型。
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
    energyAfterStrokes,
    energyAfterCost,
    conditionEfficiencyScale,
    conditionQualityScale,
    energyDepletionCadenceScale,
} from '../core/ConditionBalance';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export class AiConditionModel {
    private _energyTotal = CONDITION_BALANCE.energy.total;
    get energyTotal(): number { return this._energyTotal; }
    // 身份／等级只在赛前或重新分配阵容时更新，不能在比赛内借此补体力。
    configureEnergyTotal(total: number) {
        this._energyTotal = Number.isFinite(total) ? Math.max(1, total) : CONDITION_BALANCE.energy.total;
        this.reset();
    }
    private _infiniteStamina = false;
    setInfiniteStamina(value: boolean) { this._infiniteStamina = value; }
    private _phase: RacePhase = RacePhase.START;
    private _heartRate = HEART_RATE_BOUNDS.min;
    private _heartRateZone: HeartRateZone = HeartRateZone.LOW;
    private _energy = CONDITION_BALANCE.energy.total;
    private _energyDepleted = false;
    private _sprintTier: SprintTier = SprintTier.STEADY;
    private _qualityModifier = 1;
    private _efficiencyModifier = 1;
    private _cadenceModifier = 1;

    reset() {
        this._phase = RacePhase.START;
        this._heartRate = HEART_RATE_BOUNDS.min;
        this._heartRateZone = HeartRateZone.LOW;
        this._energy = this._energyTotal;
        this._energyDepleted = false;
        this._sprintTier = SprintTier.STEADY;
        this._qualityModifier = 1;
        this._efficiencyModifier = 1;
        this._cadenceModifier = 1;
    }

    setPhase(phase: RacePhase) {
        this._phase = phase;
        if (phase !== RacePhase.SPRINT) {
            this._sprintTier = SprintTier.STEADY;
        }
        this.refreshModifiers();
    }

    applyDolphinJumpStrain(_strainHr: number) {}

    // 成功技能一次性扣费，与划水计数独立；立即刷新耗尽倍率供同帧输入/快照使用。
    consumeEnergy(cost: number) {
        if (this._infiniteStamina) return;
        this._energy = energyAfterCost(this._energy, cost);
        this._energyDepleted = this._energy <= 0;
        this.refreshModifiers();
    }
    syncHeartRate(value: number) {
        if (!Number.isFinite(value)) return;
        this._heartRate = clamp(value, HEART_RATE_BOUNDS.min, HEART_RATE_BOUNDS.max);
        this._heartRateZone = zoneForHeartRate(this._heartRate);
    }

    // 沿用既有网络字段；旧冷却字段保留占位，不再参与计算。
    applyAuthoritativeState(energyRatio: number, heartRate: number, _depletionCooldown = -1) {
        if (!Number.isFinite(energyRatio) || !Number.isFinite(heartRate)) return;
        this._energy = clamp(energyRatio, 0, 1) * this._energyTotal;
        this._heartRate = clamp(heartRate, HEART_RATE_BOUNDS.min, HEART_RATE_BOUNDS.max);
        this._heartRateZone = zoneForHeartRate(this._heartRate);
        this._energyDepleted = this._energy <= 0;
        this.refreshModifiers();
    }

    // 只接收真正 AI 的实际结算计数；远端真人始终采用 owner 体力。
    consumeStrokes(count: number) {
        if (!Number.isFinite(count) || count <= 0) return;
        if (this._infiniteStamina) return;
        this._energy = energyAfterStrokes(this._energy, count);
        this._energyDepleted = this._energy <= 0;
        this.refreshModifiers();
    }

    // 实际划水心率由 Motor 驱动；阶段和难度不再额外增压。
    tickAi(_input: AiConditionInput) { this.refreshModifiers(); }

    private refreshModifiers() {
        // PERFECT 由 Motor 按每划心率快照处理，旧倍率保持中性。
        this._qualityModifier = conditionQualityScale(this._heartRate);

        // 与玩家共用耗尽后的推进和动作轮速倍率。
        const ratio = clamp(this._energy / this._energyTotal, 0, 1);
        this._efficiencyModifier = conditionEfficiencyScale(ratio);
        this._cadenceModifier = energyDepletionCadenceScale(ratio);
    }

    // --- Readonly getters (same surface as PlayerConditionModel) ---
    get phase(): RacePhase { return this._phase; }
    get heartRate(): number { return this._heartRate; }
    get heartRateZone(): HeartRateZone { return this._heartRateZone; }
    get energy(): number { return this._energy; }
    get energyRatio(): number { return clamp(this._energy / this._energyTotal, 0, 1); }
    get energyDepleted(): boolean { return this._energyDepleted; }
    get sprintTier(): SprintTier { return this._sprintTier; }
    get qualityModifier(): number { return this._qualityModifier; }
    get efficiencyModifier(): number { return this._efficiencyModifier; }
    get strokeCadenceScale(): number { return this._cadenceModifier; }
    get depletionCooldownRemaining(): number { return 0; }

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
