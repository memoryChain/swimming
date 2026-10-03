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

function loginHarness({ deferResources = false } = {}) {
    const h = barrierHarness(), requests = [], calls = [];
    let resolveProfile, resolveResources;
    const resources = new Promise(resolve => resolveResources = resolve);
    const profile = new Promise(resolve => resolveProfile = resolve);
    const PlayerData = { loaded: true, profile: { tutorialCompleted: true }, load: () => profile };
    class Cover {
        disposed = false; loading = false;
        updates = [];
        constructor(login, presentation) { this.login = login; this.presentation = presentation; }
        setLoading(message) { this.loading = true; this.message = message; this.updates.push(['loading', message]); }
        setProgress(value, message) { this.progress = value; this.message = message; this.updates.push(['download', value]); }
        setResourceProgress(completed, total) { this.completed = completed; this.total = total; this.updates.push(['resources', completed, total]); }
        setRetry(callback) { this.retry = callback; this.loading = false; }
        dispose() { this.disposed = true; }
    }
    const Login = methods('assets/scripts/app/LoginManager.ts', ['openPrepareRace', 'prepareLobby', 'cancelLobbyLoading'], {
        UiAssetBarrier: h.UiAssetBarrier, StartupLoadingCover: Cover, PlayerData,
        gameAnalytics: () => ({ reportLobbyReady() { calls.push('analytics-ready'); } }),
        STARTUP_COPY: { loadingProfile: '存档', loadingBundle: '分包', downloadingBundle: '下载', loadingUi: '界面', preparingView: '画面' },
        loadRaceBundle(done, progress) { h.downloadProgress = progress; if (deferResources) resources.then(() => done(null)); else done(null); },
        prepareProjectUiFonts() { requests.push(h.trackUiCallback(() => {}, error => error)); }, console: { warn() {} },
    });
    const manager = new Login();
    Object.assign(manager, { _identityLoadGate:{cancel(){}}, _destroyed: false, _lobbyLoading: null, _lobbyCover: null, _prepareRaceFlow: null,
        _canvasNode: { isValid: true }, _loginUiRoot: { isValid: true, active: true },
        buildHeadBar() { calls.push('head'); this._headBar = { dispose() { calls.push('dispose-head'); } }; },
        buildPrepareRace() {
            calls.push('lobby');
            this._prepareRaceFlow = { presentationReady: false, presentationError: null,
                dispose() { calls.push('dispose-lobby'); }, playReadyEntrance() { calls.push('enter'); } };
            requests.push(h.trackUiCallback(() => {}, error => error));
        },
    });
    return { ...h, manager, calls, requests, resolveProfile, resolveResources, PlayerData, downloadProgress: value => h.downloadProgress(value) };
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
    assert.equal(m._lobbyLoading, null); assert.deepEqual(h.calls, ['head', 'lobby', 'enter', 'analytics-ready']);
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

test('比赛返回无登录节点时仍等待完整大厅，失败重试不会恢复登录画面', async () => {
    const h = loginHarness(), m = h.manager;
    m._loginUiRoot = null;
    m.openPrepareRace(); const cover = m._lobbyCover;
    assert.equal(cover.login, null); assert.equal(cover.loading, true); assert.equal(cover.presentation, 'transparent');
    h.resolveProfile(); await flush();
    h.requests[0](new Error('断网')); h.frame(); await flush();
    assert.equal(cover.disposed, false); assert.equal(typeof cover.retry, 'function');
    cover.retry(); await flush();
    h.requests.forEach(done => done()); h.frame(); h.frame(); await flush();
    assert.equal(cover.disposed, false, '角色尚未就绪时保持加载遮罩');
    m._prepareRaceFlow.presentationReady = true;
    h.frame(); h.frame(); await flush();
    assert.equal(cover.disposed, true); assert.equal(m._loginUiRoot, null);
    assert.equal(h.calls.filter(c => c === 'enter').length, 1);
    assert.equal(h.hooks.size, 0);
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
        assert.equal(h.calls.includes('analytics-ready'), false);
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


test('登录只等微信分包、当前页面和选中角色，后续界面不在登录期间预热', async () => {
    const h = loginHarness({ deferResources: true }), m = h.manager;
    m.openPrepareRace(); const cover = m._lobbyCover;
    h.resolveProfile(); await flush(); assert.deepEqual(h.calls, []);
    h.frame(); h.frame(); assert.equal(cover.disposed, false);
    h.resolveResources(); await flush(); assert.deepEqual(h.calls, ['head', 'lobby']);
    h.requests.forEach(done => done()); m._prepareRaceFlow.presentationReady = true;
    h.frame(); h.frame(); await flush();
    assert.equal(cover.message, '画面'); assert.equal(cover.disposed, true);
    const source = read('assets/scripts/app/LoginManager.ts');
    assert.doesNotMatch(source, /prepareLobbyResources|prepareForEntry|loadSampledActionsForRace/);
});

test('进度只来自下载事件和资源回调，空等不会自行前进，图片完成仍等待角色', async () => {
    const h = loginHarness({ deferResources: true }), m = h.manager;
    m.openPrepareRace(); const cover = m._lobbyCover;
    assert.equal(cover.message, '存档');
    h.resolveProfile(); await flush(); assert.equal(cover.message, '分包');
    h.downloadProgress(0.27); assert.equal(cover.progress, 0.27);
    h.frame(); h.frame(); assert.equal(cover.progress, 0.27);
    h.downloadProgress(0.73); assert.equal(cover.progress, 0.73);
    h.resolveResources(); await flush();
    assert.deepEqual(cover.updates.at(-1), ['resources', 0, 2]);
    h.frame(); const updates = cover.updates.length;
    h.frame(); h.frame(); assert.equal(cover.updates.length, updates);
    h.requests[0](); h.frame(); assert.deepEqual(cover.updates.at(-1), ['resources', 1, 2]);
    h.requests[1](); h.frame(); assert.equal(cover.message, '画面');
    h.frame(); await flush(); assert.equal(cover.disposed, false);
    m._prepareRaceFlow.presentationReady = true; h.frame(); h.frame(); await flush();
    assert.equal(cover.disposed, true); assert.equal(h.hooks.size, 0);
});

test('资源计数包含嵌套与缓存回调，同帧合并，重复回调及取消后不再报告', async () => {
    const h = barrierHarness(), scope = new h.UiAssetBarrier(), reports = [];
    let parent, child, other;
    scope.run(() => {
        parent = h.trackUiCallback(() => { child = h.trackUiCallback(() => {}); });
        other = h.trackUiCallback(() => {});
        h.trackUiCallback(() => {})();
    });
    const waiting = scope.waitFor(() => true, 60000, (done, total) => reports.push([done, total]));
    h.frame(); assert.deepEqual(reports, [[1, 3]]);
    parent(); parent(); other(); h.frame(); assert.deepEqual(reports.at(-1), [3, 4]);
    child(); h.frame(); h.frame(); await waiting;
    assert.deepEqual(reports, [[1, 3], [3, 4], [4, 4]]);
    child(); h.frame(); assert.equal(reports.length, 3); assert.equal(h.hooks.size, 0);
    const cancelled = new h.UiAssetBarrier(); let late;
    cancelled.run(() => { late = h.trackUiCallback(() => {}); });
    const rejected = assert.rejects(cancelled.waitFor(() => false, 60000, () => assert.fail('取消后不能更新')), /取消/);
    cancelled.cancel(); late(); h.frame(); await rejected;
});

test('分包下载被取消后，迟到进度与完成都不能修改旧遮罩或创建大厅', async () => {
    const h = loginHarness({ deferResources: true }), m = h.manager;
    m.openPrepareRace(); const cover = m._lobbyCover;
    h.resolveProfile(); await flush(); h.downloadProgress(0.25);
    m.cancelLobbyLoading(); const updates = cover.updates.length;
    h.downloadProgress(0.9); h.resolveResources(); await flush();
    assert.equal(cover.updates.length, updates); assert.deepEqual(h.calls, []);
    assert.equal(h.hooks.size, 0);
});

test('角色切换复用按需创建的实例，隐藏节点停用，反复选择不再构建模型', () => {
    let builds = 0, appearance = 0;
    class Rig {
        raceReady = true;
        setModelVariant() {} build() { builds++; } setSplashCulled() {} setWaterlineEffectEnabled() {}
        setCastShadow() {} setShowcaseStanding() {}
    }
    class Node {
        isValid = true; active = true; children = [];
        setParent(parent) { this.parent = parent; parent.children.push(this); }
        setScale() {} setPosition() {} setRotationFromEuler() {}
        addComponent() { return new Rig(); } destroy() { this.isValid = false; this.active = false; }
    }
    const Preview = methods('assets/scripts/app/PrepareRaceCharacterPreview.ts', ['refresh'], {
        findPlayerCharacter: id => ({ id, modelVariantId: id }), selectActionFromPool: () => 'happy',
        CHARACTER_SELECT_ACTIONS: ['happy'], CharacterAction: { ArmStretching: 'arm' },
        Node, Layers: { Enum: { DEFAULT: 1 } }, CartoonSwimmerRig: Rig, Color: class {},
        LOBBY_CHARACTER_SCALE: 1.58, PREVIEW_CHARACTER_SCALE: 1.3,
        selectedPlayerSkinTone: () => ({ color: [1, 2, 3] }), selectedPlayerColorScheme: () => ({ suit: [1, 2, 3], cap: [1, 2, 3] }),
    });
    const p = Object.assign(new Preview(), { node: new Node(), _preparedCharacters: new Map(), _selectedCharacterId: '',
        _centered: false, _lobbyPresentation: true, _shadowCaptureEnabled: false, applyAppearance() { appearance++; } });
    Object.defineProperty(p, 'presentationReady', { get: () => p._centered && !!p._rig?.raceReady });
    p.refresh('a'); p._centered = true; const a = p._pivotNode;
    p.refresh('b'); p._centered = true; const b = p._pivotNode;
    assert.equal(a.active, false); assert.equal(b.active, true); assert.equal(builds, 2);
    for (let i = 0; i < 20; i++) {
        p.refresh('a'); assert.equal(p._pivotNode, a); assert.equal(a.active, true); assert.equal(b.active, false);
        p.refresh('b'); assert.equal(p._pivotNode, b); assert.equal(a.active, false); assert.equal(b.active, true);
    }
    assert.equal(builds, 2); assert.equal(p.node.children.length, 2); assert.equal(p._preparedCharacters.size, 2);
    assert.ok(appearance >= 42);
});

test('预热后的图片、模型同步绑定；缓存失效或类型不匹配才走加载器', () => {
    class Asset { isValid = true; } class Texture2D extends Asset {} class Prefab extends Asset {} class JsonAsset extends Asset {}
    const texture = new Texture2D(), cache = new Map([['image', texture]]); let queued = 0, done = false;
    const bundle = { getInfoWithPath: () => ({ uuid: 'image' }), load() { queued++; } };
    const exports = {};
    new Function('require', 'exports', compile(read('assets/scripts/core/RaceBundleLoader.ts')))(id => id === 'cc'
        ? { Asset, Texture2D, Prefab, JsonAsset, assetManager: { getBundle: () => bundle, assets: cache } }
        : { RESOURCE_PATHS: { uiBundle: { name: 'ui', root: 'ui' } }, trackRaceAsset: cb => cb, trackUiCallback: cb => cb, decodeSampledMotion: value => value }, exports);
    exports.loadRaceAsset('image', Texture2D, (error, asset) => { assert.equal(error, null); assert.equal(asset, texture); done = true; });
    assert.equal(done, true); assert.equal(queued, 0);
    texture.isValid = false; exports.loadRaceAsset('image', Texture2D, () => {}); assert.equal(queued, 1);
    exports.loadRaceAsset('model', Prefab, () => {}); assert.equal(queued, 2);
    const prefab = new Prefab(); cache.set('image', prefab); let model;
    exports.loadRaceAsset('model', Prefab, (_error, asset) => model = asset);
    assert.equal(model, prefab); assert.equal(queued, 2);
});

test('进度条按整数百分比更新且只改变填充缩放，不逐帧重画', () => {
    let labels = 0, scales = 0, text = ''; const label = { node: { active: true } };
    Object.defineProperty(label, 'string', { get() { return text; }, set(value) { text = value; labels++; } });
    const Cover = methods('assets/startup/StartupLoadingCover.ts', ['setProgress', 'setResourceProgress', 'showProgress'], {
        STARTUP_COPY: { preparing: '资源准备中', loadingUi: '准备界面资源' },
    });
    const cover = Object.assign(new Cover(), { presentation: 'startup', disposed: false, progressPixels: -1, animation: null,
        spinner: { active: true }, progressRoot: { active: false }, progressFill: { setScale() { scales++; } }, label });
    cover.setProgress(0); cover.setProgress(0.009); cover.setProgress(0.011); cover.setProgress(1);
    assert.equal(labels, 3); assert.equal(scales, 3); assert.equal(cover.progressPixels, 360);
    assert.equal(text, '资源准备中 100%');
    assert.equal(cover.spinner.active, false); assert.equal(cover.progressRoot.active, true);
    cover.setProgress(NaN); cover.setResourceProgress(1, 0); assert.equal(labels, 3);
    cover.setResourceProgress(1, 10); cover.setResourceProgress(2, 20);
    assert.equal(text, '准备界面资源 2/20'); assert.equal(labels, 5); assert.equal(scales, 4);
    cover.setResourceProgress(2, 20); assert.equal(labels, 5);
    cover.setProgress(0.1, '下载资源包'); assert.equal(text, '下载资源包 10%');
    cover.disposed = true; cover.setResourceProgress(20, 20); assert.equal(labels, 6);
});

test('透明页面等待收到下载与资源进度仍保留转圈，失败重试后恢复转圈', () => {
    let starts = 0, stops = 0, scales = 0;
    const animation = { by() { return this; }, repeatForever() { return this; },
        start() { starts++; return this; }, stop() { stops++; } };
    const Cover = methods('assets/startup/StartupLoadingCover.ts',
        ['setLoading', 'setProgress', 'setResourceProgress', 'showProgress', 'setRetry'], {
            STARTUP_COPY: { loading: '加载中', preparing: '资源准备中', loadingUi: '准备界面资源', retry: '点击重试' },
            tween: () => animation,
        });
    const cover = Object.assign(new Cover(), { presentation: 'transparent', disposed: false, animation: null,
        spinner: { active: false }, progressRoot: { active: false },
        progressFill: { setScale() { scales++; } }, label: { node: { active: true }, string: '' } });
    cover.setLoading();
    for (const fraction of [0, 0.5, 1]) cover.setProgress(fraction);
    for (const [completed, total] of [[0, 10], [5, 10], [5, 20], [20, 20]]) cover.setResourceProgress(completed, total);
    assert.equal(cover.spinner.active, true); assert.equal(cover.progressRoot.active, false);
    assert.equal(cover.label.node.active, false); assert.equal(scales, 0);
    assert.equal(starts, 1); assert.equal(stops, 0);
    cover.setRetry(() => cover.setLoading());
    assert.equal(cover.spinner.active, false); assert.equal(cover.label.node.active, true);
    assert.equal(cover.label.string, '点击重试'); assert.equal(stops, 1);
    cover.retry(); cover.setResourceProgress(1, 2);
    assert.equal(cover.spinner.active, true); assert.equal(cover.progressRoot.active, false);
    assert.equal(cover.label.node.active, false); assert.equal(starts, 2); assert.equal(stops, 1);
});


test('首次邀请保留最新目标，初始化完成前不进房，完成后直达房间且不播放大厅入场', async () => {
    const h = loginHarness({ deferResources: true }), m = h.manager;
    const opened = []; m.openRoom = (room, reconnect) => opened.push([room, reconnect]);
    m._pendingOpenRoom = true; m._pendingJoinRoomId = 'first'; m._pendingReconnect = false;
    m.openPrepareRace(); const cover = m._lobbyCover;
    h.resolveProfile(); await flush(); assert.deepEqual(opened, []);
    m._pendingJoinRoomId = 'latest';
    h.resolveResources(); await flush(); h.requests.forEach(done => done()); assert.equal(m._prepareRaceFlow, null);
    h.frame(); h.frame(); await flush();
    assert.deepEqual(opened, [['latest', false]]); assert.equal(m._entryResourcesReady, true);
    assert.equal(m._pendingOpenRoom, false); assert.equal(cover.disposed, true); assert.ok(!h.calls.includes('enter'));
});

test('未初始化的新用户进房先排队登录，不建房、不隐藏登录页；加载中的新邀请替换目标', () => {
    const Login = methods('assets/scripts/app/LoginManager.ts', ['openRoom'], { PlayerData: { loaded: false } });
    let prepare = 0; const m = Object.assign(new Login(), { _entryResourcesReady: false, _roomFlow: null,
        openPrepareRace() { prepare++; }, _loginUiRoot: { isValid: true, active: true } });
    m.openRoom('first', false); assert.equal(m._pendingJoinRoomId, 'first'); assert.equal(m._pendingOpenRoom, true);
    m.openRoom('latest', false); assert.equal(m._pendingJoinRoomId, 'latest'); assert.equal(prepare, 2);
    assert.equal(m._roomFlow, null); assert.equal(m._loginUiRoot.active, true);
});

test('跨场景往返只保留一份大厅，比赛时停用全部根节点，返回无读档和加载遮罩', () => {
    const persistent = new Set(), events = [], popup = { isValid: true, active: true };
    const canvas = { isValid: true, active: true }, preview = { isValid: true, active: true };
    const session = {};
    new Function('require', 'exports', compile(read('assets/scripts/app/LobbySceneSession.ts')))(() => ({
        director: { addPersistRootNode: n => persistent.add(n), removePersistRootNode: n => persistent.delete(n) },
    }), session);
    let listeners = 1, room = false;
    const off = () => { listeners--; };
    const profile = { coins: 100 };
    const Login = methods('assets/scripts/app/LoginManager.ts', ['suspendForRace', 'resumeAfterRace'], {
        retainLobbyForRace: session.retainLobbyForRace,
        getUILayer: () => ({ parent: popup }), UILayer: { Popup: 3 },
        platform: () => ({ onAppShow() { listeners++; return off; } }),
        PlayerData: { profile, load() { throw Error('返回不得重新读档'); } },
        MusicManager: { playLogin() { events.push('music'); } },
        consumeReturnToRoom: () => room, consumeReturnToLobby: () => true,
    });
    const m = new Login(), flow = { previewRoot: preview,
        suspend() { preview.active = false; events.push('suspend'); },
        resume(afterRace) { assert.equal(afterRace, true); preview.active = true; events.push('resume'); },
    };
    Object.assign(m, { _canvasNode: canvas, _prepareRaceFlow: flow, _offAppShow: off,
        _headBar: { refresh: p => { assert.equal(p.coins, profile.coins); }, setBack() {}, setIdentityVisible() {} },
        openRoom(id, reconnect) { assert.equal(id, null); assert.equal(reconnect, true); events.push('room'); },
        openPrepareRace() { throw Error('已有大厅不得重新初始化'); },
    });
    for (let i = 0; i < 20; i++) {
        m._loadingRace = true; m.suspendForRace();
        assert.equal(listeners, 0); assert.equal(persistent.size, 3);
        for (const node of persistent) assert.equal(node.active, false);
        assert.throws(() => session.retainLobbyForRace([canvas], () => {}), /已暂存/);
        profile.coins++;
        assert.equal(session.resumeLobbyAfterRace(), true);
        assert.equal(session.resumeLobbyAfterRace(), false);
        assert.equal(persistent.size, 0); assert.equal(listeners, 1);
        assert.equal(m._loadingRace, false); assert.equal(m._prepareRaceFlow, flow);
        assert.equal(canvas.active, true); assert.equal(preview.active, true); assert.equal(popup.active, true);
    }
    room = true; m._roomFlow = { dispose() { events.push('dispose-room'); } };
    m.suspendForRace(); assert.equal(m._roomFlow, null);
    session.resumeLobbyAfterRace();
    assert.equal(events.at(-1), 'room'); assert.equal(preview.active, false);
    assert.equal(listeners, 1); assert.equal(persistent.size, 0);
});

test('进房导航等待换色和其他在途写入，复用已确认档案而非强制刷新', async () => {
    const Store = methods('assets/scripts/backend/PlayerData.ts', ['loadForNavigation'], {});
    let appearanceDone, saveDone, reads = 0, completed = false;
    const store = new Store(), profile = { coins: 10 };
    const appearance = new Promise(resolve => appearanceDone = resolve);
    store.flushCharacterAppearances = () => appearance;
    store._careerQueue = new Promise(resolve => saveDone = resolve);
    store.load = refresh => { assert.notEqual(refresh, true); reads++; return profile; };
    const pending = store.loadForNavigation().then(value => { completed = true; assert.equal(value.coins, 20); });
    await flush(); assert.equal(reads, 0);
    appearanceDone(); await flush(); assert.equal(reads, 0); assert.equal(completed, false);
    profile.coins = 20; saveDone(); await pending; assert.equal(reads, 1);
});

test('暂停大厅会停止页面动效、隐藏预览；从角色页恢复只复用已有大厅页', () => {
    const calls = [], active = (n, v) => { if (n) n.active = v; };
    const Flow = methods('assets/scripts/ui/PrepareRaceFlow.ts', ['suspend', 'resume', 'activateContent'], {
        setNodeActive: active, setButtonInteractable: (b, v) => b.interactable = v,
        getPlayerCharacterSelection: () => ({ characterId: 'same' }),
        makeUiNode() { throw Error('不能重建缓存页面'); },
    });
    const motion = () => ({ suspend: () => calls.push('stop'), showImmediately: () => calls.push('show') });
    const ready = { content: { isValid: true, active: false }, motion: motion(), rotateArea: null };
    const characters = { content: { isValid: true, active: true }, motion: motion(), rotateArea: null };
    const f = Object.assign(new Flow(), { _root: { isValid: true, active: true }, _previewRoot: { active: true },
        _characterLoadGate:{cancel(){}}, _view: 'characters', _content: characters.content, _motion: characters.motion,
        _pages: new Map([['ready', ready], ['characters', characters]]), _leaveDisabledButtons: [{ interactable: false }],
        _presentation: { detail: 1 }, _callbacks: {},
        _careerPanel: { setSuspended: v => calls.push(v), restoreNavigation: v => calls.push(['navigation', v]) },
        saveAppearanceChangesInBackground() {}, syncTutorial() {}, refreshReadyCharacterInfo() { calls.push('stats'); },
        presentCharacter(id) { assert.equal(id, 'same'); this._previewRoot.active = true; }, layoutPresentation() {},
    });
    f.suspend(); assert.equal(f._root.active, false); assert.equal(f._previewRoot.active, false);
    const count = calls.length; f.suspend(); assert.equal(calls.length, count);
    f.resume(true); assert.equal(f._root.active, true); assert.equal(f._previewRoot.active, true);
    assert.equal(f._content, ready.content); assert.equal(characters.content.active, false);
    assert.equal(f._pages.size, 2); assert.equal(f._leaving, false); assert.equal(f._presentation.detail, 0);
    assert.equal(calls.at(-1), 'show');
});

test('首次邀请直达房间只准备共用资源，不先构建隐藏大厅和角色预览', async () => {
    const h = loginHarness(), m = h.manager, opened = [];
    m._pendingOpenRoom = true; m._pendingJoinRoomId = 'invited'; m._pendingReconnect = false;
    m.openRoom = (id, reconnect) => opened.push([id, reconnect]);
    m.openPrepareRace(); const cover = m._lobbyCover;
    h.resolveProfile(); await flush(); assert.deepEqual(h.calls, ['head']);
    assert.equal(m._prepareRaceFlow, null); assert.equal(cover.disposed, false);
    h.requests.forEach(done => done()); h.frame(); h.frame(); await flush();
    assert.deepEqual(opened, [['invited', false]]); assert.equal(cover.disposed, true);
    assert.equal(m._entryResourcesReady, true); assert.equal(h.hooks.size, 0);
});
