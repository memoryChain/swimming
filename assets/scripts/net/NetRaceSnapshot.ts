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
//   "S|<hostPos>#<lane>,<distCm>,<latMm>,<fin>,<headMrad>;..."
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
// The leading "S|" tag distinguishes snapshots from other broadcast messages.

export interface NetSnapshotEntry {
    lane: number;
    distance: number;
    lateral: number;
    finished: boolean;
    heading: number;
}

// A decoded snapshot: the authoritative host's seat plus the per-lane state.
export interface DecodedRaceSnapshot {
    hostPos: number;
    entries: NetSnapshotEntry[];
}

const TAG = 'S|';

export function encodeRaceSnapshot(hostPos: number, entries: NetSnapshotEntry[]): string {
    const body = entries
        .map((e) => `${e.lane},${Math.round(e.distance * 100)},${Math.round(e.lateral * 1000)},${e.finished ? 1 : 0},${Math.round(e.heading * 1000)}`)
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
            entries.push({
                lane,
                distance: distCm / 100,
                lateral: latMm / 1000,
                finished: fin,
                heading: Number.isFinite(headMrad) ? headMrad / 1000 : 0,
            });
        }
    }
    return { hostPos: Number.isFinite(hostPos) ? hostPos : 0, entries };
}
