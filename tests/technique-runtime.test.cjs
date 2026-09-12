const test=require('node:test');
const assert=require('node:assert/strict');
const {replay,load}=require('../scripts/analyze-stroke-efficiency.cjs');
const {SwimmerMotor}=load('swimmer/SwimmerMotor');
const {StrokeType}=load('core/GameConstants');
const {resolvePlayerBalance,techniquePropulsionScale}=load('progression/PlayerBalanceOverrides');
const {TECHNIQUE_BALANCE,SWIMMER_BALANCE,setRaceDifficulty}=load('core/GameBalance');
const {PLAYER_CHARACTER_DEFINITIONS}=load('app/PlayerCharacterConfig');
const {perfectWidthScale}=load('core/ConditionBalance');
const {resolveModifiersFromDigest}=load('progression/RaceModifiers');
const {feelSample}=require('../scripts/analyze-character-technique.cjs');
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const balance=technique=>resolvePlayerBalance({stamina:100,technique,burst:50},1,30,1,82);

test('蛙妹与忍者哥同级全PERFECT保留明显差距，侧滚心率及换手停顿不掩盖技巧',()=>{
    const frog=PLAYER_CHARACTER_DEFINITIONS.find(c=>c.id==='cartonSwimmer6');
    const ninja=PLAYER_CHARACTER_DEFINITIONS.find(c=>c.id==='cartonSwimmer10');
    for(const level of [1,30])for(const fps of [30,60])for(const gap of [.02,.08,.15]) {
        const a=feelSample(frog,level,gap,fps),b=feelSample(ninja,level,gap,fps);
        assert.equal(a.quality,1);assert.equal(b.quality,1);
        assert.equal(a.rejected,0);assert.equal(b.rejected,0);
        assert.ok(b.meanSpeed-a.meanSpeed>.14,`${level}/${fps}/${gap}: ${a.meanSpeed} / ${b.meanSpeed}`);
    }
});

test('技巧基准保持原84点手感，前中后及30/60/120Hz均有可见游速成长',()=>{
    for(const fps of [30,60,120])for(const target of [.34,.375,.41]) {
        const speeds=[82,84,96,113,125,143].map(t=>replay(target,true,false,{fps,heartRate:180,playerBalance:balance(t)}).meanSpeed);
        near(speeds[1],2.511,.025);
        for(let i=1;i<speeds.length;i++)assert.ok(speeds[i]>speeds[i-1]);
        for(const [index,points] of [[0,82],[2,96],[3,113],[4,125],[5,143]]) {
            const actual=speeds[index]/speeds[1],expected=1+(points-84)*.003;
            near(actual,expected,.012);
        }
    }
});

test('全角色首末级覆盖完整PERFECT区间，均优于提前GOOD且耗尽仍明显减速',()=>{
    for(const c of PLAYER_CHARACTER_DEFINITIONS)for(const level of [1,30])for(const hr of [80,180]) {
        const b=resolvePlayerBalance(c,level,30,c.weight,c.energyGain,c.heartRateTrait);
        const half=.125*perfectWidthScale(hr),start=.375-half,end=.375+half;
        const options={playerBalance:b,heartRate:hr};
        const good=replay(start-.005,true,false,options);
        const results=[start+.0001,.375,end-.0001].map(target=>replay(target,true,false,options));
        for(const r of results) {
            assert.equal(r.quality,1);assert.equal(r.rejected,0);
            assert.ok(r.meanSpeed>good.meanSpeed*1.035,`${c.name}/${level}/${hr}`);
        }
        const empty=replay(.375,true,false,{...options,propulsionScale:.15,cadenceScale:.6});
        assert.ok(empty.meanSpeed<results[1].meanSpeed*.72);
        assert.ok(empty.holdSeconds>results[1].holdSeconds*1.25);
    }
});

// 冻结游速以隔离技巧：更高游速带来的轮速变化属于间接效果，不应该误判为改变平衡规则。
function fixedStroke(technique,progress) {
    const m=new SwimmerMotor();m.setPlayerBalance(balance(technique));m.startRace(0,2);
    m.setSteeringEnabled(true);m._physics.step=s=>s;m.update(.3,{isAI:false});
    m.applyAuthoritativeHeartRate(140,true);m.setStrokeHeld(StrokeType.LEFT,true,.2);m.recordStroke(StrokeType.LEFT);
    const a=m._leftActions[0];
    for(let i=0;i<24;i++)m.update(1/240,{isAI:false});
    const paid=a.heldBaseImpulse;a.progress=progress*Math.PI*2;
    const result=m.setStrokeHeld(StrokeType.LEFT,false);
    return {m,a,paid,total:paid+m._strokeAcceleration*m._strokeAccelerationSeconds,result};
}
test('技巧同倍率作用于按住及GOOD/PERFECT/BAD总推进，不改变判定、偏航和侧滚',()=>{
    setRaceDifficulty('championship');
    try {
        for(const p of [.1,.2,.375]) {
            const low=fixedStroke(82,p),high=fixedStroke(125,p),ratio=techniquePropulsionScale(125)/techniquePropulsionScale(82);
            near(high.paid/low.paid,ratio);near(high.total/low.total,ratio);
            assert.deepEqual(high.a.ranges,low.a.ranges);assert.equal(high.result.strokeQuality,low.result.strokeQuality);
            assert.ok(Math.abs(low.m.headingTurnRate)>0);
            near(high.m.headingTurnRate,low.m.headingTurnRate);
            near(high.m._axialRoll.angleRadians,low.m._axialRoll.angleRadians);
            near(high.m._axialRoll.angularVelocityRadians,low.m._axialRoll.angularVelocityRadians);
        }
    } finally {setRaceDifficulty('beginner');}
});

test('技巧不影响独立踢腿、特殊初速及无划水超速滑行，普通AI仍用原基础推进',()=>{
    const motors=[82,125].map(t=>{const m=new SwimmerMotor();m.setPlayerBalance(balance(t));m.startRace(0,8,4.6);m.setGlidePhase(true);return m;});
    for(let i=0;i<1200;i++) {
        if(i===240)for(const m of motors)m.setGlidePhase(false);
        if(i%30===0)for(const m of motors)m.recordKickTap(i%60?StrokeType.LEFT:StrokeType.RIGHT);
        for(const m of motors)m.update(1/240,{isAI:false});
        near(motors[0].currentSpeed,motors[1].currentSpeed);near(motors[0].distance,motors[1].distance);
        near(motors[0].leftKickCycle,motors[1].leftKickCycle);
    }
    near(motors[0].burstLaunchSpeedScale,motors[1].burstLaunchSpeedScale);
    near(motors[0].burstWallLaunchSpeedScale,motors[1].burstWallLaunchSpeedScale);
    const ai=new SwimmerMotor();near(ai._effectiveStrokeQualityAccel,SWIMMER_BALANCE.strokeQualityAccel);
    near(motors[0]._effectiveComboMaxOvercap,ai._effectiveComboMaxOvercap);
});

test('联机角色ID和等级解析同一技巧倍率；每级单调增长且异常输入不产生无效推进',()=>{
    for(const c of PLAYER_CHARACTER_DEFINITIONS)for(const level of [1,30]) {
        assert.deepEqual(resolveModifiersFromDigest({characterId:c.id,level}).balance,
            resolvePlayerBalance(c,level,30,c.weight,c.energyGain,c.heartRateTrait));
    }
    for(let t=50;t<160;t++)assert.ok(techniquePropulsionScale(t+1)>techniquePropulsionScale(t));
    for(const t of [NaN,Infinity,-Infinity])near(techniquePropulsionScale(t),1);
    for(const t of [-1e30,1e30])assert.ok(Number.isFinite(techniquePropulsionScale(t))&&techniquePropulsionScale(t)>0);
    const old=TECHNIQUE_BALANCE.speedGainPerPoint;
    try {TECHNIQUE_BALANCE.speedGainPerPoint=0;near(techniquePropulsionScale(82),1);near(techniquePropulsionScale(125),1);}
    finally {TECHNIQUE_BALANCE.speedGainPerPoint=old;}
});

test('技巧在起划时锁定，调整与耗尽不会修改已领预算，下一划使用新倍率',()=>{
    const {m,a}=fixedStroke(84,.375),original=a.propulsionScale;
    m.setPlayerBalance(balance(125));m.setConditionSpeedScale(.15);
    near(a.propulsionScale,original);
    for(let i=0;i<240;i++)m.update(1/240,{isAI:false});
    m.setStrokeHeld(StrokeType.RIGHT,true,.2);m.recordStroke(StrokeType.RIGHT);
    near(m._rightActions[0].propulsionScale,.15*techniquePropulsionScale(125));
    m.startRace(0,2);m.update(.3,{isAI:false});m.setStrokeHeld(StrokeType.LEFT,true,.2);m.recordStroke(StrokeType.LEFT);
    near(m._leftActions[0].propulsionScale,techniquePropulsionScale(125));
});
