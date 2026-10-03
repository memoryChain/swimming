import { buildEntertainmentLightPlan } from './EntertainmentLightPlan';
export type EntertainmentDebugMode = 'none' | 'supplies' | 'debris' | 'supplies-debris' | 'whirlpool' | 'whirlpool-super' | 'geyser' | 'geyser-large' | 'giant-wave' | 'light-mix' | 'spray-buoy';
export const ENTERTAINMENT_DEBUG_CHOICES: readonly { id: EntertainmentDebugMode; label: string }[] = [
    { id: 'none', label: '关闭' },
    { id: 'supplies', label: '补给' },
    { id: 'debris', label: '杂物' },
    { id: 'supplies-debris', label: '补给＋杂物' },
    { id: 'whirlpool', label: '普通漩涡' },
    { id: 'whirlpool-super', label: '含超级漩涡' },
    { id: 'geyser', label: '普通喷泉' },
    { id: 'geyser-large', label: '大喷泉混排' },
    { id: 'giant-wave', label: '普通巨浪' },
    { id: 'spray-buoy', label: '喷雾浮标' },
    { id: 'light-mix', label: '低强度组合' },
];
export function normalizeEntertainmentDebugMode(value: unknown): EntertainmentDebugMode {
    return value === 'supplies' || value === 'debris' || value === 'supplies-debris' || value === 'whirlpool' || value === 'whirlpool-super' || value === 'geyser' || value === 'geyser-large' || value === 'giant-wave' || value === 'light-mix' || value === 'spray-buoy' ? value : 'none';
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
    return {
        sprayBuoy: mode === 'spray-buoy',
        geyser: mode === 'geyser' || mode === 'geyser-large' || light?.waterEvent === 'geyser',
        geyserIntensity: mode === 'geyser-large' ? 2 as const : 1 as const,
        giantWave: mode === 'giant-wave' || light?.waterEvent === 'giant-wave',
        whirlpool: mode === 'whirlpool' || mode === 'whirlpool-super' || light?.waterEvent === 'whirlpool',
        whirlpoolSelection: mode === 'whirlpool-super' ? 'super' as const : 'normal' as const,
        supplies: light?.supplies ?? (mode === 'supplies' || mode === 'supplies-debris'
            ? (long ? [35, 85, 135, 235, 335] : [35, 85, 135]) : []),
        debris: light?.debris ?? (mode === 'debris' || mode === 'supplies-debris'
            ? (long ? [18, 68, 118, 218, 318] : [18, 68, 118]) : []),
        light,
    };
}
