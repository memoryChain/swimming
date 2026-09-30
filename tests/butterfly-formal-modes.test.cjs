// 执行真实输入、实体、运动、事件恢复及奖励；模型、特效和池边接触用渲染替身。
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createBody,load}=require('./helpers/butterfly-race-harness.cjs');
const B=load('core/GameBalance'),{StrokeType}=load('core/GameConstants');
const {EntertainmentRecoveryController,ENTERTAINMENT_RECOVERY_TUNING:R}=load('core/EntertainmentRecoveryController');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function beat(f,released=true){
    const m=f.body.motor;assert.equal(f.body.beginButterfly(),true);
    f.body.stepSimulation(m.butterfly.duration*.42);
    if(released){f.body.releaseButterfly();f.flush();}
    return m;
}
function recoverArms(f){for(let i=0;i<180&&f.body.motor.isArmStrokeActive;i++)f.body.stepSimulation(1/60);f.flush();}

test('无外力时三类正式规则中蝶泳停止自身转向，自由泳保留各自转向规则，正常冲线只广播一次并清预算',()=>{
    for(const mode of ['beginner','competitive','entertainment-brawl']){
        B.setRaceMode(mode);B.setSoloRaceDistance(200);
        const f=createBody(),m=f.body.motor;m.setSteeringEnabled(true);
        m.setStrokeHeld(StrokeType.LEFT,true,.2);assert.equal(m.recordStroke(StrokeType.LEFT),true);
        m.update(.3,{isAI:false});f.settle(m.setStrokeHeld(StrokeType.LEFT,false));
        recoverArms(f);assert.equal(Math.abs(m.heading)>0,mode!=='beginner');
        const heading=m.heading;beat(f);for(let i=0;i<10;i++)f.body.stepSimulation(.01);
        near(m.heading,heading);assert.equal(m.recordStroke(StrokeType.RIGHT),false);
        m.setFlipTurnDistance(199.99);f.body._phases._lastCompletedFlipTurnWallDistance=150;
        f.body.stepSimulation(.1);f.flush();assert.equal(m.distance,200);
        assert.equal(f.body.finishedEvents,1);assert.equal(m.butterfly.active,false);near(m._butterflyPulse.impulseBudget,0);
        f.body.stepSimulation(.1);assert.equal(f.body.finishedEvents,1);
    }
});

test('四类致命娱乐命中清除蝶泳，原进度重生后可重新起划且已结算收益不重付',()=>{
    B.setRaceMode('entertainment-brawl');B.setSoloRaceDistance(200);
    for(const reason of [1,2,3,4])for(const released of [false,true]){
        const f=createBody(),m=beat(f,released),paid=f.body.settledStrokeEnergy;
        const energy=f.condition.energy,gas=f.body._ultimate.energy;
        const recovery=new EntertainmentRecoveryController(1,{
            onKnocked:()=>f.body.beginEntertainmentKnockout(),
            onRespawn:(_lane,state)=>f.body.respawnAfterEntertainmentHit(state.distance,0,R.respawnSpeed),
            onRecovered:()=>f.body.endEntertainmentInvulnerability(),
        });
        assert.equal(recovery.applyKnockDown({lane:0,reason,distance:m.distance,revision:1}),true);
        const distance=m.distance;assert.equal(m.isRacing,false);assert.equal(m.butterfly.active,false);
        assert.equal(m.isButterflyRecoveryLocked,false);near(m._butterflyPulse.impulseBudget,0);
        assert.equal(f.body.beginButterfly(),false);f.body.releaseButterfly();f.flush();
        near(f.condition.energy,energy);near(f.body._ultimate.energy,gas);near(f.body.settledStrokeEnergy,paid);
        recovery.update(R.knockedSeconds);assert.equal(m.isRacing,true);near(m.distance,distance);near(m.currentSpeed,0);
        assert.equal(f.body._entertainmentInvulnerable,true);assert.equal(f.body.beginButterfly(),true);
        recovery.update(R.invulnerableSeconds);assert.equal(f.body._entertainmentInvulnerable,false);
        assert.equal(recovery.applyKnockDown({lane:0,reason,distance,revision:1}),false,'旧命中不重新击倒');
    }
});

test('喷泉核心接管蝶泳并清预算，腾空双按不可起划，落水后可恢复；擦边不免疫核心',()=>{
    B.setRaceMode('entertainment-brawl');B.setSoloRaceDistance(200);
    for(const released of [false,true]){
        const f=createBody(),m=beat(f,released),paid=f.body.settledStrokeEnergy;
        assert.equal(f.body.applyGeyserHit(1009,1),true);assert.equal(f.body.applyGeyserHit(1009,2),true);
        assert.equal(f.body.applyGeyserHit(1009,2),false);
        assert.equal(m.butterfly.active,false);near(m._butterflyPulse.impulseBudget,0);
        assert.equal(f.body.beginButterfly(),false);assert.equal(f.body.canUseArmStroke,false);
        for(let i=0;i<120&&f.body._forcedLaunch;i++)f.body.stepSimulation(1/60);
        assert.equal(f.body._forcedLaunch,null);f.flush();near(f.body.settledStrokeEnergy,paid);
        assert.equal(f.body.beginButterfly(),true);
    }
});

test('苏打与冰沙不改本拍甜区快照，下一拍读取实际心率；冰沙与环境阻力仍削弱真实推进',()=>{
    B.setRaceMode('entertainment-brawl');B.setSoloRaceDistance(200);
    const soda=createBody(),m=beat(soda,false),width=m.butterfly.perfectEnd-m.butterfly.perfectStart;
    m.applyHeartbeatSoda(90,2);near(m.butterfly.perfectEnd-m.butterfly.perfectStart,width);
    soda.body.releaseButterfly();soda.flush();recoverArms(soda);assert.equal(soda.body.beginButterfly(),true);
    assert.ok(m.butterfly.perfectEnd-m.butterfly.perfectStart<width);
    const run=(ice,drag)=>{const f=createBody(),motor=beat(f);motor.setEnvironmentDrag(drag);
        if(ice)motor.applyCalmSlush(60,3);let distance=motor.distance;
        for(let i=0;i<12;i++)f.body.stepSimulation(1/60);f.flush();
        near(f.body.settledStrokeEnergy,2);return motor.distance-distance;};
    const normal=run(false,0);assert.ok(run(true,0)<normal);assert.ok(run(false,8)<normal);
});

test('正式娱乐驻留漩涡在蝶泳中施加实际水流与阻力，模型压水没有减阻收益',()=>{
    const D=load('core/EntertainmentModeDirector'),W=load('core/WhirlpoolBrawlRules');
    B.setRaceMode('entertainment-brawl');B.setSoloRaceDistance(200);
    const director=new D.EntertainmentModeDirector(17,200,true,undefined,[D.EntertainmentEventId.WHIRLPOOL]);
    for(let i=0;i<200&&!D.isEntertainmentEventResident(D.EntertainmentEventId.WHIRLPOOL);i++)director.update(.1,30,true,2.5);
    assert.equal(B.isWhirlpoolBrawlMode(),true);
    W.setRuntimeWhirlpoolSpawns([{id:0,distance:30,centerFraction:0,spin:1,variant:'super'}]);
    try{
        const rows=[];
        for(const offset of [0,-.3]){
            const f=createBody(),m=f.body.motor;m.setFlipTurnDistance(30);beat(f,false);
            m.butterfly.buoyancy.offsetY=offset;f.body.stepSimulation(.1);
            assert.ok(f.body._whirlpoolInfluence.captureDrag>0);assert.ok(f.body._whirlpoolInfluence.intensity>0);
            rows.push([m.distance,m.currentSpeed,m.heading,m.axialRollRadians]);
        }
        assert.deepEqual(rows[0],rows[1]);
    }finally{W.setRuntimeWhirlpoolSpawns(null);D.resetEntertainmentEventRuntime();}
});

test('实体进入漩涡后起划保留已受水流的偏航，蝶泳中漩涡仍可改变朝向',()=>{
    const D=load('core/EntertainmentModeDirector'),W=load('core/WhirlpoolBrawlRules');
    B.setRaceMode('entertainment-brawl');B.setSoloRaceDistance(200);
    const director=new D.EntertainmentModeDirector(17,200,true,undefined,[D.EntertainmentEventId.WHIRLPOOL]);
    for(let i=0;i<200&&!D.isEntertainmentEventResident(D.EntertainmentEventId.WHIRLPOOL);i++)director.update(.1,30,true,2.5);
    W.setRuntimeWhirlpoolSpawns([{id:0,distance:30,centerFraction:0,spin:1,variant:'super'}]);
    try{
        // 离开完全对称的中心点，才能采到真实切向偏航力。
        const f=createBody(),m=f.body.motor;m.setFlipTurnDistance(29.5);
        f.body.stepSimulation(.05);
        const rate=m.headingTurnRate,heading=m.heading;
        assert.ok(Math.abs(rate)>1e-6,'真实实体已受到漩涡偏航力');
        assert.equal(f.body.beginButterfly(),true);
        near(m.headingTurnRate,rate);near(m.heading,heading);
        f.body.stepSimulation(.05);
        assert.ok(Math.abs(m.heading-heading)>1e-6,'起划后水流继续改变朝向');
    }finally{W.setRuntimeWhirlpoolSpawns(null);D.resetEntertainmentEventRuntime();}
});

test('蝶泳巨浪顺逆向效果沿用实际浪面，升沉不免疫逆浪，事件退出清除贡献',()=>{
    B.setRaceMode('entertainment-brawl');B.setSoloRaceDistance(200);
    const G=load('core/GiantWaveRules');
    for(const direction of [-1,1]){
        let wave;
        for(let seed=1;seed<100&&!wave;seed++){
            const sim=new G.GiantWaveSimulation(50,0,50,20,seed,'single');
            const sample={distance:10,x:10,z:0,direction:1,speed:2,eligible:true};sim.update(.01,[sample],false);
            if(sim.state.direction!==direction)continue;
            for(let i=0;i<900&&sim.state.phase!=='active';i++)sim.update(.01,[sample],false);
            wave=sim.state;wave.age=wave.growthTime;wave.x=wave.startX+direction*G.waveTravel(wave,wave.age);
        }
        assert.ok(wave);const f=createBody(),m=f.body.motor;m.setFlipTurnDistance(wave.x);
        f.body.giantWaveState=wave;assert.equal(f.body.beginButterfly(),true);m.butterfly.buoyancy.offsetY=-.3;
        f.body.stepSimulation(.1);assert.equal(direction>0?f.body._waveRiding:f.body._waveOpposed,true);
        assert.ok(direction>0?m.giantWaveSpeed>0:m.giantWaveSpeed<0);
        f.body.clearGiantWave();near(m.giantWaveSpeed,0);assert.equal(f.body._waveRiding,false);
    }
});

test('真实蝶泳统计经正式奖励入口结算一次，测试、托管和房间均不发奖',async()=>{
    B.setRaceMode('competitive');B.setSoloRaceDistance(200);
    const f=createBody();for(let i=0;i<3;i++){beat(f);recoverArms(f);}assert.equal(f.body.rhythmStats.perfectCount,3);
    const {createDefaultProfile}=load('backend/PlayerProfile'),{executeCareer}=load('progression/CareerRules');
    const profile=createDefaultProfile(),characterId=Object.keys(profile.characters)[0];profile.characters[characterId].signed=true;
    let ticket;
    const ts=require(process.env.PATH.split(path.delimiter).map(d=>path.resolve(d,'../typescript/lib/typescript.js')).find(p=>fs.existsSync(p)));
    const source=ts.createSourceFile('GameManager.ts',fs.readFileSync(path.join(__dirname,'../assets/scripts/core/GameManager.ts'),'utf8'),ts.ScriptTarget.Latest,true);
    let callback;function visit(n){if(ts.isPropertyAssignment(n)&&n.name.getText(source)==='awardProgression')callback=n.initializer.getText(source);ts.forEachChild(n,visit);}visit(source);assert.ok(callback);
    const manager={_roomMode:false,_netSession:null,_aiDebugMode:false,_playerAutopilotUsedThisRace:false,_modelDebugFlow:null};let calls=0;
    const js=ts.transpileModule(`(function(){return ${callback};}).call(manager)`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    const award=vm.runInNewContext(js,{manager,getSoloRaceTicket:()=>ticket,PlayerData:{executeCareer:async command=>{calls++;return executeCareer(profile,command);}}});
    const input={placement:1,racerCount:8,finished:true,time:80,...f.body.rhythmStats};
    for(const rule of ['standard','wild','entertainment'])for(const distance of [200,400]){
        const begin=executeCareer(profile,{type:'begin',source:'quick',characterId,tier:0,distance,rule,seed:17});
        assert.equal(begin.ok,true);ticket=begin.ticket;
        const receipt=await award(input);assert.ok(receipt.coinsGained>0);const coins=profile.coins;
        await award(input);assert.equal(profile.coins,coins,'同一正式比赛不重复发奖');
    }
    for(const key of ['_roomMode','_netSession','_aiDebugMode','_playerAutopilotUsedThisRace','_modelDebugFlow']){
        manager[key]=key==='_modelDebugFlow'?{active:true}:true;const before=calls;
        assert.equal(await award(input),null);assert.equal(calls,before);manager[key]=key==='_modelDebugFlow'?null:false;
    }
});
