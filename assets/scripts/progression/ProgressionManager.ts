import { sys } from 'cc';
import { PROGRESSION_BALANCE, xpForLevel, calculateRaceXp, RacePerformanceInput } from './ProgressionBalance';
import { findPlayerCharacter, PLAYER_CHARACTER_DEFINITIONS, PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { resolvePlayerBalance, PlayerBalanceOverrides } from './PlayerBalanceOverrides';

const PROGRESSION_STORAGE_KEY = 'SpeedSwimming.Progression.v2';

export type CharacterProgress = {
    level: number;
    xp: number;
};

export type PlayerProfileData = {
    characters: Record<string, CharacterProgress>;
};

export type AwardResult = {
    characterId: string;
    characterName: string;
    xpGained: number;
    previousLevel: number;
    newLevel: number;
    leveledUp: boolean;
    newXp: number;
    xpForNextLevel: number;
};

function defaultProfile(): PlayerProfileData {
    const characters: Record<string, CharacterProgress> = {};
    for (const def of PLAYER_CHARACTER_DEFINITIONS) {
        if (def.unlocked) {
            characters[def.id] = { level: 1, xp: 0 };
        }
    }
    return { characters };
}

export class ProgressionManager {
    private _profile: PlayerProfileData;

    constructor() {
        this._profile = this.loadProfile();
    }

    private loadProfile(): PlayerProfileData {
        try {
            const raw = sys.localStorage.getItem(PROGRESSION_STORAGE_KEY);
            if (!raw) {
                return defaultProfile();
            }
            const data = JSON.parse(raw) as Partial<PlayerProfileData>;
            return this.migrate(data);
        } catch {
            return defaultProfile();
        }
    }

    private migrate(data: Partial<PlayerProfileData>): PlayerProfileData {
        const base = defaultProfile();
        const characters = { ...base.characters };
        if (data.characters) {
            for (const id of Object.keys(data.characters)) {
                const entry = data.characters[id];
                if (entry && typeof entry.level === 'number' && typeof entry.xp === 'number') {
                    characters[id] = {
                        level: Math.max(1, entry.level),
                        xp: Math.max(0, entry.xp),
                    };
                }
            }
        }
        return { characters };
    }

    private save() {
        try {
            sys.localStorage.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(this._profile));
        } catch {
            // localStorage may be unavailable in some preview environments.
        }
    }

    getCharacterLevel(characterId: PlayerCharacterId): number {
        return this._profile.characters[characterId]?.level ?? 1;
    }

    getCharacterXp(characterId: PlayerCharacterId): number {
        return this._profile.characters[characterId]?.xp ?? 0;
    }

    xpToNextLevel(characterId: PlayerCharacterId): number {
        const progress = this._profile.characters[characterId];
        if (!progress || progress.level >= PROGRESSION_BALANCE.maxLevel) {
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

    awardRace(characterId: PlayerCharacterId, input: RacePerformanceInput): AwardResult {
        const character = findPlayerCharacter(characterId);
        const characterName = character?.name ?? '';
        const progress = this._profile.characters[characterId];
        if (!progress) {
            return {
                characterId,
                characterName,
                xpGained: 0,
                previousLevel: 1,
                newLevel: 1,
                leveledUp: false,
                newXp: 0,
                xpForNextLevel: 0,
            };
        }

        const previousLevel = progress.level;
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

        this.save();

        return {
            characterId,
            characterName,
            xpGained,
            previousLevel,
            newLevel: progress.level,
            leveledUp: progress.level > previousLevel,
            newXp: progress.xp,
            xpForNextLevel: progress.level >= PROGRESSION_BALANCE.maxLevel ? 0 : xpForLevel(progress.level),
        };
    }
}

let _instance: ProgressionManager | null = null;

export function getProgressionManager(): ProgressionManager {
    if (!_instance) {
        _instance = new ProgressionManager();
    }
    return _instance;
}
