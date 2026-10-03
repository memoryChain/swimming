const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const { createFixedMeshHarness } = require('./helpers/fixed-mesh-harness.cjs');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');
const near = (a,b,e=1e-7) => assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function fixture() {
    const h=createFixedMeshHarness();
    return {...h,rules:h.loadModule('entertainment/GiantWaveRules')};
}
function racer(h,id='cartonSwimmer6',distance=20) {
    const f=h.create(id,5,.7,distance);
    f.body.motor.configureEntertainment(true,false);
    f.body.cartoonRig.giantWaveLift=0;
    f.body.cartoonRig.setGiantWaveLift=function(v){this.giantWaveLift=v;};
    return f;
}
function wave(r,course,distance=20,direction=1) {
    const s=r.newGiantWaveState();
    Object.assign(s,{phase:'active',age:4,x:course.distanceToWorldX(distance),direction,width:course.poolWidth,length:12});
    s.startX=s.x-direction*r.waveTravel(s,s.age);
    return s;
}
function extracted(file,name,names,globals,helperNames=[]) {
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text===name);
    const members=cls.members.filter(n=>names.includes(n.name?.getText(source)));
    assert.equal(members.length,names.length);
    const helpers=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&helperNames.includes(n.name?.text));
    const module={exports:{}};
    vm.runInNewContext(ts.transpileModule(`${helpers.map(n=>n.getText(source)).join('\n')} export class Subject {${members.map(n=>n.getText(source)).join('\n')}}`,
        {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,
        {module,exports:module.exports,...globals});
    return module.exports.Subject;
}

test('普通巨浪的方向位置只由本局种子决定，不读人群朝向，也不消费公共随机数',()=>{
    const h=fixture(),r=h.rules,rng=h.loadModule('core/SharedRNG');
    rng.reseedSharedRandom(77);const expected=rng.randomFloat();rng.reseedSharedRandom(77);
    const make=seed=>new r.GiantWaveSimulation(50,0,50,24,seed,'three',44.4,3,200);
    const a=make(42),b=make(42),c=make(1234);
    a.update(.1,[{distance:2,x:2,z:10,direction:-1,speed:9}],false);
    b.update(.1,[{distance:2,x:40,z:-10,direction:1,speed:1}],false);
    c.update(.1,[{distance:2}],false);
    assert.deepEqual(a.state,b.state);assert.notDeepEqual(a.state,c.state);
    assert.equal(rng.randomFloat(),expected);
    const oldWidth=a.spec.widthFraction;r.GIANT_WAVE_TUNING.widthFraction=.8;
    assert.equal(a.spec.widthFraction,oldWidth);r.GIANT_WAVE_TUNING.widthFraction=oldWidth;
    a.reset();a.update(.1,[{distance:2}],false);assert.deepEqual(a.state,b.state);
});

test('200/400米最多三/七波，每段只起一波；预告三秒、抵岸截停，完赛取消下一波',()=>{
    const {rules:r}=fixture();
    for(const distance of [200,400]){
        const sim=new r.GiantWaveSimulation(50,0,50,24,42,'three',44.4,3,distance);
        assert.equal(sim.maxWaves,distance===200?3:7);
        for(let i=0;i<sim.maxWaves;i++){
            sim.update(.01,[{distance:i*50+2}],false);assert.equal(sim.state.phase,'preview');near(sim.state.timer,3);
            sim.update(2.99,[],false);assert.equal(sim.state.phase,'preview');
            sim.update(.02,[],false);assert.equal(sim.state.phase,'active');
            sim.update(r.waveArrivalTime(sim.state),[],false);near(sim.state.x,sim.state.endX);
            sim.update(sim.state.impactTime+sim.state.fadeTime,[],false);assert.equal(sim.state.phase,'gap');
            sim.update(sim.state.timer,[],false);assert.equal(sim.state.phase,'waiting');
        }
        sim.update(.01,[],false);assert.equal(sim.state.phase,'complete');assert.equal(sim.previews,sim.maxWaves);
        sim.reset();sim.update(.1,[{distance:55}],false);assert.equal(sim.cancelled,1);
        sim.update(.1,[{distance:55}],false);assert.equal(sim.state.phase,'preview');
        sim.update(.1,[],true);assert.equal(sim.state.phase,'complete');
        sim.reset();sim.update(.1,[{distance:2}],false);sim.update(3,[],false);
        sim.update(.1,[],true);assert.equal(sim.state.phase,'active');
        sim.update(100,[],false);assert.equal(sim.state.phase,'complete');
    }
});

test('浪心顺向加速、反向减速、侧边无作用；快速穿越不漏，瞬移不补领历史',()=>{
    const h=fixture(),r=h.rules,course=h.loadModule('venue/RaceCourseLayout').DEFAULT_RACE_COURSE_LAYOUT;
    const s=wave(r,course);
    near(r.waveWeight(s,s.x,0,1),1);near(r.waveWeight(s,s.x,0,-1),-1);
    near(r.waveWeight(s,s.x,s.width/2,1),0);
    s.length=1;s.speed=1;
    assert.ok(r.sweptWaveWeight(s,s.x+1,0,s.x-1,0,-1,.1)<-.1);
    near(r.sweptWaveWeight(s,s.x+6,0,s.x-6,0,-1,.1),0);
    s.age=r.waveArrivalTime(s);near(r.waveWeight(s,s.x,0,1),0);
});

test('加速和减速的建立/退出跨帧率一致，退出后不残留，换方向不继承旧助力',()=>{
    const h=fixture(),r=h.rules,course=h.loadModule('venue/RaceCourseLayout').DEFAULT_RACE_COURSE_LAYOUT;
    const results=[];
    for(const fps of [15,30,60,120]){
        let speed=0,distance=0;const out={};
        for(const target of [1.1,-1.1,0])for(let i=0;i<fps;i++){
            r.advanceWaveBoost(speed,target,1.1,1/fps,out);speed=out.speed;
            distance+=(out.positiveAverage-out.negativeAverage)/fps;
        }
        results.push(distance);near(speed,0);
        const s=wave(r,course),{GiantWaveSwimmerCurrent:C}=h.loadModule('swimmer/GiantWaveSwimmerCurrent');
        const current=new C(s,r.giantWaveSpec(),course,0);current.setEligible(true);
        for(let i=0;i<fps;i++)current.advance(20,0,1/fps);
        assert.ok(current.lift>0&&current.riding);
        current.advance(80,0,1/fps);assert.equal(current.opposed,true);assert.equal(current.riding,false);
        assert.equal(current.output.positiveAverage,0);
        current.setEligible(false);near(current.lift,0);near(current.output.speed,0);assert.equal(current.eligible,false);
    }
    for(const d of results)near(d,results[0]);
});

test('真实Motor只改变本步前进，不改基础速度、碰撞反冲或正常比赛数值',()=>{
    const h=fixture(),r=h.rules,{SwimmerMotor:M}=h.loadModule('swimmer/SwimmerMotor');
    const course=h.loadModule('venue/RaceCourseLayout').DEFAULT_RACE_COURSE_LAYOUT;
    h.loadModule('core/GameBalance').setRaceDifficulty('competitive');
    const make=()=>{const m=new M();m.configureEntertainment(true,false);m.startRace(20,4);m._knockbackDistance=1.75;m._knockbackLateral=.5;return m;};
    const baseline=make();baseline.update(.1,{isAI:false});
    for(const direction of [1,-1]){
        const m=make(),s=wave(r,course,20,direction);
        m.configureEntertainmentGiantWave(s,r.giantWaveSpec(),course,0);m.setEntertainmentGiantWaveEligible(true);m.update(.1,{isAI:false});
        near(m.currentSpeed,baseline.currentSpeed);near(m._knockbackDistance,baseline._knockbackDistance);near(m._knockbackLateral,baseline._knockbackLateral);
        assert.ok(direction===1?m.distance>baseline.distance:m.distance<baseline.distance);
        m.resetEntertainmentGiantWave();near(m.giantWaveLift,0);assert.equal(m.isGiantWaveRiding,false);
        m.configureEntertainment(false);assert.equal(m.hasEntertainmentGiantWave,false);
    }
    const outside=make();outside.configureEntertainmentGiantWave(wave(r,course),r.giantWaveSpec(),course,0);
    outside.setEntertainmentGiantWaveEligible(false);outside.update(.1,{isAI:false});near(outside.distance,baseline.distance);
    const untouched=new M();untouched.startRace(20,4);untouched._knockbackDistance=1.75;untouched._knockbackLateral=.5;
    untouched.update(.1,{isAI:false});near(untouched.distance,baseline.distance);near(untouched.currentSpeed,baseline.currentSpeed);
});

test('真实实体在转身、海豚跳、深潜、喷泉弹起和完赛时清助力与抬升',()=>{
    for(const mode of ['turn','dolphin','depth','launch','finish']){
        const a=createAiHarness(),f=racer(a),r=a.load('entertainment/GiantWaveRules');
        const s=wave(r,f.body.courseLayout);f.body.configureEntertainmentGiantWave(s,r.giantWaveSpec());
        for(let i=0;i<30;i++){s.x=f.body.courseLayout.distanceToWorldX(f.body.distance);f.body.stepSimulation(1/60);}
        assert.ok(f.body.motor.giantWaveLift>0);assert.ok(f.body.cartoonRig.giantWaveLift>0);
        if(mode==='turn'){f.body.motor._distance=49.95;for(let i=0;i<4;i++)f.body.stepSimulation(.05);assert.equal(f.body._phases.isFlipTurnActive,true);}
        if(mode==='dolphin'){f.body._ultimate.applyNetEnergy(100,1);assert.equal(f.body.tryDolphinJump(),true);f.body.stepSimulation(.01);}
        if(mode==='depth'){f.body.motor.ability.configure('kickDive');f.body.motor.ability.applySnapshot({depth:.5,kickRemaining:1,stacks:0,idleRemaining:0},true);f.body.stepSimulation(.01);}
        if(mode==='launch'){
            f.body.configureEntertainmentGeyser(true);
            const start={distance:f.body.distance,lateral:0,y:0,surfaceY:0,speed:4,heading:0,duration:1,peakHeight:1.2,entryScale:.75,exitScale:.6};
            assert.equal(f.body.applyGeyserHit(1001,2,0,start,{strength:2,along:0,side:0,up:0,coverage:1,time:0,region:0}),true);f.body.stepSimulation(.01);
        }
        if(mode==='finish'){f.body.motor._distance=199.99;f.body.stepSimulation(.1);assert.equal(f.body.motor.isRacing,false);}
        near(f.body.motor.giantWaveLift,0);near(f.body.cartoonRig.giantWaveLift,0);assert.equal(f.body.canRideGiantWave,false);
    }
    for(const method of ['reset','stopRace','prepareDive','prepareShowcaseStanding','presentStanding','playFinishTouch']){
        const a=createAiHarness(),f=racer(a),r=a.load('entertainment/GiantWaveRules');f.body.configureEntertainmentGiantWave(wave(r,f.body.courseLayout),r.giantWaveSpec());
        f.body.stepSimulation(.1);assert.ok(f.body.motor.giantWaveLift>0);
        if(method==='presentStanding')f.body[method](new a.Vec3(0,1,0),0);else f.body[method]();
        near(f.body.motor.giantWaveLift,0);near(f.body.cartoonRig.giantWaveLift,0);
    }
});

function bounds(h,snapshot){
    const positions=h.meshes[snapshot.mesh].geometry.positions,m=snapshot.matrix;
    let min=Infinity,max=-Infinity;
    for(let i=0;i<positions.length;i+=3){const y=m[1]*positions[i]+m[5]*positions[i+1]+m[9]*positions[i+2]+m[13];min=Math.min(min,y);max=Math.max(max,y);}
    return {min,max};
}
test('预告白沫在真实水面上起伏，正反向浪头在到岸后停住，固定网格预算有界',()=>{
    for(const waterY of [.055,.35])for(const direction of [-1,1]){
        const h=fixture(),r=h.rules,P=h.loadModule('entertainment/GiantWavePresentation').GiantWavePresentation;
        const p=new P(h.root,waterY),s=r.newGiantWaveState();
        Object.assign(s,{phase:'preview',timer:3,direction,startX:direction>0?3:47,x:direction>0?3:47,endX:direction>0?47:3,width:13.2,length:6});
        const budget=h.budget();assert.deepEqual(budget.triangles,[616,336,248]);assert.equal(budget.nodes,3);assert.equal(budget.materials,3);
        let min=Infinity,max=-Infinity;
        for(let frame=0;frame<90;frame++){
            s.timer=3-frame/30;p.update(s);const visible=h.snapshot();assert.equal(visible.length,1);assert.equal(visible[0].name,'GiantWaveShore');
            const b=bounds(h,visible[0]);assert.ok(b.min>waterY);assert.ok(b.max-waterY>.1);min=Math.min(min,b.max);max=Math.max(max,b.max);
        }
        assert.ok(max-min>.05);s.phase='active';s.age=4;p.update(s);assert.equal(h.snapshot().some(n=>n.name==='GiantWave'),true);
        s.age=r.waveArrivalTime(s)+.3;s.x=s.endX;p.update(s);
        const shore=h.nodes.find(n=>n.name==='GiantWaveShore');near(shore.position.x,s.endX+direction*(s.length/2-.025));
        assert.equal(shore.active,true);assert.deepEqual(h.budget(),budget);p.dispose();p.dispose();
        assert.ok(h.meshes.every(m=>m.destroyCount===1));assert.ok(h.materials.every(m=>m.destroyCount===1));
    }
});

test('表现30Hz限频，隐藏时零变换和材质写入；水上水下层注册在重赛中不重复',()=>{
    const h=fixture(),P=h.loadModule('entertainment/GiantWavePresentation').GiantWavePresentation;
    const Layers=extracted('assets/scripts/venue/WaterRefractionController.ts','WaterRefractionController',
        ['registerFloatingObject','applyFloatingObjectLayers','setUnderwaterViewActive'],
        {Layers:{Enum:{DEFAULT:1}},SWIMMER_LAYER:1024,REBIND_WARMUP_FRAMES:2,setSpectatorCameraUnderwater(){}},
        ['captureNodeLayers','restoreNodeLayers']);
    const layers=new Layers();Object.assign(layers,{_floatingObjects:[],_underwaterViewActive:false,_swimmerCamera:{isValid:true},
        _poolsideWaterline:{setUnderwaterViewActive(){}},applyFloorTint(){},tagLaneFloats(){}});
    const p=new P(h.root,.055,layers),s=h.rules.newGiantWaveState();
    Object.assign(s,{phase:'active',age:4,width:13,length:6});p.update(s);
    const writes=()=>h.nodes.reduce((n,x)=>n+x.writes,0)+h.materials.reduce((n,x)=>n+x.writes,0);
    const before=writes();s.age+=.001;s.x+=.004;p.update(s);assert.equal(writes(),before);
    for(let i=0;i<20;i++){p.hide();s.phase='waiting';p.update(s);}const hidden=writes();
    for(let i=0;i<60;i++)p.update(s);assert.equal(writes(),hidden);assert.equal(layers._floatingObjects.length,3);
    for(let i=0;i<20;i++){
        layers.setUnderwaterViewActive(true);assert.ok(h.nodes.slice(1).every(n=>n.layer===1));
        layers.setUnderwaterViewActive(false);assert.ok(h.nodes.slice(1).every(n=>n.layer===1024));
        assert.equal(layers._floatingObjects.length,3);
    }
    p.dispose();p.dispose();assert.equal(layers._floatingObjects.length,0);assert.ok(h.nodes.slice(1).every(n=>n.layer===1));
});

test('初始化任一步失败都回收已创建的网格/材质/节点/相机层，选手绑定失败同样清理',()=>{
    for(const failure of ['mesh','material','part','layer','binding']){
        const h=fixture(),P=h.loadModule('entertainment/GiantWavePresentation').GiantWavePresentation;
        let calls=0,released=0;
        if(failure==='mesh'){const create=h.cc.utils.createMesh;h.cc.utils.createMesh=g=>{if(++calls===2)throw new Error('失败');return create(g);};}
        if(failure==='material')h.cc.Material.prototype.initialize=function(){throw new Error('失败');};
        if(failure==='part'){const add=h.Node.prototype.addComponent;h.Node.prototype.addComponent=function(C){if(++calls===2)throw new Error('失败');return add.call(this,C);};}
        const layers={registerFloatingObject(){if(failure==='layer'&&++calls===2)throw new Error('失败');return()=>released++;}};
        if(failure==='binding'){
            const a=createAiHarness(),f=racer(a),C=h.loadModule('entertainment/GiantWaveRaceController').GiantWaveRaceController;
            const broken={configureEntertainmentGiantWave(state){if(state)throw new Error('失败');}};
            assert.throws(()=>new C(h.root,f.body.courseLayout,[f.body,broken],42,200,layers),/失败/);
            assert.equal(f.body.motor.hasEntertainmentGiantWave,false);
        }else assert.throws(()=>new P(h.root,.055,failure==='layer'?layers:null),/失败/);
        assert.ok(h.meshes.every(m=>m.destroyCount===1));assert.ok(h.materials.every(m=>m.destroyCount===1));assert.ok(h.nodes.slice(1).every(n=>!n.isValid));
        if(failure==='layer')assert.equal(released,1);if(failure==='binding')assert.equal(released,3);
    }
});

test('真实抬升沿世界竖直，不随侧翻或碰撞前翻偏移；主干镜头保留抬升且过滤碰撞摇晃',()=>{
    const a=createAiHarness(),f=racer(a),h=fixture();
    const Rig=extracted('assets/scripts/entity/CartoonSwimmerRig.ts','CartoonSwimmerRig',
        ['_giantWaveLift','giantWaveLift','setGiantWaveLift','applyCollisionPitchPivotCompensation','removeCollisionPitchVisualOffset'],{Vec3:a.Vec3,Quat:a.Quat});
    const rig=new Rig();rig.node=f.body.node;rig._model=new a.Node(f.body.node);rig._lastTreadModelY=.2;rig._hasCollisionPitchPivot=true;
    rig._collisionPitchPivotModelLocal=new a.Vec3(.4,.2,0);rig._collisionPitchVisualOffset=new a.Vec3();
    for(const key of ['_tmpCollisionPitchPivotBase','_tmpCollisionPitchPivotCurrent','_tmpCollisionPitchPivotNeutral','_tmpCollisionPitchDelta'])rig[key]=new a.Vec3();
    rig._tmpCollisionPitchInverseRotation=new a.Quat();
    rig.getUpperBodyWorldPosition=out=>{rig._model.getWorldPosition(out);return true;};f.body.cartoonRig=rig;
    for(const parentTilt of [0,30])for(const roll of [0,75,160])for(const pitch of [0,60,-45]){
        const parent=new a.Node();parent.setRotationFromEuler(parentTilt,20,0);parent.setScale(2,2,2);f.body.node.parent=parent;
        const current=new a.Quat(),neutral=new a.Quat();a.Quat.fromEuler(current,roll,35,pitch);a.Quat.fromEuler(neutral,roll,35,0);
        f.body.node.setRotation(current);a.Quat.copy(f.body._cameraNeutralCourseRotation,neutral);f.body._cameraCollisionPitchApplied=pitch===0?0:1;
        rig.setGiantWaveLift(0);rig.applyCollisionPitchPivotCompensation(current,neutral);
        const base=rig._model.getWorldPosition(new a.Vec3()),camera=f.body.getCameraUpperBodyWorldPosition(new a.Vec3());
        rig.setGiantWaveLift(.25);rig.applyCollisionPitchPivotCompensation(current,neutral);
        const lifted=rig._model.getWorldPosition(new a.Vec3()),next=f.body.getCameraUpperBodyWorldPosition(new a.Vec3());
        near(lifted.x,base.x);near(lifted.z,base.z);near(lifted.y-base.y,.25);
        near(next.x,camera.x);near(next.z,camera.z);near(next.y-camera.y,.25);
    }
});

test('AI在公开预告中并入顺浪或绕开迎浪；转身、深潜、完赛与远离浪面没有旧目标',()=>{
    const h=fixture(),r=h.rules,s=r.newGiantWaveState();Object.assign(s,{phase:'preview',x:3,startX:3,z:0,width:12,length:6});
    const sample={eligible:true,x:10,z:0,direction:1,speed:3,distance:10};
    assert.ok(Math.abs(r.giantWaveTargetZ(s,sample,0,24,.9))<s.width/2);
    sample.direction=-1;assert.ok(Math.abs(r.giantWaveTargetZ(s,sample,0,24,.9))>s.width/2);
    sample.eligible=false;assert.equal(r.giantWaveTargetZ(s,sample,0,24,.9),null);
    sample.eligible=true;s.phase='active';s.age=r.waveArrivalTime(s);assert.equal(r.giantWaveTargetZ(s,sample,0,24,.9),null);
    s.age=4;sample.x=-100;assert.equal(r.giantWaveTargetZ(s,sample,0,24,.9),null);
});

test('准备阶段完成创建，20次重赛复用网格与选手状态，无额外加载，结束与销毁清理一次',()=>{
    const h=fixture(),a=createAiHarness(),f=racer(a),R=h.loadModule('app/EntertainmentRaceRuntime').EntertainmentRaceRuntime;
    const S=h.loadModule('core/GameConstants').GameState;
    const runtime=new R(h.root,f.body.courseLayout,'giant-wave',42,200,[{lane:0,swimmer:f.body,condition:f.condition,ai:f.ai}]);
    let prepared=0;runtime.prepare(e=>{assert.ifError(e);prepared++;});assert.equal(prepared,1);
    const current=f.body.motor._giantWave,budget=h.budget();assert.ok(current);
    for(let i=0;i<20;i++){
        runtime.onStateChanged(S.COUNTDOWN);f.body.startRace(20,4);runtime.onStateChanged(S.RACING);
        runtime.update(.1,S.RACING);assert.equal(runtime.giantWave.simulation.state.phase,'preview');
        runtime.update(3,S.RACING);runtime.update(4,S.RACING);
        current.state.x=f.body.courseLayout.distanceToWorldX(f.body.distance);f.body.stepSimulation(.1);assert.ok(current.lift>0);
        runtime.onStateChanged(S.FINISHED);near(current.lift,0);near(f.body.cartoonRig.giantWaveLift,0);
        assert.equal(f.body.motor._giantWave,current);assert.deepEqual(h.budget(),budget);assert.equal(f.ai._entertainmentTargetZ,null);
    }
    runtime.dispose();runtime.dispose();assert.equal(f.body.motor.hasEntertainmentGiantWave,false);assert.equal(f.body.motor._entertainment,null);
    assert.ok(h.meshes.every(m=>m.destroyCount===1));assert.ok(h.materials.every(m=>m.destroyCount===1));
});

test('全部主干角色在普通巨浪200/400米、30/60Hz可完赛，逻辑距离和位置始终有效',()=>{
    const h=fixture(),a=createAiHarness(),balance=a.load('core/GameBalance'),C=h.loadModule('entertainment/GiantWaveRaceController').GiantWaveRaceController;
    const characters=a.load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS;
    let previews=0,rides=0,opposed=0;
    for(const distance of [200,400])for(const fps of [30,60])for(const character of characters){
        balance.setRaceDifficulty(distance===200?'competitive':'championship');a.load('core/SharedRNG').reseedSharedRandom(42);
        const f=racer(a,character.id,2),c=new C(h.root,f.body.courseLayout,[f.body],42,distance);let steps=0,clock=1;
        while(f.body.motor.isRacing&&steps<fps*350){
            f.step(1/fps);c.update(1/fps);clock+=1/fps;
            if(clock>=.1){clock=0;f.ai.setEntertainmentTargetZ(c.targetZForAi(0));}
            if(f.body.motor.isGiantWaveRiding)rides++;if(f.body.motor.isGiantWaveOpposed)opposed++;
            assert.ok(Number.isFinite(f.body.distance)&&Number.isFinite(f.body.node.position.y));steps++;
        }
        assert.equal(f.body.motor.isRacing,false,`${character.id}/${distance}/${fps} 未完赛`);assert.equal(f.body.distance,distance);
        near(f.body.motor.giantWaveLift,0);near(f.body.cartoonRig.giantWaveLift,0);previews+=c.simulation.previews;c.dispose();
    }
    assert.ok(previews>0&&rides>0&&opposed>0,`${previews}/${rides}/${opposed}`);
});

test('巨浪入口仍只允许本地AI测试，旧娱乐计划不变，五项调参可保存重载且兼容旧配置',()=>{
    const h=fixture(),p=h.loadModule('entertainment/EntertainmentDebugPlan');
    assert.equal(p.normalizeEntertainmentDebugMode('giant-wave'),'giant-wave');
    assert.equal(p.entertainmentDebugAllowed(true,false,false,false,false,'giant-wave'),true);
    for(let i=0;i<5;i++){const gates=[true,false,false,false,false];gates[i]=i!==0;assert.equal(p.entertainmentDebugAllowed(...gates,'giant-wave'),false);}
    const plan=p.buildEntertainmentDebugPlan('giant-wave',200);assert.equal(plan.giantWave,true);assert.equal(plan.geyser,false);assert.equal(plan.whirlpool,false);assert.equal(plan.supplies.length,0);assert.equal(plan.debris.length,0);
    for(const mode of ['none','supplies','debris','supplies-debris','whirlpool','whirlpool-super','geyser'])assert.equal(p.buildEntertainmentDebugPlan(mode,200).giantWave,false);
    const saved=new Map();Object.assign(h.cc,{JsonAsset:class{},native:{},sys:{localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)}},
        resources:{load(_p,_t,done){done(null,{json:{version:52,values:{}}});}}});
    const tuning=h.loadModule('core/TuningDebugControls'),controls=tuning.TUNING_GROUPS.flatMap(g=>g.controls),b=h.loadModule('core/EntertainmentBalance');
    const values=[['height',.48,.6],['widthFraction',.55,.7],['travelSpeed',4.2,3.5],['boostSpeed',1.1,.8],['oppositionSlowdown',.3,.2]];
    tuning.loadSavedTuningAsync(()=>{});
    for(const [key,initial,value] of values){near(b.GIANT_WAVE_TUNING[key],initial);controls.find(c=>c.id==='entertainment.giantWave.'+key).set(value);}
    assert.equal(tuning.saveCurrentTuning().ok,true);
    for(const [key,initial] of values)controls.find(c=>c.id==='entertainment.giantWave.'+key).set(initial);
    tuning.loadSavedTuningAsync(()=>{});for(const [key,,value] of values)near(b.GIANT_WAVE_TUNING[key],value);
});
