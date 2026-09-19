// Local mock backend: persists the profile in sys.localStorage. Used in the editor,
// browser, and as the phase-1 stand-in before the WeChat Cloud backend exists.
// It plays the role the cloud function will later play (validate caps, mutate,
// return authoritative profile) so callers won't change when we swap it out.
//
// NOTE: this is NOT anti-cheat safe (local storage is editable). That's fine for a
// local mock; the production WeChat Cloud backend is the authoritative one.

import { sys } from 'cc';
import { CareerCommand, CareerResult, executeCareer } from '../progression/CareerRules';
import {
    AdRewardResult,
    BreakthroughResult,
    DailyShopClaimResult,
    DailyShopRewardSlot,
    DebugCurrencyId,
    IBackend,
    IdentityPatch,
    LevelSpendResult,
} from './IBackend';
import {
    createDefaultProfile,
    normalizeProfile,
    PlayerProfile,
    PROGRESSION_CONFIG,
    dailyShopCycleKey,
} from './PlayerProfile';
import {
    PROGRESSION_BALANCE,
    breakthroughIndexForLevel,
    coinCostForLevel,
    gemCostForBreakthrough,
} from '../progression/ProgressionBalance';

const STORAGE_KEY = 'swimming.player-profile';

export class MockBackend implements IBackend {
    readonly name = 'mock';

    executeCareer(command: CareerCommand): Promise<CareerResult> {
        const result = executeCareer(this.read(), command);
        if (result.ok) this.write(result.profile);
        return Promise.resolve(result);
    }

    loadProfile(): Promise<PlayerProfile> {
        return Promise.resolve(this.read());
    }

    async grantAdReward(): Promise<AdRewardResult> {
        // 兼容旧调用，但必须与新的“广告金币”槽位共用同一日限，不能成为额外入口。
        const result = await this.claimDailyShopReward('ad_coins', true, `legacy-${Date.now()}`);
        return {
            ok: result.ok,
            profile: result.profile,
            granted: result.grantedCoins,
            reason: result.ok ? undefined : result.reason === 'claimed' ? 'capped' : 'error',
        };
    }

    claimDailyShopReward(slot: DailyShopRewardSlot, adCompleted: boolean, _transactionId: string): Promise<DailyShopClaimResult> {
        const profile = this.read();
        this.rollDailyShop(profile);
        const claimed = slot === 'free_coins' ? profile.dailyShop.freeCoinsClaimed
            : slot === 'ad_gems' ? profile.dailyShop.adGemsClaimed
                : profile.dailyShop.adCoinsClaimed;
        if (claimed) {
            return Promise.resolve({ ok: false, profile, slot, grantedCoins: 0, grantedGems: 0, reason: 'claimed' });
        }
        if (slot !== 'free_coins' && !adCompleted) {
            return Promise.resolve({ ok: false, profile, slot, grantedCoins: 0, grantedGems: 0, reason: 'ad_incomplete' });
        }
        let grantedCoins = 0;
        let grantedGems = 0;
        if (slot === 'free_coins') {
            grantedCoins = PROGRESSION_CONFIG.dailyFreeCoins;
            profile.dailyShop.freeCoinsClaimed = true;
        } else if (slot === 'ad_gems') {
            grantedGems = PROGRESSION_CONFIG.dailyAdGems;
            profile.dailyShop.adGemsClaimed = true;
        } else {
            grantedCoins = PROGRESSION_CONFIG.dailyAdCoins;
            profile.dailyShop.adCoinsClaimed = true;
        }
        profile.coins += grantedCoins;
        profile.breakthroughGems += grantedGems;
        this.write(profile);
        return Promise.resolve({ ok: true, profile, slot, grantedCoins, grantedGems });
    }

    // DEBUG ONLY: no ad, no cap. See IBackend.adjustDebugCurrency.
    adjustDebugCurrency(currency: DebugCurrencyId, delta: number): Promise<PlayerProfile> {
        const profile = this.read();
        const amount = Number.isFinite(delta) ? Math.trunc(delta) : 0;
        profile[currency] = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, profile[currency] + amount));
        this.write(profile);
        return Promise.resolve(profile);
    }

    spendCoinsForLevel(characterId: string, requestedLevels: number): Promise<LevelSpendResult> {
        const profile = this.read();
        const progress = profile.characters[characterId];
        if (!progress) {
            return Promise.resolve({ ok: false, profile, levelsGained: 0, coinsSpent: 0, reason: 'maxed' });
        }
        if (progress.level >= PROGRESSION_BALANCE.maxLevel) {
            return Promise.resolve({ ok: false, profile, levelsGained: 0, coinsSpent: 0, reason: 'maxed' });
        }
        let levelsGained = 0;
        let coinsSpent = 0;
        let remaining = Number.isFinite(requestedLevels) ? Math.max(0, Math.min(30, Math.floor(requestedLevels))) : 0;
        while (remaining > 0 && progress.level < PROGRESSION_BALANCE.maxLevel) {
            if (breakthroughIndexForLevel(progress.level) >= 0) {
                break;
            }
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
            const reason = breakthroughIndexForLevel(progress.level) >= 0 ? 'breakthrough_required' : 'insufficient';
            return Promise.resolve({ ok: false, profile, levelsGained: 0, coinsSpent: 0, reason });
        }
        this.write(profile);
        return Promise.resolve({ ok: true, profile, levelsGained, coinsSpent });
    }

    breakthroughCharacter(characterId: string, expectedLevel: number): Promise<BreakthroughResult> {
        const profile = this.read();
        const progress = profile.characters[characterId];
        if (!progress || progress.level >= PROGRESSION_BALANCE.maxLevel) {
            return Promise.resolve({ ok: false, profile, coinsSpent: 0, gemsSpent: 0, reason: 'maxed' });
        }
        if (progress.level !== expectedLevel || breakthroughIndexForLevel(progress.level) < 0) {
            return Promise.resolve({ ok: false, profile, coinsSpent: 0, gemsSpent: 0, reason: 'invalid_level' });
        }
        const coins = coinCostForLevel(progress.level);
        const gems = gemCostForBreakthrough(progress.level);
        if (profile.coins < coins) {
            return Promise.resolve({ ok: false, profile, coinsSpent: 0, gemsSpent: 0, reason: 'insufficient_coins' });
        }
        if (profile.breakthroughGems < gems) {
            return Promise.resolve({ ok: false, profile, coinsSpent: 0, gemsSpent: 0, reason: 'insufficient_gems' });
        }
        profile.coins -= coins;
        profile.breakthroughGems -= gems;
        progress.level += 1;
        progress.breakthroughCount = breakthroughIndexForLevel(expectedLevel) + 1;
        this.write(profile);
        return Promise.resolve({ ok: true, profile, coinsSpent: coins, gemsSpent: gems });
    }

    saveIdentity(identity: IdentityPatch): Promise<PlayerProfile> {
        const profile = this.read();
        if (typeof identity.nickName === 'string' && identity.nickName.length > 0) {
            profile.nickName = identity.nickName;
        }
        if (typeof identity.avatarId === 'string' && identity.avatarId.length > 0) {
            profile.avatarId = identity.avatarId;
        }
        this.write(profile);
        return Promise.resolve(profile);
    }

    // Phase-2 progression writes come through here. The mock just persists what the
    // client computed; the future cloud function will validate and return the
    // authoritative profile instead.
    saveProfile(profile: PlayerProfile): Promise<PlayerProfile> {
        this.write(profile);
        return Promise.resolve(profile);
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
            sys.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
        } catch (error) {
            console.warn('[Backend] mock write failed', error);
            throw error;
        }
    }

    private rollDailyShop(profile: PlayerProfile): void {
        const cycleKey = dailyShopCycleKey();
        if (profile.dailyShop.cycleKey === cycleKey) return;
        profile.dailyShop = {
            cycleKey,
            freeCoinsClaimed: false,
            adGemsClaimed: false,
            adCoinsClaimed: false,
        };
    }
}
