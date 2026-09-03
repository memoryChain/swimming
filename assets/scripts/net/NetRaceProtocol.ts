// Lobby-level protocol gate. Wire codecs remain append-compatible, but gameplay
// semantics are not safe across versions that disagree on owner condition/order.

// 新角色改变共享角色表及头像到模型的映射，旧客户端必须先更新再加入同一房间。
export const NET_RACE_PROTOCOL_VERSION = 7;
const PROTOCOL_TAG = 'PV|';
const PROTOCOL_REQUEST_TAG = 'PVQ|';

export interface NetRaceProtocolHello {
    pos: number;
    version: number;
}

export interface NetRaceProtocolRequest {
    requesterPos: number;
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
