// 不启动 Creator；通过最小组件替身执行真实显示层与房间逻辑。
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
    throw new Error('请通过 pnpm test:room 运行固定版本 TypeScript 测试');
}
const ts = compiler();
class Color {
    constructor(r = 255, g = 255, b = 255, a = 255) { Object.assign(this, { r, g, b, a }); }
    equals(c) { return this.r === c.r && this.g === c.g && this.b === c.b && this.a === c.a; }
}
class Component { get isValid() { return this.node?.isValid; } }
class UITransform extends Component {
    contentSize = { width: 0, height: 0 };
    setContentSize(width, height) { this.contentSize = { width, height }; }
    convertToNodeSpaceAR(input, out) { const p = this.node.getWorldPosition({}); out.x = input.x - p.x; out.y = input.y - p.y; out.z = input.z - p.z; return out; }
}
class Label extends Component {
    static HorizontalAlign = { CENTER: 0, LEFT: 1, RIGHT: 2 }; static VerticalAlign = { CENTER: 0 };
    static Overflow = { SHRINK: 2 }; string = ''; color = new Color(); lineHeight = 40;
}
class Sprite extends Component { static SizeMode = { CUSTOM: 0 }; spriteFrame = null; }
class Button extends Component { static Transition = { NONE: 0 }; static EventType = { CLICK: 'click' }; interactable = true; }
class Graphics extends Component { roundRect() {} rect() {} fill() {} stroke() {} }
class Canvas extends Component {}
const visibleSize = { width: 1280, height: 720 };
let safeLeft = 0;
let safeRight = 0;
class Widget extends Component {
    static AlignMode = { ON_WINDOW_RESIZE: 2 };
    updateAlignment() {
        const size = this.target.getComponent(UITransform)?.contentSize ?? visibleSize;
        const own = this.node.getComponent(UITransform).contentSize;
        let parentX = 0, parentY = 0;
        for (let n = this.node.parent; n && n !== this.target; n = n.parent) {
            parentX += n.position.x; parentY += n.position.y;
        }
        const x = this.isAlignLeft ? -size.width / 2 + this.left + own.width / 2
            : size.width / 2 - this.right - own.width / 2;
        this.node.setPosition(x - parentX, (size.height - own.height) / 2 - this.top - parentY);
    }
}
class Node {
    static EventType = { TOUCH_END: 'touchend', NODE_DESTROYED: 'node-destroyed' };
    children = []; components = []; handlers = {}; active = true; isValid = true; layer = 1;
    position = { x: 0, y: 0, z: 0 }; scale = { x: 1, y: 1, z: 1 };
    constructor(name) { this.name = name; }
    setParent(p) { this.parent = p; p.children.push(this); }
    addComponent(C) { const c = new C(); c.node = this; this.components.push(c); return c; }
    getComponent(C) { return this.components.find(c => c instanceof C); }
    get activeInHierarchy() { return this.active && this.isValid && (!this.parent || this.parent.activeInHierarchy); }
    getWorldPosition(out) { out.x = this.position.x; out.y = this.position.y; out.z = this.position.z; for (let p = this.parent; p; p = p.parent) { out.x += p.position.x; out.y += p.position.y; out.z += p.position.z; } return out; }
    setPosition(x, y, z = 0) { this.position = { x, y, z }; }
    setScale(x, y, z = 1) { this.scale = { x, y, z }; }
    on(event, fn) { (this.handlers[event] ??= []).push(fn); }
    once(event, fn) { this.on(event, fn); }
    click() { if (this.getComponent(Button)?.interactable !== false) for (const fn of this.handlers.click ?? []) fn(); }
    destroy() { this.isValid = false; for (const c of this.children) c.destroy(); for (const fn of this.handlers['node-destroyed'] ?? []) fn(); }
}
const resizeListeners = new Map();
const cc = { Node, UITransform, Label, Sprite, Button, Graphics, Color, Canvas, Widget,
    Layers: { Enum: { UI_2D: 1 } }, view: { getVisibleSize: () => visibleSize,
        on: (event, fn) => { if (!resizeListeners.has(event)) resizeListeners.set(event, new Set()); resizeListeners.get(event).add(fn); },
        off: (event, fn) => resizeListeners.get(event)?.delete(fn) },
    sys: { getSafeAreaRect: () => ({ x: safeLeft, y: 0, width: visibleSize.width - safeLeft - safeRight, height: visibleSize.height }) } };
const net = { isSupported: () => false, setCallbacks: () => {}, broadcast: () => {}, updateReady: async () => {}, isOwner: () => true, getRoomInfo: async () => null, kickMember: async () => {}, leaveRoom: async () => {} };
const cache = {};
const stubs = {
    'cc': cc,
    'core/GameBalance': require('./helpers/cocos-math-harness.cjs').createHarness().load(path.join(root, 'assets/scripts/core/GameBalance.ts')),
    'ui/AvatarUiAssets': { avatarTexturePath: id => `avatar/${id}`, loadAvatarUiSpriteFrame: (p, done) => done({ path: p, isValid: true }) },
    'ui/ProjectUiFonts': { PROJECT_UI_ENGLISH_BOLD_FAMILY: 'Arial Black', styleProjectUiLabel: (label, weight, lineHeight) => { label.weight = weight; label.lineHeight = lineHeight; } },
    'backend/PlayerData': { PlayerData: { avatarId: 'coral', nickName: '小龟9460' } },
    'net/NetManager': { netRoom: () => net },
    'net/NetRaceSession': { setNetRaceSession: () => {} },
    'progression/RaceModifiers': { resolveLocalModifierDigest: () => ({ characterId: 'muscleMan', level: 2 }) },
    'platform/PlatformManager': { platform: () => ({ share: () => {} }) },
};
function load(file) {
    file = path.resolve(file);
    if (cache[file]) return cache[file].exports;
    const module = { exports: {} }; cache[file] = module;
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const requireLocal = id => {
        const resolved = id.startsWith('.') ? path.resolve(path.dirname(file), id).replaceAll('\\', '/') : id;
        for (const key of Object.keys(stubs)) if (id === key || resolved.endsWith('/' + key)) return stubs[key];
        return load(path.resolve(path.dirname(file), id + '.ts'));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(requireLocal, module, module.exports);
    return module.exports;
}
const { OnlineRoomView } = load(path.join(root, 'assets/scripts/ui/OnlineRoomView.ts'));
const { RoomFlow } = load(path.join(root, 'assets/scripts/ui/RoomFlow.ts'));
const { NET_RACE_PROTOCOL_VERSION } = load(path.join(root, 'assets/scripts/net/NetRaceProtocol.ts'));
function nodes(n) { return [n, ...n.children.flatMap(nodes)]; }
function find(n, name) { return nodes(n).find(n => n.name === name); }
const host = { pos: 0, self: false, owner: true, ready: true, avatarId: 'coral', nickName: '小龟9460', character: '肌肉男', level: 2 };
const guest = { ...host, pos: 2, self: true, owner: false, ready: false, nickName: '海风07', avatarId: 'lime' };
function state(overrides = {}) { return { members: [host, guest], isHost: false, ready: false, busy: false, canStart: false, roomNumber: '826419', hint: '', mode: 'competitive', ...overrides }; }
test('宽屏侧栏避让安全区，标题、箭头和点击区域随三角装饰整体适配', () => {
    const { makeScreenEdgeGroup } = load(path.join(root, 'assets/scripts/ui/RuntimeUiFactory.ts'));
    const worldX = n => n.position.x + (n.parent ? worldX(n.parent) : 0);
    for (const width of [1280, 1560, 1600]) {
        visibleSize.width = width;
        safeLeft = width === 1280 ? 0 : 40;
        const canvas = new Node('Canvas'); canvas.addComponent(Canvas);
        canvas.addComponent(UITransform).setContentSize(1280, 720);
        const left = makeScreenEdgeGroup('Left', canvas, 'left');
        const right = makeScreenEdgeGroup('Right', canvas, 'right');
        assert.equal(worldX(left) - 640 + width / 2, width === 1280 ? 0 : 40);
        assert.equal(width / 2 - worldX(right) - 640, width === 1280 ? 0 : 24);
        const v = new OnlineRoomView(canvas, { exit() {}, primary() {}, invite() {}, mode() {}, kick() {} });
        const art = find(v.root, 'CharacterHeader');
        assert.equal(worldX(art) - 497 / 2, -width / 2);
        const back = find(v.root, 'Back');
        const arrow = find(v.root, 'BackIcon');
        const title = find(v.root, 'Title');
        assert.equal(worldX(back) - 90 / 2 + width / 2, 16);
        assert.equal(worldX(arrow) - 61 / 2 + width / 2, 27);
        assert.equal(worldX(title) - 140 / 2 + width / 2, 104);
        assert.equal(back.parent, art.parent);
        assert.equal(arrow.parent, art.parent);
        assert.equal(title.parent, art.parent);
        const bg = find(v.root, 'Background');
        assert.ok(bg.scale.x * bg.getComponent(UITransform).contentSize.width >= width);
        canvas.destroy();
        assert.equal(resizeListeners.get('canvas-resize').size, 0);
    }
    visibleSize.width = 1280; safeLeft = 0;
});

test('双侧与单侧安全区均不叠加视觉边距，窗口变化后重新计算且不重建', () => {
    const { makeScreenEdgeGroup } = load(path.join(root, 'assets/scripts/ui/RuntimeUiFactory.ts'));
    const canvas = new Node('Canvas'); canvas.addComponent(Canvas);
    canvas.addComponent(UITransform).setContentSize(1280, 720);
    visibleSize.width = 1600;
    const left = makeScreenEdgeGroup('Left', canvas, 'left', 1280, 720, 24);
    const right = makeScreenEdgeGroup('Right', canvas, 'right', 1280, 720, 36);
    const count = nodes(canvas).length;
    const cases = [
        { width: 1600, left: 0, right: 0, expectedLeft: 24, expectedRight: 36 },
        { width: 1600, left: 72, right: 0, expectedLeft: 72, expectedRight: 36 },
        { width: 1560, left: 82, right: 82, expectedLeft: 82, expectedRight: 82 },
        { width: 1560, left: 0, right: 82, expectedLeft: 24, expectedRight: 82 },
        { width: 1560, left: 10, right: 12, expectedLeft: 24, expectedRight: 36 },
        { width: 1280, left: 0, right: 0, expectedLeft: 0, expectedRight: 0 },
    ];
    for (const scenario of cases) {
        visibleSize.width = scenario.width; safeLeft = scenario.left; safeRight = scenario.right;
        for (const fn of resizeListeners.get('canvas-resize')) fn();
        assert.equal(left.position.x - 640 + visibleSize.width / 2, scenario.expectedLeft);
        assert.equal(visibleSize.width / 2 - right.position.x - 640, scenario.expectedRight);
        assert.equal(nodes(canvas).length, count);
    }
    canvas.destroy();
    assert.equal(resizeListeners.get('canvas-resize').size, 0);
    visibleSize.width = 1280; safeLeft = 0; safeRight = 0;
});

test('真实大厅及角色页面组装：两侧均增加灵动岛间距，横屏翻转不改变留白', () => {
    const { makeScreenEdgeGroup } = load(path.join(root, 'assets/scripts/ui/RuntimeUiFactory.ts'));
    const file = path.join(root, 'assets/scripts/ui/PrepareRaceFlow.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const flowClass = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'PrepareRaceFlow');
    // 执行生产代码的两个布局入口，仅替换与布局无关的资源及角色构建。
    const methods = flowClass.members.filter(n => ['buildReadyScreen', 'buildCharacterManagement'].includes(n.name?.getText(source)));
    assert.equal(methods.length, 2);
    const code = ts.transpileModule(`class LayoutHarness { ${methods.map(n => n.getText(source)).join('\n')} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const Harness = vm.runInNewContext(`${code}; LayoutHarness`, { makeScreenEdgeGroup });
    const safeApi = cc.sys.getSafeAreaRect;
    cc.sys.getSafeAreaRect = () => { throw new Error('页面整栏布局不应读取设备安全区'); };
    try {
        for (const width of [1280, 1600, 2532 / 1170 * 720]) {
            visibleSize.width = width;
            const canvas = new Node('Canvas'); canvas.addComponent(Canvas);
            canvas.addComponent(UITransform).setContentSize(1280, 720);
            const flow = new Harness(); flow._width = 1280; flow._height = 720;
            const owners = {};
            for (const name of ['buildReadyCharacterPanel', 'buildPreviewPresentation', 'buildRaceModeList', 'buildReadyActions',
                'buildCharacterHeader', 'buildCharacterRoster', 'buildCharacterInspector']) {
                flow[name] = parent => { owners[name] = parent; };
            }
            for (const name of ['refreshReadyCharacterInfo', 'refreshCharacterCards', 'refreshCharacterInspector', 'selectInspectorTab']) flow[name] = () => {};
            flow.buildReadyScreen(canvas);
            flow.buildCharacterManagement(canvas);
            const leftMargin = node => node.position.x - 640 + width / 2;
            const rightMargin = node => width / 2 - node.position.x - 640;
            const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
            near(leftMargin(owners.buildReadyCharacterPanel), width === 1280 ? 0 : 48);
            near(rightMargin(owners.buildRaceModeList), width === 1280 ? 0 : 48);
            assert.equal(owners.buildRaceModeList, owners.buildReadyActions);
            near(leftMargin(owners.buildCharacterRoster), width === 1280 ? 0 : 48);
            near(rightMargin(owners.buildCharacterInspector), width === 1280 ? 0 : 60);
            near(leftMargin(owners.buildCharacterHeader), 0);
            assert.equal(owners.buildPreviewPresentation, canvas);
            const groups = [owners.buildReadyCharacterPanel, owners.buildRaceModeList,
                owners.buildCharacterRoster, owners.buildCharacterInspector];
            const positions = groups.map(node => node.position.x);
            const count = nodes(canvas).length;
            for (const [leftInset, rightInset] of [[82, 0], [0, 82], [82, 0]]) {
                safeLeft = leftInset; safeRight = rightInset;
                for (const fn of resizeListeners.get('canvas-resize')) fn();
                groups.forEach((node, i) => near(node.position.x, positions[i]));
                assert.equal(nodes(canvas).length, count);
            }
            canvas.destroy();
        }
    } finally {
        cc.sys.getSafeAreaRect = safeApi;
        visibleSize.width = 1280;
        safeLeft = 0; safeRight = 0;
    }
});

test('字体不使用有限字符图集，晚到字体不覆盖新字重或动态昵称', () => {
    const pendingFonts = [];
    cc.CacheMode = { NONE: 0, CHAR: 2 };
    cc.Font = class Font {};
    stubs['core/RaceBundleLoader'] = { loadRaceAsset: (p, type, done) => pendingFonts.push({ p, done }) };
    const { styleProjectUiLabel, styleDynamicUiLabel } = load(path.join(root, 'assets/scripts/ui/ProjectUiFonts.ts'));
    const label = new Node('Title').addComponent(Label);
    const nickname = new Node('Nickname').addComponent(Label);
    const destroyed = new Node('ClosedPanel').addComponent(Label);
    styleProjectUiLabel(label, 'regular', 28);
    styleProjectUiLabel(label, 'semibold', 28);
    styleProjectUiLabel(nickname, 'regular', 28);
    styleDynamicUiLabel(nickname, 28);
    nickname.string = '𠮷昕';
    styleProjectUiLabel(destroyed, 'regular', 28);
    destroyed.node.destroy();
    assert.equal(pendingFonts.length, 2);
    const regular = new cc.Font(), bold = new cc.Font();
    pendingFonts[1].done(null, bold);
    pendingFonts[0].done(null, regular);
    assert.equal(label.font, bold);
    assert.equal(label.cacheMode, cc.CacheMode.NONE);
    assert.equal(nickname.font, undefined);
    assert.equal(nickname.useSystemFont, true);
    assert.equal(nickname.string, '𠮷昕');
    assert.equal(destroyed.font, undefined);
    for (let i = 0; i < 200; i++) {
        const next = new Node('ReopenedTitle').addComponent(Label);
        styleProjectUiLabel(next, 'semibold', 38);
        assert.equal(next.font, bold);
        assert.equal(next.cacheMode, cc.CacheMode.NONE);
        next.node.destroy();
    }
    assert.equal(pendingFonts.length, 2);
    delete stubs['core/RaceBundleLoader'];
});

function flow(isHost = false) {
    const f = new RoomFlow(new Node('root'), 1280, 720, { onExit() {}, onStartLocalRace() {}, onStartNetRace() {} });
    f._isHost = isHost; f._localPos = isHost ? 0 : 2; f._netReal = true;
    f._members = [{ ...host, self: isHost }, { ...guest, self: !isHost }];
    f._accessInfo = 'test-room'; f._rulesId = '1800000000000'; f._rulesRevision = 1; f._rulesOwnerPos = 0;
    f._memberProtocolVersions[0] = NET_RACE_PROTOCOL_VERSION; f._memberProtocolVersions[2] = NET_RACE_PROTOCOL_VERSION;
    return f;
}
test('八个座位稳定，空座位不挤占，重复准备切换不新增节点和监听', () => {
    const v = new OnlineRoomView(new Node('root'), { exit() {}, primary() {}, invite() {}, mode() {}, kick() {} });
    v.update(state()); const count = nodes(v.root).length;
    const listeners = () => nodes(v.root).reduce((s, n) => s + Object.values(n.handlers).flat().length, 0);
    const bound = listeners();
    for (let i = 0; i < 200; i++) v.update(state({ ready: i % 2 === 0, members: [host, { ...guest, ready: i % 2 === 0 }] }));
    assert.equal(nodes(v.root).length, count); assert.equal(listeners(), bound);
    assert.equal(v.cards.length, 8); assert.equal(v.cards[1].member, undefined); assert.equal(v.cards[2].member.pos, 2);
    v.update(state({ ready: true }));
    assert.equal(v.primaryText.string, '取消准备'); assert.match(v.primaryArt.spriteFrame.path, /cancel-ready/);
    v.update(state()); assert.equal(v.primaryText.string, '准备'); assert.match(v.primaryArt.spriteFrame.path, /start-button/);
});
test('只保留左上返回退出房间，底部不残留退出按钮与点击区域', () => {
    let exits = 0;
    const v = new OnlineRoomView(new Node('root'), { exit() { exits++; }, primary() {}, invite() {}, mode() {}, kick() {} });
    for (const isHost of [true, false]) {
        v.update(state({ isHost }));
        for (const name of ['ExitBackground', 'ExitText', 'ExitHit']) assert.equal(find(v.root, name), undefined);
        find(v.root, 'Back').click();
    }
    assert.equal(exits, 2);
    assert.deepEqual(find(v.root, 'PrimaryHit').position, { x: 448, y: -296, z: 0 });
});
test('房主与成员权限不同，踢人需要两次确认且不能踢自己', () => {
    let kicked = 0, mode = 0;
    const v = new OnlineRoomView(new Node('root'), { exit() {}, primary() {}, invite() {}, mode() { mode++; }, kick() { kicked++; } });
    v.update(state()); find(v.root, 'ModeHit').click(); assert.equal(v.drawer.active, false);
    find(v.root, 'SeatHit0').click(); assert.equal(v.kick.active, false);
    v.update(state({ isHost: true, members: [{ ...host, self: true }, { ...guest, self: false }] }));
    find(v.root, 'ModeHit').click(); assert.equal(v.drawer.active, true);
    find(v.root, 'ChooseMode0').click(); assert.equal(mode, 1);
    find(v.root, 'SeatHit2').click(); assert.equal(v.kick.active, true);
    find(v.root, 'KickHit').click(); assert.equal(kicked, 0);
    find(v.root, 'KickHit').click(); assert.equal(kicked, 1);
    find(v.root, 'SeatHit0').click(); assert.equal(v.kick.active, false);
});
test('字体：中文资源与英文数字分开，动态姓名保留完整字形回退', () => {
    const v = new OnlineRoomView(new Node('root'), { exit() {}, primary() {}, invite() {}, mode() {}, kick() {} });
    for (const n of nodes(v.root)) {
        const l = n.getComponent(Label); if (!l) continue;
        if (/^(HostName|Nickname|PopupName|HostLevel|RoomNumber$|MemberCount|SeatNumber|Distance$|ModeDistance|CloseText)/.test(n.name)) {
            assert.equal(l.weight, undefined); assert.equal(l.fontFamily, 'Arial Black', n.name);
        }
        else assert.equal(l.weight, /^Invite\d$/.test(n.name) ? 'regular' : 'semibold', n.name);
        assert.equal(l.lineHeight, l.fontSize + 4, n.name);
        assert.ok(l.lineHeight <= n.getComponent(UITransform).contentSize.height, `${n.name} 行高不能触发纵向缩字`);
    }
});
test('空位邀请文案用常规字重，上拉标记为小实心三角且保留整行点击区域', () => {
    const v = new OnlineRoomView(new Node('root'), { exit() {}, primary() {}, invite() {}, mode() {}, kick() {} });
    for (let i = 0; i < 8; i++) {
        const label = find(v.root, `Invite${i}`).getComponent(Label);
        assert.equal(label.weight, 'regular'); assert.equal(label.fontSize, 19);
    }
    const arrow = find(v.root, 'Expand').getComponent(Label);
    assert.equal(arrow.string, '▲'); assert.equal(arrow.fontSize, 14);
    assert.equal(find(v.root, 'ModeHit').getComponent(UITransform).contentSize.width, 320);
    v.update(state({ isHost: true })); find(v.root, 'ModeHit').click();
    assert.equal(v.drawer.active, true); assert.equal(arrow.node.active, true);
    v.update(state({ isHost: false })); assert.equal(arrow.node.active, false);
});
test('PS 文字色与对齐：辅助蓝灰、等级蓝、人数青绿、提示位于主按钮上方', () => {
    const v = new OnlineRoomView(new Node('root'), { exit() {}, primary() {}, invite() {}, mode() {}, kick() {} });
    v.update(state());
    const label = name => find(v.root, name).getComponent(Label);
    for (const name of ['HostCharacter', 'RoomNumberHeading', 'RulesHeading', 'RulesPermission', 'InviteHint', 'Character0'])
        assert.ok(label(name).color.equals(new Color(73, 100, 140)), name);
    assert.ok(label('HostLevel').color.equals(new Color(19, 66, 151)));
    assert.ok(label('MemberCount').color.equals(new Color(0, 179, 149)));
    assert.equal(label('Mode').horizontalAlign, Label.HorizontalAlign.LEFT);
    assert.equal(label('RulesPermission').horizontalAlign, Label.HorizontalAlign.RIGHT);
    assert.equal(label('InviteHint').horizontalAlign, Label.HorizontalAlign.RIGHT);
    assert.equal(find(v.root, 'RoomHint').position.x, 448);
    assert.equal(label('Nickname0').fontSize, 19);
    assert.equal(label('Nickname0').lineHeight, 23);
});
test('本地预览与真实房号切换不替换字体或重建，赛制数字与米字分层', () => {
    const v = new OnlineRoomView(new Node('root'), { exit() {}, primary() {}, invite() {}, mode() {}, kick() {} });
    const count = nodes(v.root).length;
    v.update(state());
    assert.equal(v.roomNumber.string, '826 419'); assert.equal(v.roomNumberLocal.node.active, false);
    v.update(state({ roomNumber: '本地预览' }));
    assert.equal(v.roomNumber.node.active, false); assert.equal(v.roomNumberLocal.string, '本地预览');
    v.update(state()); assert.equal(v.roomNumber.node.active, true);
    assert.equal(nodes(v.root).length, count);
    assert.equal(find(v.root, 'Distance').getComponent(Label).string, '200');
    assert.equal(find(v.root, 'DistanceUnit').getComponent(Label).string, '米');
    assert.equal(find(v.root, 'ModeCheck1').active, true); assert.equal(find(v.root, 'ModeCheck0').active, false);
    assert.ok(find(v.root, 'ModeDistance1').getComponent(Label).color.equals(new Color(0, 179, 149)));
    assert.deepEqual([0, 1, 2].map(i => find(v.root, `ModeDistance${i}`).getComponent(Label).string), ['200', '200', '400']);
    for (const mode of ['championship', 'beginner', 'competitive', 'championship']) {
        v.update(state({ mode }));
        assert.equal(find(v.root, 'Distance').getComponent(Label).string, mode === 'championship' ? '400' : '200');
        assert.equal(nodes(v.root).length, count, '切换距离不得重建房间');
    }

});
test('准备失败保留原状态，重试成功后主按钮才切换', async () => {
    const f = flow(); net.updateReady = async () => { throw new Error('offline'); };
    await f.setReady(true); assert.equal(f._localReady, false); assert.match(f._statusHint, /失败/);
    net.updateReady = async () => {}; await f.setReady(true);
    assert.equal(f._localReady, true); assert.equal(f._view.primaryText.string, '取消准备'); f.dispose();
});
test('赛制改变使旧准备失效，旧版本及乱序 ACK 不能恢复准备', async () => {
    const h = flow(true); h._members[1].ready = true;
    const key = h.ruleKey();
    h.handleRules({ t: 'rulesReady', pos: 2, key, seq: 5, ready: true }); assert.equal(h.allMembersReady(), true);
    h.handleRules({ t: 'rulesReady', pos: 2, key, seq: 6, ready: false });
    h.handleRules({ t: 'rulesReady', pos: 2, key, seq: 5, ready: true }); assert.equal(h.allMembersReady(), false);
    h.changeMode('beginner'); h.handleRules({ t: 'rulesReady', pos: 2, key, seq: 7, ready: true }); assert.equal(h.allMembersReady(), false);
    const g = flow(); g._localReady = true;
    g.handleRules({ t: 'rules', owner: 0, id: h._rulesId, rev: h._rulesRevision, mode: 'beginner' });
    await Promise.resolve(); assert.equal(g._localReady, false); assert.equal(g._mode, 'beginner');
    g.handleRules({ t: 'rules', owner: 0, id: h._rulesId, rev: 0, mode: 'championship' }); assert.equal(g._mode, 'beginner');
    h.dispose(); g.dispose();
});
test('准备请求途中赛制改变，不接受旧请求的成功回调', async () => {
    const g = flow(); let resolve;
    net.updateReady = () => new Promise(r => { resolve = r; });
    const pending = g.setReady(true);
    g.handleRules({ t: 'rules', owner: 0, id: g._rulesId, rev: 2, mode: 'beginner' });
    net.updateReady = async () => {}; resolve(); await pending;
    assert.equal(g._localReady, false); assert.equal(g._localReadyRule, ''); g.dispose();
});
test('踢人前复查成员身份，座位换人不能误踢', async () => {
    const h = flow(true); let kicked = 0; net.kickMember = async () => { kicked++; };
    net.getRoomInfo = async () => ({ members: [{ pos: 2, extInfo: 'rose|新人', owner: false }] });
    await h.kickMember({ ...guest, self: false }); assert.equal(kicked, 0);
    net.getRoomInfo = async () => ({ members: [{ pos: 2, extInfo: 'lime|海风07', owner: false }] });
    h.refreshRoomInfo = () => {}; await h.kickMember({ ...guest, self: false }); assert.equal(kicked, 1); h.dispose();
});
test('资源都在分包，返回、背景、绿色主按钮保持原资源引用', () => {
    const { RESOURCE_PATHS: p } = load(path.join(root, 'assets/scripts/core/ResourcePaths.ts'));
    for (const value of Object.values(p.onlineRoomUi)) {
        const file = path.join(root, 'assets/race', value.replace('/texture', '.png'));
        assert.ok(fs.existsSync(file), file);
        const bytes = fs.readFileSync(file); assert.equal(bytes[25], 6, '必须是 RGBA');
    }
    const v = new OnlineRoomView(new Node('root'), { exit() {}, primary() {}, invite() {}, mode() {}, kick() {} });
    assert.equal(find(v.root, 'Background').getComponent(Sprite).spriteFrame.path, p.characterUi.background);
    assert.equal(find(v.root, 'BackIcon').getComponent(Sprite).spriteFrame.path, p.characterUi.backIcon);
    assert.equal(v.primaryArt.spriteFrame.path, p.lobbyUi.startButton);
});

module.exports = { OnlineRoomView, Node, Label, Sprite, nodes, state, host, guest };

function navigationHarness() {
    const file = path.join(root, 'assets/scripts/app/LoginManager.ts');
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(s => ts.isClassDeclaration(s) && s.name.text === 'LoginManager');
    const names = ['openPrepareRace', 'openRoom', 'exitRoom', 'buildLoginScreen'];
    const methods = cls.members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast)).join('\n');
    const code = ts.transpileModule(`class Navigation { ${methods} } exports.Navigation = Navigation;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    let loaded, roomMode = true, opened = 0;
    const context = { exports: {}, console,
        getUILayer: n => n, UILayer: { Screen: 1 }, setRoomMode: value => { roomMode = value; },
        PrepareRaceFlow: class { showReadyScreen() { opened++; } },
        RoomFlow: class { dispose() {} },
        SpeedStarsStartUiPrefabBuilder: class { build(_p, _w, _h, cb) { loaded = cb; } },
    };
    vm.runInNewContext(code, context);
    const manager = new context.exports.Navigation();
    manager._canvasNode = new Node('Canvas'); manager._canvasNode.getChildByName = () => null;
    manager._designWidth = 1280; manager._designHeight = 720;
    return { manager, loaded: root => loaded(null, { root }), opened: () => opened, roomMode: () => roomMode };
}
test('联机返回进入大厅，不回到登录开始页，并清理房间模式', () => {
    const h = navigationHarness(), m = h.manager; let disposed = 0;
    m._loginUiRoot = new Node('Login'); m._loginUiRoot.active = false;
    m._roomFlow = { dispose() { disposed++; } };
    m.exitRoom();
    assert.equal(disposed, 1); assert.equal(m._roomFlow, null);
    assert.equal(h.opened(), 1); assert.equal(m._loginUiRoot.active, false); assert.equal(h.roomMode(), false);
});
test('分享直达房间也能返回大厅，迟到的登录资源不能盖住大厅', () => {
    const h = navigationHarness(), m = h.manager;
    m.buildLoginScreen(m._canvasNode, 1280, 720);
    m._roomFlow = { dispose() {} }; m.exitRoom();
    assert.equal(h.opened(), 1);
    const lateLogin = new Node('LateLogin'); h.loaded(lateLogin);
    assert.equal(lateLogin.active, false); assert.equal(h.opened(), 1);
});
test('从角色详情接收邀请，返回时也进入大厅而非残留角色页', () => {
    const h = navigationHarness(), m = h.manager; let disposed = 0;
    m._prepareRaceFlow = { dispose() { disposed++; } };
    m.openRoom('friend-room');
    assert.equal(disposed, 1); assert.equal(m._prepareRaceFlow, null);
    m.exitRoom(); assert.equal(h.opened(), 1);
});

test('房主迁移后平台权限随客户端标识更新，踢人传正式座位参数', async () => {
    const { WechatGameRoom } = load(path.join(root, 'assets/scripts/net/WechatGameRoom.ts'));
    const room = new WechatGameRoom(); let kicked;
    room._gsm = { kickoutMember: options => { kicked = options.kickoutPos; options.success(); } };
    room._accessInfo = 'room'; room._localClientId = 42; room._localExtInfo = 'coral|房主';
    room.adoptRoomOwnership({ members: [{ clientId: 42, pos: 3, owner: true, extInfo: 'coral|房主' }] });
    assert.equal(room.isOwner(), true); await room.kickMember(2); assert.equal(kicked, 2);
    room.adoptRoomOwnership({ members: [{ clientId: 42, pos: 3, owner: false }] });
    await assert.rejects(room.kickMember(2));
});
test('退出请求失败不清掉房间，重试成功后才清理', async () => {
    const { WechatGameRoom } = load(path.join(root, 'assets/scripts/net/WechatGameRoom.ts'));
    const room = new WechatGameRoom(); room._accessInfo = 'room'; room._isOwner = true;
    room._gsm = { ownerLeaveRoom: options => options.fail(new Error('offline')) };
    await assert.rejects(room.leaveRoom()); assert.equal(room.currentAccessInfo(), 'room'); assert.equal(room.isOwner(), true);
    room._gsm.ownerLeaveRoom = options => { assert.equal(options.assignToMinPosNum, true); options.success(); };
    await room.leaveRoom(); assert.equal(room.currentAccessInfo(), ''); assert.equal(room.isOwner(), false);
});
test('缺少平台准备接口不得静默报告成功', async () => {
    const { WechatGameRoom } = load(path.join(root, 'assets/scripts/net/WechatGameRoom.ts'));
    const room = new WechatGameRoom(); room._gsm = {};
    await assert.rejects(room.updateReady(true));
});

function attributeTipsHarness() {
    const overlay = new Node('PopupLayer');
    const identityCamera = {
        worldToScreen(p, out) { Object.assign(out, p); return out; },
        screenToWorld(p, out) { Object.assign(out, p); return out; },
    };
    overlay.addComponent(Canvas).cameraComponent = identityCamera;
    const pending = [];
    const factory = load(path.join(root, 'assets/scripts/ui/RuntimeUiFactory.ts'));
    const resources = load(path.join(root, 'assets/scripts/core/ResourcePaths.ts'));
    const file = path.join(root, 'assets/scripts/ui/CharacterAttributeTips.ts');
    const imports = {
        cc: { ...cc, Vec3: class { x = 0; y = 0; z = 0; } },
        '../core/ResourcePaths': resources,
        './RuntimeUiFactory': factory,
        './UILayers': { UILayer: { Popup: 3 }, getUILayer: () => overlay },
        './ProjectUiFonts': stubs['ui/ProjectUiFonts'],
        './AvatarUiAssets': { loadAvatarUiSpriteFrame: (path, done) => pending.push({ path, done }) },
    };
    const m = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
        { module: m, exports: m.exports, require: id => imports[id] });
    return { ...m.exports, overlay, pending, factory, resources, identityCamera };
}

test('属性tips复用联机资源，开关不新增节点或监听，关闭阻断及迟到资源释放正确', () => {
    const h = attributeTipsHarness(), canvas = new Node('canvas');
    canvas.addComponent(Canvas).cameraComponent = h.identityCamera;
    const anchor = h.factory.makeTouchArea('StatRow', canvas, 284, 42);
    const before = resizeListeners.get('canvas-resize')?.size ?? 0;
    const tips = new h.CharacterAttributeTips(canvas);
    assert.equal(h.pending[0].path, h.resources.RESOURCE_PATHS.onlineRoomUi.popup);
    assert.equal(tips.root.active, false);
    const count = nodes(tips.root).length;
    const panel = find(tips.root, 'AttributeTipsPanel');
    assert.ok(panel.getComponent(Button), '面板必须消费触摸，阻止点击穿透');
    for (const width of [1280, 1600, 2532 / 1170 * 720]) {
        visibleSize.width = width;
        for (const x of [-width / 2 + 20, width / 2 - 20]) {
            anchor.setPosition(x, 80);
            for (let i = 0; i < 30; i++) {
                tips.show(i % 3, anchor);
                const info = h.CHARACTER_ATTRIBUTE_TIPS[i % 3];
                assert.equal(find(tips.root, 'AttributeTipsTitle').getComponent(Label).string, info.title);
                assert.equal(find(tips.root, 'AttributeTipsSummary').getComponent(Label).string, info.summary);
                assert.equal(find(tips.root, 'AttributeTipsDetail').getComponent(Label).string, info.detail);
                assert.equal(tips.root.active, true);
                assert.ok(Math.abs(panel.position.x) + 208 <= width / 2 - 16);
                assert.ok(Math.abs(panel.position.y) + 132 <= 360 - 16);
                panel.click(); assert.equal(tips.root.active, true);
                find(tips.root, i % 2 ? 'CloseAttributeTips' : 'DismissAttributeTips').click();
                assert.equal(tips.root.active, false);
                assert.equal(nodes(tips.root).length, count);
                assert.equal(h.pending.length, 1);
            }
        }
    }
    anchor.active = false; tips.show(0, anchor); assert.equal(tips.root.active, false);
    anchor.active = true; tips.show(0, anchor);
    for (const fn of resizeListeners.get('canvas-resize')) fn();
    assert.equal(tips.root.active, false);
    tips.dispose(); tips.dispose();
    h.pending[0].done({ isValid: true });
    assert.equal(panel.getComponent(Sprite).spriteFrame, null, '销毁后晚到资源不回写');
    assert.equal(resizeListeners.get('canvas-resize').size, before);
    visibleSize.width = 1280;
});

test('主界面和角色页三行真实绑定同一tips，点击不升级或重建预览，离开时拒绝新弹框', () => {
    const h = attributeTipsHarness();
    const file = path.join(root, 'assets/scripts/ui/PrepareRaceFlow.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'PrepareRaceFlow');
    const methods = cls.members.filter(n => ['buildReadyCharacterPanel', 'buildAttributeContent', 'bindAttributeTip'].includes(n.name?.getText(source)));
    assert.equal(methods.length, 3);
    const makeArt = (name, parent, ...args) => h.factory.makeUiNode(name, parent);
    const makeBoundLabel = (name, parent, text, size, color, w, height, x, y) => {
        const node = h.factory.makeLabel(name, parent, text, size, color); node.setPosition(x, y);
        node.getComponent(UITransform).setContentSize(w, height); return node.getComponent(Label);
    };
    const Harness = vm.runInNewContext(ts.transpileModule(`class Harness { ${methods.map(n => n.getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText + '; Harness', {
        ...cc, ...h.factory, ...h.resources, CharacterAttributeTips: h.CharacterAttributeTips,
        Rect: class {}, WHITE: new Color(), DARK_TEXT: new Color(),
        stylePsdTitleLabel() {}, stylePsdRuntimeLabel() {}, makeBoundLabel,
        makeRaceTextureSprite: makeArt, makeRaceTextureRegionSprite: makeArt,
        makeRaceTextureButton: (name, parent) => h.factory.makeTouchArea(name, parent, 100, 50),
    });
    const f = new Harness();
    Object.assign(f, { _motion: { group: p => p, bindButton() {} }, _readyStats: [], _inspectorCurrentStats: [], _inspectorNextStats: [], _canvasNode: new Node('canvas') });
    const ready = new Node('Ready'), attributes = new Node('Attributes');
    ready.addComponent(Canvas).cameraComponent = h.identityCamera;
    attributes.addComponent(Canvas).cameraComponent = h.identityCamera;
    f.buildReadyCharacterPanel(ready); f.buildAttributeContent(attributes);
    for (const parent of [ready, attributes]) {
        const count = nodes(parent).length;
        for (let i = 0; i < 3; i++) {
            const hit = find(parent, `AttributeTipHit${i}`);
            assert.ok(hit.getComponent(UITransform).contentSize.width >= 284);
            assert.equal(hit.handlers.click.length, 1);
            hit.click(); assert.equal(find(f._attributeTips.root, 'AttributeTipsTitle').getComponent(Label).string, h.CHARACTER_ATTRIBUTE_TIPS[i].title);
            f._attributeTips.hide(); assert.equal(nodes(parent).length, count);
        }
    }
    assert.equal(h.pending.length, 1, '两个页面只创建一个tips实例');
    f._leaving = true; find(ready, 'AttributeTipHit0').click(); assert.equal(f._attributeTips.root.active, false);
    f._attributeTips.dispose();
});


test('属性tips跨相机投影：主画布原点和覆盖层原点不同，弹框仍贴着左右属性行', () => {
    const h = attributeTipsHarness();
    const canvas = new Node('MainCanvas');
    const anchor = h.factory.makeTouchArea('AttributeRow', canvas, 284, 42);
    let sourceCalls = 0, popupCalls = 0;
    // 模拟主 UI 相机在(640,360)，覆盖层相机在原点；屏幕投影还包含缩放和偏移。
    canvas.addComponent(Canvas).cameraComponent = {
        worldToScreen(p, out) {
            sourceCalls++;
            out.x = (p.x - canvas.position.x) * 0.8 + 512;
            out.y = (p.y - canvas.position.y) * 0.8 + 288;
            out.z = 0.5; return out;
        },
    };
    h.overlay.getComponent(Canvas).cameraComponent = {
        screenToWorld(p, out) {
            popupCalls++;
            out.x = (p.x - 512) / 0.8 + h.overlay.position.x;
            out.y = (p.y - 288) / 0.8 + h.overlay.position.y;
            out.z = 0; return out;
        },
    };
    const tips = new h.CharacterAttributeTips(canvas);
    try {
        for (const width of [1280, 1600, 2532 / 1170 * 720]) {
            visibleSize.width = width;
            for (const [mainX, mainY, popupX, popupY] of [[640, 360, 0, 0], [960, 540, -120, 80]]) {
                canvas.setPosition(mainX, mainY); h.overlay.setPosition(popupX, popupY);
                for (const [x, y] of [[-446, 107], [-446, 62], [-446, 17], [447, 107.5], [447, 63.5], [447, 18]]) {
                    anchor.setPosition(x, y, 4); tips.show(1, anchor);
                    const panel = find(tips.root, 'AttributeTipsPanel');
                    const limit = width / 2 - 208 - 16;
                    assert.ok(Math.abs(panel.position.x - Math.max(-limit, Math.min(limit, x + 44))) < 1e-6);
                    assert.ok(Math.abs(panel.position.y - (y - 154)) < 1e-6, '弹框顶部必须落在所点行下方');
                }
            }
        }
        assert.equal(sourceCalls, 36); assert.equal(popupCalls, sourceCalls);
        canvas.getComponent(Canvas).cameraComponent = null;
        tips.show(0, anchor); assert.equal(tips.root.active, false, '缺少渲染相机不回退到错误的世界坐标');
    } finally { tips.dispose(); visibleSize.width = 1280; }
});
