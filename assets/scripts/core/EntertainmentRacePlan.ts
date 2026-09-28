import { EntertainmentEventId } from './EntertainmentModeDirector';
import { SeededRandom } from './SharedRNG';
import type { ObstacleLayout } from './ObstacleBrawlRules';

/** The whole-race grade is independent of AI skill and an individual event's intensity. */
export type EntertainmentRaceGrade = 1 | 2 | 3 | 4 | 5;

export type EntertainmentMainStage = Readonly<{
    event: EntertainmentEventId;
    intensity: EntertainmentRaceGrade;
    previewProgress: number;
    actionCount: number;
    durationSeconds: number;
    required: boolean;
}>;

export type EntertainmentObstacleBudget = Readonly<{
    layout: ObstacleLayout;
    intensity: EntertainmentRaceGrade;
    litterWaveDistances: readonly number[];
    litterWaveCounts: readonly number[];
    litterPoolSize: number;
    buoyBatchDistances: readonly number[];
    buoyBatchCounts: readonly number[];
}>;

export type EntertainmentSupplyBudget = Readonly<{
    waveDistances: readonly number[];
    itemsPerWave: number;
}>;

export type EntertainmentRacePlan = Readonly<{
    version: 1;
    balanceVersion: 1;
    identity: number;
    seed: number;
    raceDistance: 200 | 400;
    grade: EntertainmentRaceGrade;
    obstacle: EntertainmentObstacleBudget;
    supply: EntertainmentSupplyBudget;
    stages: readonly EntertainmentMainStage[];
    encoreLimit: 1;
}>;

type GradeNumbers = Readonly<{
    litterWaves200: number;
    litterWaves400: number;
    pureLitterPerWave: number;
    pureLitterPool: number;
    mixedLitterPerWave: number;
    mixedLitterPool: number;
    pureBuoys200: number;
    pureBuoys400: number;
    mixedBuoys200: number;
    mixedBuoys400: number;
    supplyWaves200: number;
    supplyWaves400: number;
    supplyItems200: number;
    supplyItems400: number;
}>;

const GRADE_NUMBERS: readonly GradeNumbers[] = [
    { litterWaves200: 3, litterWaves400: 5, pureLitterPerWave: 3, pureLitterPool: 6,
        mixedLitterPerWave: 2, mixedLitterPool: 4, pureBuoys200: 2, pureBuoys400: 3,
        mixedBuoys200: 1, mixedBuoys400: 2, supplyWaves200: 3, supplyWaves400: 4,
        supplyItems200: 2, supplyItems400: 3 },
    { litterWaves200: 3, litterWaves400: 5, pureLitterPerWave: 4, pureLitterPool: 12,
        mixedLitterPerWave: 3, mixedLitterPool: 6, pureBuoys200: 3, pureBuoys400: 4,
        mixedBuoys200: 2, mixedBuoys400: 3, supplyWaves200: 3, supplyWaves400: 4,
        supplyItems200: 3, supplyItems400: 4 },
    { litterWaves200: 4, litterWaves400: 6, pureLitterPerWave: 6, pureLitterPool: 18,
        mixedLitterPerWave: 4, mixedLitterPool: 12, pureBuoys200: 5, pureBuoys400: 6,
        mixedBuoys200: 3, mixedBuoys400: 4, supplyWaves200: 4, supplyWaves400: 5,
        supplyItems200: 3, supplyItems400: 4 },
    { litterWaves200: 4, litterWaves400: 7, pureLitterPerWave: 6, pureLitterPool: 18,
        mixedLitterPerWave: 4, mixedLitterPool: 12, pureBuoys200: 5, pureBuoys400: 6,
        mixedBuoys200: 3, mixedBuoys400: 4, supplyWaves200: 4, supplyWaves400: 6,
        supplyItems200: 4, supplyItems400: 4 },
    { litterWaves200: 5, litterWaves400: 8, pureLitterPerWave: 10, pureLitterPool: 24,
        mixedLitterPerWave: 7, mixedLitterPool: 21, pureBuoys200: 8, pureBuoys400: 8,
        mixedBuoys200: 5, mixedBuoys400: 5, supplyWaves200: 4, supplyWaves400: 6,
        supplyItems200: 5, supplyItems400: 5 },
];

export function normalizeEntertainmentRaceGrade(value: unknown): EntertainmentRaceGrade | null {
    return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5
        ? value as EntertainmentRaceGrade : null;
}

function spreadProgress(count: number, first: number, last: number, random: SeededRandom, jitter: number): number[] {
    const progress: number[] = [];
    for (let index = 0; index < count; index++) {
        const ratio = count === 1 ? 0 : index / (count - 1);
        progress.push(first + (last - first) * ratio + (random.next() * 2 - 1) * jitter);
    }
    return progress;
}

function buoyBatchProgress(count: number): readonly number[] {
    return count <= 0 ? [] : count === 1 ? [0.25]
        : count === 2 ? [0.18, 0.58] : [0.15, 0.42, 0.68];
}

function mainStage(event: EntertainmentEventId, intensity: EntertainmentRaceGrade,
    previewProgress: number, actionCount: number, durationSeconds: number, required: boolean): EntertainmentMainStage {
    return { event, intensity, previewProgress, actionCount, durationSeconds, required };
}

function buildMainStages(seed: number, raceDistance: 200 | 400, grade: EntertainmentRaceGrade): EntertainmentMainStage[] {
    const longRace = raceDistance === 400;
    const turtleOpening = new SeededRandom((seed ^ 0x54555254) >>> 0).int(3) === 0;
    switch (grade) {
        case 1: return [];
        case 2: return [mainStage(EntertainmentEventId.WHIRLPOOL, 1, longRace ? 0.26 : 0.32, 1, 8, true)];
        case 3: return longRace ? [
            mainStage(turtleOpening ? EntertainmentEventId.TURTLE_BUS : EntertainmentEventId.WHIRLPOOL,
                2, 0.16, 1, turtleOpening ? 15 : 8, false),
            mainStage(EntertainmentEventId.TIMED_BOMB, 1, 0.40, 1, 11.5, true),
            mainStage(EntertainmentEventId.TIMED_BOMB, 1, 0.66, 1, 11.5, false),
        ] : [
            mainStage(turtleOpening ? EntertainmentEventId.TURTLE_BUS : EntertainmentEventId.WHIRLPOOL,
                2, 0.20, 1, turtleOpening ? 15 : 8, false),
            mainStage(EntertainmentEventId.TIMED_BOMB, 1, 0.54, 1, 11.5, true),
        ];
        case 4: {
            const openingEvent = turtleOpening ? EntertainmentEventId.TURTLE_BUS
                : longRace || new SeededRandom((seed ^ 0x52414334) >>> 0).int(2) === 0
                    ? EntertainmentEventId.WHIRLPOOL : EntertainmentEventId.TIMED_BOMB;
            const opening = mainStage(openingEvent, 2, longRace ? 0.14 : 0.20, 1,
                openingEvent === EntertainmentEventId.TURTLE_BUS ? 15
                    : openingEvent === EntertainmentEventId.WHIRLPOOL ? 8 : 10.5, false);
            return longRace ? [opening,
                mainStage(EntertainmentEventId.TIMED_BOMB, 2, 0.38, 1, 10.5, false),
                mainStage(EntertainmentEventId.CANNON, 2, 0.64, 3, 10.8, true),
            ] : [opening,
                mainStage(EntertainmentEventId.CANNON, 2, 0.52, 2, 8.2, true),
            ];
        }
        case 5: return longRace ? [
            mainStage(turtleOpening ? EntertainmentEventId.TURTLE_BUS : EntertainmentEventId.WHIRLPOOL,
                2, 0.12, 1, turtleOpening ? 15 : 8, false),
            mainStage(EntertainmentEventId.CANNON, 4, 0.36, 6, 9, false),
            mainStage(EntertainmentEventId.SHARK, 3, 0.62, 1, 14, true),
        ] : [
            mainStage(EntertainmentEventId.CANNON, 3, 0.22, 3, 9.9, false),
            mainStage(EntertainmentEventId.SHARK, 3, 0.52, 1, 14, true),
        ];
    }
}

/** Deterministic opening configuration; no scene nodes or per-frame allocations. */
export function buildEntertainmentRacePlan(seed: number, distance: number,
    grade: EntertainmentRaceGrade, forcedLayout?: ObstacleLayout): EntertainmentRacePlan {
    const safeSeed = (Number.isFinite(seed) ? seed : 0) >>> 0;
    const raceDistance: 200 | 400 = distance >= 400 ? 400 : 200;
    const numbers = GRADE_NUMBERS[grade - 1];
    if (!numbers) throw new RangeError('Invalid entertainment race grade');
    const layoutRandom = new SeededRandom((safeSeed ^ 0x4f425354) >>> 0);
    const layout: ObstacleLayout = forcedLayout ?? (['debris', 'buoy', 'mixed'] as const)[layoutRandom.int(3)];
    const longRace = raceDistance === 400;
    const litterWaves = layout === 'buoy' ? 0 : longRace ? numbers.litterWaves400 : numbers.litterWaves200;
    const litterPerWave = layout === 'mixed' ? numbers.mixedLitterPerWave : numbers.pureLitterPerWave;
    const litterWaveCounts = Array.from({ length: litterWaves }, (_, index) =>
        index === 0 ? Math.ceil(litterPerWave / 2) : litterPerWave);
    const buoyCount = layout === 'debris' ? 0 : layout === 'mixed'
        ? longRace ? numbers.mixedBuoys400 : numbers.mixedBuoys200
        : longRace ? numbers.pureBuoys400 : numbers.pureBuoys200;
    const buoyBatchCount = Math.min(3, buoyCount);
    const buoyBatchCounts = Array.from({ length: buoyBatchCount }, (_, index) =>
        Math.floor(buoyCount / buoyBatchCount) + (index >= buoyBatchCount - buoyCount % buoyBatchCount ? 1 : 0));
    const obstacleRandom = new SeededRandom((safeSeed ^ 0x4f425741) >>> 0);
    const supplyRandom = new SeededRandom((safeSeed ^ 0x53555050) >>> 0);
    const supplyWaves = longRace ? numbers.supplyWaves400 : numbers.supplyWaves200;
    const plan = {
        version: 1,
        balanceVersion: 1,
        seed: safeSeed,
        raceDistance,
        grade,
        obstacle: {
            layout,
            intensity: grade === 5 ? 4 : grade === 4 ? 3 : grade,
            litterWaveDistances: spreadProgress(litterWaves, 0.10, 0.80, obstacleRandom, 0.015)
                .map(progress => progress * raceDistance),
            litterWaveCounts,
            litterPoolSize: layout === 'buoy' ? 0 : layout === 'mixed'
                ? numbers.mixedLitterPool : numbers.pureLitterPool,
            buoyBatchDistances: buoyBatchProgress(buoyBatchCount).map(progress => progress * raceDistance),
            buoyBatchCounts,
        },
        supply: {
            waveDistances: spreadProgress(supplyWaves, 0.14, 0.82, supplyRandom, 0.01)
                .map(progress => progress * raceDistance),
            itemsPerWave: longRace ? numbers.supplyItems400 : numbers.supplyItems200,
        },
        stages: buildMainStages(safeSeed, raceDistance, grade),
        encoreLimit: 1,
    } as const;
    return { ...plan, identity: entertainmentRacePlanIdentity(plan) };
}

function entertainmentRacePlanIdentity(plan: Omit<EntertainmentRacePlan, 'identity'>): number {
    let hash = 2166136261;
    const mix = (value: number) => { hash = Math.imul(hash ^ (value >>> 0), 16777619) >>> 0; };
    mix(plan.version); mix(plan.balanceVersion); mix(plan.seed); mix(plan.raceDistance); mix(plan.grade);
    mix(plan.obstacle.layout === 'debris' ? 1 : plan.obstacle.layout === 'buoy' ? 2 : 3);
    mix(plan.obstacle.intensity); mix(plan.obstacle.litterPoolSize);
    for (const value of plan.obstacle.litterWaveDistances) mix(Math.round(value * 1000));
    for (const value of plan.obstacle.litterWaveCounts) mix(value);
    for (const value of plan.obstacle.buoyBatchDistances) mix(Math.round(value * 1000));
    for (const value of plan.obstacle.buoyBatchCounts) mix(value);
    for (const value of plan.supply.waveDistances) mix(Math.round(value * 1000));
    mix(plan.supply.itemsPerWave);
    for (const stage of plan.stages) {
        mix(stage.event); mix(stage.intensity); mix(Math.round(stage.previewProgress * 10000));
        mix(stage.actionCount); mix(Math.round(stage.durationSeconds * 1000)); mix(stage.required ? 1 : 0);
    }
    return hash || 1;
}
