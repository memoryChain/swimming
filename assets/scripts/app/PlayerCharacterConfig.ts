import { RaceDifficulty } from '../core/GameBalance';

export type PlayerCharacterId = 'muscleMan' | 'women2' | 'lowPolyHuman2' | 'diver';

// The current project has no final skill art yet. This keeps the temporary
// program-drawn badge semantic in the character data instead of UI code.
export type PlayerSkillIconKind = 'shark' | 'charm' | 'dash' | 'siren';

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
    skillFlavorText: string;
    skillIconKind: PlayerSkillIconKind;
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

// Keep an even slot count: the roster lays characters out in two columns.
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
        skillName: '召唤鲨鱼',
        skillDescription: '召来鲨鱼追逐最近的选手；所有人都可能成为目标。',
        skillFlavorText: '村里人都叫他干柿鬼鲛。',
        skillIconKind: 'shark',
    },
    {
        id: 'women2', name: '灵波飞鱼', modelVariantId: 'women2', unlocked: true,
        stamina: 82, technique: 91, burst: 76,
        weight: 0.85,
        energyGain: 92,
        kick: 50,
        description: '技术型女选手，划水节奏细腻，能在中后程保持高效推进。',
        skillName: '心潮魅惑',
        skillDescription: '向正前方射出爱心，命中首名对手，使其短暂停在原地。',
        skillFlavorText: '别回头，她真的在看你。',
        skillIconKind: 'charm',
    },
    {
        id: 'lowPolyHuman2', name: '破浪新星', modelVariantId: 'lowPolyHuman2', unlocked: true,
        stamina: 85, technique: 84, burst: 80,
        weight: 1.0,
        energyGain: 82,
        kick: 50,
        description: '均衡型游泳选手，动作灵活，能稳定应对不同比赛节奏。',
        skillName: '劈波突进',
        skillDescription: '沿当前朝向极速突进，并撞开前方同向的首名对手。',
        skillFlavorText: '水花是他的签名，背影也是。',
        skillIconKind: 'dash',
    },
    {
        id: 'diver', name: '深海潜将', modelVariantId: 'diver', unlocked: true,
        stamina: 92, technique: 78, burst: 74,
        weight: 1.15,
        energyGain: 80,
        kick: 50,
        description: '装备齐全的潜水选手，身体稳定，擅长保持持续而扎实的推进。',
        skillName: '海妖之歌',
        skillDescription: '短暂蓄力后释放声波，使附近对手陷入短暂睡眠。',
        skillFlavorText: '闭眼三秒，醒来已经落后一截。',
        skillIconKind: 'siren',
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

export function getPlayerCharacterSelection(): Readonly<PlayerCharacterSelection> { return selection; }

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

export function setPlayerSkinTone(id: PlayerSkinTone['id']) {
    if (!selectedPlayerCharacterSupportsSkinTone()) return;
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

export function selectedPlayerSkinTone(): PlayerSkinTone {
    if (!selectedPlayerCharacterSupportsSkinTone()) return PLAYER_SKIN_TONES[0];
    return PLAYER_SKIN_TONES.find((tone) => tone.id === selection.skinToneId) ?? PLAYER_SKIN_TONES[0];
}

export function selectedPlayerCharacterSupportsSkinTone(): boolean {
    return findPlayerCharacter()?.supportsSkinTone !== false;
}

export function selectedPlayerColorScheme(): PlayerColorScheme {
    return PLAYER_COLOR_SCHEMES.find((scheme) => scheme.id === selection.colorSchemeId) ?? PLAYER_COLOR_SCHEMES[0];
}

export function setSelectedRaceDifficulty(difficulty: RaceDifficulty) { selectedRaceDifficulty = difficulty; }
export function getSelectedRaceDifficulty(): RaceDifficulty { return selectedRaceDifficulty; }
