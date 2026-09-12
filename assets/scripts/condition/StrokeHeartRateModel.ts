import { abilityValue } from '../core/CharacterAbilityConfig';
import { HEART_RATE_TRAITS, HEART_RATE_TUNING, HeartRateTraitId } from '../core/ConditionBalance';

/** 只记录实际开始的手臂动作。固定环形队列，不按按键或结算重复计数。 */
export class StrokeHeartRateModel {
    private readonly starts = new Float64Array(128);
    private head = 0;
    private count = 0;
    private clock = 0;
    private value = 80;

    private trait: HeartRateTraitId = 'balanced';
    private breathControl = false;
    setBreathControl(enabled: boolean) { this.breathControl = enabled; }

    setTrait(trait: HeartRateTraitId) { this.trait = HEART_RATE_TRAITS[trait] ? trait : 'balanced'; }
    get heartRateTrait(): HeartRateTraitId { return this.trait; }

    // 比赛重置清空负荷历史，保留已配置的角色特性。
    reset() { this.head = 0; this.count = 0; this.clock = 0; this.value = 80; }
    get heartRate(): number { return this.value; }
    get strokeRate(): number { return this.count / HEART_RATE_TUNING.sampleSeconds; }
    get targetHeartRate(): number {
        const load = this.breathControl && this.strokeRate <= abilityValue('coachMaxStrokeHz', 0.5, 4)
            ? abilityValue('coachHeartLoad', 0.1, 1) : 1;
        return Math.min(180, 80 + HEART_RATE_TUNING.bpmPerStrokeHz * this.strokeRate * load);
    }

    applyAuthoritative(value: number) {
        if (Number.isFinite(value) && value >= 0) this.value = Math.max(80, Math.min(180, value));
    }

    // 瞬时负担不伪造划水次数，不清空此前采样；异常/负配置不能变成回血。
    addBurden(amount: number) {
        if (Number.isFinite(amount) && amount > 0) this.value = Math.min(180, this.value + amount);
    }

    recordStart() {
        if (this.count === this.starts.length) {
            this.head = (this.head + 1) % this.starts.length;
            this.count--;
        }
        this.starts[(this.head + this.count) % this.starts.length] = this.clock;
        this.count++;
    }

    // 跳跃冻结数值但时间照走，旧起划记录照常过期，落水不补算冻结期间的恢复。
    tick(dt: number, freezeValue = false) {
        if (!(dt > 0) || !Number.isFinite(dt)) return;
        const end = this.clock + dt;
        // 在每个采样过期点分段积分，大帧和小帧的自然恢复相同。
        while (this.count > 0) {
            const expiry = this.starts[this.head] + HEART_RATE_TUNING.sampleSeconds;
            if (expiry > end + 1e-10) break;
            if (!freezeValue) this.approach(Math.max(0, expiry - this.clock));
            this.clock = Math.max(this.clock, Math.min(end, expiry));
            this.head = (this.head + 1) % this.starts.length;
            this.count--;
        }
        if (!freezeValue) this.approach(Math.max(0, end - this.clock));
        this.clock = end;
    }

    private approach(dt: number) {
        const target = this.targetHeartRate;
        const profile = HEART_RATE_TRAITS[this.trait];
        const seconds = HEART_RATE_TUNING[target > this.value ? profile.riseKey : profile.recoveryKey];
        this.value = target + (this.value - target) * Math.exp(-dt / Math.max(0.01, seconds));
    }
}
