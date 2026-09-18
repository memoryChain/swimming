export type WhirlpoolSpawn = {
    id: number;
    distance: number;
    centerFraction: number;
    spin: -1 | 1;
};

export type WhirlpoolInfluence = {
    forwardAcceleration: number;
    lateralAcceleration: number;
    yawAcceleration: number;
    rollAcceleration: number;
    intensity: number;
    coreIntensity: number;
    whirlpoolId: number;
};

// 漩涡避开 50 米折返墙；每一趟都有一次完整的路线选择。
export const WHIRLPOOL_SPAWNS: readonly WhirlpoolSpawn[] = [
    { id: 0, distance: 28, centerFraction: -0.48, spin: 1 },
    { id: 1, distance: 72, centerFraction: 0.46, spin: -1 },
    { id: 2, distance: 128, centerFraction: 0.12, spin: 1 },
    { id: 3, distance: 172, centerFraction: -0.50, spin: -1 },
] as const;

export const WHIRLPOOL_BRAWL_TUNING = {
    alongRadius: 5.2,
    lateralRadius: 4.2,
    coreRadiusRatio: 0.32,
    inwardPullAcceleration: 3.6,
    swirlAcceleration: 4.4,
    outerBoostAcceleration: 2.0,
    coreBackwardAcceleration: 3.2,
    yawAccelerationScale: 0.16,
    rollAccelerationScale: 0.34,
    maxFlowSpeed: 3.2,
    submergedInfluenceScale: 0.35,
};

export function resetWhirlpoolInfluence(out: WhirlpoolInfluence): void {
    out.forwardAcceleration = 0;
    out.lateralAcceleration = 0;
    out.yawAcceleration = 0;
    out.rollAcceleration = 0;
    out.intensity = 0;
    out.coreIntensity = 0;
    out.whirlpoolId = -1;
}

export function whirlpoolCenterZ(spawn: WhirlpoolSpawn, poolWidth: number): number {
    const halfUsable = Math.max(0.5, Math.abs(poolWidth) * 0.5 - 0.8);
    return spawn.centerFraction * halfUsable;
}

/**
 * 在赛程距离／世界横向平面采样水流。只写入复用对象，赛中不分配临时数组或向量。
 * 外圈提供稳定前向借力；越靠近核心，吸力、旋转和后退惩罚越强。
 */
export function sampleWhirlpoolInfluence(
    distance: number,
    worldZ: number,
    poolWidth: number,
    out: WhirlpoolInfluence,
): WhirlpoolInfluence {
    resetWhirlpoolInfluence(out);
    if (!Number.isFinite(distance) || !Number.isFinite(worldZ)) return out;

    const alongRadius = Math.max(0.5, WHIRLPOOL_BRAWL_TUNING.alongRadius);
    const lateralRadius = Math.max(0.5, WHIRLPOOL_BRAWL_TUNING.lateralRadius);
    const coreRadius = Math.max(0.05, Math.min(0.8, WHIRLPOOL_BRAWL_TUNING.coreRadiusRatio));

    for (const spawn of WHIRLPOOL_SPAWNS) {
        const along = distance - spawn.distance;
        if (Math.abs(along) > alongRadius) continue;
        const lateral = worldZ - whirlpoolCenterZ(spawn, poolWidth);
        if (Math.abs(lateral) > lateralRadius) continue;
        const nx = along / alongRadius;
        const nz = lateral / lateralRadius;
        const radius = Math.sqrt(nx * nx + nz * nz);
        if (radius >= 1) continue;

        const edgeFalloff = 1 - radius;
        const smoothFalloff = edgeFalloff * edgeFalloff * (3 - 2 * edgeFalloff);
        const core = Math.max(0, Math.min(1, (coreRadius - radius) / coreRadius));
        const ring = Math.max(0, 1 - Math.abs(radius - 0.68) / 0.28);
        const safeRadius = Math.max(0.08, radius);
        const inward = WHIRLPOOL_BRAWL_TUNING.inwardPullAcceleration * smoothFalloff;
        const swirl = WHIRLPOOL_BRAWL_TUNING.swirlAcceleration * smoothFalloff;

        // nx/nz are dimensionless; convert their directions back into the two
        // gameplay acceleration channels. The alternating spin produces different
        // entry/exit routes without any outcome-affecting randomness.
        const radialForward = -nx / safeRadius * inward;
        const radialLateral = -nz / safeRadius * inward;
        const tangentForward = -spawn.spin * nz / safeRadius * swirl;
        const tangentLateral = spawn.spin * nx / safeRadius * swirl;
        const forward = radialForward + tangentForward
            + WHIRLPOOL_BRAWL_TUNING.outerBoostAcceleration * ring * (1 - core)
            - WHIRLPOOL_BRAWL_TUNING.coreBackwardAcceleration * core;
        const lateralForce = radialLateral + tangentLateral;

        out.forwardAcceleration += forward;
        out.lateralAcceleration += lateralForce;
        out.yawAcceleration += lateralForce * WHIRLPOOL_BRAWL_TUNING.yawAccelerationScale;
        out.rollAcceleration += -lateralForce * WHIRLPOOL_BRAWL_TUNING.rollAccelerationScale;
        if (smoothFalloff > out.intensity) {
            out.intensity = smoothFalloff;
            out.coreIntensity = core;
            out.whirlpoolId = spawn.id;
        }
    }
    return out;
}

export function whirlpoolTargetZForAi(distance: number, currentZ: number, poolWidth: number): number | null {
    const lateralRadius = Math.max(0.5, WHIRLPOOL_BRAWL_TUNING.lateralRadius);
    const halfUsable = Math.max(0.5, Math.abs(poolWidth) * 0.5 - 0.75);
    for (const spawn of WHIRLPOOL_SPAWNS) {
        const ahead = spawn.distance - distance;
        if (ahead < -2 || ahead > 18) continue;
        const center = whirlpoolCenterZ(spawn, poolWidth);
        let side = currentZ >= center ? 1 : -1;
        let target = center + side * lateralRadius * 0.68;
        if (target > halfUsable || target < -halfUsable) {
            side = -side;
            target = center + side * lateralRadius * 0.68;
        }
        return Math.max(-halfUsable, Math.min(halfUsable, target));
    }
    return null;
}
