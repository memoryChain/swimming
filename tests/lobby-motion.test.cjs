// 用可推进时间的 Tween 替身检查中断、输入与生命周期；不代替真机视觉验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const dir of process.env.PATH.split(path.delimiter)) {
        const file = path.resolve(dir, '../typescript/lib/typescript.js');
        if (fs.existsSync(file)) return require(file);
    }
    throw Error('请使用 TypeScript 5.4.5 执行测试');
}
const ts = compiler();
class Vec3 {
    constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); }
    clone() { return new Vec3(this.x,this.y,this.z); }
}
class UIOpacity { opacity=255; }
class Button { static Transition={NONE:0}; interactable=true; get isValid(){return this.node.isValid;} }
class Node {
    static EventType={TOUCH_START:'start',TOUCH_END:'end',TOUCH_CANCEL:'cancel'};
    children=[]; components=[]; events=new Map(); position=new Vec3(); scale=new Vec3(1,1,1); active=true; isValid=true;
    constructor(name){this.name=name;}
    setParent(parent){this.parent=parent;parent.children.push(this);}
    getComponent(C){return this.components.find(c=>c instanceof C);}
    addComponent(C){const c=new C();c.node=this;this.components.push(c);return c;}
    getComponentsInChildren(C){return [...this.components.filter(c=>c instanceof C),...this.children.flatMap(n=>n.getComponentsInChildren(C))];}
    setPosition(x,y,z){this.position=new Vec3(x,y,z);}
    setScale(x,y,z){this.scale=new Vec3(x,y,z);}
    on(e,f){if(!this.events.has(e))this.events.set(e,new Set());this.events.get(e).add(f);}
    off(e,f){if(!this.isValid)throw new TypeError("Cannot read properties of null (reading 'off')");this.events.get(e)?.delete(f);}
    emit(e,id=1){for(const f of this.events.get(e)??[])f({getID:()=>id});}
    destroy(){this.isValid=false;this.children.forEach(c=>c.destroy());}
}
function setup() {
    let now=0,selected='standard',selectionWrites=0,created=0;
    const running=new Set();
    class Animation {
        steps=[];
        constructor(target){this.target=target;created++;}
        delay(seconds){this.steps.push({seconds});return this;}
        to(seconds,props){this.steps.push({seconds,props});return this;}
        call(fn){this.steps.push({seconds:0,fn});return this;}
        start(){this.time=now;this.index=0;running.add(this);return this;}
        stop(){running.delete(this);return this;}
        tick(){
            while(running.has(this)&&this.index<this.steps.length){
                const step=this.steps[this.index],fraction=step.seconds?Math.min(1,(now-this.time)/step.seconds):1;
                if(step.props){
                    if(!step.from)step.from=Object.fromEntries(Object.keys(step.props).map(k=>[k,typeof this.target[k]==='object'?{...this.target[k]}:this.target[k]]));
                    for(const [key,to] of Object.entries(step.props)){
                        const from=step.from[key];
                        this.target[key]=typeof to==='object'?new Vec3(from.x+(to.x-from.x)*fraction,from.y+(to.y-from.y)*fraction,from.z+(to.z-from.z)*fraction):from+(to-from)*fraction;
                    }
                }
                if(fraction<1)break;
                this.time+=step.seconds;this.index++;step.fn?.();
            }
            if(this.index>=this.steps.length)running.delete(this);
        }
    }
    const cc={Node,Button,UIOpacity,Vec3,tween:target=>new Animation(target)};
    const factory={makeUiNode:(name,parent)=>{const n=new Node(name);n.setParent(parent);return n;},uiColor:()=>({})};
    function load(file,imports){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:m,exports:m.exports,require:key=>imports[key]??{},console});return m.exports;}
    const {LobbyUiMotion}=load('assets/scripts/ui/LobbyUiMotion.ts',{'cc':cc,'./RuntimeUiFactory':factory});
    const {PrepareRaceFlow}=load('assets/scripts/ui/PrepareRaceFlow.ts',{
        cc,'./RuntimeUiFactory':factory,'./LobbyUiMotion':{LobbyUiMotion},'./UIStyle':{UI_STYLE:{white:{}}},
        '../app/PlayerCharacterConfig':{getSelectedRaceDifficulty:()=>selected,setSelectedRaceDifficulty:id=>{selected=id;selectionWrites++;}},
        '../backend/PlayerData':{PlayerData:{offChange(){}}},
    });
    const parent=new Node('页面'),flow=new PrepareRaceFlow(parent,parent,1280,720,{});
    return {flow,parent,LobbyUiMotion,cc,advance(seconds){now+=seconds;for(const t of [...running])t.tick();},get running(){return running.size;},get created(){return created;},get writes(){return selectionWrites;}};
}
function near(a,b){assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);}
function size(n){return 1+n.components.length+n.children.reduce((sum,c)=>sum+size(c),0);}

test('模式快速往返：从当前值接续，最终只有一个选中框，不重建角色或节点',()=>{
    const s=setup(),f=s.flow;
    f._raceModeCards=['beginner','standard','championship'].map(id=>{
        const root=new Node(id);root.setParent(s.parent);const frame=new Node('选中框');frame.setParent(root);
        const card={id,root,selectedFrame:frame,selected:id==='standard'};
        f.applyRaceModeCardSelection(card);return card;
    });
    f.layoutRaceModeCards();
    f.presentCharacter=()=>assert.fail('模式切换不应重载角色');
    f.replaceContent=()=>assert.fail('模式切换不应重建页面');
    const count=size(s.parent),old=f._raceModeCards[0].root;
    f.selectRaceDifficulty('beginner');s.advance(.07);
    const midway=old.position.x;assert.ok(midway>408&&midway<447);
    f.selectRaceDifficulty('championship');near(old.position.x,midway);
    for(let i=0;i<60;i++){f.selectRaceDifficulty(i%2?'standard':'beginner');s.advance(.01);}
    f.selectRaceDifficulty('championship');s.advance(1);
    assert.equal(size(s.parent),count);
    assert.deepEqual(f._raceModeCards.filter(c=>c.selectedFrame.active).map(c=>c.id),['championship']);
    for(const c of f._raceModeCards){near(c.root.scale.x,c.selected?1:.8);near(c.root.position.x,c.selected?408:447);}
    const writes=s.writes,animations=s.created;
    f.selectRaceDifficulty('championship');assert.equal(s.writes,writes);assert.equal(s.created,animations);
    assert.equal(s.running,0);
});

test('重复开始和联机点击只执行一次；外部邀请销毁页面后取消旧导航',()=>{
    for(const disposed of [false,true]){
        const s=setup(),f=s.flow,button=new Node('开始');button.setParent(s.parent);button.addComponent(Button);
        f._root=s.parent;f._content=s.parent;f._motion.group(s.parent,'侧栏',24);
        let calls=0;
        f.leaveCurrentScreen(()=>calls++);f.leaveCurrentScreen(()=>calls+=10);
        assert.equal(button.getComponent(Button).interactable,false);
        f.selectRaceDifficulty('beginner');assert.equal(s.writes,0);
        if(disposed)f.dispose();
        s.advance(1);assert.equal(calls,disposed?0:1);assert.equal(s.running,0);
    }
});

test('按钮触摸取消和第二指不堆叠动画；松手复原，销毁解绑全部监听',()=>{
    const s=setup(),motion=new s.LobbyUiMotion(),button=new Node('按钮');button.addComponent(Button);
    motion.bindButton(button);
    button.emit('start',1);s.advance(.035);const partial=button.scale.x;
    assert.ok(partial<1&&partial>.96);
    const created=s.created;button.emit('start',2);button.emit('end',2);assert.equal(s.created,created);
    button.emit('cancel',1);s.advance(.2);near(button.scale.x,1);
    button.emit('start',1);s.advance(.08);button.emit('end',1);s.advance(.08);assert.ok(button.scale.x>1);
    s.advance(.1);near(button.scale.x,1);assert.equal(s.running,0);
    button.emit('start',3);motion.dispose();s.advance(1);assert.equal(s.running,0);
    assert.equal([...button.events.values()].reduce((n,e)=>n+e.size,0),0);
});

test('入场与屏幕锚点独立，点击打断按钮弹入后仍复原，离场清理无后台工作',()=>{
    const s=setup(),motion=new s.LobbyUiMotion(),anchor=new Node('宽屏锚点');anchor.setPosition(160,0,0);
    const group=motion.group(anchor,'左侧动效',-24),button=new Node('开始');button.setParent(group);button.addComponent(Button);motion.bindButton(button,true);
    const count=size(anchor);motion.enter(false);assert.equal(group.position.x,-24);
    anchor.setPosition(200,0,0);s.advance(.1);assert.ok(group.position.x<0);
    button.emit('start');s.advance(.08);button.emit('end');s.advance(1);
    near(button.scale.x,1);near(group.position.x,0);assert.equal(anchor.position.x,200);assert.equal(size(anchor),count);
    assert.equal(s.running,0);
    motion.exit(()=>assert.fail('销毁后不可触发导航'));motion.dispose();s.advance(1);assert.equal(s.running,0);
});

test('引擎先销毁子按钮后再清理大厅，解绑不得访问已销毁的事件处理器',()=>{
    const s=setup(),f=s.flow,button=new Node('AI测试');button.setParent(s.parent);button.addComponent(Button);
    f._root=s.parent;f._content=s.parent;
    f._motion.bindButton(button);button.emit('start');
    button.destroy();
    assert.doesNotThrow(()=>f.dispose());
    assert.doesNotThrow(()=>f.dispose());
    s.advance(1);assert.equal(s.running,0);
});

test('大厅AI开赛在runScene前释放预览与动效，加载失败仍保留大厅，重复点击不重复换场',()=>{
    const source=ts.createSourceFile('LoginManager.ts',fs.readFileSync('assets/scripts/app/LoginManager.ts','utf8'),ts.ScriptTarget.Latest,true);
    const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='LoginManager');
    const methods=cls.members.filter(n=>['startAiDebug','launchMainGame','onDestroy'].includes(n.name?.getText(source)));
    for(const failure of ['none','bundle','scene']){
        const s=setup(),f=s.flow,button=new Node('AI测试');button.setParent(s.parent);button.addComponent(Button);
        f._root=s.parent;f._content=s.parent;
        f._motion.bindButton(button);button.emit('start');
        const preview=new Node('角色预览');f._previewRoot=preview;
        let loads=0,runs=0,pendingBundle,pendingScene,mode,owner;
        const Login=vm.runInNewContext(ts.transpileModule(`class Login { ${methods.map(n=>n.getText(source)).join('\n')} };Login`,
            {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,{
            setAiDebugDifficulty(){},setRaceDifficulty(){},getAiDebugSetup:()=>({mode:'competitive'}),setMainGameLaunchMode:value=>mode=value,
            LoadingOverlay:{show(){},hide(){}},console:{error(){}},
            loadRaceBundle:cb=>{loads++;pendingBundle=cb;},
            director:{runScene(){
                assert.equal(owner._prepareRaceFlow,null,'必须先释放大厅，再调用引擎换场');
                assert.equal(preview.isValid,false);assert.equal(s.running,0);
                s.parent.destroy();owner.onDestroy();runs++;
            }},
        });
        owner=new Login();owner._prepareRaceFlow=f;
        owner.startAiDebug(.95);owner.startAiDebug(.95);assert.equal(loads,1);
        if(failure==='bundle')pendingBundle(new Error('加载失败'),null);
        else {
            pendingBundle(null,{loadScene(_name,cb){pendingScene=cb;}});
            if(failure==='scene')pendingScene(new Error('场景失败'),null);
        }
        if(failure!=='none'){
            assert.equal(owner._prepareRaceFlow,f);assert.equal(preview.isValid,true);assert.equal(s.parent.isValid,true);
            assert.equal(owner._loadingRace,false);assert.equal(runs,0);
            owner.startAiDebug(.95);assert.equal(loads,2);
            pendingBundle(null,{loadScene(_name,cb){pendingScene=cb;}});
        }
        pendingScene(null,{});
        assert.equal(runs,1);assert.equal(mode,'ai-debug');
        assert.doesNotThrow(()=>owner.onDestroy());
    }
});
