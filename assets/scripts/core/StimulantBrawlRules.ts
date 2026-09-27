import { SeededRandom } from './SharedRNG';

export const STIMULANT_BRAWL_TUNING = {
    waveCount: 7,
    itemsPerWave: 3,
    energyRestoreRatio: 0.3,
    heartRateBurden: 40,
    heartRateRecoveryHoldSeconds: 4,
    pickupRadius: 1.2,
    pickupBodyHalfLength: 0.8,
    reactionDuration: 6,
    oversteerStartHeartRate: 130,
    oversteerMaxHeartRate: 180,
    maxTurnImpulseScale: 1.65,
    minTurnDragScale: 0.55,
    aiSkipHeartRate: 165,
    calmSlushHeartRateDrop: 60,
    calmSlushDuration: 3,
    calmSlushPropulsionScale: 0.9,
    calmSlushAiPreferHeartRate: 145,
    calmSlushAiStronglyPreferHeartRate: 165,
};

export type StimulantItemKind = 'heartbeat-soda' | 'calm-slush';

export type StimulantSpawn = {
    id: number;
    wave: number;
    distance: number;
    laneIndex: number;
    lateralOffset: number;
    kind: StimulantItemKind;
};

export const STIMULANT_PUBLIC_WAVE_DISTANCES = [35, 60, 85, 110, 135, 160, 185] as const;
export const STIMULANT_ENTERTAINMENT_WALL_CLEARANCE = 4;
const STIMULANT_ENTERTAINMENT_MIN_LEAD_DISTANCE = 4;
const STIMULANT_ENTERTAINMENT_MIN_WAVE_GAP = 4;
const STIMULANT_WORLD_WAVE_GAP = 2.5;
const STIMULANT_WAVE_GRID_PER_METER = 4;

/**
 * 只依赖主机种子的固定赛程。
 * 七波各三瓶并随机分散到不同泳道；所有瓶子都是公共争抢目标。
 */
export function buildStimulantSchedule(seed: number, laneCount = 8, courseLength = 50): StimulantSpawn[] {
    const distances = planStimulantWaveDistances(
        STIMULANT_PUBLIC_WAVE_DISTANCES,
        STIMULANT_PUBLIC_WAVE_DISTANCES[0],
        194,
        courseLength,
        200,
        0,
    );
    return buildScheduleAtDistances(seed, laneCount, distances);
}

/** 六合一短事件：两波各三瓶，位置以房主激活时的权威赛程距离为锚点。 */
export function buildEntertainmentStimulantSchedule(
    seed: number,
    laneCount: number,
    anchorDistance: number,
    raceDistance = 200,
    courseLength = 50,
    waveCount?: number,
    itemsPerWave = STIMULANT_BRAWL_TUNING.itemsPerWave,
): StimulantSpawn[] {
    const longRace = raceDistance >= 400;
    const lastAnchor = longRace ? 365 : 175;
    const lastSpawn = longRace ? 390 : 194;
    const anchor = Math.round(Math.max(0, Math.min(
        lastAnchor, Number.isFinite(anchorDistance) ? anchorDistance : 0,
    )) * STIMULANT_WAVE_GRID_PER_METER) / STIMULANT_WAVE_GRID_PER_METER;
    const offsets = waveCount === undefined ? (longRace ? [5, 13, 21, 29] : [6, 19])
        : Array.from({ length: Math.max(1, Math.min(6, Math.floor(waveCount))) }, (_, index) =>
            (longRace ? 5 : 6) + index * (longRace ? 8 : 13));
    const distances = planStimulantWaveDistances(
        offsets.map(offset => Math.min(lastSpawn, anchor + offset)),
        anchor,
        lastSpawn,
        courseLength,
        raceDistance,
        STIMULANT_ENTERTAINMENT_MIN_LEAD_DISTANCE,
    );
    return buildScheduleAtDistances(seed ^ 0x454e5453, laneCount, distances, itemsPerWave);
}

/** Whole-race public supplies: preserve the existing physical-pool and wall safety planner. */
export function buildGradedStimulantSchedule(
    seed: number,
    laneCount: number,
    raceDistance: number,
    courseLength: number,
    preferredWaveDistances: readonly number[],
    itemsPerWave: number,
): StimulantSpawn[] {
    const longRace = raceDistance >= 400;
    const distances = planStimulantWaveDistances(
        preferredWaveDistances,
        0,
        longRace ? 390 : 194,
        courseLength,
        raceDistance,
        4,
    );
    return buildScheduleAtDistances(seed ^ 0x454e5453, laneCount, distances, itemsPerWave);
}

/** 开赛前把补给换到同波的安全泳道，避免与本局固定浮标锚点重叠。 */
export function avoidGradedSupplyBuoys(
    schedule: readonly StimulantSpawn[],
    laneCenters: readonly number[],
    anchors: readonly Readonly<{ courseX: number; lateral: number }>[],
    courseLength: number,
): StimulantSpawn[] {
    if (anchors.length === 0 || laneCenters.length === 0) return [...schedule];
    const result: StimulantSpawn[] = [];
    for (let start = 0; start < schedule.length;) {
        let end = start + 1;
        while (end < schedule.length && schedule[end].wave === schedule[start].wave) end++;
        const wave = schedule.slice(start, end);
        const chosen = new Array<number>(wave.length).fill(-1);
        const used = new Set<number>();
        const place = (index: number): boolean => {
            if (index >= wave.length) return true;
            const spawn = wave[index];
            const leg = Math.floor(spawn.distance / courseLength);
            const local = spawn.distance % courseLength;
            const courseX = leg % 2 === 0 ? local : courseLength - local;
            for (let offset = 0; offset < laneCenters.length; offset++) {
                const lane = (spawn.laneIndex + offset) % laneCenters.length;
                if (used.has(lane)) continue;
                const lateral = laneCenters[lane] + spawn.lateralOffset;
                if (anchors.some(anchor => Math.abs(anchor.courseX - courseX) < 2.5
                    && Math.abs(anchor.lateral - lateral) < 2.1)) continue;
                chosen[index] = lane;
                used.add(lane);
                if (place(index + 1)) return true;
                used.delete(lane);
            }
            chosen[index] = -1;
            return false;
        };
        if (!place(0)) throw new Error('No safe lane assignment for graded entertainment supplies');
        for (let index = 0; index < wave.length; index++) {
            const spawn = wave[index];
            result.push(chosen[index] === spawn.laneIndex ? spawn : { ...spawn, laneIndex: chosen[index] });
        }
        start = end;
    }
    return result;
}

/**
 * 折返后不同赛程距离可能对应同一实体水域。按四分之一米网格一次性排点，
 * 同时避开折返墙、先前波次的实体位置，并为尾段剩余波次预留前向间距。
 * 如果末段没有足够安全位置，按规范裁减尾波，绝不把多波钳到同一落点。
 */
function planStimulantWaveDistances(
    distances: readonly number[],
    anchorDistance: number,
    lastSpawnDistance: number,
    courseLength: number,
    raceDistance: number,
    minimumLeadDistance: number,
): number[] {
    const grid = STIMULANT_WAVE_GRID_PER_METER;
    const first = Math.round((anchorDistance + minimumLeadDistance) * grid);
    const last = Math.round(lastSpawnDistance * grid);
    const leg = Math.max(1, Math.round((Number.isFinite(courseLength) ? courseLength : 50) * grid));
    const race = Math.round(raceDistance * grid);
    const minGap = STIMULANT_ENTERTAINMENT_MIN_WAVE_GAP * grid;
    const worldGap = STIMULANT_WORLD_WAVE_GAP * grid;
    const wallClearance = STIMULANT_ENTERTAINMENT_WALL_CLEARANCE * grid;
    const maxCount = Math.min(distances.length, Math.floor((last - first) / minGap) + 1);

    for (let count = maxCount; count > 0; count--) {
        const planned: number[] = [];
        let feasible = true;
        for (let index = 0; index < count; index++) {
            const minimum = index === 0 ? first : planned[index - 1] + minGap;
            const maximum = last - (count - 1 - index) * minGap;
            const preferred = Math.min(maximum, Math.max(minimum, Math.round(distances[index] * grid)));
            const candidate = nearestSafeStimulantWave(
                preferred, minimum, maximum, planned, leg, race, wallClearance, worldGap,
            );
            if (candidate === null) {
                feasible = false;
                break;
            }
            planned.push(candidate);
        }
        if (feasible) return planned.map(distance => distance / grid);
    }
    return [];
}

function nearestSafeStimulantWave(
    preferred: number,
    minimum: number,
    maximum: number,
    previous: readonly number[],
    courseLength: number,
    raceDistance: number,
    wallClearance: number,
    worldGap: number,
): number | null {
    for (let delta = 0; delta <= maximum - minimum; delta++) {
        const after = preferred + delta;
        if (after <= maximum && safeStimulantWavePosition(
            after, previous, courseLength, raceDistance, wallClearance, worldGap,
        )) return after;
        const before = preferred - delta;
        if (delta > 0 && before >= minimum && safeStimulantWavePosition(
            before, previous, courseLength, raceDistance, wallClearance, worldGap,
        )) return before;
    }
    return null;
}

function safeStimulantWavePosition(
    distance: number,
    previous: readonly number[],
    courseLength: number,
    raceDistance: number,
    wallClearance: number,
    worldGap: number,
): boolean {
    for (let wall = courseLength; wall < raceDistance; wall += courseLength) {
        if (Math.abs(distance - wall) < wallClearance) return false;
    }
    const physical = stimulantPhysicalPoolOffset(distance, courseLength);
    for (const prior of previous) {
        if (Math.abs(physical - stimulantPhysicalPoolOffset(prior, courseLength)) < worldGap) return false;
    }
    return true;
}

function stimulantPhysicalPoolOffset(distance: number, courseLength: number): number {
    const leg = Math.floor(distance / courseLength);
    const progress = distance % courseLength;
    return leg % 2 === 0 ? progress : courseLength - progress;
}

function buildScheduleAtDistances(
    seed: number,
    laneCount: number,
    distances: readonly number[],
    itemsPerWave = STIMULANT_BRAWL_TUNING.itemsPerWave,
): StimulantSpawn[] {
    const rng = new SeededRandom((seed ^ 0x51a7e11d) >>> 0);
    const kindRng = new SeededRandom((seed ^ 0x43414c4d) >>> 0);
    const result: StimulantSpawn[] = [];
    const safeLaneCount = Math.max(1, Math.floor(laneCount));
    const waveKinds = buildWaveKinds(distances.length, kindRng);
    let id = 0;

    let previousLaneKey = '';
    for (let publicWave = 0; publicWave < distances.length; publicWave++) {
        const wave = publicWave + 1;
        const kind = waveKinds[publicWave];
        const lanes = Array.from({ length: safeLaneCount }, (_, index) => index);
        rng.shuffle(lanes);
        const count = Math.min(Math.max(1, Math.floor(itemsPerWave)), safeLaneCount);
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
                distance: distances[publicWave],
                laneIndex,
                lateralOffset,
                kind,
            });
        }
    }
    return result;
}

/**
 * 每三波固定两波心跳苏打和一波冷静冰沙，再按共享种子洗牌。
 * 类型在波次层决定，同一波的三个公共争抢点始终是同一种补给。
 */
function buildWaveKinds(waveCount: number, rng: SeededRandom): StimulantItemKind[] {
    const result: StimulantItemKind[] = [];
    while (result.length < waveCount) {
        const bag: StimulantItemKind[] = ['heartbeat-soda', 'heartbeat-soda', 'calm-slush'];
        rng.shuffle(bag);
        for (const kind of bag) {
            if (result.length >= waveCount) break;
            result.push(kind);
        }
    }
    return result;
}

/**
 * 心跳苏打的二维身体胶囊与短路径扫掠判定。
 * 高度不参与；过长的位置跳变视为网络校正，不沿整段路径补捡道具。
 */
export function stimulantPickupDistanceSquared(
    itemX: number,
    itemZ: number,
    currentX: number,
    currentZ: number,
    previousX: number,
    previousZ: number,
    forwardX: number,
    forwardZ: number,
    bodyHalfLength: number,
    maxSweepDistance: number,
): number {
    const safeHalfLength = Math.max(0, Number.isFinite(bodyHalfLength) ? bodyHalfLength : 0);
    const forwardLength = Math.hypot(forwardX, forwardZ);
    const nx = forwardLength > 1e-6 ? forwardX / forwardLength : 1;
    const nz = forwardLength > 1e-6 ? forwardZ / forwardLength : 0;
    let bestSq = pointSegmentDistanceSquared(
        itemX,
        itemZ,
        currentX - nx * safeHalfLength,
        currentZ - nz * safeHalfLength,
        currentX + nx * safeHalfLength,
        currentZ + nz * safeHalfLength,
    );

    if (!Number.isFinite(previousX) || !Number.isFinite(previousZ)) return bestSq;
    const dx = currentX - previousX;
    const dz = currentZ - previousZ;
    const maxSweep = Math.max(0, Number.isFinite(maxSweepDistance) ? maxSweepDistance : 0);
    if (dx * dx + dz * dz > maxSweep * maxSweep) return bestSq;
    bestSq = Math.min(bestSq, pointSegmentDistanceSquared(
        itemX,
        itemZ,
        previousX,
        previousZ,
        currentX,
        currentZ,
    ));
    return bestSq;
}

/**
 * 折返泳池仍用赛程单程决定某波何时从看台投放。
 * 道具一旦开始投放便转为世界公共物品，显示和拾取不再调用这一门槛。
 */
export function stimulantIsOnCurrentCourseLeg(
    itemDistance: number,
    referenceDistance: number,
    courseLength: number,
): boolean {
    if (
        !Number.isFinite(itemDistance)
        || !Number.isFinite(referenceDistance)
        || !Number.isFinite(courseLength)
        || courseLength <= 0
    ) return false;
    const itemLeg = Math.floor(Math.max(0, itemDistance) / courseLength);
    const referenceLeg = Math.floor(Math.max(0, referenceDistance) / courseLength);
    return itemLeg === referenceLeg;
}

function pointSegmentDistanceSquared(
    px: number,
    pz: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
): number {
    const abX = bx - ax;
    const abZ = bz - az;
    const lengthSq = abX * abX + abZ * abZ;
    const ratio = lengthSq > 1e-8
        ? Math.max(0, Math.min(1, ((px - ax) * abX + (pz - az) * abZ) / lengthSq))
        : 0;
    const dx = px - (ax + abX * ratio);
    const dz = pz - (az + abZ * ratio);
    return dx * dx + dz * dz;
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
