const test = require('node:test');
const assert = require('node:assert/strict');
const analysis = require('../scripts/analyze-stroke-efficiency.cjs');
const { load } = analysis;
const { StrokeHeartRateModel } = load('condition/StrokeHeartRateModel');
const { perfectWidthScale } = load('core/ConditionBalance');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { StrokeType, Rating } = load('core/GameConstants');
const near = (a,b,e=1e-9) => assert.ok(Math.abs(a-b)<e, `${a} != ${b}`);

test('划频采样按实际开始计数，8～12秒达到明显压力，停止后自然恢复', () => {
    const model = new StrokeHeartRateModel();
    let first140 = null;
    for (let i=0;i<20000;i++) {
        if (i>=200 && (i-200)%400===0) model.recordStart();
        model.tick(.001);
        if(first140===null && model.heartRate>=140) first140=(i+1)/1000;
    }
    assert.ok(first140>=8 && first140<=12, String(first140));
    assert.ok(model.heartRate>170 && model.heartRate<180);
    model.tick(6);assert.ok(model.heartRate<100);
    model.tick(100);near(model.heartRate,80);
    model.reset();near(model.heartRate,80);near(model.strokeRate,0);
});

test('采样过期分段积分在30/60/120Hz和大帧下结果一致', () => {
    const run = fps => {
        const model=new StrokeHeartRateModel();
        for(let i=0;i<fps*12;i++){if(i%(fps/3)===0)model.recordStart();model.tick(1/fps);}
        model.tick(3);return model.heartRate;
    };
    near(run(30),run(60),1e-8);near(run(30),run(120),1e-8);
    const a=new StrokeHeartRateModel(),b=new StrokeHeartRateModel();
    for(const m of [a,b]){m.applyAuthoritative(180);m.recordStart();m.tick(.3);m.recordStart();}
    a.tick(7);for(let i=0;i<840;i++)b.tick(1/120);near(a.heartRate,b.heartRate,1e-8);
});

test('重复按住/拒绝重叠不重复计数，踢腿不计数，按住续划在实际开始时计一次', () => {
    const m=new SwimmerMotor();m.startRace();m.update(.3,{isAI:false});
    for(let i=0;i<20;i++)m.recordKickTap(i%2?StrokeType.LEFT:StrokeType.RIGHT);
    near(m._heartRate.strokeRate,0);
    m.setStrokeHeld(StrokeType.LEFT,true,.2);near(m._heartRate.strokeRate,0);
    assert.equal(m.recordStroke(StrokeType.LEFT),true);near(m._heartRate.strokeRate,.5);
    m.setStrokeHeld(StrokeType.LEFT,true,.2);
    assert.equal(m.recordStroke(StrokeType.LEFT),false);near(m._heartRate.strokeRate,.5);
    const before=m._leftActions[0];
    for(let i=0;i<300 && m._leftActions[0]===before;i++)m.update(1/240,{isAI:false});
    assert.notEqual(m._leftActions[0],before);near(m._heartRate.strokeRate,1);
});

test('每档整段PERFECT含两端与HUD精确一致，当前动作不受后续心率校正影响', () => {
    for(const [hr,width] of [[80,1],[100,1],[120,.8],[140,.55],[160,.4],[180,.3]]) {
        near(perfectWidthScale(hr),width);
        const start=.375-.125*width,end=.375+.125*width;
        for(const isAI of [false,true]) for(const side of [StrokeType.LEFT,StrokeType.RIGHT]) {
            for(const p of [start-.0001,start,start+(end-start)*.25,.375,end-.0001,end,end+.0001]) {
                const m=new SwimmerMotor();m.startRace(0,2);m._physics.step=s=>s;
                m.update(.3,{isAI});m.applyAuthoritativeHeartRate(hr,true);
                m.setStrokeHeld(side,true,.2);m.recordStroke(side);
                const action=(side===StrokeType.LEFT?m._leftActions:m._rightActions)[0];
                m.applyAuthoritativeHeartRate(hr===80?180:80,true);
                for(let i=0;i<24;i++)m.update(.3/24,{isAI});
                action.progress=p*Math.PI*2;
                const guide=m.strokeTimingGuideForSide(side);
                const zone=guide.intervals.find(i=>i.rating===Rating.PERFECT);
                near(zone.startRatio,start);near(zone.endRatio,end);near(guide.heartRate,hr);
                const result=m.setStrokeHeld(side,false);
                assert.equal(result.strokeQuality===1,p>=start && p<=end,`hr=${hr},p=${p},AI=${isAI}`);
            }
        }
    }
});

test('各档完整PERFECT的连续游速仍优于提前GOOD，动态心率下可持续命中', () => {
    for(const hr of [80,120,140,160,180]) {
        const width=perfectWidthScale(hr),a=.375-.125*width,b=.375+.125*width;
        const opts={heartRate:hr};
        const good=analysis.replay(a-.00001,true,false,opts);
        const points=Array.from({length:9},(_,i)=>a+.0001+(b-a-.0002)*i/8);
        for(const p of points){
            const r=analysis.replay(p,true,false,opts);
            assert.equal(r.good+r.bad+r.rejected,0,`hr=${hr},p=${p}`);
            assert.ok(r.meanSpeed>good.meanSpeed*1.03,`${hr}: ${r.meanSpeed} <= ${good.meanSpeed}`);
        }
    }
    const r=analysis.replay(.375,true,false,{heartRate:null});
    assert.equal(r.good+r.bad+r.rejected,0);assert.ok(r.heartRate>=160);assert.ok(r.meanSpeed>2.4);
});

test('踢腿维持约80～85%的PERFECT游速，心率恢复与不操作一致', () => {
    const swim=analysis.replay(.375,true,false).meanSpeed;
    const kick=new SwimmerMotor(),idle=new SwimmerMotor();
    kick.startRace();idle.startRace();kick.applyAuthoritativeHeartRate(180);idle.applyAuthoritativeHeartRate(180);
    let distance=0;
    for(let i=0;i<60*240;i++) {
        if(i%30===0)kick.recordKickTap(i%60?StrokeType.LEFT:StrokeType.RIGHT);
        const before=kick.distance;kick.update(1/240,{isAI:false});idle.update(1/240,{isAI:false});
        if(i>=30*240)distance+=kick.distance-before;
    }
    near(kick.heartRate,idle.heartRate);near(kick._heartRate.strokeRate,0);
    const ratio=distance/30/swim;assert.ok(ratio>=.8 && ratio<=.85,String(ratio));
});


test('远端实际回放锁定事件心率，之后恢复最新owner心率，重复快照不遗留旧值', () => {
    const path=require('node:path');
    const h=require('./helpers/cocos-math-harness.cjs').createHarness({'./Swimmer':{Swimmer:class {}}});
    Object.assign(h.cc,{Component:class {},_decorator:{ccclass:()=>target=>target,property:()=>()=>undefined}});
    const {RemoteSwimmerController}=h.load(path.join(h.root,'assets/scripts/entity/RemoteSwimmerController.ts'));
    const remote=new RemoteSwimmerController(),m=new SwimmerMotor();m.startRace();m.update(.3,{isAI:false});
    remote.swimmer={node:{active:true},get heartRate(){return m.heartRate;},
        applyAuthoritativeHeartRate:(h,r)=>m.applyAuthoritativeHeartRate(h,r),
        applyConditionSpeedScale:v=>m.setConditionSpeedScale(v),applyConditionQualityScale(){},applyConditionCadenceScale(){},
        handleStroke:s=>m.recordStroke(s),handleStrokeHeld:(s,on,pre)=>m.setStrokeHeld(s,on,pre)};
    remote.applyOwnerCondition(1,180);
    remote.applyEvents([{kind:'h',side:0},{kind:'s',side:0,heartRate:80}]);
    near(m.heartRate,180);near(m.strokeTimingGuideForSide(StrokeType.LEFT).heartRate,80);
    remote.applyOwnerCondition(1,180);near(m.heartRate,180);
    remote.applyEvents([{kind:'h',side:1},{kind:'s',side:1,heartRate:140.12}]);
    near(m.heartRate,180);near(m.strokeTimingGuideForSide(StrokeType.RIGHT).heartRate,140.12);
    near(m._heartRate.strokeRate,1);
});

test('四类固有心率的实测升温与恢复保持设计取舍，跨帧率积分一致', () => {
    const {measureTrait}=require('../scripts/analyze-character-heart-rate.cjs');
    const expected={quick:[6.525,3.520],balanced:[8.351,5.088],steady:[10.179,6.679],slow:[12.009,8.278]};
    for(const [trait,[rise,rest]] of Object.entries(expected)) {
        const result=measureTrait(trait);near(result.to140,rise,.003);near(result.to100,rest,.003);
        const run=fps=>{
            const m=new StrokeHeartRateModel();m.setTrait(trait);
            for(let i=0;i<fps*12;i++){if(i%(fps/3)===0)m.recordStart();m.tick(1/fps);}
            m.tick(4);return m.heartRate;
        };
        near(run(30),run(120),1e-8);
    }
});
