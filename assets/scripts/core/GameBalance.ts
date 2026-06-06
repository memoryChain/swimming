import { Vec3 } from 'cc';

export const RACE_DISTANCE = 100;
export const COUNTDOWN_SECONDS = 5;
export const GLIDE_SECONDS = 0.72;

export const SWIMMER_BALANCE = {
    baseSpeed: 0.8,
    maxSpeed: 4,
    minSpeed: 0,
    maxSwimAccel: 1.85,
    strokeBaseAccel: 0.05,
    strokeStabilityAccel: 1.6,
    strokeAccelDurationRatio: 0.4,
    alternationWindowSize: 6,
    alternationBaseMinScale: 0.25,
    alternationStabilityMinScale: 0.1,
    poolDeceleration: 0.1,
    kickStartAccel: 2.45,
    baseDrag: 0.1,
    highSpeedDrag: 0.04,
    aiCruiseAccel: 2.2,
    perfectComboBoostInterval: 10,
    perfectComboSpeedBonus: 0.35,
    perfectComboMaxOvercap: 0.9,
    perfectComboOvercapDecay: 0.45,
    highSpeedDesyncPenalty: 1.15,
    playerRhythmMaxSpeedScale: 0.18,
    comboAccelScale: 0.7,
    kickLaunchDistanceStart: 15,
    kickLaunchDistanceEnd: 18,
    earlySyncPenaltyDuringKickLaunch: 0.72,
};

export const DIVE_BALANCE = {
    platformNodeOffset: new Vec3(-1.37, 0.53, 0),
    minDistance: 0.55,
    maxDistance: 1.85,
    minSpeed: 0.85,
    maxSpeed: 2.35,
    minHoldSeconds: 0.08,
    maxHoldSeconds: 1.1,
    minPower: 0.18,
    chargeCycleSeconds: 1.6,
    defaultFallbackHoldSeconds: 0.12,
    defaultAiPower: 0.72,
    defaultAiReactionSeconds: 0.14,
    aiReactionRandomSeconds: 0.08,
    aiPowerVariance: 0.08,
    aiPowerMin: 0.38,
    aiPowerMax: 0.96,
};

export const RHYTHM_BALANCE = {
    targetBpm: 156,
    maxComboBonus: 1.55,
    comboPerfectBonus: 0.045,
    comboGoodBonus: 0.015,
    holdPerfectBonus: 0.08,
    holdGoodBonus: 0.035,
    holdMissPenalty: 1,
    comboMissPenalty: 3,
    aiDifficulty: 0.86,
    aiBpmVariance: 12,
};

export const TARGET_INTERVAL = 60 / RHYTHM_BALANCE.targetBpm;

export function getTargetInterval(): number {
    return 60 / RHYTHM_BALANCE.targetBpm;
}
