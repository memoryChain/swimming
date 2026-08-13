import type { RaceModifierDigest } from '../progression/RaceModifiers';

// Codec for a RaceModifierDigest — the compact, transmissible SOURCE of a player's 养成
// modifiers (the save-derived keys needed to re-resolve the full profile on any client
// via shared config + pure functions). We transmit the DIGEST, not the resolved balance
// floats, for two reasons:
//   1. Size: WeChat memberExtInfo is capped at 32 bytes and is already mostly consumed
//      by avatarId|nickName, so a resolved 7-float blob (~40 bytes) overflowed it
//      (errCode 4013 "buffer overflow"). The digest is a few bytes AND it rides the
//      room BROADCAST channel (larger limit) instead of extInfo — see RoomFlow.
//   2. Extensibility: a future 养成 system adds a KEY to the digest (e.g. equipped item
//      ids), re-resolved from shared config, instead of more transmitted values.
//
// This module is the pure <payload> codec; RoomFlow wraps it as "MOD|<pos>|<payload>".
// Wire form (payload): "<characterId>,<level>". characterId never contains ',' or '|'.
export function encodeModifierDigest(digest: RaceModifierDigest | null): string {
    if (!digest || !digest.characterId) {
        return '';
    }
    const level = Math.max(1, Math.round(digest.level));
    return `${digest.characterId},${level}`;
}

export function decodeModifierDigest(payload: string | undefined | null): RaceModifierDigest | null {
    if (!payload) {
        return null;
    }
    const comma = payload.indexOf(',');
    if (comma < 0) {
        return null;
    }
    const characterId = payload.slice(0, comma);
    const level = parseInt(payload.slice(comma + 1), 10);
    if (!characterId || !Number.isFinite(level)) {
        return null;
    }
    return { characterId, level: Math.max(1, level) };
}
