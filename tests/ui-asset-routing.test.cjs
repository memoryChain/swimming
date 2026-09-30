const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');

function harness() {
    class Asset { isValid = true; }
    class Texture2D extends Asset {}
    class Prefab extends Asset {}
    class JsonAsset extends Asset {}
    const bundles = new Map(), cache = new Map(), requests = [], bundleRequests = [], tracked = [];
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync('assets/scripts/core/RaceBundleLoader.ts', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const cc = { Asset, Texture2D, Prefab, JsonAsset, assetManager: {
        assets: cache, getBundle: name => bundles.get(name),
        loadBundle: (name, options, done) => bundleRequests.push({ name, options: done ? options : null, done: done || options }),
    } };
    new Function('require', 'exports', code)(id => id === 'cc' ? cc : {
        RESOURCE_PATHS: { uiBundle: { name: 'ui', root: 'ui' } },
        decodeSampledMotion: value => value,
        trackRaceAsset: callback => callback,
        trackUiCallback: callback => { tracked.push(callback); return callback; },
    }, exports);
    function mount(name) {
        const bundle = { name,
            getInfoWithPath: path => ({ uuid: `${name}/${path}` }),
            load: (path, type, done) => requests.push({ name, path, type, done }),
            loadDir: (path, type, done) => requests.push({ name, path, type, done }),
        };
        bundles.set(name, bundle); return bundle;
    }
    return { ...exports, Asset, Texture2D, Prefab, requests, bundleRequests, cache, mount, tracked };
}

test('未打开界面不发请求，首次 UI 请求只加载 UI Bundle 和目标文件', () => {
    const h = harness(); assert.equal(h.requests.length + h.bundleRequests.length, 0);
    let value;
    h.loadRaceAsset('ui/character-v1/card', h.Texture2D, (error, asset) => { assert.equal(error, null); value = asset; });
    assert.deepEqual(h.bundleRequests.map(r => r.name), ['ui']);
    assert.equal(h.requests.length, 0);
    h.bundleRequests[0].done(null, h.mount('ui'));
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].path, 'character-v1/card');
    const texture = new h.Texture2D(); h.requests[0].done(null, texture); assert.equal(value, texture);
    assert.equal(h.tracked.length, 1);
});

test('分包通过 Cocos 传递微信和浏览器真实下载进度，无总量、缓存和迟到事件不造数', () => {
    const h = harness(), progress = []; let result;
    h.loadRaceBundle((error, bundle) => { assert.equal(error, null); result = bundle; }, value => progress.push(value));
    const request = h.bundleRequests[0], report = request.options.onFileProgress;
    report({ totalBytesWritten: 25, totalBytesExpectedToWrite: 100, progress: 24 });
    report({ progress: 60 }); report(75, 100);
    report(80, 0); report({}); report({ progress: NaN }); report({ progress: 150 }); report(-1, 100);
    assert.deepEqual(progress, [0.25, 0.6, 0.75]);
    request.done(null, h.mount('race')); report({ progress: 100 });
    assert.equal(result.name, 'race'); assert.equal(progress.length, 3);
    h.loadRaceBundle(() => {}, () => assert.fail('缓存无需模拟下载'));
    assert.equal(h.bundleRequests.length, 1);
    const broken = harness(), events = [];
    broken.loadRaceBundle(error => assert.match(error.message, /断网/), value => events.push(value));
    broken.bundleRequests[0].done(new Error('断网'));
    broken.bundleRequests[0].options.onFileProgress({ progress: 99 });
    assert.deepEqual(events, []);
});

test('角色、动作、场馆和字体留在 race，UI 目录去前缀且不影响其他路径', () => {
    const h = harness(); h.mount('race'); h.mount('ui');
    for (const path of ['models/a', 'animations/Tpose_happy', 'pool/LowPolyPool', 'fonts/ShuiMasterUI-Regular']) {
        h.loadRaceAsset(path, h.Prefab, () => {});
        assert.equal(h.requests.at(-1).name, 'race'); assert.equal(h.requests.at(-1).path, path);
    }
    h.loadRaceAssetDir('ui/character-v1', h.Texture2D, () => {});
    assert.equal(h.requests.at(-1).name, 'ui'); assert.equal(h.requests.at(-1).path, 'character-v1');
    h.loadRaceAssetDir('ui', h.Texture2D, () => {}); assert.equal(h.requests.at(-1).path, '');
    assert.equal(h.bundleRequests.length, 0);
});

test('UI 下载失败回传可重试，热缓存同步返回不再次访问网络', () => {
    const h = harness(); let error, result;
    h.loadRaceAsset('ui/a', h.Texture2D, value => error = value);
    h.bundleRequests[0].done(new Error('断网')); assert.match(error.message, /断网/);
    h.loadRaceAsset('ui/a', h.Texture2D, (failure, asset) => { error = failure; result = asset; });
    h.bundleRequests[1].done(null, h.mount('ui'));
    const texture = new h.Texture2D(); h.cache.set('ui/a', texture);
    h.requests[0].done(null, texture); assert.equal(error, null);
    result = null;
    h.loadRaceAsset('ui/a', h.Texture2D, (_error, asset) => result = asset);
    assert.equal(result, texture); assert.equal(h.requests.length, 1); assert.equal(h.bundleRequests.length, 2);
});

test('嵌套 UI Bundle 元数据优先于 race，远程发布名单仅包含 UI', () => {
    const read = path => JSON.parse(fs.readFileSync(path));
    const ui = read('assets/race/ui.meta').userData, race = read('assets/race.meta').userData;
    assert.equal(ui.isBundle, true); assert.equal(ui.bundleName, 'ui'); assert.ok(ui.priority > race.priority);
    assert.equal(ui.compressionType.wechatgame, 'subpackage');
    assert.deepEqual(read('config/build/wechat-remote-assets.json').bundles, ['ui']);
});
