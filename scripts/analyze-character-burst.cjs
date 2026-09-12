// 按项目保存参数与泳池标记计算三种起跳；不启动 Creator、跳水、海豚仅计空中，蹬墙另计无输入滑行。
// 执行：npx --yes --package typescript@5.4.5 -c "node scripts/analyze-character-burst.cjs"
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { load } = require('./analyze-stroke-efficiency.cjs');
const { PLAYER_CHARACTER_DEFINITIONS } = load('app/PlayerCharacterConfig');
const { resolvePlayerBalance } = load('progression/PlayerBalanceOverrides');
const { PROGRESSION_BALANCE } = load('progression/ProgressionBalance');
const { DIVE_BALANCE, SWIMMER_BALANCE } = load('core/GameBalance');
const { DOLPHIN_JUMP } = load('core/DolphinJumpConfig');
const { SWIMMER_ACTION_TUNING } = load('character/CharacterMotionTuning');
const { STANDING_MODEL_LOCAL_Y, PLATFORM_STANDING_LIFT } = load('venue/RaceCourseLayout');
const { DEFAULT_POOL_DEFINITION } = load('venue/VenueConfig');
const { resolveDiveResult } = load('core/DiveResolver');
const bytes=fs.readFileSync(path.join(__dirname,'../assets/race/pool/LowPolyPool.glb'));
const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
const markerIndex=gltf.nodes.findIndex(n=>n.name==='start_block_top_near_marker');
assert.ok(markerIndex>=0,'缺少起跳台标记');
const marker=gltf.nodes[markerIndex];
assert.ok(!gltf.nodes.some(n=>n.children?.includes(markerIndex))&&!marker.matrix&&!marker.mesh,'标记结构已变，需重新核对标定高度');
// 当前 PoolScene 的模型根为单位变换。使用代码判定入水深度，非肉眼首次触水。
const platformY=marker.translation[1]-STANDING_MODEL_LOCAL_Y+PLATFORM_STANDING_LIFT;
const drop=platformY-SWIMMER_ACTION_TUNING.diveCrouchDrop
    -(DEFAULT_POOL_DEFINITION.swimY-SWIMMER_ACTION_TUNING.diveEntryDepth);
const rad=DIVE_BALANCE.launchAngleDegrees*Math.PI/180;
function measure(character,level) {
    const balance=resolvePlayerBalance(character,level,PROGRESSION_BALANCE.maxLevel,character.weight,character.energyGain,character.heartRateTrait);
    const speed=resolveDiveResult(1,balance.burstLaunchSpeedScale).launchSpeed;
    const vy=speed*Math.sin(rad),g=Math.max(.01,DIVE_BALANCE.launchGravity);
    const flight=(vy+Math.sqrt(vy*vy+2*g*drop))/g;
    const dolphinSpeed=DOLPHIN_JUMP.launchSpeed*balance.burstLaunchSpeedScale;
    return {dive:speed*Math.cos(rad)*flight,flight,
        dolphinAir:dolphinSpeed*dolphinSpeed*Math.sin(2*DOLPHIN_JUMP.launchAngleDegrees*Math.PI/180)/DOLPHIN_JUMP.gravity,
        wall:SWIMMER_BALANCE.flipTurnPushLaunchSpeed*balance.burstWallLaunchSpeedScale};
}
if (require.main === module) {
console.log('满蓄力起跳至代码判定入水的水平距离；海豚为空间足够时的纯空中距离。');
console.log('| 角色 | 1级爆发 | 跳水距离/m | 海豚空中距离/m | 蹬墙初速/m/s | 满级爆发 | 满级跳水距离/m |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for(const c of [...PLAYER_CHARACTER_DEFINITIONS].sort((a,b)=>a.burst-b.burst)) {
    const first=measure(c,1),last=measure(c,PROGRESSION_BALANCE.maxLevel);
    console.log(`| ${c.name} | ${c.burst} | ${first.dive.toFixed(2)} | ${first.dolphinAir.toFixed(2)} | ${first.wall.toFixed(2)} | ${c.burst+PROGRESSION_BALANCE.maxLevel-1} | ${last.dive.toFixed(2)} |`);
}

}

// 从脚贴墙开始统计赛程推进量；不包含接近墙壁的翻滚，不追加任何输入。
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { CHARACTER_POSE_TUNING } = load('character/CharacterMotionTuning');
const glideSeconds = CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveSeconds
    + CHARACTER_POSE_TUNING.flipTurnUnderwaterHoldSeconds + CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseSeconds;
function wallMeasure(character,level) {
    const speed=measure(character,level).wall;
    const push=speed*CHARACTER_POSE_TUNING.flipTurnReturnToSwimSeconds
        /(Math.min(2,Math.max(1,SWIMMER_BALANCE.flipTurnAccelerationExponent))+1);
    const motor=new SwimmerMotor();motor.startRace();motor.beginFlipTurnPhase();
    motor.completeFlipTurnPhase(50+push,speed);
    motor.setGlidePhase(true,SWIMMER_BALANCE.flipTurnUnderwaterGlideDrag,true);
    const steps=Math.ceil(glideSeconds*240);
    for(let i=0;i<steps;i++)motor.update(glideSeconds/steps,{isAI:false});
    return {speed,distance:motor.distance-50,exitSpeed:motor.currentSpeed};
}
if (require.main === module) {
console.log(`蹬墙加速 ${CHARACTER_POSE_TUNING.flipTurnReturnToSwimSeconds}s + 水下 ${glideSeconds}s，无划水/踢腿/碰撞，约240Hz离线模拟。`);
console.log('| 角色 | 1级蹬墙初速 | 1级推进/m | 浮出速度 | 满级初速 | 满级推进/m |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
for(const c of [...PLAYER_CHARACTER_DEFINITIONS].sort((a,b)=>a.burst-b.burst)) {
    const first=wallMeasure(c,1),last=wallMeasure(c,PROGRESSION_BALANCE.maxLevel);
    console.log(`| ${c.name} | ${first.speed.toFixed(2)} | ${first.distance.toFixed(2)} | ${first.exitSpeed.toFixed(2)} | ${last.speed.toFixed(2)} | ${last.distance.toFixed(2)} |`);
}

}

module.exports = { measure, wallMeasure };
