"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.characterAbilityForModel = exports.getSelectedRaceDifficulty = exports.setSelectedRaceDifficulty = exports.selectedPlayerColorScheme = exports.selectedPlayerCharacterSupportsSkinTone = exports.selectedPlayerSkinTone = exports.weightToPhysicalRating = exports.characterHeartRateTraitForModel = exports.characterWeightForModel = exports.findPlayerCharacter = exports.setPlayerColorScheme = exports.setPlayerSkinTone = exports.cyclePlayerColorScheme = exports.cyclePlayerSkinTone = exports.selectPlayerCharacter = exports.restorePlayerCharacterSelection = exports.getPlayerCharacterSelection = exports.normalizePlayerCharacterAppearances = exports.normalizePlayerCharacterSelection = exports.createDefaultPlayerCharacterSelection = exports.PLAYER_COLOR_SCHEMES = exports.PLAYER_SKIN_TONES = exports.PLAYER_CHARACTER_DEFINITIONS = void 0;
// Add a definition here to introduce a selectable character. The management
// 体力按爆发与体型做取舍：高爆发／重体型让出续航；这是角色基值，不是赛内动态扣减。
// roster derives its scrollable slot count from this catalog, and the formal
// race hand-off uses the same definitions directly.
exports.PLAYER_CHARACTER_DEFINITIONS = [
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
        id: 'cartonSwimmer16', name: '赛博少女', modelVariantId: 'cartonSwimmer16', unlocked: true,
        stamina: 125, technique: 100, burst: 75,
        weight: 1.00,
        energyGain: 82,
        heartRateTrait: 'balanced',
        description: '粉帽与机械义肢是她的标志，保持节奏，稳稳向前。',
        abilityId: 'none',
        skillName: '暂无专属技能', skillDescription: '均衡属性，稳步发挥\n暂无额外技能效果',
        supportsSkinTone: true,
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
exports.PLAYER_SKIN_TONES = [
    // Keep the imported MuscleMan skin as the default yellow tone.
    { id: 'warm', label: '黄', color: [255, 226, 191], preserveOriginal: true },
    { id: 'deep', label: '黑', color: [118, 76, 58] },
];
exports.PLAYER_COLOR_SCHEMES = [
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
function createDefaultPlayerCharacterSelection() {
    const firstCharacter = exports.PLAYER_CHARACTER_DEFINITIONS[0];
    if (!firstCharacter) {
        throw new Error('PLAYER_CHARACTER_DEFINITIONS must contain at least one character');
    }
    return {
        characterId: firstCharacter.id,
        skinToneId: exports.PLAYER_SKIN_TONES[0].id,
        colorSchemeId: exports.PLAYER_COLOR_SCHEMES[0].id,
    };
}
exports.createDefaultPlayerCharacterSelection = createDefaultPlayerCharacterSelection;
function normalizePlayerCharacterSelection(raw) {
    const fallback = createDefaultPlayerCharacterSelection();
    if (!raw || typeof raw !== 'object')
        return fallback;
    const src = raw;
    const character = typeof src.characterId === 'string'
        ? exports.PLAYER_CHARACTER_DEFINITIONS.find((entry) => entry.id === src.characterId && entry.unlocked)
        : null;
    const skinTone = typeof src.skinToneId === 'string'
        ? exports.PLAYER_SKIN_TONES.find((entry) => entry.id === src.skinToneId)
        : null;
    const colorScheme = typeof src.colorSchemeId === 'string'
        ? exports.PLAYER_COLOR_SCHEMES.find((entry) => entry.id === src.colorSchemeId)
        : null;
    return {
        characterId: character?.id ?? fallback.characterId,
        skinToneId: skinTone?.id ?? fallback.skinToneId,
        colorSchemeId: colorScheme?.id ?? fallback.colorSchemeId,
    };
}
exports.normalizePlayerCharacterSelection = normalizePlayerCharacterSelection;
/** 旧档只保留最后确认角色的外观；没有独立记录的角色使用默认值。 */
function normalizePlayerCharacterAppearances(raw, legacy) {
    const result = {};
    const saved = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const last = normalizePlayerCharacterSelection(legacy);
    for (const character of exports.PLAYER_CHARACTER_DEFINITIONS) {
        if (!character.unlocked)
            continue;
        const entry = Object.prototype.hasOwnProperty.call(saved, character.id) ? saved[character.id]
            : character.id === last.characterId ? last : undefined;
        const value = normalizePlayerCharacterSelection({ ...entry, characterId: character.id });
        result[character.id] = { skinToneId: character.supportsSkinTone === false ? 'warm' : value.skinToneId,
            colorSchemeId: value.colorSchemeId };
    }
    return result;
}
exports.normalizePlayerCharacterAppearances = normalizePlayerCharacterAppearances;
let selection = createDefaultPlayerCharacterSelection();
let appearances = normalizePlayerCharacterAppearances(undefined, selection);
let selectedRaceDifficulty = 'competitive';
function getPlayerCharacterSelection(characterId = selection.characterId) {
    if (characterId === selection.characterId)
        return selection;
    const appearance = appearances[characterId] ?? createDefaultPlayerCharacterSelection();
    return { characterId, skinToneId: appearance.skinToneId, colorSchemeId: appearance.colorSchemeId };
}
exports.getPlayerCharacterSelection = getPlayerCharacterSelection;
function restorePlayerCharacterSelection(saved, savedAppearances) {
    selection = normalizePlayerCharacterSelection(saved);
    appearances = normalizePlayerCharacterAppearances(savedAppearances, selection);
    selection = { characterId: selection.characterId, ...appearances[selection.characterId] };
}
exports.restorePlayerCharacterSelection = restorePlayerCharacterSelection;
function selectPlayerCharacter(id) {
    const character = findPlayerCharacter(id);
    if (character?.unlocked)
        selection = { characterId: id, ...appearances[id] };
}
exports.selectPlayerCharacter = selectPlayerCharacter;
function updateAppearance(characterId, patch) {
    if (!findPlayerCharacter(characterId)?.unlocked)
        return;
    appearances[characterId] = { ...appearances[characterId], ...patch };
    if (selection.characterId === characterId)
        selection = { ...selection, ...appearances[characterId] };
}
function cyclePlayerSkinTone() {
    const index = exports.PLAYER_SKIN_TONES.findIndex((tone) => tone.id === selection.skinToneId);
    setPlayerSkinTone(exports.PLAYER_SKIN_TONES[(Math.max(0, index) + 1) % exports.PLAYER_SKIN_TONES.length].id);
}
exports.cyclePlayerSkinTone = cyclePlayerSkinTone;
function cyclePlayerColorScheme() {
    const index = exports.PLAYER_COLOR_SCHEMES.findIndex((scheme) => scheme.id === selection.colorSchemeId);
    setPlayerColorScheme(exports.PLAYER_COLOR_SCHEMES[index < 0 ? 0 : (index + 1) % exports.PLAYER_COLOR_SCHEMES.length].id);
}
exports.cyclePlayerColorScheme = cyclePlayerColorScheme;
function setPlayerSkinTone(id, characterId = selection.characterId) {
    if (!selectedPlayerCharacterSupportsSkinTone(characterId))
        return;
    if (!exports.PLAYER_SKIN_TONES.some((tone) => tone.id === id))
        return;
    updateAppearance(characterId, { skinToneId: id });
}
exports.setPlayerSkinTone = setPlayerSkinTone;
function setPlayerColorScheme(id, characterId = selection.characterId) {
    if (!exports.PLAYER_COLOR_SCHEMES.some((scheme) => scheme.id === id))
        return;
    updateAppearance(characterId, { colorSchemeId: id });
}
exports.setPlayerColorScheme = setPlayerColorScheme;
function findPlayerCharacter(id = selection.characterId) {
    return exports.PLAYER_CHARACTER_DEFINITIONS.find((character) => character.id === id) ?? null;
}
exports.findPlayerCharacter = findPlayerCharacter;
// AI 外形也使用相同固有体重；仅在创建或重选模型时读取，不参与逐帧工作。
function characterWeightForModel(modelVariantId) {
    return exports.PLAYER_CHARACTER_DEFINITIONS.find((character) => character.modelVariantId === modelVariantId)?.weight ?? 1;
}
exports.characterWeightForModel = characterWeightForModel;
// AI 与玩家从同一份角色配置读取，未知模型保持均衡。
function characterHeartRateTraitForModel(modelVariantId) {
    return exports.PLAYER_CHARACTER_DEFINITIONS.find((character) => character.modelVariantId === modelVariantId)?.heartRateTrait ?? 'balanced';
}
exports.characterHeartRateTraitForModel = characterHeartRateTraitForModel;
// 体重 0.85～1.30 映射为对抗雷达 50～95；仅展示，碰撞仍直接使用体重。
function weightToPhysicalRating(weight) {
    return Math.max(0, Math.min(100, Math.round(50 + (weight - 0.85) * 100)));
}
exports.weightToPhysicalRating = weightToPhysicalRating;
function selectedPlayerSkinTone(characterId = selection.characterId) {
    if (!selectedPlayerCharacterSupportsSkinTone(characterId))
        return exports.PLAYER_SKIN_TONES[0];
    return exports.PLAYER_SKIN_TONES.find((tone) => tone.id === getPlayerCharacterSelection(characterId).skinToneId) ?? exports.PLAYER_SKIN_TONES[0];
}
exports.selectedPlayerSkinTone = selectedPlayerSkinTone;
function selectedPlayerCharacterSupportsSkinTone(characterId = selection.characterId) {
    return findPlayerCharacter(characterId)?.supportsSkinTone !== false;
}
exports.selectedPlayerCharacterSupportsSkinTone = selectedPlayerCharacterSupportsSkinTone;
function selectedPlayerColorScheme(characterId = selection.characterId) {
    return exports.PLAYER_COLOR_SCHEMES.find((scheme) => scheme.id === getPlayerCharacterSelection(characterId).colorSchemeId) ?? exports.PLAYER_COLOR_SCHEMES[0];
}
exports.selectedPlayerColorScheme = selectedPlayerColorScheme;
function setSelectedRaceDifficulty(difficulty) { selectedRaceDifficulty = difficulty; }
exports.setSelectedRaceDifficulty = setSelectedRaceDifficulty;
function getSelectedRaceDifficulty() { return selectedRaceDifficulty; }
exports.getSelectedRaceDifficulty = getSelectedRaceDifficulty;
function characterAbilityForModel(modelVariantId) {
    return exports.PLAYER_CHARACTER_DEFINITIONS.find(character => character.modelVariantId === modelVariantId)?.abilityId ?? 'none';
}
exports.characterAbilityForModel = characterAbilityForModel;
