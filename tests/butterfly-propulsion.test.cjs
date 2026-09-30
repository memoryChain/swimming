const test=require('node:test'),assert=require('node:assert/strict');
const {createBody,load}=require('./helpers/butterfly-race-harness.cjs');
const {ButterflyPropulsion}=load('swimmer/ButterflyPropulsion');
const {BUTTERFLY_TUNING:t}=load('core/ButterflyTuning');
const {StrokeType}=load('core/GameConstants');
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
function release(f){const m=f.body.motor;assert.ok(m.beginButterfly());m.butterfly.advance(m.butterfly.duration*.39);m.releaseButterfly();f.flush();return m;}

test('推进预算在各帧率、非整除尾帧与卡顿帧只支付一次，非法时间不消费',()=>{
    for(const dt of [1/15,1/30,1/60,1/120,1/240,.103,.5]){
        const p=new ButterflyPropulsion();p.start(2.7,.28);
        for(const bad of [0,-1,NaN,Infinity])near(p.consume(bad),0);
        let impulse=0;for(let i=0;i<Math.ceil(.28/dt)+3;i++)impulse+=p.consume(dt)*dt;
        near(impulse,2.7);near(p.consume(1),0);assert.equal(p.active,false);
    }
    const p=new ButterflyPropulsion();p.start(NaN,.3);near(p.consume(.1),0);
    p.start(2,.2);p.consume(.1);p.reset();near(p.consume(.1),0);
    p.start(4,.2);p.start(1,.2);near(p.consume(.2)*.2,1);
});

test('先平滑集中发力再完全滑行，推进不产生额外计费、蓄气或连击',()=>{
    const f=createBody(),m=release(f),before=f.body._ultimate.energy;
    const cost=f.body.settledStrokeEnergy;let early=0,peak=0,last=0;
    for(let i=0;i<120;i++){
        const a=m._butterflyPulse.consume(1/240);if(i===0)early=a;peak=Math.max(peak,a);last=a;
    }
    assert.ok(peak>early*3);near(last,0);near(f.body.settledStrokeEnergy,cost);
    near(f.body._ultimate.energy,before);assert.equal(f.body._strokeQualityCombo,1);
});

test('触摸取消保留已付预算且不能抢开下一拍，阶段接管清除余量',()=>{
    const f=createBody(),m=release(f),p=m._butterflyPulse;
    const budget=p.impulseBudget,paid=p.consume(.04)*.04;
    m.cancelButterfly();m.cancelButterfly();assert.equal(m.beginButterfly(),false);
    near(paid+p.consume(1),budget);near(f.condition.energy,98);
    for(const action of [m=>m.stopRace(),m=>m.beginFlipTurnPhase(),m=>m.setGlidePhase(true),
        m=>m.beginTurtleGrip(),m=>m.beginForcedLaunch(),m=>m.enableButterflyTest(false),m=>m.startRace()]){
        const x=createBody(),m=release(x),p=m._butterflyPulse;
        assert.ok(p.active);action(m);near(p.consume(1),0);near(x.condition.energy,98);
    }
    const x=createBody();x.body.motor.beginButterfly();x.body.motor.cancelButterfly();
    near(x.body.motor._butterflyPulse.consume(1),0);near(x.condition.energy,100);
});

test('新曲线参数在起划锁定，默认自由泳与关闭蝶泳不分配或发出独立脉冲',()=>{
    const f=createBody(),m=f.body.motor,old={...t};
    const reference=release(createBody())._butterflyPulse.duration;
    try{
        assert.ok(m.beginButterfly());t.pulseEnabled=0;t.pulseSeconds=.12;t.pulseBudgetScale=1.2;
        m.butterfly.advance(.39*m.butterfly.duration);m.releaseButterfly();f.flush();
        assert.ok(m._butterflyPulse.active);near(m._butterflyPulse.duration,reference);
        m.update(1,{isAI:false});assert.equal(m._butterflyPulse.active,false);
        assert.ok(m.beginButterfly());m.butterfly.advance(.39*m.butterfly.duration);m.releaseButterfly();
        assert.ok(m._strokeAcceleration>0);assert.equal(m._butterflyPulse.active,false);
    }finally{Object.assign(t,old);}
    const normal=new(load('swimmer/SwimmerMotor').SwimmerMotor)();assert.equal(normal.butterfly,null);
    assert.equal(normal._butterflyPulse,null);
});

test('失误不获得完整脉冲，疲劳、原环境阻力和踢腿仍影响真实速度',()=>{
    const speeds=[];
    for(const mode of ['normal','bad','tired','drag','kick']){
        const f=createBody(),m=f.body.motor;
        if(mode==='tired'){f.condition.consumeEnergy(100);f.updateCondition();}
        if(mode==='drag')m._environmentDrag=2;
        m.beginButterfly();m.butterfly.advance(m.butterfly.duration*(mode==='bad'?.05:.39));m.releaseButterfly();f.flush();
        for(let n=0;n<50;n++){if(mode==='kick'&&n%8===0)m.recordKickTap(StrokeType.LEFT);m.update(.01,{isAI:false});}
        speeds.push(m.currentSpeed);
    }
    assert.ok(speeds[1]<speeds[0]);assert.ok(speeds[2]<speeds[0]);assert.ok(speeds[3]<speeds[0]);assert.ok(speeds[4]>speeds[0]);
});

test('脉冲调参进入统一保存字段，恢复旧值后可复现',()=>{
    const {TUNING_GROUPS}=load('core/TuningDebugControls');
    for(const key of ['pulseEnabled','pulseSeconds','pulseBudgetScale']){
        const c=TUNING_GROUPS.flatMap(g=>g.controls).find(c=>c.id===`butterfly.${key}`);assert.ok(c);
        const v=c.get();c.set(c.min);near(t[key],c.min);c.set(v);near(t[key],v);
    }
});

test('全部角色在固定巡航、疲劳和补腿对照中保留原有综合速度',()=>{
    const {sample,scenarios}=require('../scripts/analyze-butterfly-pulse.cjs');
    const old=t.pulseEnabled;
    try{
        for(const o of scenarios()){
            const b=sample({...o,pulse:false}),a=sample({...o,pulse:true});
            const limit=(!o.exhausted && o.quality==='perfect' && !o.kickHz) ? .01 : .02;
            assert.ok(Math.abs(a.meanSpeed/b.meanSpeed-1)<=limit,JSON.stringify({o,before:b.meanSpeed,after:a.meanSpeed}));
        }
    }finally{t.pulseEnabled=old;}
});

test('自由泳逐帧结果不受蝶泳脉冲开关影响',()=>{
    const {measure}=require('../scripts/analyze-butterfly-efficiency.cjs'),old=t.pulseEnabled;
    try{t.pulseEnabled=0;const before=measure(false,120);t.pulseEnabled=1;
        assert.deepEqual(measure(false,120),before);
    }finally{t.pulseEnabled=old;}
});

test('峰值碰撞继续按实际速度和体重结算，不因集中发力增加专属撞击倍率',()=>{
    const {sample}=require('../scripts/analyze-butterfly-pulse.cjs');
    const {resolveSwimmerCollisions,SWIMMER_COLLISION}=load('entity/SwimmerCollisionResolver');
    const old=t.pulseEnabled;
    const run=(speed,side)=>{
        resolveSwimmerCollisions([]);
        const body=(x,direction,v,weight)=>({node:{position:{x,y:0,z:0}},isCollisionActive:true,
            isAI:false,collisionRemoteHuman:false,weight,raceDirection:direction,startPosition:{x:0,y:0,z:0},
            currentSpeed:v,movementHeading:0,applyCollisionPush(dx,dz){this.node.position.x+=dx;this.node.position.z+=dz;},
            applyCollisionImpulse(){},applyCollisionAxialImpulse(){},applyCollisionPitchImpulse(){},
            applyCollisionSoftnessImpulse(){},addCollisionEnergyBonus(){}});
        const a=body(-SWIMMER_COLLISION.radius*.9,1,speed,1.3),b=body(SWIMMER_COLLISION.radius*.9,side,side===1?1:2,.85);
        let magnitude=0;resolveSwimmerCollisions([a,b],(...args)=>magnitude=args[7]);return magnitude;
    };
    try{
        for(const level of [1,30]){
            const before=sample({characterId:'muscleMan',level,pulse:false});
            const after=sample({characterId:'muscleMan',level,pulse:true});
            for(const side of [-1,1]){
                const a=run(before.max,side),b=run(after.max,side);
                assert.ok(a>0&&b>0);assert.ok(Math.abs(b/a-1)<.05);
            }
        }
    }finally{t.pulseEnabled=old;resolveSwimmerCollisions([]);}
});

test('冲线只保留实际到达终点的距离，不保留未付脉冲到下一场',()=>{
    const {getRaceDistance}=load('core/GameBalance');const f=createBody(),m=release(f);
    m._distance=getRaceDistance()-.001;m.update(.01,{isAI:false});
    near(m.distance,getRaceDistance());assert.equal(m.isRacing,false);assert.equal(m._butterflyPulse.active,false);
    m.startRace();near(m._butterflyPulse.consume(.1),0);
});
