// Authoritative race-position snapshot codec for the host-authoritative sync model.
//
// In a networked race every client simulates locally (immediate input for feel,
// including collisions), but the HOST is the single source of truth. The host
// periodically broadcasts a compact snapshot of every lane's race progress + lane
// offset; each client eases its swimmers toward these values so all clients converge
// to the host's result (and collision outcomes never diverge permanently).
//
// This module is the pure codec (no engine deps). NetRaceController sends/receives it.
//
// Wire format (broadcast message body):
//   "S|<hostPos>#<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<rollMrad>,<rollVelMrad>,<headVelMrad>;..."
// hostPos   = the seat index (posNum) of the client that produced this snapshot, i.e.
//             who currently believes it is the authoritative host. Clients use it for
//             deterministic host migration: if the host goes silent, the lowest
//             surviving posNum takes over, and this field lets everyone agree on (and
//             defer to) the highest-priority (lowest-pos) live host.
// distCm    = distance in centimetres (round(distance*100))    — race progress
// latMm     = lane offset in millimetres (round(lateralOffset*1000))
// fin       = 1 if that lane has finished, else 0
// headMrad  = steering heading in milliradians (round(heading*1000)) — facing/weave,
//             which drifts across JS engines (Math.sin/cos) so must be synced too.
// headVelMrad = persistent steering angular velocity in milliradians/second.
// The leading "S|" tag distinguishes snapshots from other broadcast messages.

export interface NetSnapshotEntry {
    lane: number;
    distance: number;
    lateral: number;
    finished: boolean;
    heading: number;
    // Persistent steering angular velocity (rad/s). Appended to the wire format
    // for backward compatibility; older payloads decode it as zero.
    headingVelocity: number;
    // Owner's authoritative swim speed (m/s). Drives the tread-water<->freestyle pose on
    // remote copies so the pose follows the owner instead of the remote's local input
    // replay (which jitters over the network → "treading water while sliding forward").
    // -1 = not provided (consumer falls back to the local motor speed).
    speed: number;
    // Ultimate energy (0..100, integer points). For human lanes the owner's reliable
    // frame self-report is authoritative; for AI lanes the host S| snapshot is
    // authoritative. -1 = not provided by an older payload.
    energy: number;
    // Powered long-axis side-fall angle + angular velocity. The periodic angle is
    // normalized to [-pi, pi]; velocity keeps remote correction continuous.
    axialRoll: number;
    axialRollVelocity: number;
}

// A decoded snapshot: the authoritative host's seat plus the per-lane state.
export interface DecodedRaceSnapshot {
    hostPos: number;
    entries: NetSnapshotEntry[];
}

const TAG = 'S|';

export function encodeRaceSnapshot(hostPos: number, entries: NetSnapshotEntry[]): string {
    const body = entries
        .map((e) => `${e.lane},${Math.round(e.distance * 100)},${Math.round(e.lateral * 1000)},${e.finished ? 1 : 0},${Math.round(e.heading * 1000)},${Math.round(Math.max(0, e.speed) * 100)},${Math.max(0, Math.round(e.energy))},${Math.round(e.axialRoll * 1000)},${Math.round(e.axialRollVelocity * 1000)},${Math.round(e.headingVelocity * 1000)}`)
        .join(';');
    return `${TAG}${hostPos}#${body}`;
}

// Returns null if the payload is not a race snapshot (so other broadcast messages
// are ignored cleanly).
export function decodeRaceSnapshot(payload: string): DecodedRaceSnapshot | null {
    if (typeof payload !== 'string' || payload.slice(0, TAG.length) !== TAG) {
        return null;
    }
    const rest = payload.slice(TAG.length);
    const hash = rest.indexOf('#');
    if (hash < 0) {
        return null;
    }
    const hostPos = parseInt(rest.slice(0, hash), 10);
    const body = rest.slice(hash + 1);
    const entries: NetSnapshotEntry[] = [];
    if (body.length > 0) {
        for (const token of body.split(';')) {
            const parts = token.split(',');
            if (parts.length < 4) {
                continue;
            }
            const lane = parseInt(parts[0], 10);
            const distCm = parseInt(parts[1], 10);
            const latMm = parseInt(parts[2], 10);
            const fin = parts[3] === '1';
            const headMrad = parts.length > 4 ? parseInt(parts[4], 10) : 0;
            if (!Number.isFinite(lane) || !Number.isFinite(distCm) || !Number.isFinite(latMm)) {
                continue;
            }
            const speedCms = parts.length > 5 ? parseInt(parts[5], 10) : -1;
            const energy = parts.length > 6 ? parseInt(parts[6], 10) : -1;
            const rollMrad = parts.length > 7 ? parseInt(parts[7], 10) : 0;
            const rollVelMrad = parts.length > 8 ? parseInt(parts[8], 10) : 0;
            const headVelMrad = parts.length > 9 ? parseInt(parts[9], 10) : 0;
            entries.push({
                lane,
                distance: distCm / 100,
                lateral: latMm / 1000,
                finished: fin,
                heading: Number.isFinite(headMrad) ? headMrad / 1000 : 0,
                headingVelocity: Number.isFinite(headVelMrad) ? headVelMrad / 1000 : 0,
                speed: Number.isFinite(speedCms) && speedCms >= 0 ? speedCms / 100 : -1,
                energy: Number.isFinite(energy) && energy >= 0 ? energy : -1,
                axialRoll: Number.isFinite(rollMrad) ? rollMrad / 1000 : 0,
                axialRollVelocity: Number.isFinite(rollVelMrad) ? rollVelMrad / 1000 : 0,
            });
        }
    }
    return { hostPos: Number.isFinite(hostPos) ? hostPos : 0, entries };
}

// Self-position report (tag "P|"): a single lane's own-authoritative position, sent by
// the client that CONTROLS that swimmer (each human broadcasts their own player). Every
// other client eases that swimmer toward this so its on-screen copy "catches up" to how
// its owner actually sees it — the owner predicts locally with zero input lag, so the
// owner's position is the truth; input-replay alone leaves the remote copy ~1 RTT behind
// and drifting. Same field layout as one snapshot entry (incl. speed + energy), so it
// also carries authoritative pose-speed and ultimate energy — required in broadcast-only
// mode (iOS high-performance+), where these can no longer ride the lock-step frame self.
//   "P|<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<rollMrad>,<rollVelMrad>,<headVelMrad>"
const SELF_TAG = 'P|';

export function encodeSelfSnapshot(entry: NetSnapshotEntry): string {
    return `${SELF_TAG}${entry.lane},${Math.round(entry.distance * 100)},${Math.round(entry.lateral * 1000)},${entry.finished ? 1 : 0},${Math.round(entry.heading * 1000)},${Math.round(Math.max(0, entry.speed) * 100)},${Math.max(0, Math.round(entry.energy))},${Math.round(entry.axialRoll * 1000)},${Math.round(entry.axialRollVelocity * 1000)},${Math.round(entry.headingVelocity * 1000)}`;
}

// Returns null if the payload is not a self-position report.
export function decodeSelfSnapshot(payload: string): NetSnapshotEntry | null {
    if (typeof payload !== 'string' || payload.slice(0, SELF_TAG.length) !== SELF_TAG) {
        return null;
    }
    const parts = payload.slice(SELF_TAG.length).split(',');
    if (parts.length < 4) {
        return null;
    }
    const lane = parseInt(parts[0], 10);
    const distCm = parseInt(parts[1], 10);
    const latMm = parseInt(parts[2], 10);
    const fin = parts[3] === '1';
    const headMrad = parts.length > 4 ? parseInt(parts[4], 10) : 0;
    if (!Number.isFinite(lane) || !Number.isFinite(distCm) || !Number.isFinite(latMm)) {
        return null;
    }
    const speedCms = parts.length > 5 ? parseInt(parts[5], 10) : -1;
    const energy = parts.length > 6 ? parseInt(parts[6], 10) : -1;
    const rollMrad = parts.length > 7 ? parseInt(parts[7], 10) : 0;
    const rollVelMrad = parts.length > 8 ? parseInt(parts[8], 10) : 0;
    const headVelMrad = parts.length > 9 ? parseInt(parts[9], 10) : 0;
    return {
        lane,
        distance: distCm / 100,
        lateral: latMm / 1000,
        finished: fin,
        heading: Number.isFinite(headMrad) ? headMrad / 1000 : 0,
        headingVelocity: Number.isFinite(headVelMrad) ? headVelMrad / 1000 : 0,
        speed: Number.isFinite(speedCms) && speedCms >= 0 ? speedCms / 100 : -1,
        energy: Number.isFinite(energy) && energy >= 0 ? energy : -1,
        axialRoll: Number.isFinite(rollMrad) ? rollMrad / 1000 : 0,
        axialRollVelocity: Number.isFinite(rollVelMrad) ? rollVelMrad / 1000 : 0,
    };
}
