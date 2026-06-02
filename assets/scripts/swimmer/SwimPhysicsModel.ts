import { SWIMMER_BALANCE } from '../core/GameBalance';

export type SwimPhysicsState = {
    currentSpeed: number;
    distance: number;
    fatigue: number;
};

export type SwimPhysicsInput = {
    dt: number;
    isAI: boolean;
    aiPower: number;
    aiMaxSpeedScale: number;
    rhythmBonus: number;
    effortScore: number;
    syncScore: number;
    armInputRate: number;
    kickInputRate: number;
    targetLimbRate: number;
};

export class SwimPhysicsModel {
    step(state: SwimPhysicsState, input: SwimPhysicsInput): SwimPhysicsState {
        const fatigue = Math.min(SWIMMER_BALANCE.fatigueLimit, state.fatigue + input.dt * SWIMMER_BALANCE.fatigueRate);
        const rhythmBonus = input.isAI ? 0 : input.rhythmBonus;
        const maxSpeed = SWIMMER_BALANCE.maxSpeed * (input.isAI ? input.aiMaxSpeedScale : 1 + rhythmBonus * SWIMMER_BALANCE.playerRhythmMaxSpeedScale);
        const aiPower = input.isAI ? input.aiPower : 1;
        const speedRatio = clamp01(state.currentSpeed / maxSpeed);
        const accelLimit = 0.16 + 0.84 * (1 - Math.pow(speedRatio, 1.6));
        const syncedEffort = input.effortScore * input.syncScore;
        const kickEffort = clamp01(input.kickInputRate / input.targetLimbRate);
        const armEffort = clamp01(input.armInputRate / input.targetLimbRate);
        const kickLaunchPhase = 1 - smoothRange(state.distance, SWIMMER_BALANCE.kickLaunchDistanceStart, SWIMMER_BALANCE.kickLaunchDistanceEnd);
        const kickOnlyBias = kickEffort * (1 - armEffort) * kickLaunchPhase;
        const earlySyncScale = 1 - kickLaunchPhase * SWIMMER_BALANCE.earlySyncPenaltyDuringKickLaunch;
        const startAssist = 1 - smoothRange(speedRatio, 0.4, 0.58);
        const kickStartAccel = SWIMMER_BALANCE.kickStartAccel * kickEffort * startAssist;
        const kickOnlyLaunchAccel = SWIMMER_BALANCE.kickStartAccel * 0.9 * kickOnlyBias * startAssist;
        const comboAccelScale = 1 + rhythmBonus * SWIMMER_BALANCE.comboAccelScale;
        const accel = (SWIMMER_BALANCE.maxSwimAccel * syncedEffort * accelLimit * earlySyncScale + kickStartAccel + kickOnlyLaunchAccel) * (1 - fatigue) * aiPower * comboAccelScale;
        const dragRelief = Math.max(syncedEffort * 0.55, kickEffort * startAssist * 0.42);
        const aiDragScale = input.isAI ? Math.max(0.7, 1 - (aiPower - 1) * 0.32) : 1;
        const drag = (SWIMMER_BALANCE.baseDrag + SWIMMER_BALANCE.highSpeedDrag * speedRatio) * (1 - dragRelief) * aiDragScale;
        const highSpeedPenaltyScale = smoothRange(speedRatio, 0.68, 0.98);
        const activeInput = clamp01((input.armInputRate + input.kickInputRate) / (input.targetLimbRate * 2));
        const desyncPenalty = SWIMMER_BALANCE.highSpeedDesyncPenalty * (1 - input.syncScore) * highSpeedPenaltyScale * activeInput;
        const currentSpeed = clamp(state.currentSpeed + (accel - drag - desyncPenalty) * input.dt, SWIMMER_BALANCE.minSpeed, maxSpeed);

        return {
            currentSpeed,
            distance: state.distance,
            fatigue,
        };
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
    return clamp(value, 0, 1);
}

function smoothRange(value: number, start: number, end: number): number {
    if (value <= start) {
        return 0;
    }
    if (value >= end) {
        return 1;
    }
    const t = (value - start) / (end - start);
    return t * t * (3 - 2 * t);
}
