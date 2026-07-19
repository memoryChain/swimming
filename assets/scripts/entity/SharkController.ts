// Shark AI state machine, schedule-driven:
//   wander --(schedule tick)--> warning --> hunt --> (wander | satiated)
// The controller owns the shark node position and drives all state transitions.
// Hunger is triggered by a FIXED race-time schedule (SHARK_TUNING.hungerSchedule)
// so the three dramatic beats land at predictable times; between beats the shark
// wanders as a moving obstacle. It does NOT own collision resolution (that lives
// in SwimmerCollisionResolver); it only exposes state + position for queries.
//
// Design doc: docs/shark-and-stamina-design.zh.md

import { Node, Vec3, tween, Tween } from 'cc';
import { SHARK_TUNING, SharkState } from './SharkTuning';
import type { Swimmer } from './Swimmer';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';

export type SharkControllerOptions = {
    getNode: () => Node | null;
    getSwimmers: () => readonly Swimmer[];
    getCourseLayout: () => RaceCourseLayout;
    onEliminate: (swimmer: Swimmer) => void;
    onSatiated: () => void;
    // Fired when a hunger beat begins. huntIndex is 0-based (0 = first/reveal).
    onWarning?: (huntIndex: number) => void;
    // Fired on every state transition (WANDER/WARNING/HUNT/SATIATED) so visuals
    // (eye color, body tint) can react.
    onStateChange?: (state: SharkState) => void;
    // Fired the first time the shark reveals (huntIndex 0). The shark stays
    // paused (isEntering) until finishReveal() is called, so the drop-in
    // animation can complete before wandering/hunting begins.
    onReveal?: () => void;
};

export class SharkController {
    private _state: SharkState = SharkState.WANDER;
    private _stateTimer = 0;
    private _wanderTimer = 0;
    // Loop-path patrol: the shark swims around the pool's inner rectangle. The
    // path is the 4 inner corners (CW); _wanderPathT is the loop parameter in
    // [0,1) over the total perimeter. Stored as flat arrays to stay alloc-free.
    private _wanderPathT = 0;
    private _wanderPathLength = 0;
    private readonly _pathX: number[] = [];
    private readonly _pathZ: number[] = [];
    private _pathBuilt = false;
    private _target: Swimmer | null = null;
    private _eliminationCount = 0;
    private _retargetTimer = 0;
    // Visual heading (radians). Eased toward the movement direction so the body
    // turns to face where it swims; a tail-sway oscillation is layered on top.
    private _headingTarget = 0;
    private _heading = 0;
    private _swayPhase = 0;
    // Race-time clock; only advances while update() is called (RACING only).
    private _raceElapsed = 0;
    // Index of the next schedule beat to fire.
    private _huntIndex = 0;
    private _sinkTween: Tween<Node> | null = null;
    // True while the drop-in reveal animation is playing; update() is skipped so
    // the shark does not wander/hunt until it has landed.
    private _isEntering = false;

    constructor(private readonly _opts: SharkControllerOptions) {}

    get state(): SharkState { return this._state; }
    get eliminationCount(): number { return this._eliminationCount; }
    get target(): Swimmer | null { return this._target; }
    get huntIndex(): number { return this._huntIndex; }

    // Expose the shark node position for collision resolution.
    getSharkPosition(out: Vec3): Vec3 {
        const node = this._opts.getNode();
        if (node) {
            Vec3.copy(out, node.position);
        }
        return out;
    }

    reset() {
        this._state = SharkState.WANDER;
        this._stateTimer = 0;
        this._wanderTimer = 0;
        this._wanderPathT = Math.random();
        this._pathBuilt = false;
        this._target = null;
        this._eliminationCount = 0;
        this._retargetTimer = 0;
        this._headingTarget = 0;
        this._heading = 0;
        this._swayPhase = 0;
        this._raceElapsed = 0;
        this._huntIndex = 0;
        if (this._sinkTween) {
            this._sinkTween.stop();
            this._sinkTween = null;
        }
        // Place the shark at a random position in the pool at race start.
        this._isEntering = false;
        const node = this._opts.getNode();
        if (node) {
            // Hidden + inert until the first hunger beat reveals it (fake-safety
            // intro): the opening "safe waters" banner is truthful.
            node.active = false;
        }
        this._opts.onStateChange?.(this._state);
    }

    update(dt: number) {
        if (this._isEntering) {
            return;
        }
        this._raceElapsed += dt;
        this._swayPhase += dt * SHARK_TUNING.swayFrequencyHz * Math.PI * 2;
        switch (this._state) {
            case SharkState.WANDER:
                this.updateWander(dt);
                break;
            case SharkState.WARNING:
                this.updateWarning(dt);
                break;
            case SharkState.HUNT:
                this.updateHunt(dt);
                break;
            // SATIATED: no updates needed, shark stays still.
        }
    }

    // --- WANDER ---

    private updateWander(dt: number) {
        this._stateTimer += dt;
        this._wanderTimer += dt;

        this.ensurePath();
        // Advance the loop parameter by (speed * dt) / perimeter so the shark
        // moves at a constant linear speed around the pool's inner rectangle.
        if (this._wanderPathLength > 0) {
            this._wanderPathT += (SHARK_TUNING.wanderSpeed * dt) / this._wanderPathLength;
            if (this._wanderPathT >= 1) {
                this._wanderPathT -= Math.floor(this._wanderPathT);
            }
        }
        const dir = this.applyPathPosition(this._wanderPathT);
        // Face the path tangent so the shark visibly swims along its patrol.
        if (dir) {
            this.faceDirection(dir.x, dir.z, dt, SHARK_TUNING.wanderSpeed, true);
        }

        // Fixed-schedule hunger: trigger the next beat at its scheduled race time.
        if (this._huntIndex < SHARK_TUNING.hungerSchedule.length
            && this._raceElapsed >= SHARK_TUNING.hungerSchedule[this._huntIndex]) {
            this.enterWarning();
        }
    }

    // --- WARNING ---

    private enterWarning() {
        this.setState(SharkState.WARNING);
        this._stateTimer = 0;
        this._target = this.findNearestSwimmer();
        this._opts.onWarning?.(this._huntIndex);
        // First beat = the reveal: drop the shark in and pause the state machine
        // until finishReveal() is called by the drop-in animation completion.
        if (this._huntIndex === 0) {
            this._isEntering = true;
            this._opts.onReveal?.();
        }
    }

    // Called by the owner when the drop-in reveal animation finishes; unpauses
    // the state machine so wandering/hunting can begin.
    finishReveal() {
        this._isEntering = false;
    }

    private updateWarning(dt: number) {
        this._stateTimer += dt;
        // Continuously update target (nearest swimmer may change).
        this._target = this.findNearestSwimmer();

        if (this._stateTimer >= SHARK_TUNING.warningDuration) {
            this.enterHunt();
        }
    }

    // --- HUNT ---

    private enterHunt() {
        this.setState(SharkState.HUNT);
        this._stateTimer = 0;
        this._retargetTimer = 0;
    }

    private updateHunt(dt: number) {
        this._stateTimer += dt;
        this._retargetTimer += dt;

        // Retarget every huntRetargetInterval seconds.
        if (this._retargetTimer >= SHARK_TUNING.huntRetargetInterval) {
            this._retargetTimer = 0;
            this._target = this.findNearestSwimmer();
        }

        if (this._target) {
            const node = this._opts.getNode();
            if (node) {
                const sharkPos = node.position;
                const targetPos = this._target.node.position;
                const dx = targetPos.x - sharkPos.x;
                const dz = targetPos.z - sharkPos.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist < SHARK_TUNING.collisionRadius + 0.9) {
                    // Caught the target.
                    this.eliminateCurrentTarget();
                    return;
                }

                if (dist > 0.001) {
                    this.moveShark(dx / dist, dz / dist, SHARK_TUNING.huntSpeed * dt);
                }
            }
        }

        if (this._stateTimer >= SHARK_TUNING.huntTimeout) {
            // Gave up: return to wander without eliminating anyone.
            this.endHunt();
        }
    }

    private eliminateCurrentTarget() {
        if (this._target) {
            this._opts.onEliminate(this._target);
            this._target = null;
        }
        this._eliminationCount++;
        this.endHunt();
    }

    // Resolve a hunt: advance the schedule index and either retire (satiated) or
    // return to wandering. Satiated when the shark has eaten its fill OR the
    // schedule is exhausted (the three beats are done, endgame is shark-free).
    private endHunt() {
        this._huntIndex++;
        if (this._eliminationCount >= SHARK_TUNING.maxEliminations
            || this._huntIndex >= SHARK_TUNING.hungerSchedule.length) {
            this.enterSatiated();
        } else {
            this.enterWander();
        }
    }

    // --- SATIATED ---

    private enterSatiated() {
        this.setState(SharkState.SATIATED);
        this._target = null;

        // Sink the shark node below the surface.
        const node = this._opts.getNode();
        if (node) {
            const layout = this._opts.getCourseLayout();
            this._sinkTween = tween(node)
                .to(0.8, { position: new Vec3(node.position.x, layout.waterY + SHARK_TUNING.satiatedSinkOffset, node.position.z) })
                .start();
        }

        this._opts.onSatiated();
    }

    // --- WANDER (re-entry) ---

    private enterWander() {
        this.setState(SharkState.WANDER);
        this._stateTimer = 0;
        this._wanderTimer = 0;
        // Continue the patrol from the current loop position (no snap).
    }

    // --- Helpers ---

    private setState(state: SharkState) {
        if (this._state === state) {
            return;
        }
        this._state = state;
        this._opts.onStateChange?.(state);
    }

    private findNearestSwimmer(): Swimmer | null {
        const node = this._opts.getNode();
        if (!node) return null;

        const sharkPos = node.position;
        let nearest: Swimmer | null = null;
        let nearestDistSq = Infinity;

        for (const swimmer of this._opts.getSwimmers()) {
            if (!swimmer.isSharkTargetable) continue;
            const sp = swimmer.node.position;
            const dx = sp.x - sharkPos.x;
            const dz = sp.z - sharkPos.z;
            const distSq = dx * dx + dz * dz;
            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = swimmer;
            }
        }
        return nearest;
    }

    // Build the inner-rectangle patrol path from the pool bounds once (lazily,
    // since the layout may be calibrated after construction).
    private ensurePath() {
        if (this._pathBuilt) {
            return;
        }
        const layout = this._opts.getCourseLayout();
        const minX = Math.min(layout.poolStartX, layout.poolFinishX) + 2.5;
        const maxX = Math.max(layout.poolStartX, layout.poolFinishX) - 2.5;
        const halfZ = layout.poolWidth * 0.5 - 1.5;
        // Clockwise corners.
        this._pathX.length = 0;
        this._pathZ.length = 0;
        this._pathX.push(minX, maxX, maxX, minX);
        this._pathZ.push(-halfZ, -halfZ, halfZ, halfZ);
        // Perimeter of the rectangle.
        this._wanderPathLength = 2 * ((maxX - minX) + (2 * halfZ));
        this._pathBuilt = true;
    }

    // Place the shark at loop parameter t on the path; return the unit tangent
    // (direction of travel) so the caller can face it.
    private applyPathPosition(t: number): { x: number; z: number } | null {
        const node = this._opts.getNode();
        if (!node || this._pathX.length < 4 || this._wanderPathLength <= 0) {
            return null;
        }
        const layout = this._opts.getCourseLayout();
        const dist = t * this._wanderPathLength;
        // Walk the 4 edges to find the segment containing dist.
        let acc = 0;
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            const ex = this._pathX[j] - this._pathX[i];
            const ez = this._pathZ[j] - this._pathZ[i];
            const segLen = Math.sqrt(ex * ex + ez * ez);
            if (acc + segLen >= dist || i === 3) {
                const local = segLen > 0 ? (dist - acc) / segLen : 0;
                const px = this._pathX[i] + ex * local;
                const pz = this._pathZ[i] + ez * local;
                node.setPosition(px, layout.waterY - 0.3, pz);
                const len = segLen > 0 ? segLen : 1;
                return { x: ex / len, z: ez / len };
            }
            acc += segLen;
        }
        return null;
    }

    // Ease the visual heading toward a movement direction; layers a tail-sway
    // oscillation during wander so the body looks alive. Extracted so both the
    // patrol (wander) and chase (hunt) share the same facing logic.
    private faceDirection(dirX: number, dirZ: number, dt: number, speed: number, sway: boolean) {
        const node = this._opts.getNode();
        if (!node) {
            return;
        }
        const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (len > 1e-4) {
            this._headingTarget = Math.atan2(-dirZ, dirX);
        }
        const ease = Math.min(1, SHARK_TUNING.headingEaseRate * dt);
        this._heading += (this._headingTarget - this._heading) * ease;
        let yaw = this._heading;
        if (sway) {
            yaw += Math.sin(this._swayPhase) * SHARK_TUNING.swayAmplitudeDeg * Math.PI / 180;
        }
        node.setRotationFromEuler(0, yaw, 0);
    }

    private moveShark(dirX: number, dirZ: number, distance: number) {
        const node = this._opts.getNode();
        if (!node) return;

        const layout = this._opts.getCourseLayout();
        const pos = node.position;
        const newX = pos.x + dirX * distance;
        const newZ = pos.z + dirZ * distance;

        const minX = Math.min(layout.poolStartX, layout.poolFinishX) + 2;
        const maxX = Math.max(layout.poolStartX, layout.poolFinishX) - 2;
        const halfZ = layout.poolWidth * 0.5 - 1;

        node.setPosition(
            Math.max(minX, Math.min(maxX, newX)),
            pos.y,
            Math.max(-halfZ, Math.min(halfZ, newZ)),
        );

        // Face the chase direction (focused, no tail-sway during hunt).
        const huntDt = distance / Math.max(0.001, SHARK_TUNING.huntSpeed);
        this.faceDirection(dirX, dirZ, huntDt, SHARK_TUNING.huntSpeed, false);
    }
}
