import type { Swimmer } from './Swimmer';
import { SHARK_TUNING, SharkState } from './SharkTuning';

// Swimmer-vs-swimmer collision. The race only ever has up to 8 swimmers moving
// kinematically (position is driven by SwimPhysicsModel, not a physics engine),
// so a full 3D physics engine (Ammo/Box2D) would be overkill and add WASM weight
// to the WeChat mini-game package. Instead we treat each swimmer as a solid disc
// on the XZ plane (top-down circle) and fully resolve every overlap each frame.
//
// Bodies are IMPASSABLE and everyone blocks everyone: to overtake, a swimmer
// must go around sideways. Resolution runs on both axes:
//   - Z (lateral) -> the motor lateral offset (clamped to the pool walls).
//   - X (swim axis) -> race distance. X is derived from distance, so nudging
//     distance is the only forward push that survives the next frame; this is
//     what makes a leading body physically block a trailing one (the trailing
//     swimmer's distance can't advance through the leader).
// Because pushing X changes race distance, a block genuinely costs the blocked
// swimmer progress — that is the intended "hold your line" racing feel.
export const SWIMMER_COLLISION = {
    // Master switch so the behaviour can be A/B compared.
    enabled: true as boolean,
    // Per-swimmer disc radius on the XZ plane (metres). Lane centres are 2.625m
    // apart, so radius*2 (=1.8m at 0.9) is the centre spacing at which two
    // swimmers touch. Raise for chunkier bodies, lower for slimmer ones.
    radius: 0.9,
    // Relaxation passes per frame. One pass fully separates each overlapping
    // pair, but separating one pair can push a swimmer into a third; a few
    // Gauss-Seidel passes let chains of 3+ stacked swimmers settle with no
    // residual overlap. 8 swimmers -> a handful of passes is plenty.
    separationIterations: 4,
    // AI-vs-AI pairs only separate SIDEWAYS (lateral / Z), never along the swim
    // axis (X / distance). Background swimmers are "acting" — they should spread
    // out so they never clump into a blob, but they must never block each other's
    // forward progress or pile up behind a slow lane. Any pair involving the
    // PLAYER still resolves fully on both axes (the impassable "hold your line"
    // racing feel that actually matters to the player).
    aiVsAiLateralOnly: true as boolean,
};

// Reused module-scope buffers keep this allocation-free each frame.
const _active: Swimmer[] = [];
const _isAi: boolean[] = [];
const _origX: number[] = [];
const _origZ: number[] = [];
const _posX: number[] = [];
const _posZ: number[] = [];
const _hit: boolean[] = [];

// Fully separate overlapping swimmers so no two bodies interpenetrate. Call once
// per frame after the swimmers have updated their own positions.
export function resolveSwimmerCollisions(swimmers: readonly Swimmer[]): void {
    if (!SWIMMER_COLLISION.enabled) {
        return;
    }

    _active.length = 0;
    for (const swimmer of swimmers) {
        if (swimmer && swimmer.isCollisionActive) {
            _active.push(swimmer);
        }
    }

    const count = _active.length;
    if (count < 2) {
        return;
    }

    for (let i = 0; i < count; i++) {
        const pos = _active[i].node.position;
        _origX[i] = _posX[i] = pos.x;
        _origZ[i] = _posZ[i] = pos.z;
        _isAi[i] = _active[i].isAI;
        _hit[i] = false;
    }

    const minDist = SWIMMER_COLLISION.radius * 2;
    const minDistSq = minDist * minDist;

    // Iteratively push overlapping pairs fully apart along the XZ centre line.
    // Working on the local position buffers (not the nodes) lets later passes
    // see the updated positions so multi-body stacks converge to zero overlap.
    for (let iter = 0; iter < SWIMMER_COLLISION.separationIterations; iter++) {
        let anyOverlap = false;
        for (let i = 0; i < count; i++) {
            for (let j = i + 1; j < count; j++) {
                const dx = _posX[i] - _posX[j];
                const dz = _posZ[i] - _posZ[j];
                const distSq = dx * dx + dz * dz;
                if (distSq >= minDistSq) {
                    continue;
                }
                // Two AI bodies never block each other on the swim axis: they
                // only get nudged sideways so the pack spreads out instead of
                // piling up. Player pairs resolve on both axes.
                const lateralOnly = SWIMMER_COLLISION.aiVsAiLateralOnly && _isAi[i] && _isAi[j];
                anyOverlap = true;
                _hit[i] = true;
                _hit[j] = true;

                let nx: number;
                let nz: number;
                let dist: number;
                if (distSq < 1e-8) {
                    // Centres coincide: separate sideways in a stable direction.
                    nx = 0;
                    nz = 1;
                    dist = 0;
                } else {
                    dist = Math.sqrt(distSq);
                    nx = dx / dist;
                    nz = dz / dist;
                }
                const half = (minDist - dist) * 0.5;
                if (!lateralOnly) {
                    _posX[i] += nx * half;
                    _posX[j] -= nx * half;
                }
                _posZ[i] += nz * half;
                _posZ[j] -= nz * half;
            }
        }
        if (!anyOverlap) {
            break;
        }
    }

    // Apply the net displacement of each swimmer once (X -> distance, Z -> lateral
    // offset) and flash any swimmer that took part in a collision this frame.
    for (let i = 0; i < count; i++) {
        const dX = _posX[i] - _origX[i];
        const dZ = _posZ[i] - _origZ[i];
        if (dX !== 0 || dZ !== 0) {
            _active[i].applyCollisionPush(dX, dZ);
        }
        if (_hit[i]) {
            _active[i].flashCollision();
        }
    }
}
// Shark-vs-swimmer collision. The shark is impassable and heavier than a
// swimmer: it shoves swimmers away (single-sided, the shark does not move).
// Only active during WANDER and WARNING states. During HUNT the shark
// eliminates on contact (handled by SharkController), and during SATIATED the
// shark is sunk and inert.
export function resolveSharkCollisions(
    sharkState: SharkState,
    sharkPosX: number,
    sharkPosZ: number,
    swimmers: readonly Swimmer[],
): void {
    if (sharkState === SharkState.SATIATED || sharkState === SharkState.HUNT) {
        return;
    }

    const sharkRadius = SHARK_TUNING.collisionRadius;
    const swimmerRadius = SWIMMER_COLLISION.radius;
    const minDist = sharkRadius + swimmerRadius;
    const minDistSq = minDist * minDist;
    const pushScale = SHARK_TUNING.collisionPushScale;

    for (const swimmer of swimmers) {
        if (!swimmer.isCollisionActive) continue;

        const sp = swimmer.node.position;
        const dx = sp.x - sharkPosX;
        const dz = sp.z - sharkPosZ;
        const distSq = dx * dx + dz * dz;

        if (distSq >= minDistSq) continue;

        let nx: number;
        let nz: number;
        let dist: number;
        if (distSq < 1e-8) {
            nx = 0;
            nz = 1;
            dist = 0;
        } else {
            dist = Math.sqrt(distSq);
            nx = dx / dist;
            nz = dz / dist;
        }

        // Single-sided push: only the swimmer moves. Push scale > 1 makes the
        // shark shove harder than a swimmer-vs-swimmer collision.
        const pushDist = (minDist - dist) * pushScale;
        swimmer.applyCollisionPush(nx * pushDist, nz * pushDist);
        swimmer.flashCollision();
    }
}