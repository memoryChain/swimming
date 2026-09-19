const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
class Component {}
class UIOpacity extends Component { opacity = 255; }
class Scale { constructor(x=1,y=1,z=1){this.set(x,y,z);} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} clone(){return new Scale(this.x,this.y,this.z);} }
class UITransform extends Component { setAnchorPoint(x,y){this.anchorPoint={x,y};} setContentSize(width, height) { this.contentSize = { width, height }; } }
class Label extends Component { static HorizontalAlign = {LEFT: 0, CENTER: 1, RIGHT: 2}; static VerticalAlign={TOP:0,CENTER:1}; static Overflow = { NONE: 0, SHRINK: 1 }; _string = ''; get string(){return this._string;} set string(value){this._string=value;if(this.overflow===0 && this.node){this.node.getComponent(UITransform).setContentSize(value.length*this.fontSize,this.fontSize+7);for(const fn of this.node.handlers['size-changed']??[])fn();}} }
class Button extends Component { static EventType = { CLICK: 'click' }; interactable = true; }
class BlockInputEvents extends Component {}
class Mask extends Component {static Type={GRAPHICS_RECT:1,GRAPHICS_ELLIPSE:2};}
class ScrollView extends Component {enabled=true;stopAutoScroll(){} scrollToOffset(offset,duration){this.offset=offset;this.duration=duration;const h=this.content.getComponent(UITransform).contentSize.height;this.content.setPosition(0,(490-h)/2+offset.y,0);}}

class Node {
    static EventType = { NODE_DESTROYED: 'destroy', SIZE_CHANGED: 'size-changed' };
    children = []; components = []; handlers = {}; active = true; isValid = true;
    constructor(name) { this.name = name; this.position = {x:0,y:0,z:0}; this.scale = new Scale(); }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
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
class SpriteFrame {isValid=true;rect={width:100,height:100};set texture(v){this._texture=v;this.rect={width:v.width,height:v.height};} get texture(){return this._texture;} destroy(){this.isValid=false;} }
class Sprite extends Component {static SizeMode={CUSTOM:1};static Type={SLICED:1};color=factory.uiColor(255,255,255);set spriteFrame(v){this.frame=v;this.node.asset=v?.texture?.path;}get spriteFrame(){return this.frame;} }
const imageCallbacks=[];let deferImages=false;
function uiFrame(asset,done){const frame=new SpriteFrame();let width=512,height=512;const file=path.join(__dirname,'../assets/race',asset.replace(/\/texture$/,'.png'));if(require('node:fs').existsSync(file)){const bytes=require('node:fs').readFileSync(file);width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);}frame.texture={path:asset,width,height};if(deferImages)imageCallbacks.push(()=>done(frame));else done(frame);}
const h = createHarness({ '../core/RaceBundleLoader':{loadRaceAsset(asset,type,done){uiFrame(asset,frame=>done(null,frame.texture));}}, './AvatarUiAssets':{loadAvatarUiSpriteFrame:uiFrame}, './CareerUiArt': {
    careerArt(parent,name,asset,w,h,x=0,y=0,sliced=false){const n = factory.makeRect(name,parent,w,h); n.setPosition(x,y,0); n.asset=asset;n.sliced=sliced;return n;},
    careerButtonFeedback() {}
}, './RuntimeUiFactory': factory, './ProjectUiFonts': { styleCurrencyNumberLabel(label) { label.currencyNumberFont = true; }, styleProjectUiLabel(label, weight) {
    label.projectWeight = weight;
    if (hotFontCache && label.overflow !== Label.Overflow.SHRINK && !label.string)
        label.node.getComponent(UITransform).setContentSize(0, 0);
} },
    '../backend/PlayerData': { PlayerData: store },
    '../platform/PlatformManager': { platform: () => ({ name: 'default', showRewardedAd: async () => adResult === 'pending' ? new Promise(r => { resolveAd = r; }) : adResult }) },
    '../platform/AdConfig': { rewardedAdUnitId: () => '测试广告位' },
});
Object.assign(h.cc, { Vec2: class { constructor(x,y){this.x=x;this.y=y;} }, ScrollView, Mask, view: {on(){},off(){},getVisibleSize(){return {width:1280,height:720};}}, UIOpacity, tween: target => { let props; const t = {to(seconds,p){props=p;return t;},start(){Object.assign(target,props);return t;},stop(){}};return t;}, Node, Button, Label, Sprite, SpriteFrame, UITransform, BlockInputEvents, sys: { getSafeAreaRect(){return {x:0,y:0,width:1280,height:720};}, localStorage: { getItem: () => null } } });
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

test('横向六级路线默认选中当前联赛，重复切换不重建节点或监听', () => {
    reset();store.profile.career.league=3;store.profile.career.points=64;
    const root=new Node('Root'),panel=new CareerPrototypePanel(root,()=>{},()=>{});
    panel.root.getChildByName('Action0').click();const page=panel.page.root;
    assert.equal(find(page,'LeagueTab'),undefined);assert.equal(find(page,'CupTab'),undefined);
    assert.equal(panel.tier,3);assert.equal(textOf(page,'LeaguePoints'),'64');
    assert.equal(find(page,'CareerMap').getComponent(ScrollView),undefined);
    const before=descendants(root).length;
    for(let i=0;i<20;i++) {find(page,'LeagueTier1').click();find(page,'LeagueTier3').click();}
    assert.equal(descendants(root).length,before);for(const n of descendants(root))if(n.handlers.click)assert.equal(n.handlers.click.length,1);
    assert.equal(find(page,'StartCup').getComponent(Button).interactable,false);
    assert.equal(find(page,'StartLeague').getComponent(Button).interactable,true);
    find(page,'LeagueTier5').click();assert.equal(find(page,'StartLeague').getComponent(Button).interactable,false);
    assert.equal(find(page,'ReturnCurrent'),undefined);find(page,'LeagueTier3').click();assert.equal(panel.tier,3);
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
    assert.equal(textOf(find(page,'CupRound1'),'Status'),'当前轮次');assert.equal(textOf(find(page,'CupRound2'),'Distance'),'400');assert.equal(textOf(find(page,'CupRound2'),'Condition'),'第一名夺冠');
    assert.match(textOf(find(page,'StartCup'),'Label'),/半决赛/);
    const texts=descendants(find(page,'SelectedEventPanel')).map(n=>n.getComponent(Label)?.string??'').join('');
    assert.doesNotMatch(texts,/金币|难度|对手等级/);
    chars.selectPlayerCharacter(ids[1]);panel.refresh();assert.match(textOf(find(page,'StartCup'),'Label'),/开始杯赛/);
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
        anchor:n.getComponent(UITransform)?.anchorPoint,fill:n.fill?.values,asset:n.asset,inset:n.getComponent(Sprite)?.spriteFrame?.insetLeft,sliced:n.getComponent(Sprite)?.type===Sprite.Type.SLICED||n.sliced,
        text:n.getComponent(Label)?.string,font:n.getComponent(Label)?.fontSize,weight:n.getComponent(Label)?.projectWeight,lineHeight:n.getComponent(Label)?.lineHeight,verticalAlign:n.getComponent(Label)?.verticalAlign,numberFont:n.getComponent(Label)?.currencyNumberFont,color:n.getComponent(Label)?.color?.values,align:n.getComponent(Label)?.horizontalAlign,tint:n.getComponent(Sprite)?.color?.values,mask:!!n.getComponent(Mask),children:n.children.map(serial)});
    const scenes={lobby:serial(panel.root)};
    panel.root.getChildByName('Action0').click();scenes.league=serial(panel.page.root);store.profile.career.points=20;panel.refresh();scenes.points20=serial(panel.page.root);store.profile.career.points=0;panel.refresh();
    for(let t=0;t<6;t++){panel.tier=t;panel.refresh();scenes['tier-'+t]=serial(panel.page.root);}panel.tier=0;panel.refresh();store.profile.career.points=100;panel.refresh();scenes.open=serial(panel.page.root);
    store.profile.career.league=3;store.profile.career.points=100;
    store.profile.career.cups[ids[0]]={id:'preview',tier:3,round:1,seed:3,state:'active',coins:240};
    panel.tier=3;panel.refresh();scenes.cup=serial(panel.page.root);
    find(panel.page.root,'RulesButton').click();scenes.rules=serial(panel.page.root);panel.page.hide();store.profile.career.league=5;panel.tier=5;store.profile.career.cups[ids[0]]={id:'max',tier:5,round:2,seed:3,state:'won',coins:240};panel.refresh();scenes.max=serial(panel.page.root);
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

test('六级两轮和三轮展示与规则一致，历史联赛、淘汰和最高级状态完整', () => {
    const {careerPageModel}=load('ui/CareerPageModel');reset();const c=store.profile.career;
    for(let tier=0;tier<6;tier++){
        c.league=tier;c.points=80;
        let m=careerPageModel(c,ids[0],tier);assert.equal(m.action,'locked');assert.match(m.button,/20/);
        assert.equal(m.rounds.length,tier>=3?3:2);assert.equal(m.rounds.at(-1).condition,'第一名夺冠');
        assert.equal(m.rounds.at(-1).distance,tier>=3?400:200);
        c.points=100;m=careerPageModel(c,ids[0],tier);assert.equal(m.action,'start');assert.equal(m.rounds[0].style,'current');
    }
    c.cups[ids[0]]={id:'lost',tier:5,round:1,seed:1,state:'lost',coins:0};
    let m=careerPageModel(c,ids[0],5);assert.equal(m.rounds[0].style,'complete');assert.equal(m.rounds[1].style,'failed');assert.equal(m.rounds[2].style,'pending');assert.equal(m.button,'再次挑战');
    c.cups[ids[0]].state='won';m=careerPageModel(c,ids[0],5);assert.equal(m.rounds[2].status,'已夺冠');assert.match(m.note,/最高级/);assert.doesNotMatch(m.note,/下一/);
    m=careerPageModel(c,ids[0],1);assert.equal(m.points,100);assert.match(m.hint,/不增加/);
    c.cups[ids[0]].state='active';m=careerPageModel(c,ids[0],1);assert.equal(m.action,'locate');assert.equal(m.actionTier,5);
});

test('杯赛不显示冗余文字和放弃入口，其他级别的未完成杯赛仍可定位', () => {
    reset();store.profile.career.league=3;store.profile.career.points=100;
    store.profile.career.cups[ids[0]]={id:'active',tier:3,round:1,seed:1,state:'active',coins:0};
    const root=new Node('Root'),p=new CareerPrototypePanel(root,()=>{},()=>{});find(p.root,'Action0').click();const page=p.page.root;
    for (const name of ['CupSubtitle', 'CupState', 'AbandonCup']) assert.ok(!find(page, name));
    assert.equal(store.profile.career.cups[ids[0]].state,'active');
    find(page,'LeagueTier1').click();find(page,'StartCup').click();assert.equal(p.tier,3);assert.equal(store.profile.career.pending,null);
    assert.equal(store.profile.career.cups[ids[0]].round,1);root.destroy();
});

test('从历史赛事返回保留赛事来源，只有真实晋级回执显示新级回顾', () => {
    const session=load('progression/SoloRaceSession');
    for(const promoted of [false,true]){
        reset();const c=store.profile.career;c.league=2;c.points=promoted?0:75;
        c.cups[ids[0]]={id:'won',tier:1,round:1,seed:1,state:'won',coins:1};
        c.receipts=[{id:'return',characterId:ids[0],message:promoted?'晋级成功 · 城市精英':'杯赛夺冠'}];
        session.setSoloRaceTicket({id:'return',source:'cup',tier:1,characterId:ids[0]});session.markSoloReturn();
        const root=new Node('Root'),p=new CareerPrototypePanel(root,()=>{},()=>{});
        assert.equal(p.tier,promoted?2:1);assert.equal(p.reviewCupTier,promoted?1:null);
        if(promoted){assert.equal(textOf(find(p.page.root,'StartCup'),'Label'),'查看新联赛');find(p.page.root,'StartCup').click();assert.equal(p.reviewCupTier,null);assert.equal(textOf(find(p.page.root,'StartCup'),'Label'),'还差100积分');}
        root.destroy();session.setSoloRaceTicket(null);
    }
});

test('更换角色返回保存所查看级别，不继承另一角色的杯赛轮次；页面释放幂等', () => {
    reset();store.profile.career.league=3;store.profile.career.points=100;
    store.profile.career.cups[ids[0]]={id:'active',tier:1,round:1,seed:1,state:'active',coins:0};
    const root=new Node('Root');let navigation;
    const p=new CareerPrototypePanel(root,()=>{},()=>{},{parent:root,visibility(){},characters:n=>navigation=n});
    find(p.root,'Action0').click();find(p.page.root,'ChangeCharacter').click();assert.equal(navigation.tier,1);
    p.dispose();p.dispose();assert.equal(listeners.size,0);p.root.destroy();chars.selectPlayerCharacter(ids[1]);
    const next=new CareerPrototypePanel(root,()=>{},()=>{},{parent:root,visibility(){},characters(){},navigation});
    assert.equal(next.tier,1);assert.equal(next.page.root.active,true);assert.equal(textOf(find(next.page.root,'StartCup'),'Label'),'开始杯赛');
    assert.equal(store.profile.career.cups[ids[0]].round,1);assert.equal(store.profile.career.cups[ids[1]],undefined);
    root.destroy();assert.equal(listeners.size,0);
});

test('贴图快速切换只接受最新请求，销毁后的回调不改图、不创建新帧', () => {
    const {CareerImage}=load('ui/CareerPageWidgets');const root=new Node('Root');deferImages=true;
    try{
        const image=new CareerImage(root,'Test','a',50,50,0,0,true);image.set('b');
        imageCallbacks.shift()();assert.equal(image.sprite.spriteFrame,undefined);
        imageCallbacks.shift()();assert.equal(image.node.asset,'b');
        image.set('c');image.node.destroy();imageCallbacks.shift()();assert.equal(image.node.asset,'b');
    }finally{deferImages=false;imageCallbacks.length=0;root.destroy();}
});

test('保存失败保留杯赛进度和页面，允许重试且错误可见', async () => {
    reset();const root=new Node('Root'),p=new CareerPrototypePanel(root,()=>assert.fail('保存失败不能开赛'),()=>{});find(p.root,'Action0').click();
    const execute=store.executeCareer;store.executeCareer=async()=>{throw new Error('存档写入失败');};
    try{find(p.page.root,'StartLeague').click();await tick();assert.equal(p.busy,false);assert.match(textOf(p.page.root,'EventStatus'),/保存失败/);assert.equal(store.profile.career.pending,null);}
    finally{store.executeCareer=execute;root.destroy();}
});

test('安全区变化只调整页面变换，宽屏与窄屏均保留全部内容且节点稳定', () => {
    reset(); const root=new Node('Root'),panel=new CareerPrototypePanel(root,()=>{},()=>{});
    panel.root.getChildByName('Action0').click(); const page=panel.page, count=descendants(root).length;
    const oldSize=h.cc.view.getVisibleSize,oldSafe=h.cc.sys.getSafeAreaRect;
    try {
        for(const v of [{width:1600,height:720,x:40,y:0,safeW:1520,safeH:720}, {width:1000,height:720,x:30,y:20,safeW:940,safeH:680}]) {
            h.cc.view.getVisibleSize=()=>({width:v.width,height:v.height});
            h.cc.sys.getSafeAreaRect=()=>({x:v.x,y:v.y,width:v.safeW,height:v.safeH});
            page.resize(); const design=find(page.root,'CareerDesign');
            assert.ok(1280*design.scale.x<=v.safeW);assert.ok(720*design.scale.y<=v.safeH);
            assert.equal(design.position.x,v.x+v.safeW/2-v.width/2);
            assert.equal(descendants(root).length,count);
        }
    } finally {h.cc.view.getVisibleSize=oldSize;h.cc.sys.getSafeAreaRect=oldSafe;root.destroy();}
});


test('动态合图后反复返回生涯，九宫格始终使用原始纹理且旧帧独立释放', () => {
    const original={width:416,height:368,path:'panel'}, atlas={width:2048,height:2048,path:'atlas'};
    const packed=new SpriteFrame(); packed.texture=atlas; packed.rect={x:710,y:500,width:416,height:368};
    const requests=[];
    const fixture=createHarness({
        './RuntimeUiFactory':factory,'./CareerUiArt':{careerButtonFeedback(){}},
        './AvatarUiAssets':{loadAvatarUiSpriteFrame(_path,done){done(packed);}},
        '../core/RaceBundleLoader':{loadRaceAsset(_path,_type,done){requests.push(()=>done(null,original));}},
    });
    Object.assign(fixture.cc,{Node,Sprite,SpriteFrame,UITransform});
    const {CareerImage}=fixture.load(path.join(h.root,'assets/scripts/ui/CareerPageWidgets.ts'));
    for(let i=0;i<5;i++) {
        const root=new Node('页面');
        const panel=new CareerImage(root,'九宫格','panel',200,100,0,0,false,true);
        requests.shift()(); const frame=panel.sprite.spriteFrame;
        assert.equal(frame.texture,original);assert.equal(frame.rect.width,416);assert.equal(frame.rect.height,368);
        assert.equal(frame.insetLeft,18);assert.equal(frame.insetTop,18);
        assert.notEqual(frame,packed);root.destroy();assert.equal(frame.isValid,false);assert.equal(packed.isValid,true);
    }
    const root=new Node('页面'),late=new CareerImage(root,'迟到面板','panel',200,100,0,0,false,true);
    late.set('replacement'); requests.shift()();assert.equal(late.sprite.spriteFrame,undefined);
    root.destroy();requests.shift()();assert.equal(late.sprite.spriteFrame,undefined);
});


test('头像不拉伸、名称变宽后等级跟随，徽章居中并逐级增大且无旧选中条', () => {
    reset(); const root=new Node('Root'),panel=new CareerPrototypePanel(root,()=>{},()=>{});
    find(panel.root,'Action0').click();const page=panel.page;
    const avatar=find(page.root,'CharacterAvatar').getComponent(UITransform).contentSize;
    assert.equal(avatar.width,avatar.height);
    const name=find(page.root,'CharacterName');
    for(const width of [48,72,96,144]) {
        name.getComponent(UITransform).setContentSize(width,44);
        for(const fn of name.handlers['size-changed'])fn();
        assert.equal(find(page.root,'LevelPill').position.x,584+width+12+35-640);
        assert.equal(find(page.root,'CharacterLevel').position.x,find(page.root,'LevelPill').position.x);
    }
    assert.equal(find(page.root,'ReturnCurrent'),undefined);
    assert.equal(find(page.root,'SelectionMark'),undefined);
    assert.match(find(page.root,'RouteLine').asset,/career-v1\/route/);
    let height=0;
    for(let i=0;i<6;i++) {
        find(page.root,'LeagueTier'+i).click();const badge=find(page.root,'HonorBadge');
        const current=badge.getComponent(UITransform).contentSize.height*badge.scale.y;
        assert.ok(current>height);height=current;
        assert.equal(badge.position.x,191.5-640);
        assert.ok(Math.abs(badge.position.y-current/2-(360-(i===0?462:487)))<1e-6);
    }
    root.destroy();
});


test('积分条按像素宽度更新不缩放圆角，数值复用金币字体，未开始底框使用指定色', () => {
    reset();const root=new Node('Root'),panel=new CareerPrototypePanel(root,()=>{},()=>{});find(panel.root,'Action0').click();
    const page=panel.page.root,fill=find(page,'ProgressFill');
    for(const points of [0,20,80,100]) {
        store.profile.career.points=points;panel.refresh();
        assert.equal(fill.scale.x,1);assert.equal(fill.scale.y,1);
        assert.equal(fill.getComponent(UITransform).contentSize.width,350*points/100);
        assert.equal(fill.getComponent(UITransform).contentSize.height,16);
        assert.equal(fill.active,points>0);
        assert.equal(fill.getComponent(Sprite).spriteFrame.insetLeft,8);
    }
    for(const name of ['CharacterLevel','LeagueDistance','LeaguePoints','PointsLimit'])assert.equal(find(page,name).getComponent(Label).currencyNumberFont,true);
    store.profile.career.points=0;panel.refresh();
    for(const name of ['PointsArea','RoundSurface']) {
        const n=find(page,name);assert.match(n.asset,/panel-white/);
        assert.deepEqual(n.getComponent(Sprite).color.values,[229,244,253]);
    }
    root.destroy();
});
