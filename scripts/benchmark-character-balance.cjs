// 玩家真实输入回放：满体力巡航与独立踢腿，包含固有技能、心率、侧滚和分类等待。
// 完整赛程、资源分配与AI决策另用 benchmark-ai.cjs；此处不把巡航速度当成胜率。
const fs = require('node:fs');
const path = require('node:path');
const { replay, load } = require('./analyze-stroke-efficiency.cjs');
const { PLAYER_CHARACTER_DEFINITIONS } = load('app/PlayerCharacterConfig');
const { resolveModifiersFromDigest } = load('progression/RaceModifiers');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { StrokeType } = load('core/GameConstants');

function measureCharacter(character, level = 1, fps = 60, mixed = false) {
    const profile = resolveModifiersFromDigest({ characterId: character.id, level });
    const swim = replay(.375, true, true, { playerBalance: profile.balance, abilityId: character.abilityId,
        heartRate: null, duration: 30, warmup: 10, fps, gap: .08, exactRelease: false,
        ...(mixed ? { targets: [.28,.32,.375,.43,.47] } : {}) });
    const motor = new SwimmerMotor();
    motor.setPlayerBalance(profile.balance); motor.setCharacterAbility(character.abilityId); motor.startRace();
    let start = 0, clock = 0, nextKick = 0, side = StrokeType.LEFT;
    for (let i = 0; i < fps * 30; i++) {
        if (clock + 1e-8 >= nextKick) {
            motor.recordKickTap(side); side = side === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
            nextKick += .25;
        }
        motor.update(1 / fps, { isAI: false }); clock += 1 / fps;
        if (i === fps * 10 - 1) start = motor.distance;
    }
    return { character: character.id, name: character.name, level, fps, mixed,
        speed: swim.meanSpeed, kickSpeed: (motor.distance - start) / 20,
        heartRate: swim.heartRate, hz: swim.hz, perfect: swim.perfect, good: swim.good, bad: swim.bad,
        perfectRate: swim.perfect / Math.max(1, swim.perfect + swim.good + swim.bad), rejected: swim.rejected };
}

if (require.main === module) {
    const results = [];
    for (const level of [1,30]) for (const fps of [30,60,120])
        for (const mixed of [false,true]) for (const character of PLAYER_CHARACTER_DEFINITIONS)
            results.push(measureCharacter(character, level, fps, mixed));
    const output = process.argv[2] || '.cache/character-balance.json';
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ note: '满体力、80ms换手间隔、自然心率；不含起跳、碰撞、技能跳跃或赛程体力预算。', results }, null, 2));
    console.log(JSON.stringify({ output, samples: results.length, rejected: results.reduce((n,r)=>n+r.rejected,0) }));
}
module.exports = { measureCharacter };
