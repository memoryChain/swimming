// 运行真实控制器与表现方法；替代渲染器，不启动 Cocos。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHarness}=require('./helpers/cocos-math-harness.cjs');
function setup(){
    const h=createHarness(); h.cc.AnimationClip={WrapMode:{Normal:1,Loop:2}};
    Object.defineProperty(h.Node.prototype,'activeInHierarchy',{get(){return this.active!==false && (!this.parent || this.parent.activeInHierarchy);}});
    const tuning=h.load(path.join(h.root,'assets/scripts/entity/SharkTuning.ts'));
    const {SharkArtPresentation,sharkContactClipTime}=h.load(path.join(h.root,'assets/scripts/core/SharkArtPresentation.ts'));
    const {SharkController}=h.load(path.join(h.root,'assets/scripts/entity/SharkController.ts'));
    const animation={isValid:true,plays:[],samples:[],stops:0,states:{},
        getState(name){return this.states[name]??= {duration:name==='Shark_Bite'?10/24:name==='Shark_Entry_Rise'?1.1:1,
          setTime(t){this.time=t;},sample(){animation.samples.push([name,this.time]);}};},
        play(n){this.plays.push(n);},crossFade(n){this.plays.push(n);},stop(){this.stops++;}};
    const node=new h.Node(),swimmer={node:new h.Node(),distance:40,raceDirection:-1,isSharkTargetable:true};
    swimmer.node.setPosition(.75,0,0); const hits=[];
    const course={waterY:0,direction:1,poolLength:50,poolWidth:20,raceStartX:-25,raceEndX:25};
    const shark=new SharkController({node,course,swimmers:()=>[swimmer],laneFor:s=>s===swimmer?0:-1,
        swimmerForLane:lane=>lane===0?swimmer:null,onKnockDown:s=>hits.push(s),hungerSchedule:[1000,2000,3000]});
    const art=new SharkArtPresentation(),model=new h.Node();
    const snapshot=(state,sequence=1,remaining=.38,raceElapsed=10)=>({state,sequence,remainingSeconds:remaining,raceElapsed,
      huntOpeningGraceSeconds:0,x:0,z:0,facingX:1,facingZ:0,targetLane:0,knockedLane:0,huntIndex:0});
    return {...h,...tuning,SharkArtPresentation,sharkContactClipTime,animation,node,swimmer,hits,shark,art,model,snapshot};
}
test('分段映射在默认与有效调参下都对齐真实接触，不改时长',()=>{
    const h=setup();for(const [d,a]of [[.38,.09],[.7,.18],[.2,0],[.2,.2]]){
        const at=h.sharkContactClipTime(a,d,a);
        assert.ok(Math.abs(at-(a===d?10/24:.09))<1e-8);
        assert.ok(Math.abs(h.sharkContactClipTime(d,d,a)-10/24)<1e-8);
        let last=-1;for(let i=0;i<=100;i++){const t=h.sharkContactClipTime(d*i/100,d,a);assert.ok(t>=last);last=t;}
    }
});
test('正式接触与巡游接触均在前摇后只结算一次，迁移不重复结算',()=>{
    for(const state of [3,6]){
        const h=setup();h.shark.applyAuthoritativeState(h.snapshot(state));h.shark.tick(.05);assert.equal(h.hits.length,0);
        h.shark.tick(.041);assert.equal(h.hits.length,1);h.shark.tick(.30);assert.equal(h.hits.length,1);
        assert.equal(h.shark.state,h.SharkState.WANDER);assert.equal(h.shark.huntIndex,state===3?1:0);
        const migrated=setup();migrated.shark.applyAuthoritativeState(migrated.snapshot(state,2,.1,12));migrated.shark.tick(.15);
        assert.equal(migrated.hits.length,0);
    }
});
test('高速静止及不同高度只消费原目标资格与圆鼻命中范围',()=>{
    for(const y of [-1.5,0,2])for(const sign of [-1,1]){
        const h=setup();h.swimmer.node.setPosition(sign*.75,y,0);
        const s=h.snapshot(h.SharkState.HUNT,1,8);s.facingX=sign;h.shark.applyAuthoritativeState(s);
        h.shark.tick(.001);assert.equal(h.shark.state,h.SharkState.BITE);
        const protectedH=setup();protectedH.swimmer.isSharkTargetable=false;
        protectedH.shark.applyAuthoritativeState(protectedH.snapshot(protectedH.SharkState.HUNT,1,8));protectedH.shark.tick(.1);
        assert.notEqual(protectedH.shark.state,protectedH.SharkState.BITE);
    }
    const h=setup();h.swimmer.node.setPosition(1.31,0,0);h.shark.applyAuthoritativeState(h.snapshot(h.SharkState.HUNT,1,8));
    h.shark.tick(.001);assert.notEqual(h.shark.state,h.SharkState.BITE);
});
test('持续逆向接触走巡游顶推，前后侧方候选与原冷却保持',()=>{
    for(const [x,z]of [[1.5,0],[-1.5,0],[0,1.5]]){
        const h=setup();h.swimmer.node.setPosition(x,0,z);h.shark.applyAuthoritativeState(h.snapshot(h.SharkState.WANDER,2,0));
        for(let i=0;i<18;i++)h.shark.updateObstacleBites([h.swimmer],.1);
        assert.equal(h.shark.state,h.SharkState.PATROL_BITE);assert.equal(h.hits.length,0);
        h.shark.tick(.1);assert.equal(h.hits.length,1);h.shark.tick(.3);assert.equal(h.shark.huntIndex,0);
        for(let i=0;i<20;i++)h.shark.updateObstacleBites([h.swimmer],.1);
        assert.equal(h.shark.state,h.SharkState.WANDER);
    }
});
test('模型晚加载从当前接触阶段恢复，重复与倒序快照不倒播',()=>{
    for(const mode of [3,6]){
        const h=setup();h.shark.applyAuthoritativeState(h.snapshot(mode,4,.18));h.art.sync(h.shark,0,false);
        h.art.bind(h.model,h.animation,h.shark);
        assert.equal(h.animation.plays.filter(x=>x==='Shark_Bite').length,1);
        const first=h.animation.samples.at(-1)[1];assert.ok(first>.09);
        h.shark.applyAuthoritativeState(h.snapshot(mode,4,.30,9));h.art.sync(h.shark,.01,false);
        assert.equal(h.shark.remainingSeconds,.18);assert.ok(h.animation.samples.at(-1)[1]>=first);
        h.art.notifyContact(4,h.shark);h.art.notifyContact(4,h.shark);
        assert.equal(h.animation.plays.filter(x=>x==='Shark_Bite').length,1);
        h.shark.applyAuthoritativeState(h.snapshot(h.SharkState.WANDER,4,0,11));h.art.sync(h.shark,0,false);
        assert.equal(h.animation.plays.at(-1),'Shark_Swim_Loop');
        h.art.bind(h.model,h.animation,h.shark);assert.equal(h.animation.plays.filter(x=>x==='Shark_Bite').length,1);
    }
});
test('漏收巡游蓄势时可靠命中从接触节点接续，尾段结束不重播',()=>{
    const h=setup();h.shark.applyAuthoritativeState(h.snapshot(h.SharkState.WANDER,2,0));h.art.bind(h.model,h.animation,h.shark);
    h.art.notifyContact(3,h.shark);assert.ok(Math.abs(h.animation.samples.at(-1)[1]-.09)<1e-8);
    for(let i=0;i<30;i++)h.art.sync(h.shark,1/60,true);
    assert.equal(h.animation.plays.at(-1),'Shark_Swim_Loop');const count=h.animation.plays.length;
    h.art.notifyContact(3,h.shark);assert.equal(h.animation.plays.length,count);
    h.shark.applyAuthoritativeState(h.snapshot(6,3,.02,11));h.art.sync(h.shark,0,true);assert.equal(h.animation.plays.length,count);
});
test('零资源期间也保留序号，晚加载不重播已过期事件；销毁与重开无残留',()=>{
    const h=setup();h.shark.applyAuthoritativeState(h.snapshot(6,3,.30));h.art.sync(h.shark,0,false);
    h.shark.applyAuthoritativeState(h.snapshot(4,3,0,11));h.art.sync(h.shark,0,false);h.art.bind(h.model,h.animation,h.shark);
    assert.deepEqual(h.animation.plays,['Shark_Swim_Loop']);
    for(let i=0;i<20;i++){
        h.shark.reset();h.art.sync(h.shark,0,false);h.shark.applyAuthoritativeState(h.snapshot(6,1,.38,10));h.art.sync(h.shark,0,false);
        h.shark.tick(.4);h.art.sync(h.shark,0,false);assert.equal(h.art.mode,'swim');
    }
    assert.equal(h.model.position.x,0);assert.equal(h.model.position.z,0);assert.equal(h.model.position.y,-.1);
    h.shark.reset();h.art.sync(h.shark,0,false);const count=h.animation.plays.length,samples=h.animation.samples.length,stops=h.animation.stops;
    for(let i=0;i<120;i++)h.art.sync(h.shark,1/60,false);
    assert.equal(h.animation.samples.length,samples);assert.equal(h.animation.stops,stops);
    h.art.dispose();h.art.bind(new h.Node(),h.animation,h.shark);assert.equal(h.animation.plays.length,count);
});
test('实际导出游动和顶推通道首尾一致，骨架、材质与资源预算符合交付',()=>{
    const h=setup(),dir=path.join(h.root,'art/shark-animation');
    const a=JSON.parse(fs.readFileSync(path.join(dir,'export-audit.json'))),source=JSON.parse(fs.readFileSync(path.join(dir,'source-audit.json')));
    for(const name of ['Shark_Swim_Loop','Shark_Bite'])assert.equal(a.animations.find(x=>x.name===name).channel_endpoint_max_delta,0);
    assert.equal(a.inverse_bind_max_delta,0);assert.equal(source.rest_matrices_unchanged,true);assert.equal(source.jaw_weighted_vertices,0);
    const b=fs.readFileSync(path.join(h.root,'assets/race/models/SharkModel.glb')),g=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
    assert.equal(g.meshes.length,1);assert.equal(g.meshes[0].primitives.length,1);assert.equal(g.materials.length,1);assert.equal(g.images?.length??0,0);
    assert.equal(g.skins[0].joints.length,7);assert.ok(b.length<249000);
    for(const anim of g.animations){assert.equal(Math.min(...anim.samplers.map(s=>g.accessors[s.input].min[0])),0);}
});

test('侧后方巡游顶推只校准演员，归位后不留下旋转或位移',()=>{
    for(const [x,z]of [[-2,0],[0,2],[2,0]]){
        const h=setup();h.swimmer.node.setPosition(x,0,z);h.shark.applyAuthoritativeState(h.snapshot(6,3,.38));
        h.art.bind(h.model,h.animation,h.shark);h.shark.tick(.09);h.art.notifyContact(3,h.shark);
        const base=h.node.position.clone();const world=h.model.position;
        assert.ok(Math.hypot(world.x,world.z)<=.55);assert.ok(h.animation.samples.at(-1)[1]>=.09-1e-7);
        const yaw=h.model.eulerAngles.y*Math.PI/180;
        // GLB +Z 鼻头旋转后指向目标；点积大于零即可排除朝后顶推。
        assert.ok(Math.sin(yaw)*x+Math.cos(yaw)*z>0);
        assert.equal(h.node.position.x,base.x);assert.equal(h.node.position.z,base.z);
        h.shark.tick(.3);h.art.sync(h.shark,0,false);
        assert.ok(Math.abs(h.model.eulerAngles.y-90)<.001);assert.equal(h.model.position.x,0);assert.equal(h.model.position.z,0);
    }
});

function methods(h,file,names,scope={}){
    const source=fs.readFileSync(path.join(h.root,file),'utf8');
    const {compiler}=require('./helpers/water-splash-harness.cjs');const ts=compiler();
    const members=names.map(name=>{const start=source.indexOf('    private '+name+'(')>=0?source.indexOf('    private '+name+'('):source.indexOf('    '+name+'(');
        assert.ok(start>=0,name);const match=source.slice(start).match(/\n    (?:private |public |protected )?(?:async )?[A-Za-z][\w]*\(/);return source.slice(start,match?start+match.index:source.lastIndexOf('\n}'));}).join('\n');
    const js=ts.transpileModule('class Probe {\n'+members+'\n}',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    return new Function(...Object.keys(scope),js+';return Probe;')(...Object.values(scope));
}
test('真实管理器结果去重、B1 接线、旧局水花回调和过期演出隔离',()=>{
    const h=setup();h.shark.applyAuthoritativeState(h.snapshot(6,3,.29));
    const Recovery=h.load(path.join(h.root,'assets/scripts/core/EntertainmentRecoveryController.ts'));
    const paths=h.load(path.join(h.root,'assets/scripts/core/ResourcePaths.ts'));
    const Probe=methods(h,'assets/scripts/core/GameManager.ts',['applySharkKnockDown'],{
        EntertainmentRecoveryReason:Recovery.EntertainmentRecoveryReason,EntertainmentRecoveryPhase:Recovery.EntertainmentRecoveryPhase,
        ENTERTAINMENT_RECOVERY_TUNING:Recovery.ENTERTAINMENT_RECOVERY_TUNING,SHARK_TUNING:h.SHARK_TUNING,
        SHARK_MODEL_PRESENTATION:paths.SHARK_MODEL_PRESENTATION,GameState:{RACING:1},SWIMMER_LAYER:7,setLayerRecursive:()=>{}});
    const p=new Probe(),calls={recovery:0,contact:0,camera:0,splash:0,broadcast:0},callbacks=[];
    h.swimmer.setSplashCulled=()=>{};h.swimmer.cartoonRig={splashNode:null,triggerBigSplashAt:()=>calls.splash++};
    Object.assign(p,{_shark:h.shark,_state:1,_lastSharkBitePresentationSequence:-1,_sharkPresentationGeneration:1,_sharkBiteWorldPosition:new h.Vec3(),
      swimmerForLane:()=>h.swimmer,applyEventKnockdown:()=>{calls.recovery++;return true;},_sharkArtPresentation:{notifyContact:()=>calls.contact++},
      _eventPictureInPicture:{showSharkContact:()=>calls.camera++},_netRaceController:{isHost:true,enqueueSharkKnockdown:()=>calls.broadcast++},scheduleOnce:cb=>callbacks.push(cb)});
    p.applySharkKnockDown(0,40,3,true);p.applySharkKnockDown(0,40,3,true);p.applySharkKnockDown(0,40,2,true);
    assert.deepEqual(calls,{recovery:1,contact:1,camera:1,splash:0,broadcast:1});assert.equal(callbacks.length,1);
    p._sharkPresentationGeneration++;callbacks[0]();assert.equal(calls.splash,0);
    // 已在 B1 后段的迟到通知不重播顶推水花和镜头。
    p._lastSharkBitePresentationSequence=-1;p._entertainmentRecovery={stateForLane:()=>({phase:Recovery.EntertainmentRecoveryPhase.KNOCKED,remainingSeconds:1})};
    p.applySharkKnockDown(0,40,3,false);assert.equal(calls.camera,1);assert.equal(callbacks.length,1);
});
test('真实入场层复用水花，晚快照与退场重开不移动权威根',()=>{
    const h=setup(),events=[];h.cc.Node=h.Node;
    const {SharkEntryPresentation}=h.load(path.join(h.root,'assets/scripts/core/SharkEntryPresentation.ts'));
    const visual=new h.Node(),entry=new SharkEntryPresentation(new h.Node(),visual,{waterY:0},7,{play:r=>events.push(r),cancelOwner:()=>{}});
    const shark={node:new h.Node(),state:1,sequence:1,huntIndex:0,entryProgress:.5};
    entry.update(.1,shark);assert.ok(visual.position.y<0);shark.entryProgress=.8;entry.update(.1,shark);entry.update(.1,shark);assert.equal(events.length,1);
    entry.reset();shark.entryProgress=1;entry.update(.1,shark);assert.equal(events.length,1);
    for(const state of [2,3]){shark.state=state;entry.update(.1,shark);shark.state=5;entry.update(.3,shark);assert.ok(visual.position.y<0&&visual.position.y>h.SHARK_TUNING.satiatedSinkOffset);assert.equal(shark.node.position.y,0);}
    entry.reset();shark.state=1;shark.entryProgress=1;entry.update(.01,shark);assert.equal(visual.position.y,0);entry.dispose();
});

test('同源可见回退在正常加载和退出时均完整释放，反复重开不累积资源',()=>{
    const h=setup(),live={mesh:0,material:0};
    h.Node.prototype.setParent=function(p){this.parent=p;p.children.push(this);};
    h.Node.prototype.destroy=function(){if(!this.isValid)return;this.isValid=false;const p=this.parent;if(p)p.children.splice(p.children.indexOf(this),1);};
    h.Node.prototype.addComponent=function(){return {setMaterial(){}};};
    h.cc.Node=function(name){const n=new h.Node();n.name=name;return n;};
    h.cc.utils={createMesh(g){assert.ok(g.positions.length>0&&g.indices.length>0);live.mesh++;return {destroy(){live.mesh--;}};}};
    h.cc.Material=class{constructor(){live.material++;}initialize(v){assert.equal(v.defines.USE_VERTEX_COLOR,true);}destroy(){live.material--;}};
    const parent=new h.Node();
    for(let i=0;i<20;i++){
        const art=new h.SharkArtPresentation();const fallback=art.buildFallback(parent,7);assert.equal(parent.children.length,1);assert.equal(fallback.layer,7);
        if(i%2===0){art.bind(h.model,h.animation,h.shark);art.releaseFallback();}
        art.dispose();art.dispose();assert.equal(parent.children.length,0);assert.deepEqual(live,{mesh:0,material:0});
    }
});
test('真实画中画方法保留两条接触中景与空中选手，且不新增相机',()=>{
    const h=setup();const Probe=methods(h,'assets/scripts/camera/RaceEventPictureInPictureCamera.ts',['updateSharkCameraPose'],{SharkState:h.SharkState});
    for(const state of [3,6])for(const y of [-1,0,2]){
        const p=new Probe();Object.assign(p,{options:{course:{waterY:0}},subjectPosition:new h.Vec3(),targetPosition:new h.Vec3(),cameraPosition:new h.Vec3(),focus:new h.Vec3(),biteCameraBasisReady:false,applyCameraPose:f=>p.fov=f});
        h.swimmer.node.setPosition(1.4,y,0);h.shark.applyAuthoritativeState(h.snapshot(state));p.updateSharkCameraPose(h.shark);
        assert.equal(p.fov,48);assert.ok(p.cameraPosition.y>=2.6);assert.ok(Math.abs(p.cameraPosition.z)>=3.8);assert.equal(p.focus.x,.7);
        assert.ok(p.focus.y>=.12);
    }
});
