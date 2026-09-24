const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const dir of process.env.PATH.split(path.delimiter)) {
        const file = path.resolve(dir, '../typescript/lib/typescript.js');
        if (fs.existsSync(file)) return require(file);
    }
    throw new Error('需要 TypeScript 5.4.5');
}
const ts = compiler();
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const transpile = code => ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
} }).outputText;
function methods(file, className, names, globals = {}) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const type = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className);
    const members = type.members.filter(n => names.includes(n.name?.getText(source)));
    assert.equal(members.length, names.length);
    return vm.runInNewContext(transpile(`class Subject { ${members.map(n => n.getText(source)).join('\n')} }`) + '; Subject', globals);
}
function harness() {
    const hooks = new Map(), timers = new Map(), logs = [];
    let timerId = 0;
    const clock = { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
    const cc = { Director: { EVENT_AFTER_DRAW: 'draw' }, director: {
        on(event, fn, owner) { hooks.set(fn, owner); }, off(event, fn) { hooks.delete(fn); },
    } };
    const exports = {};
    vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'assets/scripts/core/RaceLoading.ts'), 'utf8')),
        { require: id => { assert.equal(id, 'cc'); return cc; }, exports, ...clock, console: { log: s => logs.push(s) } });
    const frame = async () => { for (const [fn, owner] of hooks) fn.call(owner); await flush(); };
    return { ...exports, hooks, timers, logs, clock, frame };
}

test('多个模型请求可并发完成，实际初始化每帧最多一个；取消后清空队列', async () => {
    const h = harness(), scope = new h.RaceLoading(), calls = [];
    for (let i = 0; i < 4; i++) h.initializeRaceModel(() => calls.push(i), error => { throw error; });
    assert.equal(calls.length, 0);
    await h.frame(); assert.deepEqual(calls, [0]);
    await h.frame(); assert.deepEqual(calls, [0, 1]);
    scope.cancel(); await h.frame(); assert.deepEqual(calls, [0, 1]);
    assert.equal(h.hooks.size, 0); assert.equal(h.timers.size, 0);
});

test('实例化异常回传；资源完成回调中新发出的请求仍必须等待', async () => {
    const h = harness(), scope = new h.RaceLoading(); let failure, inner;
    h.initializeRaceModel(() => { throw new Error('模型损坏'); }, e => failure = e);
    const outer = h.trackRaceAsset(() => { inner = h.trackRaceAsset(() => {}); });
    let ready = false;
    const pending = scope.waitFor('资源', () => scope.assetsPending === 0).then(() => ready = true);
    outer(); outer(); assert.equal(scope.assetsPending, 1);
    await h.frame(); assert.match(failure.message, /模型损坏/); assert.equal(ready, false);
    inner(); await h.frame(); await pending; assert.equal(ready, true);
    scope.finish(); assert.equal(h.hooks.size, 0);
});

test('超时会拒绝未回调任务；迟到完成不能复活等待，也不留下帧监听', async () => {
    const h = harness(), scope = new h.RaceLoading(); let complete;
    const waiting = scope.step('模型', done => complete = done);
    const rejected = assert.rejects(waiting, /超时/);
    [...h.timers.values()][0](); await rejected;
    complete(); assert.equal(scope.active, false); assert.equal(h.hooks.size, 0);
    await assert.rejects(scope.frames(), /超时/);
});

test('退出和下一次进场取消旧任务，旧资源只完成自身回调', async () => {
    const h = harness(), old = new h.RaceLoading(); let callbacks = 0;
    const complete = h.trackRaceAsset(() => callbacks++);
    const waiting = assert.rejects(old.frames(3), /替换/);
    const next = new h.RaceLoading(); await waiting;
    complete(); assert.equal(callbacks, 1); assert.equal(next.assetsPending, 0);
    assert.equal(h.hooks.size, 1); next.cancel(); assert.equal(h.hooks.size, 0);
});

function raceFixture(mode = 'race') {
    const h = harness(), calls = [], assets = new Map();
    const Subject = methods('assets/scripts/core/GameManager.ts', 'GameManager', ['loadRace', 'update'], {
        RaceLoading: h.RaceLoading, DEBUG_UI_ENABLED: mode !== 'race', consumeMainGameLaunchMode: () => mode,
        loadSavedTuningAsync: done => assets.set('tuning', done),
        loadSampledActionsForRace: done => assets.set('actions', done),
        LoadingOverlay: { hide: () => calls.push('hide') }, logTextureFormatDiagnostics() {},
    });
    const manager = new Subject();
    const swimmer = () => ({ node: { isValid: true }, cartoonRig: { raceReady: true, raceLoadError: null } });
    Object.assign(manager, { node: { isValid: true }, _aiSwimmers: [], _playerSwimmer: swimmer(),
        _preRaceIntroPanel: { loadError: null }, initializeRaceContext() { calls.push('context'); },
        buildScene(done) { calls.push('scene'); done(); },
        buildDeferredAiSwimmers() { manager._aiSwimmers = [swimmer(), swimmer()]; manager._aiSwimmers[1].cartoonRig.raceReady = false; calls.push('ai'); },
        applyAiDebugHud() {}, buildSpectatorCrowd() { calls.push('crowd'); }, setupScoreboardFeed() {},
        startGame() { calls.push('start'); }, registerEvents() { calls.push('input'); }, scheduleOnce() {},
        enterModelDebug() { calls.push('debug'); manager._playerSwimmer.cartoonRig.raceReady = false; },
        paintError(error) { calls.push(error); manager._raceLoading.cancel(); },
    });
    const promise = manager.loadRace();
    const start = async () => {
        await h.frame(); assert.deepEqual([...assets.keys()], ['tuning', 'actions']);
        assets.get('actions')(null); await flush(); assert.equal(calls.includes('scene'), false);
        assets.get('tuning')(); await flush(); await h.frame();
    };
    return { ...h, calls, manager, promise, start };
}

test('真实进场流程：最后一名 AI 和嵌套资源就绪前不能隐藏 Loading 或开始展示', async () => {
    const s = raceFixture(); await s.start();
    const textureDone = s.trackRaceAsset(() => {});
    for (let i = 0; i < 4; i++) await s.frame();
    assert.equal(s.calls.includes('start'), false); assert.equal(s.calls.includes('hide'), false);
    s.manager._aiSwimmers[1].cartoonRig.raceReady = true;
    await s.frame(); assert.equal(s.calls.includes('start'), false);
    textureDone(); await s.frame(); assert.equal(s.calls.includes('start'), true);
    assert.equal(s.calls.includes('hide'), false);
    for (let i = 0; i < 4; i++) await s.frame(); await s.promise;
    assert.equal(s.calls.filter(c => c === 'hide').length, 1);
    assert.equal(s.calls.filter(c => c === 'start').length, 1);
    assert.equal(s.manager._raceSceneReady, true); assert.equal(s.hooks.size, 0);
});

test('真实进场流程：模型失败走错误出口，不放行场景；加载时维持网络帧', async () => {
    const s = raceFixture(); await s.start();
    let ticks = 0;
    s.manager._netRaceController = { tick: dt => { ticks++; assert.equal(dt, .016); } };
    s.manager.update(.016); assert.equal(ticks, 1);
    s.manager._aiSwimmers[1].cartoonRig.raceLoadError = new Error('动作缺失');
    await s.frame(); await s.promise;
    assert.equal(s.calls.includes('hide'), false); assert.equal(s.calls.includes('start'), false);
    assert.ok(s.calls.some(c => c?.message === '动作缺失')); assert.equal(s.hooks.size, 0);
});

test('真实进场流程：场景销毁取消后，迟到资源不开始展示也不关闭其他页面遮罩', async () => {
    const s = raceFixture(); await s.start();
    s.manager.node.isValid = false; s.manager._raceLoading.cancel(); await s.promise;
    s.manager._aiSwimmers[1].cartoonRig.raceReady = true; await s.frame();
    assert.equal(s.calls.includes('hide'), false); assert.equal(s.calls.includes('start'), false);
    assert.equal(s.hooks.size, 0);
});

test('模型调试隐藏原玩家后不再等待该节点的渲染回调，不生成比赛 AI', async () => {
    const s = raceFixture('model-debug'); await s.start();
    for (let i = 0; i < 6; i++) await s.frame(); await s.promise;
    assert.equal(s.calls.includes('ai'), false); assert.equal(s.calls.includes('start'), false);
    assert.equal(s.calls.filter(c => c === 'debug').length, 1);
    assert.equal(s.calls.filter(c => c === 'hide').length, 1);
    assert.equal(s.hooks.size, 0);
});

test('角色就绪必须包含模型、专属动作、换色资源与两帧渲染等待', () => {
    const variant = { id: 'a', dynamicColor: { mode: 'mask' } };
    const Subject = methods('assets/scripts/entity/CartoonSwimmerRig.ts', 'CartoonSwimmerRig', ['raceReady', 'raceLoadError', 'lateUpdate', 'setModelVariant'], {
        findSwimmerModelVariant: () => variant,
    });
    const rig = new Subject();
    Object.assign(rig, { node: { isValid: true }, _model: { isValid: true }, _loaded: true,
        _actionsReady: true, _dynamicColorEffect: {}, _colorMask: {}, _rendererRevealFramesRemaining: 2,
        setSkinnedRenderersEnabled() {}, _modelVariantId: 'a', _modelLoading: true });
    assert.equal(rig.raceReady, false); rig.lateUpdate(); assert.equal(rig.raceReady, false);
    rig.lateUpdate(); assert.equal(rig.raceReady, true);
    rig._actionsReady = false; assert.equal(rig.raceReady, false); rig._actionsReady = true;
    rig._colorMask = null; assert.equal(rig.raceReady, false); rig._colorMask = {};
    rig._colorLoadError = new Error('换色失败'); assert.equal(rig.raceReady, false); rig._colorLoadError = null;
    rig._loaded = false; rig._model = null;
    assert.equal(rig.setModelVariant('a'), true, '同一正在加载的模型不得重复发起或清理');
});

test('真实模型回调拒绝过期请求，并把下载与实例化失败交给比赛就绪检查', async () => {
    const h = harness(), scope = new h.RaceLoading(); const requests = [];
    const variant = { id: 'test', candidates: ['model'] };
    const Subject = methods('assets/scripts/entity/CartoonSwimmerRig.ts', 'CartoonSwimmerRig', ['loadModelForCurrentVariant', 'raceLoadError'], {
        findSwimmerModelVariant: () => variant, defaultSwimmerModelVariant: () => variant,
        loadSwimmerPrefab: done => requests.push(done), initializeRaceModel: h.initializeRaceModel,
        instantiate: () => { throw new Error('无法实例化'); }, console: { error() {} },
    });
    const rig = new Subject(); Object.assign(rig, { node: { isValid: true }, _modelLoadToken: 0, _colorLoadError: null });
    rig.loadModelForCurrentVariant(); requests.shift()(new Error('下载失败'));
    assert.match(rig.raceLoadError.message, /下载失败/); assert.equal(rig._modelLoading, false);
    rig.loadModelForCurrentVariant(); const old = requests.shift();
    rig.loadModelForCurrentVariant(); old(new Error('旧请求失败'));
    assert.equal(rig.raceLoadError, null);
    requests.shift()(null, { prefab: {} }); assert.equal(rig.raceLoadError, null);
    await h.frame(); assert.match(rig.raceLoadError.message, /无法实例化/);
    assert.equal(rig._modelLoading, false); scope.cancel();
});

test('资源回调抛异常会中断加载而不是静默放行', async () => {
    const h = harness(), scope = new h.RaceLoading();
    const waiting = assert.rejects(scope.waitFor('资源', () => false), /材质配置异常/);
    h.trackRaceAsset(() => { throw new Error('材质配置异常'); })();
    await waiting; assert.equal(scope.assetsPending, 0); assert.equal(h.hooks.size, 0);
});

test('提前到达的联机 GO 等本机准备后只执行一次；退出后不执行', () => {
    const timers = new Map(); let id = 0;
    const Subject = methods('assets/scripts/net/NetRaceController.ts', 'NetRaceController',
        ['reportRaceReady', 'triggerCountdownFromGo', 'maybeStartCountdown', 'broadcastGo'], {
            setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
        });
    const client = new Subject(); let starts = 0;
    Object.assign(client, { _session: { localPos: 1 }, _net: { broadcast() {} },
        _countdownStartListener: () => starts++, isHost: false });
    client.triggerCountdownFromGo(); client.triggerCountdownFromGo(); assert.equal(starts, 0);
    client.reportRaceReady(); assert.equal(starts, 1); assert.equal(timers.size, 0);
    client.reportRaceReady(); client.triggerCountdownFromGo(); assert.equal(starts, 1);
    const closed = new Subject(); closed._disposed = true;
    closed._countdownStartListener = () => starts++;
    closed.triggerCountdownFromGo(); closed.reportRaceReady(); assert.equal(starts, 1);
});

test('房主收到其他成员准备时，本机仍在加载就不能广播 GO；准备后保留原超时兜底', () => {
    const callbacks = []; let starts = 0, broadcasts = 0;
    const Subject = methods('assets/scripts/net/NetRaceController.ts', 'NetRaceController',
        ['reportRaceReady', 'maybeStartCountdown', 'broadcastGo'], {
            setTimeout(fn) { callbacks.push(fn); return 1; }, clearTimeout() {},
        });
    const host = new Subject(); Object.assign(host, { isHost: true,
        _session: { localPos: 0, members: [{ pos: 0 }, { pos: 1 }] }, _readyPoses: new Set([1]),
        _net: { broadcast: () => broadcasts++ }, _countdownStartListener: () => starts++,
    });
    host.maybeStartCountdown(); host.broadcastGo(); assert.equal(starts, 0);
    host.reportRaceReady(); assert.equal(starts, 1); assert.equal(broadcasts, 1);
    callbacks[0](); assert.equal(starts, 1);
});
