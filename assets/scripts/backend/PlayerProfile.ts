// Player progression profile - the account's persistent 养成 data. The single
// currency is 金币 (coins): earned by racing, spent manually to level characters.
// Per-character progression is just a level (no XP - coins buy levels directly).
// Kept deliberately small; add fields over time and bump PLAYER_PROFILE_SCHEMA
// when the shape changes so old saves can migrate.

import { defaultAvatarId, generateRandomNickName } from './IdentityConfig';
import { PLAYER_CHARACTER_DEFINITIONS } from '../app/PlayerCharacterConfig';

export const PLAYER_PROFILE_SCHEMA = 4;
const MAX_RACE_REWARD_CLAIMS = 32;

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

// Bounded receipt for the optional post-race rewarded-ad bonus. The claim API
// accepts only the settlement id and looks the amount up here, so callers cannot
// choose an arbitrary coin amount. A future cloud backend should create the same
// receipt from its authoritative race settlement.
export interface RaceRewardClaim {
    baseCoins: number;
    doubleClaimed: boolean;
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
    // Monotonic local receipt sequence. Account scoping makes `race-N` unique for
    // the current MockBackend profile without outcome-affecting randomness.
    nextRaceSettlementSeq: number;
    // Recent receipts only; bounded so long-running profiles do not grow forever.
    raceRewardClaims: Record<string, RaceRewardClaim>;
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
        nextRaceSettlementSeq: 1,
        raceRewardClaims: {},
    };
}

// Clamp/validate a single character progress entry read from storage.
function normalizeCharacterProgress(raw: unknown): CharacterProgress {
    const entry = raw as Partial<CharacterProgress>;
    return {
        level: Number.isFinite(entry.level as number) ? Math.max(1, Math.floor(entry.level as number)) : 1,
    };
}

function normalizeRaceRewardClaims(raw: unknown): Record<string, RaceRewardClaim> {
    const claims: Record<string, RaceRewardClaim> = {};
    if (!raw || typeof raw !== 'object') {
        return claims;
    }
    const source = raw as Record<string, Partial<RaceRewardClaim>>;
    const ids = Object.keys(source).slice(-MAX_RACE_REWARD_CLAIMS);
    for (const id of ids) {
        const entry = source[id];
        const baseCoins = Number.isFinite(entry?.baseCoins as number)
            ? Math.max(0, Math.floor(entry!.baseCoins as number))
            : 0;
        if (!id || baseCoins <= 0) {
            continue;
        }
        claims[id] = {
            baseCoins,
            doubleClaimed: entry?.doubleClaimed === true,
        };
    }
    return claims;
}

export function registerRaceRewardClaim(profile: PlayerProfile, baseCoins: number): string | null {
    const normalizedCoins = Number.isFinite(baseCoins) ? Math.max(0, Math.floor(baseCoins)) : 0;
    if (normalizedCoins <= 0) {
        return null;
    }
    const sequence = Number.isFinite(profile.nextRaceSettlementSeq)
        ? Math.max(1, Math.floor(profile.nextRaceSettlementSeq))
        : 1;
    const settlementId = `race-${sequence}`;
    profile.nextRaceSettlementSeq = sequence + 1;
    profile.raceRewardClaims[settlementId] = {
        baseCoins: normalizedCoins,
        doubleClaimed: false,
    };
    const ids = Object.keys(profile.raceRewardClaims);
    while (ids.length > MAX_RACE_REWARD_CLAIMS) {
        const oldestId = ids.shift();
        if (oldestId) {
            delete profile.raceRewardClaims[oldestId];
        }
    }
    return settlementId;
}

// Fill in any missing fields on a loaded profile (forward-compatible migration)
// and roll the daily counter over if the date changed. Always returns a valid,
// fully-populated profile. Migrates schema 2 (swimCards + per-character xp) to
// schema 4 (coins + per-character level + idempotent race reward receipts).
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
    const raceRewardClaims = normalizeRaceRewardClaims(src.raceRewardClaims);
    let maxStoredSequence = 0;
    for (const id of Object.keys(raceRewardClaims)) {
        const match = /^race-(\d+)$/.exec(id);
        if (match) {
            maxStoredSequence = Math.max(maxStoredSequence, Number(match[1]));
        }
    }
    const savedNextSequence = Number.isFinite(src.nextRaceSettlementSeq as number)
        ? Math.max(1, Math.floor(src.nextRaceSettlementSeq as number))
        : 1;
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
        nextRaceSettlementSeq: Math.max(savedNextSequence, maxStoredSequence + 1),
        raceRewardClaims,
    };
    // Roll over the daily counter on a new day.
    if (profile.daily.date !== todayString()) {
        profile.daily.date = todayString();
        profile.daily.adCount = 0;
    }
    return profile;
}
