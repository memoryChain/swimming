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
//   "R|<hostPos>,<sequence>|<lane>,<placement>,<fin>,<timeCs>,<elim>,<shark>,<cannon>,<quit>;..."
// timeCs = finish time in centiseconds (round(time*100)); clients adopt it so the
//          displayed result matches the host (local finish times drift a little
//          because each client integrates on its own frame clock).
// The leading "R|" tag distinguishes it from position snapshots ("S|").

export interface NetResultEntry {
    lane: number;
    placement: number;
    finished: boolean;
    time: number;
    eliminated?: boolean;
    sharkEliminated?: boolean;
    cannonEliminated?: boolean;
    quit?: boolean;
}

const TAG = 'R|';

export interface NetRaceResultPacket {
    hostPos: number;
    sequence: number;
    entries: NetResultEntry[];
}

export function encodeRaceResult(entries: NetResultEntry[], hostPos: number, sequence: number): string {
    const body = entries
        .map((e) => `${e.lane},${e.placement},${e.finished ? 1 : 0},${Math.round(e.time * 100)},${e.eliminated ? 1 : 0},${e.sharkEliminated ? 1 : 0},${e.cannonEliminated ? 1 : 0},${e.quit ? 1 : 0}`)
        .join(';');
    return `${TAG}${hostPos},${sequence}|${body}`;
}

// Returns null if the payload is not a race result (so other broadcasts are ignored).
export function decodeRaceResult(payload: string): NetRaceResultPacket | null {
    if (typeof payload !== 'string' || payload.slice(0, TAG.length) !== TAG) {
        return null;
    }
    const separator = payload.indexOf('|', TAG.length);
    if (separator < 0) return null;
    const header = payload.slice(TAG.length, separator).split(',');
    if (header.length !== 2 || !/^\d$/.test(header[0]) || !/^\d+$/.test(header[1])) return null;
    const hostPos = Number(header[0]), sequence = Number(header[1]);
    if (hostPos > 7 || !Number.isSafeInteger(sequence) || sequence < 1) return null;
    const body = payload.slice(separator + 1);
    if (!body) return null;
    const entries: NetResultEntry[] = [];
    const lanes = new Set<number>();
    const placements = new Set<number>();
    for (const token of body.split(';')) {
        const parts = token.split(',');
        if ((parts.length !== 7 && parts.length !== 8) || !parts.every(p => /^\d+$/.test(p))) return null;
        if (parts.length === 8 && parts[7] !== '0' && parts[7] !== '1') return null;
        const lane = Number(parts[0]);
        const placement = Number(parts[1]);
        const fin = parts[2] === '1';
        const timeCs = Number(parts[3]);
        if (lane > 7 || placement < 1 || placement > 8 || lanes.has(lane) || placements.has(placement)
            || !Number.isSafeInteger(timeCs) || ![2, 4, 5, 6].every(i => parts[i] === '0' || parts[i] === '1')) return null;
        lanes.add(lane); placements.add(placement);
        entries.push({
            lane,
            placement,
            finished: fin,
            time: Number.isFinite(timeCs) ? timeCs / 100 : 0,
            eliminated: parts[4] === '1',
            sharkEliminated: parts[5] === '1',
            cannonEliminated: parts[6] === '1',
            quit: parts[7] === '1',
        });
    }
    return { hostPos, sequence, entries };
}
