import { Vec3 } from 'cc';

// 按俯视／侧视参考手工整理的方向关键姿势，并非从 GIF 恢复出的三维骨骼。
// 使用现有正向划臂相位：入水、抱水、推水、出水、高肘回臂、前伸。
// 坐标为身体的外侧、前方、腹侧；方向而非固定位置，适配不同角色的骨长。
// 每行依次为相位、上臂方向、前臂方向。末行闭合首行。
const ARM_KEYS: readonly (readonly number[])[] = [
    [0.00, 0.12, 1.00, 0.03,  0.02, 1.00, 0.08],
    [0.12, 0.30, 0.86, 0.40, -0.10, 0.24, 0.97],
    [0.26, 0.62, 0.16, 0.56, -0.36,-0.64, 0.76],
    [0.40, 0.28,-0.85, 0.44, -0.10,-0.98, 0.14],
    [0.52, 0.30,-0.93,-0.14,  0.05,-0.86, 0.28],
    // 回臂中段前臂先留在肘的外侧，再向前展开，不能反向内收挤向肩和脸。
    // 回臂铺到周期末端，避免提前前伸后长时间停住，造成同倍率下俯泳显得更急。
    [0.66, 0.65,-0.42,-0.72,  0.55,-0.12, 0.83],
    [0.80, 0.55, 0.30,-0.78,  0.20, 0.92, 0.34],
    [0.91, 0.30, 0.80,-0.36, -0.10, 0.97, 0.22],
    [0.99, 0.12, 1.00,-0.02,  0.02, 1.00, 0.12],
    [1.00, 0.12, 1.00, 0.03,  0.02, 1.00, 0.08],
];

export function sampleProneFreestyleArm(cycle: number, upper: Vec3, fore: Vec3): void {
    const phase = ((cycle / (Math.PI * 2)) % 1 + 1) % 1;
    let index = 0;
    while (index < ARM_KEYS.length - 2 && phase > ARM_KEYS[index + 1][0]) index++;
    const a = ARM_KEYS[index], b = ARM_KEYS[index + 1];
    const previous = ARM_KEYS[index === 0 ? ARM_KEYS.length - 2 : index - 1];
    const next = ARM_KEYS[index + 2 === ARM_KEYS.length ? 1 : index + 2];
    const previousTime = previous[0] - (index === 0 ? 1 : 0);
    const nextTime = next[0] + (index + 2 === ARM_KEYS.length ? 1 : 0);
    const width = b[0] - a[0];
    const t = (phase - a[0]) / width, t2 = t * t, t3 = t2 * t;
    const h0 = 2 * t3 - 3 * t2 + 1, h1 = t3 - 2 * t2 + t;
    const h2 = -2 * t3 + 3 * t2, h3 = t3 - t2;
    // 周期 Hermite 插值，跨关键姿势及周期边界的一阶导数连续；无逐帧分配。
    for (let component = 1; component <= 6; component++) {
        const value = h0 * a[component] + h2 * b[component]
            + h1 * width * (b[component] - previous[component]) / (b[0] - previousTime)
            + h3 * width * (next[component] - a[component]) / (nextTime - a[0]);
        const output = component <= 3 ? upper : fore;
        if (component === 1 || component === 4) output.x = value;
        else if (component === 2 || component === 5) output.y = value;
        else output.z = value;
    }
    Vec3.normalize(upper, upper);
    Vec3.normalize(fore, fore);
    // 前伸是明确的直臂保持段，而非仅在周期边界短暂接近伸直。
    // 两骨段使用同一前进方向，消除俯视外拐和侧视残留屈肘。
    const extension = proneFreestyleExtensionWeight(cycle);
    if (extension > 0) {
        upper.set(upper.x * (1 - extension), upper.y + (1 - upper.y) * extension, upper.z * (1 - extension));
        fore.set(fore.x * (1 - extension), fore.y + (1 - fore.y) * extension, fore.z * (1 - extension));
        Vec3.normalize(upper, upper);
        Vec3.normalize(fore, fore);
    }
}

export function proneFreestyleExtensionWeight(cycle: number): number {
    const phase = ((cycle / (Math.PI * 2)) % 1 + 1) % 1;
    const t = phase < 0.5 ? (0.16 - phase) / 0.08 : (phase - 0.90) / 0.09;
    const weight = Math.max(0, Math.min(1, t));
    return weight * weight * (3 - 2 * weight);
}

export function proneFreestyleRollSignal(leftCycle: number, rightCycle: number): number {
    // 转体峰值留到高肘回臂，前伸入水时再换边；左右输入仍独立。
    const delay = Math.PI * 2 * 0.22;
    return (Math.cos(rightCycle - delay) - Math.cos(leftCycle - delay)) * 0.5;
}

export function proneFreestyleWeight(projection: number): number {
    // 俯面半周完整使用新姿势；翻过侧面后平滑退回旧动作，仰面稳定区完全保留。
    const t = Math.max(0, Math.min(1, ((Number.isFinite(projection) ? projection : 1) + 0.5) * 2));
    return t * t * (3 - 2 * t);
}
