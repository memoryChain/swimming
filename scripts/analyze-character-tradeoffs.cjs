// 角色体力预算及策略敏感性筛查，不是完整比赛或胜率模拟；不修改配置。
// npx --yes --package typescript@5.4.5 -c "node scripts/analyze-character-tradeoffs.cjs"
const assert=require('node:assert/strict');
const {replay,load}=require('./analyze-stroke-efficiency.cjs');
const {measure,wallMeasure}=require('./analyze-character-burst.cjs');
const {PLAYER_CHARACTER_DEFINITIONS:C}=load('app/PlayerCharacterConfig');
const {resolvePlayerBalance}=load('progression/PlayerBalanceOverrides');
const {DOLPHIN_JUMP}=load('core/DolphinJumpConfig');
const {CONDITION_BALANCE}=load('core/ConditionBalance');
const {PROGRESSION_BALANCE}=load('progression/ProgressionBalance');
const {DIVE_BALANCE,RACE_COURSE_LENGTH}=load('core/GameBalance');
const {CHARACTER_POSE_TUNING:P}=load('character/CharacterMotionTuning');
const {SwimmerMotor}=load('swimmer/SwimmerMotor');
const {StrokeType}=load('core/GameConstants');
// v43之前已使用的体力表，只用于同一套新惩罚下比较改动效果。
const previous={cartonSwimmer6:145,cartonSwimmer8:125,cartonSwimmer5:95,cartonSwimmer9:145,
    cartonSwimmer10:110,cartonSwimmer11:85,cartonSwimmer12:110,cartonSwimmer13:140,
    cartonSwimmer14:125,cartonSwimmer15:65,muscleMan:55};
const roster=[...C].sort((a,b)=>a.burst-b.burst);
function strokeSamples(level) {
    // 技巧统一初始84并按同级成长；固定高心率，覆盖最窄PERFECT区间内前中后三点。
    const playerBalance=resolvePlayerBalance({stamina:100,technique:84,burst:50},level,30,1,82);
    return [.34,.375,.41].map(target=>{
        const options={heartRate:180,playerBalance};
        const full=replay(target,true,false,options);
        const empty=replay(target,true,false,{...options,propulsionScale:CONDITION_BALANCE.energy.exhaustedPropulsionScale,cadenceScale:CONDITION_BALANCE.energy.exhaustedCadenceScale});
        assert.equal(full.quality,1);assert.equal(empty.quality,1);
        return {target,speed:full.meanSpeed,emptySpeed:empty.meanSpeed,metersPerStroke:full.meanSpeed/full.hz};
    });
}
function kickSpeed() {
    const m=new SwimmerMotor();m.startRace();let start=0;
    for(let i=0;i<12000;i++) {
        if(i%30===0)m.recordKickTap(i%60?StrokeType.LEFT:StrokeType.RIGHT);
        m.update(1/240,{isAI:false});if(i===7199)start=m.distance;
    }
    return (m.distance-start)/20;
}
// 简化时间指标：保留真实配置的起跳空中／转身时长和无输入蹬墙距离，
// 剩余路程分成正常手划与耗尽后手划／踢腿的稳定游速两段；不模拟真实耗尽位置。
function screeningTime(c,level,stamina,distance,sample,depletedSpeed) {
    const start=measure(c,level),wall=wallMeasure(c,level),turns=distance/RACE_COURSE_LENGTH-1;
    const remaining=Math.max(0,distance-start.dive-turns*wall.distance);
    const strokes=(stamina+level-1)/CONDITION_BALANCE.energy.drainPerStroke;
    const fullDistance=Math.min(remaining,strokes*sample.metersPerStroke);
    const turnSeconds=P.flipTurnToKeyframe1Seconds+P.flipTurnToKeyframe2Seconds+P.flipTurnReturnToSwimSeconds
        +P.flipTurnUnderwaterDiveSeconds+P.flipTurnUnderwaterHoldSeconds+P.flipTurnUnderwaterRiseSeconds;
    return start.flight+DIVE_BALANCE.takeoffAnticipationSeconds+turns*turnSeconds
        +fullDistance/sample.speed+(remaining-fullDistance)/depletedSpeed;
}
const kick=kickSpeed();
console.log(`持续独立踢腿约 ${kick.toFixed(3)} m/s；耗尽后是否改用踢腿必须分别比较。`);
console.log('所有结果都是筛查指标，不是比赛成绩或胜率：未模拟碰撞、出发水下、进墙减速位移、海豚、操作切换瞬态、真实心率及技巧差异。');
for(const level of [1,PROGRESSION_BALANCE.maxLevel]) {
    const samples=strokeSamples(level),center=samples[1];
    console.log(`等级${level}：统一技巧／心率下划水样本`);console.table(samples);
    console.log('| 角色 | 当前体力 | 相同2次海豚后手臂预算 | 200m剩余距离等效满力划数 | 400m剩余距离等效满力划数 |');
    console.log('| --- | ---: | ---: | ---: | ---: |');
    for(const c of roster) {
        const stamina=c.stamina+level-1;
        const air=measure(c,level).dive,wall=wallMeasure(c,level).distance;
        const demand=d=>Math.ceil(Math.max(0,d-air-(d/RACE_COURSE_LENGTH-1)*wall)/center.metersPerStroke);
        const armBudget=Math.floor(Math.max(0,stamina-2*DOLPHIN_JUMP.staminaCost)/CONDITION_BALANCE.energy.drainPerStroke);
        console.log(`| ${c.name} | ${stamina} | ${armBudget} | ${demand(200)} | ${demand(400)} |`);
    }
    console.log('PERFECT中点的简化时间指标：旧→新，单位秒；不含海豚使用。');
    console.log('| 角色 | 200m耗尽手划 | 200m耗尽踢腿 | 400m耗尽手划 | 400m耗尽踢腿 |');
    console.log('| --- | ---: | ---: | ---: | ---: |');
    for(const c of roster) {
        const cells=[200,400].flatMap(distance=>[center.emptySpeed,kick].map(speed=>
            [previous[c.id],c.stamina].map(stamina=>screeningTime(c,level,stamina,distance,center,speed).toFixed(2)).join(' → ')));
        console.log(`| ${c.name} | ${cells.join(' | ')} |`);
    }
    // 不只取PERFECT最前沿：额外输出前中后三点对应的整个名单差距。
    for(const distance of [200,400])for(const strategy of ['手划','踢腿']) {
        const spreads=samples.map(sample=>{
            const speed=strategy==='手划'?sample.emptySpeed:kick;
            return [previous,null].map(old=>{
                const times=C.map(c=>screeningTime(c,level,old?old[c.id]:c.stamina,distance,sample,speed));
                return +(Math.max(...times)-Math.min(...times)).toFixed(2);
            });
        });
        console.log(`${distance}m 耗尽后${strategy}，前中后三点全名单时间极差 旧→新：${JSON.stringify(spreads)}`);
    }
}
