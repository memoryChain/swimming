import { buildEntertainmentLightPlan } from './EntertainmentLightPlan';
import type { GeyserIntensity } from './GeyserBrawlRules';
import type { GiantWaveIntensity } from './GiantWaveRules';
import { CANNON_BRAWL_TUNING } from '../core/EntertainmentBalance';
import { CANNON_STRIKE_TRIGGERS } from './CannonBrawlController';
export type EntertainmentDebugMode = 'none' | 'supplies' | 'debris' | 'supplies-debris' | 'whirlpool' | 'whirlpool-super' | 'geyser' | 'geyser-large' | 'geyser-three' | 'geyser-four' | 'geyser-five' | 'giant-wave-one' | 'giant-wave-two' | 'giant-wave' | 'giant-wave-four' | 'giant-wave-five' | 'light-mix' | 'spray-buoy' | 'cannon' | 'cannon-one' | 'cannon-two' | 'cannon-three' | 'cannon-four' | 'cannon-five' | 'water-balloon';
export const ENTERTAINMENT_DEBUG_CHOICES: readonly { id: EntertainmentDebugMode; label: string }[] = [
    { id: 'none', label: '关闭' },
    { id: 'supplies', label: '补给' },
    { id: 'debris', label: '杂物' },
    { id: 'supplies-debris', label: '补给＋杂物' },
    { id: 'whirlpool', label: '普通漩涡' },
    { id: 'whirlpool-super', label: '含超级漩涡' },
    { id: 'geyser', label: '普通喷泉' },
    { id: 'geyser-large', label: '大喷泉混排' },
    { id: 'geyser-three', label: '喷泉三档混排' },
    { id: 'geyser-four', label: '喷泉四档混排' },
    { id: 'geyser-five', label: '喷泉五档混排' },
    { id: 'giant-wave-one', label: '巨浪一档' },
    { id: 'giant-wave-two', label: '巨浪二档' },
    { id: 'giant-wave', label: '普通巨浪' },
    { id: 'giant-wave-four', label: '巨浪四档' },
    { id: 'giant-wave-five', label: '巨浪五档' },
    { id: 'spray-buoy', label: '喷雾浮标' },
    { id: 'cannon', label: '单发炮击' },
    { id: 'cannon-one', label: '一档单发炮击' },
    { id: 'cannon-two', label: '二档单发炮击' },
    { id: 'cannon-three', label: '三档单发炮击' },
    { id: 'cannon-four', label: '四档双发炮击' },
    { id: 'cannon-five', label: '五档双发炮击' },
    { id: 'water-balloon', label: '定时水球接力' },
    { id: 'light-mix', label: '低强度组合' },
];
export function normalizeEntertainmentDebugMode(value: unknown): EntertainmentDebugMode {
    return value === 'supplies' || value === 'debris' || value === 'supplies-debris' || value === 'whirlpool' || value === 'whirlpool-super' || value === 'geyser' || value === 'geyser-large' || value === 'geyser-three' || value === 'geyser-four' || value === 'geyser-five' || value === 'giant-wave-one' || value === 'giant-wave-two' || value === 'giant-wave' || value === 'giant-wave-four' || value === 'giant-wave-five' || value === 'light-mix' || value === 'spray-buoy' || value === 'cannon' || value === 'cannon-one' || value === 'cannon-two' || value === 'cannon-three' || value === 'cannon-four' || value === 'cannon-five' || value === 'water-balloon' ? value : 'none';
}
export type CannonDebugPlan = Readonly<{ maxConcurrentLaunches: 1 | 2; minimumLaunchIntervalSeconds: number; triggers: readonly number[] }>;
/** 五档共用发数映射，调试入口与比赛计划不各自维护规格。 */
export function entertainmentCannonIntensity(mode: unknown): 1 | 2 | 3 | 4 | 5 | null {
    switch (mode) {
        case 'cannon-one': return 1;
        case 'cannon-two': return 2;
        case 'cannon-three': return 3;
        case 'cannon-four': return 4;
        case 'cannon-five': return 5;
        default: return null;
    }
}
const CANNON_COUNTS: readonly (readonly [number, number])[] = [[1, 2], [2, 3], [3, 5], [6, 9], [9, 12]];
/** 沿用来源五档发数和每3米触发计划；原单发保留已有计划。 */
export function buildCannonDebugPlan(mode: unknown, raceDistance: number): CannonDebugPlan | null {
    if (mode === 'cannon') return { maxConcurrentLaunches: 1, minimumLaunchIntervalSeconds: 0, triggers: CANNON_STRIKE_TRIGGERS };
    const level = entertainmentCannonIntensity(mode);
    if (!level) return null;
    const count = CANNON_COUNTS[level - 1][raceDistance >= 400 ? 1 : 0];
    const minimumLaunchIntervalSeconds = level === 1 ? CANNON_BRAWL_TUNING.oneMinimumIntervalSeconds
        : level === 2 ? CANNON_BRAWL_TUNING.twoMinimumIntervalSeconds
        : level === 3 ? CANNON_BRAWL_TUNING.threeMinimumIntervalSeconds
        : level === 4 ? CANNON_BRAWL_TUNING.fourMinimumIntervalSeconds : CANNON_BRAWL_TUNING.fiveMinimumIntervalSeconds;
    return { maxConcurrentLaunches: level >= 4 ? 2 : 1, minimumLaunchIntervalSeconds,
        triggers: Array.from({ length: count }, (_, i) => 20 + i * 3) };
}
/** 一、二档保留旧 id；调试界面和比赛计划消费同一个档位映射。 */
export function entertainmentGeyserIntensity(mode: unknown): GeyserIntensity | null {
    switch (mode) {
        case 'geyser': return 1;
        case 'geyser-large': return 2;
        case 'geyser-three': return 3;
        case 'geyser-four': return 4;
        case 'geyser-five': return 5;
        default: return null;
    }
}
/** 原普通巨浪保留三档；各入口共用已有的五档规格。 */
export function entertainmentGiantWaveIntensity(mode: unknown): GiantWaveIntensity | null {
    switch (mode) {
        case 'giant-wave-one': return 1;
        case 'giant-wave-two': return 2;
        case 'giant-wave': return 3;
        case 'giant-wave-four': return 4;
        case 'giant-wave-five': return 5;
        default: return null;
    }
}
/** 门禁必须先于构造规则、绑定选手、加载资产和配置 Motor。 */
export function entertainmentDebugAllowed(aiDebug: boolean, networked: boolean, room: boolean,
    tutorial: boolean, boss: boolean, mode: unknown): boolean {
    return aiDebug && !networked && !room && !tutorial && !boss && normalizeEntertainmentDebugMode(mode) !== 'none';
}
/** 独立调试列表；未接入事件不进入候选。 */
export function buildEntertainmentDebugPlan(mode: EntertainmentDebugMode, raceDistance: number, seed = 1) {
    const long = raceDistance >= 400;
    const light = mode === 'light-mix' ? buildEntertainmentLightPlan(seed, raceDistance) : null;
    const geyserIntensity = entertainmentGeyserIntensity(mode);
    const giantWaveIntensity = entertainmentGiantWaveIntensity(mode);
    const cannonPlan = buildCannonDebugPlan(mode, raceDistance);
    return {
        waterBalloon: mode === 'water-balloon',
        sprayBuoy: mode === 'spray-buoy',
        cannon: cannonPlan !== null,
        cannonPlan,
        geyser: geyserIntensity !== null || light?.waterEvent === 'geyser',
        geyserIntensity: geyserIntensity ?? 1 as const,
        giantWave: giantWaveIntensity !== null || light?.waterEvent === 'giant-wave',
        giantWaveIntensity: giantWaveIntensity ?? (light ? 1 : 3) as GiantWaveIntensity,
        whirlpool: mode === 'whirlpool' || mode === 'whirlpool-super' || light?.waterEvent === 'whirlpool',
        whirlpoolSelection: mode === 'whirlpool-super' ? 'super' as const : 'normal' as const,
        supplies: light?.supplies ?? (mode === 'supplies' || mode === 'supplies-debris'
            ? (long ? [35, 85, 135, 235, 335] : [35, 85, 135]) : []),
        debris: light?.debris ?? (mode === 'debris' || mode === 'supplies-debris'
            ? (long ? [18, 68, 118, 218, 318] : [18, 68, 118]) : []),
        light,
    };
}
