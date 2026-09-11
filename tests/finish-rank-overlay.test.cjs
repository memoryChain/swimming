const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/cocos-math-harness.cjs');
let labelWrites=0,projections=0;
const h=createHarness({'./ProjectUiFonts':{styleProjectUiLabel:l=>l.font='项目粗体',styleDynamicUiLabel:l=>l.font='动态昵称'},'./RuntimeUiFactory':{makeUiNode:(name,parent)=>{const n=new UiNode(name);n.parent=parent;parent.children.push(n);n.addComponent(UITransform);return n;}}});
class UiNode extends h.Node{
 constructor(name){super();this.name=name;this.components=[];this.active=true;}
 get activeInHierarchy(){return this.active&&(!this.parent||this.parent.activeInHierarchy);}
 addComponent(C){const c=new C();c.node=this;this.components.push(c);return c;}
 getComponent(C){return this.components.find(c=>c instanceof C);}
 setSiblingIndex(){} destroy(){this.isValid=false;this.active=false;}
}
class UITransform{setContentSize(w,height){this.width=w;this.height=height;}convertToNodeSpaceAR(v,out){return h.Vec3.copy(out,v);}}
class Color{constructor(r,g,b,a=255){Object.assign(this,{r,g,b,a});}}
class Graphics{circle(x,y,r){this.radius=r;}fill(){}}
class Label{static Overflow={SHRINK:1};static HorizontalAlign={CENTER:1};static VerticalAlign={CENTER:1};set string(v){this.text=v;labelWrites++;}get string(){return this.text;}}
Object.assign(h.cc,{Node:UiNode,UITransform,Color,Graphics,Label,view:{getVisibleSize:()=>({width:800,height:600})}});
const shared=h.load(h.root+'/assets/scripts/ui/SwimmerNameOverlay.ts');
const {FinishRankOverlay}=h.load(h.root+'/assets/scripts/ui/FinishRankOverlay.ts');
function setup(){const hud=new UiNode('hud');hud.addComponent(UITransform).setContentSize(800,600);const overlay=new FinishRankOverlay();overlay.bind(hud);const camera={node:{worldPosition:new h.Vec3(),worldRotation:new h.Quat()}},uiCamera={screenToWorld:(v,out)=>h.Vec3.copy(out,v)};return {overlay,hud,camera,uiCamera};}
function result(rank,x,top,self=false){const node=new UiNode('选手'+rank);return {placement:rank,isPlayer:self,name:'海霸王',swimmer:{node,swimmerName:'海霸王',getNameTagWorldPosition:out=>out.set(0,0,-10),getHeadTopScreenPosition:(_,out)=>{projections++;return out.set(x,top,0);}}};}

test('终点与泳道共用圆标和昵称样式，无背景长条；头顶留白且互不遮挡',()=>{
 const s=setup(),a=result(1,0,30,true),b=result(2,10,65);s.overlay.addResult(a);s.overlay.addResult(b);s.overlay.addResult(a);
 const root=s.hud.children[0];assert.equal(root.children.length,2);
 const badge=root.children[0],rank=badge.children[0],name=badge.children[1];
 assert.equal(badge.getComponent(Graphics),undefined);assert.equal(rank.getComponent(Graphics).radius,11);assert.equal(rank.getComponent(Graphics).fillColor.r,255);
 const live=shared.makeSwimmerNameLabel('对照',s.hud,'海霸王');assert.equal(name.getComponent(Label).font,live.root.getComponent(Label).font);assert.equal(name.getComponent(Label).fontSize,15);
 s.overlay.update(s.camera,s.uiCamera,.04);
 const tags=root.children;for(const tag of tags){assert.equal(tag.active,true);assert.ok(tag.position.y-12*tag.scale.y>=75,'全部名牌都在相邻最高头顶留白以上');}
 assert.ok(Math.abs(tags[0].position.y-tags[1].position.y)>=28);
 const before=labelWrites;s.overlay.update(s.camera,s.uiCamera,.04);assert.equal(labelWrites,before,'投影不重写昵称或名次');
});
test('屏幕顶部无空间则隐藏，离屏与隐藏层无投影，重开能恢复',()=>{
 const s=setup();s.overlay.addResult(result(1,0,294));s.overlay.update(s.camera,s.uiCamera,.04);assert.equal(s.hud.children[0].children[0].active,false);
 s.overlay.setHeadBadgesVisible(false);const count=projections;s.overlay.update(s.camera,s.uiCamera,1);assert.equal(projections,count);
 s.overlay.clear();s.overlay.addResult(result(2,0,30));s.overlay.setHeadBadgesVisible(true);s.overlay.update(s.camera,s.uiCamera,.04);assert.equal(s.hud.children[0].children.at(-1).active,true);
});
