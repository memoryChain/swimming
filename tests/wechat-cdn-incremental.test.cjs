'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { publishIncremental } = require('../scripts/wechat-cdn-incremental.cjs');
const { validateManifest, verifyRelease } = require('../scripts/verify-wechat-cdn.cjs');
const hash = (data, type = 'sha256') => createHash(type).update(data).digest('hex');

test('公开校验支持字体 MD5 目录及普通资源文件名，增量子集与全量使用相同规则', async () => {
    const paths = [
        'remote/race/native/02/02d6cbd0-8b7f-49bf-9646-eed5164f4112.f1615/ShuiMasterUI-SemiBold.ttf',
        'remote/race/native/8b/model@a041a.abcdef.astc',
        'remote/race/config.123abc.json',
    ];
    const files = paths.map(path => ({ path, size: 4, sha256: hash('test') }));
    const manifest = { server: 'https://assets.example.com/game-assets/1.0.0/', files };
    const downloaded = [];
    const options = { log() {}, download: async (url, entry) => {
        assert.equal(url.href, manifest.server + entry.path); downloaded.push(entry.path);
    } };
    await verifyRelease(manifest, options);
    assert.deepEqual(downloaded.sort(), [...paths].sort());
    await verifyRelease({ ...manifest, files: [files[0]] }, options);
    assert.equal(downloaded.at(-1), paths[0]);
});

test('非法路径在任何云端操作前拒绝，错误包含文件路径', async () => {
    for (const path of ['remote/race/../secret', 'remote//file.ttf', 'remote/race/./file',
        'remote/race/x?token=1', 'remote/race/x#hash', 'remote/race/%2e%2e/x',
        'remote/race/a\\b', '/remote/race/a', 'remote/race/a..b']) {
        const manifest = { server: 'https://assets.example.com/', files: [{ path, size: 0, sha256: hash('') }] };
        assert.throws(() => validateManifest(manifest), error => error.message.includes(JSON.stringify(path)));
        let accessed = false;
        await assert.rejects(publishIncremental({ manifest }, { store: { list() { accessed = true; } } }), /文件条目无效/);
        assert.equal(accessed, false);
    }
});

test('路径合法后仍保留公开下载失败重试及失败拦截', async () => {
    let calls = 0;
    await assert.rejects(verifyRelease({ server: 'https://assets.example.com/', files: [
        { path: 'remote/race/native/uuid.hash/font.ttf', size: 4, sha256: hash('test') },
    ] }, { log() {}, download: async () => { calls++; throw new Error('大小或 SHA-256 不符'); } }), /1 个 CDN 文件验证失败/);
    assert.equal(calls, 2);
});
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-incremental-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const data = new Map(), operations = [], verified = [];
    const store = {
        async list(prefix) { return [...data].filter(([key]) => key.startsWith(prefix)).map(([Key, bytes]) => ({ Key, Size: bytes.length, ETag: `"${hash(bytes, 'md5')}"`, LastModified: '' })); },
        async upload(file, key) { operations.push(['upload', key]); data.set(key, fs.readFileSync(file)); },
        async copy(source, key) { operations.push(['copy', source, key]); assert.ok(data.has(source)); if (!data.has(key)) data.set(key, Buffer.from(data.get(source))); },
        async read(key) { assert.ok(data.has(key)); return data.get(key); },
    };
    const options = { store, log() {}, async verify(manifest) {
        verified.push(manifest.files.map(e => e.path));
        for (const e of manifest.files) { const key = new URL(manifest.server).pathname.slice(1) + e.path; assert.equal(hash(data.get(key)), e.sha256); }
    } };
    function release(revision = '原始资源', script = '原始代码', clientVersion = '1.0.0') {
        const content = {
            'remote/ui/config.json': '{"name":"race"}', 'remote/music/config.json': '{"name":"music"}',
            [`remote/race/native/aa/model.${hash(revision).slice(0, 8)}.bin`]: revision, 'remote/race/native/bb/texture.bin': '共享贴图',
            'remote/music/native/cc/music.bin': '共享音乐',
        };
        const files = Object.entries(content).map(([path, bytes]) => ({ path, size: Buffer.byteLength(bytes), sha256: hash(bytes) }));
        const localScripts = [{ path: 'src/bundle-scripts/race/index.js', size: Buffer.byteLength(script), sha256: hash(script) }];
        const contentHash = hash(JSON.stringify({ files, scripts: localScripts }));
        const config = { origin: 'https://example.com', prefix: 'game-assets', envId: 'test-env', region: 'ap-shanghai' };
        const cloudPath = `${config.prefix}/${clientVersion}`, publishRoot = path.join(root, clientVersion);
        const manifest = { schema: 2, clientVersion, contentHash, server: `${config.origin}/${cloudPath}/`, files, localScripts };
        for (const [name, bytes] of Object.entries(content)) { const file = path.join(publishRoot, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
        fs.writeFileSync(path.join(publishRoot, 'release-manifest.json'), JSON.stringify(manifest));
        return { manifest, config, cloudPath, publishRoot, receiptKey: `${cloudPath}/release-verified.${contentHash}.json`, manifestKey: `${cloudPath}/release-manifest.${contentHash}.json` };
    }
    return { data, operations, verified, store, options, release };
}

test('首次发布全量验证；相同版本零上传，之后仅检查两个公开 Bundle 配置', async t => {
    const f = fixture(t), r = f.release();
    const first = await publishIncremental(r, f.options);
    assert.equal(first.uploaded, 5); assert.equal(first.verified, 5);
    assert.ok(f.operations.at(-1)[1] === r.receiptKey);
    f.operations.length = 0;
    const second = await publishIncremental(r, f.options);
    assert.deepEqual(second, { skipped: 5, copied: 0, uploaded: 0, uploadBytes: 0, verified: 2 });
    assert.deepEqual(f.operations, []);
    assert.equal((await publishIncremental(r, { ...f.options, forceVerify: true })).verified, 5);
});

test('只改一个资源，仅上传一个；其他资源在云端复制，旧版本字节保持不变', async t => {
    const f = fixture(t), old = f.release(); await publishIncremental(old, f.options);
    const oldData = new Map([...f.data].map(([k, v]) => [k, Buffer.from(v)]));
    f.operations.length = 0;
    const result = await publishIncremental(f.release('新模型', '原始代码', '1.0.1'), f.options);
    assert.deepEqual(result, { skipped: 0, copied: 4, uploaded: 1, uploadBytes: Buffer.byteLength('新模型'), verified: 3 });
    for (const [key, bytes] of oldData) assert.deepEqual(f.data.get(key), bytes);
});

test('同号只改本地代码，资源保持原目录并全部跳过', async t => {
    const f = fixture(t); await publishIncremental(f.release(), f.options);
    const result = await publishIncremental(f.release('原始资源', '新代码'), f.options);
    assert.equal(result.skipped, 5); assert.equal(result.uploadBytes, 0); assert.equal(result.verified, 2);
});

test('已有历史完整目录只补验证记录，无需重新上传资源', async t => {
    const f = fixture(t), r = f.release();
    for (const entry of [...r.manifest.files, { path: 'release-manifest.json' }]) f.data.set(entry.path === 'release-manifest.json' ? r.manifestKey : `${r.cloudPath}/${entry.path}`, fs.readFileSync(path.join(r.publishRoot, entry.path)));
    const result = await publishIncremental(r, f.options);
    assert.equal(result.uploaded, 0); assert.equal(result.verified, 5);
    assert.equal(f.operations.length, 1); assert.ok(f.operations[0][1] === r.receiptKey);
});

test('公开验证失败不写完成记录；重试跳过已上传项并重新验证', async t => {
    const f = fixture(t), r = f.release();
    await assert.rejects(publishIncremental(r, { ...f.options, verify: async () => { throw Error('模拟公开下载失败'); } }), /下载失败/);
    assert.equal(f.data.has(r.receiptKey), false);
    f.operations.length = 0;
    const result = await publishIncremental(r, f.options);
    assert.equal(result.uploaded, 0); assert.equal(result.verified, 5);
    assert.equal(f.operations.length, 1);
});

test('完成记录不能掩盖云端资源丢失或变更，丢失补传并验证，变更拒绝覆盖', async t => {
    const f = fixture(t), r = f.release(); await publishIncremental(r, f.options);
    const key = `${r.cloudPath}/${r.manifest.files.find(e => e.path.includes("/model.")).path}`;
    f.data.delete(key);
    const result = await publishIncremental(r, f.options);
    assert.equal(result.uploaded, 1); assert.equal(result.verified, 3);
    f.data.set(key, Buffer.from('损坏内容'));
    f.operations.length = 0;
    await assert.rejects(publishIncremental(r, f.options), /拒绝覆盖/);
    assert.deepEqual(f.operations, []);
});

test('云端复制失败或虚假成功不放行，也不写完成记录', async t => {
    for (const fail of [true, false]) {
        const f = fixture(t); await publishIncremental(f.release(), f.options);
        const r = f.release('新模型', '原始代码', '1.0.1');
        f.store.copy = async () => { if (fail) throw Error('复制失败'); };
        await assert.rejects(publishIncremental(r, f.options), /复制失败|存储校验失败/);
        assert.equal(f.data.has(r.receiptKey), false);
    }
});

test('拒绝损坏的远端发布记录和清单，不能错误命中已验证缓存', async t => {
    for (const name of ['release-verified.json', 'release-manifest.json']) {
        const f = fixture(t), r = f.release(); await publishIncremental(r, f.options);
        f.data.set(name === 'release-verified.json' ? r.receiptKey : r.manifestKey, Buffer.from('{}'));
        await assert.rejects(publishIncremental(r, f.options), /无效|不一致/);
    }
});

test('COS 分片 ETag 不当作文件 MD5；首次下载验证后可复用记录', async t => {
    const f = fixture(t), r = f.release();
    const originalList = f.store.list;
    f.store.list = async prefix => (await originalList(prefix)).map(o => o.Key.includes('/model.') ? { ...o, ETag: '"0123456789abcdef0123456789abcdef-2"' } : o);
    assert.equal((await publishIncremental(r, f.options)).verified, 5);
    const repeat = await publishIncremental(r, f.options);
    assert.equal(repeat.uploaded, 0); assert.equal(repeat.verified, 2);
});

test('同一 clientVersion 修改一个资源，只新增该文件、不复制整套资源，旧对象仍可用', async t => {
    const f = fixture(t), old = f.release(); await publishIncremental(old, f.options);
    const previous = new Map(f.data);
    const next = f.release('修改后的模型');
    assert.equal(next.cloudPath, old.cloudPath);
    const result = await publishIncremental(next, f.options);
    assert.equal(result.uploaded, 1); assert.equal(result.copied, 0); assert.equal(result.skipped, 4);
    for (const [key, bytes] of previous) assert.deepEqual(f.data.get(key), bytes);
    assert.equal((await publishIncremental(next, f.options)).uploaded, 0);
});
