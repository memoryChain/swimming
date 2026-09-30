const test=require('node:test'),assert=require('node:assert/strict');
const {createBody,load}=require('./helpers/butterfly-race-harness.cjs');
const {StrokeType,Rating}=load('core/GameConstants');
const {StrokeHeartRateModel}=load('condition/StrokeHeartRateModel');
const {BUTTERFLY_TUNING:t}=load('core/ButterflyTuning');
const {ULTIMATE_ENERGY_BALANCE:u}=load('core/UltimateEnergyBalance');
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function settle(f,p=.39){const m=f.body.motor;assert.ok(m.beginButterfly());m.butterfly.advance(m.butterfly.duration*p);m.releaseButterfly();f.flush();return m;}

test('真实实体双臂扣2点、一次连击、双份基础蓄气，重复松手不重复奖励',()=>{
    const f=createBody();const m=settle(f);
    near(f.condition.energy,98);near(f.body.settledStrokeEnergy,2);
    near(f.body._ultimate.energy,u.perfectGain*2);assert.equal(f.body._strokeQualityCombo,1);
    near(m.butterfly.lastEnergyCost,2);near(m.butterfly.lastUltimateGain,u.perfectGain*2);
    m.releaseButterfly();f.flush();near(f.condition.energy,98);near(f.body._ultimate.energy,u.perfectGain*2);
    const model=new(load('condition/UltimateEnergyModel').UltimateEnergyModel)();
    model.addStrokeRating(Rating.PERFECT,u.comboEvery,2);
    near(model.energy,u.perfectGain*2+u.comboBonus);
    const full=createBody();full.body._ultimate.add(99.5);settle(full);
    near(full.body.motor.butterfly.lastUltimateGain,.5);
});

test('双臂成本与蓄气起划快照，跟游折扣只乘一次，角色无限体力有效',()=>{
    const f=createBody();f.body.motor.strokeCostScale=()=>.75;
    assert.ok(f.body.motor.beginButterfly());
    const old=t.energyScale,oldGain=t.ultimateGainScale;
    try {
        t.energyScale=3;t.ultimateGainScale=.5;f.body.motor.strokeCostScale=()=>.5;
        f.body.motor.butterfly.advance(.4*f.body.motor.butterfly.duration);
        f.body.motor.releaseButterfly();f.flush();near(f.condition.energy,98.5);
        near(f.body._ultimate.energy,u.perfectGain*2);
    } finally{t.energyScale=old;t.ultimateGainScale=oldGain;}
    const mech=createBody('exoskeleton');settle(mech);near(mech.condition.energy,100);
    near(mech.body.motor.butterfly.lastEnergyCost,0);
    assert.equal(mech.body.canUseDolphinAbility,false);
});

test('GOOD、早松和超时各扣一拍体力，只有有效评价给基础蓄气',()=>{
    for(const [p,expected] of [[.2,u.goodGain*2],[.05,0],[.7,0]]){
        const f=createBody(),m=f.body.motor;assert.ok(m.beginButterfly());
        m.update(m.butterfly.duration*p,{isAI:false});m.releaseButterfly();f.flush();
        near(f.condition.energy,98);near(f.body._ultimate.energy,expected);
        assert.equal(f.body._strokeQualityCombo,0);
        m.releaseButterfly();m.cancelButterfly();f.flush();near(f.condition.energy,98);
    }
});

test('切回自由泳恢复单臂资源规则，取消或关闭测试不能遗留恢复锁',()=>{
    const f=createBody(),m=settle(f);m.update(2,{isAI:false});f.flush();
    m.setStrokeHeld(StrokeType.LEFT,true,.2);assert.ok(m.recordStroke(StrokeType.LEFT));
    m.update(.001,{isAI:false});
    const a=m._leftActions[0];a.progress=(a.ranges.perfect.start+a.ranges.perfect.end)*Math.PI;
    f.settle(m.setStrokeHeld(StrokeType.LEFT,false));near(f.condition.energy,97);
    near(f.body._ultimate.energy,u.perfectGain*3);assert.equal(f.body._perfectComboIdleLimit,1);
    m.startRace();m.beginButterfly();m.cancelButterfly();assert.equal(m.recordStroke(StrokeType.LEFT),false);
    m.enableButterflyTest(false);assert.ok(m.recordStroke(StrokeType.LEFT));
});

test('双臂负荷等于同刻两次单臂，队列淘汰、恢复及教练阈值不漏负荷',()=>{
    for(const coach of [false,true])for(const fps of [30,60,120]) {
        const a=new StrokeHeartRateModel(),b=new StrokeHeartRateModel();
        a.setBreathControl(coach);b.setBreathControl(coach);
        for(let i=0;i<fps*8;i++){
            if(i%(fps/2)===0){a.recordStart(2);b.recordStart();b.recordStart();}
            a.tick(1/fps);b.tick(1/fps);near(a.heartRate,b.heartRate);near(a.strokeRate,b.strokeRate);
        }
        a.tick(8);b.tick(8);near(a.heartRate,b.heartRate);near(a.strokeRate,0);
        for(let i=0;i<200;i++)a.recordStart(2);assert.equal(a.strokeRate,128);
        a.reset();near(a.strokeRate,0);
    }
    const f=createBody();f.body.motor.beginButterfly();near(f.body.motor._heartRate.strokeRate,1);
    assert.equal(f.body.motor.beginButterfly(),false);near(f.body.motor._heartRate.strokeRate,1);
});

test('角色完美区与评价收益接入蝶泳，双腿能力保留弱划臂代价',()=>{
    const rows={};
    for(const id of ['none','frogSense','precision','powerKick','wallKick']) {
        const f=createBody(id),m=f.body.motor;m.applyAuthoritativeHeartRate(140,true);settle(f);
        rows[id]={width:m.butterfly.perfectEnd-m.butterfly.perfectStart,acc:m._butterflyPulse.impulseBudget};
        const guide=m.strokeTimingGuideForSide(StrokeType.RIGHT).intervals.find(i=>i.rating===Rating.PERFECT);
        near(guide.startRatio,m.butterfly.perfectStart);near(guide.endRatio,m.butterfly.perfectEnd);
    }
    assert.ok(rows.frogSense.width>rows.none.width&&rows.frogSense.acc<rows.none.acc);
    assert.ok(rows.precision.width<rows.none.width&&rows.precision.acc>rows.none.acc);
    assert.ok(rows.powerKick.acc<rows.none.acc&&rows.wallKick.acc<rows.none.acc);
    const frog=createBody('frogHop');settle(frog);
    near(frog.body._ultimate.energy,u.perfectGain*2*load('core/CharacterAbilityConfig').CHARACTER_ABILITY_TUNING.frogEnergyGain);
});

test('疲劳蝶泳正常回臂不中断连击，能力叠层确实增加下一拍推进，失误清层',()=>{
    const f=createBody('perfectChain'),m=f.body.motor;f.condition.consumeEnergy(100);f.updateCondition();
    m._physics.step=s=>s;
    let first=0;
    for(let index=0;index<4;index++){
        assert.ok(m.beginButterfly());const beat=m.butterfly;
        while(beat.progress<.39){f.body.updatePerfectComboIdle(.01);m.update(.01,{isAI:false});}
        m.releaseButterfly();f.flush();
        if(index===0)first=m._butterflyPulse.impulseBudget;else assert.ok(m._butterflyPulse.impulseBudget>first);
        assert.equal(m.ability.stacks,index+1);assert.equal(f.body._strokeQualityCombo,index+1);
        while(beat.active){f.body.updatePerfectComboIdle(.01);m.update(.01,{isAI:false});}
        for(let n=0;n<21;n++){f.body.updatePerfectComboIdle(.01);m.update(.01,{isAI:false});}
    }
    settle(f,.05);assert.equal(m.ability.stacks,0);assert.equal(f.body._strokeQualityCombo,0);
});

test('取消不能跳过回臂刷推进；起划前和未发力取消无奖励，已结算不退费',()=>{
    for(const released of [false,true]){
        const f=createBody(),m=f.body.motor;m.beginButterfly();m.update(.4,{isAI:false});
        if(released)m.releaseButterfly();m.cancelButterfly();m.cancelButterfly();f.flush();
        near(f.condition.energy,released?98:100);
        near(f.body._ultimate.energy,released?u.perfectGain*2:0);
        assert.equal(m.beginButterfly(),false);assert.equal(m.recordStroke(StrokeType.LEFT),false);
        m.update(1,{isAI:false});assert.ok(m.beginButterfly());
        m.beginFlipTurnPhase();assert.equal(m.butterfly.active,false);
        m.startRace();assert.ok(m.beginButterfly());
    }
});

test('深浅表现不授予潜水能力，全角色基础结算和大招资格一致',()=>{
    const roster=load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS;
    const {resolveModifiersFromDigest}=load('progression/RaceModifiers');
    for(const c of roster){
        const profile=resolveModifiersFromDigest({characterId:c.id,level:30});
        const f=createBody(c.abilityId,profile.balance),start=f.condition.energy;
        settle(f);near(f.condition.energy,start-(c.abilityId==='exoskeleton'?0:2));
        near(f.body.motor.ability.depth,0);assert.equal(f.body.motor.ability.ignoresSwimmers,false);
        assert.equal(f.body.canUseDolphinAbility,!['exoskeleton','kickDive'].includes(c.abilityId));
    }
});
