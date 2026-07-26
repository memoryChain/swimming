import { RaceDifficulty } from '../core/GameBalance';

export type PlayerCharacterId = 'muscleMan' | 'women2';

export type PlayerCharacterDefinition = {
    id: PlayerCharacterId;
    name: string;
    modelVariantId: string;
    unlocked: boolean;
    stamina: number;
    technique: number;
    burst: number;
    description: string;
    skillName: string;
    skillDescription: string;
    robotStyle?: boolean;
};

export type PlayerSkinTone = {
    id: 'warm' | 'deep';
    label: '黄' | '黑';
    color: readonly [number, number, number];
    preserveOriginal?: boolean;
};

export type PlayerColorScheme = {
    id: string;
    label: string;
    suit: readonly [number, number, number];
    cap: readonly [number, number, number];
};

export const PLAYER_CHARACTER_SLOT_COUNT = 2;

// Add a definition here to introduce a selectable character. Both the roster
// and the formal-race hand-off use this catalog directly.
export const PLAYER_CHARACTER_DEFINITIONS: readonly PlayerCharacterDefinition[] = [
    {
        id: 'muscleMan', name: '肌肉猛男', modelVariantId: 'muscleMan', unlocked: true,
        stamina: 88, technique: 70, burst: 82,
        description: '力量型游泳选手，拥有强劲的划水爆发与稳定续航。',
        skillName: '强力划水', skillDescription: '稳定的力量输出让冲刺阶段更具压迫感。',
    },
    {
        id: 'women2', name: '浪花飞鱼', modelVariantId: 'women2', unlocked: true,
        stamina: 82, technique: 91, burst: 76,
        description: '技术型女选手，划水节奏细腻，能在中后程保持高效推进。',
        skillName: '水感节奏', skillDescription: '精准把握节奏时，更容易维持稳定的连续推进。',
    },
];

export const PLAYER_SKIN_TONES: readonly PlayerSkinTone[] = [
    // Keep the imported MuscleMan skin as the default yellow tone.
    { id: 'warm', label: '黄', color: [218, 163, 110], preserveOriginal: true },
    { id: 'deep', label: '黑', color: [97, 55, 39] },
];

export const PLAYER_COLOR_SCHEMES: readonly PlayerColorScheme[] = [
    // The T-pose MuscleMan uses one shared white-key channel for cap and trunks,
    // so every named scheme keeps its visible identity in `suit`.
    { id: 'red', label: '红', suit: [240, 68, 58], cap: [22, 119, 232] },
    { id: 'blue', label: '蓝', suit: [23, 109, 218], cap: [245, 238, 220] },
    { id: 'yellow', label: '黄', suit: [255, 209, 42], cap: [255, 209, 42] },
    { id: 'purple', label: '紫', suit: [139, 77, 255], cap: [35, 220, 232] },
    { id: 'green', label: '绿', suit: [24, 177, 105], cap: [238, 246, 238] },
    { id: 'orange', label: '橙', suit: [243, 121, 32], cap: [31, 126, 222] },
    { id: 'cyan', label: '青', suit: [23, 186, 207], cap: [252, 238, 86] },
    { id: 'black', label: '黑', suit: [32, 38, 48], cap: [238, 240, 246] },
];

export type PlayerCharacterSelection = {
    characterId: PlayerCharacterId;
    skinToneId: PlayerSkinTone['id'];
    colorSchemeId: string;
};

let selection: PlayerCharacterSelection = { characterId: 'muscleMan', skinToneId: 'warm', colorSchemeId: 'red' };
let selectedRaceDifficulty: RaceDifficulty = 'competitive';

export function getPlayerCharacterSelection(): Readonly<PlayerCharacterSelection> { return selection; }

export function selectPlayerCharacter(id: PlayerCharacterId) {
    const character = findPlayerCharacter(id);
    if (character?.unlocked) selection = { ...selection, characterId: id };
}

export function cyclePlayerSkinTone() {
    const index = PLAYER_SKIN_TONES.findIndex((tone) => tone.id === selection.skinToneId);
    selection = { ...selection, skinToneId: PLAYER_SKIN_TONES[(Math.max(0, index) + 1) % PLAYER_SKIN_TONES.length].id };
}

export function cyclePlayerColorScheme() {
    const index = PLAYER_COLOR_SCHEMES.findIndex((scheme) => scheme.id === selection.colorSchemeId);
    const nextIndex = index < 0 ? 0 : (index + 1) % PLAYER_COLOR_SCHEMES.length;
    selection = { ...selection, colorSchemeId: PLAYER_COLOR_SCHEMES[nextIndex].id };
}

export function findPlayerCharacter(id = selection.characterId): PlayerCharacterDefinition | null {
    return PLAYER_CHARACTER_DEFINITIONS.find((character) => character.id === id) ?? null;
}

export function selectedPlayerSkinTone(): PlayerSkinTone {
    return PLAYER_SKIN_TONES.find((tone) => tone.id === selection.skinToneId) ?? PLAYER_SKIN_TONES[0];
}

export function selectedPlayerColorScheme(): PlayerColorScheme {
    return PLAYER_COLOR_SCHEMES.find((scheme) => scheme.id === selection.colorSchemeId) ?? PLAYER_COLOR_SCHEMES[0];
}

export function setSelectedRaceDifficulty(difficulty: RaceDifficulty) { selectedRaceDifficulty = difficulty; }
export function getSelectedRaceDifficulty(): RaceDifficulty { return selectedRaceDifficulty; }
