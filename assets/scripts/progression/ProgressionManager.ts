import { sys } from 'cc';
import { PROGRESSION_BALANCE, xpForLevel, calculateRaceXp, RacePerformanceInput } from './ProgressionBalance';
import { findPlayerCharacter, PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { resolvePlayerBalance, PlayerBalanceOverrides } from './PlayerBalanceOverrides';
import { PlayerData } from '../backend/PlayerData';
import type { CharacterProgress } from '../backend/PlayerProfile';

// Legacy local-storage key from before progression moved into PlayerProfile.
// Kept only long enough to migrate old saves, then cleared.
const LEGACY_STORAGE_KEY = 'SpeedSwimming.Progression.v2';

export type AwardResult = {
    characterId: string;
    characterName: string;
    xpGained: number;
    previousLevel: number;
    newLevel: number;
    leveledUp: boolean;
    newXp: number;
    xpForNextLevel: number;
    previousXp: number;
    previousXpForNextLevel: number;
};

// Reads/writes character progression through the shared PlayerData profile (which
// delegates persistence to the active backend). awardRace computes XP on the
// client and persists via PlayerData.persist() - fine for the mock phase; when the
// WeChat Cloud backend lands the XP math should move server-side (see IBackend).
export class ProgressionManager {
    // Returns the live character progress object inside PlayerData.profile (creating
    // a default entry for unknown ids so mutations land in the shared profile).
    private _progress(characterId: PlayerCharacterId): CharacterProgress {
        let progress = PlayerData.profile.characters[characterId];
        if (!progress) {
            progress = { level: 1, xp: 0 };
            PlayerData.profile.characters[characterId] = progress;
        }
        return progress;
    }

    getCharacterLevel(characterId: PlayerCharacterId): number {
        return this._progress(characterId).level;
    }

    getCharacterXp(characterId: PlayerCharacterId): number {
        return this._progress(characterId).xp;
    }

    xpToNextLevel(characterId: PlayerCharacterId): number {
        const progress = this._progress(characterId);
        if (progress.level >= PROGRESSION_BALANCE.maxLevel) {
            return 0;
        }
        return Math.max(0, xpForLevel(progress.level) - progress.xp);
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
        );
    }

    // Synchronous XP/level computation + in-memory mutation, then asynchronous
    // persistence. Returns the result immediately so the UI (showProgressionResult)
    // can display it without awaiting - matching the existing synchronous callback.
    awardRace(characterId: PlayerCharacterId, input: RacePerformanceInput): AwardResult {
        const character = findPlayerCharacter(characterId);
        const characterName = character?.name ?? '';
        const progress = this._progress(characterId);

        const previousLevel = progress.level;
        const previousXp = progress.xp;
        const previousXpForNextLevel = previousLevel >= PROGRESSION_BALANCE.maxLevel ? 0 : xpForLevel(previousLevel);
        const xpGained = calculateRaceXp(input);
        progress.xp += xpGained;

        while (progress.level < PROGRESSION_BALANCE.maxLevel) {
            const needed = xpForLevel(progress.level);
            if (progress.xp < needed) {
                break;
            }
            progress.xp -= needed;
            progress.level += 1;
        }

        if (progress.level >= PROGRESSION_BALANCE.maxLevel) {
            progress.level = PROGRESSION_BALANCE.maxLevel;
            progress.xp = 0;
        }

        // Fire-and-forget persist: the in-memory profile is already updated, so UI
        // reads stay correct; this just durably stores the change.
        void PlayerData.persist();

        return {
            characterId,
            characterName,
            xpGained,
            previousLevel,
            newLevel: progress.level,
            leveledUp: progress.level > previousLevel,
            newXp: progress.xp,
            xpForNextLevel: progress.level >= PROGRESSION_BALANCE.maxLevel ? 0 : xpForLevel(progress.level),
            previousXp,
            previousXpForNextLevel,
        };
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
        let legacy: { characters?: Record<string, { level?: number; xp?: number }> } | null = null;
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
                if (entry && typeof entry.level === 'number' && typeof entry.xp === 'number') {
                    characters[id] = {
                        level: Math.max(1, Math.floor(entry.level)),
                        xp: Math.max(0, Math.floor(entry.xp)),
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