const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

function fixture() {
    class Label { string = ''; static HorizontalAlign = { LEFT: 0, RIGHT: 1 }; }
    class Button { static EventType = { CLICK: 'click' }; }
    class UITransform { contentSize = { width: 0, height: 0 }; setContentSize(w, h) { this.width = w; this.height = h; this.contentSize = { width: w, height: h }; } }
    class BlockInputEvents {}
    class Graphics { clear() {} rect() {} fill() {} }
    class Node {
        static EventType = { TOUCH_END: 'end', NODE_DESTROYED: 'destroyed' };
        children = []; components = new Map(); events = new Map(); active = true;
        x = 0; y = 0; layer = 0; isValid = true; scale = { x: 1, y: 1, z: 1 };
        constructor(name) { this.name = name; }
        get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
        addComponent(C) { const c = new C(); c.node = this; this.components.set(C, c); return c; }
        getComponent(C) { return this.components.get(C); }
        getChildByName(name) { return this.children.find(c => c.name === name); }
        setPosition(x, y) { this.x = x; this.y = y; }
        setScale(x, y, z) { this.scale = { x, y, z }; }
        on(event, callback) { assert.equal(this.events.has(event), false); this.events.set(event, callback); }
        once(event, callback) { this.on(event, callback); }
        click() { return (this.events.get('click') ?? this.events.get('end'))?.(); }
        destroy() {
            if (!this.isValid) return;
            for (const child of [...this.children]) child.destroy();
            this.events.get('destroyed')?.();
            this.isValid = false;
            if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        }
    }
    const makeUiNode = (name, parent) => { const n = new Node(name); n.addComponent(UITransform); n.layer = parent?.layer ?? 0; n.parent = parent; parent?.children.push(n); return n; };
    const makeLabel = (name, parent, text, size = 18) => { const n = makeUiNode(name, parent); n.addComponent(Label).string = text; n.getComponent(UITransform).setContentSize(620, size + 14); return n; };
    const makeRect = (name, parent, w, height) => { const n = makeUiNode(name, parent); n.addComponent(Graphics); n.getComponent(UITransform).setContentSize(w, height); return n; };
    const listeners = new Map();
    const view = { size: { width: 1280, height: 720 }, canvasSize: { width: 1280, height: 720 },
        getVisibleSize() { return this.size; }, getCanvasSize() { return this.canvasSize; },
        on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
        off(event, fn) { listeners.get(event)?.delete(fn); } };
    const makeButton = (name, parent, w, height, color, text) => { const n = makeRect(name, parent); n.addComponent(Button); n.getComponent(UITransform).setContentSize(w, height); makeLabel('Label', n, text); return n; };
    const fitFullScreenSolidCover = (node, authoredWidth = 1280, authoredHeight = 720) => {
        const apply = () => {
            const visible = view.getVisibleSize(), canvas = view.getCanvasSize();
            const aspectWidth = canvas.height > 0 ? visible.height * canvas.width / canvas.height : 0;
            const aspectHeight = canvas.width > 0 ? visible.width * canvas.height / canvas.width : 0;
            node.setScale(Math.max(authoredWidth, visible.width, aspectWidth) / authoredWidth * 1.5,
                Math.max(authoredHeight, visible.height, aspectHeight) / authoredHeight * 1.5, 1);
        };
        apply(); view.on('canvas-resize', apply); view.on('design-resolution-changed', apply);
        node.once(Node.EventType.NODE_DESTROYED, () => {
            view.off('canvas-resize', apply); view.off('design-resolution-changed', apply);
        });
    };
    const h = createHarness({ './RuntimeUiFactory': { makeUiNode, makeLabel, makeRect, makeButton,
        fitFullScreenSolidCover, UI_DESIGN_WIDTH: 1280, UI_DESIGN_HEIGHT: 720, uiColor: (...values) => values },
        './ProjectUiFonts': { styleProjectUiLabel() {} } });
    Object.assign(h.cc, { Button, Label, UITransform, Graphics, Node, BlockInputEvents, view,
        sys: { getSafeAreaRect: () => view.safe ?? { x: 0, y: 0, ...view.size } } });
    const load = name => h.load(path.join(h.root, 'assets/scripts', name + '.ts'));
    return { Node, Label, load, view, listeners, BlockInputEvents, UITransform, root: h.root };
}

const descendants = node => [node, ...node.children.flatMap(descendants)];
const findNode = (node, name) => descendants(node).find(child => child.name === name);
const emptyCurrencyDebug = () => ({
    read: () => ({ coins: 0, breakthroughGems: 0 }),
    adjust: async () => ({ coins: 0, breakthroughGems: 0 }),
});

test('测试入口反复切换角色等级赛程不增加节点或监听，启动只提交一次', () => {
    const { Node, Label, load } = fixture();
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const root = new Node('root'); let starts = 0;
    buildAiDebugSetupPicker(root, () => starts++, emptyCurrencyDebug());
    const initialNodes = descendants(root);
    const initialListeners = initialNodes.map(node => node.events.size);
    for (let i = 0; i < 100; i++) {
        for (const name of ['Character', 'LevelUp', 'OpponentCount', 'Roster', 'Mode', 'Seed']) findNode(root, name).click();
        assert.deepEqual(descendants(root), initialNodes);
    }
    assert.deepEqual(initialNodes.map(node => node.events.size), initialListeners);
    assert.equal(findNode(root, 'Level').getComponent(Label).string, '等级 30');
    findNode(root, 'Tier4').click(); findNode(root, 'Tier4').click();
    assert.equal(starts, 1); assert.equal(getAiDebugSetup().level, 30);
    for (const child of descendants(root)) if (child.events.has('click')) {
        assert.ok(Math.abs(child.y) <= 266);
        assert.ok(Math.abs(child.x) <= 335);
    }
});

test('真实登录入口使用主HUD，面板居中适配，宽屏遮挡完整，关闭恢复3D预览并清理监听', () => {
    const h = fixture(), { Node, load, view, listeners, UITransform, BlockInputEvents } = h;
    const tsPath = process.env.TYPESCRIPT_PATH || process.env.PATH.split(path.delimiter)
        .map(p => path.resolve(p, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p));
    const ts = require(tsPath);
    const file = path.join(h.root, 'assets/scripts/app/LoginManager.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'LoginManager');
    const method = cls.members.find(n => n.name?.getText(source) === 'showAiDebugPicker');
    const { mountAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const hud = new Node('Hud'); hud.layer = 1 << 25;
    const Login = vm.runInNewContext(ts.transpileModule(`class Login { ${method.getText(source)} }; Login`,
        { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText,
        { getUILayer: () => hud, UILayer: { Hud: 2 }, mountAiDebugSetupPicker,
            PlayerData: { coins: 100, breakthroughGems: 2 } });
    const owner = new Login(); owner._canvasNode = new Node('主画布'); owner._canvasNode.setPosition(640, 360);
    const presented = [];
    owner._prepareRaceFlow = { setModalOverlayActive: value => presented.push(value) };
    owner.startAiDebug = () => {};
    owner.adjustDebugCurrency = async () => ({ coins: 100, breakthroughGems: 2 });
    for (let repeat = 0; repeat < 3; repeat++) {
        owner.showAiDebugPicker(); owner.showAiDebugPicker();
        assert.equal(hud.children.length, 1);
        const overlay = hud.children[0], panel = overlay.getChildByName('Panel'), dim = overlay.getChildByName('Dim');
        assert.ok(overlay.getComponent(BlockInputEvents));
        for (const node of descendants(overlay)) assert.equal(node.layer, hud.layer, node.name);
        for (const [width, height] of [[1280, 720], [1600, 720], [960, 540], [720, 1280]]) {
            view.size = { width, height };
            view.canvasSize = width === 1600 ? { width: 1920, height: 720 } : { width, height };
            for (const fn of listeners.get('canvas-resize')) fn();
            assert.equal(overlay.x, 0); assert.equal(overlay.y, 0);
            assert.equal(panel.x, 0); assert.equal(panel.y, 0);
            const coveredWidth = 1280 * dim.scale.x;
            const coveredHeight = 720 * dim.scale.y;
            assert.ok(coveredWidth >= Math.max(width, height * view.canvasSize.width / view.canvasSize.height));
            assert.ok(coveredHeight >= Math.max(height, width * view.canvasSize.height / view.canvasSize.width));
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
        assert.equal(hud.children.length, 0);
        for (const set of listeners.values()) assert.equal(set.size, 0);
    }
    assert.equal(presented.at(-1), false);
    assert.equal(presented.filter(Boolean).length, presented.filter(value => !value).length);
});

test('对手人数、混合阵容和单角色设置提交到启动配置，切换不会立即启动', () => {
    const { Node, load } = fixture();
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const root = new Node('Panel'); let starts = 0;
    buildAiDebugSetupPicker(root, () => starts++, emptyCurrencyDebug());
    assert.equal(getAiDebugSetup().opponentCount, 7);
    findNode(root, 'OpponentCount').click();
    findNode(root, 'Roster').click();
    assert.equal(starts, 0);
    findNode(root, 'Tier4').click();
    assert.equal(getAiDebugSetup().opponentCount, 1);
    const second = new Node('Panel'); buildAiDebugSetupPicker(second, () => starts++, emptyCurrencyDebug());
    findNode(second, 'OpponentCount').click(); findNode(second, 'Roster').click();
    findNode(second, 'Tier3').click();
    assert.equal(getAiDebugSetup().opponentCount, 7);
    assert.equal(getAiDebugSetup().mixedCharacters, false);
    assert.equal(starts, 2);
});

test('模式测试页签列出八个单项娱乐模式，切换不重建并以固定满员阵容启动', () => {
    const { Node, Label, load } = fixture();
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const root = new Node('Panel'); let starts = 0; let difficulty = -1;
    buildAiDebugSetupPicker(root, value => { starts++; difficulty = value; }, emptyCurrencyDebug());
    const aiContent = findNode(root, 'AiTestContent');
    const modeContent = findNode(root, 'ModeTestContent');
    const aiTab = findNode(root, 'AiTestTab');
    const modeTab = findNode(root, 'ModeTestTab');
    const initialNodes = descendants(root);
    const initialListeners = initialNodes.map(node => node.events.size);
    assert.equal(aiContent.activeInHierarchy, true);
    assert.equal(modeContent.activeInHierarchy, false);
    findNode(root, 'OpponentCount').click();
    for (let i = 0; i < 50; i++) {
        modeTab.click(); modeTab.click();
        assert.equal(aiContent.activeInHierarchy, false);
        assert.equal(modeContent.activeInHierarchy, true);
        aiTab.click(); aiTab.click();
        assert.equal(aiContent.activeInHierarchy, true);
        assert.equal(modeContent.activeInHierarchy, false);
    }
    assert.deepEqual(descendants(root), initialNodes);
    assert.deepEqual(initialNodes.map(node => node.events.size), initialListeners);

    modeTab.click();
    const choices = modeContent.children.filter(node => node.name.startsWith('ModeChoice'));
    assert.equal(choices.length, 8);
    assert.deepEqual(choices.map(node => node.getChildByName('Label').getComponent(Label).string), [
        '心跳苏打大乱斗', '鲨鱼大乱斗', '漩涡冲浪赛', '炮火逃生赛', '定时炸弹模式', '水雷模式', '垃圾漂流大乱斗', '巨浪冲浪',
    ]);
    assert.equal(choices.some(node => node.getChildByName('Label').getComponent(Label).string === '娱乐模式'), false);
    for (const choice of choices) {
        choice.click();
        assert.equal(choices.filter(node => node.getChildByName('Selected').active).length, 1);
        assert.equal(choice.getChildByName('Selected').active, true);
    }
    findNode(modeContent, 'ModeStart').click();
    findNode(modeContent, 'ModeStart').click();
    assert.equal(starts, 1);
    assert.equal(difficulty, 0.75);
    assert.equal(getAiDebugSetup().mode, 'giant-wave-brawl');
    assert.equal(getAiDebugSetup().opponentCount, 7);
    assert.equal(getAiDebugSetup().mixedCharacters, true);
});

test('货币调试页可分别增减两种货币、切换数额并保持节点稳定', async () => {
    const { Node, Label, load } = fixture();
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    let balances = { coins: 50, breakthroughGems: 2 };
    const changes = [];
    const currencyDebug = {
        read: () => balances,
        adjust: async (currency, delta) => {
            changes.push([currency, delta]);
            balances = { ...balances, [currency]: Math.max(0, balances[currency] + delta) };
            return balances;
        },
    };
    const root = new Node('Panel');
    buildAiDebugSetupPicker(root, () => {}, currencyDebug);
    const initialNodes = descendants(root);
    const initialListeners = initialNodes.map(node => node.events.size);
    const currencyTab = findNode(root, 'CurrencyDebugTab');
    const content = findNode(root, 'CurrencyDebugContent');
    currencyTab.click(); currencyTab.click();
    assert.equal(content.activeInHierarchy, true);

    const coinRow = findNode(content, 'CoinRow');
    const gemRow = findNode(content, 'GemRow');
    assert.equal(findNode(coinRow, 'Balance').getComponent(Label).string, '当前：50');
    assert.equal(findNode(gemRow, 'Balance').getComponent(Label).string, '当前：2');
    findNode(coinRow, 'Amount').click();
    assert.equal(findNode(coinRow, 'Amount').getChildByName('Label').getComponent(Label).string, '数额 1000');
    await findNode(coinRow, 'Add').click();
    await findNode(coinRow, 'Subtract').click();
    await findNode(coinRow, 'Subtract').click();
    assert.equal(findNode(coinRow, 'Balance').getComponent(Label).string, '当前：0');
    await findNode(gemRow, 'Add').click();
    findNode(gemRow, 'Amount').click();
    await findNode(gemRow, 'Subtract').click();
    assert.equal(findNode(gemRow, 'Balance').getComponent(Label).string, '当前：0');
    assert.deepEqual(changes, [
        ['coins', 1000], ['coins', -1000], ['coins', -1000],
        ['breakthroughGems', 1], ['breakthroughGems', -5],
    ]);
    assert.deepEqual(descendants(root), initialNodes);
    assert.deepEqual(initialNodes.map(node => node.events.size), initialListeners);
});

test('巨浪预设与漩涡选项互斥，反复切换保持节点并提交单波设置', () => {
    const { Node, load } = fixture();
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const root = new Node('Panel'); let starts = 0;
    buildAiDebugSetupPicker(root, () => starts++, emptyCurrencyDebug());
    findNode(root, 'ModeTestTab').click();
    const nodes = descendants(root), listeners = nodes.map(n => n.events.size);
    for (let i = 0; i < 40; i++) {
        findNode(root, 'ModeChoice7').click();
        assert.equal(findNode(root, 'GiantWaveOptions').activeInHierarchy, true);
        assert.equal(findNode(root, 'WhirlpoolOptions').activeInHierarchy, false);
        findNode(root, 'WavePreset1').click(); findNode(root, 'WavePreset1').click();
        findNode(root, 'ModeChoice2').click();
        assert.equal(findNode(root, 'GiantWaveOptions').activeInHierarchy, false);
        assert.equal(findNode(root, 'WhirlpoolOptions').activeInHierarchy, true);
    }
    findNode(root, 'ModeChoice7').click();
    assert.equal(findNode(root, 'WavePreset1').getChildByName('Selected').active, true);
    assert.deepEqual(descendants(root), nodes);
    assert.deepEqual(nodes.map(n => n.events.size), listeners);
    findNode(root, 'ModeStart').click(); findNode(root, 'ModeStart').click();
    assert.equal(starts, 1); assert.equal(getAiDebugSetup().giantWavePreset, 'single');
});

test('漩涡模式测试可选纯随机、小漩涡或大漩涡并保留选择', () => {
    const { Node, Label, load } = fixture();
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const root = new Node('Panel'); let starts = 0;
    buildAiDebugSetupPicker(root, () => starts++, emptyCurrencyDebug());
    findNode(root, 'ModeTestTab').click();
    const options = findNode(root, 'WhirlpoolOptions');
    assert.equal(options.activeInHierarchy, false);
    findNode(root, 'ModeChoice2').click();
    assert.equal(options.activeInHierarchy, true);
    const choices = options.children.filter(node => node.name.startsWith('WhirlpoolSelection'));
    assert.deepEqual(choices.map(node => node.getChildByName('Label').getComponent(Label).string), [
        '纯随机', '小漩涡', '大漩涡',
    ]);
    assert.equal(choices[0].getChildByName('Selected').active, true);
    choices[2].click();
    assert.equal(choices.filter(node => node.getChildByName('Selected').active).length, 1);
    assert.equal(choices[2].getChildByName('Selected').active, true);
    findNode(root, 'ModeChoice1').click();
    assert.equal(options.activeInHierarchy, false);
    findNode(root, 'ModeChoice2').click();
    assert.equal(options.activeInHierarchy, true);
    assert.equal(choices[2].getChildByName('Selected').active, true);
    findNode(root, 'ModeStart').click();
    assert.equal(starts, 1);
    assert.equal(getAiDebugSetup().mode, 'whirlpool-brawl');
    assert.equal(getAiDebugSetup().whirlpoolSelection, 'super');
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
