/** 使用连续居中的泳道。返回0基起始泳道；8泳道双人赛为3，即第4、5道。 */
export function centeredLaneStart(laneCount: number, racerCount: number): number {
    if (!Number.isInteger(racerCount) || racerCount < 2 || racerCount > laneCount) throw new Error('参赛人数超出泳道容量');
    return Math.floor((laneCount - racerCount) / 2);
}
/** AI数组按实际占用泳道升序保存，未使用泳道必须返回-1。 */
export function aiIndexInLaneRange(lane: number, playerLane: number, start: number, count: number): number {
    if (lane === playerLane || lane < start || lane >= start + count) return -1;
    return lane - start - (lane > playerLane ? 1 : 0);
}
