// Player progression profile - the account's persistent 养成 data. The single
// 金币用于日常升级；突破宝石用于跨过 5 级关卡，两者均为账号共享资源。
// Per-character progression is level-based (no XP - resources buy levels directly).
// Kept deliberately small; add fields over time and bump PLAYER_PROFILE_SCHEMA
// when the shape changes so old saves can migrate.

import {
    completedBreakthroughsForLevel,
    normalizeCharacterLevel,
    spentBreakthroughGemsForLevel,
} from '../progression/ProgressionBalance';
import { createCareer, CareerState, tierIndex, cupRounds } from '../progression/CareerRules';
import { defaultAvatarId, generateRandomNickName } from './IdentityConfig';
import {
    createDefaultPlayerCharacterSelection,
    normalizePlayerCharacterSelection,
    PLAYER_CHARACTER_DEFINITIONS,
    PlayerCharacterSelection,
} from '../app/PlayerCharacterConfig';

export const PLAYER_PROFILE_SCHEMA = 7;

// In-game resource display names (single source of truth for UI text).
export const CURRENCY = {
    coin: { id: 'coin', label: '金币' },
    breakthroughGem: { id: 'breakthrough-gem', label: '突破宝石' },
} as const;

// Tunable progression numbers shared by the client mock. The real WeChat Cloud
// function is authoritative and keeps its own copy of these (server can't trust
// client values); keep the two in sync when they matter.
export const PROGRESSION_CONFIG = {
    dailyFreeCoins: 100,
    dailyAdCoins: 200,
    dailyAdGems: 1,
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
    /** 已完成的突破次数；正常情况下与等级跨过的 5 级关卡一致。 */
    breakthroughCount: number;
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
    // 稀缺的账号共享突破资源。
    breakthroughGems: number;
    // 每日补给按北京时间 05:00 换日，三个奖励互相独立。
    dailyShop: {
        cycleKey: string;
        freeCoinsClaimed: boolean;
        adGemsClaimed: boolean;
        adCoinsClaimed: boolean;
    };
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

/** 北京时间 05:00 为日界线。传入时间戳便于规则测试。 */
export function dailyShopCycleKey(nowMs = Date.now()): string {
    // 北京 UTC+8，再向前平移 5 小时；等价于按 UTC+3 的自然日取键。
    const shifted = new Date(nowMs + 3 * 60 * 60 * 1000);
    return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function pad2(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
}

// Default character progress: every unlocked character starts at level 1.
export function createDefaultCharacterProgress(): Record<string, CharacterProgress> {
    const characters: Record<string, CharacterProgress> = {};
    for (const def of PLAYER_CHARACTER_DEFINITIONS) {
        if (def.unlocked) {
            characters[def.id] = { level: 1, breakthroughCount: 0, signed: false, signAds: 0, adTokens: [] };
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
        breakthroughGems: 0,
        dailyShop: {
            cycleKey: dailyShopCycleKey(),
            freeCoinsClaimed: false,
            adGemsClaimed: false,
            adCoinsClaimed: false,
        },
        daily: { date: todayString(), adCount: 0 },
        characters: createDefaultCharacterProgress(),
    };
}

// Clamp/validate a single character progress entry read from storage.
function normalizeCharacterProgress(raw: unknown, migrateBreakthroughs: boolean): CharacterProgress {
    const entry = raw as Partial<CharacterProgress> | null;
    const level = normalizeCharacterLevel(entry?.level);
    return {
        level,
        breakthroughCount: migrateBreakthroughs
            ? completedBreakthroughsForLevel(level)
            : Math.max(0, Math.min(5, Math.floor(Number(entry?.breakthroughCount) || 0))),
        signed: entry?.signed === true || level > 1,
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
    const sourceSchema = Number.isFinite(src.schema as number) ? Math.floor(src.schema as number) : 0;
    // Migrate characters: start from defaults (so newly-added characters appear),
    // then overlay any saved progress for known character ids (dropping legacy xp).
    const characters = createDefaultCharacterProgress();
    if (src.characters && typeof src.characters === 'object') {
        for (const id of Object.keys(src.characters)) {
            characters[id] = normalizeCharacterProgress(src.characters[id], sourceSchema < PLAYER_PROFILE_SCHEMA);
        }
    }
    // Coins: prefer the new `coins` field; fall back to legacy `swimCards` (1:1)
    // so pre-migration saves keep their ad-granted balance.
    const coinFromLegacy = Number.isFinite(src.swimCards as number) ? Math.max(0, Math.floor(src.swimCards as number)) : 0;
    const coins = Number.isFinite(src.coins as number)
        ? Math.max(0, Math.floor(src.coins as number))
        : coinFromLegacy;
    const career = normalizeCareer(src.career);
    let breakthroughGems = Number.isFinite(src.breakthroughGems as number)
        ? Math.max(0, Math.floor(src.breakthroughGems as number))
        : 0;
    if (sourceSchema < PLAYER_PROFILE_SCHEMA) {
        let entitlement = 0;
        for (const id of Object.keys(career.wins)) {
            for (const tier of career.wins[id]) entitlement += tier + 1;
        }
        let historicallySpent = 0;
        for (const id of Object.keys(characters)) historicallySpent += spentBreakthroughGemsForLevel(characters[id].level);
        breakthroughGems = Math.max(0, entitlement - historicallySpent);
    }
    const currentShopCycle = dailyShopCycleKey();
    const savedShop = src.dailyShop;
    const sameShopCycle = sourceSchema >= PLAYER_PROFILE_SCHEMA && savedShop?.cycleKey === currentShopCycle;
    const profile: PlayerProfile = {
        schema: PLAYER_PROFILE_SCHEMA,
        career,
        nickName: typeof src.nickName === 'string' && src.nickName.length > 0 ? src.nickName : base.nickName,
        avatarId: typeof src.avatarId === 'string' && src.avatarId.length > 0 ? src.avatarId : base.avatarId,
        characterSelection: normalizePlayerCharacterSelection(src.characterSelection),
        coins,
        breakthroughGems,
        dailyShop: {
            cycleKey: currentShopCycle,
            freeCoinsClaimed: sameShopCycle && savedShop?.freeCoinsClaimed === true,
            adGemsClaimed: sameShopCycle && savedShop?.adGemsClaimed === true,
            adCoinsClaimed: sameShopCycle && savedShop?.adCoinsClaimed === true,
        },
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
    const quickRule = raw.quick?.rule === 'entertainment' ? 'entertainment'
        : raw.quick?.rule === 'stimulant' ? 'stimulant'
        : raw.quick?.rule === 'shark' ? 'shark'
            : raw.quick?.rule === 'whirlpool' ? 'whirlpool'
                : raw.quick?.rule === 'cannon' || raw.quick?.rule === 'last-place' ? 'cannon'
                    : raw.quick?.rule === 'timed-bomb' || raw.quick?.rule === 'mine-relay' ? 'timed-bomb'
                        : raw.quick?.rule === 'minefield' ? 'minefield'
                        : raw.quick?.rule === 'wild' ? 'wild' : 'standard';
    c.quick = { distance: quickRule === 'standard' || quickRule === 'wild' ? (raw.quick?.distance === 400 ? 400 : 200) : 200, rule: quickRule };
    // 中断后从杯赛当前轮重新开赛；已结算回执仍保留，不能因重启重复发放。
    c.receipts = Array.isArray(raw.receipts) ? raw.receipts
        .filter(r => r && typeof r.id === 'string' && Number.isFinite(r.coinsGained))
        .slice(-32)
        .map(r => ({ ...r, breakthroughGemsGained: Math.max(0, Math.floor(Number(r.breakthroughGemsGained) || 0)) })) : [];
    const p = raw.pending;
    if (p && typeof p.id === 'string' && ['quick', 'league', 'cup'].indexOf(p.source) >= 0
        && (p.distance === 200 || p.distance === 400)
        && (p.rule === 'standard' || p.rule === 'wild' || ((p.rule === 'entertainment' || p.rule === 'stimulant' || p.rule === 'shark' || p.rule === 'whirlpool' || p.rule === 'cannon' || p.rule === 'timed-bomb' || p.rule === 'minefield' || p.rule === 'mine-relay' || p.rule === 'last-place') && p.source === 'quick' && p.distance === 200))
        && Number.isInteger(p.tier) && p.tier >= 0 && p.tier <= 5 && p.ai && Number.isFinite(p.seed)) {
        c.pending = p.rule === 'mine-relay' ? { ...p, rule: 'timed-bomb' } : p;
    }
    return c;
}
