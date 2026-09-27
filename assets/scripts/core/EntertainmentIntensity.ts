import { EntertainmentEventId } from './EntertainmentModeDirector';

/** 只用于开发测试；公开娱乐比赛继续使用原导演规格。 */
export type EntertainmentIntensity = 1 | 2 | 3 | 4 | 5;

export const ENTERTAINMENT_INTENSITY_LABELS = ['轻度', '偏弱', '标准', '高强', '超强'] as const;

export const ENTERTAINMENT_TEST_COMBINATIONS = [
    { id: 'litter-minefield', label: '杂物＋浮标', events: [EntertainmentEventId.LITTER, EntertainmentEventId.MINEFIELD] },
    { id: 'litter-whirlpool', label: '杂物＋双涡', events: [EntertainmentEventId.LITTER, EntertainmentEventId.WHIRLPOOL] },
    { id: 'minefield-cannon', label: '浮标＋双炮', events: [EntertainmentEventId.MINEFIELD, EntertainmentEventId.CANNON] },
    { id: 'stimulant-shark', label: '补给＋玩具鲨', events: [EntertainmentEventId.STIMULANT, EntertainmentEventId.SHARK] },
] as const;
export type EntertainmentTestCombination = typeof ENTERTAINMENT_TEST_COMBINATIONS[number]['id'];

export function entertainmentTestCombinationEvents(id: EntertainmentTestCombination | null): readonly EntertainmentEventId[] | null {
    return ENTERTAINMENT_TEST_COMBINATIONS.find(entry => entry.id === id)?.events ?? null;
}

export function normalizeEntertainmentIntensity(value: unknown): EntertainmentIntensity | null {
    return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5
        ? value as EntertainmentIntensity
        : null;
}

export type EntertainmentIntensityProfile = Readonly<{
    litterItemsPerWave: number;
    litterWaves200: number;
    litterWaves400: number;
    litterPoolSize: number;
    mineCount: number;
    stimulantItemsPerWave: number;
    stimulantWaves200: number;
    stimulantWaves400: number;
    cannonStrikes200: number;
    cannonStrikes400: number;
    cannonConcurrency: 1 | 2;
    cannonMinimumIntervalSeconds: number;
    sharkHunts200: number;
    sharkHunts400: number;
    sharkSpeedScale: number;
    timedBallRounds200: number;
    timedBallRounds400: number;
    timedBallFuseSeconds: number;
    whirlpoolCount: 1 | 2;
    whirlpoolRadiusScale: number;
    whirlpoolForceScale: number;
    whirlpoolSuperCount: 0 | 1;
}>;

const PROFILES: readonly EntertainmentIntensityProfile[] = [
    { litterItemsPerWave: 3, litterWaves200: 1, litterWaves400: 2, litterPoolSize: 6, mineCount: 2,
        stimulantItemsPerWave: 1, stimulantWaves200: 1, stimulantWaves400: 2,
        cannonStrikes200: 1, cannonStrikes400: 2, cannonConcurrency: 1, cannonMinimumIntervalSeconds: 3,
        sharkHunts200: 1, sharkHunts400: 1, sharkSpeedScale: 0.75,
        timedBallRounds200: 1, timedBallRounds400: 1, timedBallFuseSeconds: 10,
        whirlpoolCount: 1, whirlpoolRadiusScale: 0.7, whirlpoolForceScale: 0.6, whirlpoolSuperCount: 0 },
    { litterItemsPerWave: 4, litterWaves200: 2, litterWaves400: 2, litterPoolSize: 12, mineCount: 3,
        stimulantItemsPerWave: 2, stimulantWaves200: 2, stimulantWaves400: 3,
        cannonStrikes200: 2, cannonStrikes400: 3, cannonConcurrency: 1, cannonMinimumIntervalSeconds: 2.6,
        sharkHunts200: 1, sharkHunts400: 1, sharkSpeedScale: 0.9,
        timedBallRounds200: 1, timedBallRounds400: 1, timedBallFuseSeconds: 9,
        whirlpoolCount: 1, whirlpoolRadiusScale: 0.85, whirlpoolForceScale: 0.8, whirlpoolSuperCount: 0 },
    { litterItemsPerWave: 6, litterWaves200: 2, litterWaves400: 3, litterPoolSize: 18, mineCount: 5,
        stimulantItemsPerWave: 3, stimulantWaves200: 2, stimulantWaves400: 4,
        cannonStrikes200: 3, cannonStrikes400: 5, cannonConcurrency: 1, cannonMinimumIntervalSeconds: 2.3,
        sharkHunts200: 1, sharkHunts400: 2, sharkSpeedScale: 1,
        timedBallRounds200: 1, timedBallRounds400: 2, timedBallFuseSeconds: 8,
        whirlpoolCount: 1, whirlpoolRadiusScale: 1, whirlpoolForceScale: 1, whirlpoolSuperCount: 0 },
    { litterItemsPerWave: 10, litterWaves200: 2, litterWaves400: 3, litterPoolSize: 24, mineCount: 8,
        stimulantItemsPerWave: 4, stimulantWaves200: 3, stimulantWaves400: 5,
        cannonStrikes200: 6, cannonStrikes400: 9, cannonConcurrency: 2, cannonMinimumIntervalSeconds: 1,
        sharkHunts200: 2, sharkHunts400: 3, sharkSpeedScale: 1.08,
        timedBallRounds200: 2, timedBallRounds400: 3, timedBallFuseSeconds: 7,
        whirlpoolCount: 2, whirlpoolRadiusScale: 1, whirlpoolForceScale: 1, whirlpoolSuperCount: 0 },
    { litterItemsPerWave: 15, litterWaves200: 3, litterWaves400: 4, litterPoolSize: 30, mineCount: 12,
        stimulantItemsPerWave: 5, stimulantWaves200: 4, stimulantWaves400: 6,
        cannonStrikes200: 9, cannonStrikes400: 12, cannonConcurrency: 2, cannonMinimumIntervalSeconds: 0.85,
        sharkHunts200: 3, sharkHunts400: 4, sharkSpeedScale: 1.15,
        timedBallRounds200: 3, timedBallRounds400: 4, timedBallFuseSeconds: 6,
        whirlpoolCount: 2, whirlpoolRadiusScale: 1, whirlpoolForceScale: 1, whirlpoolSuperCount: 1 },
];

type IntensityField = keyof EntertainmentIntensityProfile;
export type EntertainmentIntensityTuningField = Readonly<{
    key: IntensityField;
    group: string;
    label: string;
    min: number;
    max: number;
    step: number;
    precision: number;
}>;

/** 调试参数有硬上限，避免保存值突破本轮对象池和联机设计预算。 */
export const ENTERTAINMENT_INTENSITY_TUNING_FIELDS: readonly EntertainmentIntensityTuningField[] = [
    { key: 'litterItemsPerWave', group: '杂物', label: '每波件数', min: 1, max: 15, step: 1, precision: 0 },
    { key: 'litterWaves200', group: '杂物', label: '200米波数', min: 1, max: 3, step: 1, precision: 0 },
    { key: 'litterWaves400', group: '杂物', label: '400米波数', min: 1, max: 4, step: 1, precision: 0 },
    { key: 'litterPoolSize', group: '杂物', label: '在场槽位', min: 3, max: 30, step: 1, precision: 0 },
    { key: 'mineCount', group: '浮标', label: '浮标数量', min: 1, max: 12, step: 1, precision: 0 },
    { key: 'stimulantItemsPerWave', group: '补给', label: '每波件数', min: 1, max: 5, step: 1, precision: 0 },
    { key: 'stimulantWaves200', group: '补给', label: '200米波数', min: 1, max: 4, step: 1, precision: 0 },
    { key: 'stimulantWaves400', group: '补给', label: '400米波数', min: 1, max: 6, step: 1, precision: 0 },
    { key: 'cannonStrikes200', group: '水炮', label: '200米发数', min: 1, max: 9, step: 1, precision: 0 },
    { key: 'cannonStrikes400', group: '水炮', label: '400米发数', min: 1, max: 12, step: 1, precision: 0 },
    { key: 'cannonConcurrency', group: '水炮', label: '同时水球', min: 1, max: 2, step: 1, precision: 0 },
    { key: 'cannonMinimumIntervalSeconds', group: '水炮', label: '最短发射间隔', min: 0.85, max: 4, step: 0.05, precision: 2 },
    { key: 'sharkHunts200', group: '玩具鲨', label: '200米追逐轮数', min: 1, max: 3, step: 1, precision: 0 },
    { key: 'sharkHunts400', group: '玩具鲨', label: '400米追逐轮数', min: 1, max: 4, step: 1, precision: 0 },
    { key: 'sharkSpeedScale', group: '玩具鲨', label: '追逐速度倍率', min: 0.7, max: 1.15, step: 0.01, precision: 2 },
    { key: 'timedBallRounds200', group: '定时水球', label: '200米轮数', min: 1, max: 3, step: 1, precision: 0 },
    { key: 'timedBallRounds400', group: '定时水球', label: '400米轮数', min: 1, max: 4, step: 1, precision: 0 },
    { key: 'timedBallFuseSeconds', group: '定时水球', label: '倒计时秒数', min: 6, max: 12, step: 0.5, precision: 1 },
    { key: 'whirlpoolCount', group: '漩涡', label: '同时漩涡', min: 1, max: 2, step: 1, precision: 0 },
    { key: 'whirlpoolRadiusScale', group: '漩涡', label: '影响半径倍率', min: 0.7, max: 1, step: 0.05, precision: 2 },
    { key: 'whirlpoolForceScale', group: '漩涡', label: '水流力度倍率', min: 0.6, max: 1, step: 0.05, precision: 2 },
    { key: 'whirlpoolSuperCount', group: '漩涡', label: '超级漩涡数', min: 0, max: 1, step: 1, precision: 0 },
];

const tunedProfiles: EntertainmentIntensityProfile[] = PROFILES.map(profile => ({ ...profile }));

export function getEntertainmentIntensityTuning(level: EntertainmentIntensity, field: IntensityField): number {
    return tunedProfiles[level - 1][field];
}

export function setEntertainmentIntensityTuning(level: EntertainmentIntensity, field: IntensityField, value: number): void {
    const spec = ENTERTAINMENT_INTENSITY_TUNING_FIELDS.find(candidate => candidate.key === field);
    if (!spec || !Number.isFinite(value)) return;
    const minimum = field === 'litterPoolSize'
        ? Math.max(spec.min, tunedProfiles[level - 1].litterItemsPerWave) : spec.min;
    const bounded = Math.max(minimum, Math.min(spec.max, value));
    const normalized = spec.precision === 0 ? Math.round(bounded)
        : Math.round(bounded * 10 ** spec.precision) / 10 ** spec.precision;
    tunedProfiles[level - 1] = { ...tunedProfiles[level - 1], [field]: normalized } as EntertainmentIntensityProfile;
    if (field === 'litterItemsPerWave' && tunedProfiles[level - 1].litterPoolSize < normalized) {
        tunedProfiles[level - 1] = { ...tunedProfiles[level - 1], litterPoolSize: normalized };
    }
}

export function entertainmentIntensityProfile(level: EntertainmentIntensity): EntertainmentIntensityProfile {
    const profile = tunedProfiles[level - 1];
    // 开赛时持有独立快照；调试面板后续改值不会改变已经开始的事件。
    return { ...profile };
}

export function entertainmentEventIntensity(levels: readonly EntertainmentIntensity[], event: EntertainmentEventId): EntertainmentIntensity {
    return levels[event] ?? 3;
}
