export type DivePrepBoneName =
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

export type DivePrepPoseSample = {
    source: string;
    frameStart: number;
    frameEnd: number;
    sampleFrame: number;
    root: readonly [number, number, number];
    head: readonly [number, number, number];
    leftHand: readonly [number, number, number];
    rightHand: readonly [number, number, number];
    leftFoot: readonly [number, number, number];
    rightFoot: readonly [number, number, number];
    rotations: Readonly<Partial<Record<DivePrepBoneName, readonly [number, number, number, number]>>>;
};

// The only runtime character uses the canonical T-pose profile. Its validated
// Dive Prep sample is loaded from model-actions/tPose/Tpose_divePrep.json.
