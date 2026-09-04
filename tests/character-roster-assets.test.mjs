import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import CharacterConfig from '../assets/scripts/app/PlayerCharacterConfig.ts';
import Resources from '../assets/scripts/core/ResourcePaths.ts';
import Protocol from '../assets/scripts/net/NetRaceProtocol.ts';
import ModifierCodec from '../assets/scripts/net/NetRaceModifierCodec.ts';
import IdentityConfig from '../assets/scripts/backend/IdentityConfig.ts';
import PlayerProfileConfig from '../assets/scripts/backend/PlayerProfile.ts';

const root = new URL('../', import.meta.url);
const { PLAYER_CHARACTER_DEFINITIONS, getPlayerCharacterSelection, selectPlayerCharacter,
    createDefaultPlayerCharacterSelection, normalizePlayerCharacterSelection,
    setPlayerColorScheme, setPlayerSkinTone, selectedPlayerSkinTone,
    selectedPlayerColorScheme, selectedPlayerCharacterSupportsSkinTone } = CharacterConfig;

test('首次选择取角色列表首位，存档选择通过稳定 ID 迁移', () => {
    assert.deepEqual(createDefaultPlayerCharacterSelection(), {
        characterId: PLAYER_CHARACTER_DEFINITIONS[0].id,
        skinToneId: 'warm',
        colorSchemeId: 'red',
    });
    assert.equal(createDefaultPlayerCharacterSelection().characterId, 'cartonSwimmer6');
    assert.deepEqual(normalizePlayerCharacterSelection({
        characterId: 'cartonSwimmer9',
        skinToneId: 'deep',
        colorSchemeId: 'purple',
    }), {
        characterId: 'cartonSwimmer9',
        skinToneId: 'deep',
        colorSchemeId: 'purple',
    });
    assert.deepEqual(normalizePlayerCharacterSelection({
        characterId: 'removed-character',
        skinToneId: 'removed-tone',
        colorSchemeId: 'removed-color',
    }), createDefaultPlayerCharacterSelection());
    assert.equal(PlayerProfileConfig.createDefaultProfile().characterSelection.characterId, 'cartonSwimmer6');
    assert.equal(PlayerProfileConfig.normalizeProfile({ schema: 3 }).characterSelection.characterId, 'cartonSwimmer6');
});

test('联网头像通过稳定 ID 映射角色外观', () => {
    const avatarIds = IdentityConfig.AVATARS.map((avatar) => avatar.id);
    assert.deepEqual(Object.keys(IdentityConfig.AVATAR_SWIMMER_LOOK_BY_ID).sort(), [...avatarIds].sort());
    for (const avatarId of avatarIds) {
        const look = IdentityConfig.avatarSwimmerLookOf(avatarId);
        assert.equal(look, IdentityConfig.AVATAR_SWIMMER_LOOK_BY_ID[avatarId]);
        assert.ok(Resources.findSwimmerModelVariant(look.modelVariantId), `${avatarId} model=${look.modelVariantId}`);
        assert.ok(Resources.findSwimmerColorVariant(look.colorVariantId), `${avatarId} color=${look.colorVariantId}`);
        assert.ok(CharacterConfig.PLAYER_SKIN_TONES.some((tone) => tone.id === look.skinToneId),
            `${avatarId} skin=${look.skinToneId}`);
    }
    assert.equal(IdentityConfig.avatarSwimmerLookOf('unknown-avatar'),
        IdentityConfig.AVATAR_SWIMMER_LOOK_BY_ID.aqua);
});

test('可选角色均有唯一模型，并复用标准动作资源', () => {
    const characters = PLAYER_CHARACTER_DEFINITIONS;
    const expectedCharacterIds = ['cartonSwimmer6', 'cartonSwimmer8', 'cartonSwimmer5',
        'cartonSwimmer9', 'cartonSwimmer10', 'cartonSwimmer11', 'cartonSwimmer12', 'muscleMan'];
    const expectedModelIds = ['muscleMan', 'cartonSwimmer5', 'cartonSwimmer6',
        'cartonSwimmer8', 'cartonSwimmer9', 'cartonSwimmer10', 'cartonSwimmer11', 'cartonSwimmer12'];
    assert.deepEqual(characters.map(c => c.id), expectedCharacterIds);
    assert.deepEqual(Resources.SWIMMER_MODEL_VARIANTS.map(c => c.id), expectedModelIds);
    assert.equal(new Set(characters.map(c => c.id)).size, characters.length);
    assert.equal(new Set(Resources.SWIMMER_MODEL_VARIANTS.map(c => c.id)).size,
        Resources.SWIMMER_MODEL_VARIANTS.length);
    for (const character of characters) {
        const model = Resources.findSwimmerModelVariant(character.modelVariantId);
        assert.ok(model, character.id);
        assert.ok(fs.existsSync(new URL(`assets/race/${model.candidates[0]}.glb`, root)));
        assert.equal(model.sampledActionOverrideDir, 'model-actions/tPose');
        assert.ok(fs.existsSync(new URL(`assets/race/${model.divePrepOverridePath}.json`, root)));
    }
    assert.equal(Resources.findSwimmerModelVariant('muscleMan').modelScaleMultiplier, undefined);
    for (const id of expectedModelIds.slice(1)) {
        const multiplier = Resources.findSwimmerModelVariant(id).modelScaleMultiplier;
        assert.equal(Number.isFinite(multiplier), true, `${id} modelScaleMultiplier`);
        assert.ok(multiplier >= 0.5 && multiplier <= 2, `${id} modelScaleMultiplier=${multiplier}`);
    }
});

test('逐浪少女配色与肤色独立，恢复暖肤色保留原图', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        selectPlayerCharacter('cartonSwimmer5');
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer5');
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), true);
        const model = Resources.findSwimmerModelVariant('cartonSwimmer5');
        assert.equal(model.dynamicColor.mode, 'mask');
        assert.equal(model.dynamicColor.usesCapChannel, false);
        assert.equal(model.dynamicColor.maskPath, 'models/CartonSwimmer5ColorMask/texture');
        for (let i = 0; i < 20; ++i) {
            setPlayerSkinTone('deep');
            setPlayerColorScheme(i % 2 ? 'blue' : 'red');
            assert.equal(selectedPlayerSkinTone().id, 'deep');
            assert.equal(selectedPlayerColorScheme().id, i % 2 ? 'blue' : 'red');
            setPlayerSkinTone('warm');
            assert.equal(selectedPlayerSkinTone().preserveOriginal, true);
        }
    } finally {
        selectPlayerCharacter(previous.characterId);
        setPlayerSkinTone(previous.skinToneId);
        setPlayerColorScheme(previous.colorSchemeId);
    }
});

test('新角色养成摘要可往返，旧角色表协议被拒绝', () => {
    const digest = { characterId: 'cartonSwimmer8', level: 7 };
    assert.deepEqual(ModifierCodec.decodeModifierDigest(ModifierCodec.encodeModifierDigest(digest)), digest);
    assert.equal(Protocol.isCompatibleProtocolVersion(7), false);
    assert.equal(Protocol.isCompatibleProtocolVersion(Protocol.NET_RACE_PROTOCOL_VERSION), true);
});

test('逐浪少女保持单网格单材质与 41 骨骼，遮罩为独立小纹理', () => {
    const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer5.glb', root));
    const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
    assert.equal(doc.meshes.length, 1);
    assert.equal(doc.materials.length, 1);
    assert.equal(doc.meshes[0].primitives.length, 1);
    assert.equal(doc.skins[0].joints.length, 41);
    assert.equal(doc.accessors[doc.meshes[0].primitives[0].indices].count / 3, 5338);
    const png = fs.readFileSync(new URL('assets/race/models/CartonSwimmer5ColorMask.png', root));
    assert.equal(png.readUInt32BE(16), 512);
    assert.equal(png.readUInt32BE(20), 512);
    assert.equal(png[25], 6);
});

test('跃浪少女配色与肤色独立，恢复暖肤色保留原图', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        selectPlayerCharacter('cartonSwimmer6');
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer6');
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), true);
        const model = Resources.findSwimmerModelVariant('cartonSwimmer6');
        assert.equal(model.dynamicColor.mode, 'mask');
        assert.equal(model.dynamicColor.usesCapChannel, false);
        assert.equal(model.dynamicColor.maskPath, 'models/CartonSwimmer6ColorMask/texture');
        for (let i = 0; i < 20; ++i) {
            setPlayerSkinTone('deep');
            setPlayerColorScheme(i % 2 ? 'blue' : 'red');
            assert.equal(selectedPlayerSkinTone().id, 'deep');
            assert.equal(selectedPlayerColorScheme().id, i % 2 ? 'blue' : 'red');
            setPlayerSkinTone('warm');
            assert.equal(selectedPlayerSkinTone().preserveOriginal, true);
        }
    } finally {
        selectPlayerCharacter(previous.characterId);
        setPlayerSkinTone(previous.skinToneId);
        setPlayerColorScheme(previous.colorSchemeId);
    }
});


test('跃浪少女保持单网格单材质与 41 骨骼，遮罩为独立小纹理', () => {
    const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer6.glb', root));
    const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
    assert.equal(doc.meshes.length, 1);
    assert.equal(doc.materials.length, 1);
    assert.equal(doc.meshes[0].primitives.length, 1);
    assert.equal(doc.skins[0].joints.length, 41);
    assert.equal(doc.accessors[doc.meshes[0].primitives[0].indices].count / 3, 5705);
    const png = fs.readFileSync(new URL('assets/race/models/CartonSwimmer6ColorMask.png', root));
    assert.equal(png.readUInt32BE(16), 512);
    assert.equal(png.readUInt32BE(20), 512);
    assert.equal(png[25], 6);
});

test('蛙跃潮童服装与肤色独立切换，资源遵守移动端预算', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        selectPlayerCharacter('cartonSwimmer8');
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer8');
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), true);
        const model = Resources.findSwimmerModelVariant('cartonSwimmer8');
        assert.equal(model.dynamicColor.mode, 'mask');
        assert.equal(model.dynamicColor.usesCapChannel, false);
        assert.equal(model.dynamicColor.maskPath, 'models/CartonSwimmer8ColorMask/texture');
        for (let i = 0; i < 20; ++i) {
            setPlayerSkinTone('deep');
            setPlayerColorScheme(i % 2 ? 'blue' : 'red');
            assert.equal(selectedPlayerSkinTone().id, 'deep');
            assert.equal(selectedPlayerColorScheme().id, i % 2 ? 'blue' : 'red');
            setPlayerSkinTone('warm');
            assert.equal(selectedPlayerSkinTone().preserveOriginal, true);
        }
        const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer8.glb', root));
        const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
        assert.equal(doc.meshes.length, 1);
        assert.equal(doc.materials.length, 1);
        assert.equal(doc.meshes[0].primitives.length, 1);
        assert.equal(doc.skins[0].joints.length, 41);
        assert.ok(doc.accessors[doc.meshes[0].primitives[0].indices].count / 3 <= 6000);
        const png = fs.readFileSync(new URL('assets/race/models/CartonSwimmer8ColorMask.png', root));
        assert.equal(png.readUInt32BE(16), 512);
        assert.equal(png.readUInt32BE(20), 512);
        assert.equal(png[25], 6);
    } finally {
        selectPlayerCharacter(previous.characterId);
        setPlayerSkinTone(previous.skinToneId);
        setPlayerColorScheme(previous.colorSchemeId);
    }
});

test('霓光灵猫复用共享骨架动作，UV 重排后仍满足移动端预算', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        selectPlayerCharacter('cartonSwimmer9');
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer9');
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), true);
        const model = Resources.findSwimmerModelVariant('cartonSwimmer9');
        assert.equal(model.dynamicColor.mode, 'mask');
        assert.equal(model.dynamicColor.usesCapChannel, false);
        assert.equal(model.dynamicColor.maskPath, 'models/CartonSwimmer9ColorMask/texture');
        assert.equal(model.sampledActionOverrideDir, 'model-actions/tPose');

        const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer9.glb', root));
        const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
        const primitive = doc.meshes[0].primitives[0];
        assert.equal(doc.meshes.length, 1);
        assert.equal(doc.materials.length, 1);
        assert.equal(doc.meshes[0].primitives.length, 1);
        assert.equal(doc.skins[0].joints.length, 41);
        assert.equal(doc.accessors[primitive.indices].count / 3, 5675);
        assert.ok(doc.accessors[primitive.attributes.POSITION].count <= 5700);
        assert.ok(data.length <= 512 * 1024);

        const png = fs.readFileSync(new URL('assets/race/models/CartonSwimmer9ColorMask.png', root));
        assert.equal(png.readUInt32BE(16), 512);
        assert.equal(png.readUInt32BE(20), 512);
        assert.equal(png[25], 6);
    } finally {
        selectPlayerCharacter(previous.characterId);
        setPlayerSkinTone(previous.skinToneId);
        setPlayerColorScheme(previous.colorSchemeId);
    }
});

test('青影忍浪复用共享骨架动作，UV 重排后仍满足移动端预算', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        selectPlayerCharacter('cartonSwimmer10');
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer10');
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), true);
        const model = Resources.findSwimmerModelVariant('cartonSwimmer10');
        assert.equal(model.dynamicColor.mode, 'mask');
        assert.equal(model.dynamicColor.usesCapChannel, false);
        assert.equal(model.dynamicColor.maskPath, 'models/CartonSwimmer10ColorMask/texture');
        assert.equal(model.sampledActionOverrideDir, 'model-actions/tPose');

        const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer10.glb', root));
        const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
        const primitive = doc.meshes[0].primitives[0];
        assert.equal(doc.meshes.length, 1);
        assert.equal(doc.materials.length, 1);
        assert.equal(doc.meshes[0].primitives.length, 1);
        assert.equal(doc.skins[0].joints.length, 41);
        assert.equal(doc.accessors[primitive.indices].count / 3, 5551);
        assert.ok(doc.accessors[primitive.attributes.POSITION].count <= 6000);
        assert.ok(data.length <= 512 * 1024);

        const png = fs.readFileSync(new URL('assets/race/models/CartonSwimmer10ColorMask.png', root));
        assert.equal(png.readUInt32BE(16), 512);
        assert.equal(png.readUInt32BE(20), 512);
        assert.equal(png[25], 6);
    } finally {
        selectPlayerCharacter(previous.characterId);
        setPlayerSkinTone(previous.skinToneId);
        setPlayerColorScheme(previous.colorSchemeId);
    }
});

test('疾风浪客修正肘部后复用共享骨架动作，资源满足移动端预算', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        selectPlayerCharacter('cartonSwimmer11');
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer11');
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), true);
        const model = Resources.findSwimmerModelVariant('cartonSwimmer11');
        assert.equal(model.dynamicColor.mode, 'mask');
        assert.equal(model.dynamicColor.usesCapChannel, false);
        assert.equal(model.dynamicColor.maskPath, 'models/CartonSwimmer11ColorMask/texture');
        assert.equal(model.sampledActionOverrideDir, 'model-actions/tPose');

        const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer11.glb', root));
        const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
        const primitive = doc.meshes[0].primitives[0];
        assert.equal(doc.meshes.length, 1);
        assert.equal(doc.materials.length, 1);
        assert.equal(doc.meshes[0].primitives.length, 1);
        assert.equal(doc.skins[0].joints.length, 41);
        assert.equal(doc.accessors[primitive.indices].count / 3, 5611);
        assert.equal(doc.accessors[primitive.attributes.POSITION].count, 3892);
        assert.ok(data.length <= 512 * 1024);

        const png = fs.readFileSync(new URL('assets/race/models/CartonSwimmer11ColorMask.png', root));
        assert.equal(png.readUInt32BE(16), 512);
        assert.equal(png.readUInt32BE(20), 512);
        assert.equal(png[25], 6);
    } finally {
        selectPlayerCharacter(previous.characterId);
        setPlayerSkinTone(previous.skinToneId);
        setPlayerColorScheme(previous.colorSchemeId);
    }
});

test('绿电潮童复用共享骨架动作，换色遮罩与模型满足移动端预算', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        selectPlayerCharacter('cartonSwimmer12');
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer12');
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), true);
        const model = Resources.findSwimmerModelVariant('cartonSwimmer12');
        assert.equal(model.dynamicColor.mode, 'mask');
        assert.equal(model.dynamicColor.usesCapChannel, false);
        assert.equal(model.dynamicColor.maskPath, 'models/CartonSwimmer12ColorMask/texture');
        assert.equal(model.sampledActionOverrideDir, 'model-actions/tPose');

        const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer12.glb', root));
        const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
        const primitive = doc.meshes[0].primitives[0];
        assert.equal(doc.meshes.length, 1);
        assert.equal(doc.materials.length, 1);
        assert.equal(doc.meshes[0].primitives.length, 1);
        assert.equal(doc.skins[0].joints.length, 41);
        assert.equal(doc.accessors[primitive.indices].count / 3, 5525);
        assert.equal(doc.accessors[primitive.attributes.POSITION].count, 4085);
        assert.ok(data.length <= 512 * 1024);

        const png = fs.readFileSync(new URL('assets/race/models/CartonSwimmer12ColorMask.png', root));
        assert.equal(png.readUInt32BE(16), 512);
        assert.equal(png.readUInt32BE(20), 512);
        assert.equal(png[25], 6);
    } finally {
        selectPlayerCharacter(previous.characterId);
        setPlayerSkinTone(previous.skinToneId);
        setPlayerColorScheme(previous.colorSchemeId);
    }
});
