const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createGeyserPresentationHarness } = require('./helpers/geyser-presentation-harness.cjs');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');
const near = (a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

function fixture() {
    const h=createGeyserPresentationHarness(2);
    h.loadModule=name=>h.load(path.resolve(__dirname,'../assets/scripts',name+'.ts'));
    return h;
}
function racer(h,id='cartonSwimmer6',distance=20,z=0) {
    const f=h.create(id,5,.7,distance,z);
    f.body.cartoonRig.geyserBodyScale=1;
    f.body.cartoonRig.geyserBodyPivot={x:0,y:0,z:0};
    f.body.configureEntertainmentGeyser(true);
    return f;
}

test('普通喷泉预警/喷发/收尾时钟稳定，命中账本允许擦边升级且不重复',()=>{
    const h=fixture(),r=h.rules,v={id:0,x:0,z:0,offsetSeconds:0};
    assert.equal(r.geyserPhaseAt(v,1.49,2),'warning');
    assert.equal(r.geyserPhaseAt(v,1.5,2),'burst');
    assert.equal(r.geyserPhaseAt(v,2.45,2),'falling');
    near(r.geyserBurstOverlap(v,0,1,3),.95);
    const ledger=new r.GeyserHitLedger(),id=r.geyserHitId(1,0,0,0);
    assert.equal(ledger.accepts(id,1),true);ledger.record(id,1);
    assert.equal(ledger.accepts(id,1),false);assert.equal(ledger.accepts(id,2),true);ledger.record(id,2);
    assert.equal(ledger.accepts(id,2),false);ledger.record(r.geyserHitId(2,0,0,0),1);
    assert.equal(ledger.accepts(id,2),false);ledger.reset();assert.equal(ledger.accepts(id,2),true);
});

test('身体接触在 15/30/60/120Hz 下不漏判，瞬移不扫历史，水下与高空分别处理',()=>{
    const h=fixture(),b=h.loadModule('swimmer/GeyserBodyContact'),v={id:0,x:0,z:0,offsetSeconds:0};
    const times=[];
    for(const fps of [15,30,60,120]){
        let p={...b.emptyGeyserBodyPose(),x:-2.6};
        for(let i=1;i<fps*2;i++){
            const from=1.8+(i-1)/fps,to=1.8+i/fps,c={...p,x:-2.6+6*i/fps};
            const hit=b.sampleGeyserBodyContact(v,0,p,c,from,to,from,Math.min(to,2.449999),0,.055,b.emptyGeyserContact());
            if(hit.strength===2){times.push(hit.time);assert.ok(hit.along>0);break;}p=c;
        }
    }
    assert.equal(times.length,4);assert.ok(Math.max(...times)-Math.min(...times)<=1/240+1e-6);
    const at=(p,c=p)=>b.sampleGeyserBodyContact(v,0,p,c,2,2.01,2,2.01,0,.055,b.emptyGeyserContact());
    const p=b.emptyGeyserBodyPose();assert.equal(at({...p,x:-6},{...p,x:6}).strength,0);
    assert.equal(at({...p,y:3}).strength,0);assert.equal(at({...p,y:-.3}).strength,2);
    assert.equal(at({...p,x:-1.7}).strength,1);
});

test('纯腾空轨迹跨帧率一致，偏心命中身体倾斜且返程正确镜像',()=>{
    const h=fixture(),m=h.loadModule('swimmer/ForcedLaunchModel'),b=h.loadModule('swimmer/GeyserBodyContact'),r=h.loadModule('swimmer/GeyserReactionModel');
    const start={distance:20,lateral:0,y:-.2,surfaceY:0,speed:4,heading:.25,duration:1.2,peakHeight:1.2,entryScale:.75,exitScale:.6};
    const results=[];
    for(const fps of [15,30,60,120]){let s={};for(let i=1;i<=fps*1.2;i++)m.sampleForcedLaunch(start,i/fps,s);results.push(s);}
    for(const s of results){near(s.distance,results[0].distance);near(s.y,0);assert.equal(s.done,true);}
    for(const yaw of [0,Math.PI,.6])for(const side of [-1,1]){
        const pose={...b.emptyGeyserBodyPose(),yaw},vent={id:0,x:-Math.sin(yaw)*.5*side,z:Math.cos(yaw)*.5*side,offsetSeconds:0};
        const hit=b.sampleGeyserBodyContact(vent,0,pose,pose,2,2.01,2,2.01,0,.055,b.emptyGeyserContact());
        assert.equal(hit.strength,2);const start=r.createGeyserReaction(1001,2,1,0,0,0,0,hit);
        assert.equal(Math.sign(start.rollVelocity),-side);assert.ok(r.sampleGeyserReaction(start,.2,{}).weight>0);
    }
});

function launch(f,h,id=1001,late=0) {
    const start={distance:f.body.distance,lateral:f.body.motor.lateralOffset,y:f.body.node.position.y,surfaceY:f.body.courseLayout.swimY,
        speed:4,heading:f.body.motor.heading,duration:1,peakHeight:1.2,entryScale:.75,exitScale:.6};
    return f.body.applyGeyserHit(id,2,late,start,{strength:2,along:.3,side:.1,up:0,coverage:1,time:0,region:0});
}

test('真实实体腾空锁住划水/踢腿/海豚输入，取消旧队列且保持比赛与已结算状态',()=>{
    const h=createAiHarness(),f=racer(h),{StrokeType}=h.load('core/GameConstants');
    f.body.handleStrokeHeld(StrokeType.LEFT,true);f.body.handleStroke(StrokeType.LEFT);f.body.stepSimulation(.01);assert.equal(f.body.motor.isActiveStrokeHeld(StrokeType.LEFT),true);
    assert.equal(launch(f,h),true);assert.equal(f.body.isForcedLaunchActive,true);assert.equal(f.body.isCollisionActive,false);
    assert.equal(f.body.motor.isActiveStrokeHeld(StrokeType.LEFT),false);
    assert.equal(f.body.handleStroke(StrokeType.LEFT),null);assert.equal(f.body.canAcceptStroke(StrokeType.LEFT),false);
    f.body.handleStrokeHeld(StrokeType.LEFT,true);f.body.handleKickStroke(StrokeType.RIGHT);f.body.confirmKickStroke();
    assert.equal(f.body.tryDolphinJump(),false);assert.equal(f.body.applyAcceptedNetDolphinJump(),false);assert.equal(f.body.canUseArmStroke,false);
    assert.equal(f.body.motor.isActiveStrokeHeld(StrokeType.LEFT),false);assert.equal(f.body.motor.isRacing,true);
    const before=f.body.distance;for(let i=0;i<60;i++)f.body.stepSimulation(1/60);
    assert.ok(f.body.distance>before);assert.equal(f.body.isForcedLaunchActive,false);
    near(f.body.node.position.y,f.body.courseLayout.swimY);assert.equal(f.body.motor.leftArmCycle,0);
    assert.equal(launch(f,h),false);for(let i=0;i<50;i++)f.body.stepSimulation(1/60);
    assert.equal(launch(f,h),false,'同一命中不能再次发射');assert.equal(launch(f,h,1009),true);
    f.body.resetEntertainmentGeyser();assert.equal(f.body.isForcedLaunchActive,false);assert.equal(f.body._geyser.pose.weight,0);
});

test('擦边可升级核心，过期命中不复活，近墙拒绝新命中并能正常转身及完赛',()=>{
    const h=createAiHarness(),f=racer(h),c={strength:1,along:.2,side:.1,up:0,coverage:0,time:0,region:0};
    const speed=f.body.motor.currentSpeed;
    assert.equal(f.body.applyGeyserHit(1001,1,0,null,c),true);near(f.body.motor.currentSpeed,speed*.9);
    assert.equal(f.body.applyGeyserHit(1001,1,0,null,c),false);assert.equal(launch(f,h),true);
    f.body.resetEntertainmentGeyser();assert.equal(launch(f,h,1001,2),false);assert.equal(launch(f,h,1001),false);
    f.body.startRace(48,4);assert.equal(launch(f,h),false);
    f.body.startRace(46,4);assert.equal(launch(f,h),true);
    for(let i=0;i<120;i++)f.body.stepSimulation(1/60);
    assert.ok(f.body.distance>=49);assert.equal(f.body.isForcedLaunchActive,false);
    f.body.startRace(199,4);assert.equal(launch(f,h),false);
    for(let i=0;i<60;i++)f.body.stepSimulation(1/60);
    assert.equal(f.body.motor.isRacing,false);assert.equal(f.body._geyser.pose.weight,0);
});

test('固定喷泉网格贴实际水面，30Hz 更新、隐藏零变换写入，释放相机层与资源',()=>{
    const h=fixture(),vents=[{id:0,x:10,z:0,offsetSeconds:0},{id:1,x:10,z:5,offsetSeconds:.08}];
    assert.deepEqual(h.budget().meshes,3);assert.equal(h.budget().materials,1);assert.equal(h.budget().renderers,8);
    const jet=h.nodes.find(n=>n.name==='WaterJetAndCrown');
    h.visual.update(vents,2,2);assert.equal(jet.active,true);near(jet.parent.position.y+jet.position.y,.055);
    const writes=h.nodes.reduce((sum,n)=>sum+n.writes,0);h.visual.update(vents,2.001,2);
    assert.equal(h.nodes.reduce((sum,n)=>sum+n.writes,0),writes);
    h.visual.hide();const hidden=h.nodes.reduce((sum,n)=>sum+n.writes,0);
    for(let i=0;i<30;i++)h.visual.update([],3+i/30,0);
    assert.equal(h.nodes.reduce((sum,n)=>sum+n.writes,0),hidden);
    h.visual.dispose();h.visual.dispose();assert.ok(h.meshes.every(m=>m.destroyCount===1));assert.equal(h.materials[0].destroyCount,1);
});

test('喷发前气泡实际冒出水面，泡沫有可见高度，两次预警都没有提前喷水',()=>{
    for(const waterY of [.055,.35]){
        const h=createGeyserPresentationHarness(1,waterY),vent={id:0,x:10,z:0,offsetSeconds:0};
        const budget=h.budget(),cycle=h.rules.geyserCycleSeconds();
        for(const pulse of [0,1]){
            let visibleBubbleFrames=0;
            for(let frame=0;frame<45;frame++){
                h.visual.update([vent],pulse*cycle+frame/30,2);
                const snapshot=h.snapshot();
                assert.equal(snapshot.some(s=>s.name==='WaterJetAndCrown'),false);
                const foam=snapshot.find(s=>s.name==='SurfaceFoam');
                assert.ok(foam);
                const bounds=s=>{
                    const positions=h.meshes[s.mesh].geometry.positions,m=s.matrix;
                    let min=Infinity,max=-Infinity;
                    for(let i=0;i<positions.length;i+=3){
                        const y=m[1]*positions[i]+m[5]*positions[i+1]+m[9]*positions[i+2]+m[13];
                        min=Math.min(min,y);max=Math.max(max,y);
                    }
                    return {min,max};
                };
                const foamBounds=bounds(foam);
                assert.ok(foamBounds.min>waterY,'泡沫必须在真实水面之上');
                assert.ok(foamBounds.max-waterY>.1,'预警开始时泡沫鼓包至少高出水面十厘米');
                if(snapshot.some(s=>s.name.startsWith('BubblesAndDrops')&&bounds(s).max>waterY+.05))visibleBubbleFrames++;
            }
            assert.ok(visibleBubbleFrames>=30,'气泡至少有一秒明显露出水面');
        }
        assert.deepEqual(h.budget(),budget,'预警不能新增节点、网格或材质');
        h.visual.dispose();
    }
});

test('两个表现槽位复用所有泳段，排布冻结且不消费公共随机数，首名完赛停止新脉冲',()=>{
    const v=fixture(),a=createAiHarness(),f=racer(a),course=f.body.courseLayout;
    const {GeyserRaceController:C}=v.loadModule('entertainment/GeyserRaceController'),rng=v.loadModule('core/SharedRNG');
    rng.reseedSharedRandom(77);const expected=rng.randomFloat();rng.reseedSharedRandom(77);
    let registered=0,released=0;
    const c=new C(v.root,course,[f.body],42,400,{registerFloatingObject(root){registered++;return()=>released++;}});
    assert.equal(rng.randomFloat(),expected);assert.equal(c.patches.length,8);assert.equal(registered,2);
    const signature=JSON.stringify(c.patches),nodes=v.nodes.length,meshes=v.meshes.length,materials=v.materials.length;
    for(let round=0;round<20;round++){
        c.reset();f.body.resetEntertainmentGeyser();c.update(.1,10);assert.equal(c.vents.length,2);
        for(let i=0;i<100;i++)c.update(.1,10);c.update(.1,60);
        assert.equal(c.serial,2);assert.equal(JSON.stringify(c.patches),signature);
        assert.equal(v.nodes.length,nodes);assert.equal(v.meshes.length,meshes);assert.equal(v.materials.length,materials);
    }
    c.reset();c.update(.1,10);c.update(.1,10);c.stopNewPulses();for(let i=0;i<150;i++)c.update(.1,160);
    assert.equal(c.isDone,true);assert.equal(c.serial,1);c.dispose();c.dispose();assert.equal(released,2);
});

test('真实身体扫掠驱动核心弹起与AI绕行；事件空闲不采身体或写变换',()=>{
    const v=fixture(),a=createAiHarness(),f=racer(a),course=f.body.courseLayout,{GeyserRaceController:C}=v.loadModule('entertainment/GeyserRaceController');
    const c=new C(v.root,course,[f.body],42,200);let samples=0;
    const original=f.body.sampleGeyserBody.bind(f.body);f.body.sampleGeyserBody=p=>{samples++;original(p);};
    c.update(.1,0);assert.equal(samples,0);c.update(.1,10);const vent=c.vents[0];
    const d=(vent.x-course.startX)/(course.finishX-course.startX)*course.courseLength;
    f.body.startRace(d,0);f.body.motor.setLateralOffset(vent.z-f.body.startPosition.z);f.body.stepSimulation(.001);
    assert.notEqual(c.targetZForAi(f.body),null);
    for(let i=0;i<25 && !f.body.isForcedLaunchActive;i++)c.update(.1,10);
    assert.equal(f.body.isForcedLaunchActive,true);assert.equal(c.targetZForAi(f.body),null);
});

test('本地运行模块不加载新资源，20次重赛复用反应对象与网格，结束和销毁清理一次',()=>{
    const v=fixture(),a=createAiHarness(),f=racer(a),course=f.body.courseLayout;
    v.cc.Prefab=class{};v.cc.EffectAsset=class{};
    // 喷泉使用内置材质，若意外落入补给加载则真实资源桩会使测试失败。
    const {EntertainmentRaceRuntime:R}=v.loadModule('app/EntertainmentRaceRuntime'),{GameState:S}=v.loadModule('core/GameConstants');
    const runtime=new R(v.root,course,'geyser',42,200,[{lane:0,swimmer:f.body,condition:f.condition,ai:null}]);
    let prepared=0;runtime.prepare(e=>{assert.ifError(e);prepared++;});assert.equal(prepared,1);
    const reaction=f.body._geyser,nodes=v.nodes.length,meshes=v.meshes.length;
    for(let round=0;round<20;round++){
        runtime.onStateChanged(S.COUNTDOWN);f.body.startRace(20,4);runtime.onStateChanged(S.RACING);runtime.update(.1,S.RACING);
        assert.equal(launch(f,a),true);runtime.onStateChanged(S.FINISHED);assert.equal(f.body.isForcedLaunchActive,false);
        assert.equal(f.body._geyser,reaction);assert.equal(v.nodes.length,nodes);assert.equal(v.meshes.length,meshes);
    }
    runtime.dispose();runtime.dispose();assert.equal(f.body._geyser,null);assert.equal(f.body.motor._entertainment,null);
});

test('喷泉门禁仍排除正式/房间/联机/教学/Boss，旧娱乐选项保持原计划',()=>{
    const h=fixture(),p=h.loadModule('entertainment/EntertainmentDebugPlan');
    assert.equal(p.normalizeEntertainmentDebugMode('geyser'),'geyser');assert.equal(p.entertainmentDebugAllowed(true,false,false,false,false,'geyser'),true);
    for(const i of [0,1,2,3,4]){const gates=[true,false,false,false,false];gates[i]=i!==0;assert.equal(p.entertainmentDebugAllowed(...gates,'geyser'),false);}
    assert.equal(p.buildEntertainmentDebugPlan('geyser',200).geyser,true);
    for(const mode of ['none','supplies','debris','supplies-debris','whirlpool','whirlpool-super'])assert.equal(p.buildEntertainmentDebugPlan(mode,200).geyser,false);
});

test('全部主干角色在普通喷泉 200/400米、30/60Hz 可完赛，包括主动命中后继续划水',()=>{
    const v=fixture(),a=createAiHarness(),balance=a.load('core/GameBalance'),{GeyserRaceController:C}=v.loadModule('entertainment/GeyserRaceController');
    const characters=a.load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS;
    for(const distance of [200,400])for(const fps of [30,60])for(const character of characters){
        balance.setRaceDifficulty(distance===200?'competitive':'championship');a.load('core/SharedRNG').reseedSharedRandom(42);
        const f=racer(a,character.id,20),c=new C(v.root,f.body.courseLayout,[f.body],42,distance);
        assert.equal(launch(f,a),true);let steps=0,clock=1;
        while(f.body.motor.isRacing && steps<fps*350){
            f.step(1/fps);c.update(1/fps,f.body.distance);clock+=1/fps;
            if(clock>=.1){clock=0;f.ai.setEntertainmentTargetZ(c.targetZForAi(f.body));}
            assert.ok(Number.isFinite(f.body.distance)&&Number.isFinite(f.body.node.position.y));steps++;
        }
        assert.equal(f.body.motor.isRacing,false,`${character.id}/${distance}/${fps} 未完赛`);assert.equal(f.body.distance,distance);
        assert.equal(f.body.isForcedLaunchActive,false);c.dispose();
    }
});


test('喷泉表现初始化失败回收部分网格、材质和相机层，不残留有效子节点',()=>{
    for(const failure of ['mesh','material','part','layer']){
        const h=fixture(),P=h.loadModule('entertainment/GeyserBrawlPresentation').GeyserBrawlPresentation;
        const meshStart=h.meshes.length,materialStart=h.materials.length,nodeStart=h.nodes.length;
        let calls=0,released=0;
        if(failure==='mesh'){
            const create=h.cc.utils.createMesh;
            h.cc.utils.createMesh=g=>{if(++calls===2)throw new Error('网格失败');return create(g);};
        }else if(failure==='material'){
            h.cc.Material.prototype.initialize=function(){throw new Error('材质失败');};
        }else if(failure==='part'){
            const add=h.Node.prototype.addComponent;
            h.Node.prototype.addComponent=function(C){if(++calls===3)throw new Error('组件失败');return add.call(this,C);};
        }
        const layers={registerFloatingObject(){if(++calls===2)throw new Error('相机层失败');return()=>released++;}};
        assert.throws(()=>new P(h.root,0,2,.055,failure==='layer'?layers:null),/失败/);
        assert.ok(h.meshes.slice(meshStart).every(m=>m.destroyCount===1));
        assert.ok(h.materials.slice(materialStart).every(m=>m.destroyCount===1));
        assert.ok(h.nodes.slice(nodeStart).every(n=>!n.isValid));
        if(failure==='layer')assert.equal(released,1);
    }
});

test('腾空期间重置、展示和提前完赛清理反应，场景节点已销毁时不写位置',()=>{
    for(const method of ['reset','prepareShowcaseStanding','presentStanding','playFinishTouch']){
        const h=createAiHarness(),f=racer(h);
        assert.equal(launch(f,h),true);f.body.stepSimulation(.1);
        if(method==='presentStanding')f.body[method](new h.cc.Vec3(0,1,0),0);else f.body[method]();
        assert.equal(f.body.isForcedLaunchActive,false);assert.equal(f.body._geyser.pose.weight,0);
    }
    const h=createAiHarness(),f=racer(h);
    assert.equal(launch(f,h),true);f.body.node.isValid=false;
    f.body.node.setPosition=()=>{throw new Error('不得写已销毁节点');};
    assert.equal(f.body.geyserHitEligible,false);
    assert.doesNotThrow(()=>f.body.configureEntertainmentGeyser(false));
    assert.equal(f.body._geyser,null);
});


test('三个喷泉手感参数沿用统一保存重载，旧配置缺键时保留默认值',()=>{
    const saved=new Map(),h=fixture();
    Object.assign(h.cc,{JsonAsset:class{},native:{},Color:class{},sys:{localStorage:{getItem:k=>saved.get(k)??null,
        setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)}},resources:{load(_p,_t,done){done(null,{json:{version:52,values:{}}});}}});
    const tuning=h.loadModule('core/TuningDebugControls'),balance=h.loadModule('core/EntertainmentBalance');
    const values=[['peakHeight',1.2,1.8],['flightSeconds',1,1.4],['edgeSlowdownScale',.9,.7]];
    const controls=tuning.TUNING_GROUPS.flatMap(g=>g.controls);
    tuning.loadSavedTuningAsync(()=>{});
    for(const [key,initial,value] of values){
        near(balance.GEYSER_TUNING[key],initial);
        controls.find(c=>c.id==='entertainment.geyser.'+key).set(value);
    }
    assert.equal(tuning.saveCurrentTuning().ok,true);
    for(const [key,initial] of values)controls.find(c=>c.id==='entertainment.geyser.'+key).set(initial);
    tuning.loadSavedTuningAsync(()=>{});
    for(const [key,,value] of values)near(balance.GEYSER_TUNING[key],value);
});
