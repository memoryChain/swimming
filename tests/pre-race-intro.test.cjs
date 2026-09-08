// 执行真实开场显示层，验证阶段、重复挂载、身份与异步资源竞争。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const directory of process.env.PATH.split(path.delimiter)) {
        const candidate = path.resolve(directory, '../typescript/lib/typescript.js');
        if (fs.existsSync(candidate)) return require(candidate);
    }
    throw new Error('请运行 pnpm test:pre-race');
}
const ts = compiler();
const root = path.resolve(__dirname, '..');
class Color { constructor(r=255,g=255,b=255,a=255){Object.assign(this,{r,g,b,a});} }
class Component { get isValid(){return this.node.isValid;} }
class UITransform extends Component { setContentSize(width,height){this.contentSize={width,height};} }
class Label extends Component { static HorizontalAlign={LEFT:0,CENTER:1};static Overflow={SHRINK:1}; string=''; }
class Sprite extends Component { static SizeMode={CUSTOM:1};spriteFrame=null; }
class Graphics extends Component { clear(){} roundRect(){} fill(){} }
class Mask extends Component { static Type={GRAPHICS_STENCIL:1}; }
class UIOpacity extends Component {opacity=255;}
class Node {
    static EventType={NODE_DESTROYED:'destroy'};
    active=true;isValid=true;children=[];components=[];events={};scale={x:1,y:1};position={x:0,y:0};
    constructor(name){this.name=name;}
    addComponent(C){const c=new C();c.node=this;this.components.push(c);if(C===Mask)this.addComponent(Graphics);return c;}
    getComponent(C){return this.components.find(c=>c instanceof C);}
    setPosition(x,y){this.position={x,y};}setScale(x,y){this.scale={x,y};}
    once(e,f){this.events[e]=f;}
    destroy(){this.isValid=false;for(const c of this.children)c.destroy();this.events.destroy?.();}
}
function setup(){
    let size={width:1290,height:720},inset=0;const events=new Map(),pending=[],tweens=[];
    const view={getVisibleSize:()=>size,getFrameSize:()=>size,on:(e,f)=>events.set(e,f),off:e=>events.delete(e)};
    const sys={getSafeAreaRect:()=>({x:inset,y:0,width:size.width-inset,height:size.height})};
    function makeUiNode(name,parent){const n=new Node(name);parent.children.push(n);n.parent=parent;n.addComponent(UITransform);return n;}
    function makeLabel(name,parent,text,size,color){const n=makeUiNode(name,parent);const l=n.addComponent(Label);Object.assign(l,{string:text,fontSize:size,color});return n;}
    const art={};for(const k of ['eventStrip','cardNormal','cardSelf','laneNormal','laneSelf','selfTag'])art[k]=k;
    const definitions=Array.from({length:8},(_,i)=>({id:`model${i}`,modelVariantId:`model${i}`,name:`角色${i}`}));
    const portraits=Object.fromEntries(definitions.map(d=>[d.id,d.id]));
    const cc={Color,Graphics,Label,Mask,Node,Sprite,UIOpacity,UITransform,sys,view,
        Tween:{stopAllByTarget:o=>{for(const t of tweens)if(t.o===o)t.stopped=true;}},
        tween:o=>{const t={o,to(_s,values){this.values=values;return this;},call(f){this.cb=f;return this;},start(){tweens.push(this);return this;}};return t;}};
    const imports={cc,'../app/PlayerCharacterConfig':{PLAYER_CHARACTER_DEFINITIONS:definitions},
        '../core/ResourcePaths':{RESOURCE_PATHS:{preRaceUi:art,characterUi:{portraits}}},
        './AvatarUiAssets':{loadAvatarUiSpriteFrame:(p,cb)=>pending.push({p,cb})},
        './ProjectUiFonts':{styleDynamicUiLabel:l=>{l.fontWeight='dynamic';},styleProjectUiLabel:(l,w)=>{l.fontWeight=w;if(l.overflow!==Label.Overflow.SHRINK)l.node.getComponent(UITransform).setContentSize(l.string.length*l.fontSize,l.fontSize+7);}},'./RuntimeUiFactory':{makeLabel,makeUiNode}};
    const mod={exports:{}};
    const source=fs.readFileSync(path.join(root,'assets/scripts/ui/PreRaceIntroPanel.ts'),'utf8');
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
        {require:p=>{assert.ok(imports[p],p);return imports[p];},module:mod,exports:mod.exports});
    const panel=new mod.exports.PreRaceIntroPanel();const parent=new Node('root');panel.build(parent,1290,720);
    const finish=()=>{for(const t of tweens.splice(0)){if(!t.stopped){Object.assign(t.o,t.values);t.cb?.();}}};
    const resolve=()=>{for(const q of pending.splice(0))q.cb({path:q.p});};
    const resize=(width,height,left=0)=>{size={width,height};inset=left;events.get('canvas-resize')?.();};
    return {panel,parent,pending,tweens,finish,resolve,resize,events,compact:mod.exports.compactIntroName};
}
function find(node,name){if(node.name===name)return node;for(const child of node.children){const result=find(child,name);if(result)return result;}}
function count(node){return 1+node.children.reduce((s,n)=>s+count(n),0);}
function entries(self=4){return Array.from({length:8},(_,i)=>({lane:i+1,name:`成员${i}`,isPlayer:i===self,modelVariantId:`model${i}`}));}
test('赛制条跨名单阶段保留；每个状态边缘只播放一次，退出取消动画',()=>{
    const s=setup();s.panel.setPhase('raceInfo');s.finish();
    assert.equal(find(s.parent,'EventStrip').active,true);assert.equal(find(s.parent,'CompetitorCards').active,false);
    s.panel.setPhase('roster');assert.equal(s.tweens.length,1);s.finish();
    for(let i=0;i<60;i++)s.panel.setPhase('roster');assert.equal(s.tweens.length,0);
    s.panel.setPhase('hidden');s.panel.setPhase('roster');s.finish();
    assert.equal(find(s.parent,'CompetitorCards').active,true);
    s.panel.setPhase('hidden');s.finish();assert.equal(find(s.parent,'EventStrip').active,false);
});
test('任意泳道本人唯一，复用节点，乱序名单仍按泳道，不完整名单保留槽位',()=>{
    const s=setup();const initial=count(s.parent);
    for(let self=0;self<8;self++){
        s.panel.populate(entries(self).reverse());s.resolve();
        let tags=0;for(let lane=1;lane<=8;lane++){
            const card=find(s.parent,`LaneCard${lane}`);tags+=find(card,'SelfTag').active?1:0;
            assert.equal(find(card,'LaneNumber').getComponent(Label).string,String(lane));
            assert.equal(find(card,'Portrait').getComponent(Sprite).spriteFrame.path,`model${lane-1}`);
        }assert.equal(tags,1);assert.equal(count(s.parent),initial);
    }
    const before=s.pending.length;s.panel.populate(entries(7));assert.equal(s.pending.length,before);
    s.panel.populate([entries()[4]]);assert.equal(find(s.parent,'LaneCard1').active,false);assert.equal(find(s.parent,'LaneCard5').active,true);
    s.panel.build(s.parent,1290,720);assert.equal(count(s.parent),initial);
});
test('旧立绘回调不能覆盖新角色，也不能复活空槽、改掉本人底板显隐',()=>{
    const s=setup();s.resolve();s.panel.populate([entries()[0]]);
    const old=s.pending.pop();s.panel.populate([{...entries()[0],modelVariantId:'model1',isPlayer:true}]);
    const next=s.pending.pop();next.cb({path:'new'});old.cb({path:'old'});
    const card=find(s.parent,'LaneCard1');assert.equal(find(card,'Portrait').getComponent(Sprite).spriteFrame.path,'new');
    s.panel.populate([]);next.cb({path:'late'});assert.equal(card.active,false);assert.equal(find(card,'Portrait').active,false);
    s.parent.destroy();old.cb({path:'destroyed'});assert.equal(s.events.size,0);
});
test('窄屏/宽屏等比适配，长昵称截断且不拆 UTF-16 代理对',()=>{
    const s=setup();s.resize(960,720);assert.ok(Math.abs(s.panel.node.scale.x-960/1290)<1e-9);
    s.resize(1920,720,80);assert.equal(s.panel.node.scale.x,1);assert.equal(s.panel.node.position.x,40);
    assert.equal(s.compact('一二三四五六七八',10),'一二三四五…');
    assert.equal(s.compact('😀😀😀',4),'😀😀…');
    assert.equal(s.compact('A\nB',10),'A B');
});

// 可选导出真实节点布局，供离线检查使用；不把组件替身视作引擎渲染。
if (process.env.PRE_RACE_PREVIEW_OUTPUT) {
    const s=setup();s.panel.populate(entries());s.resolve();
    s.panel.setRaceInfo({format:'标准竞速赛',event:'200米自由泳',details:'8人竞速  ·  竞技难度',rule:'率先完成全程者获胜'});
    s.panel.setPhase('roster');s.finish();
    function snapshot(n) {
        const t=n.getComponent(UITransform),l=n.getComponent(Label),sp=n.getComponent(Sprite);
        return {name:n.name,active:n.active,position:n.position,size:t?.contentSize,
            label:l?{text:l.string,size:l.fontSize,color:l.color,weight:l.fontWeight,align:l.horizontalAlign}:null,
            image:sp?.spriteFrame?.path,clip:n.name==='PortraitClip',children:n.children.map(snapshot)};
    }
    fs.writeFileSync(process.env.PRE_RACE_PREVIEW_OUTPUT,JSON.stringify(snapshot(s.panel.node),null,2));
}

test('缓存字体同步测量空文本时，赛制、泳道与角色名仍保留设计文本框',()=>{
    const s=setup();
    for(const [name,width,height] of [['Mode',205,20],['Event',205,36],['Details',260,28],['Rule',265,26],['LaneNumber',43,34],['CharacterName',124,22]]){
        const n=find(s.parent,name);assert.deepEqual(n.getComponent(UITransform).contentSize,{width,height});
    }
    s.panel.populate(entries());
    s.panel.setRaceInfo({format:'标准竞速赛',event:'200米自由泳',details:'8人竞速',rule:'率先完成全程者获胜'});
    for(const name of ['Mode','Event','Details','Rule','LaneNumber','CharacterName']){
        const n=find(s.parent,name);assert.ok(n.getComponent(Label).string);assert.ok(n.getComponent(UITransform).contentSize.width>0);
    }
});
