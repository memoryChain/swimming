import { SeededRandom } from './SharedRNG';

export const STIMULANT_BRAWL_TUNING = {
    waveCount: 8,
    itemsPerWave: 3,
    energyRestoreRatio: 0.5,
    heartRateBurden: 30,
    pickupRadius: 1.2,
    reactionDuration: 6,
    oversteerStartHeartRate: 130,
    oversteerMaxHeartRate: 180,
    maxTurnImpulseScale: 1.65,
    minTurnDragScale: 0.55,
    aiSkipHeartRate: 165,
};

export type StimulantSpawn = {
    id: number;
    wave: number;
    distance: number;
    laneIndex: number;
    lateralOffset: number;
    guaranteed: boolean;
};

export const STIMULANT_PUBLIC_WAVE_DISTANCES = [35, 60, 85, 110, 135, 160, 185] as const;
export const STIMULANT_OPENING_DISTANCE = 14;

/**
 * 只依赖主机种子的固定赛程。
 * 第 0 波为每条泳道的保证体验，之后七波各三瓶并随机分散到不同泳道。
 */
export function buildStimulantSchedule(seed: number, laneCount = 8): StimulantSpawn[] {
    const rng = new SeededRandom((seed ^ 0x51a7e11d) >>> 0);
    const result: StimulantSpawn[] = [];
    const safeLaneCount = Math.max(1, Math.floor(laneCount));
    let id = 0;

    for (let laneIndex = 0; laneIndex < safeLaneCount; laneIndex++) {
        result.push({
            id: id++,
            wave: 0,
            distance: STIMULANT_OPENING_DISTANCE,
            laneIndex,
            lateralOffset: 0,
            guaranteed: true,
        });
    }

    let previousLaneKey = '';
    for (let publicWave = 0; publicWave < STIMULANT_PUBLIC_WAVE_DISTANCES.length; publicWave++) {
        const wave = publicWave + 1;
        const lanes = Array.from({ length: safeLaneCount }, (_, index) => index);
        rng.shuffle(lanes);
        const count = Math.min(STIMULANT_BRAWL_TUNING.itemsPerWave, safeLaneCount);
        let selected = lanes.slice(0, count);
        let laneKey = selected.slice().sort((a, b) => a - b).join(',');
        if (laneKey === previousLaneKey && safeLaneCount > count) {
            selected[count - 1] = lanes[count];
            laneKey = selected.slice().sort((a, b) => a - b).join(',');
        }
        previousLaneKey = laneKey;
        for (const laneIndex of selected) {
            const side = rng.next() < 0.5 ? -1 : 1;
            const lateralOffset = side * rng.range(0.36, 0.72);
            result.push({
                id: id++,
                wave,
                distance: STIMULANT_PUBLIC_WAVE_DISTANCES[publicWave],
                laneIndex,
                lateralOffset,
                guaranteed: false,
            });
        }
    }
    return result;
}

export function stimulantOversteerRatio(heartRate: number): number {
    if (!Number.isFinite(heartRate)) return 0;
    const min = STIMULANT_BRAWL_TUNING.oversteerStartHeartRate;
    const max = Math.max(min + 1, STIMULANT_BRAWL_TUNING.oversteerMaxHeartRate);
    return Math.max(0, Math.min(1, (heartRate - min) / (max - min)));
}

export function stimulantTurnImpulseScale(heartRate: number): number {
    const t = stimulantOversteerRatio(heartRate);
    return 1 + (Math.max(1, STIMULANT_BRAWL_TUNING.maxTurnImpulseScale) - 1) * t;
}

export function stimulantTurnDragScale(heartRate: number): number {
    const t = stimulantOversteerRatio(heartRate);
    return 1 + (Math.max(0, Math.min(1, STIMULANT_BRAWL_TUNING.minTurnDragScale)) - 1) * t;
}
