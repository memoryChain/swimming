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
const heartPresentation=load('assets/scripts/ui/HeartRatePresentation.ts',{'cc':{Color}});
function fixture(reservedRatio=0){
 let size={width:1280,height:720},safe={x:0,y:0,...size},jumps=0;const pending=[],listeners=new Map();
 const view={getVisibleSize:()=>size,on:(e,f,ctx)=>listeners.set(e,()=>f.call(ctx)),off:e=>listeners.delete(e)};
 const cc={BlockInputEvents,Button,Color,Font,Label,Node,Sprite,UITransform,Vec2,Vec3,UIOpacity,Tween:{stopAllByTarget(){}},tween:noopTween,view,sys:{getSafeAreaRect:()=>safe}};
 const block=fs.readFileSync(path.join(root,'assets/scripts/core/ResourcePaths.ts'),'utf8').match(/raceHudUi: (\{[\s\S]*?\n    \}),/)[1];
 const art=vm.runInNewContext('('+block+')');
 function node(name,p){const n=new Node(name);n.setParent(p);n.addComponent(UITransform);return n;}
 const constants={StrokeType:{LEFT:'left',RIGHT:'right'},Rating:{PERFECT:'perfect',GOOD:'good',BAD:'bad'}};
 const stroke=load('assets/scripts/ui/RaceStrokeView.ts',{'./HeartRatePresentation':heartPresentation,'cc':cc,'../core/GameConstants':constants,'./RuntimeUiFactory':{makeUiNode:node},'./ProjectUiFonts':{styleProjectUiLabel:(l,w,h)=>{l.weight=w;l.lineHeight=h;}}});
 const mod=load('assets/scripts/ui/RaceHudStatusView.ts',{'./HeartRatePresentation':heartPresentation,'../platform/PlatformManager':{platform:()=>({getTopRightReservedBottomRatio:()=>reservedRatio})},'./RaceStrokeView':stroke,'../core/GameConstants':constants,'cc':cc,'../core/ResourcePaths':{RESOURCE_PATHS:{raceHudUi:art}},'../core/RaceBundleLoader':{loadRaceAsset:(p,t,cb)=>cb(null,new Font())},'./AvatarUiAssets':{avatarTexturePath:id=>id,loadAvatarUiSpriteFrame:(p,cb)=>{if(p.startsWith('ui/race-hud')||p.startsWith('ui/race-stroke'))cb({path:p});else pending.push({p,cb});}},'./ProjectUiFonts':{styleProjectUiLabel:(l,w,h)=>{l.weight=w;l.lineHeight=h;}},'./RuntimeUiFactory':{makeUiNode:node}});
 mod.preloadRaceHudStatus(e=>assert.equal(e,null));const parent=new Node('root');const hud=new mod.RaceHudStatusView(parent,()=>jumps++);
 return {hud,parent,pending,listeners,get jumps(){return jumps;},resize(w,h,l=0,r=0,top=0){size={width:w,height:h};safe={x:l,y:0,width:w-l-r,height:h-top};listeners.get('canvas-resize')();}};
}
function find(n,name){if(n.name===name)return n;for(const c of n.children){const f=find(c,name);if(f)return f;}}
function count(n){return 1+n.children.reduce((s,c)=>s+count(c),0);}
function update(h,charge=1,can=true){h.updateValues(2.37,182,true,.72,20,200,charge,can);}
function roster(){return Array.from({length:8},(_,i)=>({swimmer:{id:i},avatarId:`avatar${i}`}));}
function rows(entries,self=5){return entries.map((e,i)=>({swimmer:e.swimmer,isPlayer:i===self,placement:i+1}));}

function progressSpeedFixture() {
 const h=require('./helpers/cocos-math-harness.cjs').createHarness({'cc/env':{NATIVE:false}});
 const loadModule=p=>h.load(path.join(root,'assets/scripts',p+'.ts'));
 const {SwimmerMotor}=loadModule('swimmer/SwimmerMotor');
 const file=path.join(root,'assets/scripts/entity/Swimmer.ts');
 const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 const swimmerClass=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='Swimmer');
 // 执行真实泳者的模拟步和读数接口，仅替代场景、动画与特殊动作调度。
 const names=['stepSimulation','updateMovementSpeed','movementSpeed','currentSpeed','netSpeed'];
 const methods=swimmerClass.members.filter(n=>names.includes(n.name?.getText(source)));
 assert.equal(methods.length,names.length);
 const js=ts.transpileModule(`class SpeedHarness { ${methods.map(n=>n.getText(source)).join('\n')} }`,
  {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const Harness=vm.runInNewContext(`${js}; SpeedHarness`);
 const swimmer=new Harness(),motor=new SwimmerMotor();
 motor.startRace(0,2.5);
 // 固定内部游速，单独检查真实运动模型的方向及翻滚损失。
 motor._physics.step=state=>state;
 Object.assign(swimmer,{_motor:motor,_movementSpeed:0,isAI:false,
  _ultimate:{tick(){}},_strokeMetrics:{update(){}},
  _phases:{tick:()=>false,updateDiveUnderwaterTimer(){}},node:{position:{x:0,y:0,z:0},emit(){}},
  _courseLayout:{distanceToWorldX:d=>d,clampSwimWorldX:x=>x},_startPosition:{z:0},
  updatePerfectComboIdle(){},updatePerfectZoneGlow(){},
  applyCoursePosition(){this.node.position.x=motor.distance;this.node.position.z=motor.lateralOffset;},
  updateBodyMotion(){},enforcePoolWallBoundary(){}});
 return {swimmer,motor,loadModule};
}

test('速度表显示斜游的完整移动速率，翻滚损速有效，内部及联机姿态游速不变',()=>{
 const {swimmer,motor,loadModule}=progressSpeedFixture();
 const s=fixture();s.hud.setVisible(true);
 const check=()=>{
  const before=motor.distance,beforeLateral=motor.lateralOffset;swimmer.stepSimulation(1/60);
  const actual=Math.hypot(motor.distance-before,motor.lateralOffset-beforeLateral)*60;
  assert.ok(Math.abs(swimmer.movementSpeed-actual)<1e-9);
  assert.equal(swimmer.currentSpeed,2.5);assert.equal(swimmer.netSpeed,2.5);
  s.hud.updateValues(swimmer.movementSpeed,120,false,1,motor.distance,200,0,false);
  assert.equal(find(s.parent,'SpeedValue').getComponent(Label).string,actual.toFixed(2));
 };
 check();assert.ok(Math.abs(swimmer.movementSpeed-2.5)<1e-9);
 motor.correctHeading(Math.PI/3,0,1);
 const before=motor.distance;check();
 assert.ok((motor.distance-before)*60<1.3,'斜游的赛程推进分量较小');
 assert.ok(Math.abs(swimmer.movementSpeed-2.5)<1e-9,'60 度斜游仍显示完整 2.5 米每秒速率');
 loadModule('core/GameBalance').setRaceDifficulty('beginner');
 motor._axialRoll.setState(0,6);check();
 assert.equal(motor.heading,0);assert.ok(swimmer.movementSpeed<1,'调试模式不偏航，翻滚仍会损失推进');
 const source=fs.readFileSync(path.join(root,'assets/scripts/core/GameManager.ts'),'utf8');
 assert.match(source,/statusHud\.updateValues\(player\.movementSpeed,/);
 assert.match(source,/_playerSwimmer\.movementSpeed\.toFixed\(2\)/);
});

test('纯横移与特殊动作计入平面位移，原地旋转及上下起伏为零，步间校正不冒充加速',()=>{
 const {swimmer,motor}=progressSpeedFixture();
 swimmer._phases.tick=dt=>{swimmer.node.position.x+=dt*1.2;swimmer.node.position.z+=dt*0.9;return true;};
 swimmer.stepSimulation(1/60);assert.ok(Math.abs(swimmer.movementSpeed-1.5)<1e-9);
 swimmer._phases.tick=dt=>{swimmer.node.position.z+=dt*2;return true;};
 swimmer.stepSimulation(1/60);assert.ok(Math.abs(swimmer.movementSpeed-2)<1e-9,'赛程没增加的纯横移仍有速度');
 swimmer._phases.tick=()=>false;
 motor.setFlipTurnDistance(motor.distance+20);
 motor.setLateralOffset(3);
 swimmer.stepSimulation(1/30);assert.ok(Math.abs(swimmer.movementSpeed-2.5)<1e-9,'不把步间网络校正及渲染位置差计入移动速度');
 swimmer._phases.tick=()=>{swimmer.node.position.y+=1;return true;};
 swimmer.stepSimulation(1/60);assert.equal(swimmer.movementSpeed,0,'停在墙边或原地动作时归零');
 swimmer.stepSimulation(0);assert.equal(swimmer.movementSpeed,0);
 swimmer._phases.tick=dt=>{swimmer.node.position.x-=dt*3;return true;};
 swimmer.stepSimulation(1/120);assert.ok(Math.abs(swimmer.movementSpeed-3)<1e-9);
 motor.stopRace();assert.equal(swimmer.movementSpeed,0);
 swimmer.stepSimulation(1/60);assert.equal(swimmer._movementSpeed,0);
});
test('隐藏时零采样；约10Hz读数，重复值不写文字或填充',()=>{
 const s=fixture();assert.equal(s.hud.consumeSample(100),false);const before=writes;update(s.hud);assert.equal(writes,before);
 s.hud.setVisible(true);assert.equal(s.hud.consumeSample(0),true);for(let i=0;i<5;i++)assert.equal(s.hud.consumeSample(.016),false);assert.equal(s.hud.consumeSample(.025),true);
 update(s.hud);assert.equal(find(s.parent,'SpeedValue').getComponent(Label).string,'2.37');assert.equal(find(s.parent,'EnergyValue').getComponent(Label).string,'72%');assert.equal(find(s.parent,'Percent').getComponent(Label).string,'10%');
 const changed=writes;update(s.hud);assert.equal(writes,changed);
});
test('体力真正归零才提示耗尽，闪电慢呼吸，隐藏零更新，重开及反复切换不残留',()=>{
 const s=fixture();s.hud.setVisible(true);
 const energy=find(s.parent,'EnergyValue').getComponent(Label),state=find(s.parent,'EnergyState');
 const icon=find(s.parent,'Lightning').getComponent(Sprite),opacity=icon.node.getComponent(UIOpacity);
 const track=find(s.parent,'EnergyTrack').getComponent(Sprite),fill=find(s.parent,'EnergyFill').getComponent(Sprite);
 const initialCount=count(s.parent),normalTrack=track.color,normalIcon=icon.color,normalText=energy.color;
 const sample=ratio=>s.hud.updateValues(2,120,false,ratio,20,200,1,true);
 sample(.001);assert.equal(energy.string,'0%');assert.equal(state.active,false);
 const heart=find(s.parent,'Heart').getComponent(Sprite).color;
 sample(0);assert.equal(state.active,true);assert.equal(state.getComponent(Label).string,'体力耗尽');
 assert.ok(icon.color.equals(new Color(255,73,76)));assert.ok(energy.color.equals(icon.color));
 assert.ok(!track.color.equals(normalTrack));assert.equal(Math.abs(fill.fillRange),0);
 assert.ok(find(s.parent,'Heart').getComponent(Sprite).color.equals(heart),'耗尽不改变心率颜色');
 const before=writes;sample(0);assert.equal(writes,before,'重复耗尽不重写标签或填充');
 for(let i=0;i<48;i++)s.hud.consumeSample(1/60);
 assert.ok(opacity.opacity<=161&&opacity.opacity>=159);assert.equal(writes,before,'呼吸不重写文字');
 s.hud.setVisible(false);const hiddenOpacity=opacity.opacity,hiddenWrites=writes;
 for(let i=0;i<120;i++){assert.equal(s.hud.consumeSample(1/60),false);sample(1);}
 assert.equal(opacity.opacity,hiddenOpacity);assert.equal(writes,hiddenWrites,'隐藏后零采样与写入');
 s.hud.setVisible(true);sample(1);
 assert.equal(state.active,false);assert.equal(energy.string,'100%');assert.equal(opacity.opacity,255);
 assert.ok(icon.color.equals(normalIcon));assert.ok(track.color.equals(normalTrack));assert.ok(energy.color.equals(normalText));
 for(let i=0;i<20;i++){sample(0);s.hud.consumeSample(.4);sample(.001);assert.equal(state.active,false);assert.equal(opacity.opacity,255);}
 assert.equal(count(s.parent),initialCount,'状态切换不重建节点');
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

test('旧质量倍率不再叠加缩放，真实圆盘与新UI共用基础调参',()=>{
 const h=require('./helpers/cocos-math-harness.cjs').createHarness({'cc/env':{NATIVE:false}});
 const {SwimmerMotor}=h.load(path.join(root,'assets/scripts/swimmer/SwimmerMotor.ts'));
 const {STROKE_QUALITY_TUNING:tuning}=h.load(path.join(root,'assets/scripts/core/InputTuning.ts'));
 const motor=new SwimmerMotor(),target={active:false,currentRatio:0,holdSeconds:0,actionSeconds:0,minHoldRatio:0,intervals:[]};
 const original=[tuning.perfectStart,tuning.perfectEnd];
 try {
  let firstWidth;
  for(const scale of [.3,1,1.7]){motor.setConditionQualityScale(scale);const ordinary=motor.strokeTimingGuideForSide('left');const reusable=motor.strokeTimingGuideForSide('left',target);assert.equal(reusable,target);assert.equal(JSON.stringify(reusable),JSON.stringify(ordinary));const p=target.intervals.find(i=>i.rating==='perfect');assert.ok(p);const w=p.endRatio-p.startRatio;if(firstWidth===undefined)firstWidth=w;else assert.equal(w,firstWidth);}
  const previous=target.intervals.find(i=>i.rating==='perfect').startRatio;tuning.perfectStart=.44;tuning.perfectEnd=.5;motor.strokeTimingGuideForSide('right',target);const p=target.intervals.find(i=>i.rating==='perfect');assert.ok(p.startRatio>previous);assert.ok(Math.abs(p.startRatio-.44)<1e-12);assert.ok(Math.abs(p.endRatio-.5)<1e-12);motor.startRace(0,2);motor.update(.3,{isAI:false});motor.setStrokeHeld('right',true,.2);motor.recordStroke('right');motor.update(.05,{isAI:false});motor._rightActions[0].progress=(p.startRatio+p.endRatio)*Math.PI;assert.equal(motor.setStrokeHeld('right',false).strokeQuality,1);
 } finally {[tuning.perfectStart,tuning.perfectEnd]=original;}
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

test('手掌即时响应短按，采样不覆盖按压；新按压优先于旧结算，隐藏重开无残留',()=>{
 const s=fixture(),ui=s.hud.stroke;s.hud.setVisible(true);
 const left=find(s.parent,'LeftStrokeUi'),hand=find(left,'HandButtonVisual'),right=find(find(s.parent,'RightStrokeUi'),'HandButtonVisual');
 const n=count(s.parent),guide={active:false,currentRatio:0,intervals:[]};
 for(let i=0;i<30;i++){
  ui.setPressed('left',true);assert.equal(hand.scale.x,.88);assert.equal(right.scale.x,1);
  ui.updateSide('left',guide);assert.equal(hand.scale.x,.88,'尚未升级成长按也保持按压态');
  ui.showResult('left','perfect');assert.equal(hand.scale.x,.88,'延迟结算不能覆盖新按压');
  ui.setPressed('left',false);assert.equal(hand.scale.x,1);
 }
 ui.showResult('left','good');const good=hand.scale.x;ui.showResult('left','perfect');assert.ok(hand.scale.x>good);
 ui.setPressed('left',true);ui.updateSide('left',{active:true,currentRatio:.4,intervals:[{rating:'perfect',startRatio:.3,endRatio:.5}]});
 assert.equal(find(left,'strokeHand').getComponent(Sprite).color.g,255);
 s.hud.setVisible(false);const before=writes;ui.setPressed('left',true);ui.showResult('left','perfect');ui.updateSide('left',guide);assert.equal(writes,before);
 s.hud.setVisible(true);assert.equal(hand.scale.x,1);assert.equal(hand.getComponent(UIOpacity).opacity,210);assert.equal(count(s.parent),n);
});

test('真实输入在长按门槛前发出按下反馈，松手反馈先于结算，重置清除双侧',()=>{
 let now=0;const events=[];
 const callbacks=new Proxy({onStrokePressChanged:(side,held)=>events.push(['visual',side,held]),onStrokeHeld:(side,held)=>{events.push(['held',side,held]);return true;}},{get:(o,k)=>o[k]??(()=>{})});
 const mod=load('assets/scripts/core/InputRouter.ts',{'cc':{Node,Vec2},'./GameConstants':{StrokeType:{LEFT:0,RIGHT:1}},'./InputTuning':{INPUT_TUNING:{padStrokeDedupeMs:0},STROKE_QUALITY_TUNING:{minHoldSeconds:.1}}},{Date:{now:()=>now}});
 const router=new mod.InputRouter(new Node('input'),callbacks);
 router.handleScreenStroke(0);assert.deepEqual(events,[['visual',0,true]]);
 now=50;router.handleScreenStrokeEnd(0);assert.deepEqual(events,[['visual',0,true],['visual',0,false]],'短按不结算手臂划水');
 events.length=0;router.handleScreenStroke(1);now=200;router.tick();router.handleScreenStrokeEnd(1);
 assert.deepEqual(events,[['visual',1,true],['held',1,true],['visual',1,false],['held',1,false]]);
 events.length=0;router.resetStrokeInput();assert.deepEqual(events,[['visual',0,false],['visual',1,false]]);
});

test('手掌波纹每次按下只散出一圈，扩散淡出；长按仅播一轮，隐藏清空且重开无残留',()=>{
 const s=fixture(),ui=s.hud.stroke;s.hud.setVisible(true);ui.consumeSample(0);
 const left=find(s.parent,'LeftStrokeUi'),right=find(s.parent,'RightStrokeUi');
 const rings=left.children.filter(n=>n.name.startsWith('HandRipple'));
 const others=right.children.filter(n=>n.name.startsWith('HandRipple'));
 const n=count(s.parent),active=()=>rings.filter(r=>r.active).length;
 assert.equal(rings.length,3);assert.equal(active(),0);
 ui.setPressed('left',true);ui.setPressed('left',false);assert.equal(active(),1);assert.equal(others.filter(r=>r.active).length,0);
 const initialScale=rings[0].scale.x,initialAlpha=rings[0].getComponent(UIOpacity).opacity;
 ui.consumeSample(.1);assert.ok(rings[0].scale.x>initialScale);assert.ok(rings[0].getComponent(UIOpacity).opacity<initialAlpha);
 for(let i=0;i<4;i++)ui.consumeSample(.1);assert.equal(active(),1,'一次点按不补发第二圈');
 for(let i=0;i<12;i++)ui.consumeSample(.1);assert.equal(active(),0);
 ui.setPressed('left',true);ui.setPressed('right',true);
 for(let i=0;i<180;i++){ui.consumeSample(1/30);assert.ok(active()<=3);assert.ok(others.filter(r=>r.active).length<=3);assert.equal(count(s.parent),n);}
 assert.equal(active(),0,'长按一轮结束后不再追加');assert.equal(others.filter(r=>r.active).length,0);
 ui.setPressed('left',true);ui.consumeSample(.3);assert.equal(active(),0,'重复按下状态不重播');
 ui.setPressed('left',false);ui.consumeSample(.3);assert.equal(active(),0,'松手不重播');
 ui.setPressed('left',true);assert.equal(active(),1,'再次按下播放新一轮');
 s.hud.setVisible(false);assert.equal(active(),0);assert.equal(others.filter(r=>r.active).length,0);
 for(let i=0;i<10;i++)assert.equal(ui.consumeSample(1),false);
 s.hud.setVisible(true);ui.consumeSample(1);assert.equal(active(),0);assert.equal(count(s.parent),n);
});

test('高清波纹扩大扩散范围，内发光置于底图与手掌之间且只在按下时闪亮',()=>{
 const s=fixture(),ui=s.hud.stroke;s.hud.setVisible(true);ui.consumeSample(0);
 const left=find(s.parent,'LeftStrokeUi'),hand=find(left,'HandButtonVisual'),glow=find(left,'HandInnerGlow');
 const ring=find(left,'HandRipple0');
 assert.ok(ring.getComponent(Sprite).spriteFrame.path.includes('ripple-ring/texture'));
 assert.ok(glow.getComponent(Sprite).spriteFrame.path.includes('inner-glow/texture'));
 assert.ok(hand.children.indexOf(glow)>hand.children.indexOf(find(hand,'strokeButton')));
 assert.ok(hand.children.indexOf(glow)<hand.children.indexOf(find(hand,'strokeHand')));
 assert.equal(glow.active,false);ui.setPressed('left',true);assert.equal(glow.active,true);
 const alpha=glow.getComponent(UIOpacity).opacity;ui.consumeSample(.15);assert.ok(glow.getComponent(UIOpacity).opacity<alpha);
 ui.consumeSample(.35);assert.equal(glow.active,false);assert.ok(ring.scale.x*120>280,'扩散到更大范围');
 ui.setPressed('left',true);assert.equal(glow.active,false,'长按不重播内发光');
 ui.setPressed('left',false);ui.setPressed('left',true);assert.equal(glow.active,true);
 s.hud.setVisible(false);assert.equal(glow.active,false);s.hud.setVisible(true);ui.consumeSample(.1);assert.equal(glow.active,false);
});

test('白点常态带光晕一起移动，完美松手才高亮并同步消失，普通松手不闪光',()=>{
 const s=fixture(),ui=s.hud.stroke;s.hud.setVisible(true);ui.consumeSample(0);
 const left=find(s.parent,'LeftStrokeUi'),dot=find(left,'MovingDot'),glow=find(left,'MarkerGlow');
 const guide={active:true,currentRatio:.4,intervals:[{rating:'perfect',startRatio:.5,endRatio:.8}]};
 ui.setPressed('left',true);assert.equal(glow.active,false,'按下不触发闪光');ui.updateSide('left',guide);
 assert.equal(dot.getComponent(UITransform).contentSize.width,18);assert.equal(glow.active,true);assert.equal(glow.getComponent(UIOpacity).opacity,110);
 for(let i=0;i<10;i++){ui.consumeSample(.1);guide.currentRatio+=.01;ui.updateSide('left',guide);assert.equal(glow.getComponent(UIOpacity).opacity,110);assert.equal(glow.position.x,dot.position.x);assert.equal(glow.position.y,dot.position.y);}
 ui.setPressed('left',false);ui.showResult('left','perfect');guide.active=false;ui.updateSide('left',guide);
 assert.equal(glow.getComponent(UIOpacity).opacity,255);assert.equal(dot.active,true);assert.equal(glow.active,true);
 ui.consumeSample(.1);ui.updateSide('left',guide);assert.ok(glow.getComponent(UIOpacity).opacity<255);assert.equal(dot.getComponent(UIOpacity).opacity,glow.getComponent(UIOpacity).opacity);
 ui.consumeSample(.2);ui.updateSide('left',guide);assert.equal(dot.active,false);assert.equal(glow.active,false);
 ui.setPressed('left',true);guide.active=true;ui.updateSide('left',guide);assert.equal(dot.getComponent(UIOpacity).opacity,255);assert.equal(glow.getComponent(UIOpacity).opacity,110);
 ui.setPressed('left',false);ui.showResult('left','good');guide.active=false;ui.updateSide('left',guide);assert.equal(dot.active,false);assert.equal(glow.active,false);
 ui.showResult('left','perfect');s.hud.setVisible(false);assert.equal(dot.active,false);assert.equal(glow.active,false);s.hud.setVisible(true);ui.consumeSample(.1);assert.equal(glow.active,false);
});


test('心率四档颜色关联本划弧线，不显示宽度文字，心形动画不抖动文字和边界',()=>{
 const s=fixture();s.hud.setVisible(true);const total=count(s.parent);
 const heart=find(s.parent,'Heart'),number=find(s.parent,'HeartValue'),numberPosition={...number.position};
 for(const [hr,label,width,index] of [[80,'轻松',100,0],[120,'发力',80,1],[140,'高压',55,2],[180,'极限',30,3]]){
  s.hud.updateValues(2,hr,false,.5,20,200,.2,false);
  assert.equal(find(s.parent,'HeartTier').getComponent(Label).string,label);
  assert.equal(find(s.parent,'HeartWidth'),undefined);
  assert.ok(heart.getComponent(Sprite).color.equals(heartPresentation.HEART_TIERS[index].color));
  const guide={active:true,heartRate:hr,currentRatio:.375,intervals:[{rating:'perfect',startRatio:.3,endRatio:.45}]};
  s.hud.stroke.updateSide('left',guide);
  const tick=find(find(s.parent,'LeftStrokeUi'),'PerfectBoundary');
  assert.ok(tick.getComponent(Sprite).color.equals(heartPresentation.HEART_TIERS[index].color));
  const point={...tick.position};let max=1;
  for(let i=0;i<120;i++){s.hud.consumeSample(1/120);max=Math.max(max,heart.scale.x);}
  assert.ok(max>1.02);assert.deepEqual(number.position,numberPosition);assert.deepEqual(tick.position,point);
  assert.equal(count(s.parent),total);
 }
 const old={...heart.scale};s.hud.setVisible(false);for(let i=0;i<60;i++)s.hud.consumeSample(1/60);assert.deepEqual(heart.scale,old);
});


test('特殊动作继续自然恢复心率，海豚动画不重复积分，重新开赛归80',()=>{
 const {swimmer,motor}=progressSpeedFixture();motor.applyAuthoritativeHeartRate(180);
 swimmer._phases.tick=dt=>{motor.advanceVisualAnimation(dt);return true;};
 for(let i=0;i<60;i++)swimmer.stepSimulation(1/60);
 assert.ok(Math.abs(motor.heartRate-(80+100*Math.exp(-1/2.5)))<1e-8);
 motor.startRace();assert.equal(motor.heartRate,80);
});

test('海豚蓄势与腾空冻结心率，落水交界帧不提前恢复，旧起划历史仍按真实时间过期',()=>{
 for(const fps of [30,60,120]) {
  const {swimmer,motor}=progressSpeedFixture();
  motor._heartRate.recordStart();motor.applyAuthoritativeHeartRate(100);motor.addHeartRateBurden(25);
  swimmer._phases.isDolphinJumpActive=true;
  swimmer._phases.tick=dt=>{motor.advanceVisualAnimation(dt);return true;};
  for(let i=0;i<fps*3;i++){swimmer.stepSimulation(1/fps);assert.equal(motor.heartRate,125);}
  assert.equal(motor._heartRate.strokeRate,0,'冻结期间采样仍过期，落水不残留旧负荷');
  swimmer._phases.tick=()=>{swimmer._phases.isDolphinJumpActive=false;return true;};
  swimmer.stepSimulation(1/fps);assert.equal(motor.heartRate,125,'阶段跨到落水也不补恢复整帧');
  for(let i=0;i<fps;i++)swimmer.stepSimulation(1/fps);
  assert.ok(Math.abs(motor.heartRate-(80+45*Math.exp(-1/2.5)))<1e-8);
  motor.startRace();assert.equal(motor.heartRate,80);
 }
});
