import { GameState } from './GameConstants';
import { Swimmer } from '../entity/Swimmer';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { LaneLockdownVisuals } from '../venue/LaneLockdownVisuals';

const LOCK_DISTANCES = [50, 100, 150];
const SAFE_LANE_COUNTS = [6, 4, 2];
const WARNING_SECONDS = 3;
const COLLIDER_CLEARANCE = 0.04;

export type LaneLockdownStatus = {
    firstSafeLane: number;
    lastSafeLane: number;
    warningSeconds: number;
    locked: boolean;
};

/** Owns the high-difficulty warning, elimination, and corridor-boundary loop. */
export class LaneLockdownRaceController {
    private _nextLockIndex = 0;
    private _warningTimer = 0;
    private _pendingFirstSafeLane = 1;
    private _pendingLastSafeLane = 0;
    private _activeFirstSafeLane = 1;
    private _activeLastSafeLane = 0;

    constructor(
        private readonly _layout: RaceCourseLayout,
        private readonly _visuals: LaneLockdownVisuals | null,
        private readonly _eliminate: (swimmer: Swimmer) => void,
        private readonly _onStatus: (status: LaneLockdownStatus | null) => void,
    ) {
        this._activeLastSafeLane = _layout.laneCount;
    }

    reset() {
        this._nextLockIndex = 0;
        this._warningTimer = 0;
        this._pendingFirstSafeLane = 1;
        this._pendingLastSafeLane = this._layout.laneCount;
        this._activeFirstSafeLane = 1;
        this._activeLastSafeLane = this._layout.laneCount;
        this._visuals?.clear();
        this._onStatus(null);
    }

    update(dt: number, state: GameState, racers: readonly Swimmer[]) {
        if (state !== GameState.RACING || racers.length <= 0) {
            return;
        }

        if (this._warningTimer > 0) {
            this._warningTimer = Math.max(0, this._warningTimer - dt);
            this.publishStatus(true);
            if (this._warningTimer <= 0) {
                this.activatePendingLock(racers);
            }
            return;
        }

        if (this._nextLockIndex >= LOCK_DISTANCES.length) {
            return;
        }
        const leader = racers.reduce((current, swimmer) => swimmer.distance > current.distance ? swimmer : current);
        if (leader.distance < LOCK_DISTANCES[this._nextLockIndex]) {
            return;
        }
        this.beginWarning(leader);
    }

    private beginWarning(leader: Swimmer) {
        const safeLaneCount = SAFE_LANE_COUNTS[this._nextLockIndex];
        const leaderLane = laneForZ(leader.node.position.z, this._layout);
        const minFirst = this._activeFirstSafeLane;
        const maxFirst = this._activeLastSafeLane - safeLaneCount + 1;
        const centeredFirst = leaderLane - Math.floor((safeLaneCount - 1) * 0.5);
        this._pendingFirstSafeLane = clampInt(centeredFirst, minFirst, maxFirst);
        this._pendingLastSafeLane = this._pendingFirstSafeLane + safeLaneCount - 1;
        this._warningTimer = WARNING_SECONDS;
        this._visuals?.setWarningLanes(this._pendingFirstSafeLane, this._pendingLastSafeLane);
        this.publishStatus(true);
    }

    private activatePendingLock(racers: readonly Swimmer[]) {
        const safeMinZ = laneEdgeZ(this._pendingFirstSafeLane, this._layout);
        const safeMaxZ = laneEdgeZ(this._pendingLastSafeLane + 1, this._layout);
        for (const swimmer of racers) {
            const bounds = swimmer.swimBoundaryZRange();
            if (bounds.min < safeMinZ + COLLIDER_CLEARANCE || bounds.max > safeMaxZ - COLLIDER_CLEARANCE) {
                this._eliminate(swimmer);
            }
        }
        this._activeFirstSafeLane = this._pendingFirstSafeLane;
        this._activeLastSafeLane = this._pendingLastSafeLane;
        this._nextLockIndex += 1;
        this._visuals?.setSafeLanes(this._activeFirstSafeLane, this._activeLastSafeLane);
        for (const swimmer of racers) {
            if (swimmer.node.active) {
                swimmer.setLaneLockdownBounds(safeMinZ, safeMaxZ);
            }
        }
        this.publishStatus(false);
    }

    private publishStatus(warning: boolean) {
        this._onStatus({
            firstSafeLane: warning ? this._pendingFirstSafeLane : this._activeFirstSafeLane,
            lastSafeLane: warning ? this._pendingLastSafeLane : this._activeLastSafeLane,
            warningSeconds: warning ? Math.ceil(this._warningTimer) : 0,
            locked: !warning,
        });
    }
}

function laneForZ(z: number, layout: RaceCourseLayout) {
    return clampInt(Math.floor((z + layout.poolWidth * 0.5) / layout.laneWidth) + 1, 1, layout.laneCount);
}

function laneEdgeZ(oneBasedEdge: number, layout: RaceCourseLayout) {
    return -layout.poolWidth * 0.5 + (oneBasedEdge - 1) * layout.laneWidth;
}

function clampInt(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Math.round(value)));
}