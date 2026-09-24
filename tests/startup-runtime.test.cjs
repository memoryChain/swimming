const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const directory of process.env.PATH.split(path.delimiter)) {
        const file = path.resolve(directory, '../typescript/lib/typescript.js');
        if (fs.existsSync(file)) return require(file);
    }
    throw new Error('需要 typescript@5.4.5');
}
const ts = compiler();
function loader(mocks = {}) {
    const cache = new Map();
    function load(relative) {
        const file = path.resolve(root, relative);
        if (cache.has(file)) return cache.get(file);
        const exports = {}; cache.set(file, exports);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        } }).outputText;
        new Function('require', 'exports', code)(id => mocks[id] ?? load(path.resolve(path.dirname(file), `${id}.ts`)), exports);
        return exports;
    }
    return load;
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('业务分包并发合并，失败可重试，已加载的分包不再请求', async () => {
    const requests = []; let cached = null;
    const load = loader({ cc: { assetManager: { getBundle: () => cached, loadBundle: (name, callback) => requests.push({ name, callback }) } } });
    const { loadGameplayCode } = load('assets/startup/DeferredCodeLoader.ts');
    const first = loadGameplayCode();
    assert.equal(loadGameplayCode(), first);
    assert.equal(requests.length, 1); assert.equal(requests[0].name, 'gameplay');
    requests.shift().callback(new Error('断网'));
    await assert.rejects(first, /断网/);
    const next = loadGameplayCode();
    cached = {}; requests.shift().callback(null, cached); await next;
    await loadGameplayCode(); assert.equal(requests.length, 0);
});

class Component { get isValid() { return this.node.isValid; } }
class Transform extends Component { setContentSize(width, height) { this.contentSize = { width, height }; } }
class Node extends EventEmitter {
    static EventType = { TOUCH_END: 'touch', NODE_DESTROYED: 'destroyed' };
    isValid = true; active = true; children = []; components = [];
    constructor(name) { super(); this.name = name; }
    setParent(parent) { this.parent = parent; parent.children.push(this); }
    addComponent(Type) { const component = new Type(); component.node = this; this.components.push(component); return component; }
    getComponent(Type) { return this.components.find(component => component instanceof Type); }
    getChildByName(name) { return this.children.find(node => node.name === name); }
    setPosition(x, y, z) { this.position = { x, y, z }; }
    setScale(x, y, z) { this.scale = { x, y, z }; }
    destroy() { this.isValid = false; this.emit('destroyed'); }
}
function baseCc() {
    class Label extends Component {
        static Overflow = { SHRINK: 1 }; static HorizontalAlign = { CENTER: 1 }; static VerticalAlign = { CENTER: 1 };
    }
    class Sprite extends Component { static SizeMode = { CUSTOM: 1 }; }
    class Button extends Component { static Transition = { SCALE: 1 }; }
    class Camera { static ClearFlag = { SOLID_COLOR: 1 }; }
    const view = new EventEmitter(); view.getVisibleSize = view.getDesignResolutionSize = () => ({ width: 1560, height: 720 });
    return { Component, Node, UITransform: Transform, Label, Sprite, Button, Camera, Canvas: class {},
        Color: class {}, Font: class {}, Texture2D: class {},
        SpriteFrame: class { destroy() { this.destroyed = true; } }, view,
        Layers: { Enum: { UI_2D: 1 }, BitMask: { UI_2D: 1 } }, _decorator: { ccclass: () => Type => Type },
    };
}
function managerHarness({ wechat = true, invite = null, screenFails = false } = {}) {
    const cc = baseCc(), calls = { loads: 0, music: 0, off: 0, screens: 0, modals: [] };
    const pending = []; let Runtime = null, onInvite;
    cc.js = { getClassByName: () => Runtime };
    cc.sys = { localStorage: { getItem: () => '{"musicVolume":0.25}' } };
    const load = loader({ cc, 'cc/env': { WECHAT: wechat },
        './MusicManager': { MusicManager: { playLogin: () => calls.music++, setVolume: value => calls.volume = value } },
        './DeferredCodeLoader': { loadGameplayCode: () => { calls.loads++; return new Promise((resolve, reject) => pending.push({ resolve, reject })); } },
        './StartupPlatform': { startupInvite: () => invite, observeStartupInvites: callback => { onInvite = callback; return () => calls.off++; }, showStartupRetry: callback => calls.modals.push(callback) },
        './StartupView': { StartupView: class {
            constructor(parent) { this.root = new Node('首屏'); this.root.setParent(parent); calls.screens++; }
            async build() { if (screenFails) throw new Error('首屏断网'); }
            setState(state) { this.state = state; }
        } },
    });
    const { StartupManager } = load('assets/startup/StartupManager.ts');
    const manager = new StartupManager(); manager.node = new Node('Canvas'); manager.node.addComponent(cc.Canvas);
    const handoff = () => load('assets/startup/StartupHandoff.ts').takeStartupHandoff(manager.node);
    return { manager, calls, pending, handoff, invite: room => onInvite(room), ready: () => Runtime = class extends Component {} };
}

test('微信登录只启动首屏和音乐，开游连点只加载一次，交接节点只消费一次', async () => {
    const h = managerHarness(); h.manager.onLoad(); await flush();
    assert.equal(h.calls.music, 1); assert.equal(h.calls.volume, 0.25); assert.equal(h.calls.loads, 0);
    const first = h.manager.enter(); void h.manager.enter();
    assert.equal(h.calls.loads, 1); assert.equal(h.manager.screen.state, 'loading');
    h.ready(); h.pending[0].resolve(); await first;
    assert.equal(h.manager.node.components.length, 2); assert.equal(h.calls.off, 1);
    assert.equal(h.handoff().root, h.manager.screen.root); assert.equal(h.handoff(), undefined);
    await h.manager.enter(); assert.equal(h.calls.loads, 1);
});

test('冷启动邀请触发业务加载，下载中的新邀请覆盖旧房号', async () => {
    const h = managerHarness({ invite: '旧房' }); h.manager.onLoad();
    assert.equal(h.calls.loads, 1); h.invite('新房'); assert.equal(h.calls.loads, 1);
    h.ready(); h.pending[0].resolve(); await flush();
    assert.equal(h.handoff().joinRoomId, '新房'); assert.equal(h.calls.off, 1);
});

test('业务下载失败保留首屏重试，成功后不重复创建组件或首屏', async () => {
    const h = managerHarness(); h.manager.onLoad(); await flush();
    const first = h.manager.enter(); h.pending[0].reject(new Error('断网')); await first;
    assert.equal(h.manager.screen.state, 'retry'); assert.equal(h.manager.attached, false);
    const next = h.manager.enter(); h.ready(); h.pending[1].resolve(); await next;
    assert.equal(h.calls.screens, 1); assert.equal(h.manager.attached, true);
});

test('图片和业务同时失败仍有原生重试入口，销毁后的回调不创建组件', async () => {
    const h = managerHarness({ screenFails: true }); h.manager.onLoad(); await flush();
    h.pending[0].reject(new Error('断网')); await flush();
    assert.equal(h.calls.modals.length, 1);
    h.calls.modals[0](); assert.equal(h.calls.loads, 2);
    h.manager.node.destroy(); h.manager.onDestroy(); h.ready(); h.pending[1].resolve(); await flush();
    assert.equal(h.manager.node.components.length, 1); assert.equal(h.calls.off, 1);
});

test('非微信仍走原登录调试入口，已注册的业务入口不重新下载', async () => {
    const h = managerHarness({ wechat: false }); h.manager.onLoad(); h.ready(); h.pending[0].resolve(); await flush();
    assert.equal(h.handoff(), undefined); assert.equal(h.calls.screens, 0);
    const cached = managerHarness(); cached.ready(); cached.manager.onLoad();
    assert.equal(cached.calls.loads, 0); assert.equal(cached.handoff(), undefined);
});

test('真实首屏只请求四张登录图和小字库，宽屏保持美术比例并清理监听', async () => {
    const cc = baseCc(), textures = [], bundles = [];
    cc.resources = { load: (name, Type, callback) => { textures.push(name); callback(null, {}); } };
    cc.assetManager = { loadBundle: (name, callback) => { bundles.push(name); callback(null, { load: (font, Type, done) => done(null, {}) }); } };
    const load = loader({ cc });
    const { StartupView } = load('assets/startup/StartupView.ts');
    const parent = new Node('Canvas'); let clicks = 0;
    const screen = new StartupView(parent, () => clicks++);
    screen.setState('retry'); await screen.build();
    assert.equal(textures.length, 4); assert.deepEqual(bundles, ['startup-ui']);
    assert.ok(textures.every(name => name.startsWith('ui/paddle-master-login-v8/')));
    const primary = screen.root.getChildByName('StartButton');
    primary.emit('touch'); assert.equal(clicks, 1);
    assert.equal(primary.getChildByName('Label').getComponent(cc.Label).string, '点击重试');
    assert.equal(primary.scale.x, 1); assert.equal(screen.root.getChildByName('Background').scale.x, 1560 / 1280);
    assert.equal(screen.root.getChildByName('RaceHUD'), undefined);
    const frames = [...screen.frames]; screen.root.destroy();
    assert.equal(cc.view.listenerCount('canvas-resize'), 0); assert.ok(frames.every(frame => frame.destroyed));
});

test('首屏资源迟到时不能向销毁的场景添加节点', async () => {
    const cc = baseCc(), callbacks = [];
    cc.resources = { load: (name, Type, callback) => callbacks.push(callback) };
    cc.assetManager = { loadBundle: (name, callback) => callback(null, { load: (font, Type, done) => callbacks.push(done) }) };
    const { StartupView } = loader({ cc })('assets/startup/StartupView.ts');
    const screen = new StartupView(new Node('Canvas'), () => {}), pending = screen.build();
    screen.root.destroy(); callbacks.forEach(callback => callback(null, {})); await pending;
    assert.equal(screen.root.children.length, 0); assert.equal(cc.view.listenerCount('canvas-resize'), 0);
});

test('首屏静态依赖不能越过业务分包边界，场景引用仍解析到启动组件', () => {
    const load = loader({ cc: {} });
    const seen = new Set();
    function visit(file) {
        if (seen.has(file)) return; seen.add(file);
        assert.ok(file.startsWith(path.join(root, 'assets/startup/')), file);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
        for (const match of code.matchAll(/require\("(\.[^"]+)"\)/g)) visit(path.resolve(path.dirname(file), `${match[1]}.ts`));
    }
    visit(path.join(root, 'assets/startup/StartupManager.ts'));
    assert.equal(load('assets/scripts/app/MusicManager.ts').MusicManager, load('assets/startup/MusicManager.ts').MusicManager);
    const meta = require('../extensions/wechat-race-subpackage/startup-code-policy').assertStartupSceneEntry(root);
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(root, 'assets/scripts/app/LoginManager.ts.meta'))).uuid, meta.uuid);
});

test('真实登录初始化消费首屏交接，邀请优先最新房号，重赛仍沿用原会话', async () => {
    const filename = path.join(root, 'assets/scripts/app/LoginManager.ts');
    const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(item => ts.isClassDeclaration(item) && item.name.text === 'LoginManager');
    const method = cls.members.find(item => item.name?.getText(ast) === 'onLoad').getText(ast);
    const code = ts.transpileModule(`return class { ${method} };`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    for (const scenario of [
        { startup: { root: new Node('首屏'), joinRoomId: null }, destination: '大厅' },
        { startup: { root: null, joinRoomId: '最新房' }, cold: '旧房', destination: '房间', room: '最新房' },
        { returningRoom: true, cold: '过期邀请', destination: '登录' },
        { returningLobby: true, cold: '过期邀请', destination: '登录' },
        { cold: '邀请房', destination: '登录' },
    ]) {
        let destination, openedRoom, reconnect, headbars = 0;
        const globals = {
            takeStartupHandoff: () => scenario.startup, Layers: { Enum: { UI_2D: 1 } },
            view: { getDesignResolutionSize: () => ({ width: 1280, height: 720 }) },
            SettingsManager: { apply() {} }, MusicManager: { playLogin() {} },
            consumeReturnToRoom: () => !!scenario.returningRoom, consumeReturnToLobby: () => !!scenario.returningLobby,
            platform: () => ({ getLaunchQuery: () => ({ room: scenario.cold }), onAppShow: () => () => {} }),
            ensureLogin: () => Promise.resolve(), PlayerData: { load: () => Promise.resolve() },
            getProgressionManager: () => ({ migrateLegacySave() {} }), getUILayer: node => node, UILayer: { Hud: 1 },
            ResourceHeadBar: class { build() { headbars++; } },
        };
        const Runtime = new Function(...Object.keys(globals), code)(...Object.values(globals));
        const manager = new Runtime(); manager.node = new Node('Canvas');
        Object.assign(manager, {
            findCanvasNode: () => manager.node, setupUiCamera() {},
            openPrepareRace: () => { destination = '大厅'; },
            openRoom: (room, reuse) => { destination = '房间'; openedRoom = room; reconnect = reuse; },
            buildLoginScreen: () => { destination = '登录'; },
        });
        manager.onLoad(); await flush();
        assert.equal(destination, scenario.destination); assert.equal(headbars, 1);
        if (scenario.room) { assert.equal(openedRoom, scenario.room); assert.equal(reconnect, false); }
        if (scenario.returningRoom) { assert.equal(manager._pendingOpenRoom, true); assert.equal(manager._pendingReconnect, true); assert.equal(manager._pendingJoinRoomId, undefined); }
        if (scenario.returningLobby) { assert.equal(manager._pendingOpenLobby, true); assert.equal(manager._pendingOpenRoom, false); }
        if (!scenario.startup && scenario.cold && !scenario.returningRoom && !scenario.returningLobby) assert.equal(manager._pendingJoinRoomId, scenario.cold);
    }
});
