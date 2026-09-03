import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import CharacterConfig from '../assets/scripts/app/PlayerCharacterConfig.ts';
import Resources from '../assets/scripts/core/ResourcePaths.ts';
import Protocol from '../assets/scripts/net/NetRaceProtocol.ts';
import ModifierCodec from '../assets/scripts/net/NetRaceModifierCodec.ts';

const root = new URL('../', import.meta.url);
const { PLAYER_CHARACTER_DEFINITIONS, getPlayerCharacterSelection, selectPlayerCharacter,
    setPlayerColorScheme, setPlayerSkinTone, selectedPlayerSkinTone,
    selectedPlayerColorScheme, selectedPlayerCharacterSupportsSkinTone } = CharacterConfig;

test('可选角色均有唯一模型，并复用标准动作资源', () => {
    const characters = PLAYER_CHARACTER_DEFINITIONS;
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
    const digest = { characterId: 'cartonSwimmer7', level: 7 };
    assert.deepEqual(ModifierCodec.decodeModifierDigest(ModifierCodec.encodeModifierDigest(digest)), digest);
    assert.equal(Protocol.isCompatibleProtocolVersion(6), false);
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

test('疾浪少年服装与肤色独立切换，资源遵守移动端预算', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        selectPlayerCharacter('cartonSwimmer7');
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer7');
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), true);
        const model = Resources.findSwimmerModelVariant('cartonSwimmer7');
        assert.equal(model.dynamicColor.mode, 'mask');
        assert.equal(model.dynamicColor.usesCapChannel, false);
        assert.equal(model.dynamicColor.maskPath, 'models/CartonSwimmer7ColorMask/texture');
        for (let i = 0; i < 20; ++i) {
            setPlayerSkinTone('deep');
            setPlayerColorScheme(i % 2 ? 'blue' : 'red');
            assert.equal(selectedPlayerSkinTone().id, 'deep');
            assert.equal(selectedPlayerColorScheme().id, i % 2 ? 'blue' : 'red');
            setPlayerSkinTone('warm');
            assert.equal(selectedPlayerSkinTone().preserveOriginal, true);
        }
        const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer7.glb', root));
        const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
        assert.equal(doc.meshes.length, 1);
        assert.equal(doc.materials.length, 1);
        assert.equal(doc.meshes[0].primitives.length, 1);
        assert.equal(doc.skins[0].joints.length, 41);
        assert.ok(doc.accessors[doc.meshes[0].primitives[0].indices].count / 3 <= 6000);
        const png = fs.readFileSync(new URL('assets/race/models/CartonSwimmer7ColorMask.png', root));
        assert.equal(png.readUInt32BE(16), 512);
        assert.equal(png.readUInt32BE(20), 512);
        assert.equal(png[25], 6);
    } finally {
        selectPlayerCharacter(previous.characterId);
        setPlayerSkinTone(previous.skinToneId);
        setPlayerColorScheme(previous.colorSchemeId);
    }
});
