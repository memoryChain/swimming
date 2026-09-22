const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
class Component { get isValid() { return this.node?.isValid ?? false; } }
class UIOpacity extends Component { opacity = 255; }
let deferMotion = false, createdTweens = 0;
const pendingTweens = new Set();
function uiTween(target) {
    const steps = [];
    let active = false;
    const animation = {
        target, steps,
        delay(seconds) { steps.push({ delay: seconds }); return this; },
        to(seconds, props, options) { steps.push({ seconds, props, options }); return this; },
        call(callback) { steps.push({ callback }); return this; },
        start() { active = true; if (deferMotion) pendingTweens.add(this); else this.finish(); return this; },
        finish() { if (!active) return; pendingTweens.delete(this); for (const step of steps) { if (!active) break; if (step.props) Object.assign(target, step.props); step.callback?.(); } active = false; },
        stop() { active = false; pendingTweens.delete(this); },
    };
    createdTweens++;
    return animation;
}
class Scale { constructor(x=1,y=1,z=1){this.set(x,y,z);} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} clone(){return new Scale(this.x,this.y,this.z);} }
class UITransform extends Component { setAnchorPoint(x,y){this.anchorPoint={x,y};} setContentSize(width, height) { this.contentSize = { width, height }; } }
class Label extends Component { static HorizontalAlign = {LEFT: 0, CENTER: 1, RIGHT: 2}; static VerticalAlign={TOP:0,CENTER:1}; static Overflow = { NONE: 0, SHRINK: 1 }; _string = ''; get string(){return this._string;} set string(value){this._string=value;if(this.overflow===0 && this.node){this.node.getComponent(UITransform).setContentSize(value.length*this.fontSize,this.fontSize+7);for(const fn of this.node.handlers['size-changed']??[])fn();}} }
class Button extends Component { static EventType = { CLICK: 'click' }; static Transition = {NONE:0}; interactable = true; }
class BlockInputEvents extends Component {}
class Canvas extends Component {}
class Widget extends Component {
    static AlignMode = { ON_WINDOW_RESIZE: 2 };
    updateAlignment() {
        const size = this.target.getComponent(UITransform).contentSize;
        const own = this.node.getComponent(UITransform).contentSize;
        let x = 0, y = 0;
        for (let n = this.node.parent; n && n !== this.target; n = n.parent) { x += n.position.x; y += n.position.y; }
        this.node.setPosition((own.width - size.width) / 2 + this.left - x, (size.height - own.height) / 2 - this.top - y, 0);
    }
}
class Graphics extends Component {
    clears=0;
    clear(){this.clears++;this.shape=null;}
    roundRect(x,y,w,h,r){this.shape={x,y,w,h,r};}
    fill(){} stroke(){}
}
class Mask extends Component {static Type={GRAPHICS_RECT:1,GRAPHICS_ELLIPSE:2};}
class ScrollView extends Component {enabled=true;stopAutoScroll(){} scrollToOffset(offset,duration){this.offset=offset;this.duration=duration;const h=this.content.getComponent(UITransform).contentSize.height;this.content.setPosition(0,(490-h)/2+offset.y,0);}}

function uiPosition(x, y, z) {
    const value = { x, y, z };
    Object.defineProperty(value, 'clone', { value: () => uiPosition(value.x, value.y, value.z) });
    return value;
}
class Node {
    static EventType = { NODE_DESTROYED: 'destroy', SIZE_CHANGED: 'size-changed' };
    children = []; components = []; handlers = {}; active = true; isValid = true;
    constructor(name) { this.name = name; this.position = uiPosition(0,0,0); this.scale = new Scale(); }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    setScale(x,y,z) { this.scale = new Scale(x,y,z); }
    setPosition(x, y, z) { this.position = uiPosition(x, y, z); }
    setParent(parent) { this.parent = parent; parent.children.push(this); }
    setSiblingIndex(index) { const children=this.parent.children;children.splice(children.indexOf(this),1);children.splice(index,0,this); }
    addComponent(C) { const c = new C(); c.node = this; this.components.push(c); return c; }
    getComponent(C) { return this.components.find(c => c instanceof C); }
    getComponentsInChildren(C) { return [...this.components.filter(c => c instanceof C), ...this.children.flatMap(n => n.getComponentsInChildren(C))]; }
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
}, './RuntimeUiFactory': factory, './ProjectUiFonts': { styleCurrencyNumberLabel(label, lineHeight) { label.currencyNumberFont = true; label.lineHeight = lineHeight; }, styleProjectUiLabel(label, weight, lineHeight) {
    label.projectWeight = weight;
    label.lineHeight = lineHeight;
    if (hotFontCache && label.overflow !== Label.Overflow.SHRINK && !label.string)
        label.node.getComponent(UITransform).setContentSize(0, 0);
} },
    '../backend/PlayerData': { PlayerData: store },
    '../app/PrepareRaceCharacterPreview': {},
    './UILayers': { getUILayer: canvas => canvas, UILayer: { Popup: 1 } },
    'cc/env': { WECHAT: false },
    '../platform/PlatformManager': { platform: () => ({ name: 'default', showRewardedAd: async () => adResult === 'pending' ? new Promise(r => { resolveAd = r; }) : adResult }) },
    '../platform/AdConfig': { rewardedAdUnitId: () => '测试广告位' },
});
Object.assign(h.cc, { Vec2: class { constructor(x,y){this.x=x;this.y=y;} }, ScrollView, Mask, Graphics, view: {on(){},off(){},getVisibleSize(){return {width:1280,height:720};},getVisibleOrigin(){return {x:0,y:0};}}, UIOpacity, tween: uiTween, Node, Button, Label, Sprite, SpriteFrame, UITransform, BlockInputEvents, sys: { getSafeAreaRect(){return {x:0,y:0,width:1280,height:720};}, localStorage: { getItem: () => null } } });
const load = name => h.load(path.join(h.root, 'assets/scripts', name + '.ts'));
Object.assign(h.cc, { Canvas, Widget, Layers: { Enum: { UI_2D: 1 } } });
// 生涯页通过真实适配工具创建返回组，不让测试替身把错误锚点当成正常位置。
factory.makeScreenEdgeGroup = load('ui/RuntimeUiFactory').makeScreenEdgeGroup;
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

test('生涯首次打开按区域错开入场，刷新积分与段位不重播，背景返回区不移动', () => {
    reset(); deferMotion = true;
    const root = new Node('Root'), panel = new CareerPrototypePanel(root, () => {}, () => {});
    try {
        assert.equal(pendingTweens.size, 0, '隐藏生涯不提前运行动效');
        find(panel.root, 'Action0').click();
        const page = panel.page, bg = find(page.root, 'Background'), header = find(page.root, 'CareerHeader');
        const fixed = [bg, header].map(n => ({ position: { ...n.position }, scale: { ...n.scale } }));
        const groupNames = ['CareerRouteEntrance', 'CareerHonorEntrance', 'CareerCharacterEntrance', 'CareerLeagueEntrance', 'CareerCupEntrance'];
        const groups = groupNames.map(name => find(page.root, name));
        assert.ok(groups[0].position.y > 0); assert.ok(groups[1].position.x < 0);
        assert.ok(groups[2].position.x > 0); assert.ok(groups[3].position.y < 0); assert.ok(groups[4].position.x > 0);
        const owners = [['RouteLine', 'LeagueTier0'], ['HonorBadge', 'Podium', 'RulesButton'],
            ['CharacterBar', 'CharacterName', 'ChangeCharacter'], ['LeaguePanel', 'LeaguePoints', 'StartLeague'], ['CupPanel', 'CupRound0', 'StartCup']];
        owners.forEach((names, i) => names.forEach(name => assert.equal(find(page.root, name).parent, groups[i])));
        const delays = groups.map(group => [...pendingTweens].find(t => t.target === group).steps[0].delay);
        assert.ok(delays.every((value, i) => i === 0 || value > delays[i - 1]));
        const count = descendants(root).length, created = createdTweens;
        for (let i = 0; i < 20; i++) {
            panel.tier = i % 6; store.profile.career.points = i * 4; panel.refresh();
            assert.equal(createdTweens, created); assert.equal(descendants(root).length, count);
        }
        for (const animation of [...pendingTweens]) animation.finish();
        assert.equal(pendingTweens.size, 0);
        for (const group of groups) {
            assert.equal(group.position.x, 0); assert.equal(group.position.y, 0);
            assert.equal(group.getComponent(UIOpacity).opacity, 255);
        }
        [bg, header].forEach((n, i) => { assert.deepEqual({ ...n.position }, fixed[i].position); assert.deepEqual({ ...n.scale }, fixed[i].scale); });
        assert.equal(find(page.root, 'RulesOverlay').parent, find(page.root, 'CareerDesign'));
    } finally { root.destroy(); deferMotion = false; }
});

test('生涯入场期间按钮立即响应，暂存、快速切页与销毁取消动效，重新进入保留节点', () => {
    reset(); deferMotion = true;
    const root = new Node('Root'), panel = new CareerPrototypePanel(root, () => {}, () => {});
    try {
        const count = descendants(root).length;
        for (let i = 0; i < 20; i++) {
            panel.open('career'); assert.ok(pendingTweens.size > 0);
            if (i % 3 === 0) {
                find(panel.page.root, 'RulesButton').click();
                assert.equal(pendingTweens.size, 0); assert.equal(find(panel.page.root, 'RulesOverlay').active, true);
            } else if (i % 3 === 1) {
                panel.setSuspended(true); assert.equal(pendingTweens.size, 0);
                panel.setSuspended(false); assert.ok(pendingTweens.size > 0);
            } else {
                const careerTweens = [...pendingTweens];
                panel.openQuick(); assert.ok(careerTweens.every(animation => !pendingTweens.has(animation)));
            }
            panel.open('home'); assert.equal(pendingTweens.size, 0);
            assert.equal(descendants(root).length, count);
        }
        panel.open('career'); assert.ok(pendingTweens.size > 0);
        find(panel.page.root, 'CareerHonorEntrance').destroy();
    } finally {
        root.destroy(); deferMotion = false;
        assert.equal(pendingTweens.size, 0);
    }
});

test('生涯返回组沿用角色页屏幕左上锚点，安全区翻转只移动主体且遮罩仍盖住返回区', () => {
    reset();
    const oldView={...h.cc.view},oldSafe=h.cc.sys.getSafeAreaRect,events=new Map();
    h.cc.view.on=(event,fn)=>{if(!events.has(event))events.set(event,new Set());events.get(event).add(fn);};
    h.cc.view.off=(event,fn)=>events.get(event)?.delete(fn);
    const canvas=new Node('Canvas');canvas.addComponent(Canvas);canvas.addComponent(UITransform).setContentSize(1280,720);
    const panel=new CareerPrototypePanel(canvas,()=>{},()=>{});find(panel.root,'Action0').click();
    const page=panel.page,header=find(page.root,'CareerHeader'),design=find(page.root,'CareerDesign');
    const back=find(header,'BackToLobby'),art=find(header,'Header'),title=find(header,'PageTitle');
    const count=descendants(canvas).length;
    const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
    try {
        for(const width of [1280,1600,2532/1170*720,1000])for(const [left,right] of [[0,0],[82,0],[0,82],[82,82]]){
            h.cc.view.getVisibleSize=()=>({width,height:720});
            h.cc.sys.getSafeAreaRect=()=>({x:left,y:0,width:width-left-right,height:720});
            for(const fn of events.get('canvas-resize'))fn();
            near(header.position.x+art.position.x-497/2,-width/2);
            near(header.position.x+back.position.x,-width/2+57.5);
            near(header.position.y+back.position.y,321);
            near(title.position.x,-475);near(title.position.y,323.5);
            assert.equal(header.scale.x,1);assert.equal(header.parent,page.root);
            assert.deepEqual(back.getComponent(UITransform).contentSize,{width:76,height:60});
            assert.ok(page.root.children.indexOf(header)<page.root.children.indexOf(design));
            assert.equal(find(page.root,'RulesOverlay').parent,design);
            assert.equal(descendants(canvas).length,count);
        }
    } finally {
        canvas.destroy();assert.ok([...events.values()].every(list=>list.size===0));
        Object.assign(h.cc.view,oldView);h.cc.sys.getSafeAreaRect=oldSafe;
    }
});

test('生涯及快速弹窗暂存后恢复原节点和导航，隐藏期间资料变化延迟显示且退出释放监听', () => {
    for(const screen of ['career','quick']){
        reset();const host=new Node('大厅'),popup=new Node('弹窗层'),visibility=[];
        const panel=new CareerPrototypePanel(host,()=>{},()=>{},{parent:host,popupParent:popup,
            visibility:(...value)=>visibility.push(value),characters(){}});
        if(screen==='quick'){panel.openQuick();find(popup,'Distance400').click();}
        else {store.profile.career.league=2;find(panel.root,'Action0').click();find(panel.page.root,'LeagueTier1').click();}
        const page=panel.page,quick=find(popup,'QuickRacePopup'),count=descendants(host).length+descendants(popup).length;
        const subscriptions=listeners.size;
        for(let i=0;i<20;i++){
            panel.setSuspended(true);
            assert.equal(page.root.active,false);assert.equal(quick.active,false);assert.equal(panel.root.active,false);
            store.profile.characters[ids[0]].level=2+i;
            for(const callback of listeners)callback(store.profile);
            assert.equal(page.root.active,false);assert.equal(quick.active,false);
            panel.setSuspended(false);
            assert.equal(panel.screen,screen);assert.equal(panel.page,page);
            assert.equal(page.root.active,true);assert.equal(quick.active,screen==='quick');
            assert.equal(textOf(screen==='quick'?quick:page.root,screen==='quick'?'QuickLevel':'CharacterLevel'),`LV.${2+i}`);
            assert.equal(screen==='quick'?panel.distance:panel.tier,screen==='quick'?400:1);
            assert.deepEqual(visibility.at(-1),[true,screen==='quick']);
            assert.equal(descendants(host).length+descendants(popup).length,count);assert.equal(listeners.size,subscriptions);
        }
        panel.setSuspended(true);panel.dispose();panel.dispose();
        assert.equal(page.root.isValid,false);assert.equal(quick.isValid,false);
        assert.equal(listeners.size,subscriptions-1);host.destroy();popup.destroy();
    }
});

test('快速比赛复用头像弹窗动效，选项刷新不重播，关闭完成前保留遮罩并拒绝操作', () => {
    reset(); deferMotion = true;
    const host = new Node('大厅'), popup = new Node('弹窗层');
    const events = []; let starts = 0;
    const panel = new CareerPrototypePanel(host, () => starts++, () => {},
        { parent: host, popupParent: popup, visibility: (...args) => events.push(args) });
    const oldView = h.cc.view.getVisibleSize, oldSafe = h.cc.sys.getSafeAreaRect;
    try {
        panel.openQuick();
        const quick = find(popup, 'QuickRacePopup'), motion = find(quick, 'QuickMotion');
        const design = find(quick, 'QuickDesign'), dim = find(quick, 'QuickBackdrop'), blocker = find(quick, 'PopupClosingBlocker');
        assert.equal(motion.scale.x, 0.92); assert.equal(motion.position.y, -16);
        assert.equal(motion.getComponent(UIOpacity).opacity, 0); assert.equal(dim.getComponent(UIOpacity).opacity, 0);
        assert.equal(blocker.parent, quick); assert.equal(dim.parent, quick);
        const count = descendants(popup).length, created = createdTweens;
        for (let i = 0; i < 20; i++) {
            find(quick, i % 2 ? 'Distance200' : 'Distance400').click();
            panel.refresh(); assert.equal(createdTweens, created);
        }
        find(quick, 'Distance400').click(); find(quick, 'RuleStandard').click();
        h.cc.view.getVisibleSize = () => ({ width: 960, height: 720 });
        h.cc.sys.getSafeAreaRect = () => ({ x: 40, y: 0, width: 880, height: 720 });
        panel.page.quick.resize(); assert.equal(motion.scale.x, 0.92); assert.ok(design.scale.x < 1);
        for (const animation of [...pendingTweens]) animation.finish();
        assert.equal(motion.scale.x, 1); assert.equal(motion.position.y, 0); assert.ok(design.scale.x < 1);
        assert.equal(dim.getComponent(UIOpacity).opacity, 255);
        find(quick, 'CloseQuick').click();
        assert.equal(quick.active, true); assert.equal(blocker.active, true); assert.equal(panel.screen, 'quick');
        const closingCreated = createdTweens;
        find(quick, 'Distance200').click(); find(quick, 'StartEvent').click(); find(quick, 'QuickBackdrop').click();
        panel.refresh();
        assert.equal(panel.distance, 400); assert.equal(starts, 0); assert.equal(createdTweens, closingCreated);
        for (const animation of [...pendingTweens]) animation.finish();
        assert.equal(quick.active, false); assert.equal(panel.screen, 'home'); assert.equal(pendingTweens.size, 0);
        assert.deepEqual(events.at(-1), [false, false]);
        panel.openQuick(); assert.equal(panel.distance, 400); assert.equal(panel.rule, 'standard');
        assert.equal(descendants(popup).length, count);
    } finally {
        host.destroy(); popup.destroy(); deferMotion = false;
        h.cc.view.getVisibleSize = oldView; h.cc.sys.getSafeAreaRect = oldSafe;
        assert.equal(pendingTweens.size, 0);
    }
});

test('快速弹窗退场途中暂存或销毁取消旧返回回调，恢复时仅播放一次', () => {
    reset(); deferMotion = true;
    const host = new Node('大厅'), popup = new Node('弹窗层');
    const panel = new CareerPrototypePanel(host, () => {}, () => {}, { parent: host, popupParent: popup, visibility() {} });
    try {
        for (let i = 0; i < 20; i++) {
            panel.openQuick(); const quick = find(popup, 'QuickRacePopup');
            find(quick, 'CloseQuick').click(); const old = [...pendingTweens];
            panel.setSuspended(true); assert.equal(quick.active, false); assert.equal(pendingTweens.size, 0);
            panel.setSuspended(false); const created = createdTweens;
            for (const animation of old) animation.finish();
            panel.refresh(); assert.equal(createdTweens, created); assert.equal(panel.screen, 'quick'); assert.equal(quick.active, true);
            panel.open('home'); assert.equal(pendingTweens.size, 0);
        }
        panel.openQuick(); find(popup, 'CloseQuick').click(); const old = [...pendingTweens];
        panel.dispose(); for (const animation of old) animation.finish(); assert.equal(pendingTweens.size, 0);
    } finally { host.destroy(); popup.destroy(); deferMotion = false; }
});

test('快速比赛仅两组选择，反复切换节点与监听稳定，重复开赛只提交一次', async () => {
    reset(); const root = new Node('Root'); let starts = 0;
    const panel = new CareerPrototypePanel(root, () => starts++, () => {});
    const before = descendants(root).length;
    panel.openQuick();
    for (let i = 0; i < 30; i++) for (const name of ['Distance200', 'Distance400', 'RuleStandard', 'RuleWild']) find(panel.page.root, name).click();
    assert.equal(descendants(root).length, before); assert.equal(listeners.size, 1);
    assert.equal(panel.distance, 400); assert.equal(panel.rule, 'wild');
    assert.equal(find(panel.page.root, 'QuickNotes'), undefined);
    assert.equal(find(panel.page.root, 'QuickRules'), undefined);
    assert.equal(find(panel.page.root, 'Background').active, false);
    assert.equal(find(panel.page.root, 'CareerHeader').active, false);
    for (const n of descendants(root)) if (n.handlers.click) assert.equal(n.handlers.click.length, 1);
    find(panel.page.root, 'StartEvent').click(); find(panel.page.root, 'StartEvent').click();
    find(panel.page.root, 'Distance200').click(); find(panel.page.root, 'CloseQuick').click();
    assert.equal(panel.distance,400);assert.equal(panel.screen,'quick');
    await tick(); assert.equal(starts, 1); assert.equal(store.profile.career.pending.distance, 400);
    find(panel.page.root, 'StartEvent').click(); await tick();
    assert.equal(starts, 1, '退场加载期间不能恢复开赛按钮');
    root.destroy(); assert.equal(listeners.size, 0);
});

test('快速弹窗覆盖独立弹窗层，关闭保持大厅与选择，底部按钮有充足间距', () => {
    reset(); const host=new Node('页面层'), popup=new Node('弹窗层'), events=[];
    const panel=new CareerPrototypePanel(host,()=>{},()=>{},{parent:host,popupParent:popup,
        visibility:(visible,modal)=>events.push([visible,modal])});
    panel.openQuick();const quick=find(popup,'QuickRacePopup');
    assert.equal(quick.active,true);assert.equal(panel.root.active,true);
    assert.deepEqual(events.at(-1),[true,true]);
    assert.ok(find(quick,'QuickBackdrop').getComponent(BlockInputEvents));
    assert.ok(find(quick,'QuickSheet').getComponent(BlockInputEvents));
    const option=find(quick,'RuleWild'),start=find(quick,'StartEvent');
    const gap=option.position.y-option.getComponent(UITransform).contentSize.height/2
        -(start.position.y+start.getComponent(UITransform).contentSize.height/2);
    assert.ok(gap>=44,`玩法与开赛按钮间距${gap}`);
    for(const name of ['Distance200','RuleWild']) {
        assert.equal(find(quick,name+'Check').active,true);
        assert.deepEqual(find(quick,name+'Surface').getComponent(Graphics).strokeColor.values,[43,183,73]);
    }
    const surfaces=['Distance200','Distance400','RuleStandard','RuleWild'].map(name=>find(quick,name+'Surface').getComponent(Graphics));
    const redraws=surfaces.map(g=>g.clears);
    for(let i=0;i<20;i++)find(quick,'Distance200').click();
    assert.deepEqual(surfaces.map(g=>g.clears),redraws,'重复选择不得重绘');
    for(const g of surfaces) {
        assert.equal(g.lineWidth,3);assert.equal(g.shape.r,12);
        assert.equal(g.shape.w+g.lineWidth,360);assert.equal(g.shape.h+g.lineWidth,66);
    }
    assert.equal(find(quick,'DistanceMarker').getComponent(Graphics).shape.r,4);
    assert.ok(!descendants(quick).some(n=>n.name.endsWith('Subtitle')));
    const sheetSize=find(quick,'QuickSheet').getComponent(UITransform).contentSize;
    assert.ok(sheetSize.width<938);assert.ok(Math.abs(sheetSize.width/sheetSize.height-696/436)<0.002);
    find(quick,'Distance400').click();find(quick,'RuleStandard').click();
    assert.equal(find(quick,'Distance200Check').active,false);
    assert.equal(find(quick,'RuleWildCheck').active,false);
    find(quick,'QuickBackdrop').click();
    assert.equal(quick.active,false);assert.equal(panel.root.active,true);assert.deepEqual(events.at(-1),[false,false]);
    panel.openQuick();assert.equal(panel.distance,400);assert.equal(panel.rule,'standard');
    find(quick,'CloseQuick').click();assert.equal(panel.screen,'home');
    panel.dispose();panel.dispose();assert.equal(popup.children.length,0);
    host.destroy();popup.destroy();assert.equal(listeners.size,0);
});

test('更换角色恢复快速弹窗，赛后返回大厅不弹窗，再次打开保留配置', () => {
    reset();const host=new Node('页面层');let navigation;
    const panel=new CareerPrototypePanel(host,()=>{},()=>{},{parent:host,visibility(){},characters:n=>navigation=n});
    panel.openQuick();find(panel.page.root,'Distance400').click();find(panel.page.root,'RuleStandard').click();
    find(panel.page.root,'QuickChangeCharacter').click();
    assert.equal(navigation.screen,'quick');assert.equal(navigation.distance,400);assert.equal(navigation.rule,'standard');
    panel.dispose();panel.root.destroy();chars.selectPlayerCharacter(ids[1]);store.profile.characters[ids[1]].level=7;
    const next=new CareerPrototypePanel(host,()=>{},()=>{},{parent:host,visibility(){},characters(){},navigation});
    assert.equal(next.screen,'quick');assert.equal(next.distance,400);assert.equal(next.rule,'standard');
    assert.equal(textOf(next.page.root,'QuickCharacterName'),chars.findPlayerCharacter(ids[1]).name);
    assert.equal(textOf(next.page.root,'QuickLevel'),'LV.7');
    const name=find(next.page.root,'QuickCharacterName');
    name.getComponent(UITransform).setContentSize(150,44);name.handlers['size-changed'].forEach(f=>f());
    assert.equal(find(next.page.root,'QuickLevelPill').position.x,475+150+12+35-640);
    next.dispose();next.root.destroy();
    const session=load('progression/SoloRaceSession');
    store.profile.career.quick={distance:400,rule:'standard'};
    session.setSoloRaceTicket({id:'quick-return',source:'quick',tier:0,characterId:ids[1]});session.markSoloReturn();
    const popup=new Node('独立弹窗层'),events=[];
    const returned=new CareerPrototypePanel(host,()=>{},()=>{},
        {parent:host,popupParent:popup,visibility:(visible,modal)=>events.push([visible,modal])});
    assert.equal(returned.screen,'home');assert.equal(returned.root.active,true);
    assert.equal(returned.page.root.active,false);assert.equal(find(popup,'QuickRacePopup').active,false);
    assert.ok(!events.some(([visible])=>visible));assert.equal(session.consumeSoloReturn(),null);
    returned.refresh();assert.equal(find(popup,'QuickRacePopup').active,false);
    returned.openQuick();
    assert.equal(find(popup,'QuickRacePopup').active,true);
    assert.equal(returned.distance,400);assert.equal(returned.rule,'standard');
    assert.equal(find(popup,'Distance400Check').active,true);assert.equal(find(popup,'RuleStandardCheck').active,true);
    host.destroy();popup.destroy();session.setSoloRaceTicket(null);assert.equal(listeners.size,0);
});

test('快速比赛保存失败显示就地错误并恢复操作，窄屏安全区不裁切弹窗', async () => {
    reset();const host=new Node('页面层'),panel=new CareerPrototypePanel(host,()=>assert.fail('失败不能开赛'),()=>{});
    panel.openQuick();find(panel.page.root,'Distance400').click();
    const execute=store.executeCareer;store.executeCareer=async()=>{throw new Error('存储失败');};
    const oldSize=h.cc.view.getVisibleSize,oldSafe=h.cc.sys.getSafeAreaRect;
    try {
        find(panel.page.root,'StartEvent').click();await tick();
        assert.match(textOf(panel.page.root,'QuickStatus'),/保存失败/);
        assert.equal(find(panel.page.root,'StartEvent').getComponent(Button).interactable,true);
        assert.equal(find(panel.page.root,'CloseQuick').getComponent(Button).interactable,true);
        assert.equal(panel.distance,400);
        for(const width of [960,1290,1600]) {
            h.cc.view.getVisibleSize=()=>({width,height:720});
            h.cc.sys.getSafeAreaRect=()=>({x:30,y:10,width:width-60,height:700});
            panel.page.quick.resize();const design=find(panel.page.root,'QuickDesign');
            assert.ok(1290*design.scale.x<=width-60);assert.ok(720*design.scale.y<=700);
        }
    } finally {store.executeCareer=execute;h.cc.view.getVisibleSize=oldSize;h.cc.sys.getSafeAreaRect=oldSafe;host.destroy();}
});

test('可视区域原点非零时快速弹窗仍居中，安全区只改变可用尺度',()=>{
    reset();const host=new Node('页面层'),panel=new CareerPrototypePanel(host,()=>{},()=>{});panel.openQuick();
    const oldSize=h.cc.view.getVisibleSize,oldSafe=h.cc.sys.getSafeAreaRect,oldOrigin=h.cc.view.getVisibleOrigin;
    try{
        h.cc.view.getVisibleSize=()=>({width:1600,height:720});
        for(const origin of [-160,0,160]) {
            h.cc.view.getVisibleOrigin=()=>({x:origin,y:20});
            h.cc.sys.getSafeAreaRect=()=>({x:origin+40,y:20,width:1520,height:720});
            panel.page.quick.resize();const design=find(panel.page.root,'QuickDesign');
            assert.equal(design.position.x,0);assert.equal(design.position.y,0);assert.equal(design.scale.x,1);
        }
    }finally{h.cc.view.getVisibleSize=oldSize;h.cc.sys.getSafeAreaRect=oldSafe;h.cc.view.getVisibleOrigin=oldOrigin;host.destroy();}
});

test('横向六级路线默认选中当前联赛，重复切换不重建节点或监听', () => {
    reset();store.profile.career.league=3;store.profile.career.points=64;
    const root=new Node('Root'),panel=new CareerPrototypePanel(root,()=>{},()=>{});
    panel.root.getChildByName('Action0').click();const page=panel.page.root;
    assert.equal(find(page,'LeagueTab'),undefined);assert.equal(find(page,'CupTab'),undefined);
    assert.equal(panel.tier,3);assert.equal(textOf(page,'LeaguePoints'),'64');
    assert.equal(find(page,'LeagueSelection3').active,true);
    assert.equal(find(page,'LeagueSelection1').active,false);
    assert.deepEqual(find(find(page,'LeagueTier3'),'Label').getComponent(Label).color.values,[9,25,67]);
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

test('生涯保存成功后经过真实大厅导航开始比赛，隐藏大厅不阻塞联赛、杯赛及选角返回开赛', async () => {
    const { PrepareRaceFlow } = load('ui/PrepareRaceFlow');
    const session = load('progression/SoloRaceSession');
    for (const [source, restored] of [['league', false], ['cup', false], ['league', true], ['cup', true], ['quick', false]]) {
        reset(); store.profile.career.points = 100; deferMotion = true;
        const root = new Node('Canvas'); root.addComponent(Canvas); root.addComponent(UITransform).setContentSize(1280, 720);
        let starts = 0, saves = 0, finishSave;
        const execute = store.executeCareer;
        store.executeCareer = command => {
            saves++;
            return new Promise(resolve => { finishSave = () => resolve(execute(command)); });
        };
        const flow = new PrepareRaceFlow(root, root, 1280, 720, {
            onStartRace() {
                assert.equal(session.getSoloRaceTicket()?.source, source);
                assert.equal(store.profile.career.pending.source, source, '存档完成后才加载比赛');
                starts++;
            },
            onOpenRoom() { assert.fail('单人比赛不应进入联机房间'); },
        });
        flow._root = root; flow._content = node('大厅', root); flow._previewRoot = node('角色预览', root);
        for (const name of ['buildReadyCharacterPanel', 'buildPreviewPresentation', 'buildReadyActions', 'refreshReadyCharacterInfo']) flow[name] = () => {};
        if (restored) flow._eventReturn = { screen: 'career', tier: 0, source, reviewCupTier: null, characterId: ids[0] };
        try {
            flow.buildReadyScreen(flow._content);
            const panel = flow._careerPanel;
            if (!restored) {
                flow._motion.enter(false);
                if (source === 'quick') panel.openQuick();
                else find(panel.root, 'Action0').click();
            }
            assert.equal(flow._content.active, source === 'quick');
            if (source === 'quick') for (const animation of [...pendingTweens]) animation.finish();
            const button = find(root, source === 'quick' ? 'StartEvent' : source === 'league' ? 'StartLeague' : 'StartCup');
            button.click(); button.click(); await tick();
            assert.equal(starts, 0); assert.equal(saves, 1); assert.equal(panel.busy, true);
            assert.equal(store.profile.career.pending, null, '保存未完成时不能跳过等待');
            finishSave(); await tick();
            if (source === 'quick') {
                assert.equal(starts, 0, '可见大厅保留正常退场');
                for (const animation of [...pendingTweens]) animation.finish();
            }
            assert.equal(starts, 1, `${source} ${restored ? '选角返回' : '首次进入'}必须进入比赛`);
            button.click(); await tick();
            assert.equal(starts, 1, '加载期间不能重复开赛');
        } finally {
            store.executeCareer = execute; flow._motion.dispose(); root.destroy(); deferMotion = false;
        }
        assert.equal(pendingTweens.size, 0); assert.equal(listeners.size, 0);
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
        shape:n.getComponent(Graphics)?.shape,stroke:n.getComponent(Graphics)?.strokeColor?.values,strokeWidth:n.getComponent(Graphics)?.lineWidth,shapeFill:n.getComponent(Graphics)?.fillColor?.values,anchor:n.getComponent(UITransform)?.anchorPoint,fill:n.fill?.values,asset:n.asset,inset:n.getComponent(Sprite)?.spriteFrame?.insetLeft,sliced:n.getComponent(Sprite)?.type===Sprite.Type.SLICED||n.sliced,
        text:n.getComponent(Label)?.string,font:n.getComponent(Label)?.fontSize,weight:n.getComponent(Label)?.projectWeight,lineHeight:n.getComponent(Label)?.lineHeight,verticalAlign:n.getComponent(Label)?.verticalAlign,numberFont:n.getComponent(Label)?.currencyNumberFont,color:n.getComponent(Label)?.color?.values,align:n.getComponent(Label)?.horizontalAlign,tint:n.getComponent(Sprite)?.color?.values,mask:!!n.getComponent(Mask),children:n.children.map(serial)});
    const scenes={lobby:serial(panel.root)};
    panel.root.getChildByName('Action0').click();scenes.league=serial(panel.page.root);store.profile.career.points=20;panel.refresh();scenes.points20=serial(panel.page.root);store.profile.career.points=0;panel.refresh();
    for(let t=0;t<6;t++){panel.tier=t;panel.refresh();scenes['tier-'+t]=serial(panel.page.root);}panel.tier=0;panel.refresh();store.profile.career.points=100;panel.refresh();scenes.open=serial(panel.page.root);
    store.profile.career.league=3;store.profile.career.points=100;
    store.profile.career.cups[ids[0]]={id:'preview',tier:3,round:1,seed:3,state:'active',coins:240};
    panel.tier=3;panel.refresh();scenes.cup=serial(panel.page.root);
    find(panel.page.root,'RulesButton').click();scenes.rules=serial(panel.page.root);panel.page.hide();store.profile.career.league=5;panel.tier=5;store.profile.career.cups[ids[0]]={id:'max',tier:5,round:2,seed:3,state:'won',coins:240};panel.refresh();scenes.max=serial(panel.page.root);
    panel.openQuick();
    const originalSize=h.cc.view.getVisibleSize,originalSafe=h.cc.sys.getSafeAreaRect;
    h.cc.view.getVisibleSize=()=>({width:1290,height:720});h.cc.sys.getSafeAreaRect=()=>({x:0,y:0,width:1290,height:720});
    panel.page.quick.resize();scenes.quick=serial(panel.page.root);
    h.cc.view.getVisibleSize=originalSize;h.cc.sys.getSafeAreaRect=originalSafe;
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
        assert.ok(Math.abs(badge.position.y-current/2-(360-(i===0?437:462)))<1e-6);
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
