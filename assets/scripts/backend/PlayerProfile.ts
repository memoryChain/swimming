// Player progression profile - the account's persistent 养成 data. Phase 1 has a
// single currency: 游泳卡 (swim cards). Phase 2 adds per-character progression
// (level/xp). Kept deliberately small; add fields over time and bump
// PLAYER_PROFILE_SCHEMA when the shape changes so old saves can migrate.

import { defaultAvatarId, generateRandomNickName } from './IdentityConfig';
import { PLAYER_CHARACTER_DEFINITIONS } from '../app/PlayerCharacterConfig';

export const PLAYER_PROFILE_SCHEMA = 2;

// In-game resource display names (single source of truth for UI text).
export const CURRENCY = {
    swimCard: { id: 'swimCard', label: '游泳卡' },
} as const;

// Tunable progression numbers shared by the client mock. The real WeChat Cloud
// function is authoritative and keeps its own copy of these (server can't trust
// client values); keep the two in sync when they matter.
export const PROGRESSION_CONFIG = {
    // Swim cards granted per completed rewarded-ad view.
    adRewardSwimCards: 1,
    // Max rewarded-ad grants per day (anti-spam).
    dailyAdCap: 10,
} as const;

// Per-character progression (level + xp). Stored under profile.characters[id].
export interface CharacterProgress {
    level: number;
    xp: number;
}

export interface PlayerProfile {
    schema: number;
    // In-game identity (player-chosen, NOT the real WeChat profile).
    nickName: string;
    avatarId: string;
    // 游泳卡 balance.
    swimCards: number;
    // Per-day rewarded-ad counter (reset when the date rolls over).
    daily: {
        date: string; // 'YYYY-MM-DD' local
        adCount: number;
    };
    // Per-character 养成 progress (phase 2). Keyed by PlayerCharacterId.
    characters: Record<string, CharacterProgress>;
}

export function todayString(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = pad2(now.getMonth() + 1);
    const d = pad2(now.getDate());
    return `${y}-${m}-${d}`;
}

function pad2(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
}

// Default character progress: every unlocked character starts at level 1, 0 xp.
export function createDefaultCharacterProgress(): Record<string, CharacterProgress> {
    const characters: Record<string, CharacterProgress> = {};
    for (const def of PLAYER_CHARACTER_DEFINITIONS) {
        if (def.unlocked) {
            characters[def.id] = { level: 1, xp: 0 };
        }
    }
    return characters;
}

export function createDefaultProfile(): PlayerProfile {
    return {
        schema: PLAYER_PROFILE_SCHEMA,
        nickName: generateRandomNickName(),
        avatarId: defaultAvatarId(),
        swimCards: 0,
        daily: { date: todayString(), adCount: 0 },
        characters: createDefaultCharacterProgress(),
    };
}

// Clamp/validate a single character progress entry read from storage.
function normalizeCharacterProgress(raw: unknown): CharacterProgress {
    const entry = raw as Partial<CharacterProgress>;
    return {
        level: Number.isFinite(entry.level as number) ? Math.max(1, Math.floor(entry.level as number)) : 1,
        xp: Number.isFinite(entry.xp as number) ? Math.max(0, Math.floor(entry.xp as number)) : 0,
    };
}

// Fill in any missing fields on a loaded profile (forward-compatible migration)
// and roll the daily counter over if the date changed. Always returns a valid,
// fully-populated profile.
export function normalizeProfile(raw: unknown): PlayerProfile {
    const base = createDefaultProfile();
    if (!raw || typeof raw !== 'object') {
        return base;
    }
    const src = raw as Partial<PlayerProfile>;
    // Migrate characters: start from defaults (so newly-added characters appear),
    // then overlay any saved progress for known character ids.
    const characters = createDefaultCharacterProgress();
    if (src.characters && typeof src.characters === 'object') {
        for (const id of Object.keys(src.characters)) {
            characters[id] = normalizeCharacterProgress((src.characters as Record<string, unknown>)[id]);
        }
    }
    const profile: PlayerProfile = {
        schema: PLAYER_PROFILE_SCHEMA,
        nickName: typeof src.nickName === 'string' && src.nickName.length > 0 ? src.nickName : base.nickName,
        avatarId: typeof src.avatarId === 'string' && src.avatarId.length > 0 ? src.avatarId : base.avatarId,
        swimCards: Number.isFinite(src.swimCards as number) ? Math.max(0, Math.floor(src.swimCards as number)) : 0,
        daily: {
            date: typeof src.daily?.date === 'string' ? src.daily!.date : base.daily.date,
            adCount: Number.isFinite(src.daily?.adCount as number) ? Math.max(0, Math.floor(src.daily!.adCount as number)) : 0,
        },
        characters,
    };
    // Roll over the daily counter on a new day.
    if (profile.daily.date !== todayString()) {
        profile.daily.date = todayString();
        profile.daily.adCount = 0;
    }
    return profile;
}