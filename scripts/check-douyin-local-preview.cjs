'use strict';

// 用实际构建适配器验证 ZIP 地址、资源基址、版本缓存与失败传播，不启动编辑器。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
const output = path.resolve(project, process.argv[2] || 'build/douyin-local-preview');
assert(output.startsWith(project + path.sep), '检查目录必须位于项目中');
const source = fs.readFileSync(path.join(output, 'engine-adapter.js'), 'utf8');
const begin = source.indexOf('1:[function(');
const bodyStart = source.indexOf('{', begin);
const bodyEnd = source.indexOf('},{"./cache-manager":3}]', bodyStart);
assert(begin >= 0 && bodyStart >= 0 && bodyEnd > bodyStart, '当前适配器结构需要重新核对');
const params = source.slice(begin, bodyStart).match(/function\(([^)]*)\)/)[1];
let handlers;
let decompressions = 0;
let failNext = false;
const cached = new Map();
const cache = {
    cachedFiles: cached, tempFiles: new Map(), init() {},
    updateLastTime() {}, removeCache() {}, cacheFile() {}, makeBundleFolder() {},
    unzipAndCacheBundle(key, file, bundle, done) {
        assert.equal(key, file, '本地 ZIP 不应发起网络下载');
        assert(fs.existsSync(path.join(output, file)), '加载的 ZIP 必须实际存在');
        decompressions++;
        if (failNext) return done(new Error('模拟解压失败'));
        const url = `ttfile://user/gamecaches/${bundle}/verified`;
        cached.set(key, { url });
        done(null, url);
    },
};
const cc = {
    sys: { platform: 'BYTEDANCE', os: 'IOS', Platform: {}, OS: {} },
    path: { basename: value => path.posix.basename(value) },
    settings: { querySettings: () => [] },
    assetManager: {
        init() {}, presets: { scene: {} },
        downloader: { bundleVers: {}, remoteBundles: [], register: value => { handlers = value; } },
        parser: { register() {} }, transformPipeline: { append() {} },
    },
};
const context = vm.createContext({
    cc, window: { fsUtils: {
        fs: {}, getUserDataPath: () => 'ttfile://user',
        readJson(file, done) {
            try { done(null, JSON.parse(fs.readFileSync(path.join(output, file), 'utf8'))); }
            catch (error) { done(error); }
        },
        downloadFile() { throw new Error('本地包不允许网络下载'); },
    } },
});
const install = vm.runInContext(`(function(${params}){${source.slice(bodyStart + 1, bodyEnd)}})`, context);
install(name => {
    if (name === './cache-manager') return cache;
    assert(name.startsWith('./assets/'), `程序必须从本地加载：${name}`);
    assert(fs.existsSync(path.join(output, name)), `缺少 Bundle 脚本：${name}`);
}, { exports: {} }, {});
cc.assetManager.init({});
function load(name) {
    return new Promise((resolve, reject) => handlers.bundle(name, {}, (error, config) => {
        if (error) reject(error);
        else resolve(config);
    }));
}
(async () => {
    const bundles = fs.readdirSync(path.join(output, 'assets')).filter(name =>
        fs.existsSync(path.join(output, 'assets', name, 'config.json')));
    for (const name of bundles) {
        const config = await load(name);
        assert(config.isZip === true && config.zipVersion, '资源必须有 ZIP 版本');
        assert.equal(config.base, `ttfile://user/gamecaches/${name}/verified/res/`);
        const before = decompressions;
        await load(name);
        assert.equal(decompressions, before, '重复加载应复用解压缓存');
    }
    cached.clear();
    failNext = true;
    await assert.rejects(load('race'), /模拟解压失败/);
    let bytes = 0;
    function count(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) count(file);
            else bytes += fs.statSync(file).size;
        }
    }
    count(output);
    assert(bytes < 20 * 1024 * 1024, '源码包必须低于当前 20MiB 上限');
    console.log(`验证通过：${bundles.length} 个 Bundle 的本地 ZIP 路径、缓存和失败传播；包大小 ${(bytes / 1048576).toFixed(4)} MiB。`);
    console.log('此检查模拟文件系统，不等于抖音模拟器或手机验收。');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
