// 初始化时生成少量共享模板；运行时只合并顶点，不创建单人节点或骨骼。
// 坐姿底部为 -0.5，头顶为 0.5。坐姿头身比约 2:3，部件有意轻微相交。
export type SpectatorTemplate = { positions: number[]; colors: number[]; indices: number[] };
type Point = readonly [number, number];
// 色号：衣服、皮肤、头发、裤子、眼睛。颜色与固定面向明暗均烘焙进顶点。
export function createSpectatorTemplate(tier: number, pose: number): SpectatorTemplate {
    const volume = tier === 1;
    const mesh: SpectatorTemplate = { positions: [], colors: [], indices: [] };
    function face(points: readonly Point[], depth: number, color: number, shade = 1, reverse = false) {
        const base = mesh.positions.length / 3;
        for (const [x, y] of points) {
            mesh.positions.push(x, depth, y);
            mesh.colors.push(color, shade);
        }
        for (let i = 1; i < points.length - 1; i++) {
            mesh.indices.push(base, base + (reverse ? i + 1 : i), base + (reverse ? i : i + 1));
        }
    }
    function sides(points: readonly Point[], depth: number, color: number) {
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            const base = mesh.positions.length / 3;
            mesh.positions.push(a[0], -depth, a[1], a[0], depth, a[1], b[0], depth, b[1], b[0], -depth, b[1]);
            const shade = b[0] < a[0] ? 1.06 : (b[0] > a[0] ? 0.66 : 0.82);
            for (let j = 0; j < 4; j++) mesh.colors.push(color, shade);
            mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }
    function solid(points: readonly Point[], depth: number, color: number) {
        face(points, -depth, color);
        if (volume) {
            face(points, depth, color, 0.78, true);
            sides(points, depth, color);
        }
    }
    // 远层不再构建手臂、裤子或头发；第四层每人严格为四顶点、两三角形。
    if (tier >= 4) {
        face([[-0.40, -0.5], [0.40, -0.5], [0.40, 0.5], [-0.40, 0.5]], -0.20, 0);
        return mesh;
    }
    if (tier === 3) {
        face([[-0.40, -0.5], [0.40, -0.5], [0.40, 0.10], [-0.40, 0.10]], -0.20, 0);
        face([[-0.30, 0.10], [0.30, 0.10], [0.30, 0.5], [-0.30, 0.5]], -0.20, 1);
        return mesh;
    }
    // 肩膀接到脸下方，底部坐在台阶上；体积版深度以人物宽度为单位。
    solid([[-0.40, -0.5], [0.40, -0.5], [0.34, 0.11], [-0.34, 0.11]], 0.20, 0);
    face([[-0.40, -0.5], [0.40, -0.5], [0.39, -0.34], [-0.39, -0.34]], -0.204, 3);
    // 两种欢呼姿态只改变模板；手臂根部始终覆盖肩膀，避免悬空。
    for (const side of [-1, 1]) {
        const raised = pose === 2 || (pose === 1 && side === 1);
        const arm: Point[] = raised
            ? [[0.26, 0.02], [0.40, -0.04], [0.65, 0.37], [0.51, 0.41]]
            : [[0.26, 0.07], [0.45, 0.03], [0.49, -0.30], [0.33, -0.32]];
        const points = arm.map(([x, y]) => [x * side, y] as Point);
        if (side < 0) points.reverse();
        // 手臂只保留双面材质下的轮廓片；肩根仍插入有厚度的躯干。
        face(points, -0.14, 1);
    }
    if (volume) {
        // 第一层：躯干 12 + 裤子 2 + 双臂 4 + 头部 14 = 32 三角形。
        // 四边头部保留正反面和侧壁，脸与发际线分色；不再生成小眼睛。
        const head: Point[] = [[-0.36, 0.08], [0.36, 0.08], [0.30, 0.5], [-0.30, 0.5]];
        const hairline = 0.37;
        const halfHairline = 0.36 - (hairline - 0.08) / (0.5 - 0.08) * 0.06;
        face([head[0], head[1], [halfHairline, hairline], [-halfHairline, hairline]], -0.24, 1);
        face([[-halfHairline, hairline], [halfHairline, hairline], head[2], head[3]], -0.24, 2);
        face(head, 0.24, 2, 0.85, true);
        sides(head, 0.24, 2);
        return mesh;
    }
    // 头发与脸共用边界，不用跨区域插值，头部背面统一为头发。
    const outline: Point[] = [[-0.22, 0.08], [0.22, 0.08], [0.36, 0.22], [0.30, 0.5], [-0.30, 0.5], [-0.36, 0.22]];
    const hairline = 0.37;
    const halfHairline = 0.36 - (hairline - 0.22) / (0.5 - 0.22) * 0.06;
    face([outline[0], outline[1], outline[2], [halfHairline, hairline], [-halfHairline, hairline], outline[5]], -0.24, 1);
    face([[-halfHairline, hairline], [halfHairline, hairline], outline[3], outline[4]], -0.24, 2);
    return mesh;
}
