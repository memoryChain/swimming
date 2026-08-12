// UltimateEnergyModel: 赛内“大招能量”（蓄气）状态层。
// 纯数据对象，无 Cocos 类型。由 Swimmer 驱动，不持有 Swimmer 反向引用。
// 输入：每帧 tick（被动增长）、每次划水结算 addStrokeRating、被撞 addCollisionBonus。
// 输出：energy（0..max）、canAffordDolphin、denied 闪烁标志。

import { Rating } from '../core/GameConstants';
import { ULTIMATE_ENERGY_BALANCE, energyGainMultiplier } from '../core/UltimateEnergyBalance';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export class UltimateEnergyModel {
    private _energy = 0;
    private _gainAptitude = 50;
    private _gainMultiplier = 1;
    private _deniedFlash = false;
    private _simulationSeconds = 0;
    private _lastCollisionBonusAt = Number.NEGATIVE_INFINITY;
    private _totalGenerated = 0;
    private _spentByDolphin = 0;
    private _spentByUltimate = 0;
    private _dolphinUses = 0;
    private _ultimateUses = 0;

    reset() {
        this._energy = 0;
        this._deniedFlash = false;
        this._simulationSeconds = 0;
        this._lastCollisionBonusAt = Number.NEGATIVE_INFINITY;
        this._totalGenerated = 0;
        this._spentByDolphin = 0;
        this._spentByUltimate = 0;
        this._dolphinUses = 0;
        this._ultimateUses = 0;
    }

    // 蓄气资质（0-100，纯资质不随等级成长）。
    setGainAptitude(aptitude: number) {
        this._gainAptitude = clamp(aptitude, 0, 100);
        this._gainMultiplier = energyGainMultiplier(this._gainAptitude);
    }

    get gainAptitude(): number {
        return this._gainAptitude;
    }

    get gainMultiplier(): number {
        return this._gainMultiplier;
    }

    get energy(): number {
        return this._energy;
    }

    get normalized(): number {
        return clamp(this._energy / ULTIMATE_ENERGY_BALANCE.maxEnergy, 0, 1);
    }

    get canAffordDolphin(): boolean {
        return this._energy >= ULTIMATE_ENERGY_BALANCE.dolphinCost;
    }

    get canActivateUltimate(): boolean {
        return this._energy >= ULTIMATE_ENERGY_BALANCE.maxEnergy;
    }

    get telemetry(): Readonly<{
        generated: number;
        dolphinSpent: number;
        ultimateSpent: number;
        dolphinUses: number;
        ultimateUses: number;
    }> {
        return {
            generated: this._totalGenerated,
            dolphinSpent: this._spentByDolphin,
            ultimateSpent: this._spentByUltimate,
            dolphinUses: this._dolphinUses,
            ultimateUses: this._ultimateUses,
        };
    }

    // 被动增长：所有角色每秒固定获得（低保），乘以角色积攒倍率。
    tick(dt: number) {
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this._simulationSeconds += step;
        this.add(ULTIMATE_ENERGY_BALANCE.passivePerSecond * step);
    }

    // 一次划水结算的积攒。combo 为该击之后的连续 PERFECT 数（用于每 N 连击额外奖励）。
    addStrokeRating(rating: Rating, combo: number) {
        const b = ULTIMATE_ENERGY_BALANCE;
        if (rating === Rating.PERFECT) {
            this.add(b.perfectGain);
            if (combo > 0 && combo % b.comboEvery === 0) {
                this.add(b.comboBonus);
            }
        } else if (rating === Rating.GOOD) {
            this.add(b.goodGain);
        }
    }

    // 被撞飞补偿：冲量足够大且距上次补偿超过冷却才给，避免贴身摩擦刷能量。
    addCollisionBonus(receivedImpulse: number) {
        if (receivedImpulse < ULTIMATE_ENERGY_BALANCE.collisionMinImpulse) {
            return;
        }
        const cooldownSeconds = ULTIMATE_ENERGY_BALANCE.collisionCooldownMs / 1000;
        if (this._simulationSeconds - this._lastCollisionBonusAt < cooldownSeconds) {
            return;
        }
        this._lastCollisionBonusAt = this._simulationSeconds;
        this.add(ULTIMATE_ENERGY_BALANCE.collisionBonus);
    }

    // 能量不足时标记一次“拒绝”，供 UI 闪红。
    flagDolphinDenied() {
        this._deniedFlash = true;
    }

    flagUltimateDenied() {
        this._deniedFlash = true;
    }

    // 消费并清除拒绝闪烁标志（UI 每帧查询）。
    consumeDeniedFlash(): boolean {
        if (this._deniedFlash) {
            this._deniedFlash = false;
            return true;
        }
        return false;
    }

    // 真正起跳时扣费（由 Swimmer 在相位控制器确认可跳之后调用）。
    spendDolphin() {
        const spent = Math.min(this._energy, ULTIMATE_ENERGY_BALANCE.dolphinCost);
        this._energy = clamp(this._energy - spent, 0, ULTIMATE_ENERGY_BALANCE.maxEnergy);
        this._spentByDolphin += spent;
        this._dolphinUses++;
    }

    spendUltimate() {
        const spent = this._energy;
        this._energy = 0;
        this._spentByUltimate += spent;
        this._ultimateUses++;
    }

    // 联机：把本地预测能量朝权威值校正（真人取 owner，AI 取 host）。
    applyNetEnergy(target: number, blend = 0.5) {
        if (!Number.isFinite(target) || target < 0) {
            return;
        }
        const clamped = clamp(target, 0, ULTIMATE_ENERGY_BALANCE.maxEnergy);
        const diff = clamped - this._energy;
        if (Math.abs(diff) > 15) {
            this._energy = clamped;
        } else if (Math.abs(diff) > 0.01) {
            this._energy = clamp(this._energy + diff * blend, 0, ULTIMATE_ENERGY_BALANCE.maxEnergy);
        }
    }

    private add(amount: number) {
        if (!Number.isFinite(amount) || amount <= 0) {
            return;
        }
        const before = this._energy;
        this._energy = clamp(before + amount * this._gainMultiplier, 0, ULTIMATE_ENERGY_BALANCE.maxEnergy);
        this._totalGenerated += Math.max(0, this._energy - before);
    }
}
