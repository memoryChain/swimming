import { TARGET_INTERVAL } from './GameBalance';

export const INPUT_TUNING = {
    padStrokeDedupeMs: 45,
    inputRateWindowSeconds: 1.2,
    rhythmPerfectWindowSeconds: 0.08,
    rhythmGoodWindowSeconds: 0.18,
    rhythmLooseWindowSeconds: 0.52,
};

export const TARGET_LIMB_RATE = 1 / (TARGET_INTERVAL * 2);
