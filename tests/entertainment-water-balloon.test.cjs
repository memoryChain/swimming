const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createHarness}=require('./helpers/cocos-math-harness.cjs');
const {createBuoyHarness}=require('./helpers/spray-buoy-harness.cjs');
const {runWaterBalloonScenario}=require('./helpers/water-balloon-scenarios.cjs');
const frozen=require('./fixtures/butterfly-water-balloon.json');
const fixture=()=>{const h=createHarness();return {...h,load:n=>h.load(path.join(h.root,'assets/scripts',n+'.ts'))};};
const game=(seed=42,distance=200,ids)=>createBuoyHarness(seed,distance,ids,'water-balloon');
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const position=(s,d,z)=>{s.motor.setFlipTurnDistance(d);s.motor.setLateralOffset(z-s.startPosition.z);s.node.setPosition(s.courseLayout.distanceToWorldX(d),s.courseLayout.swimY,z);};
function ruleCase(rounds=[{triggerDistance:24,fuseSeconds:8}],count=3) {
    const h=fixture(),events=[],racers=Array.from({length:count},()=>({active:true,finished:false,recovering:false,distance:24,lateral:0,speed:1.5}));
    const C=h.load('entertainment/MineRelayBrawlController').MineRelayBrawlController;
    const rules=new C(count,42,24,l=>racers[l],e=>events.push(e),e=>events.push(e),e=>events.push(e),rounds);
    return {h,racers,rules,events};
}
test('水球只进入本地AI测试，普通赛、联机、房间、教学、Boss和组合均排除',()=>{
    const p=fixture().load('entertainment/EntertainmentDebugPlan');assert.equal(p.normalizeEntertainmentDebugMode('water-balloon'),'water-balloon');
    const plan=p.buildEntertainmentDebugPlan('water-balloon',200);assert.ok(plan.waterBalloon&&!plan.cannon&&!plan.sprayBuoy&&!plan.geyser&&!plan.giantWave&&!plan.whirlpool&&!plan.light&&!plan.debris.length&&!plan.supplies.length);
    assert.equal(p.buildEntertainmentDebugPlan('light-mix',400).waterBalloon,false);
    for(const args of [[false,false,false,false,false],[true,true,false,false,false],[true,false,true,false,false],[true,false,false,true,false],[true,false,false,false,true]])assert.equal(p.entertainmentDebugAllowed(...args,'water-balloon'),false);
});
test('36组水球发放、转交、结算与AI记录和固定来源一致，不消耗公共随机',()=>{
    const h=fixture(),C=h.load('entertainment/MineRelayBrawlController').MineRelayBrawlController,rng=h.load('core/SharedRNG');
    rng.reseedSharedRandom(71);const expected=rng.randomFloat();rng.reseedSharedRandom(71);
    let transfers=0,explosions=0;
    for(const f of frozen.fixtures){const actual=runWaterBalloonScenario((racers,world,direction,event)=>{
        const rules=new C(4,f.seed,24,l=>racers[l],event,event,event,undefined,null,world,direction);return{rules,step:dt=>rules.update(dt)};
    },f.seed,f.length,f.raceDistance,f.fps);assert.deepEqual(actual,f);transfers+=actual.events.filter(e=>'fromLane'in e).length;explosions+=actual.events.filter(e=>e.exploded).length;}
    assert.ok(transfers>0&&explosions>0);assert.equal(rng.randomFloat(),expected);
});
test('转交不重置计时，有冷却和传回保护，最后0.8秒禁止传球，爆开只结算一次',()=>{
    const {rules,racers,events}=ruleCase();rules.update(.01);const first=rules.currentCarrierLane();
    for(let i=0;i<6;i++)rules.update(.1);const next=rules.currentCarrierLane();assert.notEqual(next,first);near(rules.currentRemainingSeconds(),7.4);
    for(let lane=0;lane<racers.length;lane++)if(lane!==first&&lane!==next)racers[lane].active=false;
    for(let i=0;i<5;i++)rules.update(.1);assert.equal(rules.currentCarrierLane(),next);
    while(rules.currentRemainingSeconds()>.7)rules.update(.1);assert.ok(rules.isLocked());const locked=rules.currentCarrierLane(),at=events.length;
    for(let i=0;i<7;i++)rules.update(.1);assert.equal(events.slice(at).filter(e=>'fromLane'in e).length,0);
    assert.equal(events.filter(e=>e.exploded).length,1);assert.equal(events.find(e=>e.exploded).carrierLane,locked);
    for(let i=0;i<100;i++)rules.update(.1);assert.equal(events.filter(e=>e.exploded).length,1);
});
test('携带者受控计时暂停，恢复后保留球；离场或完赛解除，首位完赛取消后续轮次',()=>{
    for(const exit of ['active','finished']){
        const {rules,racers,events}=ruleCase([{triggerDistance:24,fuseSeconds:8},{triggerDistance:25,fuseSeconds:7}]);rules.update(.1);const carrier=racers[rules.currentCarrierLane()],remaining=rules.currentRemainingSeconds();
        carrier.recovering=true;for(let i=0;i<10;i++)rules.update(.1);assert.equal(rules.currentRemainingSeconds(),remaining);assert.ok(rules.isPaused());
        carrier.recovering=false;rules.update(.1);near(rules.currentRemainingSeconds(),remaining-.1);assert.ok(!rules.isPaused());
        rules.cancelPendingRoundsAfterCurrent();carrier[exit]=exit==='finished';rules.update(.1);assert.equal(rules.currentArm(),null);assert.equal(events.filter(e=>'exploded'in e).length,1);assert.equal(events.at(-1).exploded,false);
        for(let i=0;i<100;i++)rules.update(.1);assert.equal(rules.remainingRoundCount(),0);
    }
    const solo=ruleCase(undefined,1);for(let i=0;i<20;i++)solo.rules.update(.1);assert.equal(solo.events.length,0);
});
test('六个赛前资源失败均阻止放行，迟到和绑定异常释放所有自建资源',()=>{
    for(let fail=0;fail<6;fail++){
        const h=game(),pending=[];let index=0,done=0,error;h.setLoadOverride((p,t,cb)=>pending.push({p,cb}));h.runtime.prepare(e=>{error=e;done++;});
        while(pending.length){const {p,cb}=pending.shift();cb(index++===fail?new Error('资源失败'):null,h.prefabs.get(p));}
        assert.ok(error);assert.equal(done,1);assert.equal(h.layers.size,0);assert.equal(h.liveBudget().materials,0);assert.ok(h.meshes.every(m=>m.destroyCount===0));
    }
    const h=game(),pending=[];let done=0;h.setLoadOverride((p,t,cb)=>pending.push({p,cb}));h.runtime.prepare(e=>{assert.ok(e);done++;});h.runtime.dispose();pending[0].cb(null,h.prefabs.get(pending[0].p));assert.equal(done,1);assert.equal(h.layers.size,0);
    for(const failAt of [1,2,3,4]){const h=game();let count=0,error;h.runtime.waterLayers={registerFloatingObject(n){if(++count===failAt)throw Error('绑定失败');h.layers.add(n);return()=>h.layers.delete(n);}};h.runtime.prepare(e=>error=e);assert.ok(error);assert.equal(h.layers.size,0);assert.equal(h.liveBudget().materials,0);assert.ok(h.actors.every(a=>a.body.cartoonRig.mount===null));}
});
test('真实GLB两个网格共用原色图无光照水线，投放和转交只复用一个球',()=>{
    const h=game();h.runtime.prepare(assert.ifError);h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);const c=h.runtime.waterBalloon,p=c.presentation;
    const renderers=p.root.getComponentsInChildren(h.cc.MeshRenderer);assert.equal(renderers.length,2);assert.equal(renderers[0].material,renderers[1].material);
    const mat=renderers[0].material;assert.ok(mat.config.defines.USE_POOLSIDE_WATERLINE&&mat.config.defines.USE_TEXTURE);assert.equal(mat.properties.waterLine.x,h.actors[0].body.courseLayout.waterY);assert.ok(mat.properties.mainTexture.bytes.length>0);
    position(h.actors[0].body,24,0);position(h.actors[1].body,24,0);h.runtime.update(.01,h.state.RACING);assert.ok(p.visualNode);assert.equal(p.connector.active,false);
    const budget=h.liveBudget(),loads=h.requests.length;for(let i=0;i<20;i++)h.runtime.update(.1,h.state.RACING);assert.deepEqual(h.liveBudget(),budget);assert.equal(h.requests.length,loads);assert.equal(p.root.parent,h.root);
    h.runtime.dispose();assert.equal(h.layers.size,0);assert.equal(h.liveBudget().materials,0);
});
test('真实携带者爆开进入扶圈恢复，外围继续游；20次重赛不重载不增建',()=>{
    const h=game();h.runtime.prepare(assert.ifError);h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);const c=h.runtime.waterBalloon,budget=h.liveBudget(),loads=h.requests.length;
    for(let round=0;round<20;round++){
        if(round){for(const a of h.actors){a.body.startRace(0,.8);a.ai.startSwimming();}h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);}
        for(const a of h.actors)position(a.body,24,0);h.runtime.update(.01,h.state.RACING);
        const lane=c.rules.currentCarrierLane(),a=h.actors[lane],other=h.actors[1-lane];position(other.body,24,3);
        a.condition.consumeEnergy(a.condition.energyTotal*.1);a.body.ultimate.applyNetEnergy(37,1);const energy=a.condition.energyRatio;
        for(let i=0;i<81;i++)h.runtime.update(.1,h.state.RACING);
        assert.ok(a.body.isEntertainmentKnocked);assert.ok(!other.body.isEntertainmentKnocked&&other.body.isRacing);assert.equal(c.recovery.rules.stateForLane(lane).reason,3);
        for(let i=0;i<36;i++)h.runtime.update(.1,h.state.RACING);assert.ok(a.body.isRacing&&a.body.isEntertainmentInvulnerable);assert.equal(a.condition.energyRatio,energy);assert.equal(a.body.ultimate.energy,37);
        assert.deepEqual(h.liveBudget(),budget);assert.equal(h.requests.length,loads);
    }h.runtime.onStateChanged(h.state.FINISHED);const writes=()=>h.nodes.reduce((sum,n)=>sum+n.writes,0),before=writes();
    for(let i=0;i<120;i++){c.presentation.update(1/60,null,null,0,false,false);c.splashes.update(1/60);}assert.equal(writes(),before);h.runtime.dispose();assert.equal(h.layers.size,0);assert.equal(h.liveBudget().materials,0);
});
test('碰撞分离后的真实接触优先转交，查询不修改碰撞或姿态状态',()=>{
    const h=game();let error;h.runtime.prepare(e=>error=e);assert.ifError(error);h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);
    const a=h.actors[0].body,b=h.actors[1].body;position(a,24,0);position(b,24,1);
    h.runtime.update(.01,h.state.RACING);const c=h.runtime.waterBalloon,first=c.rules.currentCarrierLane();
    // 发放冷却里保持相距2.5米，既不贴身也不位于前方短传范围。
    position(a,24,0);position(b,24,2.5);for(let i=0;i<6;i++)h.runtime.update(.1,h.state.RACING);assert.equal(c.rules.currentCarrierLane(),first);
    position(a,24,0);position(b,24,1);const collisions=h.loadModule('entity/SwimmerCollisionResolver');collisions.resolveSwimmerCollisions([a,b]);
    assert.ok(collisions.hasSwimmerCollisionContact(a,b));const state=()=>[a.distance,b.distance,a.node.position.z,b.node.position.z,a.netAxialRollVelocity,b.netAxialRollVelocity];const before=state();
    for(let i=0;i<10;i++)assert.ok(collisions.hasSwimmerCollisionContact(a,b));assert.deepEqual(state(),before);
    // 保持刚发生的接触记录，用分离后位置验证：几何接触已经不成立，仍能消费确认接触。
    position(a,24,0);position(b,24,2);h.runtime.update(.1,h.state.RACING);assert.notEqual(c.rules.currentCarrierLane(),first);h.runtime.dispose();
});
test('短传只向同向前方连续确认，迎面传球要真实接触；瞬移不补传',()=>{
    for(const kind of ['ahead','head-on','teleport']){
        const {rules,racers}=ruleCase(undefined,2);rules.update(.01);const lane=rules.currentCarrierLane(),other=1-lane;
        racers[other].distance=kind==='head-on'?74:kind==='teleport'?30:26.2;racers[other].lateral=0;
        for(let i=0;i<6;i++)rules.update(.1);
        if(kind==='ahead'){for(let i=0;i<3;i++)rules.update(.1);assert.equal(rules.currentCarrierLane(),other);}
        else if(kind==='head-on'){rules.distanceToWorldX=d=>d>50?100-d:d;rules.directionAtDistance=d=>d>50?-1:1;for(let i=0;i<6;i++)rules.update(.1);assert.equal(rules.currentCarrierLane(),lane);}
        else {racers[other].distance=18;rules.update(.1);assert.equal(rules.currentCarrierLane(),lane);}
    }
});
test('爆开使用水球实际中心，水冠仍在水面，潜水与空中不会改用角色根位置',()=>{
    const h=game();let error;h.runtime.prepare(e=>error=e);assert.ifError(error);const p=h.runtime.waterBalloon.presentation,c=h.runtime.waterBalloon;
    for(const height of [-1.5,2.5]){
        const binding=h.racers[0],s=binding.swimmer;s.node.setPosition(2,height,3);
        const arm={roundId:0,carrierLane:0,fuseSeconds:8,revision:1};p.attach(arm,s.node,false);p.update(.1,arm,s.node,4,false,true);
        const center=h.Vec3.transformMat4(new h.Vec3(),new h.Vec3(0,.245,0),p.body.worldMatrix);
        p.showResolution(true,new h.Vec3(2,h.actors[0].body.courseLayout.waterY,3));
        const slot=c.splashes.slots[0];assert.ok(slot.explosionCoreActive);assert.ok(h.Vec3.equals(slot.explosionCore.worldPosition,center));near(slot.root.worldPosition.y,h.actors[0].body.courseLayout.waterY+.035);
        assert.ok(Math.abs(slot.explosionCore.worldPosition.y-slot.root.worldPosition.y)>.1);c.reset();
    }h.runtime.dispose();
});
test('全部12角色在200/400米、30/60Hz完成水球测试，模型数和加载次数稳定',()=>{
    const ids=fixture().load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.map(d=>d.id);
    for(const distance of [200,400])for(const fps of [30,60])for(const group of [ids.slice(0,8),ids.slice(8)]){
        const h=game(42,distance,group);let error;h.runtime.prepare(e=>error=e);assert.ifError(error);h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);
        const budget=h.liveBudget(),loads=h.requests.length,collisions=h.loadModule('entity/SwimmerCollisionResolver');let started=0;
        for(let frame=0;frame<fps*600;frame++){
            for(const f of h.actors)if(f.body.distance<distance)f.step(1/fps);
            collisions.resolveSwimmerCollisions(h.actors.map(f=>f.body));h.runtime.update(1/fps,h.state.RACING);started=Math.max(started,h.runtime.waterBalloon.rules.startedRoundCount());
            if(h.actors.every(f=>f.body.distance>=distance))break;
        }
        assert.ok(started>0);for(const [index,f] of h.actors.entries())assert.ok(f.body.distance>=distance,`${group[index]}/${distance}/${fps}未完赛`);
        assert.deepEqual(h.liveBudget(),budget);assert.equal(h.requests.length,loads);h.runtime.dispose();assert.equal(h.layers.size,0);assert.equal(h.liveBudget().materials,0);
    }
});
test('水球挂点按真实12角色骨架生成，各动作下保持单位世界缩放且不改源骨骼',()=>{
    const {createRig,SWIMMER_MODEL_FILES}=require('./helpers/character-contact-harness.cjs');
    const h=require('./helpers/fixed-mesh-harness.cjs').createFixedMeshHarness(),mounts=h.loadModule('character/TimedWaterBalloonMount');
    assert.equal(Object.keys(mounts.TIMED_WATER_BALLOON_MOUNTS).length,12);
    const rows=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../modelresource/entertainment/timed-water-balloon/mounts.json')));
    for(const file of SWIMMER_MODEL_FILES){
        const rig=createRig(file),row=rows.find(r=>r.id===rig.variant.id),mount=mounts.createTimedWaterBalloonMount(rig.wrapper,rig.variant.id);assert.ok(mount);assert.equal(mount.parent.name,'Spine02');
        const local=rig.wrapper.inverseTransformPoint(new h.Vec3(),mount.getWorldPosition(new h.Vec3()));for(const [i,value] of [local.x,local.y,local.z].entries())near(value,row.local[i]);
        rig.wrapper.setRotationFromEuler(90,90,0);
        for(let phase=0;phase<1;phase+=.1){rig.pose.applyFreestylePose(phase,phase+.5,phase,phase+.5,phase,1,1,1);const scale=mount.getWorldScale(new h.Vec3());near(scale.x,1);near(scale.y,1);near(scale.z,1);assert.ok(Number.isFinite(mount.getWorldPosition(new h.Vec3()).y));}
        rig.pose.applyDivePrepPose();rig.pose.applyDivePrepToStreamlinePose(.5);assert.ok(Number.isFinite(mount.getWorldPosition(new h.Vec3()).y));
        for(const degrees of [0,90,180,270]){rig.wrapper.setRotationFromEuler(degrees,90,0);const scale=mount.getWorldScale(new h.Vec3());near(scale.x,1);near(scale.y,1);near(scale.z,1);}
    }
});
