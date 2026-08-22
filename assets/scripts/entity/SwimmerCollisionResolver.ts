import type { Swimmer } from './Swimmer';

const DEG2RAD = Math.PI / 180;

// Swimmer-vs-swimmer collision. The race only ever has up to 8 swimmers moving
// kinematically (position is driven by SwimPhysicsModel, not a physics engine),
// so a full 3D physics engine (Ammo/Box2D) would be overkill and add WASM weight
// to the WeChat mini-game package. Instead we treat each swimmer as a solid disc
// on the XZ plane (top-down circle) and fully resolve every overlap each collision step.
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
    // Relaxation passes per collision step. One pass fully separates each overlapping
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
    // --- Decaying knockback impulse (layered on top of the separation above) ---
    // Master switch for the knockback slide. The instantaneous separation always
    // runs; this only gates the extra decaying impulse.
    knockbackEnabled: true as boolean,
    // Impulse (m/s) added per metre of overlap depth. Deeper overlaps hit harder.
    knockbackDepthFactor: 6.0,
    // Impulse (m/s) added per m/s of closing speed along the collision normal.
    // Head-on pairs close fast and hit much harder than same-direction brushes.
    knockbackSpeedFactor: 0.8,
    // Hard cap on a single swimmer's knockback velocity (m/s); also caps the
    // accumulated buffer so a multi-body pile-up can't explode the slide.
    knockbackMaxImpulse: 4.0,
    // Exponential decay time constant (seconds). Higher = longer slide.
    knockbackDecaySeconds: 0.5,
    // A side contact also injects angular velocity around each swimmer's own
    // head-to-feet axis. It is contact-begin only, just like linear knockback.
    axialRollEnabled: 1,
    // Degrees/second of roll velocity per 1m/s of the weight-split collision
    // impulse. The contact normal supplies the side and race direction converts
    // the world-space shove into each swimmer's local long-axis convention.
    axialRollDegreesPerImpulse: 65,
};

// Reused module-scope buffers keep this allocation-free each collision step.
const MAX_SWIMMERS = 8;
const CONTACT_RELEASE_MARGIN = 0.08;
const _active: Swimmer[] = [];
const _isAi: boolean[] = [];
const _origX: number[] = [];
const _origZ: number[] = [];
const _posX: number[] = [];
const _posZ: number[] = [];
const _weight: number[] = [];
const _velX: number[] = [];
const _velZ: number[] = [];
const _dir: number[] = [];
const _impDist: number[] = [];
const _impLat: number[] = [];
const _impRoll: number[] = [];
const _newContact: boolean[] = [];
const _contactA: Swimmer[] = [];
const _contactB: Swimmer[] = [];
const _contactSeen: boolean[] = [];

// Fully separate overlapping swimmers so no two bodies interpenetrate. Call once
// per collision step after the swimmers have updated their own positions.
//
// Body weight splits every separation/knockback by inverse weight (heavy bodies resist
// being shoved). In a networked race this stays consistent because every swimmer's
// weight is agreed across clients: AI weight comes from the shared roster, and each
// human's weight rides the 养成 profile synced in the net roster (see RaceModifiers /
// NetRaceModifierCodec). Residual cross-engine float divergence is absorbed by the
// owner/host position authority, so the weighted knockback never drifts permanently.
export function resolveSwimmerCollisions(swimmers: readonly Swimmer[]): void {
    if (!SWIMMER_COLLISION.enabled) {
        clearContacts();
        return;
    }

    _active.length = 0;
    for (const swimmer of swimmers) {
        if (swimmer && swimmer.isCollisionActive) {
            _active.push(swimmer);
        }
    }

    const count = _active.length;

    for (let i = 0; i < count; i++) {
        const s = _active[i];
        const pos = s.node.position;
        _origX[i] = _posX[i] = pos.x;
        _origZ[i] = _posZ[i] = pos.z;
        _isAi[i] = s.isAI;
        _weight[i] = s.weight;
        _dir[i] = s.raceDirection;
        // World-space velocity (m/s): the swim-axis component is signed by the lap
        // direction (distanceToWorldX slope magnitude is 1), the lateral component
        // is the sideways drift. Used only to scale knockback by closing speed.
        const speed = s.currentSpeed;
        const cosH = Math.max(0, Math.cos(s.movementHeading));
        const sinH = Math.sin(s.movementHeading);
        _velX[i] = _dir[i] * speed * cosH;
        _velZ[i] = speed * sinH;
        _impDist[i] = 0;
        _impLat[i] = 0;
        _impRoll[i] = 0;
    }

    const minDist = SWIMMER_COLLISION.radius * 2;
    const minDistSq = minDist * minDist;
    refreshContacts(count, minDistSq, (minDist + CONTACT_RELEASE_MARGIN) ** 2);
    if (count < 2) {
        return;
    }

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
                const wi = _weight[i];
                const wj = _weight[j];
                const totalW = wi + wj;
                const overlap = minDist - dist;
                const sepI = totalW > 0 ? overlap * (wj / totalW) : overlap * 0.5;
                const sepJ = totalW > 0 ? overlap * (wi / totalW) : overlap * 0.5;
                if (!lateralOnly) {
                    _posX[i] += nx * sepI;
                    _posX[j] -= nx * sepJ;
                }
                _posZ[i] += nz * sepI;
                _posZ[j] -= nz * sepJ;
            }
        }
        if (!anyOverlap) {
            break;
        }
    }

    // Single knockback pass (once per pair, NOT per separation iteration):
    // impulse magnitude from overlap depth + closing speed, split by inverse
    // weight. Lateral impulse always; distance impulse only for head-on pairs
    // that are still closing (both lose progress, never free distance).
    if (SWIMMER_COLLISION.knockbackEnabled || SWIMMER_COLLISION.axialRollEnabled >= 0.5) {
        for (let i = 0; i < count; i++) {
            for (let j = i + 1; j < count; j++) {
                const dx = _origX[i] - _origX[j];
                const dz = _origZ[i] - _origZ[j];
                const distSq = dx * dx + dz * dz;
                if (distSq >= minDistSq || !_newContact[i * MAX_SWIMMERS + j]) {
                    continue;
                }
                const lateralOnly = SWIMMER_COLLISION.aiVsAiLateralOnly && _isAi[i] && _isAi[j];
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
                // Closing speed along the normal (n points from j to i); positive
                // while the pair is still approaching, zero/negative once separating.
                const closing = (_velX[j] - _velX[i]) * nx + (_velZ[j] - _velZ[i]) * nz;
                const impact = closing > 0 ? closing : 0;
                const depth = minDist - dist;
                let mag = depth * SWIMMER_COLLISION.knockbackDepthFactor
                    + impact * SWIMMER_COLLISION.knockbackSpeedFactor;
                if (mag > SWIMMER_COLLISION.knockbackMaxImpulse) {
                    mag = SWIMMER_COLLISION.knockbackMaxImpulse;
                }
                if (mag <= 0) {
                    continue;
                }
                const wi = _weight[i];
                const wj = _weight[j];
                const totalW = wi + wj;
                const impI = totalW > 0 ? mag * (wj / totalW) : mag * 0.5;
                const impJ = totalW > 0 ? mag * (wi / totalW) : mag * 0.5;
                if (SWIMMER_COLLISION.knockbackEnabled) {
                    // Lateral shove: always applied, for the readable knocked-apart feel.
                    _impLat[i] += nz * impI;
                    _impLat[j] -= nz * impJ;
                    // Distance shove: only head-on (opposite lap directions) and only
                    // while still approaching. Head-on geometry pushes each swimmer
                    // backward vs its own travel, so both lose a little progress.
                    const headOn = _dir[i] * _dir[j] < 0;
                    if (!lateralOnly && headOn && impact > 0) {
                        _impDist[i] += nx * impI * _dir[i];
                        _impDist[j] -= nx * impJ * _dir[j];
                    }
                }
                if (SWIMMER_COLLISION.axialRollEnabled >= 0.5) {
                    // Only the side component creates long-axis roll: a perfectly
                    // centred head-on impact pushes backward but has no artificial
                    // roll torque. impI/impJ already contain the inverse-weight split.
                    const rollScale = Math.max(0, SWIMMER_COLLISION.axialRollDegreesPerImpulse)
                        * DEG2RAD;
                    _impRoll[i] += nz * impI * _dir[i] * rollScale;
                    _impRoll[j] -= nz * impJ * _dir[j] * rollScale;
                }
            }
        }
    }
    // Apply the net separation displacement once (X -> distance, Z -> lateral),
    // then the accumulated knockback impulse. Collision feedback intentionally stays
    // motion-only; flashing the character red made close racing harder to read.
    for (let i = 0; i < count; i++) {
        const dX = _posX[i] - _origX[i];
        const dZ = _posZ[i] - _origZ[i];
        if (dX !== 0 || dZ !== 0) {
            _active[i].applyCollisionPush(dX, dZ);
        }
        const iD = _impDist[i];
        const iL = _impLat[i];
        if (iD !== 0 || iL !== 0) {
            _active[i].applyCollisionImpulse(iD, iL);
            _active[i].addCollisionEnergyBonus(Math.hypot(iD, iL));
        }
        const iR = _impRoll[i];
        if (iR !== 0) {
            _active[i].applyCollisionAxialImpulse(iR);
        }
    }
}

// Knockback is a contact-begin impulse, not a force accumulated every render frame.
// Keep a small release margin so numerical jitter around exactly 2*radius does not
// repeatedly end/restart the same contact and award multiple energy bonuses.
function refreshContacts(count: number, minDistSq: number, releaseDistSq: number): void {
    for (let i = 0; i < MAX_SWIMMERS * MAX_SWIMMERS; i++) {
        _newContact[i] = false;
    }
    for (let i = 0; i < _contactSeen.length; i++) {
        _contactSeen[i] = false;
    }
    for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
            const dx = _origX[i] - _origX[j];
            const dz = _origZ[i] - _origZ[j];
            const distSq = dx * dx + dz * dz;
            const contactIndex = findContact(_active[i], _active[j]);
            if (contactIndex >= 0) {
                if (distSq <= releaseDistSq) {
                    _contactSeen[contactIndex] = true;
                }
                continue;
            }
            if (distSq < minDistSq) {
                _contactA.push(_active[i]);
                _contactB.push(_active[j]);
                _contactSeen.push(true);
                _newContact[i * MAX_SWIMMERS + j] = true;
            }
        }
    }
    for (let i = _contactSeen.length - 1; i >= 0; i--) {
        if (_contactSeen[i]) {
            continue;
        }
        const last = _contactSeen.length - 1;
        _contactA[i] = _contactA[last];
        _contactB[i] = _contactB[last];
        _contactSeen[i] = _contactSeen[last];
        _contactA.pop();
        _contactB.pop();
        _contactSeen.pop();
    }
}

function findContact(a: Swimmer, b: Swimmer): number {
    for (let i = 0; i < _contactA.length; i++) {
        if ((_contactA[i] === a && _contactB[i] === b)
            || (_contactA[i] === b && _contactB[i] === a)) {
            return i;
        }
    }
    return -1;
}

function clearContacts(): void {
    _contactA.length = 0;
    _contactB.length = 0;
    _contactSeen.length = 0;
}
