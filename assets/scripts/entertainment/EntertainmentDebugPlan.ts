export type EntertainmentDebugMode = 'none' | 'supplies' | 'debris' | 'supplies-debris';
export const ENTERTAINMENT_DEBUG_CHOICES: readonly { id: EntertainmentDebugMode; label: string }[] = [
    { id: 'none', label: '关闭' },
    { id: 'supplies', label: '补给' },
    { id: 'debris', label: '杂物' },
    { id: 'supplies-debris', label: '补给＋杂物' },
];
export function normalizeEntertainmentDebugMode(value: unknown): EntertainmentDebugMode {
    return value === 'supplies' || value === 'debris' || value === 'supplies-debris' ? value : 'none';
}
/** 门禁必须先于构造规则、绑定选手、加载资产和配置 Motor。 */
export function entertainmentDebugAllowed(aiDebug: boolean, networked: boolean, room: boolean,
    tutorial: boolean, boss: boolean, mode: unknown): boolean {
    return aiDebug && !networked && !room && !tutorial && !boss && normalizeEntertainmentDebugMode(mode) !== 'none';
}
/** 固定的小事件列表；未接入的浮标、巨浪、喷泉等不进入随机候选。 */
export function buildEntertainmentDebugPlan(mode: EntertainmentDebugMode, raceDistance: number) {
    const long = raceDistance >= 400;
    return {
        supplies: mode === 'supplies' || mode === 'supplies-debris'
            ? (long ? [35, 85, 135, 235, 335] : [35, 85, 135]) : [],
        debris: mode === 'debris' || mode === 'supplies-debris'
            ? (long ? [18, 68, 118, 218, 318] : [18, 68, 118]) : [],
    };
}
