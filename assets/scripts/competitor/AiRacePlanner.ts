import { AiCharacterStrategy, AiIntelligence, AI_PLANNER_TUNING } from './AiRaceConfig';

export type AiActionPlan = 'swim' | 'recover' | 'save' | 'sprint' | 'evade';
export type AiDecisionReason = 'pace' | 'heart' | 'budget' | 'finish' | 'contact' | 'exhausted';

// 快照由控制器原地填充；规划器不持有场景对象，也不写游戏状态。
export interface AiRaceObservation {
    distance: number;
    raceDistance: number;
    wallDistance: number;
    energy: number;
    energyTotal: number;
    heartRate: number;
    speed: number;
    infiniteStamina: boolean;
    supportsDolphin: boolean;
    dolphinReady: boolean;
    dolphinCost: number;
    dolphinRange: number;
    dolphinStrain: number;
    minDolphinSpace: number;
    kickDive: boolean;
    nearbyThreat: boolean;
    closeRace: boolean;
    strokeCostPerMeter: number;
}

export class AiRacePlanner {
    action: AiActionPlan = 'swim';
    reason: AiDecisionReason = 'pace';
    desiredEnergy = 0;
    sprintReserve = 0;
    wantsJump = false;
    private _stateSeconds = 0;
    private _readySeconds = 0;

    reset() {
        this.action = 'swim';
        this.reason = 'pace';
        this.desiredEnergy = this.sprintReserve = 0;
        this.wantsJump = false;
        this._stateSeconds = this._readySeconds = 0;
    }

    decide(s: Readonly<AiRaceObservation>, style: Readonly<AiCharacterStrategy>, skill: Readonly<AiIntelligence>, dt: number) {
        this._stateSeconds += dt;
        this._readySeconds = s.dolphinReady ? this._readySeconds + dt : 0;
        const remaining = Math.max(0, s.raceDistance - s.distance);
        const sprintDistance = (s.raceDistance > 200 ? style.sprint400 : style.sprint200)
            * Math.max(0.2, AI_PLANNER_TUNING.sprintDistanceScale);
        const costPerMeter = Math.max(0.25, Math.min(2.5, s.strokeCostPerMeter));
        this.sprintReserve = Math.min(s.energyTotal * 0.45, sprintDistance * costPerMeter);
        const beforeSprint = Math.max(0, remaining - sprintDistance);
        const paceLength = Math.max(1, s.raceDistance - sprintDistance);
        this.desiredEnergy = remaining <= sprintDistance
            ? remaining * costPerMeter
            : this.sprintReserve + Math.max(0, s.energyTotal - this.sprintReserve)
                * Math.pow(Math.min(1, beforeSprint / paceLength), style.budgetExponent);
        this.desiredEnergy = Math.min(s.energyTotal, this.desiredEnergy * Math.max(0.25, AI_PLANNER_TUNING.budgetScale));

        // 专家与变态具有足够精度时可容忍更高心率；这只改变取舍，不放宽判定。
        const precisionHeadroom = skill.id === 'extreme' ? 181 - style.heartTarget : skill.id === 'expert' ? 12 : 0;
        const heartTarget = Math.min(181, style.heartTarget + precisionHeadroom + AI_PLANNER_TUNING.heartTargetOffset);
        const canFinishOnArms = s.infiniteStamina || s.energy >= remaining * costPerMeter + 1;
        const sprint = remaining <= sprintDistance && canFinishOnArms;
        const budgetLow = !s.infiniteStamina && s.energy < this.desiredEnergy - skill.budgetTolerance;
        const block = Math.max(0.3, style.kickBlock * AI_PLANNER_TUNING.kickBlockScale);
        let next: AiActionPlan = 'swim';
        let reason: AiDecisionReason = 'pace';
        if (!s.infiniteStamina && s.energy <= 0) {
            next = 'save'; reason = 'exhausted';
        } else if (s.kickDive && s.nearbyThreat && !sprint) {
            next = 'evade'; reason = 'contact';
        } else if (sprint) {
            next = 'sprint'; reason = 'finish';
        } else if (s.heartRate >= heartTarget || (this.action === 'recover' && s.heartRate > style.heartRecovery)) {
            next = 'recover'; reason = 'heart';
        } else if (budgetLow) {
            next = 'save'; reason = 'budget';
        } else if (s.closeRace && remaining <= sprintDistance * 1.35 && canFinishOnArms) {
            next = 'sprint'; reason = 'finish';
        }
        if ((this.action === 'save' || this.action === 'recover' || this.action === 'evade')
            && this._stateSeconds < block && next === 'swim') {
            next = this.action;
            reason = this.reason;
        }
        if (next !== this.action) this._stateSeconds = 0;
        this.action = next;
        this.reason = reason;

        // 跳跃是正常体力支出；不能以满气为由掏空末程预算。初级允许较大预算偏差。
        const landingRemaining = Math.max(0, remaining - s.dolphinRange);
        const reserveAfterJump = Math.min(this.sprintReserve, landingRemaining * costPerMeter);
        const affordable = s.energy >= s.dolphinCost + reserveAfterJump
            && s.energy - s.dolphinCost >= this.desiredEnergy - s.dolphinRange * costPerMeter - skill.budgetTolerance;
        const fits = s.wallDistance >= Math.max(s.minDolphinSpace,
            s.dolphinRange + AI_PLANNER_TUNING.jumpSpaceMargin);
        const heartSafe = skill.id === 'extreme' || s.heartRate + s.dolphinStrain <= heartTarget + 15
            || this.action === 'recover';
        this.wantsJump = s.supportsDolphin && s.dolphinReady && fits && affordable && heartSafe
            && this._readySeconds >= skill.jumpDelay;
    }
}
