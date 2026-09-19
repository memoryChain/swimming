// Backend abstraction - the ONLY contract gameplay/UI uses to read & change
// persistent 养成 data. Game code never calls wx.cloud / localStorage directly; it
// goes through PlayerData (which delegates to the active IBackend). Swapping the
// local mock for the WeChat Cloud backend later is a one-line change in
// BackendManager, with zero changes to callers.
//
// SECURITY: all resource changes (adding resources, upgrading and breakthroughs) are done
// BY the backend, not by the caller. The caller only expresses intent ("I watched
// an ad", "spend coins to level up"); the backend (a cloud function in production)
// validates caps/balances and returns the authoritative new profile. The client
// never sets balances directly.
//
// NOTE on progression: awardRace coin math currently runs on the client
// (ProgressionManager) and is persisted via saveProfile. This is NOT anti-cheat
// safe. When the WeChat Cloud backend lands, move the coin math into a dedicated
// backend method that validates the race result and returns the authoritative
// profile, mirroring grantAdReward / spendCoinsForLevel's pattern. Until then
// saveProfile is the persistence hook; callers must not use it to bypass caps.

import { PlayerProfile } from './PlayerProfile';
import type { CareerCommand, CareerResult } from '../progression/CareerRules';

export type DebugCurrencyId = 'coins' | 'breakthroughGems';

export type AdRewardReason = 'capped' | 'error';

export interface AdRewardResult {
    // True when coins were actually granted this call.
    ok: boolean;
    // Authoritative profile after the call (unchanged on failure).
    profile: PlayerProfile;
    // Coins granted this call (0 when capped/failed).
    granted: number;
    // Why it didn't grant, when ok is false.
    reason?: AdRewardReason;
}

export type SpendFailReason = 'insufficient' | 'maxed' | 'breakthrough_required';

export interface LevelSpendResult {
    // True when at least one level was gained.
    ok: boolean;
    // Authoritative profile after the call (unchanged on failure).
    profile: PlayerProfile;
    // Number of levels actually gained (0 when nothing could be spent).
    levelsGained: number;
    // Coins actually spent (0 when nothing could be spent).
    coinsSpent: number;
    // Why nothing was spent, when ok is false.
    reason?: SpendFailReason;
}

export type DailyShopRewardSlot = 'free_coins' | 'ad_gems' | 'ad_coins';
export type DailyShopClaimReason = 'claimed' | 'ad_incomplete' | 'error';

export interface DailyShopClaimResult {
    ok: boolean;
    profile: PlayerProfile;
    slot: DailyShopRewardSlot;
    grantedCoins: number;
    grantedGems: number;
    reason?: DailyShopClaimReason;
}

export type BreakthroughFailReason = 'invalid_level' | 'insufficient_coins' | 'insufficient_gems' | 'maxed';

export interface BreakthroughResult {
    ok: boolean;
    profile: PlayerProfile;
    coinsSpent: number;
    gemsSpent: number;
    reason?: BreakthroughFailReason;
}

// Cosmetic identity fields the player chooses (nickname / avatar). Not anti-cheat
// sensitive, so the client may set them directly (backend just persists).
export interface IdentityPatch {
    nickName?: string;
    avatarId?: string;
}

export interface IBackend {
    readonly name: string;
    executeCareer(command: CareerCommand): Promise<CareerResult>;

    // Load (or first-time create) this account's profile.
    loadProfile(): Promise<PlayerProfile>;

    // Grant coins for a completed rewarded-ad view. Backend enforces the daily
    // cap and returns the authoritative profile. Never rejects - inspect result.ok.
    // NOTE: the ad path is dormant in v1; this stays ready for when ads ship.
    grantAdReward(): Promise<AdRewardResult>;

    // 领取每日补给。正式后台必须校验广告凭证与 transactionId，并原子写入。
    claimDailyShopReward(slot: DailyShopRewardSlot, adCompleted: boolean, transactionId: string): Promise<DailyShopClaimResult>;

    // DEBUG ONLY: adjust a local test balance with no ad or cap. A production
    // backend must omit this capability or gate it to authenticated dev accounts.
    adjustDebugCurrency(currency: DebugCurrencyId, delta: number): Promise<PlayerProfile>;

    // Spend coins to level a character. requestedLevels caps how many levels to
    // attempt (1 for single, maxLevel for "spend to max"); the backend spends as
    // many as the balance allows, validates, and returns the authoritative
    // profile + how many levels were gained + coins spent.
    spendCoinsForLevel(characterId: string, requestedLevels: number): Promise<LevelSpendResult>;

    // 突破关卡单独结算，金币、宝石和等级必须在一次事务中同时变更。
    breakthroughCharacter(characterId: string, expectedLevel: number): Promise<BreakthroughResult>;

    // Persist the player-chosen identity (nickname / avatar). Returns the updated
    // profile.
    saveIdentity(identity: IdentityPatch): Promise<PlayerProfile>;

    // Persist the full profile (phase-2 progression writes). The backend returns
    // the authoritative stored profile. See the SECURITY note above: until
    // progression math moves server-side this is a client-driven write, not a
    // validated one.
    saveProfile(profile: PlayerProfile): Promise<PlayerProfile>;
}
