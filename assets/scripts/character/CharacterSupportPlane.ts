// 世界空间支撑平面：nx*x + ny*y + nz*z = distance，法线朝上且已归一化。
// 只用于角色表现，不能修改比赛根节点轨迹、起跳速度或联机快照。
export type CharacterSupportPlane = {
    nx: number;
    ny: number;
    nz: number;
    distance: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    // 完整台身的前后边界，供手掌避开踏面以外的台沿和外挑结构。
    obstacleMinX?: number;
    obstacleMaxX?: number;
    // 按高度分段的台身外轮廓，避免用地面底座的外突量把手臂推离上方台沿。
    obstacleBands?: ReadonlyArray<{ minY: number; maxY: number; minX: number; maxX: number; minZ: number; maxZ: number }>;
};
