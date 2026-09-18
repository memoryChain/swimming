import { SeededRandom } from './SharedRNG';

export const STIMULANT_BRAWL_TUNING = {
    waveCount: 7,
    itemsPerWave: 3,
    energyRestoreRatio: 0.5,
    heartRateBurden: 30,
    pickupRadius: 1.2,
    pickupBodyHalfLength: 0.8,
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
};

export const STIMULANT_PUBLIC_WAVE_DISTANCES = [35, 60, 85, 110, 135, 160, 185] as const;

/**
 * 只依赖主机种子的固定赛程。
 * 七波各三瓶并随机分散到不同泳道；所有瓶子都是公共争抢目标。
 */
export function buildStimulantSchedule(seed: number, laneCount = 8): StimulantSpawn[] {
    const rng = new SeededRandom((seed ^ 0x51a7e11d) >>> 0);
    const result: StimulantSpawn[] = [];
    const safeLaneCount = Math.max(1, Math.floor(laneCount));
    let id = 0;

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
            });
        }
    }
    return result;
}

/**
 * 兴奋剂的二维身体胶囊与短路径扫掠判定。
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
 * 先按赛程距离筛掉其他趟数的道具，再进行世界坐标中的身体胶囊判定。
 * 50 米泳池会把 200 米赛程折返到重复的世界坐标；缺少这一层会提前拾取后续趟数的隐藏道具。
 */
export function stimulantPickupRaceDistanceEligible(
    itemDistance: number,
    currentDistance: number,
    previousDistance: number,
    pickupRadius: number,
    bodyHalfLength: number,
    maxSweepDistance: number,
): boolean {
    if (!Number.isFinite(itemDistance) || !Number.isFinite(currentDistance)) return false;
    const reach = Math.max(0, Number.isFinite(pickupRadius) ? pickupRadius : 0)
        + Math.max(0, Number.isFinite(bodyHalfLength) ? bodyHalfLength : 0);
    let startDistance = currentDistance;
    const maxSweep = Math.max(0, Number.isFinite(maxSweepDistance) ? maxSweepDistance : 0);
    if (
        Number.isFinite(previousDistance)
        && Math.abs(currentDistance - previousDistance) <= maxSweep
    ) {
        startDistance = previousDistance;
    }
    return itemDistance >= Math.min(startDistance, currentDistance) - reach
        && itemDistance <= Math.max(startDistance, currentDistance) + reach;
}

/**
 * 折返泳池中，道具只在它所属的当前单程内显示。
 * 否则下一单程的道具会提前映射到眼前的同一池段，形成“看得见但吃不到”的假目标。
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
