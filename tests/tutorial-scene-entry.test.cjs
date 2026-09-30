// 执行真实分层、大厅暂存、教学界面与控制器，复现跨场景同名画布冲突。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
function fixture() {
    class Component { enabled=true; get isValid() { return this.node.isValid; } }
    class UITransform extends Component {
        width=0; height=0;
        setContentSize(w,h) { this.width=w; this.height=h; }
        convertToWorldSpaceAR(point) {
            const out=new Vec3(point.x,point.y,point.z);
            for(let node=this.node;node;node=node.parent) {
                out.x=out.x*node.scale.x+node.position.x;out.y=out.y*node.scale.y+node.position.y;
            }
            return out;
        }
        convertToNodeSpaceAR(point) {
            const out=new Vec3(point.x,point.y,point.z),parents=[];
            for(let node=this.node;node;node=node.parent)parents.push(node);
            for(const node of parents.reverse()) {
                out.x=(out.x-node.position.x)/node.scale.x;out.y=(out.y-node.position.y)/node.scale.y;
            }
            return out;
        }
    }
    class Canvas extends Component {}
    class Camera extends Component {
        static ProjectionType={ORTHO:1}; static ClearFlag={DEPTH_ONLY:1}; priority=0;
        ready=false;camera={update:()=>{this.ready=true;}};
        worldToScreen(point,out) {
            if(!this.ready)return Object.assign(out,{x:0,y:0,z:0});
            const origin=this.node.getComponent(UITransform)?.convertToWorldSpaceAR(new Vec3())
                ??this.node.parent.getComponent(UITransform).convertToWorldSpaceAR(this.node.position);
            return Object.assign(out,{x:point.x-origin.x+viewport.width/2,y:point.y-origin.y+viewport.height/2,z:0});
        }
        screenToWorld(point,out) {
            if(!this.ready)return Object.assign(out,{x:0,y:0,z:0});
            const origin=this.node.parent.getComponent(UITransform).convertToWorldSpaceAR(this.node.position);
            return Object.assign(out,{x:point.x+origin.x-viewport.width/2,y:point.y+origin.y-viewport.height/2,z:0});
        }
    }
    class Color { constructor(r,g,b,a=255) { Object.assign(this,{r,g,b,a}); } static WHITE=new Color(255,255,255); }
    class Graphics extends Component { clears=0; clear(){this.clears++;} rect(){} fill(){} stroke(){} }
    class Label extends Component { static Overflow={SHRINK:1}; string=''; }
    class Button extends Component { static EventType={CLICK:'click'}; static Transition={NONE:0}; interactable=true; }
    class BlockInputEvents extends Component {}
    class Vec3 { constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); } }
    class Rect {
        constructor(x,y,width,height) {Object.assign(this,{x,y,width,height});}
        get xMax(){return this.x+this.width;}get yMax(){return this.y+this.height;}
    }
    class Node {
        static EventType={NODE_DESTROYED:'destroy'};
        active=true; isValid=true; children=[]; components=[]; listeners=new Map();
        position=new Vec3();scale=new Vec3(1,1,1);
        constructor(name) { this.name=name; }
        get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
        addComponent(C) { const value=new C(); value.node=this; this.components.push(value); return value; }
        getComponent(C) { return this.components.find(c=>c instanceof C)??null; }
        getChildByName(name) { return this.children.find(c=>c.name===name)??null; }
        setParent(parent) { if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this); this.parent=parent; parent.children.push(this); }
        setPosition(x,y,z=0) { this.position=new Vec3(x,y,z); }
        setScale(x,y,z=1) { this.scale=new Vec3(x,y,z); }
        setSiblingIndex(index) { const list=this.parent.children;list.splice(list.indexOf(this),1);list.splice(index,0,this); }
        on(name,callback) { if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback); }
        once(name,callback) { this.on(name,callback); }
        emit(name) { for(const callback of this.listeners.get(name)??[])callback(); }
        destroy() { if(!this.isValid)return;for(const child of [...this.children])child.destroy();this.isValid=false;this.active=false;this.emit('destroy');this.listeners.clear();if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this); }
    }
    const listeners=new Map(),persist=new Set();let scale=1,currentScene;
    const viewport={width:1280,height:720};
    const view={getDesignResolutionSize:()=>({width:1280,height:720}),getVisibleSize:()=>viewport,
        on:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},off:(name,fn)=>listeners.get(name)?.delete(fn)};
    const director={getScene:()=>currentScene,getScheduler:()=>({setTimeScale:value=>scale=value}),
        addPersistRootNode:node=>persist.add(node),removePersistRootNode:node=>persist.delete(node)};
    const cc={Node,UITransform,Canvas,Camera,Color,Graphics,Label,Button,BlockInputEvents,Vec3,Rect,view,director,Layers:{Enum:{UI_2D:1<<25}}};
    const makeUiNode=(name,parent)=>{const n=new Node(name);n.setParent(parent);n.layer=parent.layer;n.addComponent(UITransform);return n;};
    const makeRect=(name,parent,w,h)=>{const n=makeUiNode(name,parent);n.getComponent(UITransform).setContentSize(w,h);n.addComponent(Graphics);return n;};
    const factory={makeUiNode,makeRect,makeLabel:(name,parent,text)=>{const n=makeUiNode(name,parent);n.addComponent(Label).string=text;return n;},
        makeButton:(name,parent,w,h)=>{const n=makeRect(name,parent,w,h);n.addComponent(Button);return n;}};
    const cache=new Map();
    function load(name) {
        if(cache.has(name))return cache.get(name);
        const module={exports:{}};cache.set(name,module.exports);
        const source=fs.readFileSync(path.join(__dirname,'../assets/scripts',name+'.ts'),'utf8');
        const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
        vm.runInNewContext(code,{module,exports:module.exports,require:id=>{
            if(id==='cc')return cc;
            const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),id));
            if(resolved==='ui/RuntimeUiFactory')return factory;
            if(resolved==='ui/ProjectUiFonts')return {styleProjectUiLabel(){}};
            if(resolved==='backend/PlayerData')return {PlayerData:{completeTutorial:async()=>{}}};
            return load(resolved);
        }});
        return module.exports;
    }
    const layers=load('ui/UILayers'),session=load('app/LobbySceneSession');
    const {TutorialOverlay}=load('tutorial/TutorialOverlay');
    const {TutorialRaceController}=load('tutorial/TutorialRaceController');
    const {TUTORIAL_RUNTIME}=load('tutorial/TutorialSession');
    const {GameState}=load('core/GameConstants');
    function canvas(parent,name,priority) {const n=makeUiNode(name,parent);const c=n.addComponent(Canvas);const cam=makeUiNode('Camera',n);c.cameraComponent=cam.addComponent(Camera);c.cameraComponent.priority=priority;return n;}
    return {Node,Canvas,Graphics,UITransform,Label,Button,BlockInputEvents,Vec3,viewport,layers,session,TutorialOverlay,TutorialRaceController,TUTORIAL_RUNTIME,GameState,canvas,persist,
        scene:()=>{currentScene=new Node('Scene');return currentScene;}, get scale(){return scale;},listeners};
}

function tree(node) {return [node,...node.children.flatMap(tree)];}
// 只模拟界面矩形、相机优先级和阻挡组件；不代替 Cocos 触摸分发或真机渲染。
function hitUi(f,scene,x,y) {
    const candidates=tree(scene).map((node,index)=>{
        if(!node.activeInHierarchy)return null;
        const blocker=node.getComponent(f.BlockInputEvents),button=node.getComponent(f.Button);
        if(!blocker?.enabled&&!(button?.enabled&&button.interactable))return null;
        const transform=node.getComponent(f.UITransform);if(!transform)return null;
        let canvas=node;while(canvas&&!canvas.getComponent(f.Canvas))canvas=canvas.parent;
        const camera=canvas?.getComponent(f.Canvas)?.cameraComponent;if(!camera)return null;
        const world=camera.screenToWorld(new f.Vec3(x+f.viewport.width/2,y+f.viewport.height/2),new f.Vec3());
        const local=transform.convertToNodeSpaceAR(world);
        if(Math.abs(local.x)>transform.width/2||Math.abs(local.y)>transform.height/2)return null;
        return {node,index,priority:camera.priority};
    }).filter(Boolean).sort((a,b)=>b.priority-a.priority||b.index-a.index);
    return candidates[0]?.node??null;
}

test('大厅欢迎卡避让原按钮，常见横屏比例都只放行原按钮的真实范围',()=>{
    for(const [width,height] of [[1280,720],[1560,720],[1600,720],[960,720],[960,540]]) {
        for(const placement of ['bottom','center','top']) {
            const f=fixture();Object.assign(f.viewport,{width,height});
            const scene=f.scene(),canvas=f.canvas(scene,'LobbyCanvas',0);
            // 来源画布带位移，按钮带父级缩放，覆盖独立弹窗相机的首屏投影。
            canvas.setPosition(37,-19);
            const group=new f.Node('LobbyActionsMotion');group.setParent(canvas);
            const scale=Math.min(1,width/1280,height/720);group.setScale(scale,scale);
            const x=placement==='center'?0:width*.28;
            const y=placement==='bottom'?-height*.28:placement==='top'?height*.28:0;
            const room=new f.Node('FriendRoomButton');room.setParent(group);room.setPosition(x/scale-222,y/scale);
            room.addComponent(f.UITransform).setContentSize(102,102);room.addComponent(f.Button);
            const start=new f.Node('StartRaceButton');start.setParent(group);start.setPosition(x/scale,y/scale);
            start.addComponent(f.UITransform).setContentSize(352,102);start.addComponent(f.Button);
            let starts=0;start.on('click',()=>starts++);
            const view=new f.TutorialOverlay(canvas);
            view.show('欢迎来到划水高手','准备好下水了吗？',true,'',null,start,true);
            assert.equal(view.action.active,false,'大厅不能覆盖另一个教学按钮');
            assert.equal(tree(view.root).filter(n=>n.activeInHierarchy&&n.getComponent(f.Button)).length,0);
            const card=view.panel,transform=card.getComponent(f.UITransform);
            const l=card.position.x-transform.width*card.scale.x/2,r=card.position.x+transform.width*card.scale.x/2;
            const b=card.position.y-transform.height*card.scale.y/2,t=card.position.y+transform.height*card.scale.y/2;
            const bl=x-176*scale,br=x+176*scale,bb=y-51*scale,bt=y+51*scale;
            assert.ok(b>bt||t<bb,'欢迎文字必须与原按钮分开');
            assert.ok(l>=-width/2&&r<=width/2&&b>=-height/2&&t<=height/2,'欢迎卡不能越出屏幕');
            for(const [px,py] of [[x,y],[bl+.5,bb+.5],[br-.5,bt-.5],[br-.5,bb+.5],[bl+.5,bt-.5]]) {
                assert.equal(hitUi(f,scene,px,py),start,`${width}×${height} / ${placement}：原按钮全区域可点`);
            }
            hitUi(f,scene,x,y).emit('click');assert.equal(starts,1);assert.equal(start.listeners.get('click').size,1);
            for(const [px,py] of [[br+1,y],[bl-1,y],[x,bt+1],[x,bb-1],[x-222*scale,y],[x-176*scale-1,y],[0,height/2-1]]) {
                assert.ok(hitUi(f,scene,px,py)?.getComponent(f.BlockInputEvents)?.enabled,
                    '按钮外及邻近联机区域必须阻挡，不能把高亮留白当可点击区');
            }
            const counts=tree(view.root).map(n=>[n.components.length,[...n.listeners.values()].reduce((sum,v)=>sum+v.size,0)]);
            const graphics=tree(view.root).flatMap(n=>n.components.filter(c=>c instanceof f.Graphics));
            const clears=graphics.map(g=>g.clears);
            for(let i=0;i<20;i++)view.show('欢迎来到划水高手','准备好下水了吗？',true,'',null,start,true);
            assert.deepEqual(graphics.map(g=>g.clears),clears,'重复状态同步不能重绘遮罩');
            for(let i=0;i<20;i++)for(const resize of f.listeners.get('canvas-resize'))resize();
            assert.deepEqual(tree(view.root).map(n=>[n.components.length,[...n.listeners.values()].reduce((sum,v)=>sum+v.size,0)]),counts);
            assert.equal(hitUi(f,scene,x,y),start);
            view.dispose();canvas.destroy();for(const set of f.listeners.values())assert.equal(set.size,0);
        }
    }
});

test('欢迎遮罩恢复时重算隐藏期间的屏幕变化，比赛讲解仍整屏阻挡，练习不阻挡',()=>{
    const f=fixture(),scene=f.scene(),canvas=f.canvas(scene,'LobbyCanvas',0);
    const start=new f.Node('StartRaceButton');start.setParent(canvas);start.setPosition(438,-207);
    start.addComponent(f.UITransform).setContentSize(352,102);start.addComponent(f.Button);
    const view=new f.TutorialOverlay(canvas);
    view.show('欢迎','准备下水',true,'',null,start,true);
    view.hide();f.viewport.width=1600;
    for(const resize of f.listeners.get('canvas-resize'))resize();
    view.show('欢迎','准备下水',true,'',null,start,true);
    assert.equal(view.shade.getComponent(f.UITransform).width,1600);
    assert.equal(hitUi(f,scene,438,-207),start);
    assert.ok(hitUi(f,scene,799,0)?.getComponent(f.BlockInputEvents)?.enabled);
    view.show('起跳','按住蓄力，松手起跳',true,'我来试试',()=>{},start);
    assert.equal(view.shadeBlocker.enabled,true);
    assert.equal(hitUi(f,scene,438,-207),view.shade,'比赛讲解不能因高亮目标而漏掉全屏阻挡');
    assert.ok(view.inputBlockers.every(n=>!n.active));
    view.show('','按住，松手',false,'',null,start);
    assert.equal(view.shade.active,false);assert.equal(view.panelBlocker.enabled,false);
    assert.equal(hitUi(f,scene,438,-207),start,'练习提示不占用操作');
    view.dispose();canvas.destroy();for(const set of f.listeners.values())assert.equal(set.size,0);
});

test('保留的隐藏大厅画布不能接管教学；开始按钮恢复比赛，返回大厅不遗留比赛弹窗',()=>{
    const f=fixture();let scene=f.scene();const lobby=f.canvas(scene,'LobbyCanvas',0);
    const oldView=new f.TutorialOverlay(lobby);const lobbyPopup=oldView.root.parent.parent;
    for(let round=0;round<3;round++) {
        f.session.retainLobbyForRace([lobby,lobbyPopup],()=>{lobbyPopup.active=true;});
        scene=f.scene();for(const node of f.persist)node.setParent(scene);
        const raceCanvas=f.canvas(scene,'RaceCanvas',10);
        const controller=new f.TutorialRaceController(raceCanvas,{isUnderwater:false,motor:{setCharacterAbility(){},setTutorialHeartRate(){},cancelTutorialStrokeInput(){}}},{},()=>{},()=>{});
        const popup=controller.view.root.parent.parent;
        assert.notEqual(popup,lobbyPopup,'比赛必须拥有独立弹窗画布');
        assert.equal(controller.view.root.activeInHierarchy,true,'暂停时继续按钮必须可见');
        assert.equal(lobbyPopup.active,false,'不能通过激活旧画布泄漏大厅遮罩');
        assert.ok(popup.getComponent(f.Canvas).cameraComponent.priority>10,'教学须绘制在比赛HUD之上');
        assert.ok(popup.getComponent(f.Canvas).cameraComponent.priority<100,'加载遮罩仍然位于最上层');
        assert.equal(f.scale,0);
        assert.equal(controller.lesson.step,'diveInfo');
        controller.view.action.emit('click');assert.equal(controller.lesson.step,'dive');assert.equal(f.scale,1);
        controller.update(1,f.GameState.DIVING);assert.equal(f.scale,1,'继续后无需倒计时或二次说明');
        controller.dispose();raceCanvas.destroy();assert.equal(popup.isValid,false,'销毁比赛Canvas必须释放其弹窗相机');
        assert.equal(f.session.resumeLobbyAfterRace(),true);
        assert.equal(f.layers.getUILayer(lobby,f.layers.UILayer.Popup).parent,lobbyPopup);
        assert.equal(oldView.root.activeInHierarchy,true);assert.equal(f.scale,1);
        assert.equal(scene.children.filter(n=>n.name==='UILayerPopupCanvas').length,1);
    }
    oldView.dispose();lobby.destroy();assert.equal(lobbyPopup.isValid,false);
    for(const set of f.listeners.values())assert.equal(set.size,0);
});

test('教学挂载失败时不冻结调度器，释放已建面板且不绑定角色回调',()=>{
    const f=fixture(),scene=f.scene(),canvas=f.canvas(scene,'RaceCanvas',10);
    const popup=f.layers.getUILayer(canvas,f.layers.UILayer.Popup).parent;
    popup.active=false;
    const swimmer={isUnderwater:false,motor:{cancelTutorialStrokeInput(){}}};
    assert.throws(()=>new f.TutorialRaceController(canvas,swimmer,{},()=>{},()=>{}),/可见画布/);
    assert.equal(f.scale,1);assert.equal(f.TUTORIAL_RUNTIME.paused,false);
    assert.equal(swimmer.onObservedRhythmResult,undefined);
    assert.equal(popup.children.flatMap(n=>n.children).filter(n=>n.name==='TutorialOverlay').length,0);
    canvas.destroy();for(const set of f.listeners.values())assert.equal(set.size,0);
});


test('讲解与练习共用稳定层级，计数刷新不重绘遮罩，练习卡给比赛留出空间',()=>{
    const f=fixture(),canvas=f.canvas(f.scene(),'RaceCanvas',10),view=new f.TutorialOverlay(canvas);
    const count=node=>1+node.children.reduce((n,child)=>n+count(child),0);
    const nodes=count(view.root);
    view.setStage('2 / 5 · 左右划水');
    view.show('左右轮流','按住，松手，再换边。',false,'',null);
    assert.equal(view.panel.getComponent(f.UITransform).height,154);
    const shade=view.shade.getComponent(f.Graphics),panel=view.panel.getComponent(f.Graphics);
    const before=[shade.clears,panel.clears];
    for(let i=0;i<30;i++)view.show('左右轮流','已完成 '+i+' / 30',false,'',null);
    assert.deepEqual([shade.clears,panel.clears],before,'计数仅更新文字，不能重绘');
    for(let i=0;i<20;i++) {
        view.show('说明','慢慢来',true,'试试看',()=>{});
        assert.equal(view.panel.getComponent(f.UITransform).height,248);
        view.show('左右轮流','按住，松手，再换边。',false,'',null);
    }
    assert.equal(count(view.root),nodes);assert.equal(view.action.listeners.get('click').size,1);
    view.dispose();canvas.destroy();for(const set of f.listeners.values())assert.equal(set.size,0);
});

test('后半段提示贴近HUD，中央口令隐藏，自由游清空卡片且不拦截划水',()=>{
    const f=fixture(),canvas=f.canvas(f.scene(),'RaceCanvas',10),view=new f.TutorialOverlay(canvas);
    const heart=new f.Node('HeartBase');heart.setParent(canvas);
    const dolphin=new f.Node('DolphinJumpButton');dolphin.setParent(canvas);
    view.targetRect=()=>view.target===dolphin
        ? {x:520,y:-270,width:80,height:80,xMax:600,yMax:-190}
        : {x:-566,y:180,width:100,height:100,xMax:-466,yMax:280};
    view.setStage('');
    view.show('心率越高，亮区越窄','爱心显示心率。',true,'试试看',()=>{},heart,false,true);
    assert.ok(view.panel.position.x<0);assert.ok(view.panel.position.y<180);
    assert.equal(view.panel.getComponent(f.UITransform).height,190);
    assert.ok(view.action.position.x<0,'确认按钮跟随提示卡，不留在屏幕中央');
    view.show('','黄色：亮区变窄 · 已体验 0/4 次\n按住左半屏，白点进亮区时松手',false,'',null,heart,false,true);
    assert.equal(view.panel.getComponent(f.UITransform).height,78);
    assert.equal(view.body.node.getComponent(f.UITransform).height,60,'两行提示保留正常字号的行高');
    assert.equal(view.panelBlocker.enabled,false,'体验提示不占用左右半屏触控');
    view.setCue('就是现在，松手！');assert.equal(view.cue.node.active,false);
    assert.equal(view.title.node.active,false);assert.equal(view.stage.node.active,false);
    const panel=view.panel.getComponent(f.Graphics),shade=view.shade.getComponent(f.Graphics),highlight=view.highlight;
    const before=[panel.clears,shade.clears,highlight.clears];
    for(let i=0;i<30;i++)view.show('','黄色：亮区变窄 · 已体验 '+i+'/30 次\n按住右半屏，白点进亮区时松手',false,'',null,heart,false,true);
    assert.deepEqual([panel.clears,shade.clears,highlight.clears],before);
    view.show('','圆环满了，点海豚！',false,'',null,dolphin,false,true);
    assert.equal(view.panel.getComponent(f.UITransform).height,54,'单行提示仍保持紧凑');
    assert.ok(view.panel.position.x>0);assert.ok(view.panel.position.y>-190);
    view.show('','',false,'',null,null,false,true);
    assert.equal(view.panel.active,false);assert.equal(view.shade.active,false);assert.equal(view.action.active,false);
    view.dispose();canvas.destroy();for(const set of f.listeners.values())assert.equal(set.size,0);
});
