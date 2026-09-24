const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const read = file => fs.readFileSync(file, 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function methods(file, names, globals) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(ts.isClassDeclaration);
    return new Function(...Object.keys(globals), compile(`return class { ${cls.members.filter(m => names.includes(m.name?.getText(source))).map(m => m.getText(source)).join('\n')} };`))(...Object.values(globals));
}
function barrierHarness() {
    const hooks = new Set();
    const exports = {};
    new Function('require', 'exports', compile(read('assets/scripts/ui/UiAssetBarrier.ts')))(() => ({
        Director: { EVENT_AFTER_DRAW: 'draw' }, director: { on(_event, fn) { hooks.add(fn); }, off(_event, fn) { hooks.delete(fn); } },
    }), exports);
    return { ...exports, hooks, frame() { for (const fn of [...hooks]) fn(); } };
}

test('大厅等待嵌套资源、角色与两个提交帧；稳定后移除监听', async () => {
    const h = barrierHarness(), scope = new h.UiAssetBarrier();
    let first, second, modelReady = false, done = false;
    scope.run(() => { first = h.trackUiCallback(() => { second = h.trackUiCallback(() => {}); }); });
    const waiting = scope.waitFor(() => modelReady).then(() => done = true);
    h.frame(); first(); h.frame(); second(); h.frame(); await flush(); assert.equal(done, false);
    modelReady = true; h.frame(); await flush(); assert.equal(done, false);
    h.frame(); await waiting; assert.equal(done, true); assert.equal(h.hooks.size, 0);
});

test('错误、超时和取消均结束等待；迟到回调不污染重试或无关资源', async () => {
    const h = barrierHarness(), scope = new h.UiAssetBarrier();
    let late, nested;
    scope.run(() => { late = h.trackUiCallback(() => { nested = h.trackUiCallback(() => {}); }); });
    const old = assert.rejects(scope.waitFor(() => false), /取消/);
    scope.cancel(); await old;
    const next = new h.UiAssetBarrier();
    next.run(() => late()); assert.equal(next.pending, 0); nested();
    let failure;
    next.run(() => { failure = h.trackUiCallback(() => {}, error => error); });
    const failed = assert.rejects(next.waitFor(() => true), /断网/);
    failure(new Error('断网')); h.frame(); await failed;
    const timeout = new h.UiAssetBarrier();
    await assert.rejects(timeout.waitFor(() => false, 5), /超时/);
    assert.equal(h.hooks.size, 0);
});

function loginHarness() {
    const h = barrierHarness(), requests = [], calls = [];
    let resolveProfile;
    const profile = new Promise(resolve => resolveProfile = resolve);
    const PlayerData = { loaded: true, load: () => profile };
    class Cover {
        disposed = false; loading = false;
        setLoading() { this.loading = true; }
        setRetry(callback) { this.retry = callback; this.loading = false; }
        dispose() { this.disposed = true; }
    }
    const Login = methods('assets/scripts/app/LoginManager.ts', ['openPrepareRace', 'prepareLobby', 'cancelLobbyLoading'], {
        UiAssetBarrier: h.UiAssetBarrier, StartupLoadingCover: Cover, PlayerData,
        prepareProjectUiFonts() { requests.push(h.trackUiCallback(() => {}, error => error)); }, console: { warn() {} },
    });
    const manager = new Login();
    Object.assign(manager, { _destroyed: false, _lobbyLoading: null, _lobbyCover: null, _prepareRaceFlow: null,
        _canvasNode: { isValid: true }, _loginUiRoot: { isValid: true, active: true },
        buildHeadBar() { calls.push('head'); this._headBar = { dispose() { calls.push('dispose-head'); } }; },
        buildPrepareRace() {
            calls.push('lobby');
            this._prepareRaceFlow = { presentationReady: false, presentationError: null,
                dispose() { calls.push('dispose-lobby'); }, playReadyEntrance() { calls.push('enter'); } };
            requests.push(h.trackUiCallback(() => {}, error => error));
        },
    });
    return { ...h, manager, calls, requests, resolveProfile, PlayerData };
}

test('真实登录交接保留首屏并防连点，存档、图片、角色全部完成后才揭开并播放入场', async () => {
    const h = loginHarness(), m = h.manager;
    m.openPrepareRace(); const cover = m._lobbyCover;
    m.openPrepareRace(); assert.deepEqual(h.calls, []); assert.equal(m._lobbyCover, cover);
    h.resolveProfile(); await flush(); assert.deepEqual(h.calls, ['head', 'lobby']);
    assert.equal(m._loginUiRoot.active, true); assert.equal(cover.disposed, false);
    h.requests.forEach(done => done()); h.frame(); h.frame(); await flush();
    assert.equal(cover.disposed, false, '图片完成不能代替角色就绪');
    m._prepareRaceFlow.presentationReady = true;
    h.frame(); h.frame(); await flush();
    assert.equal(m._loginUiRoot.active, false); assert.equal(cover.disposed, true);
    assert.equal(m._lobbyLoading, null); assert.deepEqual(h.calls, ['head', 'lobby', 'enter']);
});

test('大厅图片失败保留可重试的登录画面，重试重新构建且旧回调不提前揭开', async () => {
    const h = loginHarness(), m = h.manager;
    m.openPrepareRace(); h.resolveProfile(); await flush();
    const cover = m._lobbyCover, oldImage = h.requests[1];
    h.requests[0](new Error('断网')); h.frame(); await flush();
    assert.equal(m._prepareRaceFlow, null); assert.equal(m._loginUiRoot.active, true);
    assert.equal(cover.disposed, false); assert.equal(typeof cover.retry, 'function');
    cover.retry(); await flush(); oldImage(); h.frame(); h.frame(); await flush();
    assert.equal(m._loginUiRoot.active, true);
    h.requests.slice(2).forEach(done => done()); m._prepareRaceFlow.presentationReady = true;
    h.frame(); h.frame(); await flush(); assert.equal(cover.disposed, true);
    assert.equal(h.calls.filter(c => c === 'lobby').length, 2);
});

test('等待存档或模型时被邀请/销毁打断，迟到回调不创建大厅或关闭新页面', async () => {
    for (const mounted of [false, true]) {
        const h = loginHarness(), m = h.manager;
        m.openPrepareRace(); const cover = m._lobbyCover;
        if (mounted) { h.resolveProfile(); await flush(); }
        m.cancelLobbyLoading(); m._destroyed = true;
        h.resolveProfile(); h.requests.forEach(done => done()); await flush();
        assert.equal(m._lobbyLoading, null); assert.equal(cover.disposed, true);
        assert.equal(h.hooks.size, 0); assert.equal(h.calls.includes('enter'), false);
        if (!mounted) assert.deepEqual(h.calls, []);
    }
});

test('大厅专属骨架只读选中展示动作，动作失败不宣告就绪，比赛入口保留完整集合', () => {
    const requests = [], canonical = [];
    const Rig = methods('assets/scripts/entity/CartoonSwimmerRig.ts', ['loadShowcaseOnlyAction', 'loadSampledActionOverrides'], {
        JsonAsset: class {}, loadRaceAsset: (path, _type, done) => requests.push({ path, done }),
        loadSampledAction: (id, done) => canonical.push({ id, done }),
        SAMPLED_ACTION_IDS: ['happy', 'waving'], console: { log() {}, error() {} },
    });
    const setup = () => Object.assign(new Rig(), { node: { isValid: true }, _modelLoadToken: 1, _sampledActionOverrides: new Map(),
        _actionsReady: false, _sampledActionOverrideLoadToken: 0,
        _pose: { setBreaststrokeSamplesOverride() {}, setDivePrepPoseOverride() {} },
        _poseState: { reapplyCurrentState() {} }, refreshShowcaseAction: () => true });
    const variant = { id: 'test', sampledActionOverrideDir: 'actions/test', sampledActionOverrideFilePrefix: 'pose_' };
    const preview = setup(); preview._showcaseOnlyAction = 'happy'; preview.loadSampledActionOverrides(variant, 1);
    assert.deepEqual(requests.map(r => r.path), ['actions/test/pose_happy']);
    requests.shift().done(null, { json: { id: 'happy', samples: [{}] } });
    assert.equal(preview._actionsReady, true); assert.equal(preview._sampledActionOverrides.size, 1);
    const broken = setup(); broken.loadShowcaseOnlyAction(variant, 1, 'happy');
    requests.shift().done(new Error('动作失败')); assert.equal(broken._actionsReady, false); assert.match(broken._actionLoadError.message, /动作失败/);
    const race = setup(); race.loadSampledActionOverrides(variant, 1);
    assert.deepEqual(requests.map(r => r.path), ['actions/test/pose_happy', 'actions/test/pose_waving', 'actions/test/pose_breaststroke']);
    const common = setup(); common.loadShowcaseOnlyAction({ id: 'common' }, 1, 'waving');
    assert.equal(canonical[0].id, 'waving'); canonical[0].done(null); assert.equal(common._actionsReady, true);
});
