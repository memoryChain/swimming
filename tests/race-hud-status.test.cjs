// 执行真实 HUD 显示层及输入路由；覆盖状态边缘和异步头像，不替代引擎验图。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function compiler(){if(process.env.TYPESCRIPT_PATH)return require(process.env.TYPESCRIPT_PATH);try{return require('typescript');}catch{}for(const dir of process.env.PATH.split(path.delimiter)){const p=path.resolve(dir,'../typescript/lib/typescript.js');if(fs.existsSync(p))return require(p);}throw Error('请用 pnpm test:hud');}
const ts=compiler(),root=path.resolve(__dirname,'..');
let writes=0;
class Color{constructor(r=255,g=255,b=255,a=255){Object.assign(this,{r,g,b,a});}equals(c){return this.r===c.r&&this.g===c.g&&this.b===c.b&&this.a===c.a;}static WHITE=new Color();}
class Comp{get isValid(){return this.node.isValid;}}
class UITransform extends Comp{setContentSize(width,height){this.contentSize={width,height};}}
class Label extends Comp{static Overflow={SHRINK:1};static HorizontalAlign={LEFT:0,RIGHT:1,CENTER:2};static VerticalAlign={CENTER:0};set string(s){this._string=s;writes++;}get string(){return this._string;}}
class Sprite extends Comp{static SizeMode={CUSTOM:1};static Type={FILLED:1};static FillType={RADIAL:0,HORIZONTAL:1,VERTICAL:2};color=Color.WHITE;set fillRange(v){this._fillRange=v;writes++;}get fillRange(){return this._fillRange;}}
class Button extends Comp{static Transition={SCALE:1};static EventType={CLICK:'click'};interactable=true;}
class BlockInputEvents extends Comp{}
class Font{}
class UIOpacity extends Comp{opacity=255;}
class Vec3{constructor(x,y,z){Object.assign(this,{x,y,z});}}
const noopTween=()=>({to(){return this;},delay(){return this;},start(){return this;}});
class Vec2{constructor(x,y){this.x=x;this.y=y;}}
class Node{static EventType={NODE_DESTROYED:'destroy'};children=[];components=[];events={};active=true;isValid=true;scale={x:1,y:1};position={x:0,y:0};constructor(name){this.name=name;}get activeInHierarchy(){return this.active&&(!this.parent||this.parent.activeInHierarchy);}setParent(p){this.parent=p;p.children.push(this);}addComponent(C){const c=new C();c.node=this;this.components.push(c);return c;}getComponent(C){return this.components.find(c=>c instanceof C);}setPosition(x,y){this.position={x,y};}setScale(x,y){this.scale=typeof x==='object'?{x:x.x,y:x.y}:{x,y};}on(e,f){this.events[e]=f;}once(e,f){this.on(e,f);}off(e){delete this.events[e];}destroy(){this.isValid=false;for(const c of this.children)c.destroy();this.events.destroy?.();}}
function load(file,imports,extras={}){const m={exports:{}};const js=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;vm.runInNewContext(js,{require:p=>{assert.ok(imports[p],p);return imports[p];},module:m,exports:m.exports,...extras});return m.exports;}
function fixture(reservedRatio=0){
 let size={width:1280,height:720},safe={x:0,y:0,...size},jumps=0;const pending=[],listeners=new Map();
 const view={getVisibleSize:()=>size,on:(e,f,ctx)=>listeners.set(e,()=>f.call(ctx)),off:e=>listeners.delete(e)};
 const cc={BlockInputEvents,Button,Color,Font,Label,Node,Sprite,UITransform,Vec2,Vec3,UIOpacity,Tween:{stopAllByTarget(){}},tween:noopTween,view,sys:{getSafeAreaRect:()=>safe}};
 const block=fs.readFileSync(path.join(root,'assets/scripts/core/ResourcePaths.ts'),'utf8').match(/raceHudUi: (\{[\s\S]*?\n    \}),/)[1];
 const art=vm.runInNewContext('('+block+')');
 function node(name,p){const n=new Node(name);n.setParent(p);n.addComponent(UITransform);return n;}
 const constants={StrokeType:{LEFT:'left',RIGHT:'right'},Rating:{PERFECT:'perfect',GOOD:'good',BAD:'bad'}};
 const stroke=load('assets/scripts/ui/RaceStrokeView.ts',{'cc':cc,'../core/GameConstants':constants,'./RuntimeUiFactory':{makeUiNode:node},'./ProjectUiFonts':{styleProjectUiLabel:(l,w,h)=>{l.weight=w;l.lineHeight=h;}}});
 const mod=load('assets/scripts/ui/RaceHudStatusView.ts',{'../platform/PlatformManager':{platform:()=>({getTopRightReservedBottomRatio:()=>reservedRatio})},'./RaceStrokeView':stroke,'../core/GameConstants':constants,'cc':cc,'../core/ResourcePaths':{RESOURCE_PATHS:{raceHudUi:art}},'../core/RaceBundleLoader':{loadRaceAsset:(p,t,cb)=>cb(null,new Font())},'./AvatarUiAssets':{avatarTexturePath:id=>id,loadAvatarUiSpriteFrame:(p,cb)=>{if(p.startsWith('ui/race-hud')||p.startsWith('ui/race-stroke'))cb({path:p});else pending.push({p,cb});}},'./ProjectUiFonts':{styleProjectUiLabel:(l,w,h)=>{l.weight=w;l.lineHeight=h;}},'./RuntimeUiFactory':{makeUiNode:node}});
 mod.preloadRaceHudStatus(e=>assert.equal(e,null));const parent=new Node('root');const hud=new mod.RaceHudStatusView(parent,()=>jumps++);
 return {hud,parent,pending,listeners,get jumps(){return jumps;},resize(w,h,l=0,r=0,top=0){size={width:w,height:h};safe={x:l,y:0,width:w-l-r,height:h-top};listeners.get('canvas-resize')();}};
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
 for(let self=0;self<8;self++){s.hud.updateRanks(rows(entries,self));assert.equal(find(s.parent,'Ranking').children.filter(x=>x.name.startsWith('Rank')&&x.name!=='RankingTitle'&&find(x,'SelfRing').active).length,1);assert.equal(count(s.parent),n);}
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

test('泳道隐藏本人姓名名次；对手排名为正圆且复用字库，重复排名不写文字',()=>{
 class Graphics extends Comp {circle(x,y,r){this.radius=r;}fill(){}}
 class Vec3{}
 Node.prototype.destroyAllChildren=function(){this.children=[];};
 const cc={Color,Graphics,Label,Node,UITransform,Vec3,view:{}};
 function node(name,p){const n=new Node(name);n.setParent(p);n.addComponent(UITransform);return n;}
 const mod=load('assets/scripts/ui/SwimmerNameOverlay.ts',{'cc':cc,'./RuntimeUiFactory':{makeUiNode:node},'./ProjectUiFonts':{styleProjectUiLabel:(l)=>l.font='项目粗体',styleDynamicUiLabel:(l)=>l.font='动态姓名'}});
 const root=new Node('hud'),self={node:new Node('self'),swimmerName:'本人'},other={node:new Node('other'),swimmerName:'其他选手'};
 const overlay=new mod.SwimmerNameOverlay();overlay.bind(root);overlay.setSwimmers([self,other],self);
 const tags=find(root,'SwimmerNameTags');assert.equal(tags.children.length,1);assert.equal(find(tags,'SwimmerName_self'),undefined);
 for(const tag of tags.children){const badge=find(tag,'Placement'),size=badge.getComponent(UITransform).contentSize;assert.equal(size.width,size.height);assert.equal(badge.getComponent(Graphics).radius,size.width/2);assert.equal(find(badge,'Label').getComponent(Label).font,'项目粗体');}

 const ranks=[{swimmer:self,placement:2},{swimmer:other,placement:1}];overlay.setLivePlacements(ranks);const before=writes;overlay.setLivePlacements(ranks);assert.equal(writes,before);assert.equal(find(tags.children[0],'Label').getComponent(Label).string,'1');
});

test('完赛倒计时重复秒数不重播，末三秒变色，到零隐藏且可开始下一轮',()=>{
 class Vec3{constructor(x,y,z){Object.assign(this,{x,y,z});}}
 class LabelOutline extends Comp{}
 let animations=0;const font=new Font();
 const cc={_decorator:{ccclass:()=>C=>C,property:(...args)=>args.length>=2?undefined:()=>{}},Color,Component:Comp,Graphics:class{},Label,LabelOutline,Layers:{Enum:{UI_2D:1}},Node,Sprite,SpriteFrame:class{},Tween:{stopAllByTarget(){}},tween:()=>({to(){return this;},start(){animations++;}}),UIOpacity:class{},UITransform,Vec3,view:{getVisibleSize:()=>({width:1280,height:720})}};
 const mod=load('assets/scripts/ui/UIController.ts',{'cc':cc,'./RaceHudStatusView':{getRaceCountdownFont:()=>font},'../core/GameBalance':{getRaceDistance:()=>200},'../backend/PlayerData':{},'../core/GameConstants':{Rating:{}},'../core/UltimateEnergyBalance':{ULTIMATE_ENERGY_BALANCE:{}}});
 const ui=new mod.UIController();ui.node=new Node('ui');ui.showFinishCountdown(8);const label=find(ui.node,'Number').getComponent(Label);assert.equal(label.font,font);assert.equal(label.string,'8');const before=writes,n=count(ui.node),a=animations;
 ui.showFinishCountdown(8);assert.equal(writes,before);assert.equal(animations,a);
 ui.showFinishCountdown(3);assert.equal(label.string,'3');assert.equal(label.color.g,66);assert.equal(label.fontSize,120);assert.equal(count(ui.node),n);
 ui.showFinishCountdown(0);assert.equal(find(ui.node,'FinishCountdown').active,false);ui.showFinishCountdown(8);assert.equal(find(ui.node,'FinishCountdown').active,true);assert.equal(label.color.g,234);
});

test('动态完美区随判定快照收缩和移动；左右镜像、白点与边界共线，隐藏零更新',()=>{
 const s=fixture(),ui=s.hud.stroke;s.hud.setVisible(true);
 const guide={active:true,currentRatio:.4,intervals:[{rating:'perfect',startRatio:.3,endRatio:.5}]};
 ui.updateSide('left',guide);ui.updateSide('right',guide);
 const l=find(s.parent,'LeftStrokeUi'),r=find(s.parent,'RightStrokeUi'),band=find(l,'PerfectBand0').getComponent(Sprite),dot=find(l,'MovingDot');
 assert.equal(dot.position.x,-find(r,'MovingDot').position.x);assert.equal(dot.position.y,find(r,'MovingDot').position.y);
 assert.ok(Math.abs(band.fillRange-177*.2/186)<1e-9);const initial=band.fillStart,n=count(s.parent);
 guide.intervals[0]={rating:'perfect',startRatio:.6,endRatio:.7};guide.currentRatio=.6;ui.updateSide('left',guide);
 assert.ok(Math.abs(band.fillRange-177*.1/186)<1e-9);assert.notEqual(band.fillStart,initial);assert.equal(count(s.parent),n);
 const boundary=l.children.filter(c=>c.name==='PerfectBoundary')[0];assert.equal(boundary.position.x,dot.position.x);assert.equal(boundary.position.y,dot.position.y);
 assert.equal(find(r,'PerfectBand0').getComponent(Sprite).fillStart,initial);
 const changes=writes;ui.updateSide('left',guide);assert.equal(writes,changes);
 s.hud.setVisible(false);assert.equal(ui.consumeSample(10),false);const y=dot.position.y;guide.currentRatio=.9;ui.updateSide('left',guide);assert.equal(dot.position.y,y);
});

test('评价按照实际手别显示；两侧独立，失误不显示负面文字',()=>{
 const s=fixture();s.hud.setVisible(true);s.hud.showStrokePraise('right','Crazy',new Color(255,100,180),5);
 assert.equal(find(find(s.parent,'RightStrokeUi'),'Praise').getComponent(Sprite).spriteFrame.path,'ui/race-stroke-v1/praise-crazy/texture');assert.equal(find(find(s.parent,'RightStrokeUi'),'Combo').getComponent(Label).string,'x5');assert.equal(find(find(s.parent,'LeftStrokeUi'),'Praise').getComponent(Sprite).spriteFrame,undefined);
 s.hud.showStrokePraise('left','Good',new Color(80,240,160),0);assert.equal(find(find(s.parent,'LeftStrokeUi'),'Combo').getComponent(Label).string,'');s.hud.showStrokePraise('left','',undefined,0);assert.equal(find(find(s.parent,'LeftStrokeUi'),'Praise').getComponent(Sprite).spriteFrame.path,'ui/race-stroke-v1/praise-good/texture');
});

test('真实圆盘与新UI复用同一动态判定区，状态缩放和调参移动后快照保持一致',()=>{
 const h=require('./helpers/cocos-math-harness.cjs').createHarness({'cc/env':{NATIVE:false}});
 const {SwimmerMotor}=h.load(path.join(root,'assets/scripts/swimmer/SwimmerMotor.ts'));
 const {STROKE_QUALITY_TUNING:tuning}=h.load(path.join(root,'assets/scripts/core/InputTuning.ts'));
 const motor=new SwimmerMotor(),target={active:false,currentRatio:0,holdSeconds:0,actionSeconds:0,minHoldRatio:0,intervals:[]};
 const original=[tuning.perfectStart,tuning.perfectEnd,tuning.qualityZoneScaleStrength];
 try {
  tuning.qualityZoneScaleStrength=1;
  let firstWidth;
  for(const scale of [.3,1,1.7]){motor.setConditionQualityScale(scale);const ordinary=motor.strokeTimingGuideForSide('left');const reusable=motor.strokeTimingGuideForSide('left',target);assert.equal(reusable,target);assert.equal(JSON.stringify(reusable),JSON.stringify(ordinary));const p=target.intervals.find(i=>i.rating==='perfect');assert.ok(p);const w=p.endRatio-p.startRatio;if(firstWidth===undefined)firstWidth=w;else assert.ok(w>firstWidth);}
  const previous=target.intervals.find(i=>i.rating==='perfect').startRatio;tuning.perfectStart=.44;tuning.perfectEnd=.5;motor.strokeTimingGuideForSide('right',target);const p=target.intervals.find(i=>i.rating==='perfect');assert.ok(p.startRatio>previous);assert.equal(motor.ratingForGuideRatio((p.startRatio+p.endRatio)/2,null,1),'perfect');
 } finally {[tuning.perfectStart,tuning.perfectEnd,tuning.qualityZoneScaleStrength]=original;}
});

test('弧线尾端对应原划水结束进度，区间与白点统一归一化，不改变松手窗口',()=>{
 const s=fixture();s.hud.setVisible(true);const ui=s.hud.stroke;
 ui.updateSide('left',{active:true,currentRatio:.4,displayEndRatio:.5,intervals:[{rating:'perfect',startRatio:.34,endRatio:.46}]});
 const l=find(s.parent,'LeftStrokeUi'),dot=find(l,'MovingDot'),band=find(l,'PerfectBand0').getComponent(Sprite);
 assert.equal(dot.position.y,-Math.round(401+177*.8));assert.ok(Math.abs(band.fillRange-177*.24/186)<1e-9);
});

test('起跳按源稿定位；满气按钮面与蓄气圆环互斥，点击后恢复蓄气态',()=>{
 const s=fixture(),button=find(s.parent,'DolphinJumpButton'),charge=find(s.parent,'JumpChargingVisual'),face=find(s.parent,'ReadyFace');s.hud.setVisible(true);update(s.hud,.5);
 assert.equal(button.position.x,-131);assert.equal(button.position.y,-449);assert.equal(face.position.x,1);assert.equal(face.position.y,0);assert.equal(charge.active,true);assert.equal(face.active,false);
 update(s.hud,1);assert.equal(charge.active,false);assert.equal(face.active,true);button.events.click();assert.equal(charge.active,true);assert.equal(face.active,false);
});
test('评价固定保持定稿方位和高度，不跟随动态完美区移动',()=>{
 const s=fixture();s.hud.setVisible(true);const ui=s.hud.stroke;ui.updateSide('left',{active:true,currentRatio:.2,intervals:[{rating:'perfect',startRatio:.1,endRatio:.2}]});
 s.hud.showStrokePraise('left','Good',undefined,0);const feedback=find(find(s.parent,'LeftStrokeUi'),'StrokePraise');assert.equal(feedback.position.x,335);assert.equal(feedback.position.y,-533);
 ui.updateSide('left',{active:true,currentRatio:.8,intervals:[{rating:'perfect',startRatio:.7,endRatio:.9}]});s.hud.showStrokePraise('left','Crazy',undefined,5);assert.equal(feedback.position.x,335);assert.equal(feedback.position.y,-533);
});


test('排行保持靠右并下移避开胶囊，安全区不重复叠加，其余控件不移动',()=>{
 for(const [w,h,l,r,top] of [[1280,720,0,0,0],[1920,720,100,0,0],[1920,720,100,100,0],[960,720,0,0,0],[1280,720,0,0,150]]){
  const plain=fixture(),s=fixture(.18);plain.resize(w,h,l,r,top);s.resize(w,h,l,r,top);
  const scale=s.hud.root.scale.x,right=find(s.parent,'RightStatus'),ranking=find(s.parent,'Ranking');
  const title=find(s.parent,'RankingTitle'),capsuleBottom=h*.18;
  const titleTop=h/2-(right.position.y+ranking.position.y+title.position.y+title.getComponent(UITransform).contentSize.height/2)*scale;
  assert.ok(titleTop>=capsuleBottom+12*scale-1e-8);
  assert.equal(ranking.position.x,0);
  for(const name of ['RightStatus','DolphinJumpButton','RightStrokeUi','LeftStatus','CourseProgress'])assert.deepEqual(find(s.parent,name).position,find(plain.parent,name).position);
  const n=count(s.parent);s.resize(w,h,l,r,top);assert.equal(count(s.parent),n);
  if(top>=capsuleBottom+12*scale)assert.ok(ranking.position.y===0);
  s.hud.setVisible(true);s.hud.setVisible(false);s.hud.setVisible(true);assert.equal(count(s.parent),n);
 }
});
