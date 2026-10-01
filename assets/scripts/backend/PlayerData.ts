// PlayerData - the single in-memory entry point for 养成 data. UI reads PlayerData
// coins and subscribes to onChange() to refresh; gameplay calls its methods to
// mutate. It delegates persistence to the active backend (mock now, WeChat Cloud
// later) and notifies listeners whenever the profile changes.

import { backend } from './BackendManager';
import type { CareerCommand, CareerResult } from '../progression/CareerRules';
import { AdRewardResult, IdentityPatch } from './IBackend';
import { generateRandomNickName } from './IdentityConfig';
import { createDefaultProfile, PlayerProfile } from './PlayerProfile';
import type { SpendResult } from '../progression/ProgressionManager';
import {
    normalizePlayerCharacterSelection,
    PlayerCharacterSelection,
    restorePlayerCharacterSelection,
    setPlayerSkinTone,
    setPlayerColorScheme,
} from '../app/PlayerCharacterConfig';

type ChangeListener = (profile: PlayerProfile) => void;

class PlayerDataStore {
    private _profile: PlayerProfile = createDefaultProfile();
    private _loaded = false;
    private _loading: Promise<PlayerProfile> | null = null;
    private _listeners: ChangeListener[] = [];
    private _careerQueue: Promise<unknown> = Promise.resolve();
    private _pendingSettlement: CareerCommand | null = null;
    private readonly _appearanceDrafts = new Map<string, PlayerCharacterSelection>();
    private _appearanceQueue: Promise<void> = Promise.resolve();

    stageCharacterAppearance(appearance: Readonly<PlayerCharacterSelection>): void {
        const requested = normalizePlayerCharacterSelection(appearance);
        this._appearanceDrafts.set(requested.characterId, requested);
    }

    /** 每次提交只处理这一刻的最终选择，等待期间已被新选择替代的项直接跳过。 */
    flushCharacterAppearances(): Promise<void> {
        const batch = [...this._appearanceDrafts.values()];
        const next = this._appearanceQueue.then(async () => {
            for (const requested of batch) {
                if (this._appearanceDrafts.get(requested.characterId) !== requested) continue;
                await this.setCharacterAppearance(requested);
                if (this._appearanceDrafts.get(requested.characterId) === requested) {
                    this._appearanceDrafts.delete(requested.characterId);
                }
            }
        });
        this._appearanceQueue = next.catch(() => undefined);
        return next;
    }

    private restoreCharacterAppearances(): void {
        restorePlayerCharacterSelection(this._profile.characterSelection, this._profile.characterAppearances);
        // 请求返回和档案刷新不能盖掉玩家在等待期间继续试选的颜色。
        for (const draft of this._appearanceDrafts.values()) {
            setPlayerSkinTone(draft.skinToneId, draft.characterId);
            setPlayerColorScheme(draft.colorSchemeId, draft.characterId);
        }
    }

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
            try { return await action(); }
            catch (error) {
                if (this.usesCloud) {
                    // 不确定提交由云端持久化请求恢复；不与内存结算队列重复重试。
                    this._pendingSettlement = null;
                    this._loaded = false;
                }
                throw error;
            }
        });
        this._careerQueue = next.catch(() => undefined);
        return next;
    }

    executeCareer(command: CareerCommand): Promise<CareerResult> {
        return this.enqueue(async () => {
            if (command.type === 'settle' && !this.usesCloud) this._pendingSettlement = command;
            const result = await backend().executeCareer(command);
            if (command.type === 'settle') this._pendingSettlement = null;
            this._profile = result.profile;
            this._emit();
            return result;
        }, command.type !== 'settle');
    }

    completeTutorial(): Promise<void> {
        if (this.usesCloud) {
            // 教学标记先存本地，不排在网络/结算队列后面；也不盖掉并发业务的其它字段。
            return backend().completeTutorial().then(profile => {
                this._profile = { ...this._profile, tutorialCompleted: profile.tutorialCompleted };
                this._emit();
            });
        }
        return this.enqueue(async () => {
            this._profile = await backend().completeTutorial();
            if (this._profile.tutorialCompleted !== true) throw new Error('教学进度未保存');
            this._emit();
        });
    }

    resetTutorialForLocalTesting(): Promise<void> {
        if (backend().name !== 'mock') return Promise.reject(new Error('仅本地预览可重置教学'));
        return this.enqueue(async () => {
            const current = await backend().loadProfile();
            this._profile = await backend().saveProfile({ ...current, tutorialCompleted: false });
            this._emit();
        }, false);
    }

    get profile(): PlayerProfile {
        return this._profile;
    }

    get coins(): number {
        return this._profile.coins;
    }

    get uid(): number | null { return this._loaded ? backend().uid ?? null : null; }

    get nickName(): string {
        return this._profile.nickName;
    }

    get avatarId(): string {
        return this._profile.avatarId;
    }

    get loaded(): boolean {
        return this._loaded;
    }

    get tutorialEnabled(): boolean { return backend().tutorialEnabled ?? true; }

    /** 全局开关不修改账号完成状态，所有大厅入口共用此判断。 */
    get tutorialRequired(): boolean {
        return this._loaded && this.tutorialEnabled && !this._profile.tutorialCompleted;
    }

    // Load the profile from the backend (idempotent: concurrent callers share one
    // request). Never rejects - keeps defaults on failure so the UI still works.
    get usesCloud(): boolean { return backend().name === 'wechat-cloud'; }

    // 导航使用当前已确认档案；等待在途写入，不重复向云端读取同一份数据。
    async loadForNavigation(): Promise<PlayerProfile> {
        await this.flushCharacterAppearances();
        await this._careerQueue;
        return this.load();
    }

    load(refresh = false): Promise<PlayerProfile> {
        if (refresh && this._loaded && this.usesCloud) {
            const next = this._careerQueue.then(async () => {
                const profile = await backend().loadProfile();
                this._loaded = true;
                this._profile = profile;
                this.restoreCharacterAppearances();
                this._emit();
                return profile;
            }).catch(error => {
                this._loaded = false;
                console.warn('[PlayerData] refresh failed', error);
                return this._profile;
            });
            this._careerQueue = next;
            return next;
        }
        if (this._loaded) {
            void backend().syncTutorialCompletion?.();
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
                this.restoreCharacterAppearances();
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

    /** 保存单个角色外观；不会把正在试穿的角色设为出场角色。 */
    async setCharacterAppearance(appearance: Readonly<PlayerCharacterSelection>): Promise<void> {
        const requested = normalizePlayerCharacterSelection(appearance);
        try {
            await this.enqueue(async () => {
                const current = this._profile.characterAppearances[requested.characterId];
                if (current?.skinToneId !== requested.skinToneId || current?.colorSchemeId !== requested.colorSchemeId) {
                    this._profile = await backend().saveCharacterAppearance(requested);
                }
                this.restoreCharacterAppearances();
                this._emit();
            });
        } catch (error) {
            // 恢复确认档并叠加待保存草稿；未知提交仍由云 outbox 恢复。
            this.restoreCharacterAppearances();
            this._emit();
            throw error;
        }
    }

    // Persist the last confirmed playable character and appearance. Loading first
    // prevents a fast early click from overwriting other fields with defaults.
    async setCharacterSelection(selection: Readonly<PlayerCharacterSelection>): Promise<void> {
        const requested = normalizePlayerCharacterSelection(selection);
        try {
            await this.enqueue(async () => {
                const current = this._profile.characterSelection;
                if (current.characterId === requested.characterId && current.skinToneId === requested.skinToneId
                    && current.colorSchemeId === requested.colorSchemeId) {
                    this.restoreCharacterAppearances();
                    return;
                }
                this._profile = await backend().saveCharacterSelection(requested);
                this.restoreCharacterAppearances();
                this._emit();
            });
        } catch (error) {
            this.restoreCharacterAppearances();
            throw error;
        }
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
        if (this._appearanceDrafts.size) this.restoreCharacterAppearances();
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
