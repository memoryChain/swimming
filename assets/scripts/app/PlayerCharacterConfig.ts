import type { CharacterAbilityId } from '../core/CharacterAbilityConfig';
import { HeartRateTraitId } from '../core/ConditionBalance';
import { RaceDifficulty } from '../core/GameBalance';

export type PlayerCharacterId = 'muscleMan' | 'cartonSwimmer5' | 'cartonSwimmer6' | 'cartonSwimmer8' | 'cartonSwimmer9' | 'cartonSwimmer10' | 'cartonSwimmer11' | 'cartonSwimmer12' | 'cartonSwimmer13' | 'cartonSwimmer14' | 'cartonSwimmer15';

export type PlayerCharacterDefinition = {
    id: PlayerCharacterId;
    name: string;
    modelVariantId: string;
    unlocked: boolean;
    // 仅体力、技巧、爆发力参与等级成长。
    stamina: number;
    technique: number;
    burst: number;
    // 固有体重，不随等级成长；用于碰撞击退分配，重角色更难被撞开。
    weight: number;
    // 蓄气资质（0-100，纯资质、不随等级成长）。决定赛内大招能量的积攒速率。
    energyGain: number;
    // 固有心率特性：升温慢的角色恢复也慢，不随养成改变。
    heartRateTrait: HeartRateTraitId;
    description: string;
    abilityId: CharacterAbilityId;
    skillName: string;
    // 两行短文案，每行至多 11 个全角字，适配角色页 190px 文本框。
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
// 体力按爆发与体型做取舍：高爆发／重体型让出续航；这是角色基值，不是赛内动态扣减。
// roster derives its scrollable slot count from this catalog, and the formal
// race hand-off uses the same definitions directly.
export const PLAYER_CHARACTER_DEFINITIONS: readonly PlayerCharacterDefinition[] = [
    {
        id: 'cartonSwimmer6', name: '蛙妹', modelVariantId: 'cartonSwimmer6', unlocked: true,
        stamina: 140, technique: 90, burst: 60,
        weight: 0.85,
        energyGain: 82,
        heartRateTrait: 'balanced',
        description: '圆耳帽下藏着出色水感，划得稳，比划得猛更拿手。',
        abilityId: 'frogSense',
        skillName: '水感天赋', skillDescription: '更容易划出完美\n但完美划水加速较少',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer8', name: '蛙少', modelVariantId: 'cartonSwimmer8', unlocked: true,
        stamina: 125, technique: 102, burst: 65,
        weight: 1.00,
        energyGain: 82,
        heartRateTrait: 'balanced',
        description: '青蛙帽少年爱蹦也会蹦，用频繁的小跳逐段追赶。',
        abilityId: 'frogHop',
        skillName: '小蛙连跳', skillDescription: '海豚跳攒得快、更省体力\n但每次跳得较近',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer5', name: '超级腿', modelVariantId: 'cartonSwimmer5', unlocked: true,
        stamina: 105, technique: 94, burst: 90,
        weight: 0.95,
        energyGain: 82,
        heartRateTrait: 'quick',
        description: '轻装运动少女练出一双强腿，停手踢腿也能向前追。',
        abilityId: 'powerKick',
        skillName: '腿比手好使', skillDescription: '踢腿能游得更快\n但用手划水力气较小',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer9', name: '猫姐', modelVariantId: 'cartonSwimmer9', unlocked: true,
        stamina: 145, technique: 92, burst: 55,
        weight: 0.95,
        energyGain: 82,
        heartRateTrait: 'quick',
        description: '猫耳少女身轻灵巧，撞得开她，却很难让她一直失控。',
        abilityId: 'catBalance',
        skillName: '猫式平衡', skillDescription: '被撞翻后能很快稳住\n但身体轻，容易被撞开',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer10', name: '忍者哥', modelVariantId: 'cartonSwimmer10', unlocked: true,
        stamina: 115, technique: 114, burst: 75,
        weight: 1.00,
        energyGain: 82,
        heartRateTrait: 'balanced',
        description: '忍者哥讲究精准出手，每一划都要落在最好的时机。',
        abilityId: 'precision',
        skillName: '精准发力', skillDescription: '松手要准，完美加速更强\n没划准时，加速较弱',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer11', name: '健身教练', modelVariantId: 'cartonSwimmer11', unlocked: true,
        stamina: 100, technique: 92, burst: 85,
        weight: 1.15,
        energyGain: 82,
        heartRateTrait: 'steady',
        description: '健身教练擅长控制呼吸，按自己的节奏稳步发力。',
        abilityId: 'breathControl',
        skillName: '呼吸管理', skillDescription: '划水别太急，心跳更平稳\n划得太快就失去这个优势',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer12', name: '飞毛腿', modelVariantId: 'cartonSwimmer12', unlocked: true,
        stamina: 115, technique: 110, burst: 80,
        weight: 0.95,
        energyGain: 84,
        heartRateTrait: 'quick',
        description: '飞毛腿把池壁当起跑线，每次折返都是追赶的机会。',
        abilityId: 'wallKick',
        skillName: '蹬墙起飞', skillDescription: '蹬墙后冲得更快\n但平时划水力气较小',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer13', name: '潜水哥', modelVariantId: 'cartonSwimmer13', unlocked: true,
        stamina: 150, technique: 104, burst: 45,
        weight: 1.15,
        energyGain: 80,
        heartRateTrait: 'steady',
        description: '短按踢腿潜入水下避开对手，划水或停踢就会上浮，不能使用海豚跳。',
        abilityId: 'kickDive',
        skillName: '踢腿潜航', skillDescription: '踢腿潜入水下，避开碰撞\n划水上浮，不能海豚跳',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer14', name: '风火轮', modelVariantId: 'cartonSwimmer14', unlocked: true,
        stamina: 125, technique: 100, burst: 70,
        weight: 0.90,
        energyGain: 82,
        heartRateTrait: 'quick',
        description: '风火轮越划越顺，连续划准就能越游越快。',
        abilityId: 'perfectChain',
        skillName: '风火连划', skillDescription: '连续划出完美，越游越快\n失误或停太久，奖励消失',
        supportsSkinTone: true,
    },
    {
        id: 'cartonSwimmer15', name: '机甲coser', modelVariantId: 'cartonSwimmer15', unlocked: true,
        stamina: 85, technique: 86, burst: 95,
        weight: 1.25,
        energyGain: 82,
        heartRateTrait: 'slow',
        description: '装甲动力管够，里面的人仍要把握划水节奏。',
        abilityId: 'exoskeleton',
        skillName: '动力外骨骼', skillDescription: '划水不消耗体力\n机甲太僵硬，不能海豚跳',
        supportsSkinTone: false,
    },
    {
        id: 'muscleMan', name: '肌肉男', modelVariantId: 'muscleMan', unlocked: true,
        stamina: 80, technique: 84, burst: 100,
        weight: 1.30,
        energyGain: 75,
        heartRateTrait: 'slow',
        description: '肌肉男凭扎实体型争夺位置，正面碰撞就是他的主场。',
        abilityId: 'heavyBody',
        skillName: '重量优势', skillDescription: '身体重，能把对手撞开\n自己不容易被撞偏',
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
    // 用户选定的试用配色；追加稳定 ID，保留既有颜色和存档。
    { id: 'soft-lilac', label: '柔藤紫', suit: [160, 138, 198], cap: [160, 138, 198] },
    { id: 'lime', label: '青柠绿', suit: [173, 217, 54], cap: [173, 217, 54] },
    { id: 'lake-teal', label: '湖水青', suit: [70, 170, 165], cap: [70, 170, 165] },
    { id: 'deep-ocean', label: '深海蓝', suit: [53, 77, 112], cap: [53, 77, 112] },
    { id: 'cherry-red', label: '樱桃红', suit: [233, 54, 79], cap: [233, 54, 79] },
    { id: 'strawberry-pink', label: '草莓粉', suit: [255, 117, 158], cap: [255, 117, 158] },
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

// AI 外形也使用相同固有体重；仅在创建或重选模型时读取，不参与逐帧工作。
export function characterWeightForModel(modelVariantId: string): number {
    return PLAYER_CHARACTER_DEFINITIONS.find((character) => character.modelVariantId === modelVariantId)?.weight ?? 1;
}

// AI 与玩家从同一份角色配置读取，未知模型保持均衡。
export function characterHeartRateTraitForModel(modelVariantId: string): HeartRateTraitId {
    return PLAYER_CHARACTER_DEFINITIONS.find((character) => character.modelVariantId === modelVariantId)?.heartRateTrait ?? 'balanced';
}

// 体重 0.85～1.30 映射为对抗雷达 50～95；仅展示，碰撞仍直接使用体重。
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

export function characterAbilityForModel(modelVariantId: string): CharacterAbilityId {
    return PLAYER_CHARACTER_DEFINITIONS.find(character => character.modelVariantId === modelVariantId)?.abilityId ?? 'none';
}
