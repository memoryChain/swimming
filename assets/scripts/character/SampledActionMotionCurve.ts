import { WAVING_SAMPLED_ACTION } from './sampled-actions/waving';
import { ARM_STRETCHING_SAMPLED_ACTION } from './sampled-actions/arm_stretching';
import { CHICKEN_DANCE_SAMPLED_ACTION } from './sampled-actions/chicken_dance';
import { NECK_STRETCHING_SAMPLED_ACTION } from './sampled-actions/neck_stretching';
import { SILLY_DANCING_SAMPLED_ACTION } from './sampled-actions/silly_dancing';
import { TWIST_DANCE_SAMPLED_ACTION } from './sampled-actions/twist_dance';
import { WAVING_GESTURE_SAMPLED_ACTION } from './sampled-actions/waving_gesture';
import { YMCA_DANCE_SAMPLED_ACTION } from './sampled-actions/ymca_dance';

export type SampledActionBoneName =
    | 'Root'
    | 'Hip'
    | 'Waist'
    | 'Spine01'
    | 'Spine02'
    | 'NeckTwist01'
    | 'Head'
    | 'L_Clavicle'
    | 'L_Upperarm'
    | 'L_Forearm'
    | 'L_Hand'
    | 'R_Clavicle'
    | 'R_Upperarm'
    | 'R_Forearm'
    | 'R_Hand'
    | 'L_Thigh'
    | 'L_Calf'
    | 'L_Foot'
    | 'L_ToeBase'
    | 'R_Thigh'
    | 'R_Calf'
    | 'R_Foot'
    | 'R_ToeBase'
;

export type SampledActionId = 'waving' | 'arm_stretching' | 'chicken_dance' | 'neck_stretching' | 'silly_dancing' | 'twist_dance' | 'waving_gesture' | 'ymca_dance';

export type SampledActionMotionSample = {
    phase: number;
    hipTranslation: readonly [number, number, number];
    rotations: Readonly<Partial<Record<SampledActionBoneName, readonly [number, number, number, number]>>>;
};

export type SampledActionMotion = {
    id: SampledActionId;
    label: string;
    sourceFile: string;
    durationSeconds: number;
    frameStart: number;
    frameEnd: number;
    sampleRateHz: number;
    samples: readonly SampledActionMotionSample[];
};

// Generated index. Each action's samples live in its own file under sampled-actions/.
export const SAMPLED_DEBUG_ACTIONS: readonly SampledActionMotion[] = [
    WAVING_SAMPLED_ACTION,
    ARM_STRETCHING_SAMPLED_ACTION,
    CHICKEN_DANCE_SAMPLED_ACTION,
    NECK_STRETCHING_SAMPLED_ACTION,
    SILLY_DANCING_SAMPLED_ACTION,
    TWIST_DANCE_SAMPLED_ACTION,
    WAVING_GESTURE_SAMPLED_ACTION,
    YMCA_DANCE_SAMPLED_ACTION,
];

const SAMPLED_DEBUG_ACTIONS_BY_ID: Readonly<Record<SampledActionId, SampledActionMotion>> = {
    waving: WAVING_SAMPLED_ACTION,
    arm_stretching: ARM_STRETCHING_SAMPLED_ACTION,
    chicken_dance: CHICKEN_DANCE_SAMPLED_ACTION,
    neck_stretching: NECK_STRETCHING_SAMPLED_ACTION,
    silly_dancing: SILLY_DANCING_SAMPLED_ACTION,
    twist_dance: TWIST_DANCE_SAMPLED_ACTION,
    waving_gesture: WAVING_GESTURE_SAMPLED_ACTION,
    ymca_dance: YMCA_DANCE_SAMPLED_ACTION,
};

export function findSampledDebugAction(id: SampledActionId): SampledActionMotion | null {
    return SAMPLED_DEBUG_ACTIONS_BY_ID[id] ?? null;
}
