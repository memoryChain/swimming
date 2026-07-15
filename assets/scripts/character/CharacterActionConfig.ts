import type { SampledActionId } from './SampledActionMotionCurve';

// Stable game-facing action ids. Every enum value must map to a sampled action
// before it can be used by a runtime pool.
export enum CharacterAction {
    Waving = 'waving',
    ArmStretching = 'arm_stretching',
    ChickenDance = 'chicken_dance',
    NeckStretching = 'neck_stretching',
    SillyDancing = 'silly_dancing',
    TwistDance = 'twist_dance',
    WavingGesture = 'waving_gesture',
    YmcaDance = 'ymca_dance',
    DancingTwerk = 'dancing_twerk',
    JoyfulJump = 'joyful_jump',
    VictoryIdle = 'victory_idle',
    Victory = 'victory',
    Angry = 'angry',
    Defeated = 'defeated',
    Loser = 'loser',
    Clapping = 'clapping',
    Excited = 'excited',
    Happy = 'happy',
    Waving0713 = 'waving_0713',
}

export const CHARACTER_ACTION_SAMPLE_IDS: Readonly<Record<CharacterAction, SampledActionId>> = {
    [CharacterAction.Waving]: 'waving',
    [CharacterAction.ArmStretching]: 'arm_stretching',
    [CharacterAction.ChickenDance]: 'chicken_dance',
    [CharacterAction.NeckStretching]: 'neck_stretching',
    [CharacterAction.SillyDancing]: 'silly_dancing',
    [CharacterAction.TwistDance]: 'twist_dance',
    [CharacterAction.WavingGesture]: 'waving_gesture',
    [CharacterAction.YmcaDance]: 'ymca_dance',
    [CharacterAction.DancingTwerk]: 'dancing_twerk',
    [CharacterAction.JoyfulJump]: 'joyful_jump',
    [CharacterAction.VictoryIdle]: 'victory_idle',
    [CharacterAction.Victory]: 'victory',
    [CharacterAction.Angry]: 'angry',
    [CharacterAction.Defeated]: 'defeated',
    [CharacterAction.Loser]: 'loser',
    [CharacterAction.Clapping]: 'clapping',
    [CharacterAction.Excited]: 'excited',
    [CharacterAction.Happy]: 'happy',
    [CharacterAction.Waving0713]: 'waving_0713',
};

// The inverse record makes a newly generated SampledActionId a compile error
// until it is also represented by the game-facing enum above.
export const CHARACTER_ACTIONS_BY_SAMPLE_ID: Readonly<Record<SampledActionId, CharacterAction>> = {
    waving: CharacterAction.Waving,
    arm_stretching: CharacterAction.ArmStretching,
    chicken_dance: CharacterAction.ChickenDance,
    neck_stretching: CharacterAction.NeckStretching,
    silly_dancing: CharacterAction.SillyDancing,
    twist_dance: CharacterAction.TwistDance,
    waving_gesture: CharacterAction.WavingGesture,
    ymca_dance: CharacterAction.YmcaDance,
    dancing_twerk: CharacterAction.DancingTwerk,
    joyful_jump: CharacterAction.JoyfulJump,
    victory_idle: CharacterAction.VictoryIdle,
    victory: CharacterAction.Victory,
    angry: CharacterAction.Angry,
    defeated: CharacterAction.Defeated,
    loser: CharacterAction.Loser,
    clapping: CharacterAction.Clapping,
    excited: CharacterAction.Excited,
    happy: CharacterAction.Happy,
    waving_0713: CharacterAction.Waving0713,
};

export type CharacterActionPoolConfig = {
    readonly targetSize: number;
    readonly actions: readonly CharacterAction[];
};

export type CharacterActionConfig = {
    readonly showcase: CharacterActionPoolConfig;
    readonly awards: {
        readonly champion: CharacterActionPoolConfig;
        readonly runnerUp: CharacterActionPoolConfig;
        readonly third: CharacterActionPoolConfig;
    };
};

export const CHARACTER_ACTION_CONFIG: CharacterActionConfig = {
    showcase: {
        targetSize: 8,
        actions: [
            CharacterAction.Waving,
            CharacterAction.ArmStretching,
            CharacterAction.ChickenDance,
            CharacterAction.NeckStretching,
            CharacterAction.SillyDancing,
            CharacterAction.TwistDance,
            CharacterAction.WavingGesture,
            CharacterAction.YmcaDance,
        ],
    },
    awards: {
        // Segment 2 podium orbit and segment 3 champion close-up share the
        // champion action selected when the awards presentation begins.
        champion: {
            targetSize: 7,
            actions: [
                CharacterAction.JoyfulJump,
                CharacterAction.Victory,
                CharacterAction.VictoryIdle,
                CharacterAction.ChickenDance,
                CharacterAction.YmcaDance,
                CharacterAction.SillyDancing,
                CharacterAction.DancingTwerk,
            ],
        },
        runnerUp: {
            targetSize: 3,
            actions: [
                CharacterAction.Defeated,
                CharacterAction.Angry,
                CharacterAction.Loser,
            ],
        },
        third: {
            targetSize: 4,
            actions: [
                CharacterAction.Happy,
                CharacterAction.Waving0713,
                CharacterAction.Clapping,
                CharacterAction.Excited,
            ],
        },
    },
};

export function sampledActionIdFor(action: CharacterAction): SampledActionId {
    return CHARACTER_ACTION_SAMPLE_IDS[action];
}

export function selectActionFromPool(
    pool: readonly CharacterAction[],
    random: () => number = Math.random,
): CharacterAction | null {
    if (pool.length <= 0) {
        return null;
    }
    const roll = Math.max(0, Math.min(0.999999999, random()));
    return pool[Math.floor(roll * pool.length)] ?? pool[0];
}

export function selectAdjacentDistinctActions(
    count: number,
    pool: readonly CharacterAction[],
    random: () => number = Math.random,
): CharacterAction[] {
    const uniquePool = pool.filter((action, index) => pool.indexOf(action) === index);
    const useCount = Math.max(0, Math.floor(count));
    if (useCount <= 0 || uniquePool.length <= 0) {
        return [];
    }
    if (useCount > 1 && uniquePool.length < 2) {
        throw new Error('Showcase action pool needs at least two distinct actions for adjacent racers');
    }

    const selected: CharacterAction[] = [];
    for (let index = 0; index < useCount; index++) {
        const previous = selected[index - 1];
        const candidates = previous === undefined
            ? uniquePool
            : uniquePool.filter((action) => action !== previous);
        const roll = Math.max(0, Math.min(0.999999999, random()));
        selected.push(candidates[Math.floor(roll * candidates.length)] ?? candidates[0]);
    }
    return selected;
}
