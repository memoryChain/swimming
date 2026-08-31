// Local mock backend: persists the profile in sys.localStorage. Used in the editor,
// browser, and as the phase-1 stand-in before the WeChat Cloud backend exists.
// It plays the role the cloud function will later play (validate caps, mutate,
// return authoritative profile) so callers won't change when we swap it out.
//
// NOTE: this is NOT anti-cheat safe (local storage is editable). That's fine for a
// local mock; the production WeChat Cloud backend is the authoritative one.

import { sys } from 'cc';
import {
    AdRewardResult,
    IBackend,
    IdentityPatch,
    LevelSpendResult,
    RaceDoubleRewardResult,
    writeJsonOrThrow,
} from './IBackend';
import {
    createDefaultProfile,
    normalizeProfile,
    PlayerProfile,
    PROGRESSION_CONFIG,
    todayString,
} from './PlayerProfile';
import { PROGRESSION_BALANCE, coinCostForLevel } from '../progression/ProgressionBalance';

const STORAGE_KEY = 'swimming.player-profile';

export class MockBackend implements IBackend {
    readonly name = 'mock';

    loadProfile(): Promise<PlayerProfile> {
        return Promise.resolve(this.read());
    }

    async grantAdReward(): Promise<AdRewardResult> {
        const profile = this.read();
        if (profile.daily.date !== todayString()) {
            profile.daily.date = todayString();
            profile.daily.adCount = 0;
        }
        if (profile.daily.adCount >= PROGRESSION_CONFIG.dailyAdCap) {
            return { ok: false, profile, granted: 0, reason: 'capped' };
        }
        const granted = PROGRESSION_CONFIG.adRewardCoins;
        profile.coins += granted;
        profile.daily.adCount += 1;
        this.write(profile);
        return { ok: true, profile, granted };
    }

    // DEBUG ONLY: no ad, no cap. See IBackend.grantDebugCoins.
    async grantDebugCoins(amount: number): Promise<PlayerProfile> {
        const profile = this.read();
        profile.coins += Math.max(0, Math.floor(amount));
        this.write(profile);
        return profile;
    }

    async claimRaceDoubleReward(settlementId: string): Promise<RaceDoubleRewardResult> {
        const profile = this.read();
        const claim = profile.raceRewardClaims[settlementId];
        if (!claim) {
            return {
                ok: false,
                profile,
                granted: 0,
                alreadyClaimed: false,
                reason: 'not-found',
            };
        }
        if (claim.doubleClaimed) {
            return {
                ok: true,
                profile,
                granted: 0,
                alreadyClaimed: true,
            };
        }
        claim.doubleClaimed = true;
        profile.coins += claim.baseCoins;
        this.write(profile);
        return {
            ok: true,
            profile,
            granted: claim.baseCoins,
            alreadyClaimed: false,
        };
    }

    async spendCoinsForLevel(characterId: string, requestedLevels: number): Promise<LevelSpendResult> {
        const profile = this.read();
        const progress = profile.characters[characterId];
        if (!progress) {
            return { ok: false, profile, levelsGained: 0, coinsSpent: 0, reason: 'maxed' };
        }
        if (progress.level >= PROGRESSION_BALANCE.maxLevel) {
            return { ok: false, profile, levelsGained: 0, coinsSpent: 0, reason: 'maxed' };
        }
        let levelsGained = 0;
        let coinsSpent = 0;
        let remaining = Math.max(0, Math.floor(requestedLevels));
        while (remaining > 0 && progress.level < PROGRESSION_BALANCE.maxLevel) {
            const cost = coinCostForLevel(progress.level);
            if (profile.coins < cost) {
                break;
            }
            profile.coins -= cost;
            coinsSpent += cost;
            progress.level += 1;
            levelsGained += 1;
            remaining -= 1;
        }
        if (levelsGained === 0) {
            return { ok: false, profile, levelsGained: 0, coinsSpent: 0, reason: 'insufficient' };
        }
        this.write(profile);
        return { ok: true, profile, levelsGained, coinsSpent };
    }

    async saveIdentity(identity: IdentityPatch): Promise<PlayerProfile> {
        const profile = this.read();
        if (typeof identity.nickName === 'string' && identity.nickName.length > 0) {
            profile.nickName = identity.nickName;
        }
        if (typeof identity.avatarId === 'string' && identity.avatarId.length > 0) {
            profile.avatarId = identity.avatarId;
        }
        this.write(profile);
        return profile;
    }

    // Phase-2 progression writes come through here. The mock just persists what the
    // client computed; the future cloud function will validate and return the
    // authoritative profile instead.
    async saveProfile(profile: PlayerProfile): Promise<PlayerProfile> {
        this.write(profile);
        return profile;
    }

    private read(): PlayerProfile {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                // Persist the freshly generated default so the random identity stays
                // stable across launches.
                const created = createDefaultProfile();
                this.write(created);
                return created;
            }
            return normalizeProfile(JSON.parse(raw));
        } catch (error) {
            console.warn('[Backend] mock read failed, using default', error);
            return createDefaultProfile();
        }
    }

    private write(profile: PlayerProfile): void {
        try {
            writeJsonOrThrow(sys.localStorage, STORAGE_KEY, profile);
        } catch (error) {
            console.warn('[Backend] mock write failed', error);
            throw error;
        }
    }
}
