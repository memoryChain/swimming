// Backend abstraction - the ONLY contract gameplay/UI uses to read & change
// persistent 养成 data. Game code never calls wx.cloud / localStorage directly; it
// goes through PlayerData (which delegates to the active IBackend). Swapping the
// local mock for the WeChat Cloud backend later is a one-line change in
// BackendManager, with zero changes to callers.
//
// SECURITY: all resource changes (adding swim cards) are done BY the backend, not
// by the caller. The caller only expresses intent ("I watched an ad"); the backend
// (a cloud function in production) validates caps and returns the authoritative new
// profile. The client never sets balances directly.
//
// NOTE on progression (phase 2): awardRace XP/level math currently runs on the
// client (ProgressionManager) and is persisted via saveProfile. This is NOT
// anti-cheat safe. When the WeChat Cloud backend lands, move the XP math into a
// dedicated backend method that validates the race result and returns the
// authoritative profile, mirroring grantAdReward's pattern. Until then saveProfile
// is the persistence hook; callers must not use it to bypass caps.

import { PlayerProfile } from './PlayerProfile';

export type AdRewardReason = 'capped' | 'error';

export interface AdRewardResult {
    // True when swim cards were actually granted this call.
    ok: boolean;
    // Authoritative profile after the call (unchanged on failure).
    profile: PlayerProfile;
    // Swim cards granted this call (0 when capped/failed).
    granted: number;
    // Why it didn't grant, when ok is false.
    reason?: AdRewardReason;
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

    // Grant swim cards for a completed rewarded-ad view. Backend enforces the daily
    // cap and returns the authoritative profile. Never rejects - inspect result.ok.
    grantAdReward(): Promise<AdRewardResult>;

    // Persist the player-chosen identity (nickname / avatar). Returns the updated
    // profile.
    saveIdentity(identity: IdentityPatch): Promise<PlayerProfile>;

    // Persist the full profile (phase-2 progression writes). The backend returns
    // the authoritative stored profile. See the SECURITY note above: until
    // progression math moves server-side this is a client-driven write, not a
    // validated one.
    saveProfile(profile: PlayerProfile): Promise<PlayerProfile>;
}