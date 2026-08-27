// Lobby-level protocol gate. Wire codecs remain append-compatible, but gameplay
// semantics are not safe across versions that disagree on owner condition/order.

export const NET_RACE_PROTOCOL_VERSION = 2;
const PROTOCOL_TAG = 'PV|';

export interface NetRaceProtocolHello {
    pos: number;
    version: number;
}

export function encodeProtocolHello(pos: number): string {
    return `${PROTOCOL_TAG}${Math.floor(pos)}|${NET_RACE_PROTOCOL_VERSION}`;
}

export function decodeProtocolHello(message: string): NetRaceProtocolHello | null {
    if (typeof message !== 'string' || message.slice(0, PROTOCOL_TAG.length) !== PROTOCOL_TAG) {
        return null;
    }
    const parts = message.slice(PROTOCOL_TAG.length).split('|');
    if (parts.length !== 2) {
        return null;
    }
    const pos = parseInt(parts[0], 10);
    const version = parseInt(parts[1], 10);
    if (!Number.isFinite(pos) || pos < 0 || !Number.isFinite(version) || version < 0) {
        return null;
    }
    return { pos: Math.floor(pos), version: Math.floor(version) };
}

export function hasCompatibleProtocol(
    memberPositions: readonly number[],
    versions: Readonly<Record<number, number>>,
): boolean {
    if (memberPositions.length === 0) {
        return false;
    }
    for (const pos of memberPositions) {
        if (pos < 0 || versions[pos] !== NET_RACE_PROTOCOL_VERSION) {
            return false;
        }
    }
    return true;
}

export function isCompatibleProtocolVersion(value: unknown): boolean {
    return value === NET_RACE_PROTOCOL_VERSION;
}
