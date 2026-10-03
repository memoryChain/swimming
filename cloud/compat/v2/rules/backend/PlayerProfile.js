"use strict";
// Player progression profile - the account's persistent 养成 data. The single
// currency is 金币 (coins): earned by racing, spent manually to level characters.
// Per-character progression is just a level (no XP - coins buy levels directly).
// Kept deliberately small; add fields over time and bump PLAYER_PROFILE_SCHEMA
// when the shape changes so old saves can migrate.
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateProfileAppearances = exports.normalizeProfile = exports.createDefaultProfile = exports.createDefaultCharacterProgress = exports.todayString = exports.PROGRESSION_CONFIG = exports.CURRENCY = exports.PLAYER_PROFILE_SCHEMA = void 0;
const ProgressionBalance_1 = require("../progression/ProgressionBalance");
const CareerRules_1 = require("../progression/CareerRules");
const IdentityConfig_1 = require("./IdentityConfig");
const PlayerCharacterConfig_1 = require("../app/PlayerCharacterConfig");
exports.PLAYER_PROFILE_SCHEMA = 7;
// In-game resource display names (single source of truth for UI text).
exports.CURRENCY = {
    coin: { id: 'coin', label: '金币' },
};
// Tunable progression numbers shared by the client mock. The real WeChat Cloud
// function is authoritative and keeps its own copy of these (server can't trust
// client values); keep the two in sync when they matter.
exports.PROGRESSION_CONFIG = {
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
};
function todayString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = pad2(now.getMonth() + 1);
    const d = pad2(now.getDate());
    return `${y}-${m}-${d}`;
}
exports.todayString = todayString;
function pad2(value) {
    return value < 10 ? `0${value}` : `${value}`;
}
// Default character progress: every unlocked character starts at level 1.
function createDefaultCharacterProgress() {
    const characters = {};
    for (const def of PlayerCharacterConfig_1.PLAYER_CHARACTER_DEFINITIONS) {
        if (def.unlocked) {
            characters[def.id] = { level: 1, signed: false, signAds: 0, adTokens: [] };
        }
    }
    return characters;
}
exports.createDefaultCharacterProgress = createDefaultCharacterProgress;
function createDefaultProfile() {
    return {
        schema: exports.PLAYER_PROFILE_SCHEMA,
        tutorialCompleted: false,
        career: (0, CareerRules_1.createCareer)(),
        nickName: (0, IdentityConfig_1.generateRandomNickName)(),
        avatarId: (0, IdentityConfig_1.defaultAvatarId)(),
        characterSelection: (0, PlayerCharacterConfig_1.createDefaultPlayerCharacterSelection)(),
        characterAppearances: (0, PlayerCharacterConfig_1.normalizePlayerCharacterAppearances)(undefined),
        coins: exports.PROGRESSION_CONFIG.starterCoins,
        daily: { date: todayString(), adCount: 0 },
        characters: createDefaultCharacterProgress(),
    };
}
exports.createDefaultProfile = createDefaultProfile;
// Clamp/validate a single character progress entry read from storage.
function normalizeCharacterProgress(raw) {
    const entry = raw;
    return {
        level: (0, ProgressionBalance_1.normalizeCharacterLevel)(entry?.level),
        signed: entry?.signed === true || (0, ProgressionBalance_1.normalizeCharacterLevel)(entry?.level) > 1,
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
function normalizeProfile(raw) {
    const base = createDefaultProfile();
    if (!raw || typeof raw !== 'object') {
        return base;
    }
    const src = raw;
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
    const coinFromLegacy = Number.isFinite(src.swimCards) ? Math.max(0, Math.floor(src.swimCards)) : 0;
    const coins = Number.isFinite(src.coins)
        ? Math.max(0, Math.floor(src.coins))
        : coinFromLegacy;
    const profile = {
        schema: exports.PLAYER_PROFILE_SCHEMA,
        tutorialCompleted: src.tutorialCompleted !== false,
        career: normalizeCareer(src.career),
        nickName: typeof src.nickName === 'string' && src.nickName.length > 0 ? src.nickName : base.nickName,
        avatarId: typeof src.avatarId === 'string' && src.avatarId.length > 0 ? src.avatarId : base.avatarId,
        characterSelection: (0, PlayerCharacterConfig_1.normalizePlayerCharacterSelection)(src.characterSelection),
        characterAppearances: (0, PlayerCharacterConfig_1.normalizePlayerCharacterAppearances)(src.characterAppearances, src.characterSelection),
        coins,
        daily: {
            date: typeof src.daily?.date === 'string' ? src.daily.date : base.daily.date,
            adCount: Number.isFinite(src.daily?.adCount) ? Math.max(0, Math.floor(src.daily.adCount)) : 0,
        },
        characters,
    };
    profile.characterSelection = { characterId: profile.characterSelection.characterId,
        ...profile.characterAppearances[profile.characterSelection.characterId] };
    if ((src.schema ?? 0) < 5)
        profile.career.freeSigningUsed = Object.keys(characters).some(id => characters[id].level > 1);
    // Roll over the daily counter on a new day.
    if (profile.daily.date !== todayString()) {
        profile.daily.date = todayString();
        profile.daily.adCount = 0;
    }
    return profile;
}
exports.normalizeProfile = normalizeProfile;
function normalizeCareer(raw) {
    const c = (0, CareerRules_1.createCareer)();
    if (!raw || typeof raw !== 'object')
        return c;
    c.league = (0, CareerRules_1.tierIndex)(raw.league ?? 0);
    c.points = Math.max(0, Math.min(100, Math.floor(Number(raw.points) || 0)));
    c.serial = Math.max(0, Math.floor(Number(raw.serial) || 0));
    c.freeSigningUsed = raw.freeSigningUsed === true;
    c.firstPrizes = Array.isArray(raw.firstPrizes) ? [...new Set(raw.firstPrizes.filter(n => Number.isInteger(n) && n >= 0 && n <= 5))] : [];
    for (const id of Object.keys(createDefaultCharacterProgress())) {
        const cup = raw.cups?.[id];
        if (cup && typeof cup.id === 'string' && Number.isInteger(cup.tier) && cup.tier >= 0 && cup.tier <= 5
            && Number.isInteger(cup.round) && cup.round >= 0 && cup.round < (0, CareerRules_1.cupRounds)(cup.tier)
            && ['active', 'won', 'lost'].indexOf(cup.state) >= 0 && Number.isFinite(cup.seed)) {
            c.cups[id] = { ...cup, coins: Math.max(0, Number(cup.coins) || 0) };
        }
        const wins = raw.wins?.[id];
        if (Array.isArray(wins))
            c.wins[id] = [...new Set(wins.filter(n => Number.isInteger(n) && n >= 0 && n <= 5))];
    }
    c.quick = { distance: raw.quick?.distance === 400 ? 400 : 200, rule: raw.quick?.rule === 'wild' ? 'wild' : 'standard' };
    // 中断后从杯赛当前轮重新开赛；已结算回执仍保留，不能因重启重复发放。
    c.receipts = Array.isArray(raw.receipts) ? raw.receipts.filter(r => r && typeof r.id === 'string' && Number.isFinite(r.coinsGained)).slice(-32) : [];
    const p = raw.pending;
    if (p && typeof p.id === 'string' && ['quick', 'league', 'cup'].indexOf(p.source) >= 0
        && (p.distance === 200 || p.distance === 400) && (p.rule === 'standard' || p.rule === 'wild')
        && Number.isInteger(p.tier) && p.tier >= 0 && p.tier <= 5 && p.ai && Number.isFinite(p.seed))
        c.pending = p;
    return c;
}
/** 云端定向迁移：不规范化金币、生涯、赛事凭据或已有角色等级。 */
function migrateProfileAppearances(profile) {
    let changed = false;
    // 旧账号免教学；新建账号显式保存 false，完成后只允许变为 true。
    if (typeof profile.tutorialCompleted !== 'boolean') {
        profile.tutorialCompleted = true;
        changed = true;
    }
    if (profile.schema === 6) {
        profile.characterAppearances = (0, PlayerCharacterConfig_1.normalizePlayerCharacterAppearances)(undefined, profile.characterSelection);
        const selected = (0, PlayerCharacterConfig_1.normalizePlayerCharacterSelection)(profile.characterSelection).characterId;
        profile.characterSelection = { characterId: selected, ...profile.characterAppearances[selected] };
        profile.schema = exports.PLAYER_PROFILE_SCHEMA;
        changed = true;
    }
    if (profile.schema !== exports.PLAYER_PROFILE_SCHEMA)
        return changed;
    const defaults = createDefaultCharacterProgress();
    for (const id of Object.keys(defaults)) {
        if (!Object.prototype.hasOwnProperty.call(profile.characters, id)) {
            profile.characters[id] = defaults[id];
            changed = true;
        }
        if (!Object.prototype.hasOwnProperty.call(profile.characterAppearances, id)) {
            profile.characterAppearances[id] = { skinToneId: 'warm', colorSchemeId: PlayerCharacterConfig_1.PLAYER_COLOR_SCHEMES[0].id };
            changed = true;
        }
    }
    return changed;
}
exports.migrateProfileAppearances = migrateProfileAppearances;
