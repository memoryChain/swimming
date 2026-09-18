// PlayerData - the single in-memory entry point for 养成 data. UI reads PlayerData
// coins and subscribes to onChange() to refresh; gameplay calls its methods to
// mutate. It delegates persistence to the active backend (mock now, WeChat Cloud
// later) and notifies listeners whenever the profile changes.

import { backend } from './BackendManager';
import type { CareerCommand, CareerResult } from '../progression/CareerRules';
import {
    AdRewardResult,
    DailyShopClaimResult,
    DailyShopRewardSlot,
    IdentityPatch,
} from './IBackend';
import { generateRandomNickName } from './IdentityConfig';
import { createDefaultProfile, PlayerProfile } from './PlayerProfile';
import type { SpendResult } from '../progression/ProgressionManager';
import {
    normalizePlayerCharacterSelection,
    PlayerCharacterSelection,
    restorePlayerCharacterSelection,
} from '../app/PlayerCharacterConfig';

type ChangeListener = (profile: PlayerProfile) => void;

class PlayerDataStore {
    private _profile: PlayerProfile = createDefaultProfile();
    private _loaded = false;
    private _loading: Promise<PlayerProfile> | null = null;
    private _listeners: ChangeListener[] = [];
    private _careerQueue: Promise<unknown> = Promise.resolve();
    private _pendingSettlement: CareerCommand | null = null;

    private enqueue<T>(action: () => Promise<T>, retrySettlement = true): Promise<T> {
        const next = this._careerQueue.then(async () => {
            await this.load();
            if (!this._loaded) throw new Error('存档尚未加载');
            if (this._pendingSettlement && retrySettlement) {
                const retry = await backend().executeCareer(this._pendingSettlement);
                if (!retry.ok) throw new Error(retry.message);
                this._profile = retry.profile;
                this._pendingSettlement = null;
            }
            return action();
        });
        this._careerQueue = next.catch(() => undefined);
        return next;
    }

    executeCareer(command: CareerCommand): Promise<CareerResult> {
        return this.enqueue(async () => {
            if (command.type === 'settle') this._pendingSettlement = command;
            const result = await backend().executeCareer(command);
            if (command.type === 'settle') this._pendingSettlement = null;
            this._profile = result.profile;
            this._emit();
            return result;
        }, command.type !== 'settle');
    }

    get profile(): PlayerProfile {
        return this._profile;
    }

    get coins(): number {
        return this._profile.coins;
    }

    get breakthroughGems(): number {
        return this._profile.breakthroughGems;
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
    // request). Never rejects - keeps defaults on failure so the UI still works.
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
                restorePlayerCharacterSelection(profile.characterSelection);
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
        return this.enqueue(async () => {
            const result = await backend().grantAdReward();
            this._profile = result.profile;
            this._emit();
            return result;
        });
    }

    /** 重新读取后台权威存档；用于每日 05:00 换日，不影响首次加载去重。 */
    refreshProfile(): Promise<PlayerProfile> {
        return this.enqueue(async () => {
            this._profile = await backend().loadProfile();
            this._emit();
            return this._profile;
        });
    }

    async claimDailyShopReward(
        slot: DailyShopRewardSlot,
        adCompleted: boolean,
        transactionId: string,
    ): Promise<DailyShopClaimResult> {
        return this.enqueue(async () => {
            const result = await backend().claimDailyShopReward(slot, adCompleted, transactionId);
            this._profile = result.profile;
            this._emit();
            return result;
        });
    }

    // DEBUG ONLY: add coins with no ad and no cap (headbar "+" button while ads
    // are deferred). Updates local state and notifies listeners.
    async grantDebugCoins(amount: number): Promise<void> {
        return this.enqueue(async () => {
            this._profile = await backend().grantDebugCoins(amount);
            this._emit();
        });
    }

    // Spend coins to level a character. Delegates to the backend (validates
    // balance, returns authoritative profile) and maps the raw result into the
    // SpendResult shape the progression/UI layer expects.
    async spendCoinsForLevel(characterId: string, requestedLevels: number): Promise<SpendResult> {
        return this.enqueue(async () => {
            const result = await backend().spendCoinsForLevel(characterId, requestedLevels);
            this._profile = result.profile;
            this._emit();
            return {
                characterId,
                levelsGained: result.levelsGained,
                coinsSpent: result.coinsSpent,
                gemsSpent: 0,
                reason: result.ok ? undefined : result.reason,
            };
        });
    }

    async breakthroughCharacter(characterId: string, expectedLevel: number): Promise<SpendResult> {
        return this.enqueue(async () => {
            const result = await backend().breakthroughCharacter(characterId, expectedLevel);
            this._profile = result.profile;
            this._emit();
            return {
                characterId,
                levelsGained: result.ok ? 1 : 0,
                coinsSpent: result.coinsSpent,
                gemsSpent: result.gemsSpent,
                reason: result.ok ? undefined : result.reason,
            };
        });
    }

    // Change the chosen avatar; persists and notifies listeners.
    async setAvatar(avatarId: string): Promise<void> {
        await this.setIdentity({ avatarId });
    }

    // Generate + persist a fresh random nickname; notifies listeners.
    async rerollNickName(): Promise<void> {
        await this.setIdentity({ nickName: generateRandomNickName() });
    }

    // Save avatar and nickname together so a confirmation dialog emits one coherent
    // profile change instead of exposing a half-applied identity to room listeners.
    async setIdentity(identity: IdentityPatch): Promise<void> {
        return this.enqueue(async () => {
            this._profile = await backend().saveIdentity(identity);
            this._emit();
        });
    }

    // Persist the last confirmed playable character and appearance. Loading first
    // prevents a fast early click from overwriting other fields with defaults.
    async setCharacterSelection(selection: Readonly<PlayerCharacterSelection>): Promise<void> {
        const requested = normalizePlayerCharacterSelection(selection);
        return this.enqueue(async () => {
            const current = this._profile.characterSelection;
            if (current.characterId === requested.characterId && current.skinToneId === requested.skinToneId
                && current.colorSchemeId === requested.colorSchemeId) {
                restorePlayerCharacterSelection(current);
                return;
            }
            this._profile = await backend().saveProfile({ ...this._profile, characterSelection: requested });
            restorePlayerCharacterSelection(this._profile.characterSelection);
            this._emit();
        });
    }

    // Persist the current in-memory profile (phase-2 progression writes). Delegates
    // to the backend and notifies listeners with the authoritative result. Safe to
    // call after mutating this.profile in place (e.g. progression coin updates).
    async persist(): Promise<PlayerProfile> {
        return this.enqueue(async () => {
            this._profile = await backend().saveProfile(this._profile);
            this._emit();
            return this._profile;
        });
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
