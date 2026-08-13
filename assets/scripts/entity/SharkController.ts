import { Node, Vec3 } from 'cc';
import type { Swimmer } from './Swimmer';
import { SHARK_TUNING, SharkState } from './SharkTuning';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { randomFloat } from '../core/SharedRNG';

// Compact state carried by the host's race snapshot. Coordinates are world-space
// metres; the snapshot codec quantizes them before transport.
export type SharkRaceState = {
    sequence: number;
    state: SharkState;
    remainingSeconds: number;
    huntOpeningGraceSeconds: number;
    x: number;
    z: number;
    ownerLane: number;
    targetLane: number;
    eliminatedLane: number;
};

export type SharkControllerOptions = {
    node: Node;
    course: RaceCourseLayout;
    swimmers: () => readonly Swimmer[];
    laneFor: (swimmer: Swimmer) => number;
    swimmerForLane: (lane: number) => Swimmer | null;
    onEliminate: (swimmer: Swimmer) => void;
    onSummoned?: (x: number, z: number) => void;
    onStateChange?: (state: SharkState) => void;
    // Fires exactly when the no-bite wind-up ends and true pursuit begins.
    onHuntEngaged?: () => void;
};

// A single race-owned predator. It has no per-frame allocations and intentionally
// has no knowledge of skill energy or UI. Those belong to the caller.
export class SharkController {
    private _state = SharkState.INACTIVE;
    private _remainingSeconds = 0;
    private _retargetSeconds = 0;
    private _huntOpeningGraceSeconds = 0;
    private _huntEngaged = false;
    private _target: Swimmer | null = null;
    private _ownerLane = -1;
    private _sequence = 0;
    private _eliminatedLane = -1;

    constructor(private readonly _opts: SharkControllerOptions) {
        this._opts.node.active = false;
    }

    get active(): boolean { return this._state !== SharkState.INACTIVE; }
    get state(): SharkState { return this._state; }
    get sequence(): number { return this._sequence; }
    get ownerLane(): number { return this._ownerLane; }
    get eliminatedLane(): number { return this._eliminatedLane; }
    get target(): Swimmer | null { return this._target; }

    reset(): void {
        this.setState(SharkState.INACTIVE);
        this._remainingSeconds = 0;
        this._retargetSeconds = 0;
        this._huntOpeningGraceSeconds = 0;
        this._huntEngaged = false;
        this._target = null;
        this._ownerLane = -1;
        this._eliminatedLane = -1;
        if (this._opts.node.active) this._opts.node.active = false;
    }

    // The caller must already have verified the caster's full gauge. A failed
    // attempt leaves energy untouched, which is the global-lock rule.
    trySummon(owner: Swimmer): boolean {
        if (this.active || !owner.isSharkTargetable) return false;
        this._sequence++;
        this._ownerLane = this._opts.laneFor(owner);
        this._eliminatedLane = -1;
        this._target = null;
        this.placeAtSafeRandomWaterPosition();
        this.setState(SharkState.WARNING);
        this._remainingSeconds = SHARK_TUNING.warningSeconds;
        this._retargetSeconds = 0;
        this.retarget();
        if (!this._opts.node.active) this._opts.node.active = true;
        this._opts.onSummoned?.(this._opts.node.position.x, this._opts.node.position.z);
        return true;
    }

    // Run only on the authoritative host (or in single player). Clients render the
    // received state via applyAuthoritativeState instead.
    tick(dt: number): void {
        if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
        if (this._state === SharkState.WARNING) {
            this._remainingSeconds = Math.max(0, this._remainingSeconds - dt);
            this.retarget();
            if (this._remainingSeconds <= 0) {
                this._remainingSeconds = SHARK_TUNING.huntSeconds;
                this._huntOpeningGraceSeconds = SHARK_TUNING.huntOpeningGraceSeconds;
                this._retargetSeconds = 0;
                this.setState(SharkState.HUNT);
            }
            return;
        }

        this._retargetSeconds -= dt;
        if (this._retargetSeconds <= 0) {
            this._retargetSeconds = SHARK_TUNING.retargetSeconds;
            this.retarget();
        }
        // Lock completion is deliberately not an instant hit. Keep the full hunt
        // duration for actual pursuit, while this short wind-up gives nearby
        // swimmers a last, playable chance to change direction.
        if (this._huntOpeningGraceSeconds > 0) {
            this._huntOpeningGraceSeconds = Math.max(0, this._huntOpeningGraceSeconds - dt);
            if (this._huntOpeningGraceSeconds <= 0) this.notifyHuntEngaged();
            return;
        }
        this._remainingSeconds = Math.max(0, this._remainingSeconds - dt);
        const target = this._target;
        if (target?.isSharkTargetable) {
            const pos = this._opts.node.position;
            const targetPos = target.node.position;
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq <= SHARK_TUNING.catchRadius * SHARK_TUNING.catchRadius) {
                this._eliminatedLane = this._opts.laneFor(target);
                this._opts.onEliminate(target);
                this.end();
                return;
            }
            const distance = Math.sqrt(distanceSq);
            if (distance > 0.0001) {
                const step = Math.min(distance, SHARK_TUNING.huntSpeed * dt);
                this.moveAndFace(dx / distance, dz / distance, step);
            }
        }
        if (this._remainingSeconds <= 0) this.end();
    }

    snapshot(): SharkRaceState {
        const pos = this._opts.node.position;
        return {
            sequence: this._sequence,
            state: this._state,
            remainingSeconds: this._remainingSeconds,
            huntOpeningGraceSeconds: this._huntOpeningGraceSeconds,
            x: pos.x,
            z: pos.z,
            ownerLane: this._ownerLane,
            targetLane: this._target ? this._opts.laneFor(this._target) : -1,
            eliminatedLane: this._eliminatedLane,
        };
    }

    applyAuthoritativeState(state: SharkRaceState): void {
        if (!state || state.sequence < this._sequence) return;
        const previousSequence = this._sequence;
        const previousState = this._state;
        this._sequence = state.sequence;
        this._state = state.state;
        this._remainingSeconds = Math.max(0, state.remainingSeconds);
        this._huntOpeningGraceSeconds = Math.max(0, state.huntOpeningGraceSeconds);
        this._ownerLane = state.ownerLane;
        this._eliminatedLane = state.eliminatedLane;
        this._target = state.targetLane >= 0 ? this._opts.swimmerForLane(state.targetLane) : null;
        const node = this._opts.node;
        if (node.active !== this.active) node.active = this.active;
        if (this.active) {
            const pos = node.position;
            node.setPosition(state.x, pos.y, state.z);
        }
        if (previousState !== this._state) this._opts.onStateChange?.(this._state);
        if (this._state === SharkState.HUNT && this._huntOpeningGraceSeconds <= 0) this.notifyHuntEngaged();
        if (state.sequence > previousSequence && state.state !== SharkState.INACTIVE) {
            this._opts.onSummoned?.(state.x, state.z);
        }
    }

    private end(): void {
        this.setState(SharkState.INACTIVE);
        this._remainingSeconds = 0;
        this._huntOpeningGraceSeconds = 0;
        this._huntEngaged = false;
        this._target = null;
        this._ownerLane = -1;
        if (this._opts.node.active) this._opts.node.active = false;
    }

    private setState(state: SharkState): void {
        if (this._state === state) return;
        this._state = state;
        if (state === SharkState.HUNT) this._huntEngaged = false;
        this._opts.onStateChange?.(state);
    }

    private notifyHuntEngaged(): void {
        if (this._huntEngaged || this._state !== SharkState.HUNT) return;
        this._huntEngaged = true;
        this._opts.onHuntEngaged?.();
    }

    private retarget(): void {
        const pos = this._opts.node.position;
        let nearest: Swimmer | null = null;
        let nearestDistanceSq = Number.POSITIVE_INFINITY;
        for (const swimmer of this._opts.swimmers()) {
            if (!swimmer.isSharkTargetable) continue;
            const targetPos = swimmer.node.position;
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq < nearestDistanceSq) {
                nearest = swimmer;
                nearestDistanceSq = distanceSq;
            }
        }
        this._target = nearest;
    }

    private placeAtSafeRandomWaterPosition(): void {
        const layout = this._opts.course;
        const minX = Math.min(layout.poolStartX, layout.poolFinishX) + 2;
        const maxX = Math.max(layout.poolStartX, layout.poolFinishX) - 2;
        const halfZ = Math.max(0, layout.poolWidth * 0.5 - 1);
        let x = (minX + maxX) * 0.5;
        let z = 0;
        let furthestX = x;
        let furthestZ = z;
        let furthestClearanceSq = -1;
        const requiredClearanceSq = SHARK_TUNING.spawnClearance * SHARK_TUNING.spawnClearance;
        // A random point is retained only when it is the safest candidate seen so
        // far. This avoids the old "last failed roll" fallback beside a swimmer.
        for (let attempt = 0; attempt < 12; attempt++) {
            const candidateX = minX + randomFloat() * (maxX - minX);
            const candidateZ = -halfZ + randomFloat() * (halfZ * 2);
            let nearestClearanceSq = Number.POSITIVE_INFINITY;
            for (const swimmer of this._opts.swimmers()) {
                if (!swimmer.isSharkTargetable) continue;
                const sp = swimmer.node.position;
                const dx = sp.x - candidateX;
                const dz = sp.z - candidateZ;
                const clearanceSq = dx * dx + dz * dz;
                if (clearanceSq < nearestClearanceSq) nearestClearanceSq = clearanceSq;
            }
            if (nearestClearanceSq > furthestClearanceSq) {
                furthestClearanceSq = nearestClearanceSq;
                furthestX = candidateX;
                furthestZ = candidateZ;
            }
            if (nearestClearanceSq >= requiredClearanceSq) {
                x = candidateX;
                z = candidateZ;
                this._opts.node.setPosition(x, layout.waterY + SHARK_TUNING.waterYOffset, z);
                return;
            }
        }
        this._opts.node.setPosition(furthestX, layout.waterY + SHARK_TUNING.waterYOffset, furthestZ);
    }

    private moveAndFace(nx: number, nz: number, distance: number): void {
        const layout = this._opts.course;
        const node = this._opts.node;
        const pos = node.position;
        const minX = Math.min(layout.poolStartX, layout.poolFinishX) + 1;
        const maxX = Math.max(layout.poolStartX, layout.poolFinishX) - 1;
        const halfZ = Math.max(0, layout.poolWidth * 0.5 - 0.5);
        node.setPosition(
            Math.max(minX, Math.min(maxX, pos.x + nx * distance)),
            pos.y,
            Math.max(-halfZ, Math.min(halfZ, pos.z + nz * distance)),
        );
        node.setRotationFromEuler(0, Math.atan2(-nz, nx), 0);
    }
}
