const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createHarness}=require('./helpers/cocos-math-harness.cjs');
const {createBuoyHarness}=require('./helpers/spray-buoy-harness.cjs');
const fixture=()=>{const h=createHarness();return {...h,load:n=>h.load(path.join(h.root,'assets/scripts',n+'.ts'))};};
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('浮标仅在本地AI娱乐入口开启，不加入组合、云端或联机候选',()=>{
    const h=fixture(),p=h.load('entertainment/EntertainmentDebugPlan');assert.equal(p.normalizeEntertainmentDebugMode('spray-buoy'),'spray-buoy');
    const plan=p.buildEntertainmentDebugPlan('spray-buoy',200,42);assert.ok(plan.sprayBuoy&&!plan.light&&!plan.geyser&&!plan.giantWave&&!plan.whirlpool&&!plan.supplies.length&&!plan.debris.length);
    for(const args of [[false,false,false,false,false],[true,true,false,false,false],[true,false,true,false,false],[true,false,false,true,false],[true,false,false,false,true]])assert.equal(p.entertainmentDebugAllowed(...args,'spray-buoy'),false);
    assert.equal(p.buildEntertainmentDebugPlan('light-mix',200,42).sprayBuoy,false);
});

test('浮标漂移可复现，适配泳段长度且不消耗主干公共随机数',()=>{
    const h=fixture(),{SprayBuoyController:C}=h.load('entertainment/SprayBuoyController'),{GameState}=h.load('core/GameConstants'),rng=h.load('core/SharedRNG');
    rng.reseedSharedRandom(42);const expected=rng.randomFloat();rng.reseedSharedRandom(42);
    for(const length of [25,50,75])for(const seed of [42,6,20260913]){
        const a=new C(2,seed,24,()=>null,()=>{},7,[65,130],undefined,length),b=new C(2,seed,24,()=>null,()=>{},7,[65,130],undefined,length);
        const initial=JSON.stringify(a.mines());for(let i=0;i<200;i++){a.update(.05,GameState.RACING);b.update(.05,GameState.RACING);}
        assert.deepEqual(a.mines(),b.mines());assert.equal(a.mines().length,7);assert.ok(a.mines().every(m=>m.courseX>=2.5&&m.courseX<=length-2.5));a.reset();assert.equal(JSON.stringify(a.mines()),initial);
    }assert.equal(rng.randomFloat(),expected);
});

test('出生覆盖选手时隐藏且无碰撞，连续清空0.45秒后才可触发',()=>{
    const h=fixture(),{SprayBuoyController:C}=h.load('entertainment/SprayBuoyController'),{GameState}=h.load('core/GameConstants');
    const racer={active:true,finished:false,distance:20,lateral:0};let impacts=0;
    const c=new C(1,42,24,()=>racer,()=>impacts++,1,[],[{courseX:20,lateral:0}]);assert.equal(c.mines()[0].armed,false);
    for(let i=0;i<30;i++)c.update(.1,GameState.RACING);assert.equal(impacts,0);assert.equal(c.mines()[0].armed,false);
    racer.distance=0;for(let i=0;i<4;i++)c.update(.1,GameState.RACING);assert.equal(c.mines()[0].armed,false);c.update(.1,GameState.RACING);assert.equal(c.mines()[0].armed,true);
});

test('一个浮标只触发一次，高速穿过仍命中，附近选手按范围区分',()=>{
    const h=fixture(),{SprayBuoyController:C}=h.load('entertainment/SprayBuoyController'),{GameState}=h.load('core/GameConstants');
    const racers=[{active:true,finished:false,distance:0,lateral:0},{active:true,finished:false,distance:20,lateral:1.5},{active:true,finished:false,distance:20,lateral:4}];const events=[];
    const c=new C(3,42,24,l=>racers[l],e=>events.push(e),1,[],[{courseX:20,lateral:0}]);racers[1].active=false;racers[2].active=false;
    c.reset();racers[0].distance=18;c.update(.01,GameState.RACING);racers[1].active=racers[2].active=true;racers[0].distance=22;c.update(.01,GameState.RACING);
    assert.equal(events.length,1);assert.equal(events[0].hitLane,0);assert.equal(events[0].hitMask,3);assert.equal(c.mines()[0].active,false);
    for(let i=0;i<20;i++)c.update(.05,GameState.RACING);assert.equal(events.length,1);
});

test('转向折返及非连续运动不把跨池路径当碰撞',()=>{
    const h=fixture(),{SprayBuoyController:C}=h.load('entertainment/SprayBuoyController'),{GameState}=h.load('core/GameConstants');
    const r={active:true,finished:false,distance:0,lateral:0};let count=0;const c=new C(1,42,24,()=>r,()=>count++,1,[],[{courseX:20,lateral:0}],25);
    r.distance=17;c.update(.01,GameState.RACING);r.active=false;r.distance=20;c.update(.01,GameState.RACING);r.active=true;r.distance=24;c.update(.01,GameState.RACING);assert.equal(count,0);
    r.distance=27;c.update(.01,GameState.RACING);assert.equal(count,0);r.distance=31;c.update(.01,GameState.RACING);assert.equal(count,1,'反向经过浮标也要触发');
});

test('共用恢复阻止重复击倒，3.5秒后回到同一进度，2秒保护结束后才能再次命中',()=>{
    const h=fixture(),{EntertainmentRecoveryController:C,EntertainmentRecoveryPhase:P}=h.load('entertainment/EntertainmentRecoveryController');const calls=[];
    const c=new C(2,{onKnocked:(l,s)=>calls.push(['倒',l,s.distance]),onRespawn:(l,s)=>calls.push(['回',l,s.distance]),onRecovered:l=>calls.push(['好',l])});
    assert.ok(c.tryKnockDown(0,4,54.25));assert.equal(c.tryKnockDown(0,4,55),null);c.update(3.4);assert.equal(c.stateForLane(0).phase,P.KNOCKED);
    c.update(.2);assert.equal(c.stateForLane(0).phase,P.INVULNERABLE);near(c.stateForLane(0).remainingSeconds,1.9);assert.equal(c.tryKnockDown(0,4,55),null);
    c.update(1.9+1e-10);assert.ok(c.isDamageable(0));assert.deepEqual(calls,[['倒',0,54.25],['回',0,54.25],['好',0]]);
    c.tryKnockDown(1,4,35);c.retireLane(1);c.update(10);assert.equal(c.isDamageable(1),false);assert.ok(!calls.some(e=>e[0]==='回'&&e[1]===1));
});

test('全部模型加载完成才放行，8个加载点失败均清理，退出后的回调无效',()=>{
    for(let fail=-1;fail<8;fail++){
        const h=createBuoyHarness(),pending=[];let done=0,at=0;h.setLoadOverride((p,t,cb)=>pending.push({p,cb}));h.runtime.prepare(e=>{assert.equal(!!e,fail>=0);done++;});
        while(pending.length){assert.equal(done,0);const {p,cb}=pending.shift();cb(at++===fail?new Error('资源失败'):null,h.prefabs.get(p));}
        assert.equal(done,1);if(fail>=0){assert.equal(h.runtime.disposed,true);assert.equal(h.liveBudget().nodes,3);assert.equal(h.layers.size,0);}else {assert.equal(h.requests.length,8);h.runtime.dispose();assert.equal(h.layers.size,0);}
        assert.ok(h.meshes.every(m=>m.destroyCount===0));
    }
    const h=createBuoyHarness(),pending=[];let done=0;h.setLoadOverride((p,t,cb)=>pending.push({p,cb}));h.runtime.prepare(e=>{assert.ok(e);done++;});const late=pending.pop();h.runtime.dispose();late.cb(null,h.prefabs.get(late.p));assert.equal(done,1);assert.equal(h.layers.size,0);
});

test('直接命中暂停真实Motor并恢复，周围人继续游；重赛20轮不新增模型或加载',()=>{
    const h=createBuoyHarness();h.runtime.prepare(assert.ifError);h.runtime.onStateChanged(h.state.RACING);const c=h.runtime.sprayBuoy,initial=h.liveBudget(),loads=h.requests.length;
    for(let round=0;round<20;round++){
        if(round){for(const actor of h.actors){actor.body.startRace(0,.8);actor.ai.startSwimming();}h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);}
        const m=c.rules.mines()[0],a=h.actors[0].body,b=h.actors[1].body;
        a.motor.setFlipTurnDistance(m.courseX);a.motor.setLateralOffset(m.lateral-a.startPosition.z);a.node.setPosition(a.courseLayout.distanceToWorldX(a.distance),a.courseLayout.swimY,m.lateral);
        b.motor.setFlipTurnDistance(m.courseX);b.motor.setLateralOffset(m.lateral+1.5-b.startPosition.z);b.node.setPosition(a.node.position.x,a.node.position.y,m.lateral+1.5);
        h.actors[0].condition.consumeEnergy(h.actors[0].condition.energyTotal*.2);a.ultimate.applyNetEnergy(37,1);
        const energy=h.actors[0].condition.energyRatio,charge=a.ultimate.energy;assert.ok(energy<1);assert.ok(charge>0);
        h.runtime.update(.01,h.state.RACING);assert.equal(a.isEntertainmentKnocked,true);assert.equal(a.isRacing,false);assert.equal(b.isEntertainmentKnocked,false);assert.equal(b.isRacing,true);
        const distance=a.distance;a.handleStrokeHeld(0,true);a.stepSimulation(.1);assert.equal(a.distance,distance);
        for(let i=0;i<35;i++)h.runtime.update(.1,h.state.RACING);
        assert.equal(a.isEntertainmentKnocked,false);assert.equal(a.isRacing,true);assert.equal(a.isEntertainmentInvulnerable,true);near(a.distance,distance);near(a.node.position.z,h.loadModule('venue/LaneLayout').laneCenterZ(0,a.courseLayout));
        assert.equal(h.actors[0].condition.energyRatio,energy);assert.equal(a.ultimate.energy,charge);
        for(let i=0;i<21;i++)h.runtime.update(.1,h.state.RACING);assert.equal(a.isEntertainmentInvulnerable,false);
        assert.deepEqual(h.liveBudget(),initial);assert.equal(h.requests.length,loads);h.runtime.onStateChanged(h.state.FINISHED);
    }h.runtime.dispose();assert.equal(h.layers.size,0);assert.equal(h.liveBudget().materials,0);
});

test('恢复期间离场或完赛不会被重新激活，取消恢复后浮圈隐藏',()=>{
    for(const end of ['eliminate','finish','dispose']){
        const h=createBuoyHarness();h.runtime.prepare(assert.ifError);const c=h.runtime.sprayBuoy,a=h.actors[0].body;c.recovery.tryKnockDown(0,4,10);
        if(end==='eliminate')a.eliminate();else if(end==='finish')a.motor.setFlipTurnDistance(200);else h.runtime.dispose();
        if(end!=='dispose'){for(let i=0;i<60;i++)h.runtime.update(.1,h.state.RACING);assert.equal(a.isRacing,false);}assert.equal(a.isEntertainmentKnocked,false);
        h.runtime.dispose();assert.equal(h.layers.size,0);
    }
});

test('喷水池和浮标隐藏后不写渲染状态，不生成运行时网格',()=>{
    const h=createBuoyHarness();h.runtime.prepare(assert.ifError);const c=h.runtime.sprayBuoy;c.hide();const writes=()=>h.nodes.reduce((n,p)=>n+p.writes,0);const before=writes();
    for(let i=0;i<120;i++){c.splashes.update(1/60);c.presentation.update(1/60,c.rules.mines(),false);}const after=writes();
    for(let i=0;i<120;i++){c.splashes.update(1/60);c.presentation.update(1/60,c.rules.mines(),false);}assert.equal(writes(),after);assert.ok(after>=before);
    h.runtime.dispose();assert.equal(h.liveBudget().materials,0);
});


test('模型池中途绑定或实例化失败也不留下节点、材质或回调',()=>{
    for(const failAt of [1,3,6,8,12,13,14,15]){
        const h=createBuoyHarness();let count=0;
        h.runtime.waterLayers={registerFloatingObject(node){if(++count===failAt)throw new Error('绑定失败');h.layers.add(node);return()=>h.layers.delete(node);}};
        let done=0,error;h.runtime.prepare(e=>{done++;error=e;});
        assert.ok(error,`第${failAt}个绑定没有触发故障`);assert.equal(done,1);assert.equal(h.layers.size,0);assert.equal(h.liveBudget().nodes,3);assert.equal(h.liveBudget().materials,0);
        for(const a of h.actors)assert.equal(a.body.cartoonRig.onEntertainmentRecoveryFloat,null);
        assert.ok(h.meshes.every(m=>m.destroyCount===0));
    }
    for(const failAt of [1,4,7]){
        const h=createBuoyHarness(),instantiate=h.cc.instantiate;let n=0,error,done=0;
        h.cc.instantiate=prefab=>{if(++n===failAt)throw new Error('实例化失败');return instantiate(prefab);};
        h.runtime.prepare(e=>{error=e;done++;});assert.ok(error);assert.equal(done,1);assert.equal(h.layers.size,0);assert.equal(h.liveBudget().nodes,3);assert.equal(h.liveBudget().materials,0);
    }
});

test('喷雾浮标在全角色、200/400米、30/60Hz下可完赛且不增建资源',()=>{
    const h0=fixture(),ids=h0.load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.map(d=>d.id);
    for(const distance of [200,400])for(const fps of [30,60])for(const group of [ids.slice(0,8),ids.slice(8)]){
        const h=createBuoyHarness(42,distance,group);h.runtime.prepare(assert.ifError);h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);
        const budget=h.liveBudget(),requests=h.requests.length;let hitSeen=false;
        // 开局使一人真实接触浮标，后续完全由主干 AI/运动推进，验证恢复后能继续。
        const m=h.runtime.sprayBuoy.rules.mines()[0],a=h.actors[0].body;
        a.motor.setFlipTurnDistance(m.courseX);a.motor.setLateralOffset(m.lateral-a.startPosition.z);a.node.setPosition(a.courseLayout.distanceToWorldX(a.distance),a.courseLayout.swimY,m.lateral);
        for(let i=0;i<fps*600;i++){
            h.runtime.update(1/fps,h.state.RACING);hitSeen ||= a.isEntertainmentKnocked;
            for(const actor of h.actors)if(actor.body.distance<distance)actor.step(1/fps);
            if(h.actors.every(actor=>actor.body.distance>=distance))break;
        }
        assert.equal(hitSeen,true);
        for(const actor of h.actors)assert.ok(actor.body.distance>=distance,`${actor.profile.characterId}/${distance}/${fps}未完赛：${actor.body.distance}`);
        assert.deepEqual(h.liveBudget(),budget);assert.equal(h.requests.length,requests);h.runtime.dispose();assert.equal(h.layers.size,0);
    }
});


test('浮标实际底座在完整漂浮周期穿过水线，气球原转轴未丢失',()=>{
    const h=createBuoyHarness();h.runtime.prepare(assert.ifError);const c=h.runtime.sprayBuoy,point=new h.Vec3();
    for(let tick=0;tick<1200;tick++){
        c.presentation.update(.05,c.rules.mines(),true);
        for(const root of c.presentation.mineNodes){
            const model=root.children[0],body=model.children.find(n=>n.name==='BuoyBody'),balloon=model.children.find(n=>n.name==='BuoyBalloon');
            assert.ok(body&&balloon);near(balloon.position.x,-.32,1e-6);near(balloon.position.y,.195,1e-6);near(balloon.position.z,.05,1e-6);
            if(tick<30)continue;const positions=body.components[0].mesh.geometry.positions;let min=Infinity,max=-Infinity;
            for(let i=0;i<positions.length;i+=3){point.set(positions[i],positions[i+1],positions[i+2]);h.Vec3.transformMat4(point,point,body.worldMatrix);const height=point.y-h.actors[0].body.courseLayout.waterY;min=Math.min(min,height);max=Math.max(max,height);}
            assert.ok(min<-.005&&max>.005,`${root.name}第${tick}次采样离开水线：${min}/${max}`);
            assert.equal(body.components[0].material.name,'RuntimeEntertainmentWaterline');assert.equal(balloon.components[0].material.name,'RuntimeEntertainmentWaterline');
        }
    }h.runtime.dispose();
});


test('7个浮标原始布局、10秒漂移及65/130米空槽补充与冻结来源一致',()=>{
    const fixtures=require('./fixtures/butterfly-spray-buoy.json').fixtures;
    const h=fixture(),{SprayBuoyController:C}=h.load('entertainment/SprayBuoyController'),{GameState}=h.load('core/GameConstants');
    for(const f of fixtures){
        const c=new C(8,f.seed,f.poolWidth,()=>null,()=>{},7,[65,130]);
        for(const stage of f.stages){
            if(stage.action==='10seconds')for(let i=0;i<200;i++)c.update(.05,GameState.RACING);
            if(stage.action==='refill'){assert.equal(c.applyImpact(stage.event),true);c.update(.05,GameState.RACING,stage.leader);}
            const actual=JSON.parse(JSON.stringify(c.mines()));assert.equal(actual.length,stage.mines.length);
            for(let i=0;i<actual.length;i++){const a=actual[i],b=stage.mines[i];for(const key of ['id','generation','active','armed'])assert.equal(a[key],b[key]);near(a.courseX,b.courseX);near(a.lateral,b.lateral);}
        }
    }
});

test('恢复调参可保存重载，旧配置保留原版默认恢复时长',()=>{
    // 复用真实主干调参模块，只替代本地存储。
    const math=createHarness({'cc/env':{NATIVE:false}}),saved=new Map();
    Object.assign(math.cc,{JsonAsset:class {},native:{},Color:class {},sys:{localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)}},resources:{load:(p,t,cb)=>cb(null,{json:require('../assets/resources/config/tuning.json')})}});
    const load=n=>math.load(path.join(math.root,'assets/scripts',n+'.ts')),tuning=load('core/TuningDebugControls');tuning.loadSavedTuningAsync(()=>{});
    const controls=new Map(tuning.TUNING_GROUPS.flatMap(g=>g.controls.map(c=>[c.id,c]))),b=load('core/EntertainmentBalance');near(b.ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds,3.5);
    controls.get('entertainment.recovery.knockedSeconds').set(4.1);controls.get('entertainment.recovery.invulnerableSeconds').set(1.4);assert.equal(tuning.saveCurrentTuning().ok,true);
    controls.get('entertainment.recovery.knockedSeconds').set(3.5);controls.get('entertainment.recovery.invulnerableSeconds').set(2);tuning.loadSavedTuningAsync(()=>{});
    near(b.ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds,4.1);near(b.ENTERTAINMENT_RECOVERY_TUNING.invulnerableSeconds,1.4);
});
