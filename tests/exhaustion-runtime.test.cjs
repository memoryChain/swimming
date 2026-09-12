const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {replay,load}=require('../scripts/analyze-stroke-efficiency.cjs');
const {SwimmerMotor}=load('swimmer/SwimmerMotor');
const {resolvePlayerBalance}=load('progression/PlayerBalanceOverrides');
const {CONDITION_BALANCE:B,conditionEfficiencyScale,energyDepletionCadenceScale}=load('core/ConditionBalance');
const {PlayerConditionModel}=load('condition/PlayerConditionModel');
const {StrokeType}=load('core/GameConstants');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('耗尽后完整PERFECT内前中后均明显减速和放慢动作，30/60/120Hz可连续输入',()=>{
    const playerBalance=resolvePlayerBalance({stamina:100,technique:84,burst:50},1,30,1,82);
    for(const fps of [30,60,120])for(const target of [.34,.375,.41]) {
        const opts={heartRate:180,playerBalance,fps};
        const normal=replay(target,true,false,opts);
        const empty=replay(target,true,false,{...opts,propulsionScale:B.energy.exhaustedPropulsionScale,cadenceScale:B.energy.exhaustedCadenceScale});
        assert.equal(empty.quality,1);assert.equal(empty.rejected,0);
        assert.ok(empty.meanSpeed<normal.meanSpeed*.7&&empty.meanSpeed>normal.meanSpeed*.58);
        assert.ok(empty.holdSeconds>normal.holdSeconds*1.3);
    }
});

test('耗尽切换保留在途动作进度及判定区，动画与判定同速，新划采用弱推进，重开清空惩罚',()=>{
    for(const side of [StrokeType.LEFT,StrokeType.RIGHT])for(const isAI of [false,true]) {
        const m=new SwimmerMotor();m.startRace(0,2);m._physics.step=s=>s;
        m.update(.3,{isAI});m.applyAuthoritativeHeartRate(180,true);
        m.setStrokeHeld(side,true,.2);m.recordStroke(side);m.update(.02,{isAI});
        const actions=side===StrokeType.LEFT?m._leftActions:m._rightActions;
        const action=actions[0],progress=action.progress,ranges=JSON.stringify(action.ranges);
        const normalRate=m.currentActionCycleSpeed();
        const cycle=side===StrokeType.LEFT?m.leftArmCycle:m.rightArmCycle;
        m.setConditionSpeedScale(conditionEfficiencyScale(0));m.setConditionCadenceScale(energyDepletionCadenceScale(0));
        near(action.progress,progress);near(action.propulsionScale,1);
        m.update(.01,{isAI});
        near(action.progress-progress,normalRate*.6*.01);
        near((side===StrokeType.LEFT?m.leftArmCycle:m.rightArmCycle)-cycle,normalRate*.6*.01);
        assert.equal(JSON.stringify(action.ranges),ranges);
        action.progress=.375*Math.PI*2;
        assert.equal(m.setStrokeHeld(side,false).strokeQuality,1);
        assert.equal(m.setStrokeHeld(side,false),null,'重复松手不再次结算');
        for(let i=0;i<240;i++)m.update(1/240,{isAI});
        m.setStrokeHeld(side,true,.2);assert.equal(m.recordStroke(side),true);
        near(actions[0].propulsionScale,.15);
        // 长按到超时只结算一次，不因慢轮速卡死或每帧重复扣费。
        let count=0;
        for(let i=0;i<240;i++) {m.update(1/240,{isAI});count+=m.consumeStrokeQualityResults().length;}
        assert.equal(count,1);m.setStrokeHeld(side,false);
        m.startRace(0,2);near(m.currentActionCycleSpeed(),normalRate);
        near(m._conditionSpeedScale,1);near(m._conditionCadenceScale,1);
    }
});

test('独立踢腿速度和动作不受耗尽惩罚，踢腿及停划均不恢复体力',()=>{
    const normal=new SwimmerMotor(),empty=new SwimmerMotor(),condition=new PlayerConditionModel();
    condition.consumeEnergy(999);normal.startRace();empty.startRace();
    empty.setConditionSpeedScale(condition.efficiencyModifier);empty.setConditionCadenceScale(condition.strokeCadenceScale);
    for(let i=0;i<600;i++) {
        if(i<300&&i%15===0)for(const m of [normal,empty])m.recordKickTap(i%30?StrokeType.LEFT:StrokeType.RIGHT);
        normal.update(1/60,{isAI:false});empty.update(1/60,{isAI:false});condition.tick(1/60);
        near(empty.currentSpeed,normal.currentSpeed);near(empty.leftKickCycle,normal.leftKickCycle);near(condition.energy,0);
    }
    condition.tick(600);near(condition.energy,0);
});

test('远端耗尽由owner比例决定，微量正体力不误罚，乱序回放恢复最新倍率，重开归正常',()=>{
    const h=require('./helpers/cocos-math-harness.cjs').createHarness({'./Swimmer':{Swimmer:class {}}});
    Object.assign(h.cc,{Component:class {},_decorator:{ccclass:()=>target=>target,property:()=>()=>undefined}});
    const {RemoteSwimmerController}=h.load(path.join(h.root,'assets/scripts/entity/RemoteSwimmerController.ts'));
    const remote=new RemoteSwimmerController(),m=new SwimmerMotor();m.startRace();
    remote.swimmer={applyAuthoritativeHeartRate:(v,r)=>m.applyAuthoritativeHeartRate(v,r),
        applyConditionSpeedScale:v=>m.setConditionSpeedScale(v),applyConditionQualityScale(){},applyConditionCadenceScale:v=>m.setConditionCadenceScale(v)};
    remote.applyOwnerCondition(.000001,180);near(m._conditionCadenceScale,1);
    remote.applyOwnerCondition(0,180);near(m._conditionCadenceScale,.6);near(m._conditionSpeedScale,.15);
    remote.applyOwnerCondition(NaN,180);remote.applyOwnerCondition(-1,180);near(m._conditionCadenceScale,.6);
    remote.applyTransientOwnerCondition(1,80);near(m._conditionCadenceScale,1);
    remote.restoreOwnerCondition();near(m._conditionCadenceScale,.6);near(m._conditionSpeedScale,.15);
    remote.applyOwnerCondition(0,180);near(m._conditionCadenceScale,.6);
    remote.resetRemote();near(m._conditionCadenceScale,1);near(m._conditionSpeedScale,1);
});
