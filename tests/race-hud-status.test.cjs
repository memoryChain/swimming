// 执行真实 HUD 显示层及输入路由；覆盖状态边缘和异步头像，不替代引擎验图。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function compiler(){if(process.env.TYPESCRIPT_PATH)return require(process.env.TYPESCRIPT_PATH);try{return require('typescript');}catch{}for(const dir of process.env.PATH.split(path.delimiter)){const p=path.resolve(dir,'../typescript/lib/typescript.js');if(fs.existsSync(p))return require(p);}throw Error('请用 pnpm test:hud');}
const ts=compiler(),root=path.resolve(__dirname,'..');
let writes=0;
class Color{constructor(r=255,g=255,b=255,a=255){Object.assign(this,{r,g,b,a});}equals(c){return this.r===c.r&&this.g===c.g&&this.b===c.b&&this.a===c.a;}static WHITE=new Color();}
class Comp{get isValid(){return this.node.isValid;}}
class UITransform extends Comp{setContentSize(width,height){this.contentSize={width,height};}}
class Label extends Comp{static Overflow={SHRINK:1};static HorizontalAlign={LEFT:0,RIGHT:1,CENTER:2};static VerticalAlign={CENTER:0};set string(s){this._string=s;writes++;}get string(){return this._string;}}
class Sprite extends Comp{static SizeMode={CUSTOM:1};static Type={FILLED:1};static FillType={RADIAL:0,HORIZONTAL:1};color=Color.WHITE;set fillRange(v){this._fillRange=v;writes++;}get fillRange(){return this._fillRange;}}
class Button extends Comp{static Transition={SCALE:1};static EventType={CLICK:'click'};interactable=true;}
class BlockInputEvents extends Comp{}
class Font{}
class Vec2{constructor(x,y){this.x=x;this.y=y;}}
class Node{static EventType={NODE_DESTROYED:'destroy'};children=[];components=[];events={};active=true;isValid=true;scale={x:1,y:1};position={x:0,y:0};constructor(name){this.name=name;}get activeInHierarchy(){return this.active&&(!this.parent||this.parent.activeInHierarchy);}setParent(p){this.parent=p;p.children.push(this);}addComponent(C){const c=new C();c.node=this;this.components.push(c);return c;}getComponent(C){return this.components.find(c=>c instanceof C);}setPosition(x,y){this.position={x,y};}setScale(x,y){this.scale={x,y};}on(e,f){this.events[e]=f;}once(e,f){this.on(e,f);}off(e){delete this.events[e];}destroy(){this.isValid=false;for(const c of this.children)c.destroy();this.events.destroy?.();}}
function load(file,imports,extras={}){const m={exports:{}};const js=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;vm.runInNewContext(js,{require:p=>{assert.ok(imports[p],p);return imports[p];},module:m,exports:m.exports,...extras});return m.exports;}
function fixture(){
 let size={width:1280,height:720},safe={x:0,y:0,...size},jumps=0;const pending=[],listeners=new Map();
 const view={getVisibleSize:()=>size,on:(e,f,ctx)=>listeners.set(e,()=>f.call(ctx)),off:e=>listeners.delete(e)};
 const cc={BlockInputEvents,Button,Color,Font,Label,Node,Sprite,UITransform,Vec2,view,sys:{getSafeAreaRect:()=>safe}};
 const block=fs.readFileSync(path.join(root,'assets/scripts/core/ResourcePaths.ts'),'utf8').match(/raceHudUi: (\{[\s\S]*?\n    \}),/)[1];
 const art=vm.runInNewContext('('+block+')');
 function node(name,p){const n=new Node(name);n.setParent(p);n.addComponent(UITransform);return n;}
 const mod=load('assets/scripts/ui/RaceHudStatusView.ts',{'cc':cc,'../core/ResourcePaths':{RESOURCE_PATHS:{raceHudUi:art}},'../core/RaceBundleLoader':{loadRaceAsset:(p,t,cb)=>cb(null,new Font())},'./AvatarUiAssets':{avatarTexturePath:id=>id,loadAvatarUiSpriteFrame:(p,cb)=>{if(p.startsWith('ui/race-hud'))cb({path:p});else pending.push({p,cb});}},'./ProjectUiFonts':{styleProjectUiLabel:(l,w,h)=>{l.weight=w;l.lineHeight=h;}},'./RuntimeUiFactory':{makeUiNode:node}});
 mod.preloadRaceHudStatus(e=>assert.equal(e,null));const parent=new Node('root');const hud=new mod.RaceHudStatusView(parent,()=>jumps++);
 return {hud,parent,pending,listeners,get jumps(){return jumps;},resize(w,h,l=0,r=0){size={width:w,height:h};safe={x:l,y:0,width:w-l-r,height:h};listeners.get('canvas-resize')();}};
}
function find(n,name){if(n.name===name)return n;for(const c of n.children){const f=find(c,name);if(f)return f;}}
function count(n){return 1+n.children.reduce((s,c)=>s+count(c),0);}
function update(h,charge=1,can=true){h.updateValues(2.37,182,true,.72,20,200,charge,can);}
function roster(){return Array.from({length:8},(_,i)=>({swimmer:{id:i},avatarId:`avatar${i}`}));}
function rows(entries,self=5){return entries.map((e,i)=>({swimmer:e.swimmer,isPlayer:i===self,placement:i+1}));}
test('隐藏时零采样；约10Hz读数，重复值不写文字或填充',()=>{
 const s=fixture();assert.equal(s.hud.consumeSample(100),false);const before=writes;update(s.hud);assert.equal(writes,before);
 s.hud.setVisible(true);assert.equal(s.hud.consumeSample(0),true);for(let i=0;i<5;i++)assert.equal(s.hud.consumeSample(.016),false);assert.equal(s.hud.consumeSample(.025),true);
 update(s.hud);assert.equal(find(s.parent,'SpeedValue').getComponent(Label).string,'2.37');assert.equal(find(s.parent,'EnergyValue').getComponent(Label).string,'72%');assert.equal(find(s.parent,'Percent').getComponent(Label).string,'10%');
 const changed=writes;update(s.hud);assert.equal(writes,changed);
});
test('空蓄气不可点、满蓄气可点一次；隐藏/非比赛状态不跳，按钮阻止穿透',()=>{
 const s=fixture(),n=find(s.parent,'DolphinJumpButton'),button=n.getComponent(Button);s.hud.setVisible(true);update(s.hud,.99);assert.equal(button.interactable,false);n.events.click();assert.equal(s.jumps,0);
 update(s.hud);assert.equal(button.interactable,true);assert.ok(n.getComponent(BlockInputEvents));n.events.click();n.events.click();assert.equal(s.jumps,1);assert.equal(button.interactable,false);
 update(s.hud,1,false);assert.equal(button.interactable,false);s.hud.setVisible(false);n.events.click();assert.equal(s.jumps,1);
});
test('换位保留头像身份，本人只能一处放大，迟到请求和销毁不覆盖',()=>{
 const s=fixture(),entries=roster(),n=count(s.parent);s.hud.setRoster(entries);s.hud.setVisible(true);s.hud.updateRanks(rows(entries));const first=s.pending.splice(0);
 const swapped=[entries[1],entries[0],...entries.slice(2)];s.hud.updateRanks(rows(swapped));for(const q of s.pending.splice(0))q.cb({path:q.p});for(const q of first)q.cb({path:q.p});
 assert.equal(find(find(s.parent,'Rank1'),'Avatar').getComponent(Sprite).spriteFrame.path,'avatar1');
 for(let self=0;self<8;self++){s.hud.updateRanks(rows(entries,self));assert.equal(s.parent.children[0].children[1].children.filter(x=>x.name.startsWith('Rank')&&x.name!=='RankingTitle'&&find(x,'SelfRing').active).length,1);assert.equal(count(s.parent),n);}
 s.hud.setRoster([]);for(const q of s.pending.splice(0))q.cb({path:q.p});assert.equal(find(s.parent,'Rank1').active,false);s.parent.destroy();assert.equal(s.listeners.size,0);
});
test('超宽屏靠边，窄屏圆形等比，所有初始文本框非零',()=>{
 const s=fixture();s.resize(1920,720,40,40);assert.equal(s.hud.root.scale.x,1);assert.equal(find(s.parent,'LeftStatus').position.x,-920);assert.equal(find(s.parent,'RightStatus').position.x,920);
 s.resize(960,720);assert.equal(s.hud.root.scale.x,.75);assert.equal(s.hud.root.scale.x,s.hud.root.scale.y);
 for(const name of ['SpeedValue','HeartValue','EnergyValue','Distance','Percent'])assert.ok(find(s.parent,name).getComponent(UITransform).contentSize.width>0);
});
test('双侧长按仅处理左右划水，不再触发海豚跳手势',()=>{
 let now=0,jumps=0;const held=[];const callbacks=new Proxy({onStrokeHeld:(side,value)=>{held.push([side,value]);return true;},onDolphinJump:()=>jumps++},{get:(o,k)=>o[k]??(()=>{})});
 const mod=load('assets/scripts/core/InputRouter.ts',{'cc':{Node,Vec2,input:{on(){},off(){}},Input:{EventType:{}},EventMouse:{}},'./GameConstants':{StrokeType:{LEFT:0,RIGHT:1}},'./InputTuning':{INPUT_TUNING:{},STROKE_QUALITY_TUNING:{minHoldSeconds:.1}}},{Date:{now:()=>now}});
 const router=new mod.InputRouter(new Node('input'),callbacks);router.handleScreenStroke(0);router.handleScreenStroke(1);now=3000;router.tick();assert.equal(jumps,0);assert.equal(held.length,2);router.handleScreenStrokeEnd(0);router.handleScreenStrokeEnd(1);assert.equal(held.length,4);
});

if(process.env.HUD_LAYOUT_OUTPUT){
 const s=fixture(),entries=roster();s.hud.setRoster(entries);s.hud.setVisible(true);s.hud.consumeSample(0);update(s.hud);s.hud.updateRanks(rows(entries));for(const q of s.pending)q.cb({path:q.p});
 function snapshot(n){const t=n.getComponent(UITransform),l=n.getComponent(Label),sp=n.getComponent(Sprite);return {name:n.name,active:n.active,position:n.position,size:t?.contentSize,label:l?{text:l.string,size:l.fontSize,color:l.color,weight:l.weight,align:l.horizontalAlign}:null,image:sp?.spriteFrame?.path,color:sp?.color,fillType:sp?.fillType,fillStart:sp?.fillStart,fillRange:sp?.fillRange,children:n.children.map(snapshot)};}
 fs.writeFileSync(process.env.HUD_LAYOUT_OUTPUT,JSON.stringify(snapshot(s.hud.root),null,2));
}
