// PlayerData — the single in-memory entry point for 养成 data. UI reads PlayerData.
// swimCards and subscribes to onChange() to refresh; gameplay calls its methods to
// mutate. It delegates persistence to the active backend (mock now, WeChat Cloud
// later) and notifies listeners whenever the profile changes.

import { backend } from './BackendManager';
import { AdRewardResult } from './IBackend';
import { generateRandomNickName } from './IdentityConfig';
import { createDefaultProfile, PlayerProfile } from './PlayerProfile';

type ChangeListener = (profile: PlayerProfile) => void;

class PlayerDataStore {
    private _profile: PlayerProfile = createDefaultProfile();
    private _loaded = false;
    private _loading: Promise<PlayerProfile> | null = null;
    private _listeners: ChangeListener[] = [];

    get profile(): PlayerProfile {
        return this._profile;
    }

    get swimCards(): number {
        return this._profile.swimCards;
    }

    get nickName(): string {
        return this._profile.nickName;
    }

    get avatarId(): string {
        return this._profile.avatarId;
    }

    get loaded(): boolean {
        return this._loaded;
    }

    // Load the profile from the backend (idempotent: concurrent callers share one
    // request). Never rejects — keeps defaults on failure so the UI still works.
    load(): Promise<PlayerProfile> {
        if (this._loaded) {
            return Promise.resolve(this._profile);
        }
        if (this._loading) {
            return this._loading;
        }
        this._loading = backend()
            .loadProfile()
            .then((profile) => {
                this._loading = null;
                this._loaded = true;
                this._profile = profile;
                this._emit();
                return profile;
            })
            .catch((error) => {
                this._loading = null;
                console.warn('[PlayerData] load failed, keeping defaults', error);
                return this._profile;
            });
        return this._loading;
    }

    // Watched-ad reward: the backend validates the daily cap and returns the
    // authoritative profile. Updates local state and notifies listeners.
    async grantAdReward(): Promise<AdRewardResult> {
        const result = await backend().grantAdReward();
        this._profile = result.profile;
        this._emit();
        return result;
    }

    // Change the chosen avatar; persists and notifies listeners.
    async setAvatar(avatarId: string): Promise<void> {
        this._profile = await backend().saveIdentity({ avatarId });
        this._emit();
    }

    // Generate + persist a fresh random nickname; notifies listeners.
    async rerollNickName(): Promise<void> {
        this._profile = await backend().saveIdentity({ nickName: generateRandomNickName() });
        this._emit();
    }

    onChange(listener: ChangeListener): void {
        if (this._listeners.indexOf(listener) < 0) {
            this._listeners.push(listener);
        }
    }

    offChange(listener: ChangeListener): void {
        const i = this._listeners.indexOf(listener);
        if (i >= 0) {
            this._listeners.splice(i, 1);
        }
    }

    private _emit(): void {
        for (const listener of this._listeners.slice()) {
            try {
                listener(this._profile);
            } catch (error) {
                console.warn('[PlayerData] listener error', error);
            }
        }
    }
}

export const PlayerData = new PlayerDataStore();
