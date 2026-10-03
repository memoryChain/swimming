const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/cocos-math-harness.cjs');
const {createCombinationHarness}=require('./helpers/entertainment-combination-harness.cjs');
const path=require('node:path');
const fixtures=require('./fixtures/butterfly-grade2-debris.json').fixtures;
const pure=createHarness();
const load=name=>pure.load(path.join(pure.root,'assets/scripts',name+'.ts'));
const {buildEntertainmentLightPlan:plan}=load('entertainment/EntertainmentLightPlan');
const seeds={};for(let seed=0;seed<100;seed++)seeds[plan(seed,200).waterEvent]??=seed;
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const ready=h=>{let done=0,error;h.runtime.prepare(e=>{error=e;done++;});assert.ifError(error);assert.equal(done,1);h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);};

test('二档纯杂物计划的数量、抖动、事件选择与冻结来源逐项相符，海龟使用原有替补',()=>{
    for(const original of fixtures){const p=plan(original.seed,original.distance);
        for(const key of ['supplies','debris','debrisWaveCounts'])assert.deepEqual(Array.from(p[key]),original[key]);
        for(const key of ['suppliesPerWave','debrisPoolSize','waterEventDistance'])assert.equal(p[key],original[key]);
        assert.equal(p.waterEvent,original.originalEvent==='TURTLE_BUS'?'whirlpool':original.originalEvent==='WHIRLPOOL'?'whirlpool':original.originalEvent==='GEYSER'?'geyser':'giant-wave');
        assert.equal(p.debrisPerWave,4);assert.equal(p.debrisWaveCounts[0],2);
    }
    assert.deepEqual(plan(NaN,200),plan(0,200));assert.deepEqual(plan(-1,400),plan(4294967295,400));
});

test('组合只选一个普通水面事件，开局计划不扰动公共随机数或独立调试',()=>{
    const rng=load('core/SharedRNG'),d=load('entertainment/EntertainmentDebugPlan');
    rng.reseedSharedRandom(42);const expected=rng.randomFloat();rng.reseedSharedRandom(42);
    const kinds=new Set();for(let seed=0;seed<300;seed++)for(const distance of [200,400]){
        const p=d.buildEntertainmentDebugPlan('light-mix',distance,seed);
        assert.equal(Number(p.geyser)+Number(p.giantWave)+Number(p.whirlpool),1);
        assert.equal(p.whirlpoolSelection,'normal');kinds.add(p.light.waterEvent);
        assert.ok(p.light.waterEventDistance>=distance*.105&&p.light.waterEventDistance<=distance*.195);
    }
    assert.equal(kinds.size,3);assert.equal(rng.randomFloat(),expected);
    assert.deepEqual(d.buildEntertainmentDebugPlan('supplies-debris',200,42),d.buildEntertainmentDebugPlan('supplies-debris',200,987));
    assert.equal(d.normalizeEntertainmentDebugMode('light-mix'),'light-mix');
    for(const args of [[false,false,false,false,false],[true,true,false,false,false],[true,false,true,false,false],[true,false,false,true,false],[true,false,false,false,true]])assert.equal(d.entertainmentDebugAllowed(...args,'light-mix'),false);
});

test('组合的全部背景与本局水面资源就绪后才放行，比赛和重赛不会再加载',()=>{
    for(const seed of Object.values(seeds)){
        const h=createCombinationHarness(seed),pending=[];let done=0;
        h.setLoadOverride((assetPath,type,callback)=>pending.push({assetPath,callback}));h.runtime.prepare(e=>{assert.ifError(e);done++;});
        const expected=plan(seed,200).waterEvent==='whirlpool'?8:10;
        for(let index=0;index<expected;index++){
            assert.equal(done,0);const p=pending.shift();assert.ok(p);p.callback(null,h.prefabs.get(p.assetPath));
        }
        assert.equal(done,1);assert.equal(pending.length,0);assert.equal(h.requests.length,expected);
        const count=h.requests.length;h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);
        for(let i=0;i<40;i++)h.runtime.update(.1,h.state.RACING);
        h.runtime.onStateChanged(h.state.FINISHED);h.runtime.onStateChanged(h.state.COUNTDOWN);
        assert.equal(h.requests.length,count);h.runtime.dispose();assert.equal(h.layers.size,0);
    }
});

test('组合中途任一资源失败，已经建立的模型池、材质和水层绑定都会释放',()=>{
    for(const seed of Object.values(seeds))for(const failureIndex of [0,3,6,7]){
        const h=createCombinationHarness(seed);let n=0,done=0;
        h.setLoadOverride((assetPath,type,callback)=>n++===failureIndex?callback(new Error('模型加载失败')):callback(null,h.prefabs.get(assetPath)));
        h.runtime.prepare(error=>{assert.ok(error);done++;});
        assert.equal(done,1);assert.equal(h.runtime.disposed,true);assert.equal(h.layers.size,0);
        assert.equal(h.liveBudget().nodes,1);assert.equal(h.liveBudget().materials,0);
        for(const f of h.actors){assert.equal(f.body.motor._entertainment,null);assert.equal(f.body._geyser,null);assert.equal(f.body.motor.hasEntertainmentGiantWave,false);}
        // GLB 共享网格仍由 Bundle 持有。
        assert.ok(h.meshes.slice(0,12).every(m=>m.destroyCount===0));
    }
});

test('组合资源加载期间退出，最后一段的迟到回调不能复活比赛',()=>{
    for(const seed of Object.values(seeds)){
        const h=createCombinationHarness(seed),pending=[];let done=0;
        h.setLoadOverride((assetPath,type,callback)=>pending.push({assetPath,callback}));h.runtime.prepare(error=>{assert.ok(error);done++;});
        for(let i=0;i<7;i++){const p=pending.shift();p.callback(null,h.prefabs.get(p.assetPath));}
        const late=pending.shift(),count=h.requests.length;h.runtime.dispose();assert.equal(done,1);
        const budget=h.liveBudget();late.callback(null,h.prefabs.get(late.assetPath));late.callback(new Error('迟到失败'));
        assert.equal(h.requests.length,count);assert.equal(done,1);assert.deepEqual(h.liveBudget(),budget);assert.equal(h.layers.size,0);
    }
});

test('组合巨浪的单次排期可落在第二泳段，错过首泳段不会丢掉整项；保持原三秒白沫预告',()=>{
    const r=load('entertainment/GiantWaveRules');
    for(const start of [25,70]){
        const sim=new r.GiantWaveSimulation(50,0,50,24,42,'single',44.4,1,400,start);
        sim.update(.1,[{distance:start-1}],false);assert.equal(sim.state.phase,'waiting');
        sim.update(.1,[{distance:start}],false);assert.equal(sim.state.phase,'preview');near(sim.state.timer,3);
        sim.update(3,[],false);assert.equal(sim.state.phase,'active');
        sim.update(100,[],false);sim.update(100,[],false);sim.update(.1,[],false);
        assert.equal(sim.state.phase,'complete');assert.equal(sim.previews,1);assert.equal(sim.cancelled,0);
        sim.reset();sim.update(.1,[{distance:start}],false);assert.equal(sim.previews,1);
    }
});

test('单个轻漩涡使用来源一档力度，在不同泳池长度下避开转身与终点',()=>{
    const {buildLightWhirlpoolSpawn:build}=load('entertainment/WhirlpoolBrawlRules');
    for(const length of [25,50,75])for(const anchor of [24,38,75,170]){
        const spawns=build(42,anchor,200,length);assert.equal(spawns.length,1);const s=spawns[0];
        assert.equal(s.variant,'normal');near(s.radiusScale,.7);near(s.forceScale,.6);
        assert.ok(s.distance%length>=5.64-1e-8);assert.ok(length-s.distance%length>=5.64-1e-8);assert.ok(200-s.distance>=5.64-1e-8);
    }
    assert.equal(build(42,10,200,8).length,0);
});

test('首名完赛取消新增投放，结束和退出清理作用，连续二十次重赛资源数量固定',()=>{
    for(const seed of Object.values(seeds)){
        const h=createCombinationHarness(seed);ready(h);const budget=h.budget(),loadCount=h.requests.length;
        for(let round=0;round<20;round++){
            h.actors[0].body.startRace(0,.8);h.runtime.onStateChanged(h.state.COUNTDOWN);h.runtime.onStateChanged(h.state.RACING);
            h.actors[0].body.motor._distance=70;for(let i=0;i<35;i++)h.runtime.update(.1,h.state.RACING);
            const pending=h.runtime.litter.pendingWaveCount();h.actors[0].body.motor._distance=200;h.runtime.update(.1,h.state.RACING);
            assert.equal(h.runtime.litter.pendingWaveCount(),0);assert.ok(pending>=0);
            h.runtime.onStateChanged(h.state.FINISHED);h.runtime.update(.1,h.state.FINISHED);
            assert.equal(h.actors[0].body.motor._entertainment.drag,0);
            assert.deepEqual(h.budget(),budget);assert.equal(h.requests.length,loadCount);
        }
        h.runtime.dispose();assert.equal(h.layers.size,0);assert.equal(h.liveBudget().nodes,1);assert.equal(h.liveBudget().materials,0);
    }
});

test('组合在全角色、200/400米、30/60Hz下均可完成，水面事件确实启动且不增建资源',()=>{
    const characters=load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.map(d=>d.id);
    for(const seed of Object.values(seeds))for(const distance of [200,400])for(const fps of [30,60])for(const ids of [characters.slice(0,8),characters.slice(8)]){
        const h=createCombinationHarness(seed,distance,ids);ready(h);
        const budget=h.budget();let eventSeen=false;
        for(let i=0;i<fps*600;i++){
            for(const f of h.actors)if(f.body.distance<distance)f.step(1/fps);
            h.runtime.update(1/fps,h.state.RACING);
            eventSeen ||= h.runtime.whirlpoolActive&&h.runtime.whirlpools.length>0||h.runtime.geyser?.elapsedSeconds>0||h.runtime.giantWave?.simulation.previews>0;
            if(h.actors.every(f=>f.body.distance>=distance))break;
        }
        assert.equal(eventSeen,true,`${seed}/${distance}/${fps} 未启动事件`);
        for(const f of h.actors)assert.ok(f.body.distance>=distance,`${f.profile.characterId}/${seed}/${distance}/${fps} 未完赛：${f.body.distance}`);
        assert.deepEqual(h.budget(),budget);h.runtime.dispose();
    }

});


test('组合主事件期间暂停新增杂物；落点避开喷泉和漩涡，隐藏后不写渲染状态',()=>{
    for(const [kind,seed] of Object.entries(seeds)){
        const h=createCombinationHarness(seed);ready(h);
        h.actors[0].body.motor._distance=plan(seed,200).waterEventDistance;h.runtime.update(.1,h.state.RACING);
        assert.equal(h.runtime.waterEventBusy(),true);
        const count=h.runtime.litter.spawnedItemCount();for(let i=0;i<10;i++)h.runtime.update(.1,h.state.RACING);
        assert.equal(h.runtime.litter.spawnedItemCount(),count);
        if(kind==='whirlpool')assert.equal(h.runtime.backgroundRowSafe(h.runtime.whirlpools[0].distance),false);
        if(kind==='geyser')for(const vent of h.runtime.geyser.vents){
            const courseX=(vent.x-h.actors[0].body.courseLayout.startX)/(h.actors[0].body.courseLayout.finishX-h.actors[0].body.courseLayout.startX)*50;
            assert.equal(h.runtime.backgroundRowSafe(courseX),false);
        }
        const budget=h.liveBudget(),writes=h.nodes.reduce((sum,n)=>sum+n.writes,0)+h.materials.reduce((sum,m)=>sum+m.writes,0);
        h.runtime.onStateChanged(h.state.FINISHED);h.runtime.update(.1,h.state.FINISHED);
        const paused=h.nodes.reduce((sum,n)=>sum+n.writes,0)+h.materials.reduce((sum,m)=>sum+m.writes,0);
        for(let i=0;i<60;i++)h.runtime.update(1/60,h.state.FINISHED);
        assert.equal(h.nodes.reduce((sum,n)=>sum+n.writes,0)+h.materials.reduce((sum,m)=>sum+m.writes,0),paused);
        assert.ok(paused>=writes);assert.deepEqual(h.liveBudget(),budget);h.runtime.dispose();
    }
});

test('模型池中途绑定相机层失败也不留下节点或材质',()=>{
    for(const failAt of [5,13]){
        const h=createCombinationHarness(seeds['geyser']);let count=0;
        h.runtime.waterLayers={registerFloatingObject(node){if(++count===failAt)throw new Error('绑定失败');h.layers.add(node);return()=>h.layers.delete(node);}};
        let done=0,error;h.runtime.prepare(e=>{done++;error=e;});
        assert.ok(error);assert.equal(done,1);assert.equal(h.layers.size,0);assert.equal(h.liveBudget().nodes,1);assert.equal(h.liveBudget().materials,0);
    }
});


test('第二种补给模型实例化失败时，第一种已创建模型也归入释放范围',()=>{
    const h=createCombinationHarness(seeds['geyser']);let created=0;
    const instantiate=h.cc.instantiate;
    h.cc.instantiate=prefab=>{if(++created===2)throw new Error('第二个模型实例化失败');return instantiate(prefab);};
    let error,done=0;h.runtime.prepare(e=>{error=e;done++;});
    assert.ok(error);assert.equal(done,1);assert.equal(h.layers.size,0);assert.equal(h.liveBudget().nodes,1);assert.equal(h.liveBudget().materials,0);
});
