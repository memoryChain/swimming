/** 蝶泳能力配置；是否启用由比赛入口决定，数值通过统一调试面板保存。 */
export const BUTTERFLY_TUNING = {
    chordSeconds: 0.09,
    entryPoseProjection: 0.5,
    sustainPoseProjection: 0.2,
    surfaceDepthMeters: 0.05,
    cycleSeconds: 0.95,
    perfectStart: 0.31,
    perfectEnd: 0.53,
    windowTransitionEndProgress: 0.12,
    timeoutProgress: 0.60,
    propulsionScale: 2.5,
    goodPropulsionScale: 0.95,
    energyScale: 2,
    ultimateGainScale: 2,
    pulseEnabled: 1,
    pulseSeconds: 0.20,
    pulseBudgetScale: 1.02,
    bodyWaveDegrees: 9,
    bodyHeaveMeters: 0.10,
    holdDepthMeters: 0.26,
    releaseLiftMeters: 0.09,
    kickLiftMeters: 0.075,
    buoyancyResponseSeconds: 0.10,
};

/** 只检查角色能力的真实深度，不使用蝶泳模型升沉量。 */
export function butterflyDepthAllowsStroke(depth: number): boolean {
    const limit = Math.max(0, Math.min(0.2, Number.isFinite(BUTTERFLY_TUNING.surfaceDepthMeters)
        ? BUTTERFLY_TUNING.surfaceDepthMeters : 0.05));
    return Number.isFinite(depth) && depth >= 0 && depth <= limit;
}

/** 使用逻辑姿态，排除模型波浪、镜头和布娃娃展示权重；双轴翻转不能抵消准入限制。 */
export function butterflyPoseAllowsStroke(pitchRadians: number, rollRadians: number, continuing = false): boolean {
    if (!Number.isFinite(pitchRadians) || !Number.isFinite(rollRadians)) return false;
    const entry = Math.max(0.1, Math.min(0.95,
        Number.isFinite(BUTTERFLY_TUNING.entryPoseProjection) ? BUTTERFLY_TUNING.entryPoseProjection : 0.5));
    const sustain = Math.max(0, Math.min(entry - 0.05,
        Number.isFinite(BUTTERFLY_TUNING.sustainPoseProjection) ? BUTTERFLY_TUNING.sustainPoseProjection : 0.2));
    const pitch = Math.cos(pitchRadians), roll = Math.cos(rollRadians);
    return Math.min(pitch, roll, pitch * roll) >= (continuing ? sustain : entry);
}
