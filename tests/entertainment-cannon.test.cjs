const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createHarness}=require('./helpers/cocos-math-harness.cjs');
const {createBuoyHarness}=require('./helpers/spray-buoy-harness.cjs');
const {runCannonScenario}=require('./helpers/cannon-scenarios.cjs');
const frozen=require('./fixtures/butterfly-cannon.json');
const fixture=()=>{const h=createHarness();return {...h,load:n=>h.load(path.join(h.root,'assets/scripts',n+'.ts'))};};
const cannon=(seed=42,distance=200,ids)=>createBuoyHarness(seed,distance,ids,'cannon');
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const position=(s,distance,z)=>{s.motor.setFlipTurnDistance(distance);s.motor.setLateralOffset(z-s.startPosition.z);s.node.setPosition(s.courseLayout.distanceToWorldX(distance),s.courseLayout.swimY,z);};

test('单发炮击只加入本地AI入口，普通赛、联机、房间、教学、Boss和低强度组合不启用',()=>{
    const h=fixture(),p=h.load('entertainment/EntertainmentDebugPlan');
    assert.equal(p.normalizeEntertainmentDebugMode('cannon'),'cannon');
    const plan=p.buildEntertainmentDebugPlan('cannon',200,42);
    assert.ok(plan.cannon&&!plan.sprayBuoy&&!plan.geyser&&!plan.giantWave&&!plan.whirlpool&&!plan.light&&!plan.supplies.length&&!plan.debris.length);
    assert.equal(p.buildEntertainmentDebugPlan('light-mix',200,42).cannon,false);
    for(const args of [[false,false,false,false,false],[true,true,false,false,false],[true,false,true,false,false],[true,false,false,true,false],[true,false,false,false,true]])assert.equal(p.entertainmentDebugAllowed(...args,'cannon'),false);
});

test('36组单发落点、命中与AI避让记录与冻结来源一致，公共随机序列不受影响',()=>{
    const h=fixture(),C=h.load('entertainment/CannonBrawlController').CannonBrawlController,rng=h.load('core/SharedRNG');
    rng.reseedSharedRandom(71);const expected=rng.randomFloat();rng.reseedSharedRandom(71);
    for(const f of frozen.fixtures){
        const actual=runCannonScenario((racers,world,launch,impact)=>{
            const c=new C(4,f.seed,24,l=>racers[l],launch,impact,f.raceDistance-20,world);
            return {step:dt=>c.update(dt),ai:(...args)=>c.targetZForAi(...args)};
        },f.seed,f.length,f.raceDistance,f.fps);
        assert.deepEqual(actual,f,`${f.seed}/${f.length}/${f.raceDistance}/${f.fps}`);
    }
    assert.equal(rng.randomFloat(),expected);
});

test('中心只击倒最近一人，外围受冲击；保护、完赛和离场排除，折返按同一水面判断',()=>{
    const h=fixture(),C=h.load('entertainment/CannonBrawlController').CannonBrawlController;
    for(const start of [25,70,125]){
        const world=d=>Math.floor(d/50)%2 ? 50-d%50 : d%50;
        const racers=Array.from({length:6},()=>({active:true,finished:false,damageable:true,distance:start,lateral:0,speed:2}));
        let shot;const hits=[];const c=new C(6,42,24,l=>racers[l],s=>shot=s,e=>hits.push(e),180,world,[start]);c.update(.05);
        for(const r of racers){r.distance=shot.targetDistance;r.lateral=shot.targetZ;}
        racers[1].lateral+=.2;racers[2].lateral+=1.5;racers[3].damageable=false;racers[4].finished=true;racers[5].active=false;
        for(let i=0;i<13;i++)c.update(.1);
        assert.equal(hits.length,1);assert.equal(hits[0].knockedLane,0);assert.equal(hits[0].hitMask,7);
        for(let i=0;i<60;i++)c.update(.1);assert.equal(hits.length,1);
    }
});

test('九个赛前加载点失败均清理；退出或绑定异常不留下模型、材质或回调',()=>{
    for(let fail=0;fail<9;fail++){
        const h=cannon(),pending=[];let index=0,done=0,error;
        h.setLoadOverride((p,t,cb)=>pending.push({p,cb}));h.runtime.prepare(e=>{done++;error=e;});
        while(pending.length){assert.equal(done,0);const {p,cb}=pending.shift();cb(index++===fail?new Error('资源失败'):null,h.prefabs.get(p));}
        assert.ok(error);assert.equal(done,1);assert.equal(h.layers.size,0);assert.equal(h.liveBudget().nodes,3);assert.equal(h.liveBudget().materials,0);
        assert.ok(h.meshes.every(m=>m.destroyCount===0));
    }
    const late=cannon(),pending=[];let done=0;late.setLoadOverride((p,t,cb)=>pending.push({p,cb}));late.runtime.prepare(e=>{assert.ok(e);done++;});
    late.runtime.dispose();pending[0].cb(null,late.prefabs.get(pending[0].p));assert.equal(done,1);assert.equal(late.layers.size,0);
    for(const failAt of [1,2,3,4,5,6]){
        const h=cannon();let count=0,error;
        h.runtime.waterLayers={registerFloatingObject(n){if(++count===failAt)throw new Error('绑定失败');h.layers.add(n);return()=>h.layers.delete(n);}};
        h.runtime.prepare(e=>error=e);assert.ok(error);assert.equal(h.layers.size,0);assert.equal(h.liveBudget().nodes,3);assert.equal(h.liveBudget().materials,0);
        assert.ok(h.actors.every(a=>a.body.cartoonRig.onEntertainmentRecoveryFloat===null));
    }
});

test('炮管仰角沿水球起始方向，球从真实炮口出发；前后岸及返程落点一致',()=>{
    const h=cannon();h.runtime.prepare(assert.ifError);h.runtime.onStateChanged(h.state.COUNTDOWN);
    const p=h.runtime.cannon.presentation,course=h.actors[0].body.courseLayout;let id=0;
    const world=(n,v)=>h.Vec3.transformMat4(new h.Vec3(),v,n.worldMatrix);
    for(const distance of [3,10,25,40,47,53,75,97])for(const z of [-8,0,8])for(const side of [0,1]){
        id+=2;const shot={strikeId:id+side,targetDistance:distance,targetZ:z,warningSeconds:1.25,revision:id};p.showLaunch(shot);
        const nozzle=p.nozzles[side],origin=world(nozzle,new h.Vec3()),muzzle=world(nozzle,new h.Vec3(0,0,1.02));
        assert.ok(h.Vec3.equals(p.projectile.worldPosition,muzzle));
        const axis=h.Vec3.normalize(new h.Vec3(),h.Vec3.subtract(new h.Vec3(),muzzle,origin));
        p.update(.05,shot,shot.warningSeconds*(1-.0001));
        const direction=h.Vec3.normalize(new h.Vec3(),h.Vec3.subtract(new h.Vec3(),p.projectile.worldPosition,muzzle));assert.ok(h.Vec3.dot(axis,direction)>.99999999);
        p.update(.05,shot,0);near(p.projectile.worldPosition.x,course.distanceToWorldX(distance));near(p.projectile.worldPosition.y,course.waterY+.12);near(p.projectile.worldPosition.z,z);
        assert.equal(p.projectile.components[0].material.name,'RuntimeEntertainmentWaterline');
    }
    h.runtime.dispose();assert.equal(h.layers.size,0);
});

test('调短或调长提醒时间时，水球按该发的实际时长飞行而非写死默认时长',()=>{
    const h=cannon();h.runtime.prepare(assert.ifError);const p=h.runtime.cannon.presentation;
    for(const warningSeconds of [.8,1.25,3]){
        const shot={strikeId:1,targetDistance:40,targetZ:0,warningSeconds,revision:1};p.showLaunch(shot);p.update(.05,shot,warningSeconds/2);
        near(p.projectile.worldPosition.x,(p.source.x+p.target.x)/2);near(p.projectile.worldPosition.z,(p.source.z+p.target.z)/2);
        near(p.projectile.worldPosition.y,(p.source.y+p.target.y)/2+5.8);
    }h.runtime.dispose();
});

test('真实中心命中进入共用扶圈恢复，外围继续游；20次重赛不加载、不增建，体力蓄气保留',()=>{
    const h=cannon();h.runtime.prepare(assert.ifError);h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);
    const c=h.runtime.cannon,budget=h.liveBudget(),loads=h.requests.length,a=h.actors[0].body,b=h.actors[1].body;
    for(let round=0;round<20;round++){
        if(round){for(const f of h.actors){f.body.startRace(0,.8);f.ai.startSwimming();}h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);}
        position(a,25,0);position(b,25,4);h.runtime.update(.01,h.state.RACING);const shot=c.rules.currentLaunch();assert.ok(shot);
        position(a,shot.targetDistance,shot.targetZ);position(b,shot.targetDistance,shot.targetZ+1.5);
        h.actors[0].condition.consumeEnergy(h.actors[0].condition.energyTotal*.1);a.ultimate.applyNetEnergy(37,1);
        const energy=h.actors[0].condition.energyRatio,charge=a.ultimate.energy;
        for(let i=0;i<13;i++)h.runtime.update(.1,h.state.RACING);
        assert.equal(a.isEntertainmentKnocked,true);assert.equal(b.isEntertainmentKnocked,false);assert.ok(b.isRacing);assert.equal(c.recovery.rules.stateForLane(0).reason,2);
        const d=a.distance;for(let i=0;i<36;i++)h.runtime.update(.1,h.state.RACING);
        assert.equal(a.isEntertainmentKnocked,false);assert.ok(a.isRacing&&a.isEntertainmentInvulnerable);near(a.distance,d);assert.equal(h.actors[0].condition.energyRatio,energy);assert.equal(a.ultimate.energy,charge);
        assert.deepEqual(h.liveBudget(),budget);assert.equal(h.requests.length,loads);h.runtime.onStateChanged(h.state.FINISHED);
    }
    h.runtime.dispose();assert.equal(h.layers.size,0);assert.equal(h.liveBudget().materials,0);
});

test('有人完赛停止新发但已发水球正常落下，恢复中的离场选手不会复活；隐藏后零渲染写入',()=>{
    const h=cannon();h.runtime.prepare(assert.ifError);h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);
    const c=h.runtime.cannon,a=h.actors[0].body,b=h.actors[1].body;
    position(a,25,0);position(b,25,4);h.runtime.update(.05,h.state.RACING);const shot=c.rules.currentLaunch();position(a,shot.targetDistance,shot.targetZ);position(b,200,4);
    for(let i=0;i<13;i++)h.runtime.update(.1,h.state.RACING);assert.equal(c.rules.currentLaunch(),null);assert.ok(a.isEntertainmentKnocked);
    a.eliminate();for(let i=0;i<60;i++)h.runtime.update(.1,h.state.RACING);assert.equal(a.isRacing,false);assert.equal(a.isEntertainmentKnocked,false);
    c.hide();const writes=()=>h.nodes.reduce((v,n)=>v+n.writes,0),before=writes();
    for(let i=0;i<120;i++){c.presentation.update(1/60,null,0);c.splashes.update(1/60);}assert.equal(writes(),before);
    h.runtime.dispose();assert.equal(h.layers.size,0);
});

test('全角色200/400米30/60Hz炮击可完赛，确实发生击倒并恢复，模型和加载次数保持稳定',()=>{
    const ids=fixture().load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.map(d=>d.id);
    for(const distance of [200,400])for(const fps of [30,60])for(const group of [ids.slice(0,8),ids.slice(8)]){
        const h=cannon(42,distance,group);h.runtime.prepare(assert.ifError);h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);
        const budget=h.liveBudget(),loads=h.requests.length,a=h.actors[0].body,c=h.runtime.cannon;
        position(a,25,0);h.runtime.update(1/fps,h.state.RACING);const shot=c.rules.currentLaunch();position(a,shot.targetDistance,shot.targetZ);
        for(let i=0;i<Math.ceil(shot.warningSeconds*fps)+1;i++)h.runtime.update(1/fps,h.state.RACING);assert.ok(a.isEntertainmentKnocked);
        for(let frame=0;frame<fps*600;frame++){
            h.runtime.update(1/fps,h.state.RACING);for(const f of h.actors)if(f.body.distance<distance)f.step(1/fps);
            if(h.actors.every(f=>f.body.distance>=distance))break;
        }
        for(const f of h.actors)assert.ok(f.body.distance>=distance,`${f.profile.characterId}/${distance}/${fps}未完赛`);
        assert.deepEqual(h.liveBudget(),budget);assert.equal(h.requests.length,loads);h.runtime.dispose();assert.equal(h.layers.size,0);
    }
});

test('炮击参数在旧调参缺键时使用来源默认值，可通过统一保存重新加载',()=>{
    const h=fixture(),saved=new Map();
    Object.assign(h.cc,{JsonAsset:class {},native:{},sys:{localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)}},
        resources:{load(p,t,cb){cb(null,{json:{version:52,values:{}}});}}});
    const t=h.load('core/TuningDebugControls'),balance=h.load('core/EntertainmentBalance').CANNON_BRAWL_TUNING;
    const entry=t.TUNING_GROUPS.flatMap(s=>s.controls).find(c=>c.id==='entertainment.cannon.warningSeconds');
    assert.ok(entry);t.loadSavedTuningAsync(()=>{});near(balance.warningSeconds,1.25);entry.set(2);assert.equal(t.saveCurrentTuning().ok,true);
    entry.set(1.25);t.loadSavedTuningAsync(()=>{});near(balance.warningSeconds,2);
});
