const test = require('node:test');
const assert = require('node:assert/strict');
const { createBody, load } = require('./helpers/butterfly-race-harness.cjs');
const { ButterflyKickCarry, ButterflyPhysicsIntegrator, ButterflyPropulsion } = load('swimmer/ButterflyPropulsion');
const { SwimPhysicsModel } = load('swimmer/SwimPhysicsModel');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { InputRouter } = load('core/InputRouter');
const { StrokeType } = load('core/GameConstants');
const { BUTTERFLY_TUNING: T } = load('core/ButterflyTuning');
const B = load('core/GameBalance');
const original = { ...T };
test.beforeEach(() => { T.kickCarryScale = .5; T.kickCarrySeconds = .3; B.setRaceMode('competitive'); });
test.afterEach(() => Object.assign(T, original));
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
function motor(enabled = true) {
    const m = new SwimmerMotor(); m.enableButterfly(enabled); m.startRace(0, .8);
    m.applyAuthoritativeHeartRate(80, true); return m;
}
function seed(m, gap = .25) {
    assert.ok(m.recordKickTap(StrokeType.LEFT, false));
    m.update(gap, { isAI: false }); assert.ok(m.recordKickTap(StrokeType.RIGHT, false));
}
function carry(scale = .5, seconds = .3) {
    const c = new ButterflyKickCarry(); c.start(4, scale, seconds); c.prepareFrame(0, .22, 2.7, .5); return c;
}

test('线性余量跨帧精确支付0.066预算，覆盖相交、到期、超大帧和非法时间', () => {
    for (const step of [1 / 15, 1 / 30, 1 / 60, 1 / 120, .07, .25, 3]) {
        const c = carry(); let impulse = 0;
        for (let t = 0; t < 1; t += step) impulse += c.consume(step, .8) * step;
        near(impulse, .066); assert.equal(c.active, false); near(c.consume(1, .8), 0);
    }
    const c = carry(); c.prepareFrame(.22, .22, 2.7, .5);
    // 真实腿频为1Hz：只补足前0.15秒中超过1Hz的三角形面积。
    near(c.consume(.3, .8) * .3, .0165);
    const badTime = carry();
    for (const dt of [0, -1, NaN, Infinity]) near(badTime.consume(dt, .8), 0);
    near(badTime.consume(.3, .8) * .3, .066);
});

test('速度上限、冰沙倍率与真实推进取大值；受阻时间消耗，不积存补发', () => {
    const high = carry(); near(high.consume(.3, 3), 0); assert.equal(high.active, false);
    const faded = carry(); near(faded.consume(.3, 2.45) * .3, .033);
    const cooled = carry(); cooled.prepareFrame(0, .22 * .9, 2.7, .5);
    near(cooled.consume(.3, .8) * .3, .066 * .9);
    const real = carry(); real.prepareFrame(.6, .22, 2.7, .5);
    near(real.consume(.3, .8), 0); assert.equal(real.active, false);
});

test('比例和时长锁定、钳制且零值关闭，非有限参数不产生推进', () => {
    for (const args of [[4,0,.3],[4,.5,0],[0,.5,.3],[4,NaN,.3],[Infinity,.5,.3],[4,.5,Infinity]]) {
        const c = new ButterflyKickCarry(); c.start(...args); assert.equal(c.active, false);
    }
    const c = carry(2, 1); near(c.consume(1, .8), .22 * 4 * .5 / 2);
    const m = motor(); seed(m); assert.ok(m.beginButterfly());
    T.kickCarryScale = 0; T.kickCarrySeconds = 0;
    const locked = m._butterflyKickCarry; locked.prepareFrame(0, .22, 2.7, .5);
    near(locked.consume(.3, .8) * .3, .066);
});

function integrate(deltas, enabled = true) {
    const c = enabled ? carry() : null, p = new ButterflyPropulsion();
    const integrator = new ButterflyPhysicsIntegrator(), physics = new SwimPhysicsModel();
    let speed = 2.35, distance = 0, time = 0, frame = 0;
    while (time < .5 - 1e-10) {
        const dt = Math.min(deltas[frame++ % deltas.length], .5 - time);
        const out = integrator.step(physics, p, speed, dt, 0, 0, 0, 0, 0, 1, 0, c);
        speed = out.currentSpeed; distance += out.averageSpeed * dt; time += dt;
    }
    return { speed, distance };
}
test('推进余量使用真实小步物理，15至120帧及混合长帧的轨迹一致', () => {
    const reference = integrate([1 / 120]);
    for (const deltas of [[1/15],[1/30],[1/60],[1/120],[.1,.25,1/60]]) {
        const r = integrate(deltas); near(r.speed, reference.speed); near(r.distance, reference.distance);
    }
    assert.ok(reference.distance > integrate([1/120], false).distance);
});

test('真实运动层跨帧消费余量，开启余量仍限制为最多33步并复用物理输入', () => {
    const rows=[];
    for(const fps of [15,30,60,120]){
        const m=motor();seed(m);assert.ok(m.beginButterfly());
        for(let t=0;t<.5-1e-10;){const dt=Math.min(1/fps,.5-t);m.update(dt,{isAI:false});t+=dt;}
        rows.push([m.currentSpeed,m.distance]);
    }
    for(const r of rows){near(r[0],rows[0][0]);near(r[1],rows[0][1]);}
    const physics=new SwimPhysicsModel(),p=new ButterflyPropulsion(),integrator=new ButterflyPhysicsIntegrator();
    const originalStep=physics.speedAfterStep.bind(physics);let count=0,input;
    physics.speedAfterStep=(speed,next)=>{count++;if(input)assert.equal(next,input);input=next;return originalStep(speed,next);};
    p.start(2.5,.2);const c=carry();integrator.step(physics,p,.8,3,0,0,0,0,0,1,.03,c);
    assert.ok(count<=33);assert.equal(c.active,false);
});

test('真实起划继承已衰减频率，仍清测频和动画，不生成新输入或结算', () => {
    const m = motor(); seed(m); m.update(.5, { isAI:false }); near(m.kickCadenceHz, 2);
    assert.ok(m.beginButterfly()); near(m.kickCadenceHz, 0); near(m._lastKickTapClock, -1);
    near(m._leftKickMotionRemaining,0); near(m._rightKickMotionRemaining,0);
    assert.equal(m.consumeStrokeQualityResults().length, 0);
    m._butterflyKickCarry.prepareFrame(0,.22,2.7,.5);
    near(m._butterflyKickCarry.consume(.3,.8)*.3,.033);
    for (const gap of [.5,.25,.01]) {
        const n=motor();seed(n,gap);assert.ok(n.beginButterfly());
        n._butterflyKickCarry.prepareFrame(0,.22,2.7,.5);
        near(n._butterflyKickCarry.consume(.3,.8)*.3,.22*Math.min(1/gap,4.8)*.5*.3/2);
    }
});

test('失败起划不碰自由泳腿频；首次补腿仍计时，第二次才建立真实频率', () => {
    const m=motor();seed(m);m.setStrokeHeld(StrokeType.LEFT,true,.2);m.recordStroke(StrokeType.LEFT);
    const hz=m.kickCadenceHz,last=m._lastKickTapClock;
    assert.equal(m.beginButterfly(),false);near(m.kickCadenceHz,hz);near(m._lastKickTapClock,last);
    const n=motor();seed(n);assert.ok(n.beginButterfly());n.update(.4,{isAI:false});n.releaseButterfly();
    assert.ok(n.recordKickTap(StrokeType.LEFT,false));near(n.kickCadenceHz,0);
    n.update(.2,{isAI:false});assert.ok(n.recordKickTap(StrokeType.RIGHT,false));near(n.kickCadenceHz,5);
});

test('取消重按、阶段接管和关闭能力清余量，无新踢腿不能再继承', () => {
    for (const reset of [m=>m.cancelButterfly(false),m=>m.beginFlipTurnPhase(),m=>m.stopRace(),
        m=>m.startRace(),m=>m.beginTurtleGrip(),m=>m.setGlidePhase(true),m=>m.enableButterfly(false)]) {
        const m=motor();seed(m);assert.ok(m.beginButterfly());const c=m._butterflyKickCarry;
        assert.equal(c.active,true);reset(m);assert.equal(c.active,false);
    }
    const m=motor();seed(m);assert.ok(m.beginButterfly());m.update(.05,{isAI:false});m.cancelButterfly(false);
    for(let i=0;i<5;i++){assert.ok(m.beginButterfly());assert.equal(m._butterflyKickCarry.active,false);m.cancelButterfly(false);}
    const f=createBody('kickDive'),n=f.body.motor;seed(n);assert.ok(f.body.beginButterfly());
    n.ability.depth=.5;f.body.stepSimulation(.01);assert.equal(n._butterflyKickCarry.active,false);
    const hit=createBody();seed(hit.body.motor);assert.ok(hit.body.beginButterfly());
    hit.body.beginEntertainmentKnockout();assert.equal(hit.body.motor._butterflyKickCarry.active,false);
});

test('相同水流和撞击下只增加推进，不改变外力缓冲、偏航、翻滚或俯仰', () => {
    const rows=[];
    for(const scale of [0,.5]){
        T.kickCarryScale=scale;const m=motor();seed(m);
        m.applyWaterCurrent(0,0,1,0,.1,4);m.applyCollisionImpulse(.3,.4);
        m.applyCollisionAxialImpulse(.2);m.applyCollisionPitchImpulse(.2);assert.ok(m.beginButterfly());
        const points=[];
        for(let i=0;i<18;i++){
            m.update(1/60,{isAI:false});points.push([m.heading,m.headingTurnRate,m.axialRollRadians,
                m.axialRollAngularVelocity,m.collisionPitchRadians,m.collisionPitchAngularVelocity,
                m._knockbackDistance,m._knockbackLateral,m.kickCadenceHz]);
        }
        rows.push({points,distance:m.distance});
    }
    assert.deepEqual(rows[0].points,rows[1].points);assert.ok(rows[1].distance>rows[0].distance);
});

test('无补腿的蝶泳和未使用蝶泳的自由泳，开启实验不改变轨迹与结算', () => {
    for(const butterfly of [false,true]){
        const rows=[];
        for(const scale of [0,.5]){
            T.kickCarryScale=scale;const m=motor();
            if(butterfly)assert.ok(m.beginButterfly());else seed(m);
            const points=[];
            for(let i=0;i<75;i++){
                if(i===24&&butterfly)m.releaseButterfly();
                m.update(1/60,{isAI:false});points.push([m.currentSpeed,m.distance,m.heading,m.axialRollRadians]);
            }
            rows.push({points,results:m.consumeStrokeQualityResults()});
        }
        assert.deepEqual(rows[0],rows[1]);
    }
    assert.equal(motor(false)._butterflyKickCarry,null);
});

test('真实双手配对不赠送踢腿；新增余量不改变计费、蓄气、连击和心率', () => {
    const rows=[];
    for(const scale of [0,.5]){
        T.kickCarryScale=scale;const f=createBody(),m=f.body.motor;let now=1000,kicks=0;
        const old=Date.now;Date.now=()=>now;
        const router=new InputRouter({}, {
            butterfly:{admission:()=>f.body.butterflyAdmission,begin:()=>f.body.beginButterfly(),
                release:()=>f.body.releaseButterfly(),cancel:()=>f.body.cancelButterfly()},
            onStrokeHeld:(s,held,pre)=>{f.settle(m.setStrokeHeld(s,held,pre));return true;},
            onStroke:s=>m.recordStroke(s),onKickStroke:s=>{kicks++;m.recordKickTap(s,false);},
        });
        const step=dt=>{now+=dt*1000;m.update(dt,{isAI:false});router.tick();f.flush();};
        try{
            for(const side of [StrokeType.LEFT,StrokeType.RIGHT]){
                router.handleScreenStroke(side);step(.03);router.handleScreenStrokeEnd(side);step(.22);
            }
            router.handleScreenStroke(StrokeType.LEFT);router.handleScreenStroke(StrokeType.RIGHT);step(.21);
            assert.equal(m.butterfly.held,true);assert.equal(kicks,2);
            for(let i=0;i<24;i++)step(1/60);
            router.handleScreenStrokeEnd(StrokeType.LEFT);router.handleScreenStrokeEnd(StrokeType.RIGHT);f.flush();
            rows.push({energy:f.condition.energy,gas:f.body._ultimate.energy,combo:f.body._strokeQualityCombo,
                heart:m.heartRate,quality:m.butterfly.quality,kicks});
        }finally{Date.now=old;}
    }
    assert.deepEqual(rows[0],rows[1]);near(rows[0].energy,98);assert.equal(rows[0].quality,1);
});

test('真实运动中余量按0.3秒到期；高于踢腿速限时不会积存到减速后兑现', () => {
    const m=motor();seed(m);m._currentSpeed=5;assert.ok(m.beginButterfly());
    for(let i=0;i<19;i++)m.update(1/60,{isAI:false});assert.equal(m._butterflyKickCarry.active,false);
    const n=motor();seed(n);assert.ok(n.beginButterfly());
    n.update(0,{isAI:false});assert.equal(n._butterflyKickCarry.active,true);
    n.update(.31,{isAI:false});assert.equal(n._butterflyKickCarry.active,false);
    T.cycleSeconds=.35;T.kickCarrySeconds=.5;
    const fast=motor();seed(fast);assert.ok(fast.beginButterfly());
    fast.update(.36,{isAI:false});assert.equal(fast._butterflyKickCarry.active,false);
});
