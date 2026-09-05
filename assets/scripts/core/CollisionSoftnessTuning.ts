// 仅用于碰撞后的骨骼表现，不参与推进、碰撞范围或比赛结算。
export const COLLISION_SOFTNESS_TUNING = {
    enabled: 1,
    impulseScale: 10,
    // 一对泳者接触开始时的最低视觉冲量，之后仍按双方体重拆分。
    minimumImpact: 0.8,
    relaxation: 0.95,
    recoverySeconds: 0.65,
    followSpeed: 1,
    frequency: 12,
    damping: 7,
    armDegrees: 24,
    legDegrees: 18,
};
