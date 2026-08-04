// Player progression profile - the account's persistent 养成 data. The single
// currency is 金币 (coins): earned by racing, spent manually to level characters.
// Per-character progression is just a level (no XP - coins buy levels directly).
// Kept deliberately small; add fields over time and bump PLAYER_PROFILE_SCHEMA
// when the shape changes so old saves can migrate.

import { defaultAvatarId, generateRandomNickName } from './IdentityConfig';
import { PLAYER_CHARACTER_DEFINITIONS } from '../app/PlayerCharacterConfig';

export const PLAYER_PROFILE_SCHEMA = 3;

// In-game resource display names (single source of truth for UI text).
export const CURRENCY = {
    coin: { id: 'coin', label: '金币' },
} as const;

// Tunable progression numbers shared by the client mock. The real WeChat Cloud
// function is authoritative and keeps its own copy of these (server can't trust
// client values); keep the two in sync when they matter.
export const PROGRESSION_CONFIG = {
    // Coins granted per completed rewarded-ad view (headbar "+" button). Tune to
    // taste — a race awards ~300-400 and a level-up costs 800+, so this is a small
    // top-up, not a shortcut.
    adRewardCoins: 100,
    // Max rewarded-ad grants per day (anti-spam), enforced by the backend.
    dailyAdCap: 10,
    // Coins granted to brand-new accounts so the first level-up is reachable
    // before any race.
    starterCoins: 2000,
    // DEBUG ONLY: coins granted per tap of the headbar "+" button. This is a dev
    // cheat for testing the level system with ads deferred. MUST be removed or
    // gated behind a real rewarded-ad flow before shipping to production.
    debugGrantCoins: 10000,
} as const;

// Per-character progression (level only - no XP; coins buy levels directly).
// Stored under profile.characters[id].
export interface CharacterProgress {
    level: number;
}

export interface PlayerProfile {
    schema: number;
    // In-game identity (player-chosen, NOT the real WeChat profile).
    nickName: string;
    avatarId: string;
    // 金币 balance (shared wallet - spend on any character).
    coins: number;
    // Per-day rewarded-ad counter (reset when the date rolls over). Unused while
    // ads are deferred, but kept so the field is ready.
    daily: {
        date: string; // 'YYYY-MM-DD' local
        adCount: number;
    };
    // Per-character 养成 progress (level only). Keyed by PlayerCharacterId.
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

// Default character progress: every unlocked character starts at level 1.
export function createDefaultCharacterProgress(): Record<string, CharacterProgress> {
    const characters: Record<string, CharacterProgress> = {};
    for (const def of PLAYER_CHARACTER_DEFINITIONS) {
        if (def.unlocked) {
            characters[def.id] = { level: 1 };
        }
    }
    return characters;
}

export function createDefaultProfile(): PlayerProfile {
    return {
        schema: PLAYER_PROFILE_SCHEMA,
        nickName: generateRandomNickName(),
        avatarId: defaultAvatarId(),
        coins: PROGRESSION_CONFIG.starterCoins,
        daily: { date: todayString(), adCount: 0 },
        characters: createDefaultCharacterProgress(),
    };
}

// Clamp/validate a single character progress entry read from storage.
function normalizeCharacterProgress(raw: unknown): CharacterProgress {
    const entry = raw as Partial<CharacterProgress>;
    return {
        level: Number.isFinite(entry.level as number) ? Math.max(1, Math.floor(entry.level as number)) : 1,
    };
}

// Fill in any missing fields on a loaded profile (forward-compatible migration)
// and roll the daily counter over if the date changed. Always returns a valid,
// fully-populated profile. Migrates schema 2 (swimCards + per-character xp) to
// schema 3 (coins + per-character level only).
export function normalizeProfile(raw: unknown): PlayerProfile {
    const base = createDefaultProfile();
    if (!raw || typeof raw !== 'object') {
        return base;
    }
    const src = raw as Partial<PlayerProfile> & { swimCards?: unknown };
    // Migrate characters: start from defaults (so newly-added characters appear),
    // then overlay any saved progress for known character ids (dropping legacy xp).
    const characters = createDefaultCharacterProgress();
    if (src.characters && typeof src.characters === 'object') {
        for (const id of Object.keys(src.characters)) {
            characters[id] = normalizeCharacterProgress(src.characters[id]);
        }
    }
    // Coins: prefer the new `coins` field; fall back to legacy `swimCards` (1:1)
    // so pre-migration saves keep their ad-granted balance.
    const coinFromLegacy = Number.isFinite(src.swimCards as number) ? Math.max(0, Math.floor(src.swimCards as number)) : 0;
    const coins = Number.isFinite(src.coins as number)
        ? Math.max(0, Math.floor(src.coins as number))
        : coinFromLegacy;
    const profile: PlayerProfile = {
        schema: PLAYER_PROFILE_SCHEMA,
        nickName: typeof src.nickName === 'string' && src.nickName.length > 0 ? src.nickName : base.nickName,
        avatarId: typeof src.avatarId === 'string' && src.avatarId.length > 0 ? src.avatarId : base.avatarId,
        coins,
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