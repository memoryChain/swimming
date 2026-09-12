// 技巧与角色取舍的离线筛查：真实划水回放，时间列仅为分段预算，不是完整比赛成绩。
// npx --yes --package typescript@5.4.5 -c "node scripts/analyze-character-technique.cjs"
const {replay,load}=require('./analyze-stroke-efficiency.cjs');
const {measure,wallMeasure}=require('./analyze-character-burst.cjs');
const {PLAYER_CHARACTER_DEFINITIONS}=load('app/PlayerCharacterConfig');
const {resolvePlayerBalance}=load('progression/PlayerBalanceOverrides');
const {CONDITION_BALANCE}=load('core/ConditionBalance');
const {DIVE_BALANCE,RACE_COURSE_LENGTH}=load('core/GameBalance');
const {CHARACTER_POSE_TUNING:P}=load('character/CharacterMotionTuning');
const {SwimmerMotor}=load('swimmer/SwimmerMotor');
const {StrokeType}=load('core/GameConstants');

function sample(character,level,target=.375,empty=false) {
    const playerBalance=resolvePlayerBalance(character,level,30,character.weight,character.energyGain,character.heartRateTrait);
    return replay(target,true,false,{playerBalance,heartRate:180,
        propulsionScale:empty?CONDITION_BALANCE.energy.exhaustedPropulsionScale:1,
        cadenceScale:empty?CONDITION_BALANCE.energy.exhaustedCadenceScale:1});
}
// 接近试玩的连续PERFECT：保留侧滚和实际心率，按渲染帧松手，模拟换手停顿。
// 30Hz时选窗口前段以免一帧跨出最窄PERFECT；60Hz选中点。
function feelSample(character,level,gap=.08,fps=60) {
    const playerBalance=resolvePlayerBalance(character,level,30,character.weight,character.energyGain,character.heartRateTrait);
    return replay(fps===30?.34:.375,true,true,{playerBalance,heartRate:null,
        duration:25,warmup:5,gap,fps,exactRelease:false});
}
function kickSpeed() {
    const m=new SwimmerMotor();m.startRace();let start=0;
    for(let i=0;i<12000;i++) {
        if(i%30===0)m.recordKickTap(i%60?StrokeType.LEFT:StrokeType.RIGHT);
        m.update(1/240,{isAI:false});if(i===7199)start=m.distance;
    }
    return (m.distance-start)/20;
}
function screeningTime(c,level,distance,full,depletedSpeed) {
    const start=measure(c,level),wall=wallMeasure(c,level),turns=distance/RACE_COURSE_LENGTH-1;
    const remaining=Math.max(0,distance-start.dive-turns*wall.distance);
    const fullDistance=Math.min(remaining,(c.stamina+level-1)/CONDITION_BALANCE.energy.drainPerStroke*full.meanSpeed/full.hz);
    const turnSeconds=P.flipTurnToKeyframe1Seconds+P.flipTurnToKeyframe2Seconds+P.flipTurnReturnToSwimSeconds
        +P.flipTurnUnderwaterDiveSeconds+P.flipTurnUnderwaterHoldSeconds+P.flipTurnUnderwaterRiseSeconds;
    return start.flight+DIVE_BALANCE.takeoffAnticipationSeconds+turns*turnSeconds
        +fullDistance/full.meanSpeed+(remaining-fullDistance)/depletedSpeed;
}
if(require.main===module) {
    const kick=kickSpeed();const rows=[];
    for(const level of [1,30])for(const c of PLAYER_CHARACTER_DEFINITIONS) {
        const full=sample(c,level),empty=sample(c,level,.375,true);
        const speeds=[.34,.375,.41].map(p=>p===.375?full.meanSpeed:sample(c,level,p).meanSpeed);
        rows.push({name:c.name,level,technique:c.technique+level-1,stamina:c.stamina+level-1,
            speeds:speeds.map(v=>+v.toFixed(4)),emptySpeed:+empty.meanSpeed.toFixed(4),
            feelSpeed:+feelSample(c,level).meanSpeed.toFixed(4),
            t200arm:+screeningTime(c,level,200,full,empty.meanSpeed).toFixed(2),
            t200kick:+screeningTime(c,level,200,full,kick).toFixed(2),
            t400arm:+screeningTime(c,level,400,full,empty.meanSpeed).toFixed(2),
            t400kick:+screeningTime(c,level,400,full,kick).toFixed(2)});
    }
    console.log('固定心率180、无偏航／侧滚／碰撞，PERFECT前中后三点，耗尽手划和独立踢腿分别计算。');
    console.log('feelSpeed另计：侧滚开启、自然心率，60Hz、中点松手、换手间隔80ms，采样第5～25秒，不含起跳和碰撞。');
    console.log('时间为简化筛查：不含海豚、出发水下、进墙位移、操作切换、真实心率；不代表成绩或胜率。');
    console.log(JSON.stringify({kickSpeed:kick,rows},null,2));
}
module.exports={sample,feelSample,screeningTime,kickSpeed};
