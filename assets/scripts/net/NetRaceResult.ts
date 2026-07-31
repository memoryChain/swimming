// Authoritative final-placement codec for the host-authoritative sync model.
//
// When the race ends, each client computes its own leaderboard from local finish
// order. Positions are already host-synced (NetRaceSnapshot), so the order almost
// always matches — but to GUARANTEE identical placements (incl. rare near-ties), the
// host broadcasts the authoritative final placement per lane and clients adopt it.
//
// Pure codec (no engine deps). NetRaceController sends/receives it.
//
// Wire format (broadcast message body):
//   "R|<lane>,<placement>,<fin>,<timeCs>;<lane>,<placement>,<fin>,<timeCs>;..."
// timeCs = finish time in centiseconds (round(time*100)); clients adopt it so the
//          displayed result matches the host (local finish times drift a little
//          because each client integrates on its own frame clock).
// The leading "R|" tag distinguishes it from position snapshots ("S|").

export interface NetResultEntry {
    lane: number;
    placement: number;
    finished: boolean;
    time: number;
}

const TAG = 'R|';

export function encodeRaceResult(entries: NetResultEntry[]): string {
    const body = entries
        .map((e) => `${e.lane},${e.placement},${e.finished ? 1 : 0},${Math.round(e.time * 100)}`)
        .join(';');
    return `${TAG}${body}`;
}

// Returns null if the payload is not a race result (so other broadcasts are ignored).
export function decodeRaceResult(payload: string): NetResultEntry[] | null {
    if (typeof payload !== 'string' || payload.slice(0, TAG.length) !== TAG) {
        return null;
    }
    const body = payload.slice(TAG.length);
    if (body.length === 0) {
        return [];
    }
    const entries: NetResultEntry[] = [];
    for (const token of body.split(';')) {
        const parts = token.split(',');
        if (parts.length < 3) {
            continue;
        }
        const lane = parseInt(parts[0], 10);
        const placement = parseInt(parts[1], 10);
        const fin = parts[2] === '1';
        const timeCs = parts.length > 3 ? parseInt(parts[3], 10) : 0;
        if (!Number.isFinite(lane) || !Number.isFinite(placement)) {
            continue;
        }
        entries.push({ lane, placement, finished: fin, time: Number.isFinite(timeCs) ? timeCs / 100 : 0 });
    }
    return entries;
}
