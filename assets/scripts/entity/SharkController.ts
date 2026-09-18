import { Node } from 'cc';
import type { Swimmer } from './Swimmer';
import { SHARK_TUNING, SharkState } from './SharkTuning';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';

const RADIANS_TO_DEGREES = 180 / Math.PI;

// Compact state carried by the host's race snapshot. Coordinates are world-space
// metres; the snapshot codec quantizes them before transport.
export type SharkRaceState = {
    sequence: number;
    state: SharkState;
    raceElapsed: number;
    remainingSeconds: number;
    huntOpeningGraceSeconds: number;
    x: number;
    z: number;
    facingX: number;
    facingZ: number;
    targetLane: number;
    knockedLane: number;
    huntIndex: number;
};

export type SharkControllerOptions = {
    node: Node;
    course: RaceCourseLayout;
    swimmers: () => readonly Swimmer[];
    laneFor: (swimmer: Swimmer) => number;
    swimmerForLane: (lane: number) => Swimmer | null;
    onKnockDown: (swimmer: Swimmer) => void;
    onRevealed?: (x: number, z: number) => void;
    onStateChange?: (state: SharkState) => void;
    // Fires exactly when the no-bite wind-up ends and true pursuit begins.
    onHuntEngaged?: () => void;
    // Fires once per locked target when the predator is close enough for the
    // local presentation to show the incoming attack before a possible bite.
    onTargetApproach?: (target: Swimmer, sharkX: number, sharkZ: number) => void;
    /** 六合一可注入单轮短赛程；独立鲨鱼模式继续使用全局三轮赛程。 */
    hungerSchedule?: readonly number[];
    /** 最后一轮结束后继续低速巡游，作为场地残留。 */
    wanderAfterFinalHunt?: boolean;
};

// A single race-owned predator. It has no per-frame allocations and intentionally
// has no knowledge of skill energy or UI. Those belong to the caller.
export class SharkController {
    private _state = SharkState.INACTIVE;
    private _raceElapsed = 0;
    private _remainingSeconds = 0;
    private _retargetSeconds = 0;
    private _huntOpeningGraceSeconds = 0;
    private _huntEngaged = false;
    private _biteDirectionX = 1;
    private _biteDirectionZ = 0;
    private _target: Swimmer | null = null;
    private _approachNotifiedTarget: Swimmer | null = null;
    private _facingX = 1;
    private _facingZ = 0;
    private _sequence = 0;
    private _knockedLane = -1;
    private _huntIndex = 0;
    private _wanderWaypoint = 0;
    private readonly _obstacleContacts = new Set<Swimmer>();

    constructor(private readonly _opts: SharkControllerOptions) {
        this._opts.node.active = false;
    }

    get active(): boolean { return this._state !== SharkState.INACTIVE; }
    get state(): SharkState { return this._state; }
    get sequence(): number { return this._sequence; }
    get raceElapsed(): number { return this._raceElapsed; }
    get remainingSeconds(): number { return this._remainingSeconds; }
    get knockedLane(): number { return this._knockedLane; }
    get huntIndex(): number { return this._huntIndex; }
    get target(): Swimmer | null { return this._target; }
    // Presentation-only consumers (such as the picture-in-picture feed) may observe
    // the host-restored node, but never mutate its movement or target state.
    get node(): Node { return this._opts.node; }

    reset(): void {
        this.setState(SharkState.INACTIVE);
        this._remainingSeconds = 0;
        this._raceElapsed = 0;
        this._retargetSeconds = 0;
        this._huntOpeningGraceSeconds = 0;
        this._huntEngaged = false;
        this._biteDirectionX = 1;
        this._biteDirectionZ = 0;
        this._target = null;
        this._approachNotifiedTarget = null;
        this._sequence = 0;
        this._knockedLane = -1;
        this._huntIndex = 0;
        this._wanderWaypoint = 0;
        this._obstacleContacts.clear();
        if (this._opts.node.active) this._opts.node.active = false;
    }

    private beginHuntBeat(): void {
        if (this._huntIndex >= this.hungerSchedule().length) return;
        this._sequence++;
        this._knockedLane = -1;
        this._target = null;
        this._approachNotifiedTarget = null;
        const firstReveal = this._state === SharkState.INACTIVE;
        if (firstReveal) {
            this.placeAtSafeWaterPosition();
            // 首次 WARNING 的状态回调会启动模型动画，必须先让层级激活，
            // 否则第一轮 play() 发生在隐藏节点上，只会看到根节点直线移动。
            if (!this._opts.node.active) this._opts.node.active = true;
        }
        this.setState(SharkState.WARNING);
        this._remainingSeconds = SHARK_TUNING.warningSeconds;
        this._retargetSeconds = 0;
        this.retarget();
        if (!this._opts.node.active) this._opts.node.active = true;
        if (firstReveal) this._opts.onRevealed?.(this._opts.node.position.x, this._opts.node.position.z);
    }

    // Run only on the authoritative host (or in single player). Clients render the
    // received state via applyAuthoritativeState instead.
    tick(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0) return;
        this._raceElapsed += dt;
        if ((this._state === SharkState.INACTIVE || this._state === SharkState.WANDER)
            && this._huntIndex < this.hungerSchedule().length
            && this._raceElapsed >= this.hungerSchedule()[this._huntIndex]) {
            this.beginHuntBeat();
        }
        if (this._state === SharkState.INACTIVE || this._state === SharkState.SATIATED) return;
        if (this._state === SharkState.WANDER) {
            this.updateWander(dt);
            return;
        }
        if (this._state === SharkState.BITE) {
            this._remainingSeconds = Math.max(0, this._remainingSeconds - dt);
            const step = Math.min(
                Math.max(0, SHARK_TUNING.biteLungeSpeed) * dt,
                Math.max(0, SHARK_TUNING.biteLungeSpeed) * this._remainingSeconds + 0.02,
            );
            if (step > 0) {
                this.moveAndFace(this._biteDirectionX, this._biteDirectionZ, step);
            }
            if (this._remainingSeconds <= 0) this.finishHunt();
            return;
        }
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
            this.notifyTargetApproach(target, pos.x, pos.z, dx * dx + dz * dz);
            const mouthX = pos.x + this._facingX * SHARK_TUNING.biteMouthForwardOffset;
            const mouthZ = pos.z + this._facingZ * SHARK_TUNING.biteMouthForwardOffset;
            const mouthDx = targetPos.x - mouthX;
            const mouthDz = targetPos.z - mouthZ;
            const mouthDistanceSq = mouthDx * mouthDx + mouthDz * mouthDz;
            if (mouthDistanceSq <= SHARK_TUNING.catchRadius * SHARK_TUNING.catchRadius) {
                this._knockedLane = this._opts.laneFor(target);
                this._biteDirectionX = this._facingX;
                this._biteDirectionZ = this._facingZ;
                this._remainingSeconds = Math.max(0.05, SHARK_TUNING.bitePresentationSeconds);
                this._huntOpeningGraceSeconds = 0;
                this.setState(SharkState.BITE);
                this._opts.onKnockDown(target);
                return;
            }
            const distance = Math.sqrt(dx * dx + dz * dz);
            if (distance > 0.0001) {
                const step = Math.min(distance, SHARK_TUNING.huntSpeed * dt);
                this.moveAndFace(dx / distance, dz / distance, step);
            }
        }
        if (this._remainingSeconds <= 0) this.finishHunt();
    }

    snapshot(): SharkRaceState {
        const pos = this._opts.node.position;
        return {
            sequence: this._sequence,
            state: this._state,
            raceElapsed: this._raceElapsed,
            remainingSeconds: this._remainingSeconds,
            huntOpeningGraceSeconds: this._huntOpeningGraceSeconds,
            x: pos.x,
            z: pos.z,
            facingX: this._facingX,
            facingZ: this._facingZ,
            targetLane: this._target ? this._opts.laneFor(this._target) : -1,
            knockedLane: this._knockedLane,
            huntIndex: this._huntIndex,
        };
    }

    applyAuthoritativeState(state: SharkRaceState): void {
        if (!state
            || state.sequence < this._sequence
            || (state.sequence === this._sequence && state.raceElapsed + 0.001 < this._raceElapsed)) return;
        const previousSequence = this._sequence;
        const previousState = this._state;
        this._sequence = state.sequence;
        this._state = state.state;
        this._raceElapsed = Math.max(0, state.raceElapsed);
        this._remainingSeconds = Math.max(0, state.remainingSeconds);
        this._huntOpeningGraceSeconds = Math.max(0, state.huntOpeningGraceSeconds);
        this._knockedLane = state.knockedLane;
        this._huntIndex = Math.max(0, Math.floor(state.huntIndex));
        this._facingX = Number.isFinite(state.facingX) ? state.facingX : this._facingX;
        this._facingZ = Number.isFinite(state.facingZ) ? state.facingZ : this._facingZ;
        this._target = state.targetLane >= 0 ? this._opts.swimmerForLane(state.targetLane) : null;
        if (state.sequence > previousSequence) this._approachNotifiedTarget = null;
        const node = this._opts.node;
        if (node.active !== this.active) node.active = this.active;
        if (this.active) {
            const pos = node.position;
            this.faceDirection(this._facingX, this._facingZ);
            node.setPosition(state.x, pos.y, state.z);
            const target = this._target;
            if (this._state === SharkState.HUNT && target?.isSharkTargetable) {
                const targetPos = target.node.position;
                const targetDx = targetPos.x - state.x;
                const targetDz = targetPos.z - state.z;
                this.notifyTargetApproach(target, state.x, state.z, targetDx * targetDx + targetDz * targetDz);
            }
        }
        if (previousState !== this._state) this._opts.onStateChange?.(this._state);
        if (this._state === SharkState.HUNT && this._huntOpeningGraceSeconds <= 0) this.notifyHuntEngaged();
        if (previousState === SharkState.INACTIVE && state.state !== SharkState.INACTIVE) {
            this._opts.onRevealed?.(state.x, state.z);
        }
    }

    resolveObstacleCollisions(swimmers: readonly Swimmer[]): void {
        if (this._state !== SharkState.WANDER && this._state !== SharkState.WARNING) {
            this._obstacleContacts.clear();
            return;
        }
        const shark = this._opts.node.position;
        const minDistance = SHARK_TUNING.collisionRadius + 0.9;
        const minDistanceSq = minDistance * minDistance;
        for (const swimmer of swimmers) {
            if (!swimmer?.isCollisionActive) {
                this._obstacleContacts.delete(swimmer);
                continue;
            }
            const p = swimmer.node.position;
            const dx = p.x - shark.x;
            const dz = p.z - shark.z;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq >= minDistanceSq) {
                this._obstacleContacts.delete(swimmer);
                continue;
            }
            const distance = Math.sqrt(Math.max(distanceSq, 0.0001));
            const nx = distanceSq > 0.0001 ? dx / distance : 0;
            const nz = distanceSq > 0.0001 ? dz / distance : 1;
            const overlap = minDistance - distance;
            swimmer.applyCollisionPush(nx * overlap, nz * overlap);
            if (!this._obstacleContacts.has(swimmer)) {
                const strength = SHARK_TUNING.collisionPushScale;
                swimmer.applyCollisionImpulse(-Math.abs(nx) * strength, nz * strength);
                swimmer.applyCollisionAxialImpulse(nz * strength * 2.4);
                this._obstacleContacts.add(swimmer);
            }
        }
    }

    private finishHunt(): void {
        this._huntIndex++;
        this._remainingSeconds = 0;
        this._huntOpeningGraceSeconds = 0;
        this._huntEngaged = false;
        this._target = null;
        this._approachNotifiedTarget = null;
        if (this._huntIndex >= this.hungerSchedule().length) {
            if (this._opts.wanderAfterFinalHunt) {
                this.selectNearestWanderWaypoint();
                this.setState(SharkState.WANDER);
            } else {
                this.setState(SharkState.SATIATED);
            }
        } else {
            this.selectNearestWanderWaypoint();
            this.setState(SharkState.WANDER);
        }
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
        if (this._target !== nearest) this._approachNotifiedTarget = null;
        this._target = nearest;
        if (nearest) {
            const targetPos = nearest.node.position;
            this.faceDirection(targetPos.x - pos.x, targetPos.z - pos.z);
        }
    }

    private placeAtSafeWaterPosition(): void {
        const layout = this._opts.course;
        const minX = Math.min(layout.poolStartX, layout.poolFinishX) + 2;
        const maxX = Math.max(layout.poolStartX, layout.poolFinishX) - 2;
        const halfZ = Math.max(0, layout.poolWidth * 0.5 - 1);
        let furthestX = (minX + maxX) * 0.5;
        let furthestZ = 0;
        let furthestClearanceSq = -1;
        // 固定候选点避免结果随机，同时选择离所有选手最远的安全位置。
        for (let attempt = 0; attempt < 12; attempt++) {
            const column = attempt % 4;
            const row = Math.floor(attempt / 4);
            const candidateX = minX + (column + 0.5) / 4 * (maxX - minX);
            const candidateZ = -halfZ + (row + 0.5) / 3 * (halfZ * 2);
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
        }
        this._opts.node.setPosition(furthestX, layout.waterY + SHARK_TUNING.waterYOffset, furthestZ);
        this.selectNearestWanderWaypoint();
    }

    private hungerSchedule(): readonly number[] {
        return this._opts.hungerSchedule ?? SHARK_TUNING.hungerSchedule;
    }

    private updateWander(dt: number): void {
        const layout = this._opts.course;
        const minX = Math.min(layout.poolStartX, layout.poolFinishX) + 2.5;
        const maxX = Math.max(layout.poolStartX, layout.poolFinishX) - 2.5;
        const halfZ = Math.max(0, layout.poolWidth * 0.5 - 1.5);
        const targetX = this._wanderWaypoint === 0 || this._wanderWaypoint === 3 ? minX : maxX;
        const targetZ = this._wanderWaypoint < 2 ? -halfZ : halfZ;
        const pos = this._opts.node.position;
        const dx = targetX - pos.x;
        const dz = targetZ - pos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance <= 0.08) {
            this._wanderWaypoint = (this._wanderWaypoint + 1) % 4;
            return;
        }
        this.moveAndFace(dx / distance, dz / distance, Math.min(distance, SHARK_TUNING.wanderSpeed * dt));
    }

    private selectNearestWanderWaypoint(): void {
        const layout = this._opts.course;
        const minX = Math.min(layout.poolStartX, layout.poolFinishX) + 2.5;
        const maxX = Math.max(layout.poolStartX, layout.poolFinishX) - 2.5;
        const halfZ = Math.max(0, layout.poolWidth * 0.5 - 1.5);
        const pos = this._opts.node.position;
        let best = 0;
        let bestDistanceSq = Number.POSITIVE_INFINITY;
        for (let index = 0; index < 4; index++) {
            const x = index === 0 || index === 3 ? minX : maxX;
            const z = index < 2 ? -halfZ : halfZ;
            const dx = x - pos.x;
            const dz = z - pos.z;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq < bestDistanceSq) {
                best = index;
                bestDistanceSq = distanceSq;
            }
        }
        this._wanderWaypoint = best;
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
        this.faceDirection(nx, nz);
    }

    private faceDirection(dx: number, dz: number): void {
        const lengthSq = dx * dx + dz * dz;
        if (lengthSq <= 0.0001) return;
        const inverseLength = 1 / Math.sqrt(lengthSq);
        this._facingX = dx * inverseLength;
        this._facingZ = dz * inverseLength;
        this._opts.node.setRotationFromEuler(0, Math.atan2(-dz, dx) * RADIANS_TO_DEGREES, 0);
    }

    private notifyTargetApproach(target: Swimmer, sharkX: number, sharkZ: number, distanceSq: number): void {
        if (this._approachNotifiedTarget === target
            || distanceSq > SHARK_TUNING.approachCameraDistance * SHARK_TUNING.approachCameraDistance) {
            return;
        }
        this._approachNotifiedTarget = target;
        this._opts.onTargetApproach?.(target, sharkX, sharkZ);
    }
}
