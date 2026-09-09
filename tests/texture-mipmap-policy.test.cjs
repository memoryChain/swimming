const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mipFilterForImage, auditTextureMipmaps, inspectAstcMipChain, assertBuildMipmaps } = require('../extensions/wechat-race-subpackage/texture-mipmap-policy');

function astc(width, height, block = 6) {
    const b = Buffer.alloc(16 + Math.ceil(width / block) * Math.ceil(height / block) * 16);
    b.writeUInt32LE(0x5ca1ab13); b[4] = b[5] = block; b[6] = 1;
    b.writeUIntLE(width, 7, 3); b.writeUIntLE(height, 10, 3); b.writeUIntLE(1, 13, 3);
    return b;
}
function pack(layers) {
    const h = Buffer.alloc(8 + layers.length * 4);
    h.writeUInt32LE(0x50494d43); h.writeUInt32LE(layers.length, 4);
    layers.forEach((b, i) => h.writeUInt32LE(b.length, 8 + i * 4));
    return Buffer.concat([h, ...layers]);
}
function chain(width = 8, height = 4) {
    const layers = [];
    for (;;) {
        layers.push(astc(width, height));
        if (width === 1 && height === 1) return pack(layers);
        width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
    }
}

test('独立贴图启用 mip，GLB 内嵌图片保持单级采样', () => {
    assert.equal(mipFilterForImage('assets/race/models/CartonSwimmer10.glb.meta'), 'none');
    assert.equal(mipFilterForImage('assets/race/models/CartonSwimmer10ColorMask.png.meta'), 'linear');
    assert.equal(mipFilterForImage('assets/race/pool/LowPolyPool.glb.meta', 'PoolWallNarrowTilesWhite.image'), 'none');
    for (const name of ['BleacherFlatColorAtlas', 'StandArchitectureArtAtlas', 'PoolsidePropsFlatColorAtlas']) {
        assert.equal(mipFilterForImage('assets/race/pool/LowPolyPool.glb.meta', `${name}.image`), 'none');
    }
    for (const file of ['assets/race/pool/SwimmerSplashSpray.png.meta', 'assets/resources/ui/test.png.meta', 'assets/race/ui/test.png.meta']) {
        assert.equal(mipFilterForImage(file), null);
    }
});

test('完整 ASTC 链含窄长和非二次幂尺寸均能验证，损坏及缺层必须拒绝', () => {
    assert.deepEqual(inspectAstcMipChain(chain()), { width: 8, height: 4, levels: 4, bytes: chain().length });
    assert.equal(inspectAstcMipChain(chain(1, 32)).levels, 6);
    assert.equal(inspectAstcMipChain(chain(17, 9)).levels, 5);
    assert.throws(() => inspectAstcMipChain(astc(8, 4)), /CMIP/);
    assert.throws(() => inspectAstcMipChain(pack([astc(8, 4)])), /1×1/);
    assert.throws(() => inspectAstcMipChain(chain().subarray(0, -1)), /截断/);
    assert.throws(() => inspectAstcMipChain(Buffer.concat([chain(), Buffer.alloc(1)])), /多余/);
    assert.throws(() => inspectAstcMipChain(pack([astc(8, 4), astc(4, 4), astc(2, 1), astc(1, 1)])), /尺寸不连续/);
    assert.throws(() => inspectAstcMipChain(pack([astc(8, 4), astc(4, 2, 8), astc(2, 1), astc(1, 1)])), /不一致/);
});

test('修复保持 UUID/压缩/采样其他参数，构建门禁验证实际输出并拒绝缺失回退', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-mipmap-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dir = path.join(root, 'assets/race/models'); fs.mkdirSync(dir, { recursive: true });
    const metaPath = path.join(dir, 'TestColorMask.png.meta');
    const meta = { importer: 'image', uuid: 'image', userData: { compressSettings: { useCompressTexture: true, presetId: 'astc-opaque-6x6' } }, subMetas: {
        texture: { importer: 'texture', uuid: 'texture', name: 'texture', userData: { imageUuidOrDatabaseUri: 'image', mipfilter: 'none', minfilter: 'linear', magfilter: 'linear', wrapModeS: 'repeat' } },
    } };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    assert.equal(auditTextureMipmaps(root).issues.length, 1);
    assert.equal(auditTextureMipmaps(root, { fix: true }).changed, 1);
    meta.subMetas.texture.userData.mipfilter = 'linear';
    assert.deepEqual(JSON.parse(fs.readFileSync(metaPath)), meta);
    const after = fs.readFileSync(metaPath, 'utf8');
    assert.equal(auditTextureMipmaps(root, { fix: true }).changed, 0);
    assert.equal(fs.readFileSync(metaPath, 'utf8'), after);
    const file = path.join(root, 'image.hash.astc'); fs.writeFileSync(file, chain());
    const fallback = path.join(root, 'image.hash.jpg'); fs.writeFileSync(fallback, '回退文件');
    let raw = [file, fallback];
    const result = { containsAsset: uuid => uuid === 'image', getRawAssetPaths: () => [{ raw }] };
    assert.equal(assertBuildMipmaps(root, result).compressedImages, 1);
    fs.writeFileSync(file, astc(8, 4));
    assert.throws(() => assertBuildMipmaps(root, result), /CMIP/);
    fs.writeFileSync(file, chain()); raw = [file];
    assert.throws(() => assertBuildMipmaps(root, result), /回退/);
    raw = [fallback]; assert.throws(() => assertBuildMipmaps(root, result), /ASTC/);
    // 重现 Creator 返回缺少 UUID 的 .astc/.jpg，而磁盘文件带有 UUID 的情况。
    const namedAstc = path.join(root, 'image.astc'), namedFallback = path.join(root, 'image.jpg');
    fs.writeFileSync(namedAstc, chain()); fs.writeFileSync(namedFallback, '回退文件');
    raw = [path.join(root, '.astc'), path.join(root, '.jpg')];
    assert.equal(assertBuildMipmaps(root, result).compressedImages, 1);
    fs.writeFileSync(namedAstc, astc(8, 4));
    assert.throws(() => assertBuildMipmaps(root, result), /CMIP/);
    fs.writeFileSync(namedAstc, chain());
    fs.unlinkSync(namedFallback);
    // 同目录有其他带 hash 的图片，也不能冒充当前构建的回退资源。
    assert.throws(() => assertBuildMipmaps(root, result), /构建输出不存在/);
    result.paths = { hashedMap: { [namedAstc]: file, [namedFallback]: fallback } };
    assert.equal(assertBuildMipmaps(root, result).compressedImages, 1);
    assert.equal(assertBuildMipmaps(root, { containsAsset: () => false }).compressedImages, 0);
});
