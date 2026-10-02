'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create, noopEvents } = require('../scripts/templates/taptap-startup-guard');
const { guardFirstScreen } = require('../scripts/create-taptap-guarded-build.cjs');
const { firstScreenProbe, bootstrapProbe } = require('../scripts/audit-taptap-startup.cjs');

function fixture() {
    let time = 0, serial = 0;
    const timers = new Map(), logs = [], listeners = {}, root = {};
    const options = { version: '0.0.6', now: () => time, log: line => logs.push(line),
        schedule(fn, delay) { const id = ++serial; timers.set(id, { fn, at: time + delay }); return id; },
        cancel(id) { timers.delete(id); } };
    const api = {};
    for (const name of ['Error', 'UnhandledRejection', 'Show', 'Hide']) {
        api['on' + name] = fn => { listeners[name] = fn; };
        api['off' + name] = fn => { if (listeners[name] === fn) delete listeners[name]; };
    }
    const guard = create(root, options);
    function advance(duration) {
        const until = time + duration;
        while (true) {
            const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) break;
            timers.delete(due[0]); time = due[1].at; due[1].fn();
        }
        time = until;
    }
    return { guard, root, logs, timers, api, listeners, advance };
}

test('同步与异步失败保留原异常；辅助模块失败不会终止启动', async () => {
    const normal = fixture(), error = new Error('真实异常样本');
    assert.equal(normal.guard.step('sync', () => 42), 42);
    assert.equal(await normal.guard.step('async', () => Promise.resolve(43)), 43);
    assert.equal(normal.guard.auxiliary('events', () => { throw error; }, 44), 44);
    assert.equal(normal.guard.status().closed, false);
    const sync = fixture(); assert.throws(() => sync.guard.step('sync-error', () => { throw error; }), e => e === error);
    assert.equal(sync.timers.size, 0);
    const async = fixture(); await assert.rejects(async.guard.step('async-error', () => Promise.reject(error)), e => e === error);
    assert.equal(async.timers.size, 0);
});

test('等待提示有界，后台时间不算等待，完成后释放全部监听和定时器', () => {
    const f = fixture(); f.guard.attachHost(f.api); f.guard.mark('first-screen');
    f.advance(14000); assert.equal(f.logs.filter(s => s.includes(' waiting ')).length, 0);
    f.listeners.Hide(); f.advance(120000); assert.equal(f.timers.size, 0);
    f.listeners.Show(); f.advance(14000); assert.equal(f.guard.status().warnings, 0);
    f.advance(1000); assert.equal(f.guard.status().warnings, 1);
    f.advance(90000); assert.equal(f.guard.status().warnings, 2); assert.equal(f.timers.size, 0);
    f.guard.complete(); assert.deepEqual(Object.keys(f.listeners), []);
    const logs = f.logs.length; f.advance(90000); f.guard.mark('race'); assert.equal(f.logs.length, logs);
});

test('宿主失败释放启动监听；无法解绑的 API 不注册', () => {
    const f = fixture(); f.guard.attachHost(f.api); f.listeners.Error(new Error('宿主异常'));
    assert.equal(f.guard.status().closed, true); assert.equal(f.timers.size, 0); assert.deepEqual(Object.keys(f.listeners), []);
    const next = fixture(); let subscribed = 0;
    next.guard.attachHost({ onError() { subscribed++; } }); assert.equal(subscribed, 0);
});

test('事件采集降级接口保持类与实例身份，并仍能确认大厅就绪', () => {
    const f = fixture(), events = noopEvents(f.guard), value = function () {};
    assert.equal(events.wrapFlow(value), value); assert.equal(events.wrapManager(value), value);
    assert.equal(events.attachFlow(value), value); events.lobbyReady();
    assert.equal(f.guard.status().closed, true); assert.equal(f.timers.size, 0);
});

test('诊断输出异常不影响游戏，日志总量有上限', () => {
    const f = create({}, { schedule() { return 1; }, cancel() {}, log() { throw new Error('日志不可用'); } });
    assert.equal(f.step('safe', () => 46), 46); f.complete();
    const next = fixture(); for (let i = 0; i < 200; i++) next.guard.note('sample', {});
    assert.equal(next.logs.length, 80); next.guard.complete();
});

test('引擎与 Bundle 诊断保留 this、返回值和回调，结束后恢复原方法', async () => {
    const f = fixture(), bundle = {}, cc = { game: {
        init() { assert.equal(this, cc.game); return Promise.resolve(47); }, run() { return 48; }
    }, assetManager: { loadBundle(name, cb) { assert.equal(this, cc.assetManager); cb.call(bundle, null, bundle); return 49; } } };
    const init = cc.game.init, load = cc.assetManager.loadBundle;
    f.guard.attachEngine(cc); assert.equal(await cc.game.init(), 47); assert.equal(cc.game.run(), 48);
    assert.equal(cc.assetManager.loadBundle('race', function (error, value) {
        assert.equal(this, bundle); assert.equal(error, null); assert.equal(value, bundle);
    }), 49);
    f.guard.complete(); assert.equal(cc.game.init, init); assert.equal(cc.assetManager.loadBundle, load);
});

test('实际启动画面：正常与图片失败语义不变，绘制失败由无限等待变成拒绝', async () => {
    const source = fs.readFileSync('build/TapEvents-0.0.5/game/first-screen.js', 'utf8'), guarded = guardFirstScreen(source);
    assert.equal((await firstScreenProbe(guarded)).outcome, 'fulfilled');
    assert.equal((await firstScreenProbe(guarded, { imageFailure: true })).outcome, 'rejected');
    assert.equal((await firstScreenProbe(source, { drawFailure: true })).outcome, 'pending');
    assert.equal((await firstScreenProbe(guarded, { drawFailure: true })).outcome, 'rejected');
    assert.equal((await firstScreenProbe(guarded, { frameAbsent: true })).outcome, 'pending');
    assert.throws(() => guardFirstScreen(guarded), /拒绝重复/);
});

test('实际入口：事件模块失败仍推进初始化；缺少 fetch 时捕获后保持原异常', () => {
    const source = fs.readFileSync('scripts/templates/taptap-guarded-entry.js', 'utf8');
    const normal = bootstrapProbe(source), failedEvents = bootstrapProbe(source, { eventFailure: true });
    assert.equal(normal.thrown, null); assert.equal(normal.eventInstallCalls, 1);
    assert.equal(failedEvents.thrown, null); assert.ok(failedEvents.loadedModules.includes('src/import-map.js'));
    const missingFetch = bootstrapProbe(source, { fetchAbsent: true });
    assert.match(missingFetch.thrown, /fetch is not defined/); assert.equal(missingFetch.caughtByStartupDiagnostic, true);
});

test('实际事件模块：冻结原型不阻断类导出，重复大厅通知也关闭启动监听', () => {
    const root = {}, f = fixture(); root.__swimmingTapStartup = f.guard;
    const exports = {};
    vm.runInNewContext(fs.readFileSync('scripts/templates/taptap-event-test.js', 'utf8'), {
        exports, setTimeout, console: { log() {} }
    });
    const events = exports.install(root, { version: '0.0.6' });
    function Flow() {} Flow.prototype.startGame = function () { return 50; }; Object.freeze(Flow.prototype);
    assert.equal(events.wrapFlow(Flow), Flow); assert.equal(new Flow().startGame(), 50);
    events.lobbyReady(); events.lobbyReady(); assert.equal(f.guard.status().closed, true);
});

test('完整入口异步链：进入大厅后清理；引擎初始化拒绝时停止后续场景运行', async () => {
    async function run(fail) {
        const f = fixture(), frames = [], calls = [], error = new Error('模拟真实引擎初始化失败');
        const cc = { game: {
            init() { calls.push('engine-init'); return fail ? Promise.reject(error) : Promise.resolve(); },
            run() { calls.push('engine-run'); context.__swimmingTapEvents.lobbyReady(); }
        } };
        const originalInit = cc.game.init;
        const Application = function () {};
        Application.prototype.init = function () { calls.push('application-init'); };
        Application.prototype.start = function () { return cc.game.init().then(() => cc.game.run()); };
        const firstScreen = { start() { calls.push('first-screen-start'); return Promise.resolve(); },
            setProgress(value) { calls.push('progress-' + value); return Promise.resolve(); },
            end() { calls.push('first-screen-end'); return Promise.resolve(); } };
        const modules = { './tap-startup-guard': { noopEvents, create(root) { root.__swimmingTapStartup = f.guard; return f.guard; } },
            './tap-startup-diagnostic': { ready() {} }, './tap-font-diagnostic': { install() {} },
            './first-screen': firstScreen, './tap-event-test': { install(root) { root.__swimmingTapEvents = noopEvents(f.guard); } },
            './tap-event-config.json': {}, 'src/import-map.js': { default: {} },
            './web-adapter': {}, './engine-adapter': {}, 'src/polyfills.bundle.js': {}, 'src/system.bundle.js': {} };
        const context = { console: { log() {}, error(e) { calls.push(e); } }, Error,
            window: { devicePixelRatio: 1 }, canvas: { width: 1280, height: 720 },
            GameGlobal: { fetch() {}, requestAnimationFrame(fn) { frames.push(fn); } },
            wx: { ...f.api, getSystemInfoSync() { return { platform: 'android', screenWidth: 1280, screenHeight: 720, devicePixelRatio: 1 }; } },
            System: { warmup() {}, import(name) { return Promise.resolve(name === 'cc' ? cc : { Application }); } },
            require(name) { assert.ok(name in modules, name); return modules[name]; } };
        vm.runInNewContext(fs.readFileSync('scripts/templates/taptap-guarded-entry.js', 'utf8'), context);
        assert.equal(frames.length, 1); frames.shift()();
        // 多层 Promise 链全部结算后才验证，不能把待执行的微任务当作成功。
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.guard.status().closed, true); assert.equal(f.timers.size, 0);
        assert.deepEqual(Object.keys(f.listeners), []); assert.equal(cc.game.init, originalInit);
        assert.ok(calls.includes('first-screen-end')); assert.ok(calls.includes('application-init'));
        if (fail) { assert.ok(!calls.includes('engine-run')); assert.ok(calls.includes(error)); }
        else { assert.ok(calls.includes('engine-run')); assert.ok(f.logs.some(line => line.includes('[TapBoot] ready'))); }
    }
    await run(false); await run(true);
});
