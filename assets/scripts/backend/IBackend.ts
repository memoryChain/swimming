// 玩家档案业务接口；微信由云函数验证并持久化，其他平台暂用本地模拟。
import { PlayerProfile } from './PlayerProfile';
import type { PlayerCharacterSelection } from '../app/PlayerCharacterConfig';
import type { CareerCommand, CareerResult } from '../progression/CareerRules';

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
    /** 云端分配的公开编号；本地模拟没有正式编号。 */
    readonly uid?: number;
    executeCareer(command: CareerCommand): Promise<CareerResult>;

    // Load (or first-time create) this account's profile.
    loadProfile(): Promise<PlayerProfile>;

    // 广告奖励暂未启用。云端未接可信广告凭据前不发币；本地可模拟。
    grantAdReward(): Promise<AdRewardResult>;

    // 仅本地 AI 调试入口允许加币；云端拒绝，补偿使用独立管理员接口。
    grantDebugCoins(amount: number): Promise<PlayerProfile>;

    // Spend coins to level a character. requestedLevels caps how many levels to
    // attempt (1 for single, maxLevel for "spend to max"); the backend spends as
    // many as the balance allows, validates, and returns the authoritative
    // profile + how many levels were gained + coins spent.
    spendCoinsForLevel(characterId: string, requestedLevels: number): Promise<LevelSpendResult>;

    // Persist the player-chosen identity (nickname / avatar). Returns the updated
    // profile.
    saveIdentity(identity: IdentityPatch): Promise<PlayerProfile>;

    saveCharacterSelection(selection: PlayerCharacterSelection): Promise<PlayerProfile>;

    // 仅本地旧档迁移/测试允许整档写入；云端实现必须拒绝。
    saveProfile(profile: PlayerProfile): Promise<PlayerProfile>;
}
