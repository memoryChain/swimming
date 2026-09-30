const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

function fixture() {
    class Label { string = ''; static HorizontalAlign = { LEFT: 0, RIGHT: 1 }; static Overflow = { SHRINK: 1 }; }
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

test('第四页蝶泳测试反复切换不重建、启动单独标记且普通入口清除标记', () => {
    const { Node, load } = fixture();
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const panel = new Node('Panel'); let starts = 0;
    buildAiDebugSetupPicker(panel, () => starts++, emptyCurrencyDebug());
    const nodes = descendants(panel), listeners = nodes.map(n => n.events.size);
    for(let i=0;i<20;i++) {
        findNode(panel,'ButterflyTestTab').click();
        assert.equal(findNode(panel,'ButterflyTestContent').active,true);
        assert.equal(findNode(panel,'AiTestContent').active,false);
        findNode(panel,'CurrencyDebugTab').click();
        assert.equal(findNode(panel,'ButterflyTestContent').active,false);
    }
    assert.deepEqual(descendants(panel),nodes);
    assert.deepEqual(nodes.map(n=>n.events.size),listeners);
    findNode(panel,'ButterflyStart').click();findNode(panel,'ButterflyStart').click();
    assert.equal(starts,1);assert.equal(getAiDebugSetup().butterflyTest,true);
    assert.equal(getAiDebugSetup().butterflyOpponentCount,0);
    assert.equal(getAiDebugSetup().mode,'competitive');
    const other = new Node('Other');buildAiDebugSetupPicker(other,()=>{},emptyCurrencyDebug());
    findNode(other,'ModeStart').click();assert.equal(getAiDebugSetup().butterflyTest,false);
});

test('蝶泳8人选择只更新控件，独立记住人数与距离，生成7个混合AI', () => {
    const { Node, Label, load } = fixture();
    const { getAiDebugSetup, resolveAiDebugBuildOptions } = load('core/GameLaunchOptions');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const panel = new Node('Panel'); let starts = 0;
    buildAiDebugSetupPicker(panel, () => starts++, emptyCurrencyDebug());
    const nodes = descendants(panel), listeners = nodes.map(n => n.events.size);
    const players = findNode(panel, 'ButterflyPlayers');
    for (let i = 0; i < 21; i++) players.click();
    findNode(panel, 'LevelUp').click();
    findNode(panel, 'ButterflyTestTab').click();
    assert.match(findNode(findNode(panel, 'ButterflyTestContent'), 'CharacterHint').getComponent(Label).string, /等级 2/);
    assert.deepEqual(descendants(panel), nodes);
    assert.deepEqual(nodes.map(n => n.events.size), listeners);
    findNode(panel, 'ButterflyDistance').click();
    findNode(panel, 'ButterflyStart').click();findNode(panel, 'ButterflyStart').click();
    assert.equal(starts, 1);
    assert.equal(getAiDebugSetup().butterflyOpponentCount, 7);
    assert.equal(getAiDebugSetup().raceDistance, 400);
    const options = resolveAiDebugBuildOptions(getAiDebugSetup(), 3, .6);
    assert.equal(options.soloLane, undefined);
    assert.equal(options.characterId, undefined);
    const next = new Node('Next');
    buildAiDebugSetupPicker(next, () => {}, emptyCurrencyDebug());
    findNode(next, 'ButterflyPlayers').click();
    findNode(next, 'ButterflyStart').click();
    assert.equal(getAiDebugSetup().butterflyOpponentCount, 0);
});

test('蝶泳读数限频，隐藏不读取节拍，重复内容不重写文字', () => {
    const { Node, load } = fixture();
    const { ButterflyDebugHud } = load('ui/ButterflyDebugHud');
    const parent = new Node('Hud');
    const hud = new ButterflyDebugHud(parent,1280,720);
    let writes=0, text='';
    Object.defineProperty(hud.label,'string',{get:()=>text,set:v=>{writes++;text=v;}});
    const hidden = new Proxy({}, {get(){throw Error('隐藏时不能读取蝶泳状态');}});
    for(let i=0;i<100;i++) hud.update(.02,false,hidden);
    assert.equal(writes,0);
    const beat={active:true,held:true,progress:.35,lastQuality:-1,heartRate:120,lastEnergyCost:0,lastUltimateGain:0};
    hud.update(.11,true,beat);assert.equal(writes,1);
    for(let i=0;i<100;i++) hud.update(.02,true,beat);
    assert.equal(writes,1);
    beat.lastQuality=1;beat.lastEnergyCost=1.5;beat.lastUltimateGain=2.3;
    hud.update(.11,true,beat);assert.equal(writes,2);
    assert.match(text,/计费 1.5 点 · 蓄气 \+2.3/);assert.match(text,/起划心率 120/);
    parent.active=false;hud.update(1,true,hidden);assert.equal(writes,2);
});

test('随机体验只在开赛换种子，切回固定模式可以复现上一局且切换不重建控件', () => {
    const { Node, Label, load } = fixture();
    const { getAiDebugSetup, setAiDebugSetup, prepareAiDebugRaceSeed } = load('core/GameLaunchOptions');
    const { SeededRandom } = load('core/SharedRNG');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    let draws = 0;
    SeededRandom.entropySeed = () => 9000 + ++draws;
    const panel = new Node('Panel');
    buildAiDebugSetupPicker(panel, () => {}, emptyCurrencyDebug());
    const nodes = descendants(panel), listeners = nodes.map(n => n.events.size);
    assert.match(findNode(panel, 'ModeSeed').getChildByName('Label').getComponent(Label).string, /随机体验/);
    for (let i = 0; i < 20; i++) findNode(panel, 'ModeSeed').click();
    assert.equal(draws, 0);
    assert.deepEqual(descendants(panel), nodes);
    assert.deepEqual(nodes.map(n => n.events.size), listeners);
    findNode(panel, 'ModeStart').click();
    assert.equal(getAiDebugSetup().seed, 9001);
    assert.equal(prepareAiDebugRaceSeed(), 9002, '随机重赛换种子');
    const replay = new Node('Replay');
    buildAiDebugSetupPicker(replay, () => {}, emptyCurrencyDebug());
    findNode(replay, 'ModeSeed').click();
    assert.match(findNode(replay, 'ModeSeed').getChildByName('Label').getComponent(Label).string, /固定种子 9002/);
    findNode(replay, 'ModeStart').click();
    assert.equal(getAiDebugSetup().seed, 9002);
    assert.equal(prepareAiDebugRaceSeed(), 9002);
    assert.equal(draws, 2);
    setAiDebugSetup({ ...getAiDebugSetup(), seedMode: 'random' });
    SeededRandom.entropySeed = () => 9002;
    assert.equal(prepareAiDebugRaceSeed(), 9003, '重复熵值不造成同一种子');
});

test('重开随机赛重新编排一次，固定复现和联机不更换种子或导演', () => {
    const { root } = fixture();
    const tsPath = process.env.TYPESCRIPT_PATH || process.env.PATH.split(path.delimiter)
        .map(p => path.resolve(p, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p));
    const ts = require(tsPath);
    const file = path.join(root, 'assets/scripts/core/GameManager.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'GameManager');
    const method = cls.members.find(n => n.name?.getText(source) === 'refreshRandomRaceForReplay');
    let seedMode = 'random', seed = 10, builds = 0, mode = 'entertainment-brawl', ticket = null;
    const seeds = [];
    const Subject = vm.runInNewContext(ts.transpileModule(`class Subject { ${method.getText(source)} }; Subject`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, { getAiDebugSetup: () => ({ seedMode }), prepareAiDebugRaceSeed: () => ++seed,
        reseedSharedRandom: value => seeds.push(value), SeededRandom: { entropySeed: () => ++seed },
        isEntertainmentBrawlMode: () => mode === 'entertainment-brawl', getSoloRaceTicket: () => ticket,
        isObstacleBrawlMode: () => mode === 'obstacle-brawl',
        getRaceDifficultyConfig: () => ({ id: mode }) });
    const game = new Subject();
    game._aiDebugMode = true;
    game.setupEntertainmentMode = () => builds++;
    game.refreshRandomRaceForReplay();
    assert.deepEqual(seeds, [11]); assert.equal(builds, 1);
    seedMode = 'fixed'; game.refreshRandomRaceForReplay();
    seedMode = 'random'; game._netSession = {}; game.refreshRandomRaceForReplay();
    assert.equal(builds, 1); assert.deepEqual(seeds, [11]);
    game._netSession = null; game._aiDebugMode = false;
    game.refreshRandomRaceForReplay();
    assert.equal(builds, 2); assert.deepEqual(seeds, [11, 12]);
    ticket = {}; game.refreshRandomRaceForReplay();
    assert.equal(builds, 2);
    ticket = null;
    let setState;
    const visit = node => {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'setState') setState = node.initializer;
        ts.forEachChild(node, visit);
    };
    visit(cls.members.find(n => n.name?.getText(source) === 'createGameFlow'));
    const GameState = { READY: 0, RACING: 1, AWARDS: 2, PRECOUNTDOWN: 3, DIVING: 4, COUNTDOWN: 5, GLIDING: 6, FINISHED: 7 };
    const makeSetState = vm.runInNewContext(ts.transpileModule(`function make() { return ${setState.getText(source)}; }; make`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, { GameState });
    game._state = GameState.FINISHED;
    game.syncConditionPhase = () => {};
    game._awardsPresentation = { hide() {} };
    const transition = makeSetState.call(game);
    transition(GameState.READY); transition(GameState.READY);
    assert.equal(builds, 3, '重赛公共状态入口仅重新编排一次');
    game._aiDebugMode = true; mode = 'cannon-brawl';
    const setups = [];
    for (const name of ['setupSharkBrawl', 'setupCannonBrawl', 'setupMineRelayBrawl', 'setupMinefieldBrawl', 'setupLitterBrawl']) {
        game[name] = () => setups.push(name);
    }
    game.refreshRandomRaceForReplay();
    assert.equal(builds, 4);
    assert.equal(setups.length, 5, '单项重赛重建规则控制器，不能仅修改种子读数');
});

test('AI 测试身份在场景创建前生效，整局事件不会读取快速比赛档位', () => {
    const tsPath = process.env.TYPESCRIPT_PATH || process.env.PATH.split(path.delimiter)
        .map(p => path.resolve(p, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p));
    const ts = require(tsPath);
    const file = path.resolve(__dirname, '../assets/scripts/core/GameManager.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'GameManager');
    const onLoad = cls.members.find(node => node.name?.getText(source) === 'onLoad');
    const code = ts.transpileModule(`class Fixture { ${onLoad.getText(source)} }; Fixture`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    let launchConsumed = 0;
    let modeAtSceneBuild = null;
    const Fixture = vm.runInNewContext(code, {
        game: { frameRate: 0 }, Layers: { Enum: { UI_2D: 25 } }, console: { log() {} },
        loadSavedTuningAsync: callback => callback(),
        loadSampledActionsForRace: callback => callback(null),
        consumeMainGameLaunchMode: () => { launchConsumed++; return 'ai-debug'; },
        getAiDebugDifficulty: () => 0.75,
        getRaceDifficultyConfig: () => ({ id: 'entertainment-brawl' }),
        logTextureFormatDiagnostics() {}, LoadingOverlay: { hide() {} },
    });
    const game = new Fixture();
    game.node = { layer: 0 };
    game._aiDebugMode = false;
    game._aiDebugDifficulty = 0.8;
    game.scheduleOnce = callback => callback();
    game.buildScene = callback => { modeAtSceneBuild = game._aiDebugMode; callback(); };
    for (const name of ['registerEvents', 'debug', 'setupTurtleBusDebugRace', 'applyAiDebugHud', 'startGame']) {
        game[name] = () => {};
    }
    game.paintError = error => { throw error; };
    game.onLoad();
    assert.equal(modeAtSceneBuild, true);
    assert.equal(game._aiDebugDifficulty, 0.75);
    assert.equal(launchConsumed, 1);
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

test('模式测试页签列出娱乐模式及九个单项模式，切换不重建并以固定满员阵容启动', () => {
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
    assert.equal(choices.length, 10);
    assert.deepEqual(choices.map(node => node.getChildByName('Label').getComponent(Label).string), [
        '娱乐模式', '心跳苏打大乱斗', '充气玩具鲨', '漩涡冲浪赛', '水球点名', '定时水球传递', '水上障碍场', '巨浪冲浪', '海龟班车试玩', '海底喷泉',
    ]);
    for (const choice of choices) {
        choice.click();
        assert.equal(choices.filter(node => node.getChildByName('Selected').active).length, 1);
        assert.equal(choice.getChildByName('Selected').active, true);
    }
    findNode(modeContent, 'ModeStart').click();
    findNode(modeContent, 'ModeStart').click();
    assert.equal(starts, 1);
    assert.equal(difficulty, 0.75);
    assert.equal(getAiDebugSetup().mode, 'geyser-brawl');
    assert.equal(getAiDebugSetup().opponentCount, 7);
    assert.equal(getAiDebugSetup().mixedCharacters, true);
});

test('喷泉强度逐档显示实际喷口数，启动保留五档且切换不重建控件', () => {
    const { Node, Label, load } = fixture();
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const { geyserSpec } = load('core/GeyserBrawlRules');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const root = new Node('Panel');
    buildAiDebugSetupPicker(root, () => {}, emptyCurrencyDebug());
    findNode(root, 'ModeTestTab').click();
    findNode(root, 'ModeChoice9').click();
    const nodes = descendants(root), listeners = nodes.map(n => n.events.size);
    const intensity = findNode(root, 'IntensityChoice');
    assert.equal(intensity.getChildByName('Label').getComponent(Label).string, '强度 2 · 4 个喷口');
    for (const level of [3, 4, 5, 1, 2, 3, 4, 5]) {
        intensity.click();
        assert.equal(intensity.getChildByName('Label').getComponent(Label).string,
            `强度 ${level} · ${geyserSpec(level).ventCount} 个喷口`);
        const spec = geyserSpec(level);
        assert.ok(descendants(root).some(n => n.getComponent(Label)?.string
            === `小 ${spec.ventCount-spec.largeCount}／大 ${spec.largeCount} · 每口 ${spec.pulseCount} 轮`));
    }
    assert.deepEqual(descendants(root), nodes);
    assert.deepEqual(nodes.map(n => n.events.size), listeners);
    findNode(root, 'ModeStart').click();
    assert.equal(getAiDebugSetup().mode, 'geyser-brawl');
    assert.equal(getAiDebugSetup().entertainmentIntensity, 5);
});

test('海龟只有固定规格，喷泉与巨浪各记住五档，预设和赛程不覆盖档位', () => {
    const { Node, Label, UITransform, load } = fixture();
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const root = new Node('Panel'); let starts = 0;
    buildAiDebugSetupPicker(root, () => starts++, emptyCurrencyDebug());
    findNode(root, 'ModeTestTab').click();
    const intensity = findNode(root, 'IntensityChoice');
    const text = () => intensity.getChildByName('Label').getComponent(Label).string;
    const summary = () => findNode(root, 'SoloSpecSummary').getComponent(Label).string;
    const nodes = descendants(root), listeners = nodes.map(n => n.events.size);
    findNode(root, 'ModeChoice9').click();
    intensity.click(); intensity.click(); intensity.click();
    assert.equal(text(), '强度 5 · 10 个喷口');
    findNode(root, 'ModeChoice7').click();
    assert.equal(text(), '强度 3 · 浪宽 55%');
    assert.match(summary(), /3 波.*30%/);
    findNode(root, 'DistanceChoice').click();
    assert.match(summary(), /7 波/);
    findNode(root, 'WavePreset1').click();
    assert.match(summary(), /1 波/);
    assert.equal(text(), '强度 3 · 浪宽 55%');
    const widths = [65, 75, 35, 45, 55];
    for (let i = 0; i < 20; i++) {
        intensity.click();
        assert.ok(text().endsWith(`浪宽 ${widths[i % 5]}%`));
        findNode(root, 'ModeChoice8').click();
        assert.equal(intensity.activeInHierarchy, false);
        assert.equal(findNode(root, 'TurtleFixedSpec').activeInHierarchy, true);
        assert.match(summary(), /挤开/);
        findNode(root, 'ModeChoice9').click();
        assert.equal(text(), '强度 5 · 10 个喷口');
        findNode(root, 'ModeChoice7').click();
        assert.ok(text().endsWith(`浪宽 ${widths[i % 5]}%`));
    }
    assert.deepEqual(descendants(root), nodes);
    assert.deepEqual(nodes.map(n => n.events.size), listeners);
    const seed = findNode(root, 'ModeSeed'), info = findNode(root, 'SoloSpecSummary');
    assert.ok(seed.x + seed.getComponent(UITransform).contentSize.width / 2
        < info.x - info.getComponent(UITransform).contentSize.width / 2, '种子与规格说明不重叠');
    findNode(root, 'ModeStart').click(); findNode(root, 'ModeStart').click();
    assert.equal(starts, 1);
    assert.equal(getAiDebugSetup().entertainmentIntensity, 3);
    assert.equal(getAiDebugSetup().geyserIntensity, 5);
    assert.equal(getAiDebugSetup().giantWavePreset, 'single');
    const reopened = new Node('Reopened');
    buildAiDebugSetupPicker(reopened, () => {}, emptyCurrencyDebug());
    findNode(reopened, 'ModeTestTab').click();
    findNode(reopened, 'ModeChoice9').click();
    assert.equal(findNode(reopened, 'IntensityChoice').getChildByName('Label').getComponent(Label).string,
        '强度 5 · 10 个喷口');
    findNode(reopened, 'ModeChoice8').click();
    findNode(reopened, 'ModeStart').click();
    assert.equal(getAiDebugSetup().entertainmentIntensity, null);
    assert.equal(getAiDebugSetup().geyserIntensity, 5);
});

test('综合娱乐整局与单项测试互斥，切换保留档位且不重建控件', () => {
    const { Node, Label, load } = fixture();
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const root = new Node('Panel'); let starts = 0;
    buildAiDebugSetupPicker(root, () => starts++, emptyCurrencyDebug());
    findNode(root, 'ModeTestTab').click();
    const nodes = descendants(root), listeners = nodes.map(node => node.events.size);
    const route = findNode(root, 'EntertainmentTestRoute');
    const grade = findNode(root, 'EntertainmentRaceGrade');
    const intensity = findNode(root, 'IntensityChoice');
    const combination = findNode(root, 'CombinationChoice');
    const event = findNode(root, 'EventChoice');
    const level = findNode(root, 'EventLevelChoice');
    assert.equal(grade.active, true);
    assert.equal(intensity.active, false);
    assert.match(route.getChildByName('Label').getComponent(Label).string, /整局分级/);
    assert.match(findNode(root, 'ModeStart').getChildByName('Label').getComponent(Label).string, /整局 3 档/);
    grade.click();
    assert.match(grade.getChildByName('Label').getComponent(Label).string, /整局强度 4 档/);
    assert.match(findNode(root, 'ModeStart').getChildByName('Label').getComponent(Label).string, /整局 4 档/);
    route.click();
    assert.equal(grade.active, false);
    assert.equal(intensity.active, true);
    assert.match(route.getChildByName('Label').getComponent(Label).string, /单项强度测试/);
    assert.match(findNode(root, 'ModeStart').getChildByName('Label').getComponent(Label).string, /单项强度/);
    intensity.click(); intensity.click();
    combination.click(); combination.click();
    event.click(); event.click();
    assert.match(level.getChildByName('Label').getComponent(Label).string, /漩涡：5 档/);
    level.click();
    assert.match(level.getChildByName('Label').getComponent(Label).string, /漩涡：4 档/);
    route.click();
    assert.equal(grade.active, true);
    assert.equal(intensity.active, false);
    assert.equal(event.active, false);
    assert.equal(combination.active, false);
    assert.match(grade.getChildByName('Label').getComponent(Label).string, /整局强度 4 档/);
    route.click();
    assert.equal(intensity.active, true);
    assert.match(intensity.getChildByName('Label').getComponent(Label).string, /逐项强度配置/);
    findNode(root, 'DistanceChoice').click();
    assert.deepEqual(descendants(root), nodes);
    assert.deepEqual(nodes.map(node => node.events.size), listeners);
    findNode(root, 'ModeStart').click();
    const setup = getAiDebugSetup();
    assert.equal(starts, 1);
    assert.equal(setup.mode, 'entertainment-brawl');
    assert.equal(setup.entertainmentIntensity, 5);
    assert.equal(setup.entertainmentRaceGrade, 4);
    assert.equal(setup.entertainmentEventIntensities[2], 4);
    assert.equal(setup.entertainmentEventIntensities[8], 5);
    assert.equal(setup.entertainmentEventIntensities[9], 5);
    assert.equal(setup.entertainmentEventIntensities[7], 1);
    assert.equal(setup.entertainmentTestCombination, 'litter-whirlpool');
    assert.equal(setup.raceDistance, 400);
});

test('综合娱乐整局分级开赛只提交整局档位，单项原规格保持独立', () => {
    const { Node, Label, load } = fixture();
    const { getAiDebugSetup } = load('core/GameLaunchOptions');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const root = new Node('Panel'); let starts = 0;
    buildAiDebugSetupPicker(root, () => starts++, emptyCurrencyDebug());
    findNode(root, 'ModeTestTab').click();
    const grade = findNode(root, 'EntertainmentRaceGrade');
    const intensity = findNode(root, 'IntensityChoice');
    grade.click();
    findNode(root, 'ModeChoice1').click();
    assert.equal(grade.active, false);
    assert.equal(intensity.active, true);
    assert.equal(intensity.getChildByName('Label').getComponent(Label).string, '原规格');
    findNode(root, 'ModeChoice0').click();
    assert.equal(grade.active, true);
    assert.equal(intensity.active, false);
    findNode(root, 'ModeStart').click();
    assert.equal(starts, 1);
    assert.equal(getAiDebugSetup().entertainmentRaceGrade, 4);
    assert.equal(getAiDebugSetup().entertainmentIntensity, null);
});

test('五档比赛统计限频并在隐藏后停止采样和文字写入', () => {
    const { Node, Label, load } = fixture();
    const { EntertainmentIntensityDebugHud } = load('ui/EntertainmentIntensityDebugHud');
    const hud = new EntertainmentIntensityDebugHud();
    const root = new Node('RaceHud');
    hud.build(root, 1280, 720);
    const labelNode = findNode(root, 'EntertainmentIntensityStats');
    const label = labelNode.getComponent(Label);
    assert.equal(hud.consumeSample(0.1, true), false);
    assert.equal(hud.consumeSample(0.1, true), true);
    hud.present(6, 5, '杂物', 45, 15, 15, 0);
    const text = label.string;
    assert.match(text, /计划45 已触发15 在场15\/峰值15/);
    assert.equal(hud.consumeSample(0.01, true), false);
    labelNode.active = false;
    assert.equal(hud.consumeSample(1, true), false);
    hud.present(6, 5, '杂物', 45, 30, 30, 0);
    assert.equal(label.string, text);
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
        findNode(root, 'ModeChoice3').click();
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

test('旧杂物与浮标测试入口迁移到同一障碍入口，三种布局切换不重建控件', () => {
    const { Node, load } = fixture();
    const { getAiDebugSetup, setAiDebugSetup } = load('core/GameLaunchOptions');
    const initial = { ...getAiDebugSetup() };
    setAiDebugSetup({ ...initial, mode: 'litter-brawl' });
    assert.equal(getAiDebugSetup().mode, 'obstacle-brawl');
    assert.equal(getAiDebugSetup().obstacleLayout, 'debris');
    setAiDebugSetup({ ...initial, mode: 'minefield-brawl' });
    assert.equal(getAiDebugSetup().mode, 'obstacle-brawl');
    assert.equal(getAiDebugSetup().obstacleLayout, 'buoy');
    const { buildAiDebugSetupPicker } = load('ui/AiDebugSetupPicker');
    const root = new Node('Panel');
    buildAiDebugSetupPicker(root, () => {}, emptyCurrencyDebug());
    findNode(root, 'ModeTestTab').click();
    findNode(root, 'ModeChoice6').click();
    const layout = findNode(root, 'ObstacleLayoutOptions');
    assert.equal(layout.activeInHierarchy, true);
    const nodes = descendants(root), listeners = nodes.map(node => node.events.size);
    for (let i = 0; i < 20; i++) {
        findNode(root, 'ObstacleLayout0').click();
        findNode(root, 'ObstacleLayout2').click();
    }
    findNode(root, 'ObstacleLayout1').click();
    findNode(root, 'ModeStart').click();
    assert.equal(getAiDebugSetup().obstacleLayout, 'buoy');
    assert.deepEqual(descendants(root), nodes);
    assert.deepEqual(nodes.map(node => node.events.size), listeners);
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
    findNode(root, 'ModeChoice3').click();
    assert.equal(options.activeInHierarchy, true);
    const choices = options.children.filter(node => node.name.startsWith('WhirlpoolSelection'));
    assert.deepEqual(choices.map(node => node.getChildByName('Label').getComponent(Label).string), [
        '纯随机', '小漩涡', '大漩涡',
    ]);
    assert.equal(choices[0].getChildByName('Selected').active, true);
    choices[2].click();
    assert.equal(choices.filter(node => node.getChildByName('Selected').active).length, 1);
    assert.equal(choices[2].getChildByName('Selected').active, true);
    findNode(root, 'ModeChoice2').click();
    assert.equal(options.activeInHierarchy, false);
    findNode(root, 'ModeChoice3').click();
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
