// Player progression profile - the account's persistent 养成 data. The single
// currency is 金币 (coins): earned by racing, spent manually to level characters.
// Per-character progression is just a level (no XP - coins buy levels directly).
// Kept deliberately small; add fields over time and bump PLAYER_PROFILE_SCHEMA
// when the shape changes so old saves can migrate.

import { normalizeCharacterLevel } from '../progression/ProgressionBalance';
import { createCareer, CareerState, tierIndex, cupRounds } from '../progression/CareerRules';
import { defaultAvatarId, generateRandomNickName } from './IdentityConfig';
import {
    createDefaultPlayerCharacterSelection,
    normalizePlayerCharacterSelection,
    PLAYER_CHARACTER_DEFINITIONS,
    PlayerCharacterSelection,
} from '../app/PlayerCharacterConfig';

export const PLAYER_PROFILE_SCHEMA = 6;

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
    starterCoins: 0,
    // DEBUG ONLY: coins granted per tap of the headbar "+" button. This is a dev
    // cheat for testing the level system with ads deferred. MUST be removed or
    // gated behind a real rewarded-ad flow before shipping to production.
    debugGrantCoins: 10000,
} as const;

// Per-character progression (level only - no XP; coins buy levels directly).
// Stored under profile.characters[id].
export interface CharacterProgress {
    level: number;
    /** 旧签约存档兼容字段，不参与当前升级权限判断。 */
    signed: boolean;
    signAds: number;
    adTokens: string[];
}

export interface PlayerProfile {
    schema: number;
    career: CareerState;
    // In-game identity (player-chosen, NOT the real WeChat profile).
    nickName: string;
    avatarId: string;
    // Last confirmed playable character and its cosmetic appearance.
    characterSelection: PlayerCharacterSelection;
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
            characters[def.id] = { level: 1, signed: false, signAds: 0, adTokens: [] };
        }
    }
    return characters;
}

export function createDefaultProfile(): PlayerProfile {
    return {
        schema: PLAYER_PROFILE_SCHEMA,
        career: createCareer(),
        nickName: generateRandomNickName(),
        avatarId: defaultAvatarId(),
        characterSelection: createDefaultPlayerCharacterSelection(),
        coins: PROGRESSION_CONFIG.starterCoins,
        daily: { date: todayString(), adCount: 0 },
        characters: createDefaultCharacterProgress(),
    };
}

// Clamp/validate a single character progress entry read from storage.
function normalizeCharacterProgress(raw: unknown): CharacterProgress {
    const entry = raw as Partial<CharacterProgress> | null;
    return {
        level: normalizeCharacterLevel(entry?.level),
        signed: entry?.signed === true || normalizeCharacterLevel(entry?.level) > 1,
        signAds: Math.max(0, Math.min(3, Math.floor(Number(entry?.signAds) || 0))),
        adTokens: Array.isArray(entry?.adTokens) ? entry.adTokens.filter(t => typeof t === 'string').slice(-3) : [],
    };
}

// Fill in any missing fields on a loaded profile (forward-compatible migration)
// and roll the daily counter over if the date changed. Always returns a valid,
// fully-populated profile. Migrates schema 2 (swimCards + per-character xp) to
// schema 3 (coins + per-character level only), then schema 4 (persistent
// character selection). Saves without a selection use the current roster's first
// unlocked character rather than a model-array position.
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
        career: normalizeCareer(src.career),
        nickName: typeof src.nickName === 'string' && src.nickName.length > 0 ? src.nickName : base.nickName,
        avatarId: typeof src.avatarId === 'string' && src.avatarId.length > 0 ? src.avatarId : base.avatarId,
        characterSelection: normalizePlayerCharacterSelection(src.characterSelection),
        coins,
        daily: {
            date: typeof src.daily?.date === 'string' ? src.daily!.date : base.daily.date,
            adCount: Number.isFinite(src.daily?.adCount as number) ? Math.max(0, Math.floor(src.daily!.adCount as number)) : 0,
        },
        characters,
    };
    if ((src.schema ?? 0) < 5) profile.career.freeSigningUsed = Object.keys(characters).some(id => characters[id].level > 1);
    // Roll over the daily counter on a new day.
    if (profile.daily.date !== todayString()) {
        profile.daily.date = todayString();
        profile.daily.adCount = 0;
    }
    return profile;
}

function normalizeCareer(raw: Partial<CareerState> | undefined): CareerState {
    const c = createCareer();
    if (!raw || typeof raw !== 'object') return c;
    c.league = tierIndex(raw.league ?? 0);
    c.points = Math.max(0, Math.min(100, Math.floor(Number(raw.points) || 0)));
    c.serial = Math.max(0, Math.floor(Number(raw.serial) || 0));
    c.freeSigningUsed = raw.freeSigningUsed === true;
    c.firstPrizes = Array.isArray(raw.firstPrizes) ? [...new Set(raw.firstPrizes.filter(n => Number.isInteger(n) && n >= 0 && n <= 5))] : [];
    for (const id of Object.keys(createDefaultCharacterProgress())) {
        const cup = raw.cups?.[id];
        if (cup && typeof cup.id === 'string' && Number.isInteger(cup.tier) && cup.tier >= 0 && cup.tier <= 5
            && Number.isInteger(cup.round) && cup.round >= 0 && cup.round < cupRounds(cup.tier)
            && ['active', 'won', 'lost'].indexOf(cup.state) >= 0 && Number.isFinite(cup.seed)) {
            c.cups[id] = { ...cup, coins: Math.max(0, Number(cup.coins) || 0) };
        }
        const wins = raw.wins?.[id];
        if (Array.isArray(wins)) c.wins[id] = [...new Set(wins.filter(n => Number.isInteger(n) && n >= 0 && n <= 5))];
    }
    const quickRule = raw.quick?.rule === 'stimulant' ? 'stimulant' : raw.quick?.rule === 'wild' ? 'wild' : 'standard';
    c.quick = { distance: quickRule === 'stimulant' ? 200 : raw.quick?.distance === 400 ? 400 : 200, rule: quickRule };
    // 中断后从杯赛当前轮重新开赛；已结算回执仍保留，不能因重启重复发放。
    c.receipts = Array.isArray(raw.receipts) ? raw.receipts.filter(r => r && typeof r.id === 'string' && Number.isFinite(r.coinsGained)).slice(-32) : [];
    const p = raw.pending;
    if (p && typeof p.id === 'string' && ['quick', 'league', 'cup'].indexOf(p.source) >= 0
        && (p.distance === 200 || p.distance === 400)
        && (p.rule === 'standard' || p.rule === 'wild' || (p.rule === 'stimulant' && p.source === 'quick' && p.distance === 200))
        && Number.isInteger(p.tier) && p.tier >= 0 && p.tier <= 5 && p.ai && Number.isFinite(p.seed)) c.pending = p;
    return c;
}
