'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encodeSampledMotion, readSourceMotions, compactBuiltMotions, assertBuiltMotionRuntime, assertBuiltMotionStorage } = require('../extensions/wechat-race-subpackage/sampled-motion-storage');
const { auditWechatPackageOutput, MAX_MAIN_BYTES, MAX_TOTAL_BYTES } = require('../extensions/wechat-race-subpackage/wechat-package-budget');
const projectRoot = path.resolve(__dirname, '..');

function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const directory of process.env.PATH.split(path.delimiter)) {
        const candidate = path.resolve(directory, '../typescript/lib/typescript.js');
        if (fs.existsSync(candidate)) return require(candidate);
    }
    throw new Error('需要 typescript@5.4.5');
}
const ts = compiler();
function loadTs(relative, mocks = {}) {
    const filename = path.resolve(projectRoot, relative);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const module = { exports: {} };
    const localRequire = (id) => mocks[id] || loadTs(path.resolve(path.dirname(filename), id + '.ts'), mocks);
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
    return module.exports;
}
const { decodeSampledMotion } = loadTs('assets/scripts/character/SampledMotionStorage.ts');
const sources = readSourceMotions(projectRoot);

test('所有动作逐字段、逐帧还原为 Creator 原 JSON，且不修改源数据', () => {
    let frames = 0, before = 0, after = 0;
    for (const [id, source] of sources) {
        const original = JSON.stringify(source);
        const stored = JSON.stringify(encodeSampledMotion(source));
        const restored = decodeSampledMotion(JSON.parse(stored));
        assert.deepEqual(restored, source, id);
        assert.equal(JSON.stringify(source), original, id);
        assert.equal(decodeSampledMotion(restored), restored);
        assert.equal(decodeSampledMotion(source), source);
        if (restored.samples.length > 1) {
            assert.notEqual(restored.samples[0].rotations.Root, restored.samples[1].rotations.Root);
        }
        frames += source.samples.length;
        before += Buffer.byteLength(original);
        after += Buffer.byteLength(stored);
    }
    assert.ok(sources.size >= 20);
    assert.ok(frames >= 3660);
    assert.ok(after < before * 0.75, `压缩比例 ${after / before}`);
    console.log(`动作 ${sources.size} 个，${frames} 帧：${(before / 1024).toFixed(1)} → ${(after / 1024).toFixed(1)} KiB`);
});

test('内存编码也保留负零；磁盘序列化沿用 Creator 的标准 JSON 数值语义', () => {
    const file = path.join(projectRoot, 'assets/race/model-actions/tPose/Tpose_angry.json');
    const text = fs.readFileSync(file, 'utf8');
    const raw = JSON.parse(text);
    assert.deepEqual(decodeSampledMotion(encodeSampledMotion(raw)), raw);
    assert.deepEqual(decodeSampledMotion(JSON.parse(JSON.stringify(encodeSampledMotion(raw)))), JSON.parse(JSON.stringify(raw)));
    assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('损坏版本、截断旋转、缺失字段和不一致的源骨骼均拒绝加载', () => {
    const source = sources.values().next().value;
    const badVersion = structuredClone(encodeSampledMotion(source));
    badVersion.$motion.version = 99;
    assert.throws(() => decodeSampledMotion(badVersion), /header/);
    const badRotation = structuredClone(encodeSampledMotion(source));
    badRotation.samples[0][badRotation.$motion.fields.indexOf('rotations')].pop();
    assert.throws(() => decodeSampledMotion(badRotation), /row/);
    const badRow = structuredClone(encodeSampledMotion(source));
    badRow.samples[0].pop();
    assert.throws(() => decodeSampledMotion(badRow), /row/);
    const badSource = structuredClone(source);
    delete badSource.samples[1].rotations.Root;
    assert.throws(() => encodeSampledMotion(badSource), /schema/);
});

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-package-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
function write(root, name, data) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
    return file;
}
function sparse(root, name, bytes) {
    const file = write(root, name, '');
    fs.truncateSync(file, bytes);
}
test('构建处理兼容独立 JsonAsset 和合并包，保留 Cocos 外壳，重复执行不变', (t) => {
    const root = fixture(t);
    const [first, second] = [...sources.values()].slice(0, 2).map((source) => ({ ...source, samples: source.samples.slice(0, 3) }));
    write(root, 'assets/race/model-actions/tPose/first.json', first);
    write(root, 'assets/race/model-actions/tPose/second.json', second);
    const untouched = { id: 'divePrep', rotations: { Root: [0, 0, 0, 1] }, samplesNotMotion: [1, 2, 3] };
    const imports = 'output/subpackages/race/import';
    const standalone = [1, 0, 0, [['cc.JsonAsset', ['_name', 'json'], 1]], [[0, 0, 1, 3]], [[0, 'first', first]]];
    const packed = [standalone, [0, 'second', second], untouched];
    const singleFile = write(root, `${imports}/aa/first.json`, standalone);
    const packFile = write(root, `${imports}/bb/pack.json`, packed);
    const otherFile = write(root, `${imports}/cc/other.json`, untouched);
    const originalSingle = fs.readFileSync(singleFile, 'utf8');
    const preview = compactBuiltMotions(root, path.join(root, 'output'), { checkOnly: true });
    assert.equal(preview.files, 2);
    assert.equal(fs.readFileSync(singleFile, 'utf8'), originalSingle);
    assert.throws(() => assertBuiltMotionStorage(root, path.join(root, 'output')), /pnpm wechat:finalize/);
    assert.equal(fs.readFileSync(singleFile, 'utf8'), originalSingle);
    const backupRoot = path.join(root, 'backup');
    const result = compactBuiltMotions(root, path.join(root, 'output'), { backupRoot });
    assert.equal(fs.readFileSync(path.join(backupRoot, 'subpackages/race/import/aa/first.json'), 'utf8'), originalSingle);
    assert.equal(assertBuiltMotionStorage(root, path.join(root, 'output')).files, 0);
    assert.equal(result.motions, 2);
    assert.equal(result.files, 2);
    const single = JSON.parse(fs.readFileSync(singleFile, 'utf8'));
    assert.deepEqual(single.slice(0, 5), standalone.slice(0, 5));
    assert.deepEqual(decodeSampledMotion(single[5][0][2]), first);
    const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
    assert.deepEqual(decodeSampledMotion(pack[1][2]), second);
    assert.deepEqual(pack[2], untouched);
    assert.equal(fs.readFileSync(otherFile, 'utf8'), JSON.stringify(untouched));
    assert.equal(compactBuiltMotions(root, path.join(root, 'output')).savedBytes, 0);
    assert.equal(compactBuiltMotions(root, path.join(root, 'output')).files, 0);
    write(root, 'assets/race/model-actions/tPose/missing.json', { ...first, id: 'missing' });
    const previous = fs.readFileSync(packFile, 'utf8');
    assert.throws(() => compactBuiltMotions(root, path.join(root, 'output')), /Missing built motions/);
    assert.equal(fs.readFileSync(packFile, 'utf8'), previous);
});

test('独立后处理必须检查实际构建中的解码器及加载器，拒绝旧版产物', (t) => {
    const root = fixture(t);
    function buildModule(source, name) {
        return ts.transpileModule(fs.readFileSync(path.join(projectRoot, source), 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.System },
        }).outputText.replace('System.register(', `System.register("chunks:///_virtual/${name}.ts",`)
            .replace('../character/SampledMotionStorage', './SampledMotionStorage.ts');
    }
    const decoder = buildModule('assets/scripts/character/SampledMotionStorage.ts', 'SampledMotionStorage');
    const loader = buildModule('assets/scripts/core/RaceBundleLoader.ts', 'RaceBundleLoader');
    const file = write(root, 'assets/start-scene/index.js', decoder);
    assert.throws(() => assertBuiltMotionRuntime(root), /缺少动作解码器或统一加载入口/);
    fs.writeFileSync(file, loader);
    assert.throws(() => assertBuiltMotionRuntime(root), /缺少动作解码器或统一加载入口/);
    fs.writeFileSync(file, decoder + '\n' + loader);
    assert.doesNotThrow(() => assertBuiltMotionRuntime(root));
    fs.writeFileSync(file, (decoder + '\n' + loader).replace('./SampledMotionStorage.ts', './OldMotionStorage.ts'));
    assert.throws(() => assertBuiltMotionRuntime(root), /缺少动作解码器或统一加载入口/);
});

test('统一资源入口还原单个和目录加载，复用同一 JsonAsset 的缓存，错误只回调一次', () => {
    class Asset {}
    class JsonAsset extends Asset { constructor(json) { super(); this.json = json; } }
    const source = sources.values().next().value;
    let assets = [new JsonAsset(encodeSampledMotion(source)), new JsonAsset({ id: 'divePrep' }), new Asset()];
    const bundle = {
        load: (_path, _type, callback) => callback(null, assets[0]),
        loadDir: (_path, _type, callback) => callback(null, assets),
    };
    const loader = loadTs('assets/scripts/core/RaceBundleLoader.ts', {
        cc: { Asset, JsonAsset, assetManager: { getBundle: () => bundle } },
    });
    let single;
    loader.loadRaceAsset('motion', JsonAsset, (error, asset) => { assert.equal(error, null); single = asset.json; });
    assert.deepEqual(single, source);
    loader.loadRaceAssetDir('motions', JsonAsset, (error, loaded) => {
        assert.equal(error, null);
        assert.equal(loaded[0].json, single);
        assert.deepEqual(loaded[1].json, { id: 'divePrep' });
    });
    assets = [new JsonAsset(encodeSampledMotion(source))];
    loader.loadRaceAssetDir('motions', JsonAsset, (error, loaded) => {
        assert.equal(error, null);
        assert.deepEqual(loaded[0].json, source);
    });
    assets[0].json = { $motion: { version: 99 } };
    let callbacks = 0;
    loader.loadRaceAsset('broken', JsonAsset, (error, asset) => {
        assert.match(error.message, /header/); assert.equal(asset, undefined); callbacks++;
    });
    loader.loadRaceAssetDir('broken', JsonAsset, (error, loaded) => {
        assert.match(error.message, /header/); assert.equal(loaded, undefined); callbacks++;
    });
    assert.equal(callbacks, 2);
});

test('主包统计按清单排除所有分包，但总包始终包含它们', (t) => {
    const root = fixture(t);
    const manifest = { subpackages: [{ root: 'subpackages/race/' }, { root: 'cocos-js/chunks/' }] };
    write(root, 'game.json', manifest);
    sparse(root, 'game.js', 100);
    sparse(root, 'subpackages/race/data.bin', 200);
    sparse(root, 'cocos-js/chunks/data.bin', 300);
    sparse(root, 'subpackages/race-other/data.bin', 400);
    const result = auditWechatPackageOutput(root);
    assert.equal(result.mainBytes, Buffer.byteLength(JSON.stringify(manifest)) + 500);
    assert.equal(result.totalBytes, result.mainBytes + 500);
});

test('分别拦截主包超过 4 MiB、总包超过 30 MiB 和运行包里的源稿/旧压缩格式', (t) => {
    const root = fixture(t);
    write(root, 'game.json', { subpackages: [{ root: 'subpackages/race/' }] });
    sparse(root, 'game.js', MAX_MAIN_BYTES);
    assert.throws(() => auditWechatPackageOutput(root), /4096 KiB/);
    sparse(root, 'game.js', 0);
    sparse(root, 'subpackages/race/data.bin', MAX_TOTAL_BYTES);
    assert.throws(() => auditWechatPackageOutput(root), /30720 KiB/);
    sparse(root, 'subpackages/race/data.bin', 0);
    const backup = write(root, 'subpackages/race/model.bak', '');
    assert.throws(() => auditWechatPackageOutput(root), /Source-only/);
    fs.unlinkSync(backup);
    write(root, 'subpackages/race/texture.pvr', '');
    assert.throws(() => auditWechatPackageOutput(root), /PVR\/PKM/);
});
