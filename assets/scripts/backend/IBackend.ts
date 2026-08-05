// Backend abstraction - the ONLY contract gameplay/UI uses to read & change
// persistent 养成 data. Game code never calls wx.cloud / localStorage directly; it
// goes through PlayerData (which delegates to the active IBackend). Swapping the
// local mock for the WeChat Cloud backend later is a one-line change in
// BackendManager, with zero changes to callers.
//
// SECURITY: all resource changes (adding coins, spending coins to level) are done
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

export type SpendFailReason = 'insufficient' | 'maxed';

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

// Cosmetic identity fields the player chooses (nickname / avatar). Not anti-cheat
// sensitive, so the client may set them directly (backend just persists).
export interface IdentityPatch {
    nickName?: string;
    avatarId?: string;
}

export interface IBackend {
    readonly name: string;

    // Load (or first-time create) this account's profile.
    loadProfile(): Promise<PlayerProfile>;

    // Grant coins for a completed rewarded-ad view. Backend enforces the daily
    // cap and returns the authoritative profile. Never rejects - inspect result.ok.
    // NOTE: the ad path is dormant in v1 (the headbar "+" is a debug free-grant
    // via grantDebugCoins instead); this stays ready for when ads ship.
    grantAdReward(): Promise<AdRewardResult>;

    // DEBUG ONLY: add coins with no ad and no cap. Used by the headbar "+" button
    // while the rewarded-ad flow is deferred. MUST NOT exist in the production
    // cloud backend (or must be gated to dev accounts).
    grantDebugCoins(amount: number): Promise<PlayerProfile>;

    // Grant a variable coin bonus for a completed rewarded-ad view (e.g. the
    // post-race "watch ad for double coins" CTA). No daily cap by design - the
    // bonus amount is caller-supplied. Returns the authoritative profile.
    grantRewardedBonusCoins(amount: number): Promise<PlayerProfile>;

    // Spend coins to level a character. requestedLevels caps how many levels to
    // attempt (1 for single, maxLevel for "spend to max"); the backend spends as
    // many as the balance allows, validates, and returns the authoritative
    // profile + how many levels were gained + coins spent.
    spendCoinsForLevel(characterId: string, requestedLevels: number): Promise<LevelSpendResult>;

    // Persist the player-chosen identity (nickname / avatar). Returns the updated
    // profile.
    saveIdentity(identity: IdentityPatch): Promise<PlayerProfile>;

    // Persist the full profile (phase-2 progression writes). The backend returns
    // the authoritative stored profile. See the SECURITY note above: until
    // progression math moves server-side this is a client-driven write, not a
    // validated one.
    saveProfile(profile: PlayerProfile): Promise<PlayerProfile>;
}