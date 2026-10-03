import { SeededRandom } from '../core/SharedRNG';
import { WHIRLPOOL_BRAWL_TUNING, WHIRLPOOL_SUPER_TUNING } from '../core/EntertainmentBalance';

export type WhirlpoolSpawn = {
    id: number;
    distance: number;
    centerFraction: number;
    spin: -1 | 1;
    variant: WhirlpoolVariant;
    radiusScale?: number;
    forceScale?: number;
};

export type WhirlpoolVariant = 'normal' | 'super';
export type WhirlpoolSpawnSelection = 'random' | WhirlpoolVariant;

export type WhirlpoolInfluence = {
    forwardAcceleration: number;
    lateralAcceleration: number;
    yawAcceleration: number;
    rollAcceleration: number;
    intensity: number;
    coreIntensity: number;
    captureIntensity: number;
    captureDrag: number;
    whirlpoolId: number;
    maxFlowSpeed: number;
};

/** 本地调试排布：最多八个，按实际泳段长度留出折返与终点空间。 */
export function buildWhirlpoolDebugSpawns(seed: number, raceDistance: number, courseLength: number,
    selection: WhirlpoolSpawnSelection = 'normal'): readonly WhirlpoolSpawn[] {
    const length = Number.isFinite(courseLength) ? Math.max(1, courseLength) : 50;
    const distance = Number.isFinite(raceDistance) ? Math.max(0, raceDistance) : 0;
    const random = new SeededRandom(((Number.isFinite(seed) ? seed : 0) ^ 0x77686972) >>> 0);
    const superRandom = new SeededRandom(((Number.isFinite(seed) ? seed : 0) ^ 0x53555052) >>> 0);
    const count = Math.min(8, Math.ceil(distance / length));
    const useSuper = selection === 'super' || (selection === 'random' && superRandom.next() < 0.25);
    const superIndex = count >= 3 && useSuper ? 1 + superRandom.int(2) : -1;
    const firstSpin: -1 | 1 = random.int(2) === 0 ? -1 : 1;
    const spawns: WhirlpoolSpawn[] = [];
    for (let id = 0; id < count; id++) {
        const big = id === superIndex;
        const margin = WHIRLPOOL_BRAWL_TUNING.alongRadius
            * (big ? WHIRLPOOL_SUPER_TUNING.alongRadiusScale : 1) + 2;
        const start = id * length;
        const end = Math.min(start + length, distance);
        if (end - start < margin * 2) continue;
        const fraction = id % 2 === 0 ? random.range(.48, .64) : random.range(.36, .52);
        const position = Math.max(start + margin, Math.min(end - margin, start + (big ? .5 : fraction) * length));
        const maxCenter = big ? .08 : .34;
        spawns.push({ id, distance: Math.round(position * 10) / 10,
            centerFraction: Math.round(random.range(-maxCenter, maxCenter) * 1000) / 1000,
            spin: id % 2 === 0 ? firstSpin : firstSpin === 1 ? -1 : 1,
            variant: big ? 'super' : 'normal' });
    }
    return spawns;
}

export function resetWhirlpoolInfluence(out: WhirlpoolInfluence): void {
    out.forwardAcceleration = 0;
    out.lateralAcceleration = 0;
    out.yawAcceleration = 0;
    out.rollAcceleration = 0;
    out.intensity = 0;
    out.coreIntensity = 0;
    out.captureIntensity = 0;
    out.captureDrag = 0;
    out.whirlpoolId = -1;
    out.maxFlowSpeed = WHIRLPOOL_BRAWL_TUNING.maxFlowSpeed;
}

export function whirlpoolCenterZ(spawn: WhirlpoolSpawn, poolWidth: number): number {
    const halfUsable = Math.max(0.5, Math.abs(poolWidth) * 0.5 - 0.8);
    return spawn.centerFraction * halfUsable;
}

/** 将赛程坐标中的旋向转换为当前泳段在世界坐标中的可见旋向。 */
export function whirlpoolWorldSpin(spawn: WhirlpoolSpawn, courseDirection: number): -1 | 1 {
    const direction = Number.isFinite(courseDirection) && courseDirection < 0 ? -1 : 1;
    return spawn.spin * direction < 0 ? -1 : 1;
}

/**
 * 在赛程距离／世界横向平面采样水流。只写入复用对象，赛中不分配临时数组或向量。
 * 外圈按旋向区分顺流加速与逆流阻力；越靠近核心，吸力和后退惩罚越强。
 */
export function sampleWhirlpoolInfluence(
    distance: number,
    worldZ: number,
    poolWidth: number,
    out: WhirlpoolInfluence,
    spawns: readonly WhirlpoolSpawn[],
): WhirlpoolInfluence {
    resetWhirlpoolInfluence(out);
    if (!Number.isFinite(distance) || !Number.isFinite(worldZ)) return out;

    for (const spawn of spawns) {
        const superVariant = spawn.variant === 'super';
        const alongRadius = Math.max(0.5, WHIRLPOOL_BRAWL_TUNING.alongRadius
            * (superVariant ? WHIRLPOOL_SUPER_TUNING.alongRadiusScale : 1)
            * (spawn.radiusScale ?? 1));
        const lateralRadius = Math.max(0.5, WHIRLPOOL_BRAWL_TUNING.lateralRadius
            * (superVariant ? WHIRLPOOL_SUPER_TUNING.lateralRadiusScale : 1)
            * (spawn.radiusScale ?? 1));
        const baseCoreRadius = WHIRLPOOL_BRAWL_TUNING.lateralRadius
            * WHIRLPOOL_BRAWL_TUNING.coreRadiusRatio;
        const coreRadius = Math.max(0.05, Math.min(0.8,
            baseCoreRadius * (superVariant ? WHIRLPOOL_SUPER_TUNING.coreRadiusScale : 1)
            * (spawn.radiusScale ?? 1) / lateralRadius));
        const captureRadius = Math.max(coreRadius, Math.min(0.92,
            WHIRLPOOL_BRAWL_TUNING.captureRadiusRatio
            * (superVariant ? WHIRLPOOL_SUPER_TUNING.captureRadiusScale : 1)));
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
        const captureLinear = Math.max(0, Math.min(1, (captureRadius - radius) / captureRadius));
        const capture = captureLinear * captureLinear * (3 - 2 * captureLinear);
        const ring = Math.max(0, 1 - Math.abs(radius - 0.68) / 0.28);
        // 中心只保留极小数值死区，避免削弱核心的吸力。
        const safeRadius = Math.max(0.04, radius);
        const outerInwardScale = Math.max(0, Math.min(1, WHIRLPOOL_BRAWL_TUNING.outerInwardScale));
        const coreSwirlScale = Math.max(0, Math.min(1, WHIRLPOOL_BRAWL_TUNING.coreSwirlScale));
        const inwardBandScale = outerInwardScale + (1 - outerInwardScale) * core;
        const swirlBandScale = 1 - (1 - coreSwirlScale) * core;
        const inward = (
            WHIRLPOOL_BRAWL_TUNING.inwardPullAcceleration * inwardBandScale
            + WHIRLPOOL_BRAWL_TUNING.coreCaptureAcceleration * core
        ) * (superVariant ? WHIRLPOOL_SUPER_TUNING.inwardPullScale : 1)
            * smoothFalloff;
        const swirl = WHIRLPOOL_BRAWL_TUNING.swirlAcceleration
            * (superVariant ? WHIRLPOOL_SUPER_TUNING.swirlScale : 1)
            * smoothFalloff * swirlBandScale;

        // 将归一化方向转换为赛程与横向水流，旋向不消费额外随机数。
        const rawRadialForward = -nx / safeRadius * inward;
        // 入场只保留少量向前吸力，避免沿中心直游获得额外加速。
        const radialForward = rawRadialForward > 0
            ? rawRadialForward * Math.max(0, Math.min(1, WHIRLPOOL_BRAWL_TUNING.approachForwardPullScale))
            : rawRadialForward;
        const radialLateral = -nz / safeRadius * inward;
        const tangentForwardDirection = -spawn.spin * nz / safeRadius;
        const tangentLateralDirection = spawn.spin * nx / safeRadius;
        const tangentForward = tangentForwardDirection * swirl;
        const tangentLateral = tangentLateralDirection * swirl;
        const downstream = Math.max(0, tangentForwardDirection);
        const counterflow = Math.max(0, -tangentForwardDirection);
        const outerFlow = ring * (1 - core) * (
            WHIRLPOOL_BRAWL_TUNING.outerBoostAcceleration
                * (superVariant ? WHIRLPOOL_SUPER_TUNING.outerBoostScale : 1) * downstream
            - WHIRLPOOL_BRAWL_TUNING.outerCounterflowAcceleration
                * (superVariant ? WHIRLPOOL_SUPER_TUNING.outerCounterflowScale : 1) * counterflow
        );
        const forward = radialForward + tangentForward
            + outerFlow
            - WHIRLPOOL_BRAWL_TUNING.coreBackwardAcceleration
                * (superVariant ? WHIRLPOOL_SUPER_TUNING.coreBackwardScale : 1) * core;
        const lateralForce = radialLateral + tangentLateral;

        const forceScale = spawn.forceScale ?? 1;
        out.forwardAcceleration += forward * forceScale;
        out.lateralAcceleration += lateralForce * forceScale;
        out.yawAcceleration += lateralForce * forceScale * WHIRLPOOL_BRAWL_TUNING.yawAccelerationScale;
        out.rollAcceleration += -lateralForce * forceScale * WHIRLPOOL_BRAWL_TUNING.rollAccelerationScale;
        if (capture > out.captureIntensity) {
            out.captureIntensity = capture;
            out.captureDrag = capture
                * WHIRLPOOL_BRAWL_TUNING.capturePropulsionDrag
                * (superVariant ? WHIRLPOOL_SUPER_TUNING.captureDragScale : 1) * forceScale;
        }
        if (smoothFalloff > out.intensity) {
            out.intensity = smoothFalloff;
            out.coreIntensity = core;
            out.whirlpoolId = spawn.id;
            out.maxFlowSpeed = WHIRLPOOL_BRAWL_TUNING.maxFlowSpeed
                * (superVariant ? WHIRLPOOL_SUPER_TUNING.maxFlowSpeedScale : 1);
        }
    }
    return out;
}

export function whirlpoolTargetZForAi(
    distance: number,
    currentZ: number,
    poolWidth: number,
    spawns: readonly WhirlpoolSpawn[],
): number | null {
    const halfUsable = Math.max(0.5, Math.abs(poolWidth) * 0.5 - 0.75);
    for (const spawn of spawns) {
        const lateralRadius = Math.max(0.5, WHIRLPOOL_BRAWL_TUNING.lateralRadius
            * (spawn.variant === 'super' ? WHIRLPOOL_SUPER_TUNING.lateralRadiusScale : 1)
            * (spawn.radiusScale ?? 1));
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
