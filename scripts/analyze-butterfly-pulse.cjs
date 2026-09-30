// 固定条件的完整周期采样；不模拟疲劳消耗，耗尽状态作为独立输入。
const fs = require('node:fs');
const { load } = require('./analyze-stroke-efficiency.cjs');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { resolveModifiersFromDigest } = load('progression/RaceModifiers');
const { PLAYER_CHARACTER_DEFINITIONS } = load('app/PlayerCharacterConfig');
const { BUTTERFLY_TUNING } = load('core/ButterflyTuning');
const { CONDITION_BALANCE } = load('core/ConditionBalance');
const { STROKE_QUALITY_TUNING } = load('core/InputTuning');
const { StrokeType } = load('core/GameConstants');

function sample({characterId,level=1,fps=120,quality='perfect',exhausted=false,kickHz=0,pulse,seconds,
    initialSpeed=.8,warmup=12,cycles=12,trace=false}={}) {
    if(pulse!==undefined)BUTTERFLY_TUNING.pulseEnabled=pulse?1:0;
    const enabled=BUTTERFLY_TUNING.pulseEnabled>=.5;
    if(seconds!==undefined)BUTTERFLY_TUNING.pulseSeconds=seconds;
    const p=resolveModifiersFromDigest(characterId?{characterId,level}:null),m=new SwimmerMotor();
    m.setPlayerBalance(p.balance);m.setCharacterAbility(p.abilityId);
    m.enableButterflyTest(true);m.startRace(0,initialSpeed,Math.max(0,initialSpeed-3.4));m.setSteeringEnabled(false);
    m.applyAuthoritativeHeartRate(80,true);
    if(exhausted&&!m.ability.infiniteStamina){
        m.setConditionSpeedScale(CONDITION_BALANCE.energy.exhaustedPropulsionScale);
        m.setConditionCadenceScale(CONDITION_BALANCE.energy.exhaustedCadenceScale);
    }
    let t=0,next=0,kickAt=0,completed=0,done=0,begin=0,startDistance=0,min=Infinity,max=0,peakAt=0;
    const periods=[],points=[];const dt=1/fps;
    while(done<=cycles&&t<180){
        if(!m.butterfly.active&&t>=next){
            if(completed>=warmup){
                if(done>0)periods.push({seconds:t-begin,distance:m.distance-startDistance,min,max,peakAt});
                if(done===cycles)break;
                done++;begin=t;startDistance=m.distance;min=Infinity;max=0;
            }
            if(!m.beginButterfly())throw Error('无法开始采样划水');
            completed++;
        }
        const b=m.butterfly;
        const target=quality==='perfect'?(b.perfectStart+b.perfectEnd)/2:quality==='good'?.2:quality==='timeout'?2:.05;
        if(b.held&&b.progress>=target)m.releaseButterfly();
        if(kickHz>0&&t>=kickAt){
            // 只在已松手时提交短按腿，模拟回臂期间独立的补腿输入。
            if(!b.held)m.recordKickTap(StrokeType.LEFT);
            kickAt=t+1/kickHz;
        }
        const active=b.active;
        m.update(dt,{isAI:false});m.consumeStrokeQualityResults();
        if(active&&!b.active)next=t+dt+STROKE_QUALITY_TUNING.minHoldSeconds;
        if(done>0){min=Math.min(min,m.currentSpeed);if(m.currentSpeed>max){max=m.currentSpeed;peakAt=t+dt-begin;}
            if(trace&&done===1)points.push([+(t-begin).toFixed(4),+m.currentSpeed.toFixed(5),+m.currentAcceleration.toFixed(5)]);}
        t+=dt;
    }
    const duration=periods.reduce((s,p)=>s+p.seconds,0),distance=periods.reduce((s,p)=>s+p.distance,0);
    const speed=distance/duration,amplitude=periods.reduce((s,p)=>s+p.max-p.min,0)/periods.length;
    return {characterId:characterId??'neutral',level,fps,quality,exhausted,kickHz,pulse:enabled,meanSpeed:speed,
        impulse:m._butterflyPulse?.impulseBudget??0,
        amplitude,relativeAmplitude:amplitude/speed,peakAt:periods.reduce((s,p)=>s+p.peakAt,0)/periods.length,
        min:Math.min(...periods.map(p=>p.min)),max:Math.max(...periods.map(p=>p.max)),periods,...(trace?{trace:points}:{})};
}
function scenarios(){
    const out=[];
    for(const characterId of [undefined,...PLAYER_CHARACTER_DEFINITIONS.map(c=>c.id)])for(const level of [1,30])
        for(const exhausted of [false,true])for(const quality of ['perfect','good'])for(const kickHz of [0,4.8])
            out.push({characterId,level,exhausted,quality,kickHz});
    return out;
}
if(require.main===module){
    const output=process.argv[2]??'.cache/butterfly-pulse/current.json';
    const compare=process.argv.includes('--compare');
    const rows=scenarios().map(o=>compare?{before:sample({...o,pulse:false}),after:sample({...o,pulse:true})}:sample(o));
    fs.mkdirSync(require('node:path').dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify({tuning:BUTTERFLY_TUNING,rows},null,2));
    console.log(JSON.stringify({output,scenarios:rows.length,neutral:rows[0]}));
}
module.exports={sample,scenarios,load};
