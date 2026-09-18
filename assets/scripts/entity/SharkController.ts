import { Material, MeshRenderer, Node, Vec3, Vec4, utils } from 'cc';
import type { Swimmer } from './Swimmer';
import { SHARK_TUNING, SharkState } from './SharkTuning';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

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
        if (this._huntIndex >= SHARK_TUNING.hungerSchedule.length) return;
        this._sequence++;
        this._knockedLane = -1;
        this._target = null;
        this._approachNotifiedTarget = null;
        const firstReveal = this._state === SharkState.INACTIVE;
        if (firstReveal) this.placeAtSafeWaterPosition();
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
            && this._huntIndex < SHARK_TUNING.hungerSchedule.length
            && this._raceElapsed >= SHARK_TUNING.hungerSchedule[this._huntIndex]) {
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
        if (this._huntIndex >= SHARK_TUNING.hungerSchedule.length) {
            this.setState(SharkState.SATIATED);
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

const IMPACT_UPDATE_INTERVAL_SECONDS = 1 / 30;
const PRIMARY_IMPACT_DURATION_SECONDS = 1.55;
const SECONDARY_IMPACT_DELAY_SECONDS = 0.16;
const SECONDARY_IMPACT_DURATION_SECONDS = 1.38;

type SharkImpactRing = {
    node: Node;
    material: Material;
    splashParams: Vec4;
    shapeParams: Vec4;
    delay: number;
    duration: number;
    startScale: number;
    endScale: number;
};

// Reuses the swimmer's authored foam/ripple material and elliptical mesh language.
// The supplied overlay layer keeps this presentation visible in both the main swim
// pass and the shark picture-in-picture pass without rendering the water surface twice.
export class SharkBiteWaterImpact {
    private readonly _root: Node;
    private readonly _rings: SharkImpactRing[] = [];
    private readonly _pendingPosition = new Vec3();
    private _pendingStrength = 0;
    private _elapsed = 0;
    private _sampleElapsed = 0;
    private _active = false;
    private _ready = false;

    constructor(parent: Node, layer: number, waterY: number) {
        this._root = new Node('SharkBiteWaterImpact');
        this._root.layer = layer;
        this._root.setParent(parent);
        this._root.setPosition(0, waterY + 0.018, 0);
        this._root.active = false;
        loadRaceAsset(RESOURCE_PATHS.swimmerSplashMaterial, Material, (error, sourceMaterial) => {
            if (error || !sourceMaterial || !this._root.isValid) {
                return;
            }
            this.createRing(sourceMaterial, layer, 0, PRIMARY_IMPACT_DURATION_SECONDS, 0.52, 4.3);
            this.createRing(sourceMaterial, layer, SECONDARY_IMPACT_DELAY_SECONDS, SECONDARY_IMPACT_DURATION_SECONDS, 0.38, 3.65);
            this._ready = true;
            if (this._pendingStrength > 0) {
                this.start(this._pendingPosition.x, this._pendingPosition.z, this._pendingStrength);
                this._pendingStrength = 0;
            }
        });
    }

    trigger(x: number, z: number, strength = 1): void {
        const safeStrength = Math.max(0.5, strength);
        if (!this._ready) {
            this._pendingPosition.set(x, 0, z);
            this._pendingStrength = safeStrength;
            return;
        }
        this.start(x, z, safeStrength);
    }

    update(dt: number): void {
        if (!this._active) {
            return;
        }
        const safeDt = Math.max(0, dt);
        this._elapsed += safeDt;
        this._sampleElapsed += safeDt;
        if (this._sampleElapsed < IMPACT_UPDATE_INTERVAL_SECONDS) {
            return;
        }
        this._sampleElapsed %= IMPACT_UPDATE_INTERVAL_SECONDS;

        let anyVisible = false;
        for (const ring of this._rings) {
            const localTime = this._elapsed - ring.delay;
            const visible = localTime >= 0 && localTime < ring.duration;
            if (ring.node.active !== visible) {
                ring.node.active = visible;
            }
            if (!visible) {
                continue;
            }
            anyVisible = true;
            const progress = Math.max(0, Math.min(1, localTime / ring.duration));
            const eased = 1 - (1 - progress) * (1 - progress);
            const scale = ring.startScale + (ring.endScale - ring.startScale) * eased;
            ring.node.setScale(scale, 1, scale);
            ring.shapeParams.w = progress;
            ring.splashParams.x = 1.35 - progress * 0.42;
            ring.splashParams.z = 1.7 - progress * 0.72;
            ring.material.setProperty('shapeParams', ring.shapeParams);
            ring.material.setProperty('splashParams', ring.splashParams);
        }
        if (!anyVisible) {
            this._active = false;
            if (this._root.active) {
                this._root.active = false;
            }
        }
    }

    dispose(): void {
        if (this._root.isValid) {
            this._root.destroy();
        }
        this._rings.length = 0;
        this._active = false;
    }

    private start(x: number, z: number, strength: number): void {
        this._elapsed = 0;
        this._sampleElapsed = IMPACT_UPDATE_INTERVAL_SECONDS;
        this._active = true;
        this._root.setPosition(x, this._root.position.y, z);
        if (!this._root.active) {
            this._root.active = true;
        }
        for (const ring of this._rings) {
            ring.node.active = false;
            ring.endScale = (ring.delay > 0 ? 3.65 : 4.3) * strength;
        }
        this.update(0);
    }

    private createRing(
        sourceMaterial: Material,
        layer: number,
        delay: number,
        duration: number,
        startScale: number,
        endScale: number,
    ): void {
        const node = new Node(delay > 0 ? 'SecondaryImpactRipple' : 'PrimaryImpactRipple');
        node.layer = layer;
        node.setParent(this._root);
        node.active = false;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = utils.createMesh(createEllipticalImpactGeometry(1.6, 1.26));
        const material = new Material();
        material.copy(sourceMaterial);
        material.name = node.name;
        const splashParams = new Vec4(1.35, 0.7, 1.7, delay * 17.3);
        const shapeParams = new Vec4(0.68, 1.22, 1, 0);
        material.setProperty('splashParams', splashParams);
        material.setProperty('shapeParams', shapeParams);
        renderer.setMaterial(material, 0);
        this._rings.push({ node, material, splashParams, shapeParams, delay, duration, startScale, endScale });
    }
}

function createEllipticalImpactGeometry(width: number, length: number) {
    const segments = 12;
    const positions = [0, 0, 0];
    const normals = [0, 1, 0];
    const uvs = [0.5, 0.5];
    const indices: number[] = [];
    const radiusX = width * 0.5;
    const radiusZ = length * 0.5;
    for (let index = 0; index < segments; index++) {
        const angle = index / segments * Math.PI * 2;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        positions.push(cosine * radiusX, 0, sine * radiusZ);
        normals.push(0, 1, 0);
        uvs.push(0.5 + cosine * 0.5, 0.5 + sine * 0.5);
    }
    for (let index = 0; index < segments; index++) {
        indices.push(0, index + 1, (index + 1) % segments + 1);
    }
    return { positions, normals, uvs, indices };
}
