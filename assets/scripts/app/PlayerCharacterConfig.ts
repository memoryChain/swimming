import { sys } from 'cc';
import { RaceDifficulty, RACE_DIFFICULTY_OPTIONS } from '../core/GameBalance';

export type PlayerCharacterId = 'muscleMan' | 'women2' | 'lowPolyHuman2' | 'diver';

export type PlayerCharacterDefinition = {
    id: PlayerCharacterId;
    name: string;
    modelVariantId: string;
    unlocked: boolean;
    stamina: number;
    technique: number;
    burst: number;
    // Body weight for swimmer-vs-swimmer collision knockback (default ~1). Heavy
    // bodies barely move when bumped; light bodies get knocked further.
    weight: number;
    // 旧版蓄气资质（0-100，纯资质、不随等级成长）。保留给存档、展示和兼容路径；
    // 玩家海豚跳的实际积攒速率由 DolphinJumpProfile.chargeGainScale 决定。
    energyGain: number;
    // 踢腿资质（0-100）。影响踢腿速度上限；50 为基准（±15%）。
    kick: number;
    description: string;
    skillName: string;
    skillDescription: string;
    robotStyle?: boolean;
    supportsSkinTone?: boolean;
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

// Number of character slots exposed by the current horizontal roster.
export const PLAYER_CHARACTER_SLOT_COUNT = 4;

// Add a definition here to introduce a selectable character. Both the roster
// and the formal-race hand-off use this catalog directly.
export const PLAYER_CHARACTER_DEFINITIONS: readonly PlayerCharacterDefinition[] = [
    {
        id: 'muscleMan', name: '铁臂狂鲨', modelVariantId: 'muscleMan', unlocked: true,
        stamina: 88, technique: 70, burst: 82,
        weight: 1.2,
        energyGain: 75,
        kick: 50,
        description: '力量型游泳选手，拥有强劲的划水爆发与稳定续航。',
        skillName: '强力划水', skillDescription: '稳定的力量输出让冲刺阶段更具压迫感。',
    },
    {
        id: 'women2', name: '灵波飞鱼', modelVariantId: 'women2', unlocked: true,
        stamina: 82, technique: 91, burst: 76,
        weight: 0.85,
        energyGain: 92,
        kick: 50,
        description: '技术型女选手，划水节奏细腻，能在中后程保持高效推进。',
        skillName: '水感节奏', skillDescription: '精准把握节奏时，更容易维持稳定的连续推进。',
    },
    {
        id: 'lowPolyHuman2', name: '破浪新星', modelVariantId: 'lowPolyHuman2', unlocked: true,
        stamina: 85, technique: 84, burst: 80,
        weight: 1.0,
        energyGain: 82,
        kick: 50,
        description: '均衡型游泳选手，动作灵活，能稳定应对不同比赛节奏。',
        skillName: '流线节奏', skillDescription: '均衡的身体控制让连续划水更加顺畅。',
    },
    {
        id: 'diver', name: '深海潜将', modelVariantId: 'diver', unlocked: true,
        stamina: 92, technique: 78, burst: 74,
        weight: 1.15,
        energyGain: 80,
        kick: 50,
        description: '装备齐全的潜水选手，身体稳定，擅长保持持续而扎实的推进。',
        skillName: '深潜耐力', skillDescription: '厚重装备带来更强的稳定性与持续输出。',
        supportsSkinTone: false,
    },
];

export const PLAYER_SKIN_TONES: readonly PlayerSkinTone[] = [
    // Keep the imported MuscleMan skin as the default yellow tone.
    { id: 'warm', label: '黄', color: [218, 163, 110], preserveOriginal: true },
    { id: 'deep', label: '黑', color: [97, 55, 39] },
];

export const PLAYER_COLOR_SCHEMES: readonly PlayerColorScheme[] = [
    // Canonical swimmers use one white-key channel for their white equipment,
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
let preferencesLoaded = false;

const PREPARE_RACE_PREFERENCES_KEY = 'SpeedSwimming.PrepareRace.v1';

type PrepareRacePreferences = PlayerCharacterSelection & {
    raceDifficulty: RaceDifficulty;
};

function ensurePreferencesLoaded() {
    if (preferencesLoaded) return;
    preferencesLoaded = true;
    try {
        const raw = sys.localStorage.getItem(PREPARE_RACE_PREFERENCES_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<PrepareRacePreferences>;
        const character = PLAYER_CHARACTER_DEFINITIONS.find((entry) => entry.id === saved.characterId && entry.unlocked);
        const skin = PLAYER_SKIN_TONES.find((entry) => entry.id === saved.skinToneId);
        const color = PLAYER_COLOR_SCHEMES.find((entry) => entry.id === saved.colorSchemeId);
        const difficulty = RACE_DIFFICULTY_OPTIONS.find((entry) => entry.id === saved.raceDifficulty);
        selection = {
            characterId: character?.id ?? selection.characterId,
            skinToneId: skin?.id ?? selection.skinToneId,
            colorSchemeId: color?.id ?? selection.colorSchemeId,
        };
        selectedRaceDifficulty = difficulty?.id ?? selectedRaceDifficulty;
    } catch {
        // Corrupt or unavailable storage falls back to the defaults above.
    }
}

function persistPreferences() {
    try {
        const data: PrepareRacePreferences = {
            ...selection,
            raceDifficulty: selectedRaceDifficulty,
        };
        sys.localStorage.setItem(PREPARE_RACE_PREFERENCES_KEY, JSON.stringify(data));
    } catch {
        // Storage may be unavailable in some preview environments.
    }
}

export function getPlayerCharacterSelection(): Readonly<PlayerCharacterSelection> {
    ensurePreferencesLoaded();
    return selection;
}

export function selectPlayerCharacter(id: PlayerCharacterId) {
    ensurePreferencesLoaded();
    const character = findPlayerCharacter(id);
    if (!character?.unlocked || selection.characterId === id) return;
    selection = { ...selection, characterId: id };
    persistPreferences();
}

export function cyclePlayerSkinTone() {
    ensurePreferencesLoaded();
    if (!selectedPlayerCharacterSupportsSkinTone()) return;
    const index = PLAYER_SKIN_TONES.findIndex((tone) => tone.id === selection.skinToneId);
    selection = { ...selection, skinToneId: PLAYER_SKIN_TONES[(Math.max(0, index) + 1) % PLAYER_SKIN_TONES.length].id };
    persistPreferences();
}

export function cyclePlayerColorScheme() {
    ensurePreferencesLoaded();
    const index = PLAYER_COLOR_SCHEMES.findIndex((scheme) => scheme.id === selection.colorSchemeId);
    const nextIndex = index < 0 ? 0 : (index + 1) % PLAYER_COLOR_SCHEMES.length;
    selection = { ...selection, colorSchemeId: PLAYER_COLOR_SCHEMES[nextIndex].id };
    persistPreferences();
}

export function setPlayerSkinTone(id: PlayerSkinTone['id']) {
    ensurePreferencesLoaded();
    if (!selectedPlayerCharacterSupportsSkinTone()) return;
    if (!PLAYER_SKIN_TONES.some((tone) => tone.id === id)) return;
    if (selection.skinToneId === id) return;
    selection = { ...selection, skinToneId: id };
    persistPreferences();
}

export function setPlayerColorScheme(id: string) {
    ensurePreferencesLoaded();
    if (!PLAYER_COLOR_SCHEMES.some((scheme) => scheme.id === id)) return;
    if (selection.colorSchemeId === id) return;
    selection = { ...selection, colorSchemeId: id };
    persistPreferences();
}

export function findPlayerCharacter(id?: PlayerCharacterId): PlayerCharacterDefinition | null {
    ensurePreferencesLoaded();
    const resolvedId = id ?? selection.characterId;
    return PLAYER_CHARACTER_DEFINITIONS.find((character) => character.id === resolvedId) ?? null;
}

// 将角色的物理体重（0.85~1.2 左右）归一化成 0-100 的“对抗”雷达轴分值。
// 底层 weight 仍驱动碰撞击退；这里只用于雷达图显示，刻意压缩差异（约 50~85），
// 让角色之间有区分但不至于像 0~100 那样悬殊。
export function weightToPhysicalRating(weight: number): number {
    return Math.max(0, Math.min(100, Math.round(50 + (weight - 0.85) * 100)));
}

export function selectedPlayerSkinTone(): PlayerSkinTone {
    ensurePreferencesLoaded();
    if (!selectedPlayerCharacterSupportsSkinTone()) return PLAYER_SKIN_TONES[0];
    return PLAYER_SKIN_TONES.find((tone) => tone.id === selection.skinToneId) ?? PLAYER_SKIN_TONES[0];
}

export function selectedPlayerCharacterSupportsSkinTone(): boolean {
    ensurePreferencesLoaded();
    return findPlayerCharacter()?.supportsSkinTone !== false;
}

export function selectedPlayerColorScheme(): PlayerColorScheme {
    ensurePreferencesLoaded();
    return PLAYER_COLOR_SCHEMES.find((scheme) => scheme.id === selection.colorSchemeId) ?? PLAYER_COLOR_SCHEMES[0];
}

export function setSelectedRaceDifficulty(difficulty: RaceDifficulty) {
    ensurePreferencesLoaded();
    if (!RACE_DIFFICULTY_OPTIONS.some((option) => option.id === difficulty)) return;
    if (selectedRaceDifficulty === difficulty) return;
    selectedRaceDifficulty = difficulty;
    persistPreferences();
}

export function getSelectedRaceDifficulty(): RaceDifficulty {
    ensurePreferencesLoaded();
    return selectedRaceDifficulty;
}
