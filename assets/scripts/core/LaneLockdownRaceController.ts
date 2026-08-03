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

export type LaneLockdownAiTarget = {
    safeMinZ: number;
    safeMaxZ: number;
    warning: boolean;
} | null;

/** Owns the high-difficulty warning, elimination, and corridor-boundary loop. */
export class LaneLockdownRaceController {
    private _nextLockIndex = 0;
    private _warningTimer = 0;
    private _pendingFirstSafeLane = 1;
    private _pendingLastSafeLane = 0;
    private _activeFirstSafeLane = 1;
    private _activeLastSafeLane = 0;
    private _lastAiTargetFirstSafeLane = 0;
    private _lastAiTargetLastSafeLane = 0;
    private _lastAiTargetWarning = false;
    private _lastStatusFirstSafeLane = 0;
    private _lastStatusLastSafeLane = 0;
    private _lastStatusWarningSeconds = -1;
    private _lastStatusLocked = false;

    constructor(
        private readonly _layout: RaceCourseLayout,
        private readonly _visuals: LaneLockdownVisuals | null,
        private readonly _eliminate: (swimmer: Swimmer) => void,
        private readonly _onStatus: (status: LaneLockdownStatus | null) => void,
        private readonly _onAiTarget: (target: LaneLockdownAiTarget) => void,
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
        this._lastStatusFirstSafeLane = 0;
        this._lastStatusLastSafeLane = 0;
        this._lastStatusWarningSeconds = -1;
        this._lastStatusLocked = false;
        this._onStatus(null);
        this.clearAiTarget();
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
            this.clearAiTarget();
            return;
        }
        const leader = racers.reduce((current, swimmer) => swimmer.distance > current.distance ? swimmer : current);
        const predicted = this.safeLaneRangeForLeader(leader, SAFE_LANE_COUNTS[this._nextLockIndex]);
        this.publishAiTarget(predicted.first, predicted.last, false);
        if (leader.distance < LOCK_DISTANCES[this._nextLockIndex]) {
            return;
        }
        this.beginWarning(leader);
    }

    private beginWarning(leader: Swimmer) {
        const safeLaneCount = SAFE_LANE_COUNTS[this._nextLockIndex];
        const pending = this.safeLaneRangeForLeader(leader, safeLaneCount);
        this._pendingFirstSafeLane = pending.first;
        this._pendingLastSafeLane = pending.last;
        this._warningTimer = WARNING_SECONDS;
        this._visuals?.setWarningLanes(this._pendingFirstSafeLane, this._pendingLastSafeLane);
        this.publishAiTarget(this._pendingFirstSafeLane, this._pendingLastSafeLane, true);
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
        this.clearAiTarget();
        for (const swimmer of racers) {
            if (swimmer.node.active) {
                swimmer.setLaneLockdownBounds(safeMinZ, safeMaxZ);
            }
        }
        this.publishStatus(false);
    }

    private publishStatus(warning: boolean) {
        const firstSafeLane = warning ? this._pendingFirstSafeLane : this._activeFirstSafeLane;
        const lastSafeLane = warning ? this._pendingLastSafeLane : this._activeLastSafeLane;
        const warningSeconds = warning ? Math.ceil(this._warningTimer) : 0;
        const locked = !warning;
        if (firstSafeLane === this._lastStatusFirstSafeLane
            && lastSafeLane === this._lastStatusLastSafeLane
            && warningSeconds === this._lastStatusWarningSeconds
            && locked === this._lastStatusLocked) {
            return;
        }
        this._lastStatusFirstSafeLane = firstSafeLane;
        this._lastStatusLastSafeLane = lastSafeLane;
        this._lastStatusWarningSeconds = warningSeconds;
        this._lastStatusLocked = locked;
        this._onStatus({
            firstSafeLane,
            lastSafeLane,
            warningSeconds,
            locked,
        });
    }

    private safeLaneRangeForLeader(leader: Swimmer, safeLaneCount: number) {
        const leaderLane = laneForZ(leader.node.position.z, this._layout);
        const minFirst = this._activeFirstSafeLane;
        const maxFirst = this._activeLastSafeLane - safeLaneCount + 1;
        const centeredFirst = leaderLane - Math.floor((safeLaneCount - 1) * 0.5);
        const first = clampInt(centeredFirst, minFirst, maxFirst);
        return { first, last: first + safeLaneCount - 1 };
    }

    private publishAiTarget(firstSafeLane: number, lastSafeLane: number, warning: boolean) {
        if (firstSafeLane === this._lastAiTargetFirstSafeLane
            && lastSafeLane === this._lastAiTargetLastSafeLane
            && warning === this._lastAiTargetWarning) {
            return;
        }
        this._lastAiTargetFirstSafeLane = firstSafeLane;
        this._lastAiTargetLastSafeLane = lastSafeLane;
        this._lastAiTargetWarning = warning;
        this._onAiTarget({
            safeMinZ: laneEdgeZ(firstSafeLane, this._layout),
            safeMaxZ: laneEdgeZ(lastSafeLane + 1, this._layout),
            warning,
        });
    }

    private clearAiTarget() {
        if (this._lastAiTargetFirstSafeLane === 0) {
            return;
        }
        this._lastAiTargetFirstSafeLane = 0;
        this._lastAiTargetLastSafeLane = 0;
        this._lastAiTargetWarning = false;
        this._onAiTarget(null);
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
