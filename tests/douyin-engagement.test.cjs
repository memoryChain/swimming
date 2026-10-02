'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
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
const { DouyinEngagement, RaceAnalyticsTracker, isSidebarEntry } = logic;
const sidebar = { scene: '021036', launch_from: 'homepage', location: 'sidebar_card', showFrom: 10 };
const common = { build_version: 'douyin-platform-test-2', schema_version: 2, is_test: 1 };
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
    return { service, api, bridge, show, events, listeners };
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
    s.service.reportLobbyReady(); s.service.reportLobbyReady();
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
    assert.doesNotThrow(() => s.service.reportLobbyReady());
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
    s.service.reportLobbyReady();
    s.service.report('sidebar_guide_click', { entry: 'lobby' });
    await s.service.checkSidebar(); await s.service.navigateSidebar(); s.show(sidebar);
    const tracker = new RaceAnalyticsTracker((event, fields) => s.service.report(event, fields));
    tracker.start({ mode: 'beginner', distance: 200, character_id: 'cartonSwimmer6', play_type: 'local', test_type: 'normal' });
    tracker.end('completed', 82.15, 1, 200); tracker.again();
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'scripts/build-configs/douyin-basic-events.json'), 'utf8'));
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
    } }, { tt: {} });
    assert.equal(runtime.platformEngagement(), null);
});

test('真实启动脚本在引擎前注册监听，捕获早期回调、隔离监听者与敏感 query', () => {
    let show, subscribed = 0;
    const context = vm.createContext({ Date, console, GameGlobal: {}, tt: {
        onShow(callback) { subscribed++; show = callback; callback(sidebar); },
        getLaunchOptionsSync() { throw new Error('有 onShow 时不应覆盖最新来源'); }
    } });
    const code = fs.readFileSync(path.join(root, 'extensions/douyin-platform-tools/launch-bootstrap.js'), 'utf8');
    vm.runInContext(code, context); vm.runInContext(code, context);
    const bridge = context.GameGlobal.__swimmingDouyinLaunch;
    assert.equal(subscribed, 1); assert.equal(bridge.sequence, 1);
    assert.equal(bridge.latest.location, 'sidebar_card');
    bridge.subscribe(() => { throw new Error('旧界面'); });
    let calls = 0; const off = bridge.subscribe(() => calls++);
    show({ query: { token: '不能保存' }, showFrom: 0 }); off(); show(sidebar);
    assert.equal(calls, 1); assert.equal('query' in bridge.latest, false);
});

test('构建监听注入幂等，game.js 第一条语句先于 loadCC，源引擎内容保留', () => {
    const { installLaunchBootstrap } = require('../extensions/douyin-platform-tools/hooks');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-launch-test-'));
    try {
        fs.writeFileSync(path.join(dir, 'game.js'), 'loadCC();\n');
        installLaunchBootstrap(dir); installLaunchBootstrap(dir);
        const code = fs.readFileSync(path.join(dir, 'game.js'), 'utf8');
        assert.equal(code, "require('./douyin-launch-bootstrap.js');\nloadCC();\n");
        assert(fs.existsSync(path.join(dir, 'douyin-launch-bootstrap.js')));
    } finally {
        assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
        assert(path.basename(dir).startsWith('douyin-launch-test-'));
        fs.rmSync(dir, { recursive: true });
    }
});

test('真实比赛回调只报本地终态，等待权威名次；离场与重复结算不重复上报', async () => {
    const { createHarness } = require('./helpers/cocos-math-harness.cjs');
    const events = [];
    const h = createHarness({ '../platform/PlatformEngagement': { platformEngagement: () => ({
        report: (event, data) => events.push({ event, data })
    }) } });
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
    const h = createHarness({ '../platform/PlatformEngagement': { platformEngagement: () => ({
        report: (event, data) => events.push({ event, data })
    }) } });
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

test('侧边栏弹窗重复开关不重建，导航前立即释放遮罩，销毁解绑来源监听', async () => {
    class UITransform { setContentSize(width, height) { this.contentSize = { width, height }; } }
    class Label { static Overflow = { SHRINK: 1 }; static HorizontalAlign = { LEFT: 0, CENTER: 1 }; string = ''; }
    class Button { static EventType = { CLICK: 'click' }; interactable = true; }
    class Sprite { static SizeMode = { CUSTOM: 1 }; isValid = true; }
    class Node {
        static EventType = { TOUCH_END: 'touchend' };
        constructor(name, parent) { this.name = name; this.parent = parent; this.children = []; this.active = true;
            this.isValid = true; this.components = new Map(); this.events = new Map(); if (parent) parent.children.push(this); }
        addComponent(kind) { const component = new kind(); this.components.set(kind, component); return component; }
        getComponent(kind) { return this.components.get(kind); }
        setPosition() {}
        on(event, callback) { this.events.set(event, callback); }
        destroy() { this.isValid = false; for (const child of this.children) child.destroy(); }
    }
    const parent = new Node('Hud');
    const makeUiNode = (name, owner) => { const node = new Node(name, owner); node.addComponent(UITransform); return node; };
    const makeLabel = (name, owner, text) => { const node = makeUiNode(name, owner); node.addComponent(Label).string = text; return node; };
    const callbacks = new Set(), history = [], state = { supported: true, returned: false, navigating: false };
    const service = { state, report() {}, subscribe(callback) { callbacks.add(callback); callback(state); return () => callbacks.delete(callback); },
        navigateSidebar() { assert.equal(panel.root.active, false); assert.equal(history.at(-1), false); return Promise.resolve('success'); } };
    class Motion {
        constructor(root) { this.root = root; this.showing = false; }
        get interactive() { return this.showing && this.root.active; }
        show() { this.showing = true; this.root.active = true; }
        hide(done) { this.hideImmediately(); done?.(); }
        hideImmediately() { this.showing = false; this.root.active = false; }
        bindButton() {}
        dispose() { this.hideImmediately(); }
    }
    const { SidebarReturnPanel } = load('ui/SidebarReturnPanel.ts', {
        cc: { Node, Label, Button, Sprite, UITransform, BlockInputEvents: class {} },
        '../core/ResourcePaths': { RESOURCE_PATHS: { avatarPickerUi: { panel: 'panel', cancelButton: 'cancel' }, characterUi: { headerBackground: 'header', confirmButton: 'confirm' } } },
        '../platform/PlatformEngagement': { platformEngagement: () => service },
        './AvatarUiAssets': { loadAvatarUiSpriteFrame: (path, done) => done({ path }) },
        './PopupUiMotion': { PopupUiMotion: Motion }, './ProjectUiFonts': { styleProjectUiLabel() {} },
        './RuntimeUiFactory': { makeUiNode, makeLabel, makeRect: makeUiNode,
            makeTouchArea(name, owner) { const node = makeUiNode(name, owner); node.addComponent(Button); return node; },
            fitFullScreenSolidCover() {}, uiColor() {} }, './Toast': { showToast() {} }
    });
    const panel = new SidebarReturnPanel(presented => history.push(presented));
    panel.build(parent, 1280, 720);
    const count = node => 1 + node.children.reduce((total, child) => total + count(child), 0);
    const nodes = count(parent);
    for (let i = 0; i < 10; i++) { panel.build(parent, 1280, 720); panel.show(); panel.hide(); }
    assert.equal(count(parent), nodes); assert.equal(callbacks.size, 1);
    panel.show();
    const status = panel.status.string;
    panel.hide(); state.returned = true; for (const callback of callbacks) callback(state);
    assert.equal(panel.status.string, status, '隐藏时不更新文字');
    panel.show(); assert.match(panel.status.string, /已确认/);
    state.returned = false;
    panel.go(); await Promise.resolve();
    assert.equal(panel.root.active, false);
    panel.dispose(); assert.equal(callbacks.size, 0);
    for (const callback of callbacks) callback(state);
});
