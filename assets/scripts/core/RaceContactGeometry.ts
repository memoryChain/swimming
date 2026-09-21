/**
 * 用障碍物椭圆与选手身体椭圆的半径和近似二维接触范围。
 * 这是无分配的保守判定，适合泳道内的小型漂浮物；范围伤害仍应使用自己的效果半径。
 */
export function expandedEllipseContains(
    x: number,
    z: number,
    centerX: number,
    centerZ: number,
    obstacleAlongRadius: number,
    obstacleLateralRadius: number,
    bodyAlongRadius: number,
    bodyLateralRadius: number,
): boolean {
    return expandedEllipseDistanceSquared(
        x, z, centerX, centerZ,
        obstacleAlongRadius, obstacleLateralRadius,
        bodyAlongRadius, bodyLateralRadius,
    ) <= 1;
}

export function expandedEllipseDistanceSquared(
    x: number,
    z: number,
    centerX: number,
    centerZ: number,
    obstacleAlongRadius: number,
    obstacleLateralRadius: number,
    bodyAlongRadius: number,
    bodyLateralRadius: number,
): number {
    const alongRadius = Math.max(0.01, obstacleAlongRadius + bodyAlongRadius);
    const lateralRadius = Math.max(0.01, obstacleLateralRadius + bodyLateralRadius);
    const nx = (x - centerX) / alongRadius;
    const nz = (z - centerZ) / lateralRadius;
    return nx * nx + nz * nz;
}

/**
 * 对同一个扩张椭圆执行线段扫掠，避免低帧率或高速移动时穿过小物体。
 */
export function segmentHitsExpandedEllipse(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    centerX: number,
    centerZ: number,
    obstacleAlongRadius: number,
    obstacleLateralRadius: number,
    bodyAlongRadius: number,
    bodyLateralRadius: number,
): boolean {
    const alongRadius = Math.max(0.01, obstacleAlongRadius + bodyAlongRadius);
    const lateralRadius = Math.max(0.01, obstacleLateralRadius + bodyLateralRadius);
    const sx = (ax - centerX) / alongRadius;
    const sz = (az - centerZ) / lateralRadius;
    const ex = (bx - centerX) / alongRadius;
    const ez = (bz - centerZ) / lateralRadius;
    const dx = ex - sx;
    const dz = ez - sz;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? clamp(-(sx * dx + sz * dz) / lengthSq, 0, 1) : 0;
    const px = sx + dx * t;
    const pz = sz + dz * t;
    return px * px + pz * pz <= 1;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/** 瞬时接触效果独立去重；世界快照不能推进此窗口。固定窗口也限制迟到事件的保留量。 */
export class ContactEventWindow {
    private newest = 0;
    private readonly seen = new Set<number>();

    accept(revision: number): boolean {
        if (!Number.isSafeInteger(revision) || revision <= 0
            || revision <= this.newest - 128 || this.seen.has(revision)) return false;
        this.newest = Math.max(this.newest, revision);
        for (const old of this.seen) {
            if (old <= this.newest - 128) this.seen.delete(old);
        }
        this.seen.add(revision);
        return true;
    }

    reset(): void {
        this.newest = 0;
        this.seen.clear();
    }
}
