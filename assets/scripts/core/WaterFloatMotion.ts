export type WaterFloatProfile = Readonly<{
    angularSpeed: number;
    amplitude: number;
    secondaryAmplitudeRatio: number;
    secondarySpeedRatio: number;
}>;

/**
 * 水面漂浮物共用同一种双波形规则，只用静态档位区分质量与体积。
 * 采样函数只返回标量，不创建临时对象，也不参与碰撞或联机状态。
 */
export const WATER_FLOAT_PROFILES = {
    pickup: {
        angularSpeed: 1.9,
        amplitude: 0.075,
        secondaryAmplitudeRatio: 0.22,
        secondarySpeedRatio: 0.47,
    },
    heavyHazard: {
        angularSpeed: 2.25,
        amplitude: 0.06,
        secondaryAmplitudeRatio: 0.16,
        secondarySpeedRatio: 0.43,
    },
    rigidDebris: {
        angularSpeed: 1.6,
        amplitude: 0.055,
        secondaryAmplitudeRatio: 0.18,
        secondarySpeedRatio: 0.51,
    },
    softDebris: {
        angularSpeed: 1.45,
        amplitude: 0.07,
        secondaryAmplitudeRatio: 0.24,
        secondarySpeedRatio: 0.46,
    },
} as const satisfies Record<string, WaterFloatProfile>;

export function waterFloatPhase(
    elapsed: number,
    instancePhase: number,
    profile: WaterFloatProfile,
): number {
    return elapsed * profile.angularSpeed + instancePhase;
}

export function sampleWaterFloatOffset(
    elapsed: number,
    instancePhase: number,
    profile: WaterFloatProfile,
): number {
    const phase = waterFloatPhase(elapsed, instancePhase, profile);
    const primary = Math.sin(phase);
    const secondary = Math.sin(
        phase * profile.secondarySpeedRatio + instancePhase * 1.37 + 0.63,
    );
    return profile.amplitude * (primary + secondary * profile.secondaryAmplitudeRatio);
}
