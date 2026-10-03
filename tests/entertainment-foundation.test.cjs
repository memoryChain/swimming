const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
function fixture(externals = {}) {
    const h = createHarness(externals);
    return { ...h, load: name => h.load(path.join(h.root, 'assets/scripts', name + '.ts')) };
}
const near = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('普通赛、房间、联机、教学和 Boss 在配置娱乐资源前返回，关闭时无选手查询', () => {
    const h = fixture(), plan = h.load('entertainment/EntertainmentDebugPlan');
    const { getAiDebugSetup, setAiDebugSetup } = h.load('core/GameLaunchOptions');
    setAiDebugSetup({ ...getAiDebugSetup(), entertainment: '未知值' });
    assert.equal(getAiDebugSetup().entertainment, 'none');
    const compilerPath = process.env.TYPESCRIPT_PATH || process.env.PATH.split(path.delimiter)
        .map(dir => path.resolve(dir, '../typescript/lib/typescript.js')).find(file => fs.existsSync(file));
    const ts = require(compilerPath || 'typescript');
    const file = path.join(h.root, 'assets/scripts/core/GameManager.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const method = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'GameManager')
        .members.find(n => n.name?.getText(source) === 'setupEntertainmentDebug');
    for (const state of [ {}, {_aiDebugMode:true,_roomMode:true}, {_aiDebugMode:true,_netSession:{}},
        {_aiDebugMode:true,_tutorialMode:true}, {_aiDebugMode:true,boss:true}, {_aiDebugMode:true,mode:'none'} ]) {
        let constructed = 0, queries = 0, completed = 0;
        const Owner = vm.runInNewContext(ts.transpileModule(`class Owner { ${method.getText(source)} }; Owner`,
            { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText,
            { entertainmentDebugAllowed: plan.entertainmentDebugAllowed,
                getAiDebugSetup: () => ({ entertainment: state.mode ?? 'supplies', bossId: state.boss ? 'boss' : null }),
                findBossPreset: id => id ? {} : null,
                COURSE_LAYOUT: { laneCount: 8 }, EntertainmentRaceRuntime: class { constructor() { constructed++; } } });
        const owner = Object.assign(new Owner(), state);
        owner.swimmerForLane = () => { queries++; };
        owner.setupEntertainmentDebug(() => completed++);
        assert.equal(completed, 1); assert.equal(queries, 0); assert.equal(constructed, 0);
    }
    const boss = h.load('competitor/BossAiConfig').BOSS_AI_PRESETS[0];
    setAiDebugSetup({ ...getAiDebugSetup(), entertainment: 'supplies-debris', bossId: boss.id });
    assert.equal(getAiDebugSetup().entertainment, 'none');
});

test('固定事件计划与补给随机子流可复现，安全波次不会撞折返墙', () => {
    const h = fixture(), { buildGradedStimulantSchedule } = h.load('entertainment/StimulantBrawlRules');
    const { buildEntertainmentDebugPlan } = h.load('entertainment/EntertainmentDebugPlan');
    const { randomFloat, reseedSharedRandom } = h.load('core/SharedRNG');
    for (const distance of [200, 400]) {
        const plan = buildEntertainmentDebugPlan('supplies-debris', distance);
        const a = buildGradedStimulantSchedule(42, 8, distance, 50, plan.supplies, 3);
        assert.deepEqual(a, buildGradedStimulantSchedule(42, 8, distance, 50, plan.supplies, 3));
        assert.notDeepEqual(a, buildGradedStimulantSchedule(12345, 8, distance, 50, plan.supplies, 3));
        for (const item of a) assert.ok(Math.min(item.distance % 50, 50 - item.distance % 50) >= 4);
        assert.ok(a.length <= 15);
        assert.ok(a.some(i => i.kind === 'calm-slush') && a.some(i => i.kind === 'heartbeat-soda'));
    }
    reseedSharedRandom(42); const expected = randomFloat(); reseedSharedRandom(42);
    buildGradedStimulantSchedule(99, 8, 200, 50, [35, 85, 135], 3);
    assert.equal(randomFloat(), expected);
});

test('玩家与 AI 按各自体力上限恢复，耗尽倍率立即解除，异常参数不能突破上限', () => {
    const h = fixture();
    for (const name of ['PlayerConditionModel', 'AiConditionModel']) {
        const Model = h.load('condition/' + name)[name], m = new Model();
        if (name === 'PlayerConditionModel') m.setProgressionOverrides({ energyTotal: 140 });
        else m.configureEnergyTotal(140);
        m.reset(); m.consumeEnergy(140);
        assert.equal(m.energyDepleted, true);
        near(m.restoreEnergyRatio(.3), 42); near(m.energyRatio, .3);
        assert.equal(m.energyDepleted, false); near(m.efficiencyModifier, 1);
        for (const bad of [NaN, Infinity, -1]) assert.equal(m.restoreEnergyRatio(bad), 0);
        m.restoreEnergyRatio(10); near(m.energyRatio, 1);
        m.setInfiniteStamina(true); assert.equal(m.restoreEnergyRatio(.3), 0);
    }
});

test('苏打恢复锁定允许心率上升，大帧跨锁定与采样过期一致；冰沙降温会清除锁定', () => {
    const h = fixture(), { StrokeHeartRateModel } = h.load('condition/StrokeHeartRateModel');
    const a = new StrokeHeartRateModel(), b = new StrokeHeartRateModel();
    for (const m of [a, b]) { m.recordStart(); m.addBurden(40, 4); }
    a.tick(6); for (let i = 0; i < 720; i++) b.tick(1/120);
    near(a.heartRate, b.heartRate);
    const c = new StrokeHeartRateModel(); c.addBurden(40,4); c.tick(3); near(c.heartRate,120);
    c.applyCooling(60); near(c.heartRate,80); c.addBurden(40); c.tick(1); assert.ok(c.heartRate < 120);
    c.addBurden(40,4); c.reset(); near(c.heartRate,80); near(c.strokeRate,0);
    const rising = new StrokeHeartRateModel(); for(let i=0;i<8;i++) rising.recordStart();
    rising.addBurden(40,4); rising.tick(1); assert.ok(rising.heartRate > 120);
});

test('冰沙持续时间不随帧率变化，正常物理输入与显式中性输入完全一致', () => {
    const h = fixture(), { EntertainmentSwimmerEffects } = h.load('entertainment/EntertainmentSwimmerEffects');
    const { StrokeHeartRateModel } = h.load('condition/StrokeHeartRateModel');
    for(const fps of [10,30,60,120]) {
        const e = new EntertainmentSwimmerEffects(), hr = new StrokeHeartRateModel(); e.applySupply('calm-slush',hr);
        let lost = 0; for(let i=0;i<fps*5;i++) { e.tick(1/fps); lost += (1-e.propulsionScale)/fps; }
        near(lost,.3); e.reset(); near(e.propulsionScale,1); near(e.drag,0);
    }
    const { SwimPhysicsModel } = h.load('swimmer/SwimPhysicsModel'), p = new SwimPhysicsModel();
    let a = { currentSpeed:2,distance:5 }, b = { ...a };
    for(let i=0;i<600;i++) {
        const input = { dt:1/60,strokeAcceleration:.8,kickAcceleration:.2,speedCapBonus:0,glideDrag:0 };
        a = p.step(a,input); b = p.step(b,{...input,environmentDrag:0,propulsionScale:1});
        assert.deepEqual(a,b);
    }
    assert.ok(p.step(a,{dt:.1,strokeAcceleration:0,kickAcceleration:0,speedCapBonus:0,environmentDrag:.78}).currentSpeed
        < p.step(a,{dt:.1,strokeAcceleration:0,kickAcceleration:0,speedCapBonus:0}).currentSpeed);
});

function supplyFixture(schedule = [{ id:0,wave:1,distance:20,laneIndex:0,lateralOffset:0,kind:'heartbeat-soda' }], racers) {
    const h = fixture(), { SupplyRaceController } = h.load('entertainment/SupplyRaceController');
    const states = racers ?? [{ active:true,canContact:true,finished:false,distance:14,lateral:0,heading:0 }];
    const pickups = []; const controller = new SupplyRaceController(schedule,[0],50,states,(index,kind)=>pickups.push({index,kind}));
    return { controller,states,pickups };
}

test('补给落水由逻辑计时决定；同帧争抢只授予一次，重赛复用固定池', () => {
    const racers = Array.from({length:2},()=>({active:true,canContact:true,finished:false,distance:14,lateral:0,heading:0}));
    const {controller,states,pickups} = supplyFixture(undefined,racers);
    const slotArray = controller.slots, firstSlot = slotArray[0];
    for(let round=0;round<20;round++) {
        controller.reset(); for(const s of states)s.distance=14;
        controller.update(.01); for(const s of states)s.distance=20;
        controller.update(.5); assert.equal(pickups.length,round);
        controller.update(.7); assert.equal(pickups.length,round+1);
        controller.update(1); assert.equal(pickups.length,round+1);
        assert.equal(controller.slots,slotArray); assert.equal(controller.slots[0],firstSlot);
        assert.equal(controller.slots.length,6);
    }
});

test('低帧率越过补给仍拾取；折返后公共物品可拾取，空中与结束选手不拾取', () => {
    for(const direction of [1,-1]) {
        const {controller,states,pickups}=supplyFixture(); controller.update(.01); controller.update(1.2);
        states[0].distance=direction===1?17.6:77.6; controller.update(.1);
        states[0].distance=direction===1?22.4:82.4; controller.update(.5);
        assert.equal(pickups.length,1);
    }
    const {controller,states,pickups}=supplyFixture(); controller.update(.01); controller.update(1.2);
    states[0].distance=20; states[0].canContact=false; controller.update(.1); assert.equal(pickups.length,0);
    states[0].canContact=true; states[0].finished=true; controller.update(.1); assert.equal(pickups.length,0);
    states[0].finished=false; controller.update(.1); assert.equal(pickups.length,1);
});

test('补给池满、过期、取消投放和 AI 取舍保持有界', () => {
    const schedule=Array.from({length:20},(_,id)=>({id,wave:1,distance:20,laneIndex:0,lateralOffset:id*.1,kind:'heartbeat-soda'}));
    const {controller,states}=supplyFixture(schedule); controller.update(.01);
    assert.equal(controller.slots.filter(s=>s.active).length,6);
    states[0].distance=17;
    assert.notEqual(controller.targetZForAi(0,.2,100),null);
    assert.equal(controller.targetZForAi(0,.2,170),null);
    assert.equal(controller.targetZForAi(0,1,100),null);
    controller.update(15); assert.equal(controller.slots.filter(s=>s.active).length,0);
    controller.reset();controller.cancelPending();controller.update(1);assert.equal(controller.slots.filter(s=>s.active).length,0);
});

test('杂物重复重赛保持池上限，取消剩余波次后旧物品正常退休，支持标定单程长度', () => {
    const h=fixture(), {LitterBrawlController}=h.load('entertainment/LitterBrawlController'), {GameState}=h.load('core/GameConstants');
    const racer={active:true,finished:false,distance:20,lateral:0};
    const c=new LitterBrawlController(1,42,21,()=>racer,{schedule:{waveDistances:[18,68,118],landingLeadDistance:7},
        intensity:{itemsPerWave:3,poolSize:6},minimumWaveIntervalSeconds:8,maxWaveDelayDistance:12,courseLength:25});
    const slots=c.clusters();
    for(let round=0;round<20;round++) {
        c.reset();racer.distance=20;c.update(.01,GameState.RACING);
        assert.ok(c.activeCount()<=6);assert.equal(c.clusters(),slots);
        for(const slot of slots)if(slot.active)assert.ok(slot.courseX<=25);
        c.cancelPendingWaves();assert.equal(c.pendingWaveCount(),0);
        for(let t=0;t<40;t++)c.update(1,GameState.RACING);
        assert.equal(c.activeCount(),0);
    }
});

function runtimeFixture(deferred=false, lanes=1) {
    const pending=[], counts={built:0,destroyed:0,presentationUpdates:0};
    class Presentation { constructor(){counts.built++;} reset(){} update(){counts.presentationUpdates++;} dispose(){counts.destroyed++;} }
    const h=fixture({ '../core/RaceBundleLoader':{loadRaceAsset(_path,_type,done){if(deferred)pending.push(done);else done(null,{});}},
        '../entertainment/SupplyRacePresentation':{SupplyRacePresentation:Presentation},
        '../entertainment/LitterBrawlPresentation':{LitterBrawlPresentation:Presentation} });
    h.cc.Prefab=class{};
    const {EntertainmentRaceRuntime}=h.load('app/EntertainmentRaceRuntime'),{GameState}=h.load('core/GameConstants');
    const {PlayerConditionModel}=h.load('condition/PlayerConditionModel'),{SwimmerMotor}=h.load('swimmer/SwimmerMotor');
    const motor=new SwimmerMotor();motor.startRace();
    let route='unchanged';const condition=new PlayerConditionModel();
    const swimmer={node:{isValid:true,active:true,position:{z:0}},motor,distance:0,isCollisionActive:true,movementHeading:0,
        get heartRate(){return motor.heartRate;},applyConditionSpeedScale(v){motor.setConditionSpeedScale(v);},
        applyConditionCadenceScale(v){motor.setConditionCadenceScale(v);},applyCollisionImpulse(){}};
    const runtime=new EntertainmentRaceRuntime({isValid:true},{laneCount:lanes,laneWidth:2.5,poolWidth:lanes*2.5,courseLength:50},
        'supplies-debris',42,200,[{lane:0,swimmer,condition,ai:{setEntertainmentTargetZ(v){route=v;}}}]);
    return {runtime,counts,pending,motor,swimmer,GameState,getRoute:()=>route};
}

test('娱乐生命周期重复重赛不重建表现，结束清除阻力和路线，退出可重复且迟到加载不建节点', () => {
    const f=runtimeFixture();let ready=0;f.runtime.prepare(error=>{assert.ifError(error);ready++;});assert.equal(ready,1);
    for(let round=0;round<20;round++) {
        f.runtime.onStateChanged(f.GameState.COUNTDOWN);f.swimmer.distance=14;
        f.runtime.update(.1,f.GameState.RACING);f.runtime.onStateChanged(f.GameState.FINISHED);
        assert.equal(f.getRoute(),null);near(f.motor._entertainment.drag,0);assert.equal(f.counts.built,2);
    }
    f.runtime.dispose();f.runtime.dispose();assert.equal(f.counts.destroyed,2);assert.equal(f.motor._entertainment,null);
    const d=runtimeFixture(true);let canceled=0;d.runtime.prepare(e=>{assert.ok(e);canceled++;});
    d.runtime.dispose();d.pending[0](null,{});assert.equal(canceled,1);assert.equal(d.counts.built,1);assert.equal(d.counts.destroyed,1);
});

test('仅杂物模式不启用补给的转向倍率；转身和海豚跳期间效果仍按比赛时间过期', () => {
    const h=fixture(),{SwimmerMotor}=h.load('swimmer/SwimmerMotor');
    const m=new SwimmerMotor();m.startRace();m.configureEntertainment(true,false);
    near(m._entertainment.turnImpulseScale(180),1);near(m._entertainment.turnDragScale(180),1);
    m.applyEntertainmentSupply('heartbeat-soda');near(m.heartRate,80);
    m.configureEntertainment(true,true);m.applyEntertainmentSupply('calm-slush');
    m.tickRestingHeartRate(4,true);m.update(.1,{isAI:false});near(m._physicsInput.propulsionScale,1);
    m.setEntertainmentDrag(.78);m.configureEntertainment(false);m.update(.1,{isAI:false});near(m._physicsInput.environmentDrag,0);
});

test('补给表现使用真实模块，20次重赛不创建额外模型，隐藏时不更新变换', () => {
    let created=0,destroyed=0,writes=0;
    class Node {
        constructor(){created++;this.children=[];this.isValid=true;this.active=true;}
        setParent(parent){parent.children.push(this);}
        setScale(){} setWorldPosition(){writes++;} setRotationFromEuler(){writes++;}
        destroy(){if(!this.isValid)return;this.isValid=false;destroyed++;for(const n of this.children)n.destroy();}
    }
    const h=fixture();Object.assign(h.cc,{Node,instantiate:()=>new Node()});
    const {SupplyRacePresentation}=h.load('entertainment/SupplyRacePresentation');
    const p=new SupplyRacePresentation({children:[],layer:1},{waterY:0,poolWidth:21,distanceToWorldX:v=>v},6,{},{});
    const slots=Array.from({length:6},(_,id)=>({id,active:true,kind:'heartbeat-soda',age:2,courseX:20,lateral:id}));
    for(let round=0;round<20;round++){
        p.reset();for(let i=0;i<60;i++)p.update(1/60,slots,true);
        for(const slot of slots)slot.kind=slot.kind==='heartbeat-soda'?'calm-slush':'heartbeat-soda';
        const before=writes;for(let i=0;i<60;i++)p.update(1/60,slots,false);assert.equal(writes,before);
        assert.equal(created,18);
    }
    p.dispose();p.dispose();assert.equal(destroyed,18);
});

test('任一补给模型加载失败立即清理固定池和 Motor 配置，回调只完成一次', () => {
    const d=runtimeFixture(true);let failed=0;
    d.runtime.prepare(e=>{assert.ok(e);failed++;});d.pending[0](new Error('模型缺失'));
    assert.equal(failed,1);assert.equal(d.counts.destroyed,1);assert.equal(d.motor._entertainment,null);
    d.runtime.dispose();assert.equal(failed,1);
});

test('娱乐手感参数通过统一调参保存重载，旧配置缺少新键时使用来源默认值', () => {
    const saved=new Map(),h=fixture();
    Object.assign(h.cc,{JsonAsset:class{},native:{},Color:class{},
        sys:{localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)}},
        resources:{load(_p,_t,done){done(null,{json:{version:52,values:{}}});}}});
    const tuning=h.load('core/TuningDebugControls'),balance=h.load('core/EntertainmentBalance');
    const control=tuning.TUNING_GROUPS.flatMap(g=>g.controls).find(c=>c.id==='entertainment.supply.energyRestoreRatio');
    tuning.loadSavedTuningAsync(()=>{});near(balance.STIMULANT_BRAWL_TUNING.energyRestoreRatio,.3);
    control.set(.45);assert.equal(tuning.saveCurrentTuning().ok,true);control.set(.1);
    tuning.loadSavedTuningAsync(()=>{});near(balance.STIMULANT_BRAWL_TUNING.energyRestoreRatio,.45);
});


test('娱乐补给沿用主干从近到远的泳道坐标，返程身体胶囊保持真实横向朝向', () => {
    const f=runtimeFixture(false,8);f.runtime.prepare(e=>assert.ifError(e));
    f.runtime.onStateChanged(f.GameState.COUNTDOWN);f.swimmer.distance=29;f.runtime.update(.01,f.GameState.RACING);
    const spawn=f.runtime.supplies.schedule[0],slot=f.runtime.supplies.slots[0];
    near(slot.lateral,((8-1)*.5-spawn.laneIndex)*2.5+spawn.lateralOffset);f.runtime.dispose();
    const {controller,states,pickups}=supplyFixture([{id:0,wave:1,distance:80.566,laneIndex:0,lateralOffset:1.5,kind:'calm-slush'}]);
    states[0].distance=74.566;controller.update(.01);controller.update(1.2);
    states[0].distance=80;states[0].heading=Math.PI/4;controller.update(.1);
    assert.equal(pickups.length,1);
});
