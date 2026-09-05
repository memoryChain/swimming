import { RaceDifficulty } from '../core/GameBalance';

export type PlayerCharacterId = 'muscleMan' | 'cartonSwimmer5' | 'cartonSwimmer6' | 'cartonSwimmer8' | 'cartonSwimmer9' | 'cartonSwimmer10' | 'cartonSwimmer11' | 'cartonSwimmer12' | 'cartonSwimmer13' | 'cartonSwimmer14' | 'cartonSwimmer15';

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
    // 蓄气资质（0-100，纯资质、不随等级成长）。决定赛内大招能量的积攒速率。
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

// Add a definition here to introduce a selectable character. The management
// roster derives its scrollable slot count from this catalog, and the formal
// race hand-off uses the same definitions directly.
export const PLAYER_CHARACTER_DEFINITIONS: readonly PlayerCharacterDefinition[] = [
    {
        id: 'cartonSwimmer6', name: '跃浪少女', modelVariantId: 'cartonSwimmer6', unlocked: true,
        stamina: 85, technique: 84, burst: 80,
        weight: 1.0,
        energyGain: 82,
        kick: 50,
        description: '戴着圆耳运动帽的活力少女，以轻快稳定的节奏跃浪前行。',
        skillName: '跃浪节奏', skillDescription: '均衡的身体控制让连续划水更加顺畅。',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer8', name: '蛙跃潮童', modelVariantId: 'cartonSwimmer8', unlocked: true,
        stamina: 85, technique: 84, burst: 80,
        weight: 1.0,
        energyGain: 82,
        kick: 50,
        description: '戴着青蛙帽与粉色护目镜的潮酷少年，以轻快稳定的节奏跃入浪潮。',
        skillName: '蛙跃节奏', skillDescription: '均衡的身体控制让连续划水与入水衔接更加顺畅。',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer5', name: '逐浪少女', modelVariantId: 'cartonSwimmer5', unlocked: true,
        stamina: 85, technique: 84, burst: 80,
        weight: 1.0,
        energyGain: 82,
        kick: 50,
        description: '轻装上阵的运动少女，以轻快而稳定的节奏逐浪前行。',
        skillName: '逐浪节奏', skillDescription: '均衡的身体控制让连续划水更加顺畅。',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer9', name: '霓光灵猫', modelVariantId: 'cartonSwimmer9', unlocked: true,
        stamina: 85, technique: 84, burst: 80,
        weight: 1.0,
        energyGain: 82,
        kick: 50,
        description: '戴着猫耳帽与霓彩护目镜的灵动少女，以轻盈节奏穿梭浪尖。',
        skillName: '猫影节奏', skillDescription: '均衡的身体控制让连续划水与转身衔接更加灵巧。',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer10', name: '青影忍浪', modelVariantId: 'cartonSwimmer10', unlocked: true,
        stamina: 85, technique: 84, burst: 80,
        weight: 1.0,
        energyGain: 82,
        kick: 50,
        description: '身着黑绿忍者装束的敏捷泳者，以轻快身法切入浪线。',
        skillName: '忍浪节奏', skillDescription: '均衡的身体控制让连续划水与转身衔接更加利落。',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer11', name: '疾风浪客', modelVariantId: 'cartonSwimmer11', unlocked: true,
        stamina: 85, technique: 84, burst: 80,
        weight: 1.0,
        energyGain: 82,
        kick: 50,
        description: '身着荧绿运动装的全能选手，以稳定节奏和充沛耐力追逐浪线。',
        skillName: '疾风节奏', skillDescription: '均衡的身体控制让连续划水与转身衔接更加流畅。',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer12', name: '绿电潮童', modelVariantId: 'cartonSwimmer12', unlocked: true,
        stamina: 84, technique: 86, burst: 81,
        weight: 0.98,
        energyGain: 84,
        kick: 52,
        description: '身着青柠运动装备的活力少年，以灵敏节奏和轻快步伐追逐浪尖。',
        skillName: '绿电节奏', skillDescription: '灵巧的身体控制让划水、踢腿与转身衔接更加轻快。',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer13', name: '深潜先锋', modelVariantId: 'cartonSwimmer13', unlocked: true,
        stamina: 90, technique: 82, burst: 76,
        weight: 1.08,
        energyGain: 80,
        kick: 54,
        description: '背负轻型潜水装备的耐力型泳者，以稳定节奏穿越深水。',
        skillName: '深潜续航', skillDescription: '扎实的耐力与踢腿控制让长距离推进更加稳定。',
        supportsSkinTone: false,
    },
    {
        id: 'cartonSwimmer14', name: '霓绿少女', modelVariantId: 'cartonSwimmer14', unlocked: true,
        stamina: 85, technique: 84, burst: 80,
        weight: 1.0,
        energyGain: 82,
        kick: 50,
        description: '身着荧绿装备的银发少女，以轻快稳定的节奏逐浪前行。',
        skillName: '霓绿节奏', skillDescription: '均衡的身体控制让连续划水与转身衔接更加顺畅。',
        supportsSkinTone: false,
    },
    {
        id: 'cartonSwimmer15', name: '破浪机甲', modelVariantId: 'cartonSwimmer15', unlocked: true,
        stamina: 85, technique: 84, burst: 80,
        weight: 1.0,
        energyGain: 82,
        kick: 50,
        description: '身披白绿装甲的机械泳者，以稳定节奏破浪前行。',
        skillName: '机甲节奏', skillDescription: '均衡的身体控制让连续划水与入水衔接更加顺畅。',
        supportsSkinTone: false,
    },
    {
        id: 'muscleMan', name: '铁臂狂鲨', modelVariantId: 'muscleMan', unlocked: true,
        stamina: 88, technique: 70, burst: 82,
        weight: 1.2,
        energyGain: 75,
        kick: 50,
        description: '力量型游泳选手，拥有强劲的划水爆发与稳定续航。',
        skillName: '强力划水', skillDescription: '稳定的力量输出让冲刺阶段更具压迫感。',
    },
];

export const PLAYER_SKIN_TONES: readonly PlayerSkinTone[] = [
    // Keep the imported MuscleMan skin as the default yellow tone.
    { id: 'warm', label: '黄', color: [255, 226, 191], preserveOriginal: true },
    { id: 'deep', label: '黑', color: [118, 76, 58] },
];

export const PLAYER_COLOR_SCHEMES: readonly PlayerColorScheme[] = [
    // Canonical white-key swimmers and newer green-mask swimmers both expose
    // their single replaceable colour through `suit`.
    { id: 'red', label: '红', suit: [255, 11, 11], cap: [22, 119, 232] },
    { id: 'blue', label: '蓝', suit: [51, 137, 255], cap: [245, 238, 220] },
    { id: 'yellow', label: '黄', suit: [255, 216, 0], cap: [255, 216, 0] },
    { id: 'purple', label: '紫', suit: [202, 79, 247], cap: [35, 220, 232] },
    { id: 'green', label: '绿', suit: [71, 222, 46], cap: [238, 246, 238] },
    { id: 'orange', label: '橙', suit: [255, 102, 0], cap: [31, 126, 222] },
    { id: 'cyan', label: '青', suit: [12, 224, 255], cap: [252, 238, 86] },
    { id: 'black', label: '黑', suit: [43, 43, 43], cap: [238, 240, 246] },
];

export type PlayerCharacterSelection = {
    characterId: PlayerCharacterId;
    skinToneId: PlayerSkinTone['id'];
    colorSchemeId: string;
};

export function createDefaultPlayerCharacterSelection(): PlayerCharacterSelection {
    const firstCharacter = PLAYER_CHARACTER_DEFINITIONS[0];
    if (!firstCharacter) {
        throw new Error('PLAYER_CHARACTER_DEFINITIONS must contain at least one character');
    }
    return {
        characterId: firstCharacter.id,
        skinToneId: PLAYER_SKIN_TONES[0].id,
        colorSchemeId: PLAYER_COLOR_SCHEMES[0].id,
    };
}

export function normalizePlayerCharacterSelection(raw: unknown): PlayerCharacterSelection {
    const fallback = createDefaultPlayerCharacterSelection();
    if (!raw || typeof raw !== 'object') return fallback;
    const src = raw as Partial<PlayerCharacterSelection>;
    const character = typeof src.characterId === 'string'
        ? PLAYER_CHARACTER_DEFINITIONS.find((entry) => entry.id === src.characterId && entry.unlocked)
        : null;
    const skinTone = typeof src.skinToneId === 'string'
        ? PLAYER_SKIN_TONES.find((entry) => entry.id === src.skinToneId)
        : null;
    const colorScheme = typeof src.colorSchemeId === 'string'
        ? PLAYER_COLOR_SCHEMES.find((entry) => entry.id === src.colorSchemeId)
        : null;
    return {
        characterId: character?.id ?? fallback.characterId,
        skinToneId: skinTone?.id ?? fallback.skinToneId,
        colorSchemeId: colorScheme?.id ?? fallback.colorSchemeId,
    };
}

let selection: PlayerCharacterSelection = createDefaultPlayerCharacterSelection();
let selectedRaceDifficulty: RaceDifficulty = 'competitive';

export function getPlayerCharacterSelection(): Readonly<PlayerCharacterSelection> { return selection; }

// Restore the complete appearance from persistent profile data. Validation keeps
// removed/renamed character ids in old saves from leaking into runtime systems.
export function restorePlayerCharacterSelection(saved: unknown): void {
    selection = normalizePlayerCharacterSelection(saved);
}

export function selectPlayerCharacter(id: PlayerCharacterId) {
    const character = findPlayerCharacter(id);
    if (character?.unlocked) selection = { ...selection, characterId: id };
}

export function cyclePlayerSkinTone() {
    if (!selectedPlayerCharacterSupportsSkinTone()) return;
    const index = PLAYER_SKIN_TONES.findIndex((tone) => tone.id === selection.skinToneId);
    selection = { ...selection, skinToneId: PLAYER_SKIN_TONES[(Math.max(0, index) + 1) % PLAYER_SKIN_TONES.length].id };
}

export function cyclePlayerColorScheme() {
    const index = PLAYER_COLOR_SCHEMES.findIndex((scheme) => scheme.id === selection.colorSchemeId);
    const nextIndex = index < 0 ? 0 : (index + 1) % PLAYER_COLOR_SCHEMES.length;
    selection = { ...selection, colorSchemeId: PLAYER_COLOR_SCHEMES[nextIndex].id };
}

export function setPlayerSkinTone(id: PlayerSkinTone['id'], characterId = selection.characterId) {
    if (!selectedPlayerCharacterSupportsSkinTone(characterId)) return;
    if (!PLAYER_SKIN_TONES.some((tone) => tone.id === id)) return;
    selection = { ...selection, skinToneId: id };
}

export function setPlayerColorScheme(id: string) {
    if (!PLAYER_COLOR_SCHEMES.some((scheme) => scheme.id === id)) return;
    selection = { ...selection, colorSchemeId: id };
}

export function findPlayerCharacter(id = selection.characterId): PlayerCharacterDefinition | null {
    return PLAYER_CHARACTER_DEFINITIONS.find((character) => character.id === id) ?? null;
}

// 将角色的物理体重（0.85~1.2 左右）归一化成 0-100 的“对抗”雷达轴分值。
// 底层 weight 仍驱动碰撞击退；这里只用于雷达图显示，刻意压缩差异（约 50~85），
// 让角色之间有区分但不至于像 0~100 那样悬殊。
export function weightToPhysicalRating(weight: number): number {
    return Math.max(0, Math.min(100, Math.round(50 + (weight - 0.85) * 100)));
}

export function selectedPlayerSkinTone(characterId = selection.characterId): PlayerSkinTone {
    if (!selectedPlayerCharacterSupportsSkinTone(characterId)) return PLAYER_SKIN_TONES[0];
    return PLAYER_SKIN_TONES.find((tone) => tone.id === selection.skinToneId) ?? PLAYER_SKIN_TONES[0];
}

export function selectedPlayerCharacterSupportsSkinTone(characterId = selection.characterId): boolean {
    return findPlayerCharacter(characterId)?.supportsSkinTone !== false;
}

export function selectedPlayerColorScheme(): PlayerColorScheme {
    return PLAYER_COLOR_SCHEMES.find((scheme) => scheme.id === selection.colorSchemeId) ?? PLAYER_COLOR_SCHEMES[0];
}

export function setSelectedRaceDifficulty(difficulty: RaceDifficulty) { selectedRaceDifficulty = difficulty; }
export function getSelectedRaceDifficulty(): RaceDifficulty { return selectedRaceDifficulty; }
