export class LaneLayout {
    readonly laneCount: number;
    readonly laneWidth: number;

    constructor(laneCount: number, laneWidth: number) {
        this.laneCount = laneCount;
        this.laneWidth = laneWidth;
    }

    centerZ(index: number): number {
        return -this.poolWidth / 2 + this.laneWidth * (index + 0.5);
    }

    get poolWidth(): number {
        return this.laneCount * this.laneWidth;
    }
}
