import { STIMULANT_BRAWL_TUNING } from '../core/EntertainmentBalance';
import { StrokeHeartRateModel } from '../condition/StrokeHeartRateModel';
import { stimulantTurnDragScale, stimulantTurnImpulseScale, StimulantItemKind } from './StimulantBrawlRules';

/** 仅挂载娱乐调试时创建。独立于角色能力、主干数值和网络覆盖。 */
export class EntertainmentSwimmerEffects {
    private suppliesEnabled = true;
    setSuppliesEnabled(value: boolean) { this.suppliesEnabled = value; }
    private calmSeconds = 0;
    private environmentDrag = 0;
    private stepPropulsionScale = 1;
    reset() { this.calmSeconds = 0; this.environmentDrag = 0; this.stepPropulsionScale = 1; }
    setDrag(value: number) { this.environmentDrag = Number.isFinite(value) ? Math.max(0, value) : 0; }
    get drag() { return this.environmentDrag; }
    get propulsionScale() { return this.stepPropulsionScale; }
    tick(dt: number) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const covered = Math.min(dt, this.calmSeconds);
        this.stepPropulsionScale = 1 - (1 - STIMULANT_BRAWL_TUNING.calmSlushPropulsionScale) * covered / dt;
        this.calmSeconds = Math.max(0, this.calmSeconds - dt);
    }
    applySupply(kind: StimulantItemKind, heartRate: StrokeHeartRateModel) {
        if (!this.suppliesEnabled) return;
        if (kind === 'calm-slush') {
            heartRate.applyCooling(STIMULANT_BRAWL_TUNING.calmSlushHeartRateDrop);
            this.calmSeconds = STIMULANT_BRAWL_TUNING.calmSlushDuration;
            this.stepPropulsionScale = this.calmSeconds > 0 ? STIMULANT_BRAWL_TUNING.calmSlushPropulsionScale : 1;
        } else {
            heartRate.addBurden(STIMULANT_BRAWL_TUNING.heartRateBurden, STIMULANT_BRAWL_TUNING.heartRateRecoveryHoldSeconds);
        }
    }
    turnImpulseScale(hr: number) { return !this.suppliesEnabled || this.calmSeconds > 0 ? 1 : stimulantTurnImpulseScale(hr); }
    turnDragScale(hr: number) { return !this.suppliesEnabled || this.calmSeconds > 0 ? 1 : stimulantTurnDragScale(hr); }
}
