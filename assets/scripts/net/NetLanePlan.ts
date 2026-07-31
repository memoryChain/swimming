// Deterministic lane assignment for a networked race.
//
// Every client must lay out the same swimmers in the same lanes, and each client must
// know which lane its OWN player occupies and which lanes are remote humans (vs AI
// fill). We derive this purely from the room roster's seat indices (posNum), sorted
// ascending, so the result is identical on every client regardless of the order its
// member array happened to arrive in.
//
// Humans take the lowest lanes in posNum order; the remaining lanes are AI fill. This
// is intentionally simple and order-independent — no RNG needed, so it can't diverge.

import { NetRaceSessionData } from './NetRaceSession';

export interface NetLanePlan {
    // Lane index (0-based) the local player occupies.
    playerLane: number;
    // Remote human lanes: which lane each non-local member sits in, and the posNum to
    // route that lane's input from.
    remotes: { pos: number; lane: number }[];
    // Number of human members (local + remote). Lanes beyond this are AI fill.
    humanCount: number;
}

// Build the lane plan for this client. `laneCount` is the venue's lane count.
export function buildNetLanePlan(session: NetRaceSessionData, laneCount: number): NetLanePlan {
    // Sort member seat indices ascending for an order-independent, identical layout on
    // every client. Drop invalid (-1) seats defensively.
    const seats = session.members
        .map((m) => m.pos)
        .filter((pos) => Number.isFinite(pos) && pos >= 0)
        .sort((a, b) => a - b);

    // Map each seat (posNum) to a lane by its rank in the sorted order.
    const laneForPos = new Map<number, number>();
    seats.forEach((pos, index) => {
        if (index < laneCount) {
            laneForPos.set(pos, index);
        }
    });

    const playerLane = laneForPos.get(session.localPos) ?? 0;
    const remotes: { pos: number; lane: number }[] = [];
    laneForPos.forEach((lane, pos) => {
        if (pos !== session.localPos) {
            remotes.push({ pos, lane });
        }
    });

    return {
        playerLane,
        remotes,
        humanCount: Math.min(seats.length, laneCount),
    };
}
