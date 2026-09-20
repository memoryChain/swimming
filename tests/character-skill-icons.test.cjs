const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const directory of process.env.PATH.split(path.delimiter)) {
        const file = path.resolve(directory, '../typescript/lib/typescript.js');
        if (fs.existsSync(file)) return require(file);
    }
    throw new Error('需要 TypeScript 5.4.5');
}
const ts = compiler();
const root = path.resolve(__dirname, '..');
function load(file, imports = {}) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, require: key => imports[key] ?? {}, console: { warn() {} } });
    return module.exports;
}
const { RESOURCE_PATHS } = load('assets/scripts/core/ResourcePaths.ts');

function setup() {
    const pending = [], frames = [];
    class Node {
        static EventType = { NODE_DESTROYED: 'destroy' };
        children = []; components = []; handlers = []; isValid = true;
        position = { x: 0, y: 0, z: 0 }; active = true;
        constructor(name) { this.name = name; }
        addComponent(C) { const c = new C(); c.node = this; this.components.push(c); return c; }
        getComponent(C) { return this.components.find(c => c instanceof C); }
        setPosition(x, y, z) { this.position = { x, y, z }; }
        once(event, callback) { this.handlers.push(callback); }
        destroy() { this.isValid = false; this.handlers.forEach(f => f()); this.children.forEach(n => n.destroy()); }
    }
    class UITransform {
        contentSize = { width: 0, height: 0 }; writes = 0;
        setContentSize(width, height) { this.contentSize = { width, height }; ++this.writes; }
    }
    class Sprite {
        static SizeMode = { CUSTOM: 1 }; writes = 0;
        get isValid() { return this.node.isValid; }
        get spriteFrame() { return this.frame; }
        set spriteFrame(frame) { this.frame = frame; ++this.writes; }
    }
    class SpriteFrame {
        isValid = true;
        constructor() { frames.push(this); }
        destroy() { assert.equal(this.isValid, true, '帧只释放一次'); this.isValid = false; }
    }
    const makeUiNode = (name, parent) => {
        const node = new Node(name); parent.children.push(node); node.addComponent(UITransform); return node;
    };
    const { CharacterSkillIcon } = load('assets/scripts/ui/CharacterSkillIcon.ts', {
        cc: { Node, UITransform, Sprite, SpriteFrame, Texture2D: class {} },
        '../core/ResourcePaths': { RESOURCE_PATHS },
        '../core/RaceBundleLoader': { loadRaceAsset(asset, type, done) { pending.push({ asset, done }); } },
        './RuntimeUiFactory': { makeUiNode },
    });
    const parent = new Node('Parent'), fallback = new Node('Fallback');
    const icon = new CharacterSkillIcon(parent, 74, fallback);
    const finish = (index, error = null) => pending[index].done(error, error ? undefined : { path: pending[index].asset });
    return { parent, fallback, icon, pending, frames, finish, sprite: icon.node.getComponent(Sprite), transform: icon.node.getComponent(UITransform) };
}

test('十一种现有角色能力均有独立图标资源与 Creator 元数据，教练复用正式素材', () => {
    const source = fs.readFileSync(path.join(root, 'assets/scripts/app/PlayerCharacterConfig.ts'), 'utf8');
    const abilities = [...source.matchAll(/abilityId: '([^']+)'/g)].map(m => m[1]);
    assert.equal(abilities.length, 11);
    assert.equal(new Set(abilities.map(id => RESOURCE_PATHS.characterSkillIcons[id])).size, 11);
    for (const id of abilities) {
        const asset = RESOURCE_PATHS.characterSkillIcons[id];
        assert.ok(asset, id);
        const file = path.join(root, 'assets/race', asset.replace(/\/texture$/, '.png'));
        assert.ok(fs.existsSync(file), file);
        const meta = JSON.parse(fs.readFileSync(file + '.meta', 'utf8'));
        assert.ok(Object.values(meta.subMetas).some(m => m.importer === 'texture' && m.name === 'texture'));
    }
    assert.equal(RESOURCE_PATHS.characterSkillIcons.breathControl, RESOURCE_PATHS.lobbyB.skillBreath);
});

test('快速换角色的乱序回调不覆盖当前技能，重复刷新不加载或改写', () => {
    const s = setup();
    s.icon.setAbility('frogHop'); s.icon.setAbility('kickDive');
    s.finish(1); s.finish(0);
    assert.equal(s.sprite.spriteFrame.texture.path, RESOURCE_PATHS.characterSkillIcons.kickDive);
    assert.equal(s.frames.length, 1);
    assert.equal(s.fallback.active, false);
    const writes = s.transform.writes;
    for (let i = 0; i < 30; ++i) s.icon.setAbility('kickDive');
    assert.equal(s.pending.length, 2); assert.equal(s.sprite.writes, 1); assert.equal(s.transform.writes, writes);
});

test('反复切换只保留一张自有帧，节点监听稳定，教练保留原排版', () => {
    const s = setup();
    for (let i = 0; i < 22; ++i) { s.icon.setAbility(i % 2 ? 'breathControl' : 'frogSense'); s.finish(i); }
    assert.equal(s.parent.children.length, 1); assert.equal(s.icon.node.handlers.length, 1);
    assert.equal(s.frames.filter(f => f.isValid).length, 1);
    assert.equal(s.transform.contentSize.width, 46); assert.equal(s.transform.contentSize.height, 44);
    assert.equal(s.icon.node.position.y, 1);
    s.icon.setAbility('precision'); s.parent.destroy(); s.finish(22);
    assert.equal(s.frames.length, 22); assert.equal(s.frames.filter(f => f.isValid).length, 0);
});

test('加载失败可重试，空能力阻止旧回调并显示后备文字', () => {
    const s = setup();
    s.icon.setAbility('precision'); s.finish(0, new Error('模拟失败'));
    assert.equal(s.icon.node.active, false); assert.equal(s.fallback.active, true);
    s.icon.setAbility('precision'); s.finish(1);
    assert.equal(s.icon.node.active, true); assert.equal(s.fallback.active, false);
    s.icon.setAbility('frogHop'); s.icon.setAbility('none'); s.finish(2);
    assert.equal(s.icon.node.active, false); assert.equal(s.fallback.active, true);
});

test('大厅读取已上场角色，详情读取当前浏览角色，升级刷新只更新对应图标', () => {
    const file = path.join(root, 'assets/scripts/ui/PrepareRaceFlow.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'PrepareRaceFlow');
    const methods = cls.members.filter(n => ['refreshReadyCharacterInfo', 'refreshCharacterInspector'].includes(n.name?.getText(source)));
    assert.equal(methods.length, 2);
    const code = ts.transpileModule(`class Harness { ${methods.map(n => n.getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const selection = { id: 'active', name: '蛙少', abilityId: 'frogHop' }, draft = { id: 'draft', name: '潜水哥', abilityId: 'kickDive' };
    const Harness = vm.runInNewContext(`${code}; Harness`, {
        findPlayerCharacter: id => id ? draft : selection,
        getProgressionManager: () => ({ getCharacterLevel: () => 1, coinCostForNextLevel: () => 100 }),
        PROGRESSION_BALANCE: { maxLevel: 30 }, PlayerData: { coins: 200 },
        resolveCharacterDisplayStats: () => ({ stamina: 100, technique: 100, burst: 100 }),
        setLabelString() {}, setLabelColor() {}, setButtonInteractable() {}, DARK_TEXT: {}, uiColor() {},
    });
    const flow = new Harness(), calls = [];
    Object.assign(flow, { _draftCharacterId: 'draft', _readyStats: [], _inspectorCurrentStats: [],
        _readySkillIcon: { setAbility: id => calls.push(['大厅', id]) },
        _inspectorSkillIcon: { setAbility: id => calls.push(['详情', id]) },
    });
    flow.refreshReadyCharacterInfo(); flow.refreshCharacterInspector(); flow.refreshCharacterInspector();
    assert.deepEqual(calls, [['大厅', 'frogHop'], ['详情', 'kickDive'], ['详情', 'kickDive']]);
});
