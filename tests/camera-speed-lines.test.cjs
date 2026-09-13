const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require(process.env.TYPESCRIPT_PATH||'typescript');
function setup(){
 let reads=0,writes=0;const loads=[];
 class UITransform{setContentSize(w,h){this.width=w;this.height=h;}}
 class Sprite{static SizeMode={CUSTOM:0};}class UIOpacity{opacity=255;}
 class Node{
  isValid=true;active=true;activeInHierarchy=true;children=[];components=[];position={x:0,y:0};
  addComponent(C){const c=new C();this.components.push(c);return c;}
  getComponent(C){return this.components.find(c=>c instanceof C);}
  setSiblingIndex(){}setPosition(x,y){this.position.x=x;this.position.y=y;writes++;}setRotationFromEuler(){writes++;}
 }
 const cc={Node,Sprite,UITransform,UIOpacity,view:{getVisibleSize(){reads++;return {width:1280,height:720};}}};
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('assets/scripts/ui/CameraSpeedLineOverlay.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,require:id=>id==='cc'?cc:id.endsWith('RuntimeUiFactory')?{makeUiNode(name,parent){const n=new Node();n.name=name;n.parent=parent;parent.children.push(n);n.addComponent(UITransform);return n;}}:id.endsWith('AvatarUiAssets')?{loadAvatarUiSpriteFrame:(_,f)=>loads.push(f)}:{RESOURCE_PATHS:{softSpeedStreak:'test'}}});
 const subject=new module.exports.CameraSpeedLineOverlay(),hud=new Node();subject.bind(hud);loads[0]({});
 return {subject,hud,loads,Node,UITransform,get reads(){return reads;},get writes(){return writes;}};
}
test('隐藏时无布局读取或变换；固定六条复用且更新限频',()=>{
 const h=setup();for(let i=0;i<60;i++)h.subject.update(1/60,8,false);
 assert.equal(h.reads,0);assert.equal(h.writes,0);
 for(let i=0;i<60;i++)h.subject.update(1/60,8,true,true,true,.5);
 assert.equal(h.subject._lines.length,6);assert(h.reads<=31);
 assert(h.subject.active);assert(h.subject.consumeVanishingPointRefresh());
 h.subject.update(1/60,8,false);assert(!h.subject.active);assert(!h.subject.consumeVanishingPointRefresh());
});
test('到顶后淡出，落水立即关闭，隐藏父 HUD 不做表现工作',()=>{
 const h=setup();for(let i=0;i<20;i++)h.subject.update(1/60,8,true,true,true,.5);
 for(let i=0;i<60;i++)h.subject.update(1/60,8,true,true,true,-.2);
 assert(!h.subject.active);
 h.subject.update(.1,8,true,true,true,.5);assert(h.subject.active);
 h.hud.activeInHierarchy=false;const before=h.writes;h.subject.update(.1,8,true,true,true,.5);
 assert(!h.subject.active);assert.equal(h.writes,before);
});
test('重建 HUD 后旧异步回调不生效，尺寸重新初始化',()=>{
 const h=setup();h.subject.update(.1,8,true);const old=h.subject._root;old.isValid=false;
 const next=new h.Node();h.subject.bind(next);h.loads[0]({old:true});assert(!h.subject._ready);
 h.loads[1]({fresh:true});h.subject.update(.1,8,true);
 assert(h.subject._lines.every(l=>l.sprite.spriteFrame.fresh));
 assert(h.subject._lines.every(l=>l.node.getComponent(h.UITransform).width>0));
});

test('直线长轴与远离消失点的轨迹一致，向屏幕外发散',()=>{
 const h=setup(),e=h.subject;e.setVanishingPoint(80,40);
 e.update(.04,8,true,true,true,.5);
 function sample(phase){e._phase=phase;e._elapsed=1;e.update(0,8,true,true,true,.5);return {...e._lines[0].node.position};}
 const a=sample(.15),b=sample(.35);
 assert((b.x-a.x)*(a.x-80)+(b.y-a.y)*(a.y-40)>0,'位移必须远离消失点');
 for(const l of e._lines){
  const dx=l.node.position.x-80,dy=l.node.position.y-40,len=Math.hypot(dx,dy),angle=l.angle*Math.PI/180;
  assert((dx*Math.cos(angle)+dy*Math.sin(angle))/len>.999,'线条朝向与射线一致');
 }
});
