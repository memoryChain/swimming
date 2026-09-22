const test=require('node:test'), assert=require('node:assert/strict'), path=require('node:path');
const {createHarness}=require('./helpers/cocos-math-harness.cjs');

test('八条泳道复用浮圈，共享闪退、晚加载、20轮清理和销毁后回调',()=>{
    const pending=[];
    const h=createHarness({'./CharacterModelLoader':{
        loadSwimmerPrefab:cb=>pending.push(cb),setLayerRecursive:(n,layer)=>{n.layer=layer;},
    }});
    let created=0;
    h.Node.prototype.setParent=function(p){this.parent=p;p.children.push(this);};
    h.Node.prototype.destroy=function(){this.isValid=false;this.active=false;};
    h.cc.instantiate=()=>{created++;return new h.Node();};
    const {RecoveryFloatPresentation}=h.load(path.join(h.root,'assets/scripts/character/RecoveryFloatPresentation.ts'));
    const owners=Array.from({length:8},()=>new h.Node());
    const items=owners.map(n=>new RecoveryFloatPresentation(n));
    const pose={ready:true,position:new h.Vec3(.8,.08,0),rotation:new h.Quat(),radius:.3};
    items.forEach(i=>i.update(pose,1));
    items[0].setBlinkVisible(false);
    pending.forEach(cb=>cb(null,{prefab:{}}));
    assert.equal(created,8);assert.equal(owners[0].children[0].active,false);
    for(let round=0;round<20;round++) for(let i=0;i<8;i++){
        items[i].setBlinkVisible(true);items[i].update(pose,1);
        assert.equal(owners[i].children[0].active,true);
        for(const visible of [true,false,true,false,true,false]){
            items[i].setBlinkVisible(visible);assert.equal(owners[i].children[0].active,visible);
        }
        items[i].hide();items[i].setBlinkVisible(true);
        assert.equal(owners[i].children[0].active,false);
        assert.equal(owners[i].children.length,1);
    }
    assert.equal(created,8);
    items.forEach(i=>i.dispose());
    assert.ok(owners.every(n=>!n.children[0].isValid));
    const late=new RecoveryFloatPresentation(new h.Node());late.dispose();pending.at(-1)(null,{prefab:{}});
    assert.equal(created,8);
});

function hudFixture(){
    let writes=0,redraws=0,created=0;
    const pending=[],listeners=new Map(),tweens=[];
    const h=createHarness();
    class Node extends h.Node{
        components=[];events={};active=true;
        constructor(name){super();this.name=name;created++;}
        setParent(p){this.parent=p;p.children.push(this);}
        addComponent(C){const c=new C();c.node=this;this.components.push(c);return c;}
        getComponent(C){return this.components.find(c=>c instanceof C);}
        once(e,f){this.events[e]=f;}
        setSiblingIndex(){}
        destroy(){this.isValid=false;this.children.forEach(c=>c.destroy());this.events.destroy?.();}
        static EventType={NODE_DESTROYED:'destroy'};
    }
    class UITransform{setContentSize(w,h){this.width=w;this.height=h;}}
    class Label{set string(v){this.text=v;writes++;}get string(){return this.text;}static Overflow={SHRINK:1};static HorizontalAlign={LEFT:0};}
    class Color{constructor(r,g,b,a){if(typeof r==='object')Object.assign(this,r);else this.set(r,g,b,a);}set(r,g,b,a){Object.assign(this,{r,g,b,a});}}
    class Graphics{clear(){redraws++;}roundRect(){}rect(){}fill(){}}
    class Sprite{isValid=true;static SizeMode={CUSTOM:1};}
    class SpriteFrame{destroy(){}}
    class Texture2D{}
    class UIOpacity{opacity=0;}
    class BlockInputEvents{enabled=false;}
    class LabelOutline{}
    const tween=target=>{const t={target,stopped:false,steps:[],delay(){return t;},to(seconds,props){t.steps.push(()=>Object.assign(target,props));return t;},call(f){t.steps.push(f);return t;},start(){tweens.push(t);return t;}};return t;};
    const cc={...h.cc,Node,UITransform,Label,Color,Graphics,Sprite,SpriteFrame,Texture2D,UIOpacity,BlockInputEvents,LabelOutline,tween,
        Tween:{stopAllByTarget:target=>tweens.filter(t=>t.target===target).forEach(t=>t.stopped=true)},
        view:{getVisibleSize:()=>({width:1290,height:720}),on:(n,f)=>listeners.set(n,f),off:n=>listeners.delete(n)}};
    const node=(name,parent)=>{const n=new Node(name);n.setParent(parent);n.addComponent(UITransform);return n;};
    const imports={cc,'../core/RaceBundleLoader':{loadRaceAsset:(p,t,cb)=>pending.push(cb)},
        './ProjectUiFonts':{styleProjectUiLabel:(l,w,height)=>{l.lineHeight=height;}},
        './RuntimeUiFactory':{makeUiNode:node,makeLabel:(name,parent,text,size)=>{const n=node(name,parent),l=n.addComponent(Label);l.string=text;l.fontSize=size;return n;},makeRoundedRect:(name,parent)=>{const n=node(name,parent);n.addComponent(Graphics);return n;},uiColor:(...a)=>new Color(...a)},
        './EntertainmentStatusStrip':{EntertainmentStatusStrip:class{constructor(parent){this.root=node('保护条',parent);}hide(){this.root.active=false;}reset(){this.hide();}setContent(text,value){this.text=text;this.value=value;}}},
    };
    // 使用同一数学替身，其他依赖保持真实纯逻辑模块。
    const fs=require('node:fs'),vm=require('node:vm');
    let ts;for(const dir of process.env.PATH.split(path.delimiter)){const p=path.resolve(dir,'../typescript/lib/typescript.js');if(fs.existsSync(p)){ts=require(p);break;}}
    assert.ok(ts);
    const file=path.join(h.root,'assets/scripts/ui/EntertainmentRecoveryHud.ts'),mod={exports:{}};
    vm.runInThisContext(`(function(require,module,exports){${ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText}})`)(
        id=>imports[id]||h.load(path.resolve(path.dirname(file),id+'.ts')),mod,mod.exports);
    const hud=new mod.exports.EntertainmentRecoveryHud(new Node('root'));
    return {hud,created:()=>created,writes:()=>writes,redraws:()=>redraws,listeners,pending,
        finish:()=>tweens.filter(t=>!t.stopped).forEach(t=>{t.steps.forEach(f=>f());t.stopped=true;})};
}

test('恢复HUD固定文案、晚快照直接显示、真实恢复立即释放输入、20轮节点监听稳定',()=>{
    const f=hudFixture(),h=f.hud,count=f.created();
    for(let round=1;round<=20;round++){
        h.update(.016,1,round===1?.2:3.5,1,round,0);
        assert.equal(h.inputBlocker.enabled,true);
        if(round===1)assert.equal(h.emergencyCardOpacity.opacity,255,'晚到状态不能再等入场');
        const text=h.emergencyCopyText;
        for(let i=0;i<20;i++){h.update(.016,1,2-i*.016,1,round,0);assert.equal(h.emergencyCopyText,text);}
        h.update(.016,2,2,1,round,0);
        assert.equal(h.inputBlocker.enabled,false,'视觉退场不能继续锁输入');
        assert.equal(h.statusStrip.text,'保护中');
        f.finish();h.update(.016,0,0,0,round,0);
        assert.equal(h.root.active,false);assert.equal(f.created(),count);assert.equal(f.listeners.size,2);
    }
    const writes=f.writes(),redraws=f.redraws();
    for(let i=0;i<120;i++)h.update(1/60,0,0);
    assert.equal(f.writes(),writes);assert.equal(f.redraws(),redraws);
    h.dispose();assert.equal(f.listeners.size,0);
    for(const cb of f.pending)cb(null,{});
});

test('真实泳者水面、潜水和空中受击均在原暂停内落稳，晚到快照不补水花',()=>{
    const h=createHarness(),fs=require('node:fs'),vm=require('node:vm');
    let ts;for(const dir of process.env.PATH.split(path.delimiter)){const p=path.resolve(dir,'../typescript/lib/typescript.js');if(fs.existsSync(p)){ts=require(p);break;}}
    const file=path.join(h.root,'assets/scripts/entity/Swimmer.ts'),source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='Swimmer');
    const names=['prepareEntertainmentKnockoutLanding','configureEntertainmentKnockoutLaunch','syncEntertainmentKnockoutPresentation'];
    const members=cls.members.filter(n=>names.includes(n.name?.getText(source)));
    assert.equal(members.length,names.length);
    const {CHARACTER_POSE_TUNING}=h.load(path.join(h.root,'assets/scripts/character/CharacterMotionTuning.ts'));
    const js=ts.transpileModule(`class Landing {${members.map(m=>m.getText(source)).join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    const Landing=vm.runInNewContext(`${js};Landing`,{Vec3:h.Vec3,Quat:h.Quat,CHARACTER_POSE_TUNING,getRaceDistance:()=>200});
    for(const y of [0,-.8,1.8])for(const late of [false,true]){
        let splashes=0,elapsed=0,landingSeconds=-1;const s=new Landing();
        Object.assign(s,{node:new h.Node(),_entertainmentKnocked:true,_motor:{distance:54,heading:.3},
            _courseLayout:{swimY:0,poolWidth:20,finishDirectionAtDistance:()=>1,clampSwimWorldX:x=>x},
            cartoonRig:{syncEntertainmentKnockoutElapsed:(e,d)=>{elapsed=e;landingSeconds=d;},triggerBigSplash:()=>splashes++}});
        for(const suffix of ['StartPosition','EndPosition','Position'])s['_entertainmentLanding'+suffix]=new h.Vec3();
        for(const suffix of ['StartRotation','EndRotation','Rotation'])s['_entertainmentLanding'+suffix]=new h.Quat();
        s.node.setPosition(4,y,2);s.node.setRotationFromEuler(60,40,30);s.prepareEntertainmentKnockoutLanding();
        if(y===0)s.configureEntertainmentKnockoutLaunch(-1,1);
        if(!late){s.syncEntertainmentKnockoutPresentation(0);s.syncEntertainmentKnockoutPresentation(.15);}
        s.syncEntertainmentKnockoutPresentation(2.8);
        assert.ok(Math.abs(s.node.position.y)<1e-7);
        assert.equal(s._motor.distance,54);assert.equal(s.node.position.x,4);assert.equal(s.node.position.z,2);
        assert.equal(elapsed,2.8,'受击原始时间不可扣掉落水前段');
        assert.ok(landingSeconds>=0 && landingSeconds<1,'独立传递落水时长以协调出圈');
        assert.equal(splashes,late?0:1);
        s.syncEntertainmentKnockoutPresentation(3.4);assert.equal(splashes,late?0:1);
    }
});
