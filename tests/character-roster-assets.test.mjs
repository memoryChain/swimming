import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import CharacterConfig from '../assets/scripts/app/PlayerCharacterConfig.ts';
import Resources from '../assets/scripts/core/ResourcePaths.ts';
import Protocol from '../assets/scripts/net/NetRaceProtocol.ts';
import ModifierCodec from '../assets/scripts/net/NetRaceModifierCodec.ts';
import IdentityConfig from '../assets/scripts/backend/IdentityConfig.ts';
import PlayerProfileConfig from '../assets/scripts/backend/PlayerProfile.ts';

const root = new URL('../', import.meta.url);
// 离线解码8位RGBA遮罩，不依赖本机图形库，覆盖PNG五种行过滤器。
function decodeMaskRgba(png) {
    assert.equal(png.readUInt32BE(16), 512);
    assert.equal(png.readUInt32BE(20), 512);
    assert.equal(png[24], 8);
    assert.equal(png[25], 6);
    assert.equal(png[28], 0);
    const chunks = [];
    for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
    }
    const filtered = inflateSync(Buffer.concat(chunks));
    const stride = 512 * 4;
    assert.equal(filtered.length, (stride + 1) * 512);
    const pixels = Buffer.alloc(stride * 512);
    for (let y = 0; y < 512; ++y) {
        const filter = filtered[y * (stride + 1)];
        assert.ok(filter <= 4);
        for (let x = 0; x < stride; ++x) {
            const i = y * stride + x;
            const a = x >= 4 ? pixels[i - 4] : 0;
            const b = y > 0 ? pixels[i - stride] : 0;
            const c = y > 0 && x >= 4 ? pixels[i - stride - 4] : 0;
            const p = a + b - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b
                : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            pixels[i] = (filtered[y * (stride + 1) + x + 1] + predictor) & 255;
        }
    }
    return pixels;
}

function jpegDimensions(bytes) {
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    for (let offset = 2; offset < bytes.length;) {
        assert.equal(bytes[offset], 0xff);
        const marker = bytes[offset + 1];
        const length = bytes.readUInt16BE(offset + 2);
        assert.ok(length >= 2);
        if ([0xc0, 0xc1, 0xc2].includes(marker)) return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
        if (marker === 0xda || marker === 0xd9) break;
        offset += length + 2;
    }
    throw Error('JPEG缺少受支持的尺寸段');
}
const { PLAYER_CHARACTER_DEFINITIONS, getPlayerCharacterSelection, selectPlayerCharacter,
    createDefaultPlayerCharacterSelection, normalizePlayerCharacterSelection, restorePlayerCharacterSelection,
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
        'cartonSwimmer9', 'cartonSwimmer10', 'cartonSwimmer11', 'cartonSwimmer12', 'cartonSwimmer13', 'cartonSwimmer14', 'cartonSwimmer15', 'muscleMan'];
    const expectedModelIds = ['muscleMan', 'cartonSwimmer5', 'cartonSwimmer6',
        'cartonSwimmer8', 'cartonSwimmer9', 'cartonSwimmer10', 'cartonSwimmer11', 'cartonSwimmer12', 'cartonSwimmer13', 'cartonSwimmer14', 'cartonSwimmer15'];
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
    const digest = { characterId: 'cartonSwimmer14', level: 7 };
    assert.deepEqual(ModifierCodec.decodeModifierDigest(ModifierCodec.encodeModifierDigest(digest)), digest);
    assert.equal(Protocol.isCompatibleProtocolVersion(11), false);
    assert.equal(Protocol.isCompatibleProtocolVersion(12), false);
    const mechaDigest = { characterId: 'cartonSwimmer15', level: 7 };
    assert.deepEqual(ModifierCodec.decodeModifierDigest(ModifierCodec.encodeModifierDigest(mechaDigest)), mechaDigest);
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
        assert.equal(PLAYER_CHARACTER_DEFINITIONS.find(c => c.id === 'cartonSwimmer10').name, '青影忍浪');
        assert.equal(model.candidates[0], 'models/CartonSwimmer10');
        setPlayerSkinTone('deep');
        setPlayerColorScheme('blue');
        assert.equal(selectedPlayerSkinTone().id, 'deep');
        assert.equal(selectedPlayerColorScheme().id, 'blue');
        setPlayerSkinTone('warm');
        assert.equal(selectedPlayerSkinTone().preserveOriginal, true);

        const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer10.glb', root));
        const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
        const primitive = doc.meshes[0].primitives[0];
        assert.equal(doc.meshes.length, 1);
        assert.equal(doc.materials.length, 1);
        assert.equal(doc.meshes[0].primitives.length, 1);
        assert.equal(doc.skins[0].joints.length, 41);
        assert.equal(doc.accessors[primitive.indices].count / 3, 5551);
        // 2ce3 属于青影忍浪10；保留既有重排UV与标准化骨架，不能误换12或14。
        assert.equal(doc.accessors[primitive.attributes.POSITION].count, 5864);
        // 无损 PNG 避免色界再次受 JPEG 污染；运行分辨率仍固定 512。
        assert.ok(data.length <= 768 * 1024);
        assert.equal(doc.images.length, 1);
        assert.equal(doc.images[0].mimeType, 'image/png');
        const imageView = doc.bufferViews[doc.images[0].bufferView];
        const imageStart = 28 + data.readUInt32LE(12) + (imageView.byteOffset ?? 0);
        assert.equal(data.readUInt32BE(imageStart + 16), 512);
        assert.equal(data.readUInt32BE(imageStart + 20), 512);
        const meta = JSON.parse(fs.readFileSync(new URL('assets/race/models/CartonSwimmer10.glb.meta', root)));
        assert.equal(meta.uuid, 'cde34d6c-6f0b-4caa-acd3-7c00537e44ca');
        assert.equal(Object.values(meta.subMetas).find(s => s.importer === 'gltf-scene').name, 'CartonSwimmer10.prefab');

        const png = fs.readFileSync(new URL('assets/race/models/CartonSwimmer10ColorMask.png', root));
        assert.equal(png.readUInt32BE(16), 512);
        assert.equal(png.readUInt32BE(20), 512);
        assert.equal(png[25], 6);
        const maskMeta = JSON.parse(fs.readFileSync(new URL('assets/race/models/CartonSwimmer10ColorMask.png.meta', root)));
        assert.equal(maskMeta.uuid, '768c9d5d-9565-4068-ab2d-1aca37c86dda');
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
        assert.equal(PLAYER_CHARACTER_DEFINITIONS.find(c => c.id === 'cartonSwimmer12').name, '绿电潮童');
        setPlayerSkinTone('deep');
        setPlayerColorScheme('blue');
        assert.equal(selectedPlayerSkinTone().id, 'deep');
        assert.equal(selectedPlayerColorScheme().id, 'blue');
        setPlayerSkinTone('warm');
        assert.equal(selectedPlayerSkinTone().preserveOriginal, true);

        const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer12.glb', root));
        const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
        const primitive = doc.meshes[0].primitives[0];
        assert.equal(doc.meshes.length, 1);
        assert.equal(doc.materials.length, 1);
        assert.equal(doc.meshes[0].primitives.length, 1);
        assert.equal(doc.skins[0].joints.length, 41);
        assert.equal(doc.accessors[primitive.indices].count / 3, 5525);
        assert.equal(doc.accessors[primitive.attributes.POSITION].count, 4085);
        // bf613 精修的无损运行底图仍为 512，沿用原骨架、UV 和肤色功能。
        assert.ok(data.length <= 1024 * 1024);
        assert.equal(doc.scenes[0].name, 'Scene');
        assert.equal(doc.images[0].mimeType, 'image/png');
        const embedded = doc.bufferViews[doc.images[0].bufferView];
        const imageStart = 28 + data.readUInt32LE(12) + (embedded.byteOffset ?? 0);
        assert.equal(data.readUInt32BE(imageStart + 16), 512);
        assert.equal(data.readUInt32BE(imageStart + 20), 512);
        const meta = JSON.parse(fs.readFileSync(new URL('assets/race/models/CartonSwimmer12.glb.meta', root)));
        assert.equal(meta.uuid, '36bdf8e6-92c0-4fa3-8155-a8e7fdf529af');
        assert.equal(Object.values(meta.subMetas).find(s => s.importer === 'gltf-scene').name, 'CartonSwimmer12.prefab');

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

test('深潜先锋肤色与全部服装色独立，暖肤色恢复精修原图', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        selectPlayerCharacter('cartonSwimmer13');
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer13');
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), true);
        for (const palette of CharacterConfig.PLAYER_COLOR_SCHEMES) {
            setPlayerSkinTone('deep');
            setPlayerColorScheme(palette.id);
            assert.equal(selectedPlayerSkinTone().id, 'deep');
            assert.notEqual(selectedPlayerSkinTone().preserveOriginal, true);
            assert.equal(selectedPlayerColorScheme().id, palette.id);
            setPlayerSkinTone('warm');
            assert.equal(selectedPlayerSkinTone().id, 'warm');
            assert.equal(selectedPlayerSkinTone().preserveOriginal, true);
            assert.equal(selectedPlayerColorScheme().id, palette.id);
        }
    } finally {
        restorePlayerCharacterSelection(previous);
    }
});

test('深潜先锋草稿肤色按草稿角色生效，确认后的序列化存档可恢复', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        // 当前已选角色不支持换肤，也不能拦住尚未确认的深潜先锋草稿。
        selectPlayerCharacter('cartonSwimmer15');
        const draftCharacterId = 'cartonSwimmer13';
        setPlayerSkinTone('warm', draftCharacterId);
        setPlayerSkinTone('deep', draftCharacterId);
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer15');
        assert.equal(selectedPlayerSkinTone(draftCharacterId).id, 'deep');
        setPlayerColorScheme('purple');
        selectPlayerCharacter(draftCharacterId);
        const savedProfile = PlayerProfileConfig.createDefaultProfile();
        savedProfile.characterSelection = { ...getPlayerCharacterSelection() };
        const serialized = JSON.stringify(savedProfile);
        restorePlayerCharacterSelection(createDefaultPlayerCharacterSelection());
        const loadedProfile = PlayerProfileConfig.normalizeProfile(JSON.parse(serialized));
        restorePlayerCharacterSelection(loadedProfile.characterSelection);
        assert.deepEqual(getPlayerCharacterSelection(), {
            characterId: draftCharacterId, skinToneId: 'deep', colorSchemeId: 'purple',
        });
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), true);
        assert.equal(selectedPlayerSkinTone().id, 'deep');
        assert.equal(selectedPlayerColorScheme().id, 'purple');
    } finally {
        restorePlayerCharacterSelection(previous);
    }
});

test('深潜先锋精修资源保留原模型与配色通道，仅新增有效皮肤遮罩', () => {
    const model = Resources.findSwimmerModelVariant('cartonSwimmer13');
    assert.equal(model.dynamicColor?.mode, 'mask');
    assert.equal(model.dynamicColor?.maskPath, 'models/CartonSwimmer13ColorMask/texture');
    assert.equal(model.dynamicColor?.usesCapChannel, false);
    assert.equal(model.preserveOriginalMaterial, true);
    assert.equal(model.sampledActionOverrideDir, 'model-actions/tPose');
    assert.equal(model.modelScaleMultiplier, 0.97);

    const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer13.glb', root));
    const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
    const primitive = doc.meshes[0].primitives[0];
    assert.equal(doc.meshes.length, 1);
    assert.equal(doc.materials.length, 1);
    assert.equal(doc.meshes[0].primitives.length, 1);
    assert.equal(doc.skins[0].joints.length, 41);
    assert.equal(doc.accessors[primitive.indices].count / 3, 5562);
    assert.equal(doc.accessors[primitive.attributes.POSITION].count, 7896);
    // 仅记录已批准的 308a0775 精修版，不提高其它角色的资源预算。
    assert.equal(data.length, 583140);
    assert.equal(createHash('sha256').update(data).digest('hex'),
        'f475b24383b21139032ec3016aff00b97c3bc0b8158252a546e512091dc8a075');
    assert.equal(doc.images.length, 1);
    assert.equal(doc.images[0].mimeType, 'image/jpeg');
    const imageView = doc.bufferViews[doc.images[0].bufferView];
    const binaryStart = 20 + data.readUInt32LE(12) + 8;
    assert.deepEqual(jpegDimensions(data.subarray(binaryStart + (imageView.byteOffset ?? 0))), [512, 512]);
    const meta = JSON.parse(fs.readFileSync(new URL('assets/race/models/CartonSwimmer13.glb.meta', root)));
    assert.equal(meta.uuid, '8306d5f9-36fc-49e5-b914-16754b9290aa');

    const mask = decodeMaskRgba(fs.readFileSync(new URL('assets/race/models/CartonSwimmer13ColorMask.png', root)));
    const channels = Array.from({ length: 4 }, () => Buffer.alloc(512 * 512));
    let skinCoverage = 0, skinInterior = 0, skinBoundary = 0;
    for (let pixel = 0; pixel < 512 * 512; ++pixel) {
        for (let channel = 0; channel < 4; ++channel) channels[channel][pixel] = mask[pixel * 4 + channel];
        const skin = mask[pixel * 4 + 2];
        if (skin > 0) skinCoverage++;
        if (skin === 255) skinInterior++;
        if (skin > 0 && skin < 255) skinBoundary++;
    }
    const approvedChannelHashes = [
        [0, '8a29dce28923a8dae2327fe5c564a2f29503a14fdd93e92f9288df56dd520047'],
        [1, '8a39d2abd3999ab73c34db2476849cddf303ce389b35826850f9a700589b4a90'],
        [3, '3b874d3ba46c638fc3094f8e92fb744ca974893873f8885f54e23760f9b6311b'],
    ];
    for (const [channel, hash] of approvedChannelHashes) {
        assert.equal(createHash('sha256').update(channels[channel]).digest('hex'), hash,
            `换肤不得改变已批准遮罩的 ${['R', 'G', 'B', 'A'][channel]} 通道`);
    }
    // 数值只验证有效覆盖、黑背景和抗锯齿边界；不能代替皮肤/头发/服装的视觉验收。
    assert.ok(skinCoverage > 0 && skinCoverage < 512 * 512, '皮肤遮罩必须有效且保留零值背景');
    assert.ok(skinInterior > 0, '皮肤内部必须有完整覆盖');
    assert.ok(skinBoundary > 0, '皮肤边界必须有分数覆盖');
});

test('新增破浪机甲复用动作与单材质，装甲只使用R换色且有独立卡面', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        selectPlayerCharacter('cartonSwimmer15');
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer15');
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), false);
        setPlayerSkinTone('deep');
        assert.equal(selectedPlayerSkinTone().preserveOriginal, true);
        for (const color of ['red', 'blue', 'yellow', 'purple', 'black']) {
            setPlayerColorScheme(color);
            assert.equal(selectedPlayerColorScheme().id, color);
        }
        const model = Resources.findSwimmerModelVariant('cartonSwimmer15');
        assert.deepEqual(model.candidates, ['models/CartonSwimmer15', 'models/CartonSwimmer15/CartonSwimmer15']);
        assert.equal(model.dynamicColor.maskPath, 'models/CartonSwimmer15ColorMask/texture');
        assert.equal(model.dynamicColor.usesCapChannel, false);
        assert.equal(model.preserveOriginalMaterial, true);
        assert.equal(model.sampledActionOverrideDir, 'model-actions/tPose');
        const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer15.glb', root));
        const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)));
        const primitive = doc.meshes[0].primitives[0];
        assert.equal(doc.meshes.length, 1);
        assert.equal(doc.materials.length, 1);
        assert.equal(doc.meshes[0].primitives.length, 1);
        assert.equal(doc.skins[0].joints.length, 41);
        assert.equal(doc.accessors[primitive.indices].count / 3, 5386);
        assert.equal(doc.accessors[primitive.attributes.POSITION].count, 7685);
        // 新机甲保留分裂法线/权重，单独记账，不提高任何旧角色的预算。
        assert.ok(data.length <= 768 * 1024);
        assert.equal(doc.images.length, 1);
        assert.equal(doc.images[0].mimeType, 'image/jpeg');
        const imageView = doc.bufferViews[doc.images[0].bufferView];
        const binaryStart = 20 + data.readUInt32LE(12) + 8;
        assert.deepEqual(jpegDimensions(data.subarray(binaryStart + (imageView.byteOffset ?? 0))), [512, 512]);
        const mask = decodeMaskRgba(fs.readFileSync(new URL('assets/race/models/CartonSwimmer15ColorMask.png', root)));
        let coverage = 0;
        for (let i = 0; i < mask.length; i += 4) {
            if (mask[i] > 0) coverage++;
            assert.equal(mask[i + 1], 0);
            assert.equal(mask[i + 2], 0);
            assert.equal(mask[i + 3], 255);
        }
        assert.ok(coverage > 1000 && coverage < 512 * 512 / 2);
        assert.equal(Resources.RESOURCE_PATHS.characterUi.portraits.cartonSwimmer15, 'ui/character-v1/portrait-cartonSwimmer15/texture');
        const portrait = fs.readFileSync(new URL('assets/race/ui/character-v1/portrait-cartonSwimmer15.png', root));
        assert.equal(portrait.readUInt32BE(16), 320);
        assert.equal(portrait.readUInt32BE(20), 320);
    } finally {
        selectPlayerCharacter(previous.characterId);
        setPlayerSkinTone(previous.skinToneId);
        setPlayerColorScheme(previous.colorSchemeId);
    }
});

test('霓绿少女保留精修设计，肤色与服装色可独立切换', () => {
    const previous = { ...getPlayerCharacterSelection() };
    try {
        selectPlayerCharacter('cartonSwimmer14');
        assert.equal(getPlayerCharacterSelection().characterId, 'cartonSwimmer14');
        assert.equal(selectedPlayerCharacterSupportsSkinTone(), true);
        const model = Resources.findSwimmerModelVariant('cartonSwimmer14');
        assert.equal(model.dynamicColor?.mode, 'mask');
        assert.equal(model.dynamicColor?.maskPath, 'models/CartonSwimmer14ColorMask/texture');
        assert.equal(model.dynamicColor?.usesCapChannel, false);
        assert.equal(model.preserveOriginalMaterial, true);
        assert.equal(model.sampledActionOverrideDir, 'model-actions/tPose');
        for (let i = 0; i < 20; ++i) {
            setPlayerSkinTone('deep');
            setPlayerColorScheme(i % 2 ? 'blue' : 'red');
            assert.equal(selectedPlayerSkinTone().id, 'deep');
            assert.equal(selectedPlayerColorScheme().id, i % 2 ? 'blue' : 'red');
            setPlayerSkinTone('warm');
            assert.equal(selectedPlayerSkinTone().preserveOriginal, true);
        }
        assert.deepEqual(normalizePlayerCharacterSelection({
            characterId: 'cartonSwimmer14', skinToneId: 'warm', colorSchemeId: 'green',
        }), { characterId: 'cartonSwimmer14', skinToneId: 'warm', colorSchemeId: 'green' });

        const data = fs.readFileSync(new URL('assets/race/models/CartonSwimmer14.glb', root));
        const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
        const primitive = doc.meshes[0].primitives[0];
        assert.equal(doc.meshes.length, 1);
        assert.equal(doc.materials.length, 1);
        assert.equal(doc.meshes[0].primitives.length, 1);
        assert.equal(doc.skins[0].joints.length, 41);
        // 霓绿少女保持 c1b6 银发精修版；bf613 只属于绿电潮童 12。
        assert.equal(doc.accessors[primitive.indices].count / 3, 5603);
        assert.equal(doc.accessors[primitive.attributes.POSITION].count, 7753);
        assert.equal(doc.scenes[0].name, 'Scene');
        const modelMeta = JSON.parse(fs.readFileSync(new URL('assets/race/models/CartonSwimmer14.glb.meta', root)));
        assert.equal(modelMeta.uuid, 'd68b1e8c-ab7a-4857-80ce-5d54779503a0');
        // 保留原 UV 与无损底图，避免精修边缘再次受 JPEG 污染；不增加运行纹理尺寸。
        assert.ok(data.length <= 1024 * 1024);
        assert.equal(doc.images.length, 1);
        assert.equal(doc.images[0].mimeType, 'image/png');
        const imageView = doc.bufferViews[doc.images[0].bufferView];
        const binaryStart = 20 + data.readUInt32LE(12) + 8;
        const image = data.subarray(binaryStart + (imageView.byteOffset ?? 0));
        assert.equal(image.readUInt32BE(16), 512);
        assert.equal(image.readUInt32BE(20), 512);

        const mask = fs.readFileSync(new URL('assets/race/models/CartonSwimmer14ColorMask.png', root));
        const maskMeta = JSON.parse(fs.readFileSync(new URL('assets/race/models/CartonSwimmer14ColorMask.png.meta', root)));
        assert.equal(maskMeta.uuid, '741fd71d-517d-446f-8cf9-b510d1aee884');
        assert.equal(mask.readUInt32BE(16), 512);
        assert.equal(mask.readUInt32BE(20), 512);
        assert.equal(mask[25], 6);
    } finally {
        selectPlayerCharacter(previous.characterId);
        setPlayerSkinTone(previous.skinToneId);
        setPlayerColorScheme(previous.colorSchemeId);
    }
});
