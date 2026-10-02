'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create } = require('../scripts/templates/taptap-event-test.js');
const { instrumentMain } = require('../scripts/create-taptap-event-test.cjs');

function fixture(config = {}) {
    let time = 1700000000000;
    const timers = [], requests = [], logs = [], storage = new Map();
    const api = {
        getStorageSync: key => storage.get(key),
        setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
        request: request => requests.push(request),
    };
    const options = { api, config: { version: '0.0.5', ...config }, now: () => time,
        schedule: (fn, delay) => timers.push({ fn, at: time + delay }), log: line => logs.push(line) };
    const advance = duration => {
        const until = time + duration;
        while (true) {
            timers.sort((a, b) => a.at - b.at);
            if (!timers.length || timers[0].at > until) break;
            const timer = timers.shift(); time = timer.at; timer.fn();
        }
        time = until;
    };
    return { controller: create(options), options, storage, requests, logs, advance };
}

function game(controller, playType = 'local') {
    let stateChanges = 0, callbackThis = null;
    const swimmer = { distance: 200 };
    const refs = { playerSwimmer: swimmer, raceManager: { elapsedSeconds: 16 },
        resolveNetLeaderboard(rows, done) { return done.call(this, rows); } };
    class Flow {
        constructor() { this._refs = refs; this._finishPresentationVersion = 1; }
        startGame() { this._finishPresentationVersion++; return 12; }
        restartGame() { this.startGame(); return 13; }
        bindRaceManagerCallbacks() {
            refs.raceManager.onStateChange = () => { stateChanges++; return 7; };
            refs.raceManager.onSwimmerFinished = () => 8;
            return 9;
        }
    }
    class Manager {
        constructor(flow) { this._gameFlow = flow; this._launchMode = 'race'; this._raceManager = refs.raceManager; this._playerSwimmer = swimmer; }
        restartGame() { return this._gameFlow.restartGame(); }
        returnToLogin() { this._isReturningToLogin = true; return 14; }
    }
    controller.wrapFlow(Flow); controller.wrapFlow(Flow); controller.wrapManager(Manager);
    const flow = new Flow(), manager = new Manager(flow);
    controller.attachFlow(flow, manager, () => ({ mode: 'beginner', distance: 200,
        character_id: 'cartonSwimmer6', play_type: playType, test_type: 'normal' }));
    return { flow, manager, refs, swimmer, stateChanges: () => stateChanges,
        done(rows) { return refs.resolveNetLeaderboard(rows, function () { callbackThis = this; return 27; }); },
        callbackThis: () => callbackThis };
}

test('实际开赛、玩家触壁、总结果、重赛和退出去重，保留原回调返回值及绑定', () => {
    const { controller, requests } = fixture();
    const g = game(controller);
    controller.lobbyReady(); controller.lobbyReady();
    assert.equal(g.flow.bindRaceManagerCallbacks(), 9);
    assert.equal(g.flow.startGame(), 12);
    assert.equal(g.refs.raceManager.onStateChange('countdown'), 7);
    g.refs.raceManager.onStateChange('diving'); g.refs.raceManager.onStateChange('diving');
    assert.equal(g.refs.raceManager.onSwimmerFinished({ isPlayer: false, time: 10, placement: 1 }), 8);
    g.refs.raceManager.onSwimmerFinished({ isPlayer: true, time: 16.127, placement: 2 });
    assert.equal(g.done([{ isPlayer: true, finished: true, time: 16.127, placement: 2 }]), 27);
    assert.equal(g.callbackThis(), g.refs);
    assert.equal(g.manager.restartGame(), 13);
    g.manager.restartGame(); // 重复点击未开始下一局，不能再记旧局再玩。
    g.refs.raceManager.onStateChange('diving'); g.swimmer.distance = 50;
    assert.equal(g.manager.returnToLogin(), 14); g.manager.returnToLogin();
    const events = controller.dump();
    assert.deepEqual(events.map(e => e.name), ['lobby_ready', 'race_start', 'race_end', 'race_again', 'race_start', 'race_end']);
    assert.equal(events[2].properties.time_ms, 16127);
    assert.equal(events[2].properties.progress_percent, 100);
    assert.equal(events[5].properties.outcome, 'quit');
    assert.equal(events[5].properties.progress_percent, 25);
    assert.equal(events[1].properties.race_id, events[2].properties.race_id);
    assert.notEqual(events[1].properties.race_id, events[4].properties.race_id);
    const manifest = require('../scripts/taptap-basic-events.json');
    assert.deepEqual([...new Set(events.map(e=>e.name))].sort(), Object.keys(manifest.events).sort());
    for (const event of events) {
        const definition = manifest.events[event.name];
        const fields = {...(definition.race_context ? manifest.race_context : {}), ...definition.properties};
        assert.deepEqual(Object.keys(event.properties).sort(), Object.keys(fields).sort());
        for (const [key,type] of Object.entries({...manifest.common,...fields})) {
            const value = key in fields ? event.properties[key] : event[key];
            assert.ok(type === 'integer' ? Number.isSafeInteger(value) : typeof value === type, key);
        }
    }
    assert.equal(g.stateChanges(), 4); assert.equal(requests.length, 0);
});

test('联机只记录本地玩家，并等待权威名次；AI 调试和托管不采集', () => {
    const { controller } = fixture();
    const g = game(controller, 'network');
    g.flow.bindRaceManagerCallbacks(); g.flow.startGame();
    g.refs.raceManager.onStateChange('diving');
    g.refs.raceManager.onSwimmerFinished({ isPlayer: true, time: 18, placement: 3 });
    assert.equal(controller.dump().length, 1);
    g.done([{ isPlayer: false, finished: true, time: 10, placement: 1 },
        { isPlayer: true, finished: true, time: 19.75, placement: 2 }]);
    assert.equal(controller.dump()[1].properties.time_ms, 19750);
    assert.equal(controller.dump()[1].properties.placement, 2);
    for (const flag of ['_aiDebugMode', '_playerAutopilotEnabled', '_playerAutopilotUsedThisRace']) {
        const other = game(controller); other.manager[flag] = true;
        other.flow.bindRaceManagerCallbacks(); other.flow.startGame(); other.refs.raceManager.onStateChange('diving');
    }
    assert.equal(controller.dump().length, 2);
});

test('本地玩家触壁后仍不在比赛阶段发送，旧局迟到结果不会结算新局', () => {
    const f = fixture({ endpoint: 'https://collector.example/events', test_transport_enabled: true });
    const g = game(f.controller);
    g.flow.bindRaceManagerCallbacks(); g.flow.startGame();
    g.refs.raceManager.onStateChange('diving');
    g.refs.raceManager.onSwimmerFinished({ isPlayer: true, time: 17, placement: 2 });
    f.advance(10000);
    assert.equal(f.requests.length, 0);
    g.done([{ isPlayer: true, finished: true, time: 17, placement: 2 }]);
    f.advance(200); assert.equal(f.requests.length, 1);
    const network = game(f.controller, 'network');
    let late;
    network.refs.resolveNetLeaderboard = function (rows, done) { late = done; return 71; };
    network.flow.bindRaceManagerCallbacks(); network.flow.startGame();
    network.refs.raceManager.onStateChange('diving');
    assert.equal(network.done([]), 71);
    network.flow.startGame(); network.refs.raceManager.onStateChange('diving');
    late([{ isPlayer: true, finished: true, time: 20, placement: 1 }]);
    assert.equal(f.controller.dump().filter(e => e.name === 'race_end').length, 1);
});

test('本地存储容量有界、重启保留事件 ID，未知事件及敏感字段不会进入记录', () => {
    const f = fixture();
    f.controller.record('unknown', { code: 'private' });
    for (let i = 0; i < 100; i++) f.controller.record('race_start', { mode: 'beginner', openid: 'private', token: 'private', distance: Infinity });
    assert.equal(f.controller.status().recorded, 64);
    assert.equal(f.controller.status().pending, 64);
    assert.equal(f.controller.status().dropped, 36);
    assert.ok(f.logs.length <= 48);
    const restored = create(f.options);
    assert.deepEqual(restored.dump(), f.controller.dump());
    assert.equal(JSON.stringify(restored.dump()).includes('private'), false);
    f.advance(8 * 24 * 60 * 60 * 1000);
    assert.equal(create(f.options).status().recorded, 0);
});

test('基础字段对齐抖音毫秒口径，数值为整数且旧版秒字段不会混入', () => {
    const f = fixture({ version: '0.0.10' });
    f.controller.lobbyReady();
    const g = game(f.controller);
    g.flow.bindRaceManagerCallbacks(); g.flow.startGame();
    g.refs.raceManager.onStateChange('diving');
    g.refs.raceManager.onSwimmerFinished({ isPlayer: true, time: 74.168, placement: 1 });
    const events = f.controller.dump();
    assert.equal(events[0].properties.source, 'unknown');
    assert.equal(events[2].properties.time_ms, 74168);
    for (const event of events) {
        assert.equal(event.schema_version, 2); assert.equal(event.channel, 'taptap');
        assert.equal(event.build_version, '0.0.10'); assert.equal(event.is_test, 1);
        assert.ok(!('time_s' in event.properties));
        for (const value of Object.values(event.properties)) if (typeof value === 'number') assert.ok(Number.isSafeInteger(value));
    }
    f.controller.record('race_end', { time_s: 10, time_ms: 12.5, placement: '1', distance: NaN, progress_percent: 120 });
    assert.deepEqual(f.controller.dump().at(-1).properties, {time_ms:13,progress_percent:100});
});

test('新字段版本与旧缓存隔离，旧诊断事件不伪装为当前字段版本', () => {
    const f = fixture();
    f.storage.set('swimming.tap.event-test.v1', {events:[{name:'race_end',schema_version:1}],pending:[]});
    assert.deepEqual(create(f.options).dump(), []);
    f.controller.lobbyReady();
    const saved = f.storage.get('swimming.tap.event-test.v2');
    saved.events[0].schema_version = 1;
    assert.deepEqual(create(f.options).dump(), []);
    assert.ok(f.storage.has('swimming.tap.event-test.v1'));
});

test('仅配置真实 HTTPS 接收端才发送，普通 HTTP 200 不确认，失败重试有上限', () => {
    const f = fixture({ endpoint: 'https://collector.example/events', test_transport_enabled: true });
    f.controller.lobbyReady(); f.advance(200);
    const originalId = f.requests[0].data.events[0].event_id;
    f.requests[0].success({ statusCode: 200, data: { success: true } });
    assert.equal(f.controller.status().pending, 1);
    f.advance(2000); assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].data.events[0].event_id, originalId);
    f.requests[1].fail({}); f.advance(4000);
    assert.equal(f.requests.length, 3);
    f.requests[2].fail({}); f.advance(60000);
    assert.equal(f.requests.length, 3);
    assert.equal(f.controller.status().pending, 1);
    const insecure = fixture({ endpoint: 'http://collector.example/events', test_transport_enabled: true });
    insecure.controller.lobbyReady(); insecure.advance(10000);
    assert.equal(insecure.requests.length, 0);
});

test('部分确认只移除对应事件，发包时新发生的事件不会被错误清除', () => {
    const f = fixture({ endpoint: 'https://collector.example/events', test_transport_enabled: true });
    f.controller.lobbyReady(); f.controller.record('race_again', { mode: 'beginner' }); f.advance(200);
    const first = f.requests[0], id = first.data.events[0].event_id;
    f.controller.record('race_end', { outcome: 'quit' });
    first.success({ statusCode: 200, data: { accepted_event_ids: [id, 'unknown-id'] } });
    assert.equal(f.controller.status().pending, 2);
    first.fail({}); // success/fail 双回调不能触发重复发送。
    f.advance(200); assert.equal(f.requests.length, 2);
    const second = f.requests[1];
    second.success({ statusCode: 200, data: { accepted_event_ids: second.data.events.map(e => e.event_id) } });
    assert.equal(f.controller.status().pending, 0);
    assert.equal(f.controller.dump().length, 3);
});

test('宿主存储/记录失败不改变原游戏异常和正常调用，比赛帧没有统计钩子', () => {
    const controller = create({ api: { getStorageSync() { throw Error('storage'); }, setStorageSync() { throw Error('storage'); } },
        log() { throw Error('console'); } });
    controller.lobbyReady();
    const originalError = Error('gameplay');
    class Flow { startGame() { throw originalError; } update() { return 23; } }
    const update = Flow.prototype.update;
    controller.wrapFlow(Flow);
    assert.equal(Flow.prototype.update, update);
    assert.equal(new Flow().update(), 23);
    assert.throws(() => new Flow().startGame(), value => value === originalError);
});

test('对真实 0.0.4 插桩只命中四个业务锚点，拒绝变化和重复插桩', { skip: !fs.existsSync('build/TapDiagnostic-0.0.4/game/assets/main/index.js') }, () => {
    const source = fs.readFileSync('build/TapDiagnostic-0.0.4/game/assets/main/index.js', 'utf8');
    const result = instrumentMain(source);
    assert.deepEqual(result.anchors, { flow: 1, manager: 1, attach: 1, lobby: 1 });
    new vm.Script(result.source);
    assert.throws(() => instrumentMain(result.source), /重复/);
    assert.throws(() => instrumentMain('var unrelated = true;'), /锚点/);
});

test('插桩后的模块能执行；异步大厅加载失败和无效根节点不会误报就绪', () => {
    const { controller } = fixture();
    const classes = {}, callbacks = [];
    const source = `
    System.register('chunks:///_virtual/GameFlowController.ts', [], function(out) {
      return {execute:function(){ function Flow(refs){this._refs=refs;} Flow.prototype.startGame=function(){};
        out('GameFlowController',Flow); }};
    });
    System.register('chunks:///_virtual/GameManager.ts', [], function(out) {
      var distance, mode, selection; distance=imports.getRaceDistance;mode=imports.getRaceDifficultyConfig;selection=imports.getPlayerCharacterSelection;
      return {execute:function(){function Manager(){var owner=this;owner._launchMode='race';owner._netSession={};owner._gameFlow=owner.createGameFlow();}
        Manager.prototype.createGameFlow=function(){return new classes.GameFlowController({});};out('GameManager',Manager);}};
    });
    System.register('chunks:///_virtual/LoginManager.ts', [], function(out) {
      return {execute:function(){function Login(){};Login.prototype.build=function(){var owner=this;
        new Ui().build(1,2,3,function(error,refs){owner._loginUiRoot=refs&&refs.root;owner._loginUiRetries=0;});};out('LoginManager',Login);}};
    });`;
    let attachedContext;
    const context = { classes, imports: { getRaceDistance: () => 200, getRaceDifficultyConfig: () => ({id:'beginner'}),
        getPlayerCharacterSelection: () => ({characterId:'cartonSwimmer6'}) },
        Ui: class { build(a,b,c,done) { callbacks.push(done); } },
        __swimmingTapEvents: { ...controller, attachFlow(flow, manager, provider) { attachedContext = provider();return controller.attachFlow(flow, manager, provider); } },
        System: { register(id, deps, factory) { factory((name, value) => classes[name] = value).execute(); } } };
    vm.runInNewContext(instrumentMain(source).source, context);
    const manager = new classes.GameManager();
    assert.equal(attachedContext.play_type, 'network');
    assert.equal(attachedContext.distance, 200);
    assert.ok(manager._gameFlow);
    const login = new classes.LoginManager(); login.build();
    callbacks[0](Error('loading'), {root:{isValid:true}});
    callbacks[0](null, {root:{isValid:false}});
    assert.equal(controller.dump().length, 0);
    callbacks[0](null, {root:{isValid:true}}); callbacks[0](null, {root:{isValid:true}});
    assert.equal(controller.dump().length, 1);
    assert.equal(controller.dump()[0].name, 'lobby_ready');
});
