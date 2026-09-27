import { SeededRandom } from './SharedRNG';
import { LITTER_BRAWL_TUNING, type LitterBrawlSchedule } from './LitterBrawlController';
import { MINEFIELD_TUNING } from './MinefieldBrawlController';
import type { EntertainmentIntensityProfile } from './EntertainmentIntensity';

export type ObstacleLayout = 'debris' | 'buoy' | 'mixed';
export type ObstacleBuoyAnchor = Readonly<{ courseX: number; lateral: number }>;

export function obstacleCourseX(distance: number): number {
    const safe = Math.max(0, distance);
    const lap = Math.floor(safe / 50);
    const inLap = safe % 50;
    return lap % 2 === 0 ? inLap : 50 - inLap;
}

export function obstacleCourseDirection(distance: number): number {
    return Math.floor(Math.max(0, distance) / 50) % 2 === 0 ? 1 : -1;
}

export type ObstaclePlan = Readonly<{
    identity: number;
    layout: ObstacleLayout;
    safeCenter: number;
    buoyAnchors: readonly ObstacleBuoyAnchor[];
    litterItemsPerWave: number;
    litterPoolSize: number;
    litterWaves200: number;
    litterWaves400: number;
}>;

const BUOY_X = [6.5, 12.5, 19.5, 27, 34.5, 41, 46, 9, 16, 23, 37, 44] as const;
const SAFE_HALF_WIDTH = LITTER_BRAWL_TUNING.safeHalfWidth;
// 浮标最大横漂、身体接触半径及杂物出生余量都不能侵入同一条安全通路。
const BUOY_CORRIDOR_CLEARANCE = SAFE_HALF_WIDTH
    + MINEFIELD_TUNING.driftLateralRadius
    + MINEFIELD_TUNING.mineItemLateralRadius
    + MINEFIELD_TUNING.swimmerContactLateralRadius
    + LITTER_BRAWL_TUNING.spawnMineLateralMargin + 0.1;
// 末组杂物落水约需 1.35 + 2 × 0.34 秒；下一波至少等到上一波完整入场。
export const OBSTACLE_MIN_WAVE_INTERVAL_SECONDS = 2.2;
export const OBSTACLE_AI_SAMPLE_SECONDS = 0.1;
// 独立测试没有导演锚点；沿用原杂物首波的前方触发点，避开跳水滑行落点。
export const OBSTACLE_SOLO_ANCHOR_DISTANCE = LITTER_BRAWL_TUNING.waveDistances[0];
export const OBSTACLE_SOLO_LANDING_SEARCH_METERS = 20;
const SOLO_WAVES_200 = [2, 3, 4, 5, 6] as const;
const SOLO_WAVES_400 = [3, 5, 7, 9, 11] as const;
const SOLO_FINISH_CLEARANCE = 32;

/** 独立障碍赛覆盖完整赛程；波次错开后复用同一个固定对象池。 */
export function buildObstacleSoloLitterSchedule(
    raceDistance: number,
    intensity: number,
): LitterBrawlSchedule {
    const safeRaceDistance = Number.isFinite(raceDistance) ? Math.max(1, raceDistance) : 200;
    const level = Math.max(1, Math.min(5, Math.floor(Number.isFinite(intensity) ? intensity : 3)));
    const count = safeRaceDistance >= 400 ? SOLO_WAVES_400[level - 1] : SOLO_WAVES_200[level - 1];
    const first = Math.min(OBSTACLE_SOLO_ANCHOR_DISTANCE,
        Math.max(0, safeRaceDistance - LITTER_BRAWL_TUNING.landingLeadDistance - 2));
    const last = Math.max(first, safeRaceDistance - SOLO_FINISH_CLEARANCE);
    const waveDistances = Array.from({ length: count }, (_, index) => {
        const intended = first + (last - first) * index / (count - 1);
        const nextTurn = (Math.floor(intended / 50) + 1) * 50;
        // 折返前跨线投放会让物理落点突然靠近选手，安全检查连续拒绝整波。
        return intended + LITTER_BRAWL_TUNING.landingLeadDistance >= nextTurn
            ? nextTurn + 5 : intended;
    });
    return { waveDistances, landingLeadDistance: LITTER_BRAWL_TUNING.landingLeadDistance };
}
const FORMAL_PROFILE: Readonly<Pick<EntertainmentIntensityProfile,
    'mineCount' | 'litterItemsPerWave' | 'litterPoolSize' | 'litterWaves200' | 'litterWaves400'
    | 'obstacleMixedLitterCount' | 'obstacleMixedBuoyCount' | 'obstacleMixedPoolSize'>> = {
    mineCount: 5,
    litterItemsPerWave: 6,
    litterPoolSize: 18,
    litterWaves200: 2,
    litterWaves400: 3,
    obstacleMixedLitterCount: 4,
    obstacleMixedBuoyCount: 3,
    obstacleMixedPoolSize: 12,
};

function boundedCount(value: number, fallback: number, minimum: number, maximum: number): number {
    const candidate = Number.isFinite(value) ? value : fallback;
    return Math.max(minimum, Math.min(maximum, Math.floor(candidate)));
}

export function buildObstaclePlan(
    seed: number,
    anchorDistance: number,
    poolWidth: number,
    profile: typeof FORMAL_PROFILE = FORMAL_PROFILE,
    forcedLayout?: ObstacleLayout,
    soloIntensity?: number,
): ObstaclePlan {
    const salt = Math.imul(Math.max(0, Math.round(anchorDistance * 100)), 0x9e3779b1);
    const random = new SeededRandom(((seed >>> 0) ^ salt ^ 0x6f627374) >>> 0);
    const layout = forcedLayout ?? (['debris', 'buoy', 'mixed'] as const)[random.int(3)];
    const halfWidth = Math.max(1, poolWidth * 0.5 - 0.9);
    const corridorReach = Math.max(0, halfWidth - SAFE_HALF_WIDTH);
    const safeCenter = (random.next() * 2 - 1) * corridorReach;
    const buoyCount = layout === 'debris' ? 0
        : boundedCount(layout === 'mixed' ? profile.obstacleMixedBuoyCount : profile.mineCount,
            layout === 'mixed' ? FORMAL_PROFILE.obstacleMixedBuoyCount : FORMAL_PROFILE.mineCount, 1, BUOY_X.length);
    const litterItemsPerWave = layout === 'buoy' ? 0 : layout === 'mixed'
        ? boundedCount(profile.obstacleMixedLitterCount, FORMAL_PROFILE.obstacleMixedLitterCount, 1, 15)
        : boundedCount(profile.litterItemsPerWave, FORMAL_PROFILE.litterItemsPerWave, 1, 15);
    const litterPoolSize = layout === 'buoy' ? 0 : layout === 'mixed'
        ? boundedCount(profile.obstacleMixedPoolSize, FORMAL_PROFILE.obstacleMixedPoolSize,
            litterItemsPerWave, 30)
        : boundedCount(profile.litterPoolSize, FORMAL_PROFILE.litterPoolSize,
            litterItemsPerWave, 30);
    // 物件退场时间长于一次事件窗口，调试高档不能计划超过池容量的波次。
    const waveCapacity = litterItemsPerWave > 0 ? Math.floor(litterPoolSize / litterItemsPerWave) : 0;
    const soloLevel = soloIntensity === undefined ? 0
        : Math.max(1, Math.min(5, Math.floor(Number.isFinite(soloIntensity) ? soloIntensity : 3)));
    const litterWaves200 = litterItemsPerWave === 0 ? 0 : soloLevel > 0
        ? SOLO_WAVES_200[soloLevel - 1]
        : Math.min(boundedCount(profile.litterWaves200,
            FORMAL_PROFILE.litterWaves200, 1, 4), waveCapacity);
    const litterWaves400 = litterItemsPerWave === 0 ? 0 : soloLevel > 0
        ? SOLO_WAVES_400[soloLevel - 1]
        : Math.min(boundedCount(profile.litterWaves400,
            FORMAL_PROFILE.litterWaves400, 1, 4), waveCapacity);
    const xOrder = random.shuffle([...BUOY_X]);
    const buoyAnchors: ObstacleBuoyAnchor[] = [];
    const leftSpace = safeCenter - BUOY_CORRIDOR_CLEARANCE - (-halfWidth);
    const rightSpace = halfWidth - (safeCenter + BUOY_CORRIDOR_CLEARANCE);
    for (let index = 0; index < buoyCount; index++) {
        const chooseRight = leftSpace <= 0 ? true : rightSpace <= 0 ? false
            : random.int(2) === 0;
        const minZ = chooseRight ? safeCenter + BUOY_CORRIDOR_CLEARANCE : -halfWidth;
        const maxZ = chooseRight ? halfWidth : safeCenter - BUOY_CORRIDOR_CLEARANCE;
        if (maxZ < minZ) continue;
        buoyAnchors.push({ courseX: xOrder[index], lateral: minZ + (maxZ - minZ) * random.next() });
    }
    let identity = 2166136261;
    const mix = (value: number) => { identity = Math.imul(identity ^ (value >>> 0), 16777619) >>> 0; };
    mix(seed); mix(Math.round(anchorDistance * 100));
    mix(layout === 'debris' ? 1 : layout === 'buoy' ? 2 : 3);
    mix(Math.round(safeCenter * 1000));
    mix(litterItemsPerWave);
    mix(litterPoolSize);
    mix(litterWaves200);
    mix(litterWaves400);
    for (const buoy of buoyAnchors) { mix(Math.round(buoy.courseX * 100)); mix(Math.round(buoy.lateral * 1000)); }
    return {
        identity: identity || 1,
        layout,
        safeCenter,
        buoyAnchors,
        litterItemsPerWave,
        litterPoolSize,
        litterWaves200,
        litterWaves400,
    };
}
