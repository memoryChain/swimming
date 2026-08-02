// Carries the agreed-upon parameters of a networked race from the room handshake
// into the race scene (which loads separately). Set right before launching the race
// and consumed once by GameManager. Determinism (identical seed + inputs) is what
// makes every client compute the same race.

export interface NetRaceMember {
    avatarId: string;
    nickName: string;
    // True for the local player's member (the one this client controls).
    self: boolean;
    // WeChat seat index (posNum). Stable per member for the room's lifetime; used to
    // map members to lanes deterministically and to route each member's input.
    pos: number;
    // Opaque race-modifier blob (养成 profile) carried in the roster extInfo and decoded
    // by the game layer via NetRaceModifierCodec. Empty when the member published none
    // (old client / neutral). Kept as a raw string so this handshake stays codec-
    // agnostic and any future 养成 field flows through without touching this type.
    modifiersBlob?: string;
}

export interface NetRaceSessionData {
    // Shared RNG seed broadcast by the host; every client reseeds SharedRNG with it.
    seed: number;
    // Human members in the room, in a stable order agreed by all clients.
    members: NetRaceMember[];
    // Whether this client is the room host.
    localIsHost: boolean;
    // This client's own seat index (WeChat posNum) used to stamp uploaded frames.
    localPos: number;
}

let _session: NetRaceSessionData | null = null;

export function setNetRaceSession(session: NetRaceSessionData | null): void {
    _session = session;
}

// Read (and clear) the pending net-race session. Returns null for a normal
// single-player race.
export function consumeNetRaceSession(): NetRaceSessionData | null {
    const session = _session;
    _session = null;
    return session;
}
