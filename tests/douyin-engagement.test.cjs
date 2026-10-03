'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function compiler() {
    try { return require('typescript'); } catch {}
    for (const directory of process.env.PATH.split(path.delimiter)) {
        const file = path.resolve(directory, '../typescript/lib/typescript.js');
        if (fs.existsSync(file)) return require(file);
    }
    throw new Error('需要 typescript@5.4.5');
}
const ts = compiler();
function load(relative, imports = {}, extras = {}) {
    const code = ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts', relative), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const exports = {};
    vm.runInNewContext(code, { exports, require: name => {
        if (!(name in imports)) throw new Error('未注入模块：' + name);
        return imports[name];
    }, console, setTimeout, clearTimeout, ...extras });
    return exports;
}
const logic = load('platform/DouyinEngagement.ts');
const { DouyinEngagement, isSidebarEntry } = logic;
const trackerLogic = load('platform/RaceAnalyticsTracker.ts');
const { RaceAnalyticsTracker } = trackerLogic;
const configLogic = load('platform/AnalyticsConfig.ts');
const { GameAnalytics } = load('platform/GameAnalytics.ts', {
    './RaceAnalyticsTracker': trackerLogic, './AnalyticsConfig': configLogic,
});
const { DisabledAnalytics } = load('platform/DisabledAnalytics.ts');
const sidebar = { scene: '021036', launch_from: 'homepage', location: 'sidebar_card', showFrom: 10 };
const common = { build_version: 'main-platform-events-test-1', schema_version: 2, is_test: 1 };
function fixture(latest = {}, extra = {}) {
    const events = [], listeners = new Set();
    const bridge = { startedAt: 100, latest, sequence: 0, subscribe(callback) {
        listeners.add(callback); return () => listeners.delete(callback);
    } };
    const api = { checkScene: options => options.success({ isExist: true }),
        navigateToScene: options => options.success(), reportAnalytics: (event, data) => events.push({ event, data }), ...extra };
    const service = new DouyinEngagement(api, common, bridge, () => 350);
    const show = info => {
        bridge.latest = info; bridge.sequence++;
        for (const callback of listeners) callback(info, bridge.sequence);
    };
    const analytics = new GameAnalytics({ enabled: true, platform: 'douyin',
        report: (event, data) => service.report(event, data), getLaunchContext: () => service.getAnalyticsLaunchContext(),
    }, common, () => 350);
    return { service, analytics, api, bridge, show, events, listeners };
}

test('侧边栏必须匹配平台来源，query 或 scene 单独不算；普通前后台不算', () => {
    assert.equal(isSidebarEntry(sidebar), true);
    for (const info of [{ scene: '021036' }, { query: sidebar }, { ...sidebar, showFrom: 0 },
        { ...sidebar, launch_from: 'share' }, { ...sidebar, location: 'homepage_expand' }]) {
        assert.equal(isSidebarEntry(info), false);
    }
});

test('冷启动回放一次，热启动采用最新完整来源，不残留旧值', async () => {
    const s = fixture(sidebar);
    assert.equal(s.events.filter(e => e.event === 'sidebar_return').length, 1);
    assert.equal(s.service.state.returned, true);
    s.show({ showFrom: 0 });
    assert.equal(s.service.state.returned, false);
    s.show(sidebar);
    assert.equal(s.events.filter(e => e.event === 'sidebar_return').length, 2);
    s.analytics.reportLobbyReady(); s.analytics.reportLobbyReady();
    const lobby = s.events.filter(e => e.event === 'lobby_ready');
    assert.equal(lobby.length, 1); assert.equal(lobby[0].data.load_ms, 250);
    assert.equal(lobby[0].data.source, 'sidebar');
    await s.service.checkSidebar(); s.service.dispose();
    assert.equal(s.listeners.size, 0);
});

test('跳转成功不算复访，重复点击只有一次调用和一个终态', async () => {
    let callback, calls = 0;
    const s = fixture({}, { navigateToScene: options => { calls++; callback = options; } });
    await s.service.checkSidebar();
    const pending = s.service.navigateSidebar();
    assert.equal(await s.service.navigateSidebar(), 'busy');
    callback.success(); callback.fail();
    assert.equal(await pending, 'success'); assert.equal(calls, 1);
    assert.equal(s.service.state.returned, false);
    assert.equal(s.events.filter(e => e.event === 'sidebar_jump_result').length, 1);
    assert.equal(s.events.filter(e => e.event === 'sidebar_return').length, 0);
    s.show(sidebar); assert.equal(s.service.state.returned, true);
    s.service.dispose();
});

test('不支持、缺接口、能力查询失败时不提供跳转，允许重试查询', async () => {
    for (const api of [{ checkScene: undefined }, { navigateToScene: undefined },
        { checkScene: options => options.success({}) }, { checkScene: options => options.fail() },
        { checkScene: () => { throw new Error('失败'); } }]) {
        const s = fixture({}, api);
        assert.equal(await s.service.checkSidebar(), false);
        assert.equal(await s.service.navigateSidebar(), 'unavailable');
        s.api.checkScene = options => options.success({ isExist: true });
        s.api.navigateToScene = options => options.success();
        assert.equal(await s.service.checkSidebar(), true);
        s.service.dispose();
    }
});

test('跳转失败清除忙碌态，销毁后迟到回调不通知旧界面', async () => {
    let callback;
    const s = fixture({}, { navigateToScene: options => { callback = options; } });
    await s.service.checkSidebar();
    const pending = s.service.navigateSidebar();
    callback.fail(); assert.equal(await pending, 'failed');
    assert.equal(s.service.state.navigating, false);
    let notices = 0;
    s.service.subscribe(() => notices++);
    const next = s.service.navigateSidebar();
    const before = notices;
    s.service.dispose(); callback.success();
    await next; s.show(sidebar);
    assert.equal(notices, before);
});

test('上报抛异常不阻断比赛，只有本地玩家的开始/终态/重赛，重复结算不重报', () => {
    const s = fixture({}, { reportAnalytics() { throw new Error('网络失败'); } });
    assert.doesNotThrow(() => s.analytics.reportLobbyReady());
    assert.doesNotThrow(() => s.service.report('race_start', {}));
    const events = [], tracker = new RaceAnalyticsTracker((event, data) => events.push({ event, data }));
    const context = { mode: 'entertainment-brawl', distance: 200, character_id: 'cartonSwimmer6', play_type: 'network', test_type: 'normal' };
    tracker.end('quit', 0, 0, 0); tracker.again(); assert.equal(events.length, 0);
    tracker.start(context); context.distance = 400; tracker.start(context);
    tracker.end('completed', 76.127, 2, 200); tracker.end('quit', 0, 0, 20); tracker.again();
    assert.deepEqual(events.map(e => e.event), ['race_start', 'race_end', 'race_again']);
    assert.equal(events[1].data.distance, 200); assert.equal(events[1].data.time_ms, 76127);
    assert.equal(events[1].data.progress_percent, 100);
    tracker.reset(); tracker.start(context); tracker.end('quit', 5, 0, 50);
    assert.equal(events[4].data.outcome, 'quit'); assert.equal(events[4].data.progress_percent, 13);
    s.service.dispose();
});

test('事件清单与实际字段完全一致，不采集身份和凭证', async () => {
    const s = fixture();
    s.analytics.reportLobbyReady();
    s.service.report('sidebar_guide_click', { entry: 'lobby' });
    await s.service.checkSidebar(); await s.service.navigateSidebar(); s.show(sidebar);
    const tracker = new RaceAnalyticsTracker((event, fields) => s.service.report(event, fields));
    tracker.start({ mode: 'beginner', distance: 200, character_id: 'cartonSwimmer6', play_type: 'local', test_type: 'normal' });
    tracker.end('completed', 82.15, 1, 200); tracker.again();
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'config/analytics-events.json'), 'utf8'));
    assert.equal(new Set(s.events.map(e => e.event)).size, schema.events.length);
    for (const { event, data } of s.events) {
        const fields = { ...schema.commonFields, ...schema.events.find(e => e.name === event).fields };
        assert.deepEqual(Object.keys(data).sort(), Object.keys(fields).sort());
        for (const key of Object.keys(fields)) {
            assert.equal(typeof data[key], fields[key]);
            if (fields[key] === 'number') assert.ok(Number.isInteger(data[key]), `${event}.${key} 必须为整数`);
        }
    }
    s.service.dispose();
});

test('微信与编辑器平台不创建抖音服务、不调用宿主接口', () => {
    const runtime = load('platform/PlatformEngagement.ts', { 'cc/env': { BYTEDANCE: false }, './DouyinEngagement': {
        DouyinEngagement: class { constructor() { throw new Error('不应初始化'); } }
    }, './AnalyticsConfig': configLogic }, { tt: {} });
    assert.equal(runtime.platformEngagement(), null);

});

test('真实比赛回调只报本地终态，等待权威名次；离场与重复结算不重复上报', async () => {
    const { createHarness } = require('./helpers/cocos-math-harness.cjs');
    const events = [];
    const h = createHarness();
    const { GameFlowController } = h.load(path.join(root, 'assets/scripts/app/GameFlowController.ts'));
    const { GameState } = h.load(path.join(root, 'assets/scripts/core/GameConstants.ts'));
    let state = GameState.COUNTDOWN;
    const manager = { elapsedSeconds: 22 };
    const refs = {
        raceManager: manager, playerSwimmer: { distance: 200, rhythmStats: {} }, aiSwimmers: [], aiControllers: [],
        debug() {}, getState: () => state, setState: next => state = next,
        analyticsContext: () => ({ mode: 'beginner', distance: 200, character_id: 'cartonSwimmer6', play_type: 'network', test_type: 'normal' }),
        uiFlow: { showGo() {}, showResult() {}, showProgressionResult() {}, setSprintActive() {} },
        raceCameraDirector: {}, clearFinishRanks() {}, showAwards() {},
        awardProgression: () => null,
        resolveNetLeaderboard(rows, done) { done([{ isPlayer: true, finished: true, placement: 2, time: 22.5 }]); }
    };
    refs.analytics = new RaceAnalyticsTracker((event, data) => events.push({ event, data }));
    const flow = new GameFlowController(refs);
    flow.bindRaceManagerCallbacks();
    manager.onStateChange(GameState.DIVING); manager.onStateChange(GameState.DIVING);
    manager.onRaceFinished(false, 21, 20, { placement: 1, racerCount: 8, leaderboard: [] });
    await Promise.resolve();
    flow.recordPlayerExit();
    manager.onRaceFinished(false, 21, 20, { placement: 1, racerCount: 8, leaderboard: [] });
    await Promise.resolve();
    assert.deepEqual(events.map(e => e.event), ['race_start', 'race_end']);
    assert.equal(events[1].data.placement, 2);
    assert.equal(events[1].data.time_ms, 22500);
    assert.equal(events[1].data.outcome, 'completed');
});

test('单机触壁后提前返回大厅仍算完赛，AI 触壁与最终结算不重复计数', async () => {
    const { createHarness } = require('./helpers/cocos-math-harness.cjs');
    const events = [];
    const h = createHarness();
    const { GameFlowController } = h.load(path.join(root, 'assets/scripts/app/GameFlowController.ts'));
    const { GameState } = h.load(path.join(root, 'assets/scripts/core/GameConstants.ts'));
    const manager = { elapsedSeconds: 50 };
    const refs = {
        raceManager: manager, playerSwimmer: { distance: 200 }, aiSwimmers: [], aiControllers: [],
        debug() {}, setState() {}, getState: () => GameState.DIVING, showFinishRank() {},
        analyticsContext: () => ({ mode: 'beginner', distance: 200, character_id: 'cartonSwimmer6', play_type: 'local', test_type: 'normal' }),
        uiFlow: { showGo() {}, setSprintActive() {} },
        resolveNetLeaderboard(rows, done) { done(rows); },
        awardProgression: () => null,
    };
    refs.analytics = new RaceAnalyticsTracker((event, data) => events.push({ event, data }));
    const flow = new GameFlowController(refs);
    flow.bindRaceManagerCallbacks();
    manager.onStateChange(GameState.DIVING);
    manager.onSwimmerFinished({ isPlayer: false, name: 'AI', placement: 1, time: 40 });
    assert.equal(events.length, 1);
    const result = { isPlayer: true, name: '玩家', finished: true, placement: 2, time: 48.5 };
    manager.onSwimmerFinished(result);
    flow.recordPlayerExit();
    manager.onSwimmerFinished(result);
    manager.onRaceFinished(false, 48.5, 40, { placement: 2, racerCount: 8, leaderboard: [result] });
    await Promise.resolve();
    assert.deepEqual(events.map(e => e.event), ['race_start', 'race_end']);
    assert.equal(events[1].data.outcome, 'completed');
    assert.equal(events[1].data.placement, 2);
    assert.equal(events[1].data.time_ms, 48500);
});


test('抖音构建缺少 tt 时也不建立服务或记录器', () => {
    const runtime = load('platform/PlatformEngagement.ts', {
        'cc/env': { BYTEDANCE: true }, './DouyinEngagement': logic, './AnalyticsConfig': configLogic,
    });
    assert.equal(runtime.platformEngagement(), null);

});

test('平台工厂复用第一批启动桥接，跨场景只注册一份来源监听', () => {
    let show, registrations = 0;
    const events = [];
    const api = { onShow(callback) { registrations++; show = callback; callback(sidebar); },
        reportAnalytics: (event, data) => events.push({ event, data }) };
    const context = vm.createContext({ Date, GameGlobal: {}, tt: api });
    vm.runInContext(fs.readFileSync(path.join(root, 'extensions/douyin-platform-tools/launch-bootstrap.js'), 'utf8'), context);
    const runtime = load('platform/PlatformEngagement.ts', {
        'cc/env': { BYTEDANCE: true }, './DouyinEngagement': logic, './AnalyticsConfig': configLogic,
    }, { GameGlobal: context.GameGlobal, tt: api });
    const service = runtime.platformEngagement();
    assert.equal(runtime.platformEngagement(), service);
    assert.equal(events.filter(e => e.event === 'sidebar_return').length, 1);
    assert.equal(registrations, 1);
    const { DouyinAnalytics } = load('platform/DouyinAnalytics.ts', { './PlatformEngagement': runtime });
    const analytics = new GameAnalytics(new DouyinAnalytics());
    const tracker = analytics.createRaceTracker();
    assert.ok(tracker instanceof RaceAnalyticsTracker);
    tracker.start({ mode: 'beginner', distance: 400, character_id: 'cartonSwimmer16', play_type: 'local', test_type: 'normal' });
    tracker.endLocalFinish(101.1234, 1, 400);
    analytics.reportLobbyReady(); analytics.reportLobbyReady();
    assert.deepEqual(events.map(e => e.event), ['sidebar_return', 'race_start', 'race_end', 'lobby_ready']);
    assert.equal(events[2].data.time_ms, 101123);
    assert.equal(events[2].data.build_version, configLogic.PLATFORM_ANALYTICS_CONFIG.build_version);
    assert.equal(events[2].data.is_test, 1);
    show({ showFrom: 0 }); assert.equal(service.state.returned, false);
    service.dispose(); show(sidebar);
    assert.equal(events.filter(e => e.event === 'sidebar_return').length, 1);
});

test('无启动桥接的开发环境可以兜底监听，销毁时精确解绑', () => {
    let handler, removed;
    const events = [];
    const service = new DouyinEngagement({
        getLaunchOptionsSync: () => sidebar,
        onShow(callback) { handler = callback; }, offShow(callback) { removed = callback; },
        reportAnalytics: (event, data) => events.push({ event, data }),
    }, common, undefined, () => 100);
    assert.equal(service.state.returned, true);
    handler({ showFrom: 0 }); assert.equal(service.state.returned, false);
    service.dispose(); assert.equal(removed, handler);
    handler(sidebar); assert.equal(events.length, 1);
});

test('能力查询和导航超时可结束等待；迟到成功不会改变失败终态', async () => {
    const timers = new Map(); let id = 0, check, navigate;
    const timed = load('platform/DouyinEngagement.ts', {}, {
        setTimeout(callback, delay) { const key = ++id; timers.set(key, { callback, delay }); return key; },
        clearTimeout(key) { timers.delete(key); },
    });
    const events = [];
    const service = new timed.DouyinEngagement({
        checkScene(options) { check = options; }, navigateToScene(options) { navigate = options; },
        reportAnalytics: (event, data) => events.push({ event, data }),
    }, common);
    const pending = service.checkSidebar();
    assert.equal(service.checkSidebar(), pending);
    const timeout = [...timers.values()][0]; assert.equal(timeout.delay, 5000); timeout.callback();
    assert.equal(await pending, false); check.success({ isExist: true });
    assert.equal(service.state.supported, false);
    const retry = service.checkSidebar(); check.success({ isExist: true }); await retry;
    const jump = service.navigateSidebar(); assert.equal(await service.navigateSidebar(), 'busy');
    const jumpTimeout = [...timers.values()][0]; assert.equal(jumpTimeout.delay, 10000); jumpTimeout.callback();
    assert.equal(await jump, 'failed'); navigate.success();
    assert.equal(service.state.navigating, false); assert.equal(service.state.returned, false);
    assert.equal(events.length, 1); assert.equal(events[0].data.result, 'failed');
    assert.equal(timers.size, 0); service.dispose();
});

test('记录器锁定开赛上下文，单机完赛不受外部对象修改影响，非法数值不会上报 NaN', () => {
    const events = [], tracker = new RaceAnalyticsTracker((event, data) => events.push({ event, data }));
    const context = { mode: 'beginner', distance: 200, character_id: 'cartonSwimmer6', play_type: 'local', test_type: 'normal' };
    tracker.start(context); context.play_type = 'network'; context.distance = 400;
    tracker.endLocalFinish(48.512, 2, 200);
    assert.equal(events[1].data.play_type, 'local'); assert.equal(events[1].data.distance, 200);
    tracker.reset(); tracker.start(context); tracker.end('dnf', NaN, Infinity, -20);
    assert.equal(events[3].data.time_ms, 0); assert.equal(events[3].data.placement, 0);
    assert.equal(events[3].data.progress_percent, 0);
});

function flowFixture({ playType = 'network', context = true } = {}) {
    const h = require('./helpers/cocos-math-harness.cjs').createHarness();
    const { GameFlowController } = h.load(path.join(root, 'assets/scripts/app/GameFlowController.ts'));
    const { GameState } = h.load(path.join(root, 'assets/scripts/core/GameConstants.ts'));
    const events = [], settled = []; let done, state = GameState.COUNTDOWN;
    const manager = { elapsedSeconds: 12.125 };
    const refs = { raceManager: manager, playerSwimmer: { distance: 50, rhythmStats: {} }, aiSwimmers: [], aiControllers: [],
        analytics: new RaceAnalyticsTracker((event, data) => events.push({ event, data })),
        analyticsContext: () => context ? { mode: 'wild-400', distance: 400, character_id: 'cartonSwimmer16',
            play_type: playType, test_type: 'normal' } : null,
        debug() {}, setState: next => state = next, getState: () => state, showFinishRank() {}, clearFinishRanks() {},
        uiFlow: { showGo() {}, showDivePrompt() {}, setSprintActive() {}, showResult() {}, showProgressionResult() {} },
        resolveNetLeaderboard(rows, callback) { done = callback; },
        awardProgression(input) { settled.push(input); return null; }, showAwards() {},
    };
    const flow = new GameFlowController(refs); flow.bindRaceManagerCallbacks();
    return { flow, manager, refs, events, settled, GameState, resolve: row => done([row]),
        finish: () => manager.onRaceFinished(false, 11, 10, { placement: 1, racerCount: 8, leaderboard: [] }) };
}

test('教学传入空上下文，发令、结算、退出均不计入普通比赛', async () => {
    const s = flowFixture({ context: false }); s.manager.tutorialMode = true;
    s.manager.onStateChange(s.GameState.DIVING); s.finish();
    s.resolve({ isPlayer: true, finished: true, time: 50, placement: 1 });
    await Promise.resolve(); s.flow.recordPlayerExit();
    assert.equal(s.events.length, 0); assert.equal(s.settled.length, 1);
});

test('联机本地触壁不抢报，权威结果同时驱动埋点与原有结算入参', async () => {
    const s = flowFixture(); s.manager.onStateChange(s.GameState.DIVING);
    s.manager.onSwimmerFinished({ isPlayer: true, name: '玩家', finished: true, placement: 1, time: 11 });
    assert.equal(s.events.length, 1);
    s.finish(); assert.equal(s.events.length, 1);
    s.resolve({ isPlayer: true, finished: true, time: 15.678, placement: 3 }); await Promise.resolve();
    assert.equal(s.events[1].data.time_ms, 15678); assert.equal(s.events[1].data.placement, 3);
    assert.equal(s.settled[0].time, 15.678); assert.equal(s.settled[0].placement, 3);
    assert.equal(s.settled[0].finished, true);
});

test('主动退出只记录一次，退出解绑后迟到的权威成绩不能结算或补报', async () => {
    const s = flowFixture(); s.manager.onStateChange(s.GameState.DIVING); s.finish();
    s.flow.recordPlayerExit(); s.flow.recordPlayerExit(); s.flow.clearRaceManagerCallbacks();
    s.resolve({ isPlayer: true, finished: true, time: 15, placement: 1 }); await Promise.resolve();
    assert.deepEqual(s.events.map(e => e.event), ['race_start', 'race_end']);
    assert.equal(s.events[1].data.outcome, 'quit'); assert.equal(s.events[1].data.time_ms, 12125);
    assert.equal(s.events[1].data.progress_percent, 13); assert.equal(s.settled.length, 0);
});

test('结算保留未完成、淘汰和退出终态；单纯场景销毁不冒充退出', async () => {
    for (const [flags, outcome] of [[{}, 'dnf'], [{ eliminated: true }, 'eliminated'], [{ eliminated: true, quit: true }, 'quit']]) {
        const s = flowFixture(); s.manager.onStateChange(s.GameState.DIVING); s.finish();
        s.resolve({ isPlayer: true, finished: false, placement: 8, time: 0, ...flags }); await Promise.resolve();
        assert.equal(s.events[1].data.outcome, outcome); assert.equal(s.settled[0].finished, false);
    }
    const s = flowFixture(); s.manager.onStateChange(s.GameState.DIVING); s.flow.clearRaceManagerCallbacks();
    assert.deepEqual(s.events.map(e => e.event), ['race_start']);
});

test('真实主干接线排除教学，保留当前角色、赛程和模式', () => {
    const relative = 'assets/scripts/core/GameManager.ts';
    const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'GameManager');
    const method = cls.members.find(n => n.name?.getText(source) === 'createGameFlow');
    let refs;
    const code = ts.transpileModule('class Manager { ' + method.getText(source) + ' }; return Manager;',
        { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const Manager = new Function('GameFlowController', 'gameAnalytics', 'getRaceDifficultyConfig',
        'getRaceDistance', 'getPlayerCharacterSelection', code)(class { constructor(value) { refs = value; } },
        () => ({ createRaceTracker: () => null }), () => ({ id: 'wild-400' }), () => 400, () => ({ characterId: 'cartonSwimmer16' }));
    const manager = new Manager(); manager._tutorialMode = true; manager.createGameFlow();
    assert.equal(refs.analytics, null); assert.equal(refs.analyticsContext(), null);
    manager._tutorialMode = false;
    assert.deepEqual(refs.analyticsContext(), { mode: 'wild-400', distance: 400, character_id: 'cartonSwimmer16', play_type: 'local', test_type: 'normal' });
    manager._netSession = {}; manager._aiDebugMode = true;
    assert.equal(refs.analyticsContext().play_type, 'network'); assert.equal(refs.analyticsContext().test_type, 'ai_debug');
});
