import { sys } from 'cc';
import {
    PROGRESSION_BALANCE,
    breakthroughIndexForLevel,
    coinCostForLevel,
    gemCostForBreakthrough,
    normalizeCharacterLevel,
} from './ProgressionBalance';
import { findPlayerCharacter, PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { resolvePlayerBalance, PlayerBalanceOverrides } from './PlayerBalanceOverrides';
import { PlayerData } from '../backend/PlayerData';
import type { CharacterProgress } from '../backend/PlayerProfile';

// Legacy local-storage key from before progression moved into PlayerProfile.
// Kept only long enough to migrate old saves, then cleared.
const LEGACY_STORAGE_KEY = 'SpeedSwimming.Progression.v2';

export type AwardResult = {
    characterId: string;
    coinsGained: number;
};

export type SpendResult = {
    characterId: string;
    levelsGained: number;
    coinsSpent: number;
    gemsSpent: number;
    reason?: 'maxed' | 'insufficient' | 'breakthrough_required' | 'invalid_level' | 'insufficient_coins' | 'insufficient_gems';
};

// Reads/writes character progression through the shared PlayerData profile (which
// delegates persistence to the active backend). awardRace computes coins on the
// client and persists via PlayerData.persist() - fine for the mock phase; when the
// WeChat Cloud backend lands the coin math should move server-side (see IBackend).
// Leveling is manual: spendForLevel / spendToMax go through the backend's
// spendCoinsForLevel (server-authoritative, mirrors grantAdReward).
export class ProgressionManager {
    // Returns the live character progress object inside PlayerData.profile (creating
    // a default entry for unknown ids so mutations land in the shared profile).
    private _progress(characterId: PlayerCharacterId): CharacterProgress {
        let progress = PlayerData.profile.characters[characterId];
        if (!progress) {
            progress = { level: 1, breakthroughCount: 0, signed: false, signAds: 0, adTokens: [] };
            PlayerData.profile.characters[characterId] = progress;
        }
        return progress;
    }

    getCharacterLevel(characterId: PlayerCharacterId): number {
        return normalizeCharacterLevel(this._progress(characterId).level);
    }

    // Coin cost to take this character from its current level to the next.
    coinCostForNextLevel(characterId: PlayerCharacterId): number {
        return coinCostForLevel(this.getCharacterLevel(characterId));
    }

    gemCostForNextLevel(characterId: PlayerCharacterId): number {
        return gemCostForBreakthrough(this.getCharacterLevel(characterId));
    }

    isBreakthroughRequired(characterId: PlayerCharacterId): boolean {
        return breakthroughIndexForLevel(this.getCharacterLevel(characterId)) >= 0;
    }

    // Whether the wallet can afford at least one more level for this character.
    canAffordNextLevel(characterId: PlayerCharacterId): boolean {
        const level = this.getCharacterLevel(characterId);
        if (level >= PROGRESSION_BALANCE.maxLevel) {
            return false;
        }
        return PlayerData.coins >= coinCostForLevel(level)
            && PlayerData.breakthroughGems >= gemCostForBreakthrough(level);
    }

    resolveBalance(characterId: PlayerCharacterId): PlayerBalanceOverrides | null {
        const character = findPlayerCharacter(characterId);
        if (!character) {
            return null;
        }
        const level = this.getCharacterLevel(characterId);
        return resolvePlayerBalance(
            { stamina: character.stamina, technique: character.technique, burst: character.burst },
            level,
            PROGRESSION_BALANCE.maxLevel,
            character.weight,
            character.energyGain,
            character.heartRateTrait,
        );
    }

    // 比赛奖励统一走后台 executeCareer(settle)，此处不再提供无比赛凭据的加币入口。

    // Project how many levels and coins a "spend to max" would cost, WITHOUT
    // mutating. Used by the UI's confirm dialog before calling spendToMax.
    projectSpendToMax(characterId: PlayerCharacterId): { levels: number; coins: number } {
        const startLevel = this.getCharacterLevel(characterId);
        let level = startLevel;
        let coins = 0;
        let wallet = PlayerData.coins;
        while (level < PROGRESSION_BALANCE.maxLevel) {
            if (breakthroughIndexForLevel(level) >= 0) break;
            const cost = coinCostForLevel(level);
            if (wallet < cost) {
                break;
            }
            wallet -= cost;
            coins += cost;
            level += 1;
        }
        return { levels: level - startLevel, coins };
    }

    // Spend coins to gain one level for this character. Returns the spend result;
    // reason is 'insufficient' (can't afford) or 'maxed' (already at cap) when no
    // level was gained. The backend validates the balance and returns the
    // authoritative profile.
    async spendForLevel(characterId: PlayerCharacterId): Promise<SpendResult> {
        const level = this.getCharacterLevel(characterId);
        if (breakthroughIndexForLevel(level) >= 0) {
            return PlayerData.breakthroughCharacter(characterId, level);
        }
        return PlayerData.spendCoinsForLevel(characterId, 1);
    }

    // Spend coins repeatedly until the character can't afford the next level or
    // reaches max. Used by the "一键升满" button (UI confirms before calling).
    async spendToMax(characterId: PlayerCharacterId): Promise<SpendResult> {
        return PlayerData.spendCoinsForLevel(characterId, PROGRESSION_BALANCE.maxLevel);
    }

    // One-time migration of the legacy local-storage progression save into the
    // shared PlayerData profile. Call once after PlayerData has loaded. Reads the
    // old key, folds any saved character progress into the profile, persists, then
    // clears the old key so it never runs again.
    migrateLegacySave(): void {
        let raw: string | null = null;
        try {
            raw = sys.localStorage.getItem(LEGACY_STORAGE_KEY);
        } catch {
            return;
        }
        if (!raw) {
            return;
        }
        let legacy: { characters?: Record<string, { level?: number }> } | null = null;
        try {
            legacy = JSON.parse(raw);
        } catch {
            this.clearLegacySave();
            return;
        }
        const characters = PlayerData.profile.characters;
        if (legacy?.characters) {
            for (const id of Object.keys(legacy.characters)) {
                const entry = legacy.characters[id];
                if (entry && typeof entry.level === 'number') {
                    characters[id] = {
                        level: normalizeCharacterLevel(entry.level),
                        breakthroughCount: Math.floor((normalizeCharacterLevel(entry.level) - 1) / 5),
                        signed: normalizeCharacterLevel(entry.level) > 1, signAds: 0, adTokens: [],
                    };
                }
            }
        }
        void PlayerData.persist();
        this.clearLegacySave();
    }

    private clearLegacySave(): void {
        try {
            sys.localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
            // ignore
        }
    }
}

let _instance: ProgressionManager | null = null;

export function getProgressionManager(): ProgressionManager {
    if (!_instance) {
        _instance = new ProgressionManager();
    }
    return _instance;
}
