import { RaceDifficulty } from '../core/GameBalance';

export type PlayerCharacterId = 'athlete1' | 'diver' | 'gundam';

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
    id: 'fair' | 'warm' | 'deep';
    label: '白' | '黄' | '黑';
    color: readonly [number, number, number];
    preserveOriginal?: boolean;
};

export type PlayerColorScheme = {
    id: string;
    label: string;
    suit: readonly [number, number, number];
    cap: readonly [number, number, number];
    preserveOriginal?: boolean;
};

export const PLAYER_CHARACTER_SLOT_COUNT = 20;

// Add a definition here to introduce a selectable character. Both the roster
// and the formal-race hand-off use this catalog directly.
export const PLAYER_CHARACTER_DEFINITIONS: readonly PlayerCharacterDefinition[] = [
    {
        id: 'athlete1', name: '运动员1', modelVariantId: 'swimmer0621_2', unlocked: true,
        stamina: 78, technique: 76, burst: 68,
        description: '全能型泳者，节奏稳定，适合熟悉比赛与划水时机。',
        skillName: '冲刺起跳', skillDescription: '比赛开始时获得短暂爆发加速。',
    },
    {
        id: 'diver', name: '潜水员', modelVariantId: 'diver', unlocked: true,
        stamina: 66, technique: 88, burst: 74,
        description: '擅长控制与动作衔接，在水下阶段保持更从容的节奏。',
        skillName: '深潜节奏', skillDescription: '水下滑行期间保持更稳定的动作节奏。',
    },
    {
        id: 'gundam', name: '高达', modelVariantId: 'gundam', unlocked: true,
        stamina: 92, technique: 54, burst: 91,
        description: '重装机械选手，耐力与爆发力极高，操作风格直接强势。',
        skillName: '推进核心', skillDescription: '连续输入时更容易维持冲刺势头。', robotStyle: true,
    },
];

export const PLAYER_SKIN_TONES: readonly PlayerSkinTone[] = [
    { id: 'fair', label: '白', color: [210, 151, 116] },
    // The imported athlete's own skin is the intended default yellow tone.
    { id: 'warm', label: '黄', color: [218, 163, 110], preserveOriginal: true },
    { id: 'deep', label: '黑', color: [97, 55, 39] },
];

export const PLAYER_COLOR_SCHEMES: readonly PlayerColorScheme[] = [
    // Do not recolour the imported material. This is the same `original`
    // variant that the race player used before character selection existed.
    { id: 'original', label: '原始', suit: [0, 0, 0], cap: [0, 0, 0], preserveOriginal: true },
    // `suit` is the shared primary-colour channel. Some character models (for
    // example the diver) do not expose a cap channel, so every named scheme
    // must put its visible identity here rather than only in `cap`.
    { id: 'blue', label: '蓝', suit: [23, 109, 218], cap: [245, 238, 220] },
    { id: 'red', label: '红', suit: [240, 68, 58], cap: [22, 119, 232] },
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

// The original athlete uses the model's blue-and-white outfit as its base
// palette. Start from that appearance with the game's yellow skin option.
let selection: PlayerCharacterSelection = { characterId: 'athlete1', skinToneId: 'warm', colorSchemeId: 'original' };
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
    selection = { ...selection, colorSchemeId: PLAYER_COLOR_SCHEMES[(Math.max(0, index) + 1) % PLAYER_COLOR_SCHEMES.length].id };
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
