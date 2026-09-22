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
class BlockInputEvents {}
class Button { static Transition={NONE:0}; interactable=true; get isValid(){return this.node.isValid;} }
class UITransform { setContentSize(width,height){this.contentSize={width,height};} }
class Sprite { static SizeMode={CUSTOM:1}; }
class SpriteFrame { isValid=true; destroy(){this.isValid=false;} }
class Node {
    static EventType={TOUCH_START:'start',TOUCH_END:'end',TOUCH_CANCEL:'cancel',NODE_DESTROYED:'destroy'};
    children=[]; components=[]; events=new Map(); position=new Vec3(); scale=new Vec3(1,1,1); active=true; isValid=true;
    constructor(name){this.name=name;}
    setParent(parent){this.parent=parent;parent.children.push(this);}
    getComponent(C){return this.components.find(c=>c instanceof C);}
    addComponent(C){const c=new C();c.node=this;this.components.push(c);return c;}
    getComponentsInChildren(C){return [...this.components.filter(c=>c instanceof C),...this.children.flatMap(n=>n.getComponentsInChildren(C))];}
    setPosition(x,y,z){this.position=new Vec3(x,y,z);}
    setScale(x,y,z){this.scale=new Vec3(x,y,z);}
    on(e,f){if(!this.events.has(e))this.events.set(e,new Set());this.events.get(e).add(f);}
    once(e,f){this.on(e,f);}
    off(e,f){if(!this.isValid)throw new TypeError("Cannot read properties of null (reading 'off')");this.events.get(e)?.delete(f);}
    emit(e,id=1){for(const f of this.events.get(e)??[])f({getID:()=>id});}
    destroy(){this.isValid=false;this.children.forEach(c=>c.destroy());this.emit('destroy');}
}
function setup() {
    let now=0,created=0;
    const running=new Set();
    class Animation {
        steps=[];
        constructor(target){this.target=target;created++;}
        delay(seconds){this.steps.push({seconds});return this;}
        to(seconds,props,options){this.steps.push({seconds,props,options});return this;}
        call(fn){this.steps.push({seconds:0,fn});return this;}
        start(){this.time=now;this.index=0;running.add(this);return this;}
        stop(){running.delete(this);return this;}
        tick(){
            while(running.has(this)&&this.index<this.steps.length){
                const step=this.steps[this.index],fraction=step.seconds?Math.min(1,(now-this.time)/step.seconds):1;
                const ratio=step.options?.easing==='cubicInOut'?(fraction<.5?4*fraction**3:1-(-2*fraction+2)**3/2):fraction;
                if(step.props){
                    if(!step.from)step.from=Object.fromEntries(Object.keys(step.props).map(k=>[k,typeof this.target[k]==='object'?{...this.target[k]}:this.target[k]]));
                    for(const [key,to] of Object.entries(step.props)){
                        const from=step.from[key];
                        this.target[key]=typeof to==='object'?new Vec3(from.x+(to.x-from.x)*ratio,from.y+(to.y-from.y)*ratio,from.z+(to.z-from.z)*ratio):from+(to-from)*ratio;
                    }
                }
                step.options?.onUpdate?.();
                if(fraction<1)break;
                this.time+=step.seconds;this.index++;step.fn?.();
            }
            if(this.index>=this.steps.length)running.delete(this);
        }
    }
    const viewport={width:1280,height:720};
    const cc={Node,Button,BlockInputEvents,UITransform,Sprite,SpriteFrame,UIOpacity,Vec3,view:{on(){},off(){},getVisibleSize:()=>viewport},tween:target=>new Animation(target)};
    const factory={makeUiNode:(name,parent)=>{const n=new Node(name);n.setParent(parent);n.addComponent(UITransform);return n;},uiColor:()=>({}),fitFullScreenBackgroundCover(){}};
    factory.makeRect=factory.makeUiNode;
    const imageRequests=[],selection={characterId:'coach'};
    function load(file,imports){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:m,exports:m.exports,require:key=>imports[key]??{},console});return m.exports;}
    const {LobbyUiMotion}=load('assets/scripts/ui/LobbyUiMotion.ts',{'cc':cc,'./RuntimeUiFactory':factory});
    const sceneLayout=load('assets/scripts/ui/PrepareSceneLayout.ts',{'../core/ResourcePaths':load('assets/scripts/core/ResourcePaths.ts',{})});
    const {computePrepareSceneLayout}=sceneLayout;
    const {PrepareRaceFlow}=load('assets/scripts/ui/PrepareRaceFlow.ts',{
        './PrepareSceneLayout':sceneLayout,
        cc,'./RuntimeUiFactory':factory,'./LobbyUiMotion':{LobbyUiMotion},'./UIStyle':{UI_STYLE:{white:{}}},
        '../backend/PlayerData':{PlayerData:{offChange(){}}},
        '../app/PlayerCharacterConfig':{getPlayerCharacterSelection:()=>selection},
        './UILayers':{getUILayer:canvas=>canvas,UILayer:{Popup:1}},
        '../core/ResourcePaths':{...load('assets/scripts/core/ResourcePaths.ts',{}),RESOURCE_PATHS:{lobbyB:{background:'大厅背景'},careerUi:{badges:[]}}},
        '../core/RaceBundleLoader':{loadRaceAsset:(path,type,done)=>imageRequests.push({path,done})},
    });
    const parent=new Node('页面'),flow=new PrepareRaceFlow(parent,parent,1280,720,{});
    return {flow,parent,LobbyUiMotion,cc,factory,imageRequests,selection,viewport,computePrepareSceneLayout,advance(seconds){now+=seconds;for(const t of [...running])t.tick();},get running(){return running.size;},get created(){return created;}};
}
function near(a,b){assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);}
function size(n){return 1+n.components.length+n.children.reduce((sum,c)=>sum+size(c),0);}

test('大厅与角色页连续往返复用节点和动效，保留滚动位置并恢复正确按钮权限',()=>{
    const s=setup(),f=s.flow,builds={ready:0,characters:0},suspensions=[];
    f.ensureRoot=()=>{f._root=s.parent;};f.updateBackground=()=>{};f.layoutPresentation=()=>{};
    f.presentCharacter=()=>{};
    for(const name of ['refreshReadyCharacterInfo','refreshCharacterCards','refreshCharacterInspector','refreshAppearanceSupport',
        'refreshAppearanceSwatches','refreshCharacterConfirmState','selectInspectorTab'])f[name]=()=>{};
    const controls={};
    function build(kind,parent){
        builds[kind]++;
        const group=f._motion.group(parent,kind,24);
        const button=s.factory.makeUiNode('返回',group);button.addComponent(Button);f._motion.bindButton(button);
        const locked=s.factory.makeUiNode('不可用控件',group);locked.addComponent(Button).interactable=false;
        f._previewRotateArea=s.factory.makeUiNode('旋转热区',parent);
        controls[kind]={button,locked,group,rotate:f._previewRotateArea};
    }
    f.buildReadyScreen=parent=>{build('ready',parent);f._careerPanel={setSuspended:v=>suspensions.push(v),dispose(){}};};
    f.buildCharacterManagement=parent=>build('characters',parent);
    f.showReadyScreen();s.advance(1);f.showCharacterManagement();s.advance(1);
    const roster=s.factory.makeUiNode('角色列表滚动内容',f._content);roster.setPosition(0,-193,0);
    const pages=[...f._pages.values()],count=size(s.parent);
    for(let i=0;i<20;i++){
        for(const [kind,show] of [['ready',()=>f.showReadyScreen()],['characters',()=>f.showCharacterManagement()]]){
            f.leaveCurrentScreen(show);s.advance(1);s.advance(1);
            assert.equal(f._content, f._pages.get(kind).content);
            assert.equal(f._previewRotateArea,controls[kind].rotate);
            assert.equal(controls[kind].button.getComponent(Button).interactable,true);
            assert.equal(controls[kind].locked.getComponent(Button).interactable,false);
            controls[kind].button.emit('start',1);s.advance(.08);near(controls[kind].button.scale.x,.96);
            controls[kind].button.emit('end',1);s.advance(.3);near(controls[kind].button.scale.x,1);
            assert.equal([...f._pages.values()].filter(p=>p.content.active).length,1);
            assert.equal(size(s.parent),count);assert.equal(s.running,0);
        }
    }
    assert.deepEqual(builds,{ready:1,characters:1});assert.equal(roster.position.y,-193);
    assert.equal(suspensions.at(-1),true);
    f.dispose();s.advance(1);
    for(const page of pages){assert.equal(page.content.isValid,false);assert.equal(page.motion._unbind.length,0);}
    assert.equal(s.running,0);
});

test('暂存中断按压与退场后重新进入，可再次使用同一手指且不重复绑定',()=>{
    const s=setup(),motion=new s.LobbyUiMotion(),button=new Node('按钮');button.addComponent(Button);
    motion.bindButton(button);motion.group(s.parent,'入场',24);
    button.emit('start',7);s.advance(.04);motion.exit(()=>assert.fail('暂存后旧导航不可执行'));
    motion.suspend();s.advance(1);near(button.scale.x,1);assert.equal(s.running,0);
    motion.enter(true);s.advance(1);button.emit('start',7);s.advance(.1);near(button.scale.x,.96);
    assert.equal(button.events.get('start').size,1);motion.dispose();assert.equal(s.running,0);
});

test('大厅与角色共用一张背景，切页不再换图，销毁释放缓存且拒绝迟到请求',()=>{
    const s=setup(),f=s.flow;
    f.buildBackground(s.parent);
    f._view='ready';f.updateBackground();f.updateBackground();
    f._view='characters';f.updateBackground();
    assert.equal(s.imageRequests.length,1);
    assert.equal(f._lobbyBackgroundImage.getComponent(Sprite),undefined);
    s.imageRequests[0].done(null,{name:'共享全景'});
    f._view='ready';f.updateBackground();
    const sprite=f._lobbyBackgroundImage.getComponent(Sprite),hall=sprite.spriteFrame;
    for(let i=0;i<20;i++){f._view=i%2?'ready':'characters';f.updateBackground();}
    assert.equal(sprite.spriteFrame,hall);
    assert.equal(s.imageRequests.length,1);const frames=[...f._backgroundFrames.values()];
    s.parent.destroy();assert.ok(frames.every(frame=>!frame.isValid));assert.equal(f._backgroundFrames.size,0);
    s.imageRequests[0].done(null,{name:'迟到'});assert.equal(f._backgroundFrames.size,0);
});

test('全景与角色连续同向平移，宽屏全过程覆盖画面且站位相对展台固定',()=>{
    const s=setup(),out={};
    for(const [width,height] of [[1280,720],[1600,720],[2532/1170*720,720],[1920,720],[960,720],[1280,900]]){
        let previousX=-Infinity,scale;
        for(let i=0;i<=60;i++){
            s.computePrepareSceneLayout(out,width,height,i/60);
            assert.ok(out.x>=previousX);previousX=out.x;
            if(scale!==undefined)near(out.scale,scale);scale=out.scale;
            assert.ok(out.backgroundX-2115*out.scale/2<=-width/2+1e-7);
            assert.ok(out.backgroundX+2115*out.scale/2>=width/2-1e-7);
            assert.ok(out.backgroundY+743*out.scale/2>=height/2-1e-7);
            assert.ok(out.backgroundY-743*out.scale/2<=-height/2+1e-7);
            near(out.backgroundX+(1049-2115/2)*out.scale,out.x);
            near(out.backgroundY+(743/2-743*600/720)*out.scale,-height/3);
        }
        near(out.x,-15);
    }
});

test('共享场景只用一条过渡时间线，同步角色取景并阻止连点，销毁时取消动画',()=>{
    for(const cancel of [false,true]){
        const s=setup(),f=s.flow;f._root=s.parent;f.buildBackground(s.parent);
        const old=s.factory.makeUiNode('大厅',s.parent),next=s.factory.makeUiNode('角色页',s.parent);
        f._content=next;f._view='characters';
        const offsets=[];f._preview={setScreenOffset:(pixels,height)=>offsets.push({pixels,height})};
        f.layoutPresentation();const start=f._lobbyBackgroundImage.position.x;
        f.presentPageTransition(old,1,true);
        assert.equal(s.running,1);assert.equal(next.getComponent(UIOpacity).opacity,0);
        assert.ok(f._transitionBlocker.getComponent(BlockInputEvents));
        let navigations=0;f.leaveCurrentScreen(()=>navigations++);assert.equal(navigations,0);
        f.beginPreviewRotation({getID:()=>8});assert.equal(f._previewRotateTouchId,null);
        s.advance(.21);
        assert.ok(f._lobbyBackgroundImage.position.x>start);
        near(offsets.at(-1).pixels,45+f._sceneLayout.x);
        assert.ok(next.getComponent(UIOpacity).opacity>0&&next.getComponent(UIOpacity).opacity<255);
        if(cancel){const n=offsets.length;f.dispose();s.advance(1);assert.equal(offsets.length,n);}
        else {
            s.viewport.width=1600;f.layoutPresentation();near(offsets.at(-1).pixels,45+f._sceneLayout.x);
            s.advance(.21);assert.equal(f._pageTransition,null);assert.equal(f._transitionBlocker.active,false);
            assert.equal(old.active,false);assert.equal(next.active,true);near(f._sceneLayout.x,-15);
            assert.equal(next.getComponent(UIOpacity).opacity,255);f.dispose();
        }
        assert.equal(s.running,0);
    }
});

test('选中框快速往返：中断旧淡出后仅保留最终选中，不重建节点',()=>{
    const s=setup(),motion=new s.LobbyUiMotion();
    const cards=['first','second','third'].map(id=>{
        const root=new Node(id);root.setParent(s.parent);const frame=new Node('选中框');frame.setParent(root);
        motion.selectFrame(frame,false,false);return {id,root,frame};
    });
    const count=size(s.parent);
    for(let i=0;i<60;i++) {
        for(const [index,card] of cards.entries()) motion.selectFrame(card.frame,index===i%3,true);
        s.advance(.01);
    }
    for(const card of cards) motion.selectFrame(card.frame,card.id==='third',true);
    s.advance(1);
    assert.equal(size(s.parent),count);
    assert.deepEqual(cards.filter(c=>c.frame.active).map(c=>c.id),['third']);
    near(cards[2].frame.getComponent(UIOpacity).opacity,255);
    assert.equal(s.running,0);
});

test('生涯返回大厅重播原控件入场，连续往返复用角色与节点且隐藏时停止动画',()=>{
    const s=setup(),f=s.flow;
    f._root=s.parent;f._view='ready';
    f._content=s.factory.makeUiNode('大厅',s.parent);
    f._previewRoot=s.factory.makeUiNode('角色',s.parent);
    const content=f._content,preview=f._previewRoot;
    f._preview={setLobbyPresentation(){},setScreenOffset(){},refresh(id){assert.equal(id,'coach');}};
    f.buildReadyScreen=()=>assert.fail('返回生涯不能重建大厅');
    f.ensurePreview=()=>assert.equal(f._previewRoot,preview,'返回保留已有角色预览');
    const groups=[f._motion.group(content,'左侧',-24),f._motion.group(content,'生涯卡',24,0,.05),f._motion.group(content,'底部',0,-12,.15)];
    const count=size(s.parent);
    f._motion.enter(false);s.advance(.04);
    for(let i=0;i<20;i++){
        f.setEventPageVisible(true,false);
        assert.equal(content.active,false);assert.equal(preview.active,false);assert.equal(s.running,0);
        const frozen=groups.map(n=>({...n.position}));s.advance(.2);
        groups.forEach((n,j)=>assert.deepEqual({...n.position},frozen[j]));
        f.setEventPageVisible(false,false);
        assert.equal(f._content,content);assert.equal(f._previewRoot,preview);
        assert.equal(content.active,true);assert.equal(preview.active,true);
        assert.ok(groups[0].position.x<0 && groups[1].position.x>0 && groups[2].position.y<0);
        const created=s.created;
        f.setEventPageVisible(false,false);assert.equal(s.created,created,'重复可见通知不重播');
        s.advance(i%2?.5:.08);
        assert.equal(size(s.parent),count);
    }
    for(const group of groups){near(group.position.x,0);near(group.position.y,0);near(group.getComponent(UIOpacity).opacity,255);}
    f.dispose();s.advance(1);assert.equal(s.running,0);
});

test('直接恢复生涯时大厅不在背后播放，转快速弹窗只恢复底层位置',()=>{
    const s=setup(),f=s.flow;
    f._root=s.parent;f._view='ready';f._content=s.factory.makeUiNode('大厅',s.parent);
    f._previewRoot=s.factory.makeUiNode('角色',s.parent);f.presentCharacter=()=>{};
    const group=f._motion.group(f._content,'侧栏',-24);
    f.setEventPageVisible(true,false);
    f.presentPageTransition(null,0,false);assert.equal(s.running,0);
    f.setEventPageVisible(false,false);s.advance(.05);assert.ok(group.position.x<0);
    f.setEventPageVisible(true,false);assert.equal(s.running,0);
    f.setEventPageVisible(true,true);
    assert.equal(s.running,0);assert.equal(f._content.active,true);
    near(group.position.x,0);near(group.getComponent(UIOpacity).opacity,255);
    const created=s.created;f.setEventPageVisible(false,false);assert.equal(s.created,created);
    f.dispose();
});

test('快速弹窗开关保留大厅与3D预览，不重载角色并阻断预览拖动',()=>{
    const s=setup(),f=s.flow;
    f._view='ready';f._content=new Node('大厅');f._previewRoot=new Node('角色');
    f.presentCharacter=()=>assert.fail('开关快速弹窗不应重载角色');
    for(let i=0;i<20;i++) {
        f.setEventPageVisible(true,true);
        assert.equal(f._content.active,true);assert.equal(f._previewRoot.active,true);
        f.beginPreviewRotation({getID:()=>1});assert.equal(f._previewRotateTouchId,null);
        f.setEventPageVisible(false,false);
        assert.equal(f._content.active,true);assert.equal(f._previewRoot.active,true);
    }
    f.beginPreviewRotation({getID:()=>2});assert.equal(f._previewRotateTouchId,2);
    f.setEventPageVisible(true,false);assert.equal(f._content.active,false);assert.equal(f._previewRoot.active,false);
});

test('重复开始和联机点击只执行一次；外部邀请销毁页面后取消旧导航',()=>{
    for(const disposed of [false,true]){
        const s=setup(),f=s.flow,button=new Node('开始');button.setParent(s.parent);button.addComponent(Button);
        f._root=s.parent;f._content=s.parent;f._motion.group(s.parent,'侧栏',24);
        let calls=0;
        f.leaveCurrentScreen(()=>calls++);f.leaveCurrentScreen(()=>calls+=10);
        assert.equal(button.getComponent(Button).interactable,false);
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

test('大厅AI开赛前释放预览与动效，加载失败恢复可操作大厅，重复点击不重复换场',()=>{
    const source=ts.createSourceFile('LoginManager.ts',fs.readFileSync('assets/scripts/app/LoginManager.ts','utf8'),ts.ScriptTarget.Latest,true);
    const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='LoginManager');
    const methods=cls.members.filter(n=>['startAiDebug','launchMainGame','recoverPrepareAfterLoadFailure','onDestroy'].includes(n.name?.getText(source)));
    for(const failure of ['none','bundle','scene']){
        const s=setup(),f=s.flow,button=new Node('AI测试');
        f._root=new Node('大厅');f._root.setParent(s.parent);f._content=f._root;
        button.setParent(f._root);button.addComponent(Button);
        f._motion.bindButton(button);button.emit('start');
        const preview=new Node('角色预览');f._previewRoot=preview;
        let loads=0,runs=0,pendingBundle,pendingScene,mode,owner;
        const Login=vm.runInNewContext(ts.transpileModule(`class Login { ${methods.map(n=>n.getText(source)).join('\n')} };Login`,
            {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,{
            DEBUG_UI_ENABLED:true,
            setSoloRaceTicket(){},setSoloRaceDistance(){},setSoloAiEvent(){},
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
        owner.toast=()=>{};
        owner.openPrepareRace=()=>{
            const next=new f.constructor(s.parent,s.parent,1280,720,{});
            next._root=new Node('恢复大厅');next._root.setParent(s.parent);next._content=next._root;
            next._previewRoot=new Node('恢复预览');
            owner._prepareRaceFlow=next;
        };
        owner.startAiDebug(.95);owner.startAiDebug(.95);assert.equal(loads,1);
        if(failure==='bundle')pendingBundle(new Error('加载失败'),null);
        else {
            pendingBundle(null,{loadScene(_name,cb){pendingScene=cb;}});
            if(failure==='scene')pendingScene(new Error('场景失败'),null);
        }
        if(failure!=='none'){
            assert.notEqual(owner._prepareRaceFlow,f);assert.equal(preview.isValid,false);assert.equal(s.parent.isValid,true);
            assert.equal(owner._prepareRaceFlow._root.isValid,true);
            assert.equal(owner._loadingRace,false);assert.equal(runs,0);
            owner.startAiDebug(.95);assert.equal(loads,2);
            pendingBundle(null,{loadScene(_name,cb){pendingScene=cb;}});
        }
        pendingScene(null,{});
        assert.equal(runs,1);assert.equal(mode,'ai-debug');
        assert.doesNotThrow(()=>owner.onDestroy());
    }
});
