import { getSharedRandomSeed, SeededRandom } from './SharedRNG';

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

export const WHIRLPOOL_SPAWN_BANDS = [
    { minDistance: 24, maxDistance: 32 },
    { minDistance: 68, maxDistance: 76 },
    { minDistance: 124, maxDistance: 132 },
    { minDistance: 168, maxDistance: 176 },
] as const;

const WHIRLPOOL_RANDOM_SALT = 0x77686972;
export const WHIRLPOOL_MAX_CENTER_FRACTION = 0.34;
let cachedSpawnSeed = -1;
let cachedSpawns: readonly WhirlpoolSpawn[] = [];
let runtimeSpawns: readonly WhirlpoolSpawn[] | null = null;

/**
 * 每个 50 米泳段生成一个漩涡。赛程距离避开出发端与折返墙，横向中心限制在
 * 泳池中部安全带内；独立随机流不会改变 AI、阵容或其他玩法的共享随机序列。
 */
export function whirlpoolSpawnsForSeed(seed: number): readonly WhirlpoolSpawn[] {
    const normalizedSeed = (Number.isFinite(seed) ? seed : 0) >>> 0;
    if (normalizedSeed === cachedSpawnSeed && cachedSpawns.length === WHIRLPOOL_SPAWN_BANDS.length) {
        return cachedSpawns;
    }
    const random = new SeededRandom((normalizedSeed ^ WHIRLPOOL_RANDOM_SALT) >>> 0);
    const firstSpin: -1 | 1 = random.int(2) === 0 ? -1 : 1;
    const spawns: WhirlpoolSpawn[] = [];
    for (let id = 0; id < WHIRLPOOL_SPAWN_BANDS.length; id++) {
        const band = WHIRLPOOL_SPAWN_BANDS[id];
        spawns.push({
            id,
            distance: quantize(random.range(band.minDistance, band.maxDistance), 10),
            centerFraction: quantize(random.range(
                -WHIRLPOOL_MAX_CENTER_FRACTION,
                WHIRLPOOL_MAX_CENTER_FRACTION,
            ), 1000),
            spin: id % 2 === 0 ? firstSpin : firstSpin === 1 ? -1 : 1,
        });
    }
    cachedSpawnSeed = normalizedSeed;
    cachedSpawns = spawns;
    return cachedSpawns;
}

export function currentWhirlpoolSpawns(): readonly WhirlpoolSpawn[] {
    return runtimeSpawns ?? whirlpoolSpawnsForSeed(getSharedRandomSeed());
}

export function setRuntimeWhirlpoolSpawns(spawns: readonly WhirlpoolSpawn[] | null): void {
    runtimeSpawns = spawns;
}

/** 六合一只留一个漩涡，并以导演同步的激活距离为锚点。 */
export function entertainmentWhirlpoolSpawn(seed: number, anchorDistance: number): readonly WhirlpoolSpawn[] {
    const random = new SeededRandom(((Number.isFinite(seed) ? seed : 0) ^ 0x454e5457) >>> 0);
    return [{
        id: 0,
        distance: Math.max(8, Math.min(190, anchorDistance + 13)),
        centerFraction: quantize(random.range(-WHIRLPOOL_MAX_CENTER_FRACTION, WHIRLPOOL_MAX_CENTER_FRACTION), 1000),
        spin: random.int(2) === 0 ? -1 : 1,
    }];
}

export const WHIRLPOOL_BRAWL_TUNING = {
    alongRadius: 5.2,
    lateralRadius: 4.2,
    coreRadiusRatio: 0.32,
    inwardPullAcceleration: 3.6,
    outerInwardScale: 0.58,
    swirlAcceleration: 5.2,
    coreSwirlScale: 0.65,
    outerBoostAcceleration: 2.0,
    outerCounterflowAcceleration: 1.2,
    coreBackwardAcceleration: 3.2,
    yawAccelerationScale: 0.22,
    rollAccelerationScale: 0.42,
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
    spawns: readonly WhirlpoolSpawn[] = currentWhirlpoolSpawns(),
): WhirlpoolInfluence {
    resetWhirlpoolInfluence(out);
    if (!Number.isFinite(distance) || !Number.isFinite(worldZ)) return out;

    const alongRadius = Math.max(0.5, WHIRLPOOL_BRAWL_TUNING.alongRadius);
    const lateralRadius = Math.max(0.5, WHIRLPOOL_BRAWL_TUNING.lateralRadius);
    const coreRadius = Math.max(0.05, Math.min(0.8, WHIRLPOOL_BRAWL_TUNING.coreRadiusRatio));

    for (const spawn of spawns) {
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
        const outerInwardScale = Math.max(0, Math.min(1, WHIRLPOOL_BRAWL_TUNING.outerInwardScale));
        const coreSwirlScale = Math.max(0, Math.min(1, WHIRLPOOL_BRAWL_TUNING.coreSwirlScale));
        const inwardBandScale = outerInwardScale + (1 - outerInwardScale) * core;
        const swirlBandScale = 1 - (1 - coreSwirlScale) * core;
        const inward = WHIRLPOOL_BRAWL_TUNING.inwardPullAcceleration * smoothFalloff * inwardBandScale;
        const swirl = WHIRLPOOL_BRAWL_TUNING.swirlAcceleration * smoothFalloff * swirlBandScale;

        // nx/nz are dimensionless; convert their directions back into the two
        // gameplay acceleration channels. The alternating spin produces different
        // entry/exit routes without any outcome-affecting randomness.
        const radialForward = -nx / safeRadius * inward;
        const radialLateral = -nz / safeRadius * inward;
        const tangentForwardDirection = -spawn.spin * nz / safeRadius;
        const tangentLateralDirection = spawn.spin * nx / safeRadius;
        const tangentForward = tangentForwardDirection * swirl;
        const tangentLateral = tangentLateralDirection * swirl;
        const downstream = Math.max(0, tangentForwardDirection);
        const counterflow = Math.max(0, -tangentForwardDirection);
        const outerFlow = ring * (1 - core) * (
            WHIRLPOOL_BRAWL_TUNING.outerBoostAcceleration * downstream
            - WHIRLPOOL_BRAWL_TUNING.outerCounterflowAcceleration * counterflow
        );
        const forward = radialForward + tangentForward
            + outerFlow
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

export function whirlpoolTargetZForAi(
    distance: number,
    currentZ: number,
    poolWidth: number,
    spawns: readonly WhirlpoolSpawn[] = currentWhirlpoolSpawns(),
): number | null {
    const lateralRadius = Math.max(0.5, WHIRLPOOL_BRAWL_TUNING.lateralRadius);
    const halfUsable = Math.max(0.5, Math.abs(poolWidth) * 0.5 - 0.75);
    for (const spawn of spawns) {
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

function quantize(value: number, precision: number): number {
    return Math.round(value * precision) / precision;
}
