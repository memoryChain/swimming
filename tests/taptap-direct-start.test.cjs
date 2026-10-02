'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { directEntry } = require('../scripts/create-taptap-direct-start-build.cjs');
const { instrumentEntry } = require('../scripts/create-taptap-lifecycle-build.cjs');
const template = fs.readFileSync('scripts/templates/taptap-guarded-entry.js', 'utf8');

async function run(source, options = {}) {
    const calls = [], frames = [], errors = [];
    let finishInit;
    const pendingInit = new Promise(resolve => { finishInit = resolve; });
    const failure = new Error('模拟引擎资源加载失败');
    const cc = {};
    function Application() {}
    Application.prototype.init = function (engine) { assert.equal(engine, cc); calls.push('app-init'); };
    Application.prototype.start = function () {
        calls.push('engine-init');
        const result = options.fail ? Promise.reject(failure) : options.pending ? pendingInit : Promise.resolve();
        return result.then(() => { calls.push('engine-run'); });
    };
    const boot = { auxiliary(name, fn, fallback) { try { return fn(); } catch { return fallback; } },
        step(name, fn) { calls.push(name); return fn(); }, note() {}, mark() {}, attachHost() {}, attachEngine() {},
        failed(error) { errors.push(error); } };
    const modules = {
        './tap-startup-guard': { create() { return boot; }, noopEvents() { return {}; } },
        './tap-startup-diagnostic': { ready() {} }, './tap-font-diagnostic': { install() {} },
        './tap-event-test': { install(root, config) { calls.push('event-install:' + config.version); } }, './tap-event-config.json': {},
        './tap-lifecycle-diagnostic': { install(root) { root.__swimmingTapLife = { attachHost() {}, attachEngine() {} }; } },
        './web-adapter': {}, './engine-adapter': {}, 'src/polyfills.bundle.js': {}, 'src/system.bundle.js': {},
        'src/import-map.js': { default: {} }, './first-screen': {
            start() { return options.noSplashFrame ? new Promise(() => {}) : Promise.resolve(); },
            setProgress() { return Promise.resolve(); }, end() { return Promise.resolve(); }
        }
    };
    const context = {
        console: { error(e) { errors.push(e); } }, Error,
        wx: { getSystemInfoSync() { return { platform: options.platform || 'android', screenWidth: 851,
            screenHeight: 393, devicePixelRatio: 2.75 }; } },
        GameGlobal: { fetch() {}, requestAnimationFrame(fn) { frames.push(fn); } },
        canvas: { width: 851, height: 393 }, window: { devicePixelRatio: 2.75 },
        System: { warmup() {}, import(name) { calls.push('import:' + name); return Promise.resolve(name === 'cc' ? cc : { Application }); } },
        require(name) {
            if (options.noJsonModule && name.endsWith('.json')) throw new Error('宿主不注册 JSON 模块');
            if (options.eventFailure && name === './tap-event-test') throw new Error('模拟统计模块安装失败');
            assert.ok(name in modules, '未知入口依赖：' + name); calls.push('require:' + name); return modules[name];
        }
    };
    const originalRaf = context.GameGlobal.requestAnimationFrame;
    vm.runInNewContext(source, context);
    if (options.fireEntryFrame && frames.length) frames.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.GameGlobal.requestAnimationFrame, originalRaf);
    return { calls, frames, errors, failure, finishInit, canvas: context.canvas };
}

test('首个宿主绘制回调不返回：原入口停止在适配器之前，对照入口仍启动引擎', async () => {
    const old = await run(template), direct = await run(directEntry(template));
    assert.equal(old.frames.length, 1);
    assert.ok(!old.calls.includes('require:./web-adapter'));
    assert.equal(direct.frames.length, 0);
    assert.ok(direct.calls.includes('engine-run'));
    assert.ok(!direct.calls.includes('require:./first-screen'));
    assert.equal(direct.canvas.width, 851 * 2.75);
});
test('启动画面绘制不返回：原入口仍等待，对照入口不依赖启动画面 Promise', async () => {
    const old = await run(template, { fireEntryFrame: true, noSplashFrame: true });
    const direct = await run(directEntry(template), { noSplashFrame: true });
    assert.ok(old.calls.includes('first-screen-start'));
    assert.ok(!old.calls.includes('engine-init'));
    assert.ok(direct.calls.includes('engine-run'));
});
test('对照入口仍等待引擎资源，不把未完成初始化当成可运行', async () => {
    const r = await run(directEntry(template), { pending: true });
    assert.ok(r.calls.includes('engine-init')); assert.ok(!r.calls.includes('engine-run'));
    r.finishInit(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(r.calls.filter(x => x === 'engine-run').length, 1);
});
test('引擎失败仍终止启动并记录原异常，统计模块失败不妨碍启动', async () => {
    const failed = await run(directEntry(template), { fail: true });
    assert.ok(!failed.calls.includes('engine-run')); assert.ok(failed.errors.includes(failed.failure));
    const auxiliary = await run(directEntry(template), { eventFailure: true, platform: 'ios' });
    assert.ok(auxiliary.calls.includes('engine-run'));
});
test('源入口不匹配或重复转换时拒绝继续', () => {
    assert.throws(() => directEntry(template.replace('first-screen-import', 'changed')), /锚点变化/);
    assert.throws(() => directEntry(directEntry(template)), /锚点变化/);
});

test('JSON 模块不可 require 时，新入口仍安装事件诊断并运行引擎', async () => {
    const old = await run(directEntry(template), { noJsonModule: true });
    assert.ok(!old.calls.some(x => x.startsWith('event-install:')));
    const source = instrumentEntry(directEntry(template));
    const fixed = await run(source, { noJsonModule: true });
    assert.ok(fixed.calls.includes('event-install:0.0.9'));
    assert.ok(fixed.calls.includes('engine-run'));
    assert.throws(() => instrumentEntry(source), /锚点变化/);
});
