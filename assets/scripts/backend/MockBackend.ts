// Local mock backend: persists the profile in sys.localStorage. Used in the editor,
// browser, and as the phase-1 stand-in before the WeChat Cloud backend exists.
// It plays the role the cloud function will later play (validate caps, mutate,
// return authoritative profile) so callers won't change when we swap it out.
//
// NOTE: this is NOT anti-cheat safe (local storage is editable). That's fine for a
// local mock; the production WeChat Cloud backend is the authoritative one.

import { sys } from 'cc';
import { AdRewardResult, IBackend } from './IBackend';
import {
    createDefaultProfile,
    normalizeProfile,
    PlayerProfile,
    PROGRESSION_CONFIG,
    todayString,
} from './PlayerProfile';

const STORAGE_KEY = 'swimming.player-profile';

export class MockBackend implements IBackend {
    readonly name = 'mock';

    loadProfile(): Promise<PlayerProfile> {
        return Promise.resolve(this.read());
    }

    grantAdReward(): Promise<AdRewardResult> {
        const profile = this.read();
        if (profile.daily.date !== todayString()) {
            profile.daily.date = todayString();
            profile.daily.adCount = 0;
        }
        if (profile.daily.adCount >= PROGRESSION_CONFIG.dailyAdCap) {
            return Promise.resolve({ ok: false, profile, granted: 0, reason: 'capped' });
        }
        const granted = PROGRESSION_CONFIG.adRewardSwimCards;
        profile.swimCards += granted;
        profile.daily.adCount += 1;
        this.write(profile);
        return Promise.resolve({ ok: true, profile, granted });
    }

    private read(): PlayerProfile {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return createDefaultProfile();
            }
            return normalizeProfile(JSON.parse(raw));
        } catch (error) {
            console.warn('[Backend] mock read failed, using default', error);
            return createDefaultProfile();
        }
    }

    private write(profile: PlayerProfile): void {
        try {
            sys.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
        } catch (error) {
            console.warn('[Backend] mock write failed', error);
        }
    }
}
