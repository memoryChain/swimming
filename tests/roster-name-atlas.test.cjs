const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/cocos-math-harness.cjs');

function setup(){
 const pending=[],built=[];let textWrites=0,frameWrites=0;
 const h=createHarness({
  '../core/RaceBundleLoader':{loadRaceAsset:(_p,_t,callback)=>pending.push(callback)},
  '../core/ResourcePaths':{RESOURCE_PATHS:{uiFonts:{semibold:'font'}}},
  './ProjectUiFonts':{styleProjectUiLabel:l=>l.font='随包字体',styleDynamicUiLabel:l=>l.font='全覆盖字体'},
  './RuntimeUiFactory':{makeUiNode:(name,parent)=>{const n=new UiNode(name);n.parent=parent;parent.children.push(n);n.addComponent(UITransform);return n;}},
  './RosterNameAtlas':{RosterNameAtlas:{build:(labels)=>{const atlas={names:labels.map(l=>({frame:{name:l.string},width:40,height:24,x:0,y:0})),ranks:Array.from({length:8},(_,i)=>({rank:i+1})),disposed:0,dispose(){this.disposed++;}};built.push(atlas);return atlas;}}},
 });
 class Comp{enabled=true;destroy(){this.destroyed=true;}}
 class UiNode extends h.Node{
  static EventType={NODE_DESTROYED:'destroy'};
  constructor(name){super();this.name=name;this.components=[];this.events={};this.active=true;}
  addComponent(C){const c=new C();c.node=this;this.components.push(c);return c;}
  getComponent(C){return this.components.find(c=>c instanceof C&&!c.destroyed);}
  once(event,callback){this.events[event]=callback;}
  destroy(){if(!this.isValid)return;this.isValid=false;this.active=false;for(const n of this.children)n.destroy();this.events.destroy?.();}
  destroyAllChildren(){for(const n of this.children)n.destroy();this.children=[];}
 }
 class UITransform extends Comp{setContentSize(width,height){Object.assign(this,{width,height});}}
 class Color{constructor(r,g,b,a=255){Object.assign(this,{r,g,b,a});}}
 class Graphics extends Comp{circle(){}fill(){}}
 class Label extends Comp{static Overflow={SHRINK:1};static HorizontalAlign={CENTER:1};static VerticalAlign={CENTER:1};set string(v){this.text=v;textWrites++;}get string(){return this.text;}}
 class Sprite extends Comp{static SizeMode={CUSTOM:1};set spriteFrame(v){this.frame=v;frameWrites++;}get spriteFrame(){return this.frame;}}
 Object.assign(h.cc,{Node:UiNode,Color,UITransform,Graphics,Label,Sprite,Font:class{},view:{}});
 const {SwimmerNameOverlay}=h.load(h.root+'/assets/scripts/ui/SwimmerNameOverlay.ts');
 const hud=new UiNode('hud'),overlay=new SwimmerNameOverlay();overlay.bind(hud);
 const swimmers=Array.from({length:8},(_,i)=>({node:new UiNode('选手'+i),swimmerName:'姓名'+i}));
 return {overlay,hud,swimmers,pending,built,Label,Graphics,Sprite,counts:()=>({textWrites,frameWrites})};
}

test('名单只生成一次纹理；排名仅切帧，重复值零写入，保留原显隐和宽度',()=>{
 const s=setup();s.overlay.setSwimmers(s.swimmers,s.swimmers[0]);const entries=s.overlay._entries;
 assert.equal(entries.length,7);const original=entries.map(e=>e.root);
 const ranks=entries.map((e,i)=>({swimmer:e.swimmer,placement:i+1}));s.overlay.setLivePlacements(ranks);
 s.pending.shift()(null,{});assert.equal(s.built.length,1);
 for(let i=0;i<entries.length;i++){
  const e=entries[i];assert.equal(e.rankAtlas.spriteFrame,s.built[0].ranks[i]);
  assert.equal(e.nameLabel.font,'全覆盖字体');assert.equal(e.rankLabel.destroyed,true);assert.equal(e.nameLabel.destroyed,true);
  assert.equal(e.rankRoot.getComponent(s.Graphics),undefined);assert.equal(e.rankRoot.active,true);
 }
 const before=s.counts();for(let i=0;i<20;i++)s.overlay.setLivePlacements(ranks);assert.deepEqual(s.counts(),before);
 s.overlay.setLivePlacements(ranks.map((r,i)=>({...r,placement:8-i})));
 assert.equal(s.counts().textWrites,before.textWrites);assert.equal(s.counts().frameWrites,before.frameWrites+7);
 s.overlay.clearPlacements();for(const e of entries){assert.equal(e.rankRoot.active,false);assert.equal(e.nameRoot.position.x,0);}
 s.overlay.setSwimmers(s.swimmers,s.swimmers[0]);assert.deepEqual(entries.map(e=>e.root),original);assert.equal(s.pending.length,0);
});

test('旧字体回调、名单更新、字体失败与销毁不复活旧名牌或泄漏纹理',()=>{
 const s=setup();s.overlay.setSwimmers(s.swimmers,s.swimmers[0]);const old=s.pending.shift();
 s.swimmers[1].swimmerName='更名';s.overlay.setSwimmers(s.swimmers,s.swimmers[0]);old(null,{});assert.equal(s.built.length,0);
 s.pending.shift()(new Error('断网'));assert.equal(s.overlay._atlas,null);assert.ok(s.overlay._entries[0].nameLabel&&!s.overlay._entries[0].nameLabel.destroyed);
 s.overlay.setSwimmers(s.swimmers,s.swimmers[0]);s.overlay.setSwimmers(s.swimmers,s.swimmers[0]);assert.equal(s.pending.length,1);s.pending.shift()(null,{});
 const atlas=s.built[0];s.overlay.setSwimmers(s.swimmers.slice(0,3),s.swimmers[0]);assert.equal(atlas.disposed,1);
 const late=s.pending.shift();s.hud.destroy();late(null,{});assert.equal(s.built.length,1);
 const t=setup();t.overlay.setSwimmers(t.swimmers,t.swimmers[0]);t.pending.shift()(null,{});t.hud.destroy();assert.equal(t.built[0].disposed,1);
});

test('动态昵称截断不拆代理对，空昵称继续显示 AI，名字变化才更换名单页',()=>{
 const s=setup();s.swimmers[1].swimmerName='1234567😀';s.overlay.setSwimmers(s.swimmers,s.swimmers[0]);
 assert.equal(s.overlay._entries[0].displayName,'1234567…');s.pending.shift()(null,{});
 s.swimmers[1].swimmerName='';s.overlay.setSwimmers(s.swimmers,s.swimmers[0]);assert.equal(s.overlay._entries[0].displayName,'AI');assert.equal(s.built[0].disposed,1);
});

test('留白排布有界、无重叠，HiDPI 长昵称超过预算时保留原字体回退',()=>{
 const h=createHarness(),{packRosterNameCells}=h.load(h.root+'/assets/scripts/ui/RosterNameAtlas.ts');
 for(const scale of [1,2,3,4]){
  const sizes=Array.from({length:7},(_,i)=>({width:(i+1)*18*scale,height:24*scale}));
  sizes.push(...Array.from({length:8},()=>({width:22*scale,height:22*scale})));
  const p=packRosterNameCells(sizes);assert.ok(p.width<=1024&&p.height<=1024);assert.equal(p.cells.length,15);
  for(let i=0;i<p.cells.length;i++){
   const a=p.cells[i];assert.ok(a.x>=2&&a.y>=2&&a.x+a.width<=p.width-2&&a.y+a.height<=p.height-2);
   for(const b of p.cells.slice(i+1))assert.ok(a.x+a.width+2<=b.x||b.x+b.width+2<=a.x||a.y+a.height+2<=b.y||b.y+b.height+2<=a.y);
  }
 }
 assert.throws(()=>packRosterNameCells([{width:1024,height:20}]),/预算/);
});

test('纯昵称名单页不生成名次，子帧保留几何与原始尺寸，释放不清理源画布',()=>{
 const h=createHarness(),copies=[];const page={width:0,height:0,getContext:()=>({drawImage:(...args)=>copies.push(args)})};
 const previous=global.document;global.document={createElement:()=>page};
 class Asset{isValid=true;destroy(){this.isValid=false;}}
 class ImageAsset extends Asset{constructor(canvas){super();this.canvas=canvas;}}
 class Texture2D extends Asset{static Filter={LINEAR:1,NONE:0};static WrapMode={CLAMP_TO_EDGE:1};setFilters(){}setMipFilter(){}setWrapMode(){}}
 class SpriteFrame extends Asset{}
 class Rect{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}}
 class Size{constructor(width,height){Object.assign(this,{width,height});}}
 Object.assign(h.cc,{ImageAsset,Texture2D,SpriteFrame,Rect,Size});
 const source={width:20,height:24};
 const label={assemblerData:{canvas:source},renderData:{data:[{x:-9,y:-11},{x:9,y:-11},{x:-9,y:11},{x:9,y:11}]},updateRenderData(){}};
 try{
  const {RosterNameAtlas}=h.load(h.root+'/assets/scripts/ui/RosterNameAtlas.ts');const atlas=RosterNameAtlas.buildNames([label]);
  assert.equal(atlas.ranks.length,0);assert.equal(atlas.names.length,1);assert.equal(copies[0][0],source);
  const name=atlas.names[0];assert.equal(name.width,18);assert.equal(name.height,22);assert.equal(name.frame.packable,false);
  assert.deepEqual({...name.frame.originalSize},{width:20,height:24});
  const frame=name.frame,texture=atlas.texture,image=atlas.image;atlas.dispose();atlas.dispose();
  assert.equal(frame.isValid,false);assert.equal(texture.isValid,false);assert.equal(image.isValid,false);
  assert.equal(page.width,1);assert.equal(page.height,1);assert.deepEqual(source,{width:20,height:24});
 }finally{if(previous===undefined)delete global.document;else global.document=previous;}
});
