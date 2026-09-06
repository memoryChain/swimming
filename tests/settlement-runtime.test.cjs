// 无需启动 Creator；执行真实结算显示层，检查状态、资源、布局与生命周期。
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
        const candidate = path.resolve(dir, '../typescript/lib/typescript.js');
        if (fs.existsSync(candidate)) return require(candidate);
    }
    throw new Error('请通过 pnpm test:results 运行固定版本 TypeScript 测试');
}
const ts = compiler();
class Component { get isValid() { return this.node?.isValid; } }
class Color {
    constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); }
    equals(c) { return this.r === c.r && this.g === c.g && this.b === c.b && this.a === c.a; }
}
class UITransform extends Component {
    contentSize = { width: 0, height: 0 };
    setContentSize(width, height) { this.contentSize = { width, height }; }
}
class Label extends Component {
    static HorizontalAlign = { CENTER: 0, LEFT: 1, RIGHT: 2 };
    static VerticalAlign = { CENTER: 0 }; static Overflow = { SHRINK: 2 };
    writes = 0; _string = '';
    get string() { return this._string; } set string(v) { this.writes++; this._string = v; }
}
class Sprite extends Component { static SizeMode = { CUSTOM: 0 }; spriteFrame = null; }
class Button extends Component { static Transition = { SCALE: 1 }; static EventType = { CLICK: 'click' }; }
class Node {
    children = []; components = []; handlers = {}; active = true; isValid = true; layer = 1;
    position = { x: 0, y: 0, z: 0 }; scale = { x: 1, y: 1, z: 1 };
    constructor(name) { this.name = name; }
    setParent(parent) { this.parent = parent; parent.children.push(this); }
    addComponent(C) { const c = new C(); c.node = this; this.components.push(c); return c; }
    getComponent(C) { return this.components.find(c => c instanceof C); }
    setPosition(x, y, z = 0) { this.position = { x, y, z }; }
    setScale(x, y, z = 1) { this.scale = { x, y, z }; }
    on(event, fn) { (this.handlers[event] ??= []).push(fn); }
    click() { for (const fn of this.handlers.click ?? []) fn(); }
    destroy() { this.isValid = false; for (const child of this.children) child.destroy(); }
}
const size = { width: 1672, height: 941 };
let deferred = false;
const pending = [];
const frame = p => ({ path: p, isValid: true });
const cache = {};
const stubs = {
    cc: { Node, UITransform, Color, Label, Sprite, Button, view: { getVisibleSize: () => size } },
    'core/GameBalance': { getRaceDistance: () => 200, getRaceDifficulty: () => 'competitive' },
    'ui/AvatarUiAssets': {
        avatarTexturePath: id => `avatar/${id}`,
        loadAvatarUiSpriteFrame: (p, done) => deferred ? pending.push({ p, done }) : done(frame(p)),
    },
    'ui/ProjectUiFonts': { PROJECT_UI_ENGLISH_BOLD_FAMILY: 'Arial Black', styleProjectUiLabel: (label, weight, lineHeight) => { label.weight = weight; label.lineHeight = lineHeight; } },
    'backend/PlayerData': { PlayerData: { avatarId: 'coral', nickName: '小鲸3949' } },
    'backend/IdentityConfig': { AVATARS: [{ id: 'coral' }, { id: 'aqua' }, { id: 'lime' }] },
};
function load(file) {
    file = path.resolve(file);
    if (cache[file]) return cache[file].exports;
    const module = { exports: {} }; cache[file] = module;
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const req = id => {
        const resolved = id.startsWith('.') ? path.resolve(path.dirname(file), id).replaceAll('\\', '/') : id;
        for (const key of Object.keys(stubs)) if (id === key || resolved.endsWith('/' + key)) return stubs[key];
        return load(path.resolve(path.dirname(file), id + '.ts'));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(req, module, module.exports);
    return module.exports;
}
const { SettlementView, settlementTier, settlementTime } = load(path.join(root, 'assets/scripts/ui/SettlementView.ts'));
function nodes(n) { return [n, ...n.children.flatMap(nodes)]; }
function find(n, name) { return nodes(n).find(n => n.name === name); }
function data(place = 2, finished = true) {
    return { averageSpeed: 1.83, placement: place, racerCount: 8, leaderboard: Array.from({ length: 8 }, (_, i) => ({
        name: ['王志刚', '小鲸3949', '浪花33', '海风07', '张耀军', '王划水', '陈飞鱼', '何遥浪'][i],
        placement: i + 1, time: 104.52 + i * 4.93, lane: i, isPlayer: i + 1 === place, finished,
    })) };
}
function make(callbacks = {}) { return new SettlementView(new Node('HUD'), { onRestart() {}, onMenu() {}, ...callbacks }); }
if (require.main === module) {
    test('四种荣誉状态；未完成、退出和淘汰不授予前三名奖牌', () => {
        for (let rank = 1; rank <= 8; rank++) {
            assert.equal(settlementTier(rank, true), rank <= 3 ? rank - 1 : 3);
            assert.equal(settlementTier(rank, false), 3);
        }
        assert.equal(settlementTime({ time: 109.456, finished: true }), '109.46');
        assert.equal(settlementTime({ time: 109, finished: false }), '未完成');
        assert.equal(settlementTime({ time: 109, quit: true }), '已退出');
        assert.equal(settlementTime({ time: 109, eliminated: true }), '已淘汰');
        const v = make();
        for (const rank of [1, 2, 3, 4, 8]) {
            v.show(109.45, data(rank));
            assert.match(v.honor.spriteFrame.path, new RegExp(['gold', 'silver', 'bronze'][rank - 1] ?? 'normal'));
            assert.equal(v.rows.filter(r => r.self.node.active).length, 1);
            assert.equal(v.medalNumber.node.active, rank > 3);
        }
        v.show(0, data(2, false)); assert.equal(v.title.string, '未完成');
    });
    test('本人描边沿用原稿外扩画布与底板下方层级，导出不清零矢量描边', () => {
        const v = make();
        for (const place of [1, 2, 3, 4, 8]) {
            v.show(109.45, data(place));
            for (let i = 0; i < v.rows.length; i++) {
                const row = v.rows[i];
                assert.ok(row.root.children.indexOf(row.self.node) < row.root.children.indexOf(row.back.node));
                assert.equal(row.self.node.active, i + 1 === place);
                assert.deepEqual(row.self.node.getComponent(UITransform).contentSize, { width: 666, height: 117 });
                assert.equal(row.self.node.position.x - row.back.node.position.x, 0.5);
                assert.equal(row.self.node.position.y - row.back.node.position.y, 0.5);
            }
        }
        const exporter = fs.readFileSync(path.join(root, 'scripts/export-settlement-runtime.jsx'), 'utf8');
        assert.doesNotMatch(exporter, /fillOpacity\s*=\s*0/);
    });
    test('权威顺序及真实头像不按名次重算，重复显示不增长节点或监听', () => {
        const v = make({ resolveResultAvatar: row => row.lane === 0 ? 'lime' : undefined });
        const d = data(); d.leaderboard[0].time = 180;
        v.show(99, d);
        assert.equal(v.rows[0].time.string, '180.00');
        assert.equal(v.rows[0].avatar.spriteFrame.path, 'avatar/lime');
        assert.equal(v.rows[1].avatar.spriteFrame.path, 'avatar/coral');
        assert.equal(v.time.string, '109.45');
        const count = nodes(v.root).length;
        const listeners = () => nodes(v.root).reduce((sum, n) => sum + Object.values(n.handlers).flat().length, 0);
        const bound = listeners();
        const writes = () => nodes(v.root).reduce((sum, n) => sum + (n.getComponent(Label)?.writes ?? 0), 0);
        const before = writes();
        for (let i = 0; i < 200; i++) v.show(99, d);
        assert.equal(nodes(v.root).length, count); assert.equal(listeners(), bound); assert.equal(writes(), before);
        assert.equal(v.root.children.some(n => /background/i.test(n.name)), false);
        for (const n of nodes(v.root)) {
            const l = n.getComponent(Label), s = n.getComponent(Sprite);
            if (l) {
                assert.ok(l.lineHeight <= n.getComponent(UITransform).contentSize.height);
                if (l.fontFamily) { assert.equal(l.fontFamily, 'Arial Black'); assert.equal(l.isBold, true); }
                else assert.equal(l.weight, 'semibold');
            }
            if (s) { assert.equal(s.trim, false); assert.equal(s.sizeMode, Sprite.SizeMode.CUSTOM); }
        }
    });
    test('异步旧头像回调不得覆盖新图；销毁后不写资源', () => {
        const v = make(); const s = v.rows[0].avatar;
        deferred = true;
        v.setArt(s, 'avatar/old'); v.setArt(s, 'avatar/new');
        const [old, latest] = pending.splice(0); latest.done(frame(latest.p)); old.done(frame(old.p));
        assert.equal(s.spriteFrame.path, 'avatar/new');
        v.setArt(s, 'avatar/after'); const after = pending.shift(); v.root.destroy(); after.done(frame(after.p));
        assert.equal(s.spriteFrame, null); deferred = false;
    });
    test('单机重赛与返回大厅；联机只能返回保活房间；防止重复点击', () => {
        let restart = 0, menu = 0;
        const v = make({ onRestart: () => restart++, onMenu: () => menu++ });
        v.show(109, data()); v.primary.click(); v.primary.click(); assert.equal(restart, 1);
        v.show(109, data()); v.secondary.click(); assert.equal(menu, 1);
        v.show(109, data()); v.setRoomMode(true);
        assert.equal(v.primaryText.string, '返回房间'); assert.equal(v.secondary.active, false);
        v.activatePrimary(); v.primary.click(); assert.equal(menu, 2); assert.equal(restart, 1);
        v.setReward(642); assert.equal(v.reward.string, '+642');
        v.show(109, data()); assert.equal(v.reward.string, '+0');
        v.root.active = false; v.activatePrimary(); assert.equal(menu, 2);
    });
    test('空名单、长昵称、不同屏幕尺寸以及八人转一人保留稳定结构', () => {
        const v = make(); const count = nodes(v.root).length;
        v.show(109.45, data());
        size.width = 1280; size.height = 720;
        v.show(109.45, { placement: 1, leaderboard: [] });
        assert.equal(v.rows.filter(r => r.root.active).length, 1);
        assert.equal(nodes(v.root).length, count);
        assert.equal(v.root.scale.x, Math.min(1280 / 1672, 720 / 941));
        assert.equal(v.rows[0].name.weight, undefined);
        size.width = 1672; size.height = 941;
    });
    test('切图引用存在，未复制背景、头像、货币和按钮资源', () => {
        const { RESOURCE_PATHS: p } = load(path.join(root, 'assets/scripts/core/ResourcePaths.ts'));
        const paths = Object.values(p.settlementUi).flat();
        assert.equal(paths.length, 16);
        for (const resource of paths) {
            const file = path.join(root, 'assets/race', resource.replace('/texture', '.png'));
            assert.ok(fs.existsSync(file), resource); assert.ok(fs.existsSync(file + '.meta'), resource + '.meta');
        }
    });
    test('右侧遮罩位于 UI 下层且无点击拦截，英文数字与中文状态分别使用字体', () => {
        const v = make(); v.show(109.45, data(4));
        assert.equal(v.root.children[0].name, 'RightShade');
        assert.deepEqual(v.root.children[0].handlers, {});
        for (const name of ['HonorNumber', 'MyTime', 'SpeedValue', 'ModeDistance', 'RewardValue', 'RankNumber', 'FinishTime', 'TopWatermark']) {
            assert.equal(find(v.root, name).getComponent(Label).fontFamily, 'Arial Black');
        }
        assert.equal(find(v.root, 'ModeUnit').getComponent(Label).weight, 'semibold');
        v.show(0, data(4, false));
        assert.equal(v.rows[0].time.node.active, false);
        assert.equal(v.rows[0].status.node.active, true);
        assert.equal(v.rows[0].status.weight, 'semibold');
        size.width = 2000; size.height = 941; v.show(109, data());
        const shade = v.root.children[0], dimensions = shade.getComponent(UITransform).contentSize;
        assert.equal(shade.position.x + dimensions.width / 2, 1000);
        assert.equal(dimensions.height, 941);
        size.width = 1672;
    });
    test('返回大厅标记只消费一次，房间重连标记独立保留', () => {
        const options = load(path.join(root, 'assets/scripts/core/GameLaunchOptions.ts'));
        assert.equal(options.consumeReturnToLobby(), false);
        options.setReturnToLobby(true); options.setReturnToRoom(true);
        assert.equal(options.consumeReturnToLobby(), true);
        assert.equal(options.consumeReturnToLobby(), false);
        assert.equal(options.consumeReturnToRoom(), true);
        assert.equal(options.consumeReturnToRoom(), false);
    });
}
module.exports = { SettlementView, Node, Label, Sprite, UITransform, data, find, nodes, make };
