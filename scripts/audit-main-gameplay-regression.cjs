// 比较实际旧源码与当前源码的普通比赛，不切分支、不启动 Creator、不改运行时配置。
// 用法：固定 typescript@5.4.5 环境下，node scripts/audit-main-gameplay-regression.cjs <旧源码快照目录>
// 快照须含 assets/scripts、assets/startup 与 assets/resources/config/tuning.json。
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createAiHarness } = require('../tests/helpers/ai-race-harness.cjs');

const baselineRoot = process.argv[2];
assert.ok(baselineRoot, '需要合入前的源码快照目录');
const old = createAiHarness({ scriptsRoot: path.resolve(baselineRoot, 'assets/scripts'),
    tuningPath: path.resolve(baselineRoot, 'assets/resources/config/tuning.json') });
const current = createAiHarness();
const characters = current.load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS;
assert.equal(fs.readFileSync(path.join(baselineRoot, 'assets/resources/config/tuning.json'), 'utf8').replace(/\r/g, ''),
    fs.readFileSync(path.join(current.root, 'assets/resources/config/tuning.json'), 'utf8').replace(/\r/g, ''), '对比版本调参数值不同');

function snapshot(actor) {
    const s = actor.body, m = s.motor;
    return [s.distance, s.currentSpeed, s.movementSpeed, s.node.position.x, s.node.position.y, s.node.position.z,
        s.netHeading, s.netHeadingTurnRate, s.netAxialRoll, s.netAxialRollVelocity,
        s.netCollisionPitch, s.netCollisionPitchVelocity, s.isRacing, s.isCollisionActive,
        s.heartRate, actor.condition.energy, actor.condition.energyRatio, s.ultimate.energy,
        m.leftArmCycle, m.rightArmCycle, m.leftKickCycle, m.rightKickCycle,
        m.ability.id, m.ability.depth, m.ability.stacks];
}
let cases = 0, pairedSteps = 0;
for (const character of process.argv.includes('--players-only') ? [] : characters) for (const distance of [200, 400]) for (const fps of [30, 60]) for (const level of [1, 15, 30]) {
    const actors = [old, current].map(h => {
        h.load('core/GameBalance').setRaceDifficulty('competitive');
        h.load('core/GameBalance').setSoloRaceDistance(distance);
        h.load('core/SharedRNG').reseedSharedRandom(12345);
        return h.create(character.id, level, .85);
    });
    let frame = 0;
    for (; frame < fps * 600 && actors.some(a => a.body.isRacing); frame++) {
        // 覆盖普通碰撞反馈，娱乐组件保持未启用。
        if (frame === fps * 12 || frame === fps * 28) for (const a of actors) {
            a.body.applyCollisionImpulse(-.2, .15);
            a.body.applyCollisionAxialImpulse(.3);
            a.body.applyCollisionPitchImpulse(.15);
        }
        for (const actor of actors) actor.step(1 / fps);
        assert.deepEqual(snapshot(actors[1]), snapshot(actors[0]), `${character.id} ${distance}米 ${fps}Hz 等级${level} 第${frame}步`);
        pairedSteps++;
    }
    assert.ok(actors.every(a => !a.body.isRacing && a.body.distance === distance), `${character.id} 未完成${distance}米`);
    assert.equal(actors[1].body.motor._entertainment, null);
    assert.equal(actors[1].body.motor._whirlpool, null);
    assert.equal(actors[1].body.motor._giantWave, null);
    assert.equal(actors[1].body._geyser, null);
    assert.equal(actors[1].body._recoveryMotion, null);
    cases++;
    if (cases % 12 === 0) console.log(`已完成 ${cases} 组普通比赛对比，未发现数值或状态差异。`);
}
if (cases) console.log(JSON.stringify({ 对比组数: cases, 逐步对比次数: pairedSteps, 角色数: characters.length,
    赛程: [200, 400], 帧率: [30, 60], 等级: [1, 15, 30], 结果: '所有采样字段完全一致' }));

let playerCases = 0, playerSteps = 0;
const { StrokeType } = current.load('core/GameConstants');
const pressPattern = [StrokeType.LEFT, StrokeType.LEFT, StrokeType.RIGHT, StrokeType.LEFT, StrokeType.RIGHT, StrokeType.RIGHT];
const releaseTargets = [.15, .35, .5, .8];
for (const character of characters) for (const fps of [30, 60]) {
    const actors = [old, current].map(h => {
        h.load('core/SharedRNG').reseedSharedRandom(67890);
        h.load('core/GameBalance').setSoloRaceDistance(400);
        const actor = h.create(character.id, 15, .85);
        actor.ai.stopSwimming(); actor.body.isAI = false;
        const condition = new (h.load('condition/PlayerConditionModel').PlayerConditionModel)();
        condition.setProgressionOverrides({ energyTotal: actor.profile.balance.energyTotal });
        condition.setInfiniteStamina(character.abilityId === 'exoskeleton'); condition.reset();
        actor.condition = condition; actor.body.onDolphinJumpEnergyCost = cost => condition.consumeEnergy(cost);
        const { InputRouter } = h.load('core/InputRouter');
        actor.router = new InputRouter(actor.body.node, {
            onStrokeHeld: (side, held, pre) => { actor.body.handleStrokeHeld(side, held, pre); return true; },
            onStroke: side => actor.body.handleStroke(side),
            onKickStroke: (side, confirmed) => actor.body.handleKickStroke(side, confirmed),
        });
        actor.step = dt => {
            actor.router.tick();
            actor.condition.syncHeartRate(actor.body.heartRate);
            actor.body.applyConditionSpeedScale(actor.condition.efficiencyModifier);
            actor.body.applyConditionCadenceScale(actor.condition.strokeCadenceScale);
            actor.body.stepSimulation(dt);
            for (const input of actor.body.consumeConditionInputs()) actor.condition.updateFromStroke(input);
            return actor.body.consumeRhythmResults();
        };
        return actor;
    });
    let activeSide = null, pressTime = 0, nextPress = 0, pressIndex = 0, rated = 0;
    const now = Date.now;
    try {
        for (let frame = 0; frame < fps * 90; frame++) {
            const seconds = frame / fps;
            Date.now = () => 100000 + seconds * 1000;
            if (activeSide === null && seconds >= nextPress) {
                activeSide = pressPattern[pressIndex % pressPattern.length]; pressTime = seconds;
                for (const actor of actors) actor.router.handleScreenStroke(activeSide);
            } else if (activeSide !== null) {
                const target = releaseTargets[pressIndex % releaseTargets.length];
                const motor = actors[0].body.motor;
                const shortTap = pressIndex % 7 === 0 && seconds - pressTime >= 1 / fps;
                if (shortTap || (motor.isActiveStrokeHeld(activeSide) && motor.activeStrokeReleaseProgress(activeSide) >= target) || seconds - pressTime > 2) {
                    for (const actor of actors) actor.router.handleScreenStrokeEnd(activeSide);
                    activeSide = null; nextPress = seconds + .08; pressIndex++;
                }
            }
            if (frame === fps * 30 || frame === fps * 60) {
                assert.equal(actors[1].body.tryDolphinJump(), actors[0].body.tryDolphinJump());
            }
            const results = actors.map(actor => actor.step(1 / fps));
            rated += results[0].length;
            assert.deepEqual(results[1], results[0], `${character.id} 玩家松手判定 第${frame}步`);
            assert.deepEqual(snapshot(actors[1]), snapshot(actors[0]), `${character.id} 玩家触控 ${fps}Hz 第${frame}步`);
            playerSteps++;
        }
    } finally { Date.now = now; }
    assert.ok(rated > 10, `${character.id} 玩家输入没有进入实际松手判定`);
    playerCases++;
}
console.log(JSON.stringify({ 玩家输入对比组数: playerCases, 逐步对比次数: playerSteps,
    覆盖: '短按踢水、连续同侧、左右切换、提前和超时松手、海豚按钮、体力与心率', 结果: '状态与松手判定完全一致' }));
