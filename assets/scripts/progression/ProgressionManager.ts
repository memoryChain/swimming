import { sys } from 'cc';
import { PROGRESSION_BALANCE, coinCostForLevel, calculateRaceCoins, RacePerformanceInput } from './ProgressionBalance';
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
    reason?: 'maxed' | 'insufficient';
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
            progress = { level: 1 };
            PlayerData.profile.characters[characterId] = progress;
        }
        return progress;
    }

    getCharacterLevel(characterId: PlayerCharacterId): number {
        return this._progress(characterId).level;
    }

    // Coin cost to take this character from its current level to the next.
    coinCostForNextLevel(characterId: PlayerCharacterId): number {
        return coinCostForLevel(this.getCharacterLevel(characterId));
    }

    // Whether the wallet can afford at least one more level for this character.
    canAffordNextLevel(characterId: PlayerCharacterId): boolean {
        const level = this.getCharacterLevel(characterId);
        if (level >= PROGRESSION_BALANCE.maxLevel) {
            return false;
        }
        return PlayerData.coins >= coinCostForLevel(level);
    }

    resolveBalance(characterId: PlayerCharacterId): PlayerBalanceOverrides | null {
        const character = findPlayerCharacter(characterId);
        if (!character) {
            return null;
        }
        const level = this.getCharacterLevel(characterId);
        return resolvePlayerBalance(
            { stamina: character.stamina, technique: character.technique, burst: character.burst, kick: character.kick },
            level,
            PROGRESSION_BALANCE.maxLevel,
            character.weight,
            character.energyGain,
            character.kick,
        );
    }

    // Synchronous coin computation + in-memory mutation, then asynchronous
    // persistence. Returns the result immediately so the UI (showProgressionResult)
    // can display it without awaiting. Coins go to the shared wallet (not per-char).
    awardRace(characterId: PlayerCharacterId, input: RacePerformanceInput): AwardResult {
        const coinsGained = calculateRaceCoins(input);
        PlayerData.profile.coins += coinsGained;
        // Fire-and-forget persist: the in-memory profile is already updated, so UI
        // reads stay correct; this just durably stores the change.
        void PlayerData.persist();
        return { characterId, coinsGained };
    }

    // Project how many levels and coins a "spend to max" would cost, WITHOUT
    // mutating. Used by the UI's confirm dialog before calling spendToMax.
    projectSpendToMax(characterId: PlayerCharacterId): { levels: number; coins: number } {
        const startLevel = this.getCharacterLevel(characterId);
        let level = startLevel;
        let coins = 0;
        let wallet = PlayerData.coins;
        while (level < PROGRESSION_BALANCE.maxLevel) {
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
                        level: Math.max(1, Math.floor(entry.level)),
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