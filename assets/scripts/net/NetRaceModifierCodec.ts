import type { RaceModifierDigest } from '../progression/RaceModifiers';
import { PLAYER_CHARACTER_DEFINITIONS, PLAYER_COLOR_SCHEMES, PLAYER_SKIN_TONES } from '../app/PlayerCharacterConfig';
import { PROGRESSION_BALANCE } from '../progression/ProgressionBalance';

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
// RoomFlow 使用 MOD|座位|成员标识|摘要；摘要为角色ID,等级,肤色ID,配色ID。
export function encodeModifierDigest(digest: RaceModifierDigest | null): string {
    if (!digest || !digest.characterId) {
        return '';
    }
    const payload = `${digest.characterId},${digest.level}`
        + (digest.skinToneId !== undefined || digest.colorSchemeId !== undefined ? `,${digest.skinToneId},${digest.colorSchemeId}` : '');
    return decodeModifierDigest(payload) ? payload : '';
}

export function decodeModifierDigest(payload: string | undefined | null): RaceModifierDigest | null {
    if (typeof payload !== 'string' || !payload || payload.length > 128) {
        return null;
    }
    const parts = payload.split(',');
    if (parts.length !== 2 && parts.length !== 4) return null;
    const [characterId, levelText, skinToneId, colorSchemeId] = parts;
    const level = Number(levelText);
    if (!/^\d+$/.test(levelText) || !Number.isInteger(level) || level < 1 || level > PROGRESSION_BALANCE.maxLevel
        || !PLAYER_CHARACTER_DEFINITIONS.some(character => character.id === characterId && character.unlocked)) return null;
    if (parts.length === 2) return { characterId, level };
    if (!PLAYER_SKIN_TONES.some(tone => tone.id === skinToneId) || !PLAYER_COLOR_SCHEMES.some(scheme => scheme.id === colorSchemeId)) return null;
    return { characterId, level, skinToneId, colorSchemeId };
}

// 旧摘要仍可读取；新版房间必须收齐外观才能开赛，不能静默替换为默认角色。
export function hasCompleteModifierDigest(payload: string | undefined): boolean {
    const digest = decodeModifierDigest(payload);
    return !!(digest?.skinToneId && digest.colorSchemeId);
}
