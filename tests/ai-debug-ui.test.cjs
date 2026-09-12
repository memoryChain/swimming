const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

function fixture() {
    class Label { string = ''; static HorizontalAlign = { LEFT: 0, RIGHT: 1 }; }
    class UITransform { contentSize = { width: 0, height: 0 }; setContentSize(w, h) { this.width = w; this.height = h; this.contentSize = { width: w, height: h }; } }
    class BlockInputEvents {}
    class Graphics { clear() {} rect() {} fill() {} }
    class Node {
        static EventType = { TOUCH_END: 'end', NODE_DESTROYED: 'destroyed' };
        children = []; components = new Map(); events = new Map(); active = true;
        x = 0; y = 0; layer = 0; scale = { x: 1, y: 1, z: 1 };
        constructor(name) { this.name = name; }
        get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
        addComponent(C) { const c = new C(); c.node = this; this.components.set(C, c); return c; }
        getComponent(C) { return this.components.get(C); }
        getChildByName(name) { return this.children.find(c => c.name === name); }
        setPosition(x, y) { this.x = x; this.y = y; }
        setScale(x, y, z) { this.scale = { x, y, z }; }
        on(event, callback) { assert.equal(this.events.has(event), false); this.events.set(event, callback); }
        once(event, callback) { this.on(event, callback); }
        click() { this.events.get('end')?.(); }
        destroy() { this.events.get('destroyed')?.(); if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    }
    const makeUiNode = (name, parent) => { const n = new Node(name); n.addComponent(UITransform); n.layer = parent?.layer ?? 0; n.parent = parent; parent?.children.push(n); return n; };
    const makeLabel = (name, parent, text, size = 18) => { const n = makeUiNode(name, parent); n.addComponent(Label).string = text; n.getComponent(UITransform).setContentSize(620, size + 14); return n; };
    const makeRect = (name, parent, w, height) => { const n = makeUiNode(name, parent); n.addComponent(Graphics); n.getComponent(UITransform).setContentSize(w, height); return n; };
    const makeButton = (name, parent, w, height, color, text) => { const n = makeRect(name, parent); n.getComponent(UITransform).setContentSize(w, height); makeLabel('Label', n, text); return n; };
    const h = createHarness({ './RuntimeUiFactory': { makeUiNode, makeLabel, makeRect, makeButton, uiColor: (...values) => values },
        './ProjectUiFonts': { styleProjectUiLabel() {} } });
    const listeners = new Map();
    const view = { size: { width: 1280, height: 720 }, getVisibleSize() { return this.size; },
        on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
        off(event, fn) { listeners.get(event)?.delete(fn); } };
    Object.assign(h.cc, { Label, UITransform, Graphics, Node, BlockInputEvents, view,
        sys: { getSafeAreaRect: () => view.safe ?? { x: 0, y: 0, ...view.size } } });
    const load = name => h.load(path.join(h.root, 'assets/scripts', name + '.ts'));
    return { Node, Label, load, view, listeners, BlockInputEvents, UITransform, root: h.root };
}

test('测试入口反复切换角色等级赛程不增加节点或监听，启动只提交一次', () => {
    const { Node, Label, load } = fixture();
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const root = new Node('root'); let starts = 0;
    buildAiDebugSetupPicker(root, () => starts++, () => {});
    const count = root.children.length;
    for (let i = 0; i < 100; i++) {
        for (const name of ['Character', 'LevelUp', 'OpponentCount', 'Roster', 'Mode', 'Seed']) root.getChildByName(name).click();
        assert.equal(root.children.length, count);
    }
    assert.equal(root.getChildByName('Level').getComponent(Label).string, '等级 30');
    root.getChildByName('Tier4').click(); root.getChildByName('Tier4').click();
    assert.equal(starts, 1); assert.equal(getAiDebugSetup().level, 30);
    for (const child of root.children) if (child.events.has('end')) {
        assert.ok(Math.abs(child.y) <= 266);
        assert.ok(Math.abs(child.x) <= 335);
    }
});

test('真实登录入口保持弹窗专用层，面板居中适配，遮挡覆盖屏幕，关闭清理窗口监听', () => {
    const h = fixture(), { Node, load, view, listeners, UITransform, BlockInputEvents } = h;
    const tsPath = process.env.TYPESCRIPT_PATH || process.env.PATH.split(path.delimiter)
        .map(p => path.resolve(p, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p));
    const ts = require(tsPath);
    const file = path.join(h.root, 'assets/scripts/app/LoginManager.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'LoginManager');
    const method = cls.members.find(n => n.name?.getText(source) === 'showAiDebugPicker');
    const { mountAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const popup = new Node('Popup'); popup.layer = 1 << 14;
    const Login = vm.runInNewContext(ts.transpileModule(`class Login { ${method.getText(source)} }; Login`,
        { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText,
        { getUILayer: () => popup, UILayer: { Popup: 3 }, mountAiDebugSetupPicker });
    const owner = new Login(); owner._canvasNode = new Node('主画布'); owner._canvasNode.setPosition(640, 360);
    owner.startAiDebug = () => {}; owner.grantDebugCoins = () => {};
    const descendants = node => [node, ...node.children.flatMap(descendants)];
    for (let repeat = 0; repeat < 3; repeat++) {
        owner.showAiDebugPicker(); owner.showAiDebugPicker();
        assert.equal(popup.children.length, 1);
        const overlay = popup.children[0], panel = overlay.getChildByName('Panel'), dim = overlay.getChildByName('Dim');
        assert.ok(overlay.getComponent(BlockInputEvents));
        for (const node of descendants(overlay)) assert.equal(node.layer, popup.layer, node.name);
        for (const [width, height] of [[1280, 720], [1600, 720], [960, 540], [720, 1280]]) {
            view.size = { width, height };
            for (const fn of listeners.get('canvas-resize')) fn();
            assert.equal(overlay.x, 0); assert.equal(overlay.y, 0);
            assert.equal(panel.x, 0); assert.equal(panel.y, 0);
            assert.equal(dim.scale.x, width); assert.equal(dim.scale.y, height);
            assert.equal(overlay.getComponent(UITransform).contentSize.width, width);
            assert.ok(880 * panel.scale.x <= width - 48 + 1e-6);
            assert.ok(620 * panel.scale.y <= height - 48 + 1e-6);
            for (const child of panel.children) {
                const size = child.getComponent(UITransform).contentSize;
                assert.ok(Math.abs(child.x) + size.width / 2 <= 440, child.name);
                assert.ok(Math.abs(child.y) + size.height / 2 <= 310, child.name);
            }
        }
        panel.getChildByName('Cancel').click();
        assert.equal(popup.children.length, 0);
        for (const set of listeners.values()) assert.equal(set.size, 0);
    }
});

test('对手人数、混合阵容和单角色设置提交到启动配置，切换不会立即启动', () => {
    const { Node, load } = fixture();
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const root = new Node('Panel'); let starts = 0;
    buildAiDebugSetupPicker(root, () => starts++, () => {});
    assert.equal(getAiDebugSetup().opponentCount, 7);
    root.getChildByName('OpponentCount').click();
    root.getChildByName('Roster').click();
    assert.equal(starts, 0);
    root.getChildByName('Tier4').click();
    assert.equal(getAiDebugSetup().opponentCount, 1);
    const second = new Node('Panel'); buildAiDebugSetupPicker(second, () => starts++, () => {});
    second.getChildByName('OpponentCount').click(); second.getChildByName('Roster').click();
    second.getChildByName('Tier3').click();
    assert.equal(getAiDebugSetup().opponentCount, 7);
    assert.equal(getAiDebugSetup().mixedCharacters, false);
    assert.equal(starts, 2);
});

test('AI诊断隐藏时不读取或格式化，显示后5Hz且相同文本不重写，重复阵容不重建', () => {
    const { Node, Label, load } = fixture();
    const { AiDifficultyPanel } = load('ui/AiDifficultyPanel');
    const p = new AiDifficultyPanel(), root = new Node('root'); p.build(root, 1290, 720);
    assert.ok(p._root.y + p._content.getChildByName('Title').y + 14 <= 360, '标题不得超出画布顶部');
    const entries = [{ lane: 1, name: '蛙妹 Lv.1', difficulty: 1 }]; p.populate(entries);
    const firstRow = p._rowsHost.children[0]; p.populate(entries); assert.equal(p._rowsHost.children[0], firstRow);
    let reads = 0;
    p.setDebugController({ debugSnapshot() { reads++; return { action: 'swim', energy: 100, heartRate: 120, desiredEnergy: 80, sprintReserve: 20, kickSeconds: 0, jumps: 0 }; } });
    for (let i = 0; i < 300; i++) p.update(1 / 60);
    assert.equal(reads, 0);
    p.setVisible(true); p.setCollapsed(false); for (let i = 0; i < 60; i++) p.update(1 / 60);
    assert.ok(reads >= 4 && reads <= 6);
    const value = p._debugLabel.string;
    Object.defineProperty(p._debugLabel, 'string', { get: () => value, set: () => assert.fail('相同文字不得重复写入') });
    for (let i = 0; i < 60; i++) p.update(1 / 60);
    p.setVisible(false); const before = reads;
    for (let i = 0; i < 60; i++) p.update(1 / 60); assert.equal(reads, before);
});

test('AI信息单对手与七对手均避开HUD数值、进度及手掌区，适配安全区且关闭移除监听', () => {
    const { Node, load, view, listeners, UITransform } = fixture();
    const { AiDifficultyPanel } = load('ui/AiDifficultyPanel');
    const p = new AiDifficultyPanel(); p.build(new Node('root'), 1280, 720);
    p.setDebugController({ debugSnapshot() {} });
    for (const rows of [1, 7]) {
        p.populate(Array.from({ length: rows }, (_, i) => ({ lane: i, name: '蛙妹 Lv.30', difficulty: 1 })));
        for (const [w, h, inset] of [[1280, 720, 0], [1600, 720, 70], [960, 540, 30]]) {
            view.size = { width: w, height: h };
            view.safe = { x: inset, y: 0, width: w - inset * 2, height: h };
            for (const fn of listeners.get('canvas-resize')) fn();
            const back = p._content.getChildByName('Back'), size = back.getComponent(UITransform).contentSize;
            const scale = p._root.scale.x;
            const left = p._root.x + w / 2 - size.width * scale / 2;
            const top = h / 2 - p._root.y;
            assert.ok(left >= inset + 230 * scale, '避开左侧速度心率体力');
            assert.ok(top >= 80 * scale, '避开顶部赛程进度');
            assert.ok(top + size.height * scale < 390 * scale, '满员信息也不得压住手掌完美区');
            assert.ok(left + size.width * scale < w - inset - 250 * scale, '避开右侧排名及按钮');
            const decision = p._debugLabel.node;
            assert.ok(-decision.y + 28 <= size.height, '诊断文字在底板内');
        }
    }
    p._root.destroy();
    for (const set of listeners.values()) assert.equal(set.size, 0);
});

test('AI面板默认收起，折叠零采样，展开立即显示当前对手且反复操作不重建', () => {
    const { Node, load, BlockInputEvents } = fixture();
    const { AiDifficultyPanel } = load('ui/AiDifficultyPanel');
    const p = new AiDifficultyPanel(); p.build(new Node('root'), 1280, 720);
    p.populate(Array.from({ length: 7 }, (_, lane) => ({ lane, name: '蛙妹', difficulty: 1 })));
    let reads = 0;
    const controller = budget => ({ debugSnapshot() { reads++; return { action: 'swim', desiredEnergy: budget, sprintReserve: 20, kickSeconds: 0, jumps: 0 }; } });
    p.setDebugController(controller(80)); p.setVisible(true);
    const expand = p._root.getChildByName('Expand'), collapse = p._content.getChildByName('Collapse');
    const nodes = n => [n, ...n.children.flatMap(nodes)];
    const initial = nodes(p._root), listeners = initial.map(n => n.events.size);
    assert.equal(expand.activeInHierarchy, true); assert.equal(p._content.activeInHierarchy, false);
    assert.ok(expand.getComponent(BlockInputEvents)); assert.ok(collapse.getComponent(BlockInputEvents));
    for (let repeat = 0; repeat < 30; repeat++) {
        const before = reads;
        p.setDebugController(controller(80 + repeat));
        for (let frame = 0; frame < 120; frame++) p.update(1 / 60);
        assert.equal(reads, before);
        expand.click(); assert.equal(reads, before + 1);
        assert.equal(expand.activeInHierarchy, false); assert.equal(p._content.activeInHierarchy, true);
        assert.ok(p._debugLabel.string.includes(`预算 ${80 + repeat}`));
        p.setCollapsed(false); assert.equal(reads, before + 1, '相同状态不刷新');
        collapse.click(); assert.equal(p._content.activeInHierarchy, false);
        assert.deepEqual(nodes(p._root), initial); assert.deepEqual(initial.map(n => n.events.size), listeners);
    }
    p.setVisible(false); assert.equal(expand.activeInHierarchy, false);
    p.setVisible(true); assert.equal(expand.activeInHierarchy, true);
});
