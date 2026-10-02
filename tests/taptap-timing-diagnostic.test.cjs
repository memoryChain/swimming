'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create } = require('../scripts/templates/taptap-timing-diagnostic');
const { instrumentMain, instrumentEvents } = require('../scripts/create-taptap-timing-build.cjs');

function fixture() {
    let time = 1000, serial = 0;
    const timers = new Map(), logs = [], stored = [], listeners = {};
    const f = create({ version: '0.0.7', now: () => time, log: line => logs.push(line),
        schedule(fn, delay) { const id = ++serial; timers.set(id, { fn, at: time + delay }); return id; },
        cancel(id) { timers.delete(id); } });
    const api = { setStorageSync(key, value) { stored.push({ key, value }); } };
    for (const event of ['Show', 'Hide', 'Error']) {
        api['on' + event] = fn => { listeners[event] = fn; };
        api['off' + event] = fn => { if (listeners[event] === fn) delete listeners[event]; };
    }
    f.attachHost(api);
    function advance(duration) {
        const until = time + duration;
        for (;;) {
            const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) break;
            timers.delete(due[0]); time = due[1].at; due[1].fn();
        }
        time = until;
    }
    return { f, timers, logs, stored, listeners, advance, jump(ms) { time += ms; } };
}

test('慢任务有等待和真实完成耗时，保持回调 this、返回值和异常身份', () => {
    const { f, advance } = fixture(); let callback;
    const owner = { loadBundle(name, cb) { assert.equal(this, owner); callback = cb; return 42; } };
    f.attachEngine({ assetManager: owner });
    const receiver = {}, value = {};
    assert.equal(owner.loadBundle('race', function (error, asset) {
        assert.equal(this, receiver); assert.equal(error, null); assert.equal(asset, value); return 43;
    }), 42);
    advance(30000);
    assert.equal(callback.call(receiver, null, value), 43);
    const events = f.dump().events;
    assert.ok(events.some(e => e.name === 'operation_waiting' && e.properties.elapsed_ms === 10000));
    assert.ok(events.some(e => e.name === 'operation_end' && e.properties.elapsed_ms === 30000));
    assert.equal(f.dump().observed_from, 'game_entry'); f.dispose();
    const error = new Error('模拟错误'), next = fixture();
    const throwing = { loadBundle() { throw error; } }; next.f.attachEngine({ assetManager: throwing });
    assert.throws(() => throwing.loadBundle('race', () => {}), e => e === error);
    assert.ok(next.f.dump().events.some(e => e.name === 'operation_failed')); next.f.dispose();
});

test('三参资源签名不会包错类型，四参进度按四分之一采样且保留全部业务回调', () => {
    const { f } = fixture(); const context = {}; let calls = 0;
    function Font() {}
    function Bundle() {} Bundle.prototype.name = 'race';
    Bundle.prototype.load = function (path, type, progress, complete) {
        assert.equal(type, Font);
        if (!complete) { progress.call(context, null, 55); return 56; }
        for (let i = 0; i <= 100; i++) progress.call(context, i, 100);
        complete.call(context, null, 55); return 56;
    };
    f.attachEngine({ AssetManager: { Bundle } });
    const bundle = new Bundle();
    assert.equal(bundle.load('font', Font, function (error, asset) { assert.equal(this, context); assert.equal(asset, 55); }), 56);
    assert.equal(bundle.load('font', Font, function () { assert.equal(this, context); calls++; }, function () {}), 56);
    assert.equal(calls, 101);
    assert.equal(f.dump().events.filter(e => e.name === 'operation_progress').length, 5);
    f.dispose();
});

test('首帧仅监听一次，场景绘制不能冒充大厅可操作；销毁后恢复全部接口', () => {
    const { f } = fixture(), listeners = {}, director = {
        on(name, fn) { listeners[name] = fn; }, off(name, fn) { if (listeners[name] === fn) delete listeners[name]; },
        getScene() { return { name: 'Login' }; }, loadScene(name, cb) { cb(null); return true; }
    };
    const original = director.loadScene;
    f.attachEngine({ director, Director: { EVENT_AFTER_SCENE_LAUNCH: 'launch', EVENT_AFTER_DRAW: 'draw' } });
    assert.equal(director.loadScene('Login', () => {}), true);
    listeners.launch(); assert.ok(listeners.draw); listeners.draw(); assert.equal(listeners.draw, undefined);
    assert.ok(!f.dump().events.some(e => e.name === 'lobby_ready'));
    f.dispose(); assert.equal(director.loadScene, original); assert.deepEqual(listeners, {});
});

test('正常比赛期间关闭等待采样和存储写入；环形记录和等待定时器有界', () => {
    const state = fixture(); state.advance(10000); assert.ok(state.stored.length);
    state.f.business('race_start'); state.advance(0); const count = state.stored.length;
    assert.equal(state.timers.size, 0);
    state.f.captureBoot('failed', { phase: 'sample' }); state.advance(120000);
    assert.equal(state.stored.length, count);
    state.f.business('race_end'); state.advance(0); assert.equal(state.stored.length, count + 1);
    for (let i = 0; i < 300; i++) state.f.record('sample', { index: i });
    assert.equal(state.f.dump().events.length, 180); assert.ok(state.f.dump().dropped > 0);
    state.f.dispose(); assert.deepEqual(Object.keys(state.listeners), []); assert.equal(state.timers.size, 0);
    const bounded = fixture(); bounded.advance(240000); assert.equal(bounded.timers.size, 0); bounded.f.dispose();
});

test('后台暂停等待采样，宿主迟迟不调度定时器时记录调度延迟', () => {
    const state = fixture(); state.listeners.Hide(); state.advance(90000);
    assert.ok(!state.f.dump().events.some(e => e.name === 'startup_waiting'));
    state.listeners.Show(); const callback = [...state.timers.values()][0].fn;
    state.timers.clear(); state.jump(15000); callback();
    assert.ok(state.f.dump().events.some(e => e.name === 'event_loop_waiting' && e.properties.delay_ms === 13000));
    state.f.dispose();
});

test('实际已转换主包与事件模块锚点全部匹配，不重复执行类表达式', () => {
    const input = fs.readFileSync('build/TapGuard-0.0.6/game/assets/main/index.js', 'utf8');
    const result = instrumentMain(input);
    assert.deepEqual(result.anchors, { LoginManager: 1, GameManager: 1, GameFlowController: 1 });
    assert.ok(result.source.length - input.length < 700); // 不能为降级分支复制整个业务类。
    assert.throws(() => instrumentMain(result.source), /重复/);
    const source = fs.readFileSync('build/TapGuard-0.0.6/game/tap-event-test.js', 'utf8');
    new vm.Script(instrumentEvents(source));
});

test('日志/存储不可用不阻断启动，记录不含账户信息或完整外链', () => {
    const f = create({ version: '0.0.7', schedule() { return 1; }, cancel() {}, log() { throw new Error('日志不可用'); } });
    f.attachHost({ setStorageSync() { throw new Error('存储不可用'); },
        getSystemInfoSync() { return { platform: 'android', model: '测试机', openId: 'private-account' }; } });
    f.captureBoot('begin', { phase: 'engine' }); f.business('lobby_ready');
    assert.ok(!JSON.stringify(f.dump()).includes('private-account')); f.dispose();
});

test('实际 0.0.7 入口记录异步引擎耗时，辅助模块失效仍进入大厅', async () => {
    for (const broken of [false, true]) {
        let time = 1000, serial = 0; const timers = new Map(), frames = [];
        const schedule = fn => { const id = ++serial; timers.set(id, fn); return id; };
        const guardExports = {};
        vm.runInNewContext(fs.readFileSync('build/TapTiming-0.0.7/game/tap-startup-guard.js', 'utf8'), {
            exports: guardExports, setTimeout: schedule, clearTimeout: id => timers.delete(id),
            console: { log() {} }, Date: { now: () => time }
        });
        const cc = { game: { init() { return Promise.resolve(); }, run() { context.__swimmingTapEvents.lobbyReady(); } } };
        function Application() {}
        Application.prototype.init = function () {};
        Application.prototype.start = function () { return cc.game.init().then(() => cc.game.run()); };
        const first = { start() { return Promise.resolve(); }, setProgress() { return Promise.resolve(); }, end() { return Promise.resolve(); } };
        const modules = { './tap-timing-diagnostic': { install(root) {
            if (broken) throw new Error('模拟辅助模块不可用');
            root.__swimmingTapTiming = create({ root, version: '0.0.7', now: () => time, schedule,
                cancel: id => timers.delete(id), log() {} });
        } }, './tap-startup-guard': guardExports, './tap-startup-diagnostic': { ready() {} },
            './tap-font-diagnostic': { install() {} }, './first-screen': first,
            './tap-event-test': { install(root) { root.__swimmingTapEvents = guardExports.noopEvents(root.__swimmingTapStartup); } },
            './tap-event-config.json': {}, './web-adapter': {}, './engine-adapter': {},
            'src/import-map.js': { default: {} }, 'src/polyfills.bundle.js': {}, 'src/system.bundle.js': {} };
        const context = { console: { log() {}, error(error) { throw error; } }, Error,
            canvas: { width: 1280, height: 720 }, window: { devicePixelRatio: 1 },
            wx: { getSystemInfoSync() { return { platform: 'android', screenWidth: 1280, screenHeight: 720, devicePixelRatio: 1 }; } },
            GameGlobal: { fetch() {}, requestAnimationFrame(fn) { frames.push(fn); } },
            System: { warmup() {}, import(name) {
                if (name === 'cc') return Promise.resolve().then(() => { time += 12000; return cc; });
                return Promise.resolve({ Application });
            } }, require(name) { assert.ok(name in modules, name); return modules[name]; } };
        vm.runInNewContext(fs.readFileSync('build/TapTiming-0.0.7/game/game.js', 'utf8'), context);
        frames.shift()(); await new Promise(resolve => setImmediate(resolve));
        assert.equal(context.__swimmingTapStartup.status().closed, true);
        if (!broken) {
            assert.ok(context.__swimmingTapTiming.dump().boot_stages.some(s => s.phase === 'engine-import' && s.elapsed_ms === 12000));
            context.__swimmingTapTiming.dispose();
        }
        assert.equal(timers.size, 0);
    }
});
