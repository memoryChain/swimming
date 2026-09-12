import { Color } from 'cc';

// 与显示整数使用同一档位，所有颜色一次创建，比赛中不分配 Color。
export const HEART_TIERS = [
    { label: '轻松', color: new Color(204, 238, 83), amplitude: 0.03 },
    { label: '发力', color: new Color(255, 201, 58), amplitude: 0.04 },
    { label: '高压', color: new Color(255, 152, 80), amplitude: 0.06 },
    { label: '极限', color: new Color(255, 73, 76), amplitude: 0.08 },
];

// 原弧线烘焙了 #CCEE53。补偿原 RGB 后再乘色，保留准确色相与原透明边缘；
// 暖色最高亮度为原稿的 80%，不新增贴图、材质或绘制批次。
export const HEART_BAND_TINTS = HEART_TIERS.map(tier => {
    const r = tier.color.r / 204, g = tier.color.g / 238, b = tier.color.b / 83;
    const peak = Math.max(1, r, g, b);
    return new Color(Math.round(r / peak * 255), Math.round(g / peak * 255), Math.round(b / peak * 255));
});

export function heartRateTier(heartRate: number): number {
    const value = Math.round(heartRate);
    return value >= 160 ? 3 : value >= 140 ? 2 : value > 100 ? 1 : 0;
}
