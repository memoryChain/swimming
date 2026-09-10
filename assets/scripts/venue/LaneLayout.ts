type LaneDimensions = { readonly laneCount: number; readonly laneWidth: number };

// 起跳侧视镜头位于 +Z 侧：从近处的 1 道到远处的最后一道，Z 递减。
export function laneCenterZ(index: number, layout: LaneDimensions): number {
    return laneEdgeZ(index + 1, layout) - layout.laneWidth * 0.5;
}

export function laneNumberForZ(z: number, layout: LaneDimensions): number {
    const lane = Math.floor((layout.laneCount * layout.laneWidth * 0.5 - z) / layout.laneWidth) + 1;
    return Math.max(1, Math.min(layout.laneCount, lane));
}

// 边界按编号顺序排列：1 是 1 道近侧池边，laneCount + 1 是最后一道远侧池边。
export function laneEdgeZ(oneBasedEdge: number, layout: LaneDimensions): number {
    return layout.laneCount * layout.laneWidth * 0.5 - (oneBasedEdge - 1) * layout.laneWidth;
}

export class LaneLayout {
    readonly laneCount: number;
    readonly laneWidth: number;

    constructor(laneCount: number, laneWidth: number) {
        this.laneCount = laneCount;
        this.laneWidth = laneWidth;
    }

    centerZ(index: number): number {
        return laneCenterZ(index, this);
    }

    get poolWidth(): number {
        return this.laneCount * this.laneWidth;
    }
}
