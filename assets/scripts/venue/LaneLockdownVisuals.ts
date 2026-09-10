import { RaceCourseLayout } from './RaceCourseLayout';
import { WaterRefractionController } from './WaterRefractionController';
import { laneEdgeZ } from './LaneLayout';

/**
 * Visual-only lane-lockdown state. The water material renders the mask itself so
 * it shares the existing refraction, wave distortion, and camera render path.
 */
export class LaneLockdownVisuals {
    constructor(
        private readonly _waterRefraction: WaterRefractionController,
        private readonly _layout: RaceCourseLayout,
    ) {}

    /** Sets the inclusive one-based safe-lane range, e.g. 2..7 for the first lock. */
    setSafeLanes(firstSafeLane: number, lastSafeLane: number) {
        const range = this.laneRange(firstSafeLane, lastSafeLane);
        this._waterRefraction.setLaneLockdownMask(range.safeMinZ, range.safeMaxZ);
    }

    setWarningLanes(firstSafeLane: number, lastSafeLane: number) {
        const range = this.laneRange(firstSafeLane, lastSafeLane);
        this._waterRefraction.setLaneLockdownWarning(range.safeMinZ, range.safeMaxZ);
    }

    clear() {
        this._waterRefraction.clearLaneLockdownMask();
    }

    private laneRange(firstSafeLane: number, lastSafeLane: number) {
        const laneCount = this._layout.laneCount;
        const first = clampInt(firstSafeLane, 1, laneCount);
        const last = clampInt(lastSafeLane, first, laneCount);
        return {
            safeMinZ: laneEdgeZ(last + 1, this._layout),
            safeMaxZ: laneEdgeZ(first, this._layout),
        };
    }

    dispose() {
        this.clear();
    }
}

function clampInt(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Math.round(value)));
}
