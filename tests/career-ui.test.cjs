const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
class Component {}
class UIOpacity extends Component { opacity = 255; }
class Scale { constructor(x=1,y=1,z=1){this.set(x,y,z);} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} clone(){return new Scale(this.x,this.y,this.z);} }
class UITransform extends Component { setAnchorPoint(x,y){this.anchorPoint={x,y};} setContentSize(width, height) { this.contentSize = { width, height }; } }
class Label extends Component { static HorizontalAlign = {LEFT: 0, CENTER: 1, RIGHT: 2}; static Overflow = { SHRINK: 1 }; string = ''; }
class Button extends Component { static EventType = { CLICK: 'click' }; interactable = true; }
class BlockInputEvents extends Component {}
class Mask extends Component {static Type={GRAPHICS_RECT:1};}
class ScrollView extends Component {enabled=true;stopAutoScroll(){} scrollToOffset(offset,duration){this.offset=offset;this.duration=duration;const h=this.content.getComponent(UITransform).contentSize.height;this.content.setPosition(0,(490-h)/2+offset.y,0);}}

class Node {
    static EventType = { NODE_DESTROYED: 'destroy' };
    children = []; components = []; handlers = {}; active = true; isValid = true;
    constructor(name) { this.name = name; this.position = {x:0,y:0,z:0}; this.scale = new Scale(); }
    setScale(x,y,z) { this.scale = new Scale(x,y,z); }
    setPosition(x, y, z) { this.position = { x, y, z }; }
    setParent(parent) { this.parent = parent; parent.children.push(this); }
    addComponent(C) { const c = new C(); c.node = this; this.components.push(c); return c; }
    getComponent(C) { return this.components.find(c => c instanceof C); }
    getChildByName(name) { return this.children.find(c => c.name === name); }
    on(e, f) { (this.handlers[e] ??= []).push(f); }
    once(e, f) { this.on(e, f); }
    click() { if (this.active && this.getComponent(Button)?.interactable) for (const f of this.handlers.click ?? []) f(); }
    destroy() { this.isValid = false; for (const f of this.handlers.destroy ?? []) f(); for (const child of [...this.children]) if (child.isValid) child.destroy(); if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
}
const node = (name, parent) => { const n = new Node(name); n.setParent(parent); n.addComponent(UITransform); return n; };
const factory = {
    makeUiNode: node,
    fitFullScreenBackgroundCover() {},
    uiColor: (...values) => ({values, equals(other){return this.values.join() === other?.values?.join();}}),
    makeRect: (name, parent, w, h, color) => { const n = node(name, parent); n.getComponent(UITransform).setContentSize(w, h); n.fill = color; return n; },
    makeLabel: (name, parent, text, size, color) => { const n = node(name, parent); const label=n.addComponent(Label); label.string=text; label.fontSize=size; label.color=color; return n; },
    makeButton: (name, parent, w, h, color, text) => { const n = factory.makeRect(name, parent, w, h); n.addComponent(Button); if (text) factory.makeLabel('Label', n, text); return n; },
};
let adResult = 'skipped', resolveAd;
let hotFontCache = false;
const listeners = new Set();
const store = { profile: null, onChange: f => listeners.add(f), offChange: f => listeners.delete(f),
    async executeCareer(command) { const result = rules.executeCareer(store.profile, command); for (const f of listeners) f(store.profile); return result; } };
const h = createHarness({ './CareerUiArt': {
    careerArt(parent,name,asset,w,h,x=0,y=0,sliced=false){const n = factory.makeRect(name,parent,w,h); n.setPosition(x,y,0); n.asset=asset;n.sliced=sliced;return n;},
    careerButtonFeedback() {}
}, './RuntimeUiFactory': factory, './ProjectUiFonts': { styleCurrencyNumberLabel(label) { label.currencyNumberFont = true; }, styleProjectUiLabel(label) {
    if (hotFontCache && label.overflow !== Label.Overflow.SHRINK && !label.string)
        label.node.getComponent(UITransform).setContentSize(0, 0);
} },
    '../backend/PlayerData': { PlayerData: store },
    '../platform/PlatformManager': { platform: () => ({ name: 'default', showRewardedAd: async () => adResult === 'pending' ? new Promise(r => { resolveAd = r; }) : adResult }) },
    '../platform/AdConfig': { rewardedAdUnitId: () => '测试广告位' },
});
Object.assign(h.cc, { Vec2: class { constructor(x,y){this.x=x;this.y=y;} }, ScrollView, Mask, view: {on(){},off(){}}, UIOpacity, tween: target => { let props; const t = {to(seconds,p){props=p;return t;},start(){Object.assign(target,props);return t;},stop(){}};return t;}, Node, Button, Label, UITransform, BlockInputEvents, sys: { localStorage: { getItem: () => null } } });
const load = name => h.load(path.join(h.root, 'assets/scripts', name + '.ts'));
const profile = load('backend/PlayerProfile');
const rules = load('progression/CareerRules');
const chars = load('app/PlayerCharacterConfig');
const { CareerPrototypePanel } = load('ui/CareerPrototypePanel');
const ids = Object.keys(profile.createDefaultProfile().characters);
function reset() { store.profile = profile.createDefaultProfile(); chars.selectPlayerCharacter(ids[0]); }
function descendants(n) { return [n, ...n.children.flatMap(descendants)]; }
const find = (root, name) => descendants(root).find(n => n.name === name);
const textOf = (root, name) => find(root, name).getComponent(Label).string;
const tick = () => new Promise(resolve => setImmediate(resolve));

test('快速比赛仅两组选择，反复切换节点与监听稳定，重复开赛只提交一次', async () => {
    reset(); const root = new Node('Root'); let starts = 0;
    const panel = new CareerPrototypePanel(root, () => starts++, () => {});
    const before = descendants(root).length;
    panel.openQuick();
    for (let i = 0; i < 30; i++) for (const name of ['Distance200', 'Distance400', 'RuleStandard', 'RuleWild']) find(panel.page.root, name).click();
    assert.equal(descendants(root).length, before); assert.equal(listeners.size, 1);
    assert.equal(panel.distance, 400); assert.equal(panel.rule, 'wild');
    assert.ok(textOf(panel.page.root, 'QuickNotes').indexOf('自动匹配') >= 0);
    for (const n of descendants(root)) if (n.handlers.click) assert.equal(n.handlers.click.length, 1);
    find(panel.page.root, 'StartEvent').click(); find(panel.page.root, 'StartEvent').click();
    await tick(); assert.equal(starts, 1); assert.equal(store.profile.career.pending.distance, 400);
    find(panel.page.root, 'StartEvent').click(); await tick();
    assert.equal(starts, 1, '退场加载期间不能恢复开赛按钮');
    root.destroy(); assert.equal(listeners.size, 0);
});

test('纵向地图默认选中最高已解锁联赛，面板跟随节点且滚动不重建', () => {
    reset();store.profile.career.league=3;store.profile.career.points=64;
    const root=new Node('Root'),panel=new CareerPrototypePanel(root,()=>{},()=>{});
    panel.root.getChildByName('Action0').click();const page=panel.page.root;
    assert.equal(find(page,'LeagueTab'),undefined);assert.equal(find(page,'CupTab'),undefined);
    assert.equal(panel.tier,3);assert.match(textOf(page,'LeaguePoints'),/64 \/ 100/);
    const scroll=find(page,'CareerMap').getComponent(ScrollView);assert.equal(scroll.vertical,true);assert.equal(scroll.horizontal,false);
    const before=descendants(root).length,offset=scroll.offset.y;
    for(let i=0;i<20;i++) {find(page,'LeagueTier1').click();find(page,'LeagueTier3').click();}
    assert.equal(descendants(root).length,before);assert.equal(scroll.offset.y,offset);
    assert.equal(find(page,'StartCup').getComponent(Button).interactable,false);
    assert.equal(find(page,'StartLeague').getComponent(Button).interactable,true);
    find(page,'LeagueTier5').click();assert.equal(find(page,'StartLeague').getComponent(Button).interactable,false);
    find(page,'ReturnCurrent').click();assert.equal(panel.tier,3);
    store.profile.career.points=100;panel.refresh();assert.equal(find(page,'StartCup').getComponent(Button).interactable,true);
    root.destroy();assert.equal(listeners.size,0);
});

test('联赛与杯赛按钮独立开赛，满积分仍可打联赛且均为狂野', async () => {
    for(const source of ['league','cup']) {
        reset();store.profile.career.points=100;const root=new Node('Root');let starts=0;
        const panel=new CareerPrototypePanel(root,()=>starts++,()=>{});panel.root.getChildByName('Action0').click();
        find(panel.page.root,source==='league'?'StartLeague':'StartCup').click();await tick();
        assert.equal(store.profile.career.pending.source,source);assert.equal(store.profile.career.pending.rule,'wild');assert.equal(starts,1);
        root.destroy();
    }
});

test('地图内显示角色杯赛各轮，换角色不继承轮次，开发者数值不在面板显示', () => {
    reset();store.profile.career.league=3;store.profile.career.points=100;
    store.profile.career.cups[ids[0]]={id:'a',tier:3,round:1,seed:3,coins:20,state:'active'};
    const root=new Node('Root'),panel=new CareerPrototypePanel(root,()=>{},()=>{});panel.root.getChildByName('Action0').click();const page=panel.page.root;
    assert.match(textOf(page,'CupRound1'),/待比赛/);assert.match(textOf(page,'CupRound2'),/400米/);
    assert.match(textOf(find(page,'StartCup'),'Label'),/半决赛/);
    const texts=descendants(find(page,'SelectedEventPanel')).map(n=>n.getComponent(Label)?.string??'').join('');
    assert.doesNotMatch(texts,/金币|难度|对手等级/);
    chars.selectPlayerCharacter(ids[1]);panel.refresh();assert.match(textOf(find(page,'StartCup'),'Label'),/参加杯赛/);
    assert.equal(store.profile.career.points,100);root.destroy();
});

test('生涯与快速比赛不出现道具入口', () => {
    reset();const root=new Node('Root'),panel=new CareerPrototypePanel(root,()=>{},()=>{});
    panel.root.getChildByName('Action0').click();
    assert.ok(!descendants(panel.page.root).some(n=>n.name==='InventoryButton'));
    root.destroy();
});

// 离线排版检查读取同一套实际页面节点，不启动或截图Creator。
if (process.env.CAREER_LAYOUT_EXPORT) {
    const fs=require('node:fs'); reset();const host=new Node('Root');
    const panel=new CareerPrototypePanel(host,()=>{},()=>{});
    const serial=n=>({name:n.name,active:n.active,position:n.position,scale:n.scale,size:n.getComponent(UITransform)?.contentSize,
        anchor:n.getComponent(UITransform)?.anchorPoint,fill:n.fill?.values,asset:n.asset,sliced:n.sliced,
        text:n.getComponent(Label)?.string,font:n.getComponent(Label)?.fontSize,color:n.getComponent(Label)?.color?.values,children:n.children.map(serial)});
    const scenes={lobby:serial(panel.root)};
    panel.root.getChildByName('Action0').click();scenes.league=serial(panel.page.root);
    store.profile.career.league=3;store.profile.career.points=100;
    store.profile.career.cups[ids[0]]={id:'preview',tier:3,round:1,seed:3,state:'active',coins:240};
    panel.tier=3;panel.refresh();scenes.cup=serial(panel.page.root);
    find(panel.page.root,'RulesButton').click();scenes.rules=serial(panel.page.root);
    fs.writeFileSync(process.env.CAREER_LAYOUT_EXPORT,JSON.stringify(scenes));host.destroy();
}


test('复用美术的迟到加载不写销毁节点，独立帧释放且不销毁共享纹理', () => {
    const pending=[];let frames=0,destroyed=0;
    class Sprite {static SizeMode={CUSTOM:1};static Type={SLICED:1};}
    class Texture2D {}
    class SpriteFrame {constructor(){frames++;} destroy(){destroyed++;}}
    class Graphics {}
    const artHarness=createHarness({'./RuntimeUiFactory':{makeUiNode:node},
        '../core/RaceBundleLoader':{loadRaceAsset(path,type,cb){pending.push(cb);}}});
    Object.assign(artHarness.cc,{Node,Button,UITransform,Sprite,SpriteFrame,Texture2D,Graphics});
    const {careerArt}=artHarness.load(path.join(h.root,'assets/scripts/ui/CareerUiArt.ts'));
    const root=new Node('Root'),late=careerArt(root,'Surface','test',100,80,0,0,true);
    late.destroy();pending.shift()(null,{width:200,height:160});assert.equal(frames,0);
    const live=careerArt(root,'Surface','test',100,80,0,0,true);
    pending.shift()(null,{width:200,height:160});assert.equal(frames,1);
    assert.equal(live.getComponent(Sprite).spriteFrame.insetLeft,40);
    root.destroy();assert.equal(destroyed,1);
});

test('大厅生涯卡按真实积分更新，重复刷新不新增节点或监听', () => {
    reset(); const root = new Node('Root');
    const panel = new CareerPrototypePanel(root, () => {}, () => {});
    const count = descendants(root).length;
    for (const points of [0, 20, 80, 100, 80]) {
        store.profile.career.points = points;
        for (let i = 0; i < 10; i++) panel.refresh();
        assert.equal(textOf(panel.root, 'Detail'), `${points}`);
        assert.equal(textOf(panel.root, 'PointsLimit'), '/ 100');
        assert.equal(find(panel.root, 'ProgressFill').scale.x, points / 100);
        assert.equal(descendants(root).length, count);
        assert.equal(listeners.size, 1);
        assert.match(textOf(panel.root, 'Notice'), points === 100 ? /已开放/ : new RegExp(`再获${100-points}积分`));
    }
    store.profile.career.league = 5; panel.refresh();
    assert.equal(textOf(panel.root, 'Title'), '冠军级');
    assert.match(textOf(panel.root, 'NextLeague'), /最高/);
    root.destroy(); assert.equal(listeners.size, 0);
});

test('大厅继续杯赛选择角色自己的赛程，换角色后恢复联赛入口', () => {
    reset(); const root = new Node('Root');
    store.profile.career.league = 3;
    store.profile.career.cups[ids[0]] = {id:'ongoing',tier:1,round:1,seed:3,coins:0,state:'active'};
    const panel = new CareerPrototypePanel(root, () => {}, () => {});
    assert.equal(textOf(find(panel.root, 'Action0'), 'Label'), '继续杯赛');
    find(panel.root, 'Action0').click(); assert.equal(panel.tier, 1);
    panel.open('home'); chars.selectPlayerCharacter(ids[1]); panel.refresh();
    assert.equal(textOf(find(panel.root, 'Action0'), 'Label'), '继续生涯');
    find(panel.root, 'Action0').click(); assert.equal(panel.tier, 3);
    root.destroy(); assert.equal(listeners.size, 0);
});


test('大厅积分分色分字号，热字体缓存下生涯按钮仍保持设计左对齐文本框', () => {
    reset(); hotFontCache = true;
    const root = new Node('Root');
    try {
        const panel = new CareerPrototypePanel(root, () => {}, () => {});
        const button = find(panel.root, 'Action0');
        const label = find(button, 'Label').getComponent(Label);
        assert.equal(label.horizontalAlign, Label.HorizontalAlign.LEFT);
        assert.equal(label.overflow, Label.Overflow.SHRINK);
        assert.equal(label.enableWrapText, false);
        assert.equal(label.node.getComponent(UITransform).contentSize.width, 220);
        assert.equal(button.position.x + label.node.position.x - 110 + 640, 835);
        const value = find(panel.root, 'Detail').getComponent(Label);
        const limit = find(panel.root, 'PointsLimit').getComponent(Label);
        assert.equal(value.horizontalAlign, Label.HorizontalAlign.RIGHT);
        assert.equal(value.fontSize, 26); assert.equal(limit.fontSize, 16);
        assert.equal(value.currencyNumberFont, true); assert.equal(limit.currencyNumberFont, true);
        assert.equal(value.color.equals(limit.color), false);
        for (const points of [0, 9, 80, 100]) {
            store.profile.career.points = points; panel.refresh();
            assert.equal(value.string, `${points}`); assert.equal(limit.string, '/ 100');
            assert.equal(label.node.getComponent(UITransform).contentSize.width, 220);
        }
    } finally { hotFontCache = false; root.destroy(); }
});

test('顶部每日补给与设置共用悬浮图标语言，资源条无加号且红点只跟随免费金币', () => {
    const source = fs.readFileSync(path.join(h.root, 'assets/scripts/ui/ResourceHeadBar.ts'), 'utf8');
    assert.match(source, /makeTopEntryButton\('SupplyStationButton'[\s\S]*?'每日补给'[\s\S]*?shopUi\.topEntrySupply/);
    assert.match(source, /makeTopEntryButton\('SettingsButton'[\s\S]*?'设置'[\s\S]*?shopUi\.topEntrySettings/);
    assert.doesNotMatch(source, /shopUi\.topEntryBase/);
    assert.match(source, /makeLoginSprite\('Icon'[\s\S]*?TOP_ENTRY_ICON_SIZE/);
    assert.match(source, /styleProjectUiLabel\(label, 'semibold', 26\)/);
    assert.match(source, /labelNode\.addComponent\(LabelOutline\)/);
    assert.match(source, /outline\.width = 1\.5/);
    assert.match(source, /SupplyStationButton[\s\S]*?options\.onOpenShop\?\.\(\)/);
    assert.match(source, /shopUi\.notificationBadge/);
    assert.match(source, /shopUi\.resourcePillClean/g);
    assert.doesNotMatch(source, /shopUi\.resourcePill,/);
    assert.match(source, /const settingsX = rightEdge[\s\S]*?const gemPillX =[\s\S]*?const coinPillX =[\s\S]*?const supplyX =/);
    assert.match(source, /const visible = !profile\.dailyShop\.freeCoinsClaimed/);
    assert.doesNotMatch(source, /_shopBadge[\s\S]{0,250}adGemsClaimed|_shopBadge[\s\S]{0,250}adCoinsClaimed/);

    const lobby = fs.readFileSync(path.join(h.root, 'assets/scripts/ui/PrepareRaceFlow.ts'), 'utf8');
    assert.doesNotMatch(lobby, /SupplyStationButton|_dailySupplyBadge|refreshDailySupplyEntry/);

    const panel = fs.readFileSync(path.join(h.root, 'assets/scripts/ui/ShopDailySupplyPanel.ts'), 'utf8');
    assert.match(panel, /makeLabel\('SectionTitle', sectionRoot, '每日补给'/);
    assert.match(panel, /RESOURCE_PATHS\.characterUi\.background/);
    assert.match(panel, /buildSecondaryPageHeader\(headerMotion, 'Supply', '补给站'/);
    assert.match(panel, /SupplyHeaderMotion', -16/);
    assert.match(panel, /SupplySectionMotion', -24/);
    assert.match(panel, /SupplyCardsMotion', 24/);
    assert.match(panel, /this\._motion\.enter\(true\)/);
    assert.match(panel, /this\._motion\.exit\(/);
    assert.doesNotMatch(panel, /shopUi\.supplyPanel|makeSprite\('SupplyPanel'/);

    const character = fs.readFileSync(path.join(h.root, 'assets/scripts/ui/PrepareRaceFlow.ts'), 'utf8');
    assert.match(character, /export function buildSecondaryPageHeader/);
    assert.match(character, /buildSecondaryPageHeader\(parent, 'Character', '角色'/);

    const manager = fs.readFileSync(path.join(h.root, 'assets/scripts/app/LoginManager.ts'), 'utf8');
    assert.match(manager, /setIdentityVisible\(false\)/);
    assert.match(manager, /setSupplyEntryVisible\(false\)/);
    assert.match(manager, /transitionOutForOverlay\(revealShop\)/);
    assert.match(manager, /transitionInFromOverlay\(\)/);
    assert.doesNotMatch(manager, /setBack\(\(\) => this\.closeShop\(\)\)/);

    const settings = fs.readFileSync(path.join(h.root, 'assets/scripts/ui/SettingsPanel.ts'), 'utf8');
    assert.match(settings, /SettingsHeaderBackground[\s\S]*?characterUi\.headerBackground/);
    assert.match(settings, /characterUi\.confirmButton/);
});
