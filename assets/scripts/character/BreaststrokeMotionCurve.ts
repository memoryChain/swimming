export type BreaststrokeBoneName =
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

export type BreaststrokeMotionSample = {
    phase: number;
    root: readonly [number, number, number];
    head: readonly [number, number, number];
    hand: readonly [number, number, number];
    foot: readonly [number, number, number];
    rotations: Readonly<Partial<Record<BreaststrokeBoneName, readonly [number, number, number, number]>>>;
};

// The canonical T-pose tread-water curve lives in the race bundle under
// model-actions/tPose and is registered at race load by SampledActionLoader.
let _breaststrokeSamples: readonly BreaststrokeMotionSample[] = [];

export function registerBreaststrokeSamples(samples: readonly BreaststrokeMotionSample[]) {
    _breaststrokeSamples = samples;
}

export function getBreaststrokeSamples(): readonly BreaststrokeMotionSample[] {
    return _breaststrokeSamples;
}

export function haveBreaststrokeSamples(): boolean {
    return _breaststrokeSamples.length > 0;
}
