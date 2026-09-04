// Lobby-level protocol gate. Wire codecs remain append-compatible, but gameplay
// semantics are not safe across versions that disagree on owner condition/order.

// v10: every member now proves that its complete local tuning surface matches the
// lobby, and human owner frames carry sprint state for remote propulsion replay.
// Owner-authoritative condition and movement must never use a private localStorage/
// native tuning override.
export const NET_RACE_PROTOCOL_VERSION = 10;
const PROTOCOL_TAG = 'PV|';
const PROTOCOL_REQUEST_TAG = 'PVQ|';
const TUNING_FINGERPRINT_PATTERN = /^[0-9a-f]{16}$/;

export interface NetRaceProtocolHello {
    pos: number;
    version: number;
    tuningFingerprint: string;
}

export interface NetRaceProtocolRequest {
    requesterPos: number;
}

export function encodeProtocolHello(pos: number, tuningFingerprint: string): string {
    return `${PROTOCOL_TAG}${Math.floor(pos)}|${NET_RACE_PROTOCOL_VERSION}|${tuningFingerprint}`;
}

export function decodeProtocolHello(message: string): NetRaceProtocolHello | null {
    if (typeof message !== 'string' || message.slice(0, PROTOCOL_TAG.length) !== PROTOCOL_TAG) {
        return null;
    }
    const parts = message.slice(PROTOCOL_TAG.length).split('|');
    if (parts.length !== 3) {
        return null;
    }
    const pos = parseInt(parts[0], 10);
    const version = parseInt(parts[1], 10);
    const tuningFingerprint = parts[2];
    if (!Number.isFinite(pos)
        || pos < 0
        || !Number.isFinite(version)
        || version < 0
        || !TUNING_FINGERPRINT_PATTERN.test(tuningFingerprint)) {
        return null;
    }
    return { pos: Math.floor(pos), version: Math.floor(version), tuningFingerprint };
}

// Best-effort room broadcasts can lose a member's first PV| declaration. A peer
// that is still missing declarations sends PVQ|; every other modern client answers
// once with its ordinary PV| hello. Keeping request and response tags distinct
// avoids the unbounded hello echo loop that "reply to every PV|" would create.
export function encodeProtocolRequest(requesterPos: number): string {
    return `${PROTOCOL_REQUEST_TAG}${Math.floor(requesterPos)}`;
}

export function decodeProtocolRequest(message: string): NetRaceProtocolRequest | null {
    if (typeof message !== 'string'
        || message.slice(0, PROTOCOL_REQUEST_TAG.length) !== PROTOCOL_REQUEST_TAG) {
        return null;
    }
    const body = message.slice(PROTOCOL_REQUEST_TAG.length);
    if (!body || body.indexOf('|') >= 0) {
        return null;
    }
    const requesterPos = Number(body);
    if (!Number.isInteger(requesterPos) || requesterPos < 0) {
        return null;
    }
    return { requesterPos };
}

export function hasCompatibleProtocol(
    memberPositions: readonly number[],
    versions: Readonly<Record<number, number>>,
    tuningFingerprints: Readonly<Record<number, string>>,
    localTuningFingerprint: string,
): boolean {
    if (memberPositions.length === 0 || !TUNING_FINGERPRINT_PATTERN.test(localTuningFingerprint)) {
        return false;
    }
    for (const pos of memberPositions) {
        if (pos < 0
            || versions[pos] !== NET_RACE_PROTOCOL_VERSION
            || tuningFingerprints[pos] !== localTuningFingerprint) {
            return false;
        }
    }
    return true;
}

export function isCompatibleProtocolVersion(value: unknown): boolean {
    return value === NET_RACE_PROTOCOL_VERSION;
}
