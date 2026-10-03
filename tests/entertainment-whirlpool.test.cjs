const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const near = (a,b,e=1e-8) => assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function fixture(external={}) {
    const h=createHarness(external);
    h.loadModule=name=>h.load(path.join(h.root,'assets/scripts',name+'.ts'));
    return h;
}
const spawn=(variant='normal',spin=1)=>({id:0,distance:30,centerFraction:0,spin,variant});
const influence=()=>({});

test('本局排布确定、独立随机、折返和终点安全，200/400 米有界',()=>{
    const h=fixture(),r=h.loadModule('entertainment/WhirlpoolBrawlRules'),rng=h.loadModule('core/SharedRNG');
    for(const distance of [200,400])for(const length of [25,50])for(const selection of ['normal','super']) {
        const a=r.buildWhirlpoolDebugSpawns(42,distance,length,selection);
        assert.deepEqual(a,r.buildWhirlpoolDebugSpawns(42,distance,length,selection));
        assert.notDeepEqual(a,r.buildWhirlpoolDebugSpawns(12345,distance,length,selection));
        assert.ok(a.length>0 && a.length<=8);
        assert.equal(a.filter(s=>s.variant==='super').length,selection==='super'?1:0);
        for(const s of a){
            const local=s.distance%length;
            assert.ok(Math.min(local,length-local)>=7.1);
            assert.ok(s.distance<distance-7);
        }
    }
    assert.equal(r.buildWhirlpoolDebugSpawns(42,NaN,50).length,0);
    assert.equal(r.buildWhirlpoolDebugSpawns(42,200,5).length,0);
    rng.reseedSharedRandom(99);const expected=rng.randomFloat();rng.reseedSharedRandom(99);
    r.buildWhirlpoolDebugSpawns(42,200,50,'super');assert.equal(rng.randomFloat(),expected);
    const a=r.buildWhirlpoolDebugSpawns(42,200,50),b=r.buildWhirlpoolDebugSpawns(99,200,50);
    assert.notDeepEqual(a,b);assert.deepEqual(a,r.buildWhirlpoolDebugSpawns(42,200,50));
});

test('水流旋向、核心惩罚、边界归零与超级规格沿用来源规则',()=>{
    const h=fixture(),r=h.loadModule('entertainment/WhirlpoolBrawlRules');
    for(const variant of ['normal','super'])for(const spin of [-1,1]){
        const s=spawn(variant,spin),offset=variant==='super'?4.284:2.856;
        const downstream=r.sampleWhirlpoolInfluence(30,-spin*offset,20,influence(),[s]);
        const against=r.sampleWhirlpoolInfluence(30,spin*offset,20,influence(),[s]);
        assert.ok(downstream.forwardAcceleration>0);assert.ok(against.forwardAcceleration<0);
        const core=r.sampleWhirlpoolInfluence(30,0,20,influence(),[s]);
        assert.equal(core.intensity,1);assert.equal(core.captureIntensity,1);assert.ok(core.forwardAcceleration<=-6);
        const out=r.sampleWhirlpoolInfluence(60,0,20,influence(),[s]);
        assert.equal(out.intensity,0);assert.equal(out.captureDrag,0);assert.equal(out.whirlpoolId,-1);
    }
    const buffer=influence();r.sampleWhirlpoolInfluence(30,0,20,buffer,[spawn()]);
    assert.equal(r.sampleWhirlpoolInfluence(NaN,0,20,buffer,[spawn()]),buffer);assert.equal(buffer.intensity,0);
});

test('AI 按半径绕开核心，方向与真实返程一致，离开后没有旧目标',()=>{
    const h=fixture(),r=h.loadModule('entertainment/WhirlpoolBrawlRules');
    for(const direction of [-1,1])for(const spin of [-1,1])near(r.whirlpoolWorldSpin(spawn('normal',spin),direction),spin*direction);
    for(const scale of [.7,1,1.3]) {
        const s={...spawn(),radiusScale:scale};
        const z=r.whirlpoolTargetZForAi(20,0,20,[s]);
        near(Math.abs(z),4.2*scale*.68);
        const core=r.sampleWhirlpoolInfluence(30,.2*4.2*scale,20,influence(),[s]);
        near(core.coreIntensity,(.32-.2)/.32);
        assert.equal(r.whirlpoolTargetZForAi(100,0,20,[s]),null);
        const f=r.sampleWhirlpoolInfluence(30,z,20,influence(),[s]);
        assert.equal(f.coreIntensity,0);
    }
});

test('解析水流积分跨 10/30/60/120Hz 一致，水下减弱且 reset 清除余流',()=>{
    const h=fixture(),{WhirlpoolSwimmerCurrent:C}=h.loadModule('swimmer/WhirlpoolSwimmerCurrent');
    const results=[];
    for(const fps of [10,30,60,120]) {
        const c=new C([spawn()],20,0);let delta=0;
        for(let i=0;i<fps;i++){c.advance(30,0,0,0,false,1/fps);delta+=c.forwardDelta;}
        results.push(delta);assert.ok(delta<-1);
        c.reset();near(c.forwardDelta,0);c.advance(100,0,0,0,false,1/fps);near(c.forwardDelta,0);
        const dry=new C([spawn()],20,0),wet=new C([spawn()],20,0);
        dry.advance(30,0,2,0,false,.1);wet.advance(30,0,2,0,true,.1);
        near(wet.forwardDelta/dry.forwardDelta,.35);
        c.advance(30,0,2,0,false,NaN);near(c.forwardDelta,0);
    }
    for(const value of results)near(value,results[0]);
});

test('真实 Motor 使用本步位置采样，保持碰撞缓冲与速度上限独立',()=>{
    const h=fixture(),{SwimmerMotor}=h.loadModule('swimmer/SwimmerMotor');
    h.loadModule('core/GameBalance').setRaceDifficulty('competitive');
    const m=new SwimmerMotor();m.configureEntertainment(true,false);
    m.configureEntertainmentWhirlpools([spawn()],20,0);m.startRace();
    m._distance=30;m._currentSpeed=4;m._knockbackDistance=1.75;m._knockbackLateral=.5;
    m.setEntertainmentWhirlpoolActive(true);m.update(.1,{isAI:false});
    assert.equal(m._whirlpool.influence.whirlpoolId,0);
    near(m._knockbackDistance,1.75*Math.exp(-.1/.5));near(m._knockbackLateral,.5*Math.exp(-.1/.5));
    assert.ok(m._whirlpool.forwardDelta<0);
    for(let i=0;i<100;i++){
        m._distance=30;m._currentSpeed=4;m.update(.1,{isAI:false});
        assert.ok(Math.abs(m._whirlpool.forwardVelocity)<=3.4);
        assert.ok(Math.abs(m._whirlpool.forwardDelta)<=.34);
    }
    m._distance=200;m.update(.1,{isAI:false});assert.equal(m.isRacing,false);near(m._whirlpool.forwardDelta,0);
    m.configureEntertainment(false);assert.equal(m._whirlpool,null);
});

test('无漩涡的主干 Motor 数值完全相同，滑行/跳跃/重赛不补发旧水流',()=>{
    const h=fixture(),{SwimmerMotor}=h.loadModule('swimmer/SwimmerMotor');
    h.loadModule('core/GameBalance').setRaceDifficulty('competitive');
    const a=new SwimmerMotor(),b=new SwimmerMotor();a.startRace();b.startRace();
    b.configureEntertainment(true,false);b.configureEntertainmentWhirlpools([],20,0);
    for(const m of [a,b])m._currentSpeed=4;
    for(let i=0;i<120;i++){a.update(1/60,{isAI:false});b.update(1/60,{isAI:false});near(a.distance,b.distance);near(a.currentSpeed,b.currentSpeed);}
    b.configureEntertainmentWhirlpools([spawn()],20,0);b.setEntertainmentWhirlpoolActive(true);
    b._distance=30;b.update(.1,{isAI:false});assert.ok(b._whirlpool.forwardDelta<0);
    b.tickRestingHeartRate(.1);near(b._whirlpool.forwardDelta,0);
    b.advanceVisualAnimation(.1);near(b._whirlpool.forwardDelta,0);
    b.startRace();near(b._whirlpool.forwardDelta,0);b._glidePhaseActive=true;b._distance=30;
    b.update(.1,{isAI:false});near(b._whirlpool.forwardDelta,0);
    b.setEntertainmentWhirlpoolActive(false);b._glidePhaseActive=false;b.update(.1,{isAI:false});near(b._whirlpool.forwardDelta,0);
});

function visualFixture(spawns=[spawn(),{...spawn('super',-1),id:1,distance:80}]) {
    const h=fixture(),meshes=[],materials=[],counts={transform:0,registered:0,released:0};
    class Node extends h.Node {
        components=[];active=true;layer=1;
        constructor(name=''){super();this.name=name;}
        setParent(p){this.parent=p;p.children.push(this);}
        setWorldPosition(x,y,z){counts.transform++;super.setWorldPosition(new h.Vec3(x,y,z));}
        setPosition(...a){counts.transform++;super.setPosition(...a);}
        setScale(...a){counts.transform++;super.setScale(...a);}
        setRotationFromEuler(...a){counts.transform++;super.setRotationFromEuler(...a);}
        addComponent(Type){const c=new Type();this.components.push(c);return c;}
        destroy(){this.isValid=false;for(const n of this.children)n.destroy();}
    }
    class Material {
        props={};writes=0;isValid=true;
        constructor(){materials.push(this);}
        initialize(options){this.options=options;}
        copy(m){this.options=m.options;}
        setProperty(k,v){this.writes++;this.props[k]={...v};}
        destroy(){this.isValid=false;}
    }
    class Color {constructor(r=0,g=0,b=0,a=255){Object.assign(this,{r,g,b,a});}clone(){return new Color(this.r,this.g,this.b,this.a);}static WHITE=new Color(255,255,255);}
    class Vec4 {constructor(x,y,z,w){Object.assign(this,{x,y,z,w});}}
    class MeshRenderer {setMaterial(material){this.material=material;}}
    Object.assign(h.cc,{Node,Material,Color,Vec4,MeshRenderer,EffectAsset:class{},gfx:{CullMode:{NONE:0}},
        utils:{createMesh(geometry){const mesh={geometry,isValid:true,destroy(){this.isValid=false;}};meshes.push(mesh);return mesh;}}});
    const world=new Node('world');
    const course={waterY:.055,poolWidth:20,directionAtDistance:d=>Math.floor(d/50)%2===0?1:-1,
        swimPosition:(d,z)=>({x:Math.floor(d/50)%2===0?d%50:50-d%50,z})};
    const layers={registerFloatingObject(root){counts.registered++;const nodes=[root,...root.children];
        const original=nodes.map(n=>n.layer);nodes.forEach(n=>n.layer=512);
        return ()=>{counts.released++;nodes.forEach((n,i)=>n.layer=original[i]);};}};
    const p=h.loadModule('entertainment/WhirlpoolRacePresentation');
    const presentation=new p.WhirlpoolRacePresentation(world,course,spawns,{},layers);
    return {h,p,presentation,world,course,meshes,materials,counts};
}

test('固定水流网格有限且有效，贴水边界与水下深度覆盖真实顶点',()=>{
    const f=visualFixture();
    for(const mesh of f.meshes){
        const g=mesh.geometry;assert.ok(g.indices.length/3<=812);
        assert.equal(g.colors.length,g.positions.length/3*4);
        for(const index of g.indices)assert.ok(index>=0 && index<g.positions.length/3);
        for(const value of g.positions)assert.ok(Number.isFinite(value));
    }
    assert.equal(f.meshes.reduce((sum,m)=>sum+m.geometry.indices.length/3,0),2024);
    for(const distance of [-5,10,25,37,65,75,86]){
        f.presentation.update(distance,.1,true);
        for(const root of f.world.children){
            if(!root.active)continue;
            const core=root.children.find(n=>n.name==='DangerCore'),g=core.components[0].mesh.geometry;
            near(.035+core.position.y-.037*core.scale.y,0);
            for(let i=1;i<g.positions.length;i+=3)assert.ok(.035+core.position.y+g.positions[i]*core.scale.y<=.00101);
        }
    }
});

test('普通规格只建三份共享网格，返程镜像正确，相机层注册与注销成对',()=>{
    const f=visualFixture([spawn(),{...spawn(),id:1,distance:80}]);
    assert.equal(f.meshes.length,3);assert.equal(f.counts.registered,2);
    f.presentation.update(25,.1,true);const normal=f.world.children[0].children[0];
    f.presentation.update(75,.1,true);const returned=f.world.children[1].children[0];
    assert.ok(normal.scale.z*returned.scale.z<0);
    assert.ok(f.world.children.every(root=>root.children.every(n=>n.layer===512)));
    f.presentation.dispose();f.presentation.dispose();assert.equal(f.counts.released,2);
    assert.ok(f.meshes.every(m=>!m.isValid));assert.ok(f.materials.every(m=>!m.isValid));
});

test('20 次重赛不重建节点/网格/材质，隐藏和暂停不写变换，表现限频不限制物理',()=>{
    const f=visualFixture(),created=f.materials.length;
    for(let round=0;round<20;round++){
        f.presentation.reset();for(let i=0;i<120;i++)f.presentation.update(25,1/60,true);
        assert.equal(f.materials.length,created);assert.equal(f.meshes.length,6);
        f.presentation.update(25,.1,false);const before=f.counts.transform;
        const writes=f.materials.reduce((s,m)=>s+m.writes,0);
        for(let i=0;i<120;i++)f.presentation.update(25,1/60,false);
        assert.equal(f.counts.transform,before);assert.equal(f.materials.reduce((s,m)=>s+m.writes,0),writes);
        f.presentation.update(250,.1,true);const far=f.counts.transform;
        for(let i=0;i<120;i++)f.presentation.update(250,1/60,true);assert.equal(f.counts.transform,far);
        assert.equal(f.world.children.length,2);assert.ok(f.world.children.every(n=>n.children.length===3));
    }
});

function runtimeFixture(deferred=false,referenceLane=1){
    let built=0,disposed=0,lastReference=null;const pending=[],paths=[];
    class Presentation {constructor(){built++;}reset(){}update(d){lastReference=d;}dispose(){disposed++;}}
    const h=fixture({'../core/RaceBundleLoader':{loadRaceAsset(p,_type,done){paths.push(p);if(deferred)pending.push(done);else done(null,{});}},
        '../entertainment/WhirlpoolRacePresentation':{WhirlpoolRacePresentation:Presentation}});
    h.cc.EffectAsset=class{};
    const {SwimmerMotor}=h.loadModule('swimmer/SwimmerMotor'),{PlayerConditionModel}=h.loadModule('condition/PlayerConditionModel');
    const states=Array.from({length:2},(_,lane)=>{
        const motor=new SwimmerMotor();motor.startRace();
        const swimmer={node:{isValid:true,active:true,position:{z:0}},motor,distance:0,isCollisionActive:true,movementHeading:0};
        return {lane,swimmer,condition:new PlayerConditionModel(),ai:lane===referenceLane?null:{setEntertainmentTargetZ(v){this.route=v;}}};
    });
    const {EntertainmentRaceRuntime}=h.loadModule('app/EntertainmentRaceRuntime'),{GameState}=h.loadModule('core/GameConstants');
    const runtime=new EntertainmentRaceRuntime({isValid:true},{laneCount:2,laneWidth:2.5,poolWidth:5,courseLength:50},
        'whirlpool',42,200,states);
    return {h,runtime,states,GameState,pending,paths,get built(){return built;},get disposed(){return disposed;},get reference(){return lastReference;}};
}

test('本地生命周期只加载本局 Effect，玩家参考距离正确，倒计时/入水/比赛/结束/重赛连贯',()=>{
    const f=runtimeFixture();f.runtime.prepare(e=>assert.ifError(e));const currents=f.states.map(s=>s.swimmer.motor._whirlpool);assert.equal(f.paths.length,1);assert.match(f.paths[0],/WhirlpoolFunnel/);
    for(let round=0;round<20;round++){
        for(const state of [f.GameState.COUNTDOWN,f.GameState.DIVING,f.GameState.RACING]){
            f.runtime.onStateChanged(state);
            for(const s of f.states)assert.equal(s.swimmer.motor._whirlpool.active,state===f.GameState.RACING);
        }
        f.states[0].swimmer.distance=20;f.states[1].swimmer.distance=70;
        f.runtime.update(.1,f.GameState.RACING);assert.equal(f.reference,70);
        f.runtime.onStateChanged(f.GameState.FINISHED);
        for(const s of f.states){assert.equal(s.swimmer.motor._whirlpool.active,false);near(s.swimmer.motor._whirlpool.forwardDelta,0);}
        assert.equal(f.states[0].ai.route,null);assert.equal(f.built,1);
        f.states.forEach((s,i)=>assert.equal(s.swimmer.motor._whirlpool,currents[i]));
    }
    f.runtime.dispose();f.runtime.dispose();assert.equal(f.disposed,1);
    for(const s of f.states)assert.equal(s.swimmer.motor._whirlpool,null);
});

test('漩涡材质失败与迟到回调不能建立或复活资源，回调只完成一次',()=>{
    for(const cancel of [false,true]){
        const f=runtimeFixture(true);let completed=0;
        f.runtime.prepare(e=>{assert.ok(e);completed++;});
        if(cancel)f.runtime.dispose();f.pending.shift()(cancel?null:new Error('材质缺失'),{});
        assert.equal(completed,1);assert.equal(f.built,0);
        for(const s of f.states)assert.equal(s.swimmer.motor._entertainment,null);
        f.runtime.dispose();assert.equal(completed,1);
    }
});

test('统一调参保存/重载漩涡参数，旧配置缺字段沿用默认',()=>{
    const saved=new Map(),h=fixture();
    Object.assign(h.cc,{JsonAsset:class{},native:{},Color:class{},sys:{localStorage:{getItem:k=>saved.get(k)??null,
        setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)}},resources:{load(_p,_t,done){done(null,{json:{version:52,values:{}}});}}});
    const tuning=h.loadModule('core/TuningDebugControls'),balance=h.loadModule('core/EntertainmentBalance');
    const c=tuning.TUNING_GROUPS.flatMap(g=>g.controls).find(c=>c.id==='entertainment.whirlpool.inwardPullAcceleration');
    tuning.loadSavedTuningAsync(()=>{});near(balance.WHIRLPOOL_BRAWL_TUNING.inwardPullAcceleration,3.6);
    c.set(5);assert.equal(tuning.saveCurrentTuning().ok,true);c.set(1);tuning.loadSavedTuningAsync(()=>{});
    near(balance.WHIRLPOOL_BRAWL_TUNING.inwardPullAcceleration,5);
});

test('漩涡入口门禁保留正式赛/联机/教学/Boss 隔离，已有补给/杂物计划完全保留',()=>{
    const h=fixture(),p=h.loadModule('entertainment/EntertainmentDebugPlan');
    for(const mode of ['whirlpool','whirlpool-super']){
        assert.equal(p.normalizeEntertainmentDebugMode(mode),mode);
        assert.equal(p.entertainmentDebugAllowed(true,false,false,false,false,mode),true);
        for(const i of [0,1,2,3,4]){const gates=[true,false,false,false,false];gates[i]=i!==0;assert.equal(p.entertainmentDebugAllowed(...gates,mode),false);}
        const plan=p.buildEntertainmentDebugPlan(mode,200);assert.equal(plan.whirlpool,true);assert.equal(plan.supplies.length,0);assert.equal(plan.debris.length,0);
    }
    assert.deepEqual(Array.from(p.buildEntertainmentDebugPlan('supplies-debris',200).supplies),[35,85,135]);
    assert.deepEqual(Array.from(p.buildEntertainmentDebugPlan('supplies-debris',200).debris),[18,68,118]);
    assert.equal(p.buildEntertainmentDebugPlan('supplies-debris',200).whirlpool,false);
});

test('真实 AI 与主干转身/海豚阶段经过漩涡，200/400 米全部角色仍可完赛',()=>{
    const {createAiHarness}=require('./helpers/ai-race-harness.cjs');
    const h=createAiHarness(),balance=h.load('core/GameBalance');
    const rules=h.load('entertainment/WhirlpoolBrawlRules');
    const characters=h.load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS;
    for(const distance of [200,400])for(const fps of [30,60]){
        balance.setRaceDifficulty(distance===200?'competitive':'championship');
        const spawns=rules.buildWhirlpoolDebugSpawns(42,distance,50,'super');
        for(const character of characters)for(const inCore of [false,true]){
            h.load('core/SharedRNG').reseedSharedRandom(42);
            const startZ=inCore?rules.whirlpoolCenterZ(spawns[0],20):0;
            const f=h.create(character.id,5,.7,inCore?spawns[0].distance:0,startZ);
            f.body.motor.configureEntertainment(true,false);
            f.body.motor.configureEntertainmentWhirlpools(spawns,20,startZ);
            f.body.motor.setEntertainmentWhirlpoolActive(true);
            let clock=1,steps=0,affected=false;
            while(f.body.motor.isRacing && steps<fps*350){
                if(clock>=.1){clock=0;f.ai.setEntertainmentTargetZ(rules.whirlpoolTargetZForAi(f.body.distance,f.body.node.position.z,20,spawns));}
                f.step(1/fps);clock+=1/fps;steps++;
                affected ||= f.body.motor._whirlpool.influence.intensity>0;
                assert.ok(Number.isFinite(f.body.distance)&&Number.isFinite(f.body.node.position.z));
                assert.ok(f.body.distance>=0&&f.body.distance<=distance);
            }
            assert.equal(f.body.motor.isRacing,false,`${character.id}/${distance}/${fps} 未完赛`);
            assert.equal(f.body.distance,distance);
            if(inCore)assert.ok(affected,`${character.id} 应实际受过核心水流影响`);
        }
    }
});

test('50 米泳池的 200/400 米排布最多显示两个漩涡，渲染组件不会同时全开',()=>{
    const h=fixture(),rules=h.loadModule('entertainment/WhirlpoolBrawlRules');
    for(const distance of [200,400])for(const seed of [42,12345,20260913]){
        const spawns=rules.buildWhirlpoolDebugSpawns(seed,distance,50,'super'),f=visualFixture(spawns);
        let maximum=0;
        for(let d=0;d<distance;d+=.5){f.presentation.update(d,.05,true);maximum=Math.max(maximum,f.world.children.filter(n=>n.active).length);}
        assert.ok(maximum<=2);assert.equal(f.world.children.length,distance/50);
        f.presentation.dispose();
    }
});
