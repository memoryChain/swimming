const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bakeEmbeddedTextureMipmaps, packMipLevels, resolveEmbeddedSource } = require('../extensions/wechat-race-subpackage/embedded-texture-mipmaps');
const { installTapBuildBridge, convertTapAfterAudit } = require('../extensions/wechat-race-subpackage/taptap-build-bridge');

function astc(w, h) {
    const b = Buffer.alloc(16 + Math.ceil(w / 6) * Math.ceil(h / 6) * 16);
    b.writeUInt32LE(0x5ca1ab13); b[4] = b[5] = 6; b[6] = 1;
    b.writeUIntLE(w, 7, 3); b.writeUIntLE(h, 10, 3); b.writeUIntLE(1, 13, 3);
    return b;
}
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-embedded-mip-'));
    t.after(() => {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const dir = path.join(root, 'assets/race/models'); fs.mkdirSync(dir, { recursive: true });
    const meta = path.join(dir, 'Test.glb.meta');
    fs.writeFileSync(meta, JSON.stringify({ importer: 'gltf', subMetas: {
        image: { importer: 'gltf-embeded-image', uuid: 'ab@image', name: 'Test.image',
            userData: { compressSettings: { useCompressTexture: true, presetId: 'preset' } } },
    } }));
    const settings = path.join(root, 'settings/v2/packages'); fs.mkdirSync(settings, { recursive: true });
    fs.writeFileSync(path.join(settings, 'builder.json'), JSON.stringify({ textureCompressConfig: {
        genMipmaps: true, userPreset: { preset: { options: { miniGame: { astc_6x6: { quality: 'medium' } } } } },
    } }));
    const dest = path.join(root, 'build'); fs.mkdirSync(dest);
    const file = path.join(dest, 'ab@image.astc'), fallback = path.join(dest, 'ab@image.png');
    fs.writeFileSync(fallback, '原回退数据');
    const result = { dest, containsAsset: () => true, getRawAssetPaths: () => [{ raw: [file, fallback] }] };
    return { root, file, fallback, result, meta };
}

test('重导入遗留同 UUID 的 JPG 时按当前 PNG 声明取原图；禁止旧缓存冒充缺失原图', t => {
    const { root } = fixture(t);
    const dir = path.join(root, 'library/ab'); fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, 'ab@image');
    fs.writeFileSync(base + '.jpg', '旧导入'); fs.writeFileSync(base + '.png', '当前导入');
    const image = { uuid: 'ab@image', files: ['.json', '.png'] };
    assert.equal(resolveEmbeddedSource(root, image), base + '.png');
    assert.equal(resolveEmbeddedSource(root, { ...image, files: ['.json', '.jpg'] }), base + '.jpg');
    assert.throws(() => resolveEmbeddedSource(root, { uuid: image.uuid }), /不唯一/);
    fs.unlinkSync(base + '.png');
    assert.throws(() => resolveEmbeddedSource(root, image), /当前导入记录/);
    assert.equal(resolveEmbeddedSource(root, { uuid: image.uuid }), base + '.jpg');
});

test('完整链无需编码工具，损坏链及越界输出必须拒绝，源资源和回退保持不变', async t => {
    const f = fixture(t), beforeMeta = fs.readFileSync(f.meta);
    const packed = packMipLevels([astc(8, 4), astc(4, 2), astc(2, 1), astc(1, 1)]);
    fs.writeFileSync(f.file, packed);
    assert.deepEqual(await bakeEmbeddedTextureMipmaps(f.root, f.result), { generated: 0, cached: 0, unchanged: 1 });
    assert.deepEqual(fs.readFileSync(f.meta), beforeMeta);
    assert.equal(fs.readFileSync(f.fallback, 'utf8'), '原回退数据');
    fs.writeFileSync(f.file, packed.subarray(0, -1));
    await assert.rejects(bakeEmbeddedTextureMipmaps(f.root, f.result), /截断/);
    f.result.dest = path.join(f.root, 'other-output');
    await assert.rejects(bakeEmbeddedTextureMipmaps(f.root, f.result), /超出构建目录/);
    f.result.containsAsset = () => false;
    assert.deepEqual(await bakeEmbeddedTextureMipmaps(f.root, f.result), { generated: 0, cached: 0, unchanged: 0 });
});

test('转换桥接延后官方钩子，项目检查通过后只调用一次；重复安装和微信构建安全', async t => {
    const { root } = fixture(t);
    const dir = path.join(root, 'extensions/taptap-minigame-tools/dist'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'hooks.js');
    fs.writeFileSync(file, "exports.calls = 0; exports.onAfterBuild = async function(options) {\n"
        + "    console.log('[Tap小游戏] 开始转换为Tap小游戏...');\n    exports.calls++;\n};\n");
    installTapBuildBridge(root); const patched = fs.readFileSync(file, 'utf8');
    installTapBuildBridge(root); assert.equal(fs.readFileSync(file, 'utf8'), patched);
    const hook = require(file);
    const options = { packages: { 'taptap-minigame-tools': { enableTapConvert: true } } };
    const result = { dest: path.join(root, 'build/wechatgame') };
    fs.mkdirSync(path.join(root, 'build/TapBuild'), { recursive: true });
    fs.writeFileSync(path.join(root, 'build/TapBuild/game.zip'), '测试包');
    await hook.onAfterBuild(options, {}); assert.equal(hook.calls, 0);
    await convertTapAfterAudit(root, options, result); assert.equal(hook.calls, 1);
    await convertTapAfterAudit(root, { packages: {} }, {}); assert.equal(hook.calls, 1);
    fs.truncateSync(path.join(root, 'build/TapBuild/game.zip'), 20 * 1000 * 1000);
    await assert.rejects(convertTapAfterAudit(root, options, result), /保守预算/);
    fs.writeFileSync(file, '新版本钩子');
    assert.throws(() => installTapBuildBridge(root), /版本变化/);
    delete require.cache[require.resolve(file)];
});

test('微信保留源主包门禁，Tap 中间目录按转换后的 ZIP 单独验收；禁用贴图格式始终拒绝', t => {
    const { root } = fixture(t);
    const { auditWechatPackageOutput } = require('../extensions/wechat-race-subpackage/hooks');
    const dest = path.join(root, 'build');
    fs.writeFileSync(path.join(dest, 'large.js'), Buffer.alloc(4 * 1024 * 1024));
    assert.throws(() => auditWechatPackageOutput(dest), /4096/);
    assert.ok(auditWechatPackageOutput(dest, { enforceMainLimit: false }).mainBytes > 4 * 1024 * 1024);
    fs.writeFileSync(path.join(dest, 'bad.pvr'), '无效');
    assert.throws(() => auditWechatPackageOutput(dest, { enforceMainLimit: false }), /PVR/);
});
