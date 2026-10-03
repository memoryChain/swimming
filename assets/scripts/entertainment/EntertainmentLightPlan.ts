import { SeededRandom } from '../core/SharedRNG';

export type LightWaterEvent = 'whirlpool' | 'geyser' | 'giant-wave';
export type EntertainmentLightPlan = Readonly<{
    supplies: readonly number[];
    suppliesPerWave: number;
    debris: readonly number[];
    debrisWaveCounts: readonly number[];
    debrisPerWave: number;
    debrisPoolSize: number;
    waterEvent: LightWaterEvent;
    waterEventDistance: number;
}>;

function spread(count: number, first: number, last: number, random: SeededRandom, jitter: number, distance: number): number[] {
    return Array.from({ length: count }, (_, index) =>
        (first + (last - first) * (index / Math.max(1, count - 1)) + (random.next() * 2 - 1) * jitter) * distance);
}

/** 来源 EntertainmentRacePlan 的二档、纯杂物排布；暂未接入的海龟沿用来源的普通漩涡替补。 */
export function buildEntertainmentLightPlan(seed: number, distance: number): EntertainmentLightPlan {
    const safeSeed = (Number.isFinite(seed) ? seed : 0) >>> 0;
    const raceDistance = distance >= 400 ? 400 : 200;
    const long = raceDistance === 400;
    const field = new SeededRandom((safeSeed ^ 0x454e5635) >>> 0);
    const choice = field.int(100);
    const waterEvent: LightWaterEvent = choice < 50 ? 'whirlpool' : choice < 75 ? 'geyser' : 'giant-wave';
    // 保持原长赛计划的随机消费顺序，其他系统使用各自的子流。
    if (long) field.int(1);
    const progress = .12 + field.next() * .06 + (field.next() * 2 - 1) * .015;
    const obstacles = new SeededRandom((safeSeed ^ 0x4f425741) >>> 0);
    const supplies = new SeededRandom((safeSeed ^ 0x53555050) >>> 0);
    const debrisWaves = long ? 5 : 3;
    return {
        supplies: spread(long ? 4 : 3, .14, .82, supplies, .01, raceDistance),
        suppliesPerWave: long ? 4 : 3,
        debris: spread(debrisWaves, .10, .80, obstacles, .015, raceDistance),
        debrisWaveCounts: Array.from({ length: debrisWaves }, (_, index) => index === 0 ? 2 : 4),
        debrisPerWave: 4, debrisPoolSize: 12,
        waterEvent, waterEventDistance: progress * raceDistance,
    };
}
