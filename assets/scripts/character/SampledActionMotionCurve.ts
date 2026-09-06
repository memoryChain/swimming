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

export const SAMPLED_ACTION_IDS = [
    'waving',
    'arm_stretching',
    'chicken_dance',
    'neck_stretching',
    'silly_dancing',
    'twist_dance',
    'waving_gesture',
    'ymca_dance',
    'dancing_twerk',
    'joyful_jump',
    'victory_idle',
    'victory',
    'angry',
    'defeated',
    'loser',
    'clapping',
    'excited',
    'happy',
    'waving_0713',
] as const;

export type SampledActionId = typeof SAMPLED_ACTION_IDS[number];

export type SampledActionMotionSample = {
    phase: number;
    hipTranslation: readonly [number, number, number];
    rotations: Readonly<Partial<Record<SampledActionBoneName, readonly [number, number, number, number]>>>;
    // Shared choreography metadata: bit 0 plants the left foot and bit 1
    // plants the right foot. Runtime solves that intent against each
    // canonicalized character's actual leg proportions.
    groundedFeet?: number;
    // Left/right support target relative to this character's own rest contact
    // plane. Shared actions currently use zero for planted feet.
    footContactHeights?: readonly [number, number];
    // 原始动作左右脚连续离地高度，以源髋部静止高度归一化；保留轻微抬脚，不替换跳台支撑标记。
    footLiftHeights?: readonly [number, number];
    // 左足、左趾、右足、右趾：源世界旋转相对源静止姿态的增量，已换算为模型 Y 向上坐标。
    // 应施加在当前角色自己的足部静止旋转上，不能直接当成骨骼局部旋转。
    footOrientationDeltas?: readonly [
        readonly [number, number, number, number], readonly [number, number, number, number],
        readonly [number, number, number, number], readonly [number, number, number, number],
    ];
};

export type SampledActionMotion = {
    id: SampledActionId;
    label: string;
    sourceFile: string;
    // Legacy curves contain absolute glTF node rotations/translations. Shared
    // T-pose curves contain base-relative rotations and normalized Hip deltas,
    // so characters may keep different bone lengths and rest translations.
    rotationSpace?: 'absolute-local' | 'base-relative';
    hipTranslationSpace?: 'absolute-local' | 'base-relative-normalized';
    durationSeconds: number;
    frameStart: number;
    frameEnd: number;
    sampleRateHz: number;
    samples: readonly SampledActionMotionSample[];
};

// The large sampled curves are race-bundle JSON assets. Keeping this module as a
// small type/registry index prevents them from entering the WeChat startup script.
const SAMPLED_DEBUG_ACTIONS_BY_ID: Partial<Record<SampledActionId, SampledActionMotion>> = {};

export function registerSampledDebugAction(action: SampledActionMotion) {
    SAMPLED_DEBUG_ACTIONS_BY_ID[action.id] = action;
}

export function haveAllSampledDebugActions(): boolean {
    return SAMPLED_ACTION_IDS.every((id) => Boolean(SAMPLED_DEBUG_ACTIONS_BY_ID[id]));
}

export function getLoadedSampledDebugActions(): readonly SampledActionMotion[] {
    return SAMPLED_ACTION_IDS
        .map((id) => SAMPLED_DEBUG_ACTIONS_BY_ID[id])
        .filter((action): action is SampledActionMotion => Boolean(action));
}

export function findSampledDebugAction(id: SampledActionId): SampledActionMotion | null {
    return SAMPLED_DEBUG_ACTIONS_BY_ID[id] ?? null;
}
