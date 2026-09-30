const test = require('node:test');
const assert = require('node:assert/strict');
const { createBody, load } = require('./helpers/butterfly-race-harness.cjs');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { InputRouter } = load('core/InputRouter');
const { StrokeType } = load('core/GameConstants');
const { BUTTERFLY_TUNING, butterflyPoseAllowsStroke } = load('core/ButterflyTuning');
const radians = degrees => degrees * Math.PI / 180;

function inputFixture(clock, exhausted = false, ability = 'none') {
    const model = createBody(ability);
    const { body, condition } = model, m = body.motor;
    if (exhausted) { condition.consumeEnergy(condition.energy); model.updateCondition(); }
    m.applyAuthoritativeHeartRate(180, true);
    const counts = { starts: 0, releases: 0, kicks: [], confirmed: [], arms: [] };
    const router = new InputRouter({}, {
        butterfly: {
            admission: () => body.butterflyAdmission,
            interruptionVersion: () => body.butterflyInterruptionVersion,
            begin: () => { const accepted = body.beginButterfly(); if (accepted) counts.starts++; return accepted; },
            release: () => { counts.releases++; body.releaseButterfly(); }, cancel: () => body.cancelButterfly(),
        },
        onKickStroke: side => { counts.kicks.push(side); m.recordKickTap(side, false); },
        onKickConfirmed: side => { counts.confirmed.push(side); m.confirmKickAbility(); },
        onStrokeHeld: (side, held, pre) => {
            if (held && !body.canUseArmStroke) return false;
            model.settle(m.setStrokeHeld(side, held, pre)); return true;
        },
        onStroke: side => { if (m.recordStroke(side)) counts.arms.push(side); },
    });
    const step = dt => { clock.now += dt * 1000; m.update(dt, { isAI: false }); model.flush(); router.tick(); };
    const start = () => {
        router.handleScreenStroke(StrokeType.LEFT); router.handleScreenStroke(StrokeType.RIGHT);
        clock.now += 220; router.tick(); assert.equal(m.butterfly.held, true);
    };
    return { ...model, m, router, counts, step, start };
}

test('真实运动与实体同时检查前后、左右和组合翻转，双轴倒转不能抵消限制', () => {
    for (const [pitch, roll, allowed] of [[0,0,true],[20,20,true],[50,50,false],[90,0,false],
        [180,0,false],[-180,0,false],[0,180,false],[180,180,false],[NaN,0,false]]) {
        assert.equal(butterflyPoseAllowsStroke(radians(pitch),radians(roll)),allowed);
        if (!Number.isFinite(pitch)) continue;
        const { body } = createBody();
        body.motor.correctCollisionPitch(radians(pitch),0,1); body.motor.restoreAxialBalance(radians(roll));
        assert.equal(body.butterflyAdmission,allowed ? 'ready' : 'fallback');
        assert.equal(body.beginButterfly(),allowed);
    }
});

test('真实潜水深度控制蝶泳准入，模型压水不影响资格；非法深度安全回退', () => {
    for (const depth of [0, .05, .051, .5, NaN, Infinity, -.1]) {
        const { body } = createBody('kickDive');
        body.motor.ability.depth = depth;
        const allowed = depth >= 0 && depth <= .05;
        assert.equal(body.butterflyAdmission, allowed ? 'ready' : 'fallback');
        assert.equal(body.beginButterfly(), allowed);
        if (allowed) {
            body.motor.butterfly.buoyancy.offsetY = -.3;
            assert.equal(body.canContinueButterfly, true, '模型升沉不提供或剥夺真实潜水资格');
        }
    }
});

test('水下双按按自由泳划臂上浮，同次按压不会突然变蝶泳', () => {
    const old = Date.now, clock = { now: 1000 }; Date.now = () => clock.now;
    try {
        const f = inputFixture(clock, false, 'kickDive'); f.m.ability.depth = .5;
        f.router.handleScreenStroke(StrokeType.LEFT); f.router.handleScreenStroke(StrokeType.RIGHT);
        clock.now += 230; f.router.tick();
        assert.equal(f.counts.starts, 0); assert.deepEqual(f.counts.arms, [StrokeType.LEFT, StrokeType.RIGHT]);
        f.m.ability.depth = 0; f.router.tick(); assert.equal(f.counts.starts, 0);
        f.router.handleScreenStrokeEnd(StrokeType.LEFT); f.router.handleScreenStrokeEnd(StrokeType.RIGHT); f.flush();
        for (let i = 0; i < 120 && f.body.butterflyAdmission !== 'ready'; i++) f.step(1 / 60);
        assert.equal(f.body.butterflyAdmission, 'ready'); f.start(); assert.equal(f.counts.starts, 1);
    } finally { Date.now = old; }
});

test('松手前下潜无额外结算，已发力后下潜保留结算且不重复收费', () => {
    for (const mode of ['release', 'update', 'released']) {
        const { body } = createBody('kickDive'), m = body.motor;
        assert.equal(body.beginButterfly(), true); m.update(m.butterfly.duration * .42, { isAI: false });
        if (mode === 'released') {
            body.releaseButterfly(); assert.equal(m.consumeStrokeQualityResults().length, 1);
            m.ability.depth = .5; m.update(.12, { isAI: false });
        } else {
            m.ability.depth = .5;
            if (mode === 'release') body.releaseButterfly(); else m.update(.2, { isAI: false });
        }
        assert.equal(m.butterfly.active, false); assert.equal(m.consumeStrokeQualityResults().length, 0);
        assert.equal(m.isButterflyRecoveryLocked, true); assert.equal(m.butterflyInterruptionVersion, 1);
    }
    const { body } = createBody('kickDive'), m = body.motor;
    assert.equal(m.recordKickTap(StrokeType.LEFT), true); m.update(.12, { isAI: false });
    assert.ok(m.ability.depth > .05, '水面短按仍触发潜水哥原有能力');
    assert.equal(body.beginButterfly(), false);
});

test('起划要求与中断容错保留滞回，落水残留转体按逻辑姿态处理', () => {
    const { body } = createBody();
    assert.equal(body.beginButterfly(),true);
    body.motor.correctCollisionPitch(radians(70),0,1);
    assert.equal(body.butterflyAdmission,'fallback');assert.equal(body.canContinueButterfly,true);
    body.interruptButterflyIfNeeded();assert.equal(body.motor.butterfly.active,true);
    body.motor.correctCollisionPitch(radians(80),0,1);
    body.interruptButterflyIfNeeded();assert.equal(body.motor.butterfly.active,false);
    assert.equal(body.isButterflyRecoveryLocked,true);
    body.motor.startRace();body._phases._dolphinRollResidual=Math.PI;
    assert.equal(body.motor.butterflyAdmission,'ready');
    assert.equal(body.butterflyAdmission,'fallback');assert.equal(body.beginButterfly(),false);
    body._phases._dolphinRollResidual=0;assert.equal(body.beginButterfly(),true);
    body._phases._dolphinRollResidual=Math.PI;
    body.releaseButterfly();assert.equal(body.motor.consumeStrokeQualityResults().length,0);
    assert.equal(body.motor.butterfly.active,false);
});

test('真实实体模拟步在翻转后中断抱水，已结算结果不重付，重复受撞不延长恢复锁', () => {
    for (const released of [false,true]) {
        const model=createBody(),{body}=model,m=body.motor;
        body.beginButterfly();body.stepSimulation(m.butterfly.duration*.42);
        if(released){body.releaseButterfly();model.flush();}
        m.correctCollisionPitch(Math.PI,0,1);
        body.stepSimulation(.02);
        assert.equal(m.butterfly.active,false);assert.equal(m.isButterflyRecoveryLocked,true);
        assert.equal(m.consumeStrokeQualityResults().length,0);
        assert.equal(body.settledStrokeEnergy,released ? 2 : 0);
        const version=m.butterflyInterruptionVersion,until=m._butterflyRecoveryUntil;
        for(let i=0;i<3;i++){
            m.correctCollisionPitch(Math.PI,0,1);body.stepSimulation(.03);
            assert.equal(m.butterflyInterruptionVersion,version);assert.equal(m._butterflyRecoveryUntil,until);
        }
        m.restoreCollisionPitch();body.stepSimulation(2);
        assert.equal(body.canUseArmStroke,true);assert.equal(body.butterflyAdmission,'ready');
    }
});

test('松手先于模拟步也会拒绝翻转发力，运动层跨越超时点不会补发失误结算', () => {
    for(const mode of ['release','update']){
        const m=new SwimmerMotor();m.startRace();m.enableButterflyTest(true);m.beginButterfly();
        m.update(m.butterfly.duration*.45,{isAI:false});m.correctCollisionPitch(Math.PI,0,1);
        if(mode==='release')m.releaseButterfly();else m.update(.2,{isAI:false});
        assert.equal(m.butterfly.active,false);assert.equal(m.consumeStrokeQualityResults().length,0);
        assert.equal(m.isButterflyRecoveryLocked,true);assert.equal(m.butterflyInterruptionVersion,1);
    }
});

test('前后仰面双手按压回退自由泳，同次按压恢复后不突然改成蝶泳', () => {
    const old=Date.now,clock={now:1000};Date.now=()=>clock.now;
    try{
        const f=inputFixture(clock);f.m.correctCollisionPitch(Math.PI,0,1);
        f.router.handleScreenStroke(StrokeType.LEFT);f.router.handleScreenStroke(StrokeType.RIGHT);
        clock.now+=250;f.router.tick();
        assert.equal(f.counts.starts,0);assert.equal(f.counts.arms.length,2);assert.equal(f.counts.kicks.length,2);
        f.m.restoreCollisionPitch();f.router.tick();
        assert.equal(f.counts.starts,0);assert.equal(f.counts.arms.length,2);
        f.router.handleScreenStrokeEnd(StrokeType.LEFT);f.router.handleScreenStrokeEnd(StrokeType.RIGHT);
    }finally{Date.now=old;}
});

test('两侧先后松开、不同帧率及耗尽体力时，新点击可补腿，新长按等待回臂后划水', () => {
    const old=Date.now,clock={now:1000};Date.now=()=>clock.now;
    try{
        for(const first of [StrokeType.LEFT,StrokeType.RIGHT])for(const dt of [1/30,1/60,1/120,.25])for(const exhausted of [false,true]){
            const f=inputFixture(clock,exhausted),other=first===StrokeType.LEFT?StrokeType.RIGHT:StrokeType.LEFT;
            f.start();f.step(f.m.butterfly.duration*.42);
            f.router.handleScreenStrokeEnd(first);f.flush();
            assert.equal(f.body.settledStrokeEnergy,2);assert.equal(f.router.butterflyRepressMask,other===StrokeType.LEFT?1:2);
            for(let i=0;i<3;i++){
                clock.now+=30;f.router.handleScreenStroke(first);clock.now+=30;f.router.handleScreenStrokeEnd(first);
            }
            assert.deepEqual(f.counts.kicks,[first,first,first]);assert.deepEqual(f.counts.confirmed,f.counts.kicks);
            clock.now+=60;f.router.handleScreenStroke(first);clock.now+=220;f.router.tick();
            assert.equal(f.counts.arms.length,0,'回臂期间不假接受划臂');
            for(let elapsed=0;elapsed<2.2 && f.counts.arms.length===0;elapsed+=dt)f.step(dt);
            assert.deepEqual(f.counts.arms,[first]);assert.equal(f.counts.starts,1);
            assert.equal(f.counts.releases,1);assert.equal(f.body.settledStrokeEnergy,2);
            f.router.handleScreenStrokeEnd(first);f.router.handleScreenStrokeEnd(other);f.flush();
            assert.equal(f.body.settledStrokeEnergy,3,'后续自由泳动作按单臂结算，旧手松开不追加计费');
            assert.equal(f.router.butterflyRepressMask,0);
            assert.equal(f.counts.starts,1);assert.equal(f.counts.releases,1);
        }
    }finally{Date.now=old;}
});

test('两手无需同一时刻离屏，交错重新按下也能配成下一拍蝶泳', () => {
    const old=Date.now,clock={now:1000};Date.now=()=>clock.now;
    try{
        const f=inputFixture(clock);f.start();f.step(f.m.butterfly.duration*.42);
        f.router.handleScreenStrokeEnd(StrokeType.LEFT);f.flush();f.step(1);
        clock.now+=100;f.router.handleScreenStroke(StrokeType.LEFT);
        clock.now+=30;f.router.handleScreenStrokeEnd(StrokeType.RIGHT);f.router.handleScreenStroke(StrokeType.RIGHT);
        clock.now+=220;f.router.tick();
        assert.equal(f.counts.starts,2);assert.equal(f.counts.releases,1);
        assert.equal(f.counts.arms.length+f.counts.kicks.length,0);
        assert.equal(f.m.butterfly.held,true);assert.equal(f.body.settledStrokeEnergy,2);
    }finally{Date.now=old;}
});

test('正常超时的旧按压不赠送自由泳，但另一手重新短按仍能打腿', () => {
    const old=Date.now,clock={now:1000};Date.now=()=>clock.now;
    try{
        const f=inputFixture(clock);f.start();f.step(2);f.router.tick();
        assert.equal(f.body.settledStrokeEnergy,2);assert.equal(f.counts.arms.length+f.counts.kicks.length,0);
        f.router.handleScreenStrokeEnd(StrokeType.LEFT);clock.now+=100;
        f.router.handleScreenStroke(StrokeType.LEFT);clock.now+=50;f.router.handleScreenStrokeEnd(StrokeType.LEFT);
        assert.deepEqual(f.counts.kicks,[StrokeType.LEFT]);assert.equal(f.counts.starts,1);
        f.router.handleScreenStrokeEnd(StrokeType.RIGHT);f.flush();
        assert.equal(f.body.settledStrokeEnergy,2);assert.equal(f.counts.releases,1);
        assert.equal(f.router.butterflyRepressMask,0);
    }finally{Date.now=old;}
});

test('一手重新按下后撞翻，旧手与新手分别恢复，不补发新手踢腿或重复蝶泳结算', () => {
    const old=Date.now,clock={now:1000};Date.now=()=>clock.now;
    try{
        const f=inputFixture(clock);f.start();f.step(f.m.butterfly.duration*.42);
        f.router.handleScreenStrokeEnd(StrokeType.LEFT);f.flush();clock.now+=100;
        f.router.handleScreenStroke(StrokeType.LEFT);clock.now+=100;f.router.tick();
        assert.deepEqual(f.counts.kicks,[StrokeType.LEFT]);
        f.m.correctCollisionPitch(Math.PI,0,1);f.body.interruptButterflyIfNeeded();f.router.tick();
        assert.deepEqual(f.counts.kicks,[StrokeType.LEFT,StrokeType.RIGHT]);assert.equal(f.counts.arms.length,0);
        assert.equal(f.router.butterflyRepressMask,0);assert.equal(f.body.settledStrokeEnergy,2);
        f.m.restoreCollisionPitch();for(let i=0;i<90 && f.counts.arms.length<2;i++)f.step(1/60);
        assert.deepEqual(f.counts.arms,[StrokeType.LEFT,StrokeType.RIGHT]);
        assert.equal(f.counts.starts,1);assert.equal(f.counts.releases,1);
        f.router.handleScreenStrokeEnd(StrokeType.LEFT);f.router.handleScreenStrokeEnd(StrokeType.RIGHT);f.flush();
        assert.equal(f.body.settledStrokeEnergy,4);
    }finally{Date.now=old;}
});

test('松手回调即时发现翻转时，同次按压仍回退自由泳且只生成恢复踢腿', () => {
    const old=Date.now,clock={now:1000};Date.now=()=>clock.now;
    try{
        const f=inputFixture(clock);f.start();f.step(.3);f.m.correctCollisionPitch(Math.PI,0,1);
        f.router.handleScreenStrokeEnd(StrokeType.LEFT);f.router.tick();
        assert.equal(f.counts.releases,1);assert.equal(f.body.settledStrokeEnergy,0);
        assert.equal(f.router.butterflyRepressMask,0);assert.equal(f.m.isButterflyRecoveryLocked,true);
        assert.deepEqual(f.counts.kicks,[StrokeType.LEFT,StrokeType.RIGHT]);assert.equal(f.counts.arms.length,0);
        f.m.restoreCollisionPitch();f.step(1);assert.deepEqual(f.counts.arms,[StrokeType.RIGHT]);
    }finally{Date.now=old;}
});

test('取消清除旧手标记，停止、重开和阶段接管不会遗留恢复锁或免费推进', () => {
    const old=Date.now,clock={now:1000};Date.now=()=>clock.now;
    try{
        for(const takeover of ['stopRace','beginFlipTurnPhase','setGlidePhase']){
            const f=inputFixture(clock);f.start();f.step(.3);f.router.handleScreenStrokeEnd(StrokeType.LEFT);f.flush();
            f.router.resetStrokeInput();assert.equal(f.router.butterflyRepressMask,0);
            assert.equal(f.m.isButterflyRecoveryLocked,true);
            if(takeover==='setGlidePhase')f.m.setGlidePhase(true);else f.m[takeover]();
            assert.equal(f.m.isButterflyRecoveryLocked,false);assert.equal(f.m.butterfly.active,false);
            f.m.setGlidePhase(false);f.m.startRace();clock.now+=100;f.start();assert.equal(f.counts.starts,2);
            assert.equal(f.m.consumeStrokeQualityResults().length,0);
        }
    }finally{Date.now=old;}
});

test('姿态调参可保存且非法值保留安全边界，普通输入仍即时踢腿并独立划臂', () => {
    const controls=load('core/TuningDebugControls').TUNING_GROUPS.flatMap(g=>g.controls);
    for(const id of ['butterfly.entryPoseProjection','butterfly.sustainPoseProjection'])assert.ok(controls.some(c=>c.id===id));
    const before=[BUTTERFLY_TUNING.entryPoseProjection,BUTTERFLY_TUNING.sustainPoseProjection];
    try{
        BUTTERFLY_TUNING.entryPoseProjection=NaN;BUTTERFLY_TUNING.sustainPoseProjection=Infinity;
        assert.equal(butterflyPoseAllowsStroke(0,0),true);assert.equal(butterflyPoseAllowsStroke(Math.PI,0,true),false);
        BUTTERFLY_TUNING.entryPoseProjection=.3;BUTTERFLY_TUNING.sustainPoseProjection=.8;
        assert.equal(butterflyPoseAllowsStroke(radians(70),0),true);
        assert.equal(butterflyPoseAllowsStroke(radians(70),0,true),true,'持续阈值自动低于入场阈值');
    }finally{[BUTTERFLY_TUNING.entryPoseProjection,BUTTERFLY_TUNING.sustainPoseProjection]=before;}
    const old=Date.now;let now=1000;Date.now=()=>now;
    try{
        let kicks=0,arms=0;
        const r=new InputRouter({}, {onKickStroke:()=>kicks++,onStrokeHeld:()=>true,onStroke:()=>arms++});
        r.handleScreenStroke(StrokeType.RIGHT);assert.equal(kicks,1);now+=220;r.tick();assert.equal(arms,1);
        r.handleScreenStrokeEnd(StrokeType.RIGHT);assert.equal(r.butterflyRepressMask,0);
    }finally{Date.now=old;}
});
