// 真实控制器、实体、运动、心率、蓄气与比赛阶段；只替换渲染和骨骼时间线外壳。
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./cocos-math-harness.cjs');

function createAiHarness() {
    const h = createHarness({ 'cc/env': { NATIVE: false }, './CartoonSwimmerRig': { CartoonSwimmerRig: class {} } });
    const saved = JSON.parse(fs.readFileSync(path.join(h.root, 'assets/resources/config/tuning.json'), 'utf8'));
    const noop = () => {};
    Object.assign(h.cc, {
        Component: class {}, Camera: class {}, Color: class {}, JsonAsset: class {}, native: {},
        _decorator: { ccclass: () => C => C, property: (...args) => args.length > 1 ? undefined : noop },
        Tween: { stopAllByTarget: noop },
        sys: { localStorage: { getItem: () => null } },
        resources: { load(_p, _t, callback) { callback(null, { json: saved }); } },
    });
    const load = name => h.load(path.join(h.root, 'assets/scripts', name + '.ts'));
    load('core/TuningDebugControls').loadSavedTuningAsync(noop);
    const { Swimmer } = load('entity/Swimmer');
    const { AISwimmerController } = load('entity/AISwimmerController');
    const { AiConditionModel } = load('condition/AiConditionModel');
    const { resolveModifiersFromDigest, applyRaceModifiersToSwimmer } = load('progression/RaceModifiers');
    const { CHARACTER_POSE_TUNING: pose } = load('character/CharacterMotionTuning');

    function create(characterId = 'cartonSwimmer6', level = 1, difficulty = 1, initialDistance = 0, z = 0) {
        const body = new Swimmer();
        body.node = new h.cc.Node(); body.node.active = true; body.node.emit = noop; body.node.position.z = z;
        body.isAI = true;
        let turnTime = 0;
        // 与 CartoonSwimmerRig.updateRaceFlipTurn 相同的时长和阶段比例；不伪造运动距离。
        const rig = { axialRollVisualWeight: 1,
            startRaceFlipTurn() { turnTime = 0; return 0; },
            updateRaceFlipTurn(dt) {
                turnTime += dt;
                const approach = Math.max(.001, pose.flipTurnToKeyframe1Seconds) + Math.max(.001, pose.flipTurnToKeyframe2Seconds);
                const returning = Math.max(.001, pose.flipTurnReturnToSwimSeconds);
                return { approachTimeRatio: Math.min(1, turnTime / approach),
                    returnTimeRatio: Math.max(0, Math.min(1, (turnTime - approach) / returning)),
                    keyframe2Reached: turnTime >= approach, complete: turnTime >= approach + returning };
            },
        };
        body.cartoonRig = new Proxy(rig, { get: (target, key) => key in target ? target[key] : noop });
        body.updateBodyMotion = noop;
        body.configureCourse(body.courseLayout);
        const profile = resolveModifiersFromDigest({ characterId, level });
        applyRaceModifiersToSwimmer(body, profile);
        const condition = new AiConditionModel();
        const ai = new AISwimmerController(); ai.swimmer = body;
        ai.configure(characterId, level, difficulty, profile.balance.energyTotal);
        ai.bindCondition(condition);
        body.onDolphinJumpEnergyCost = cost => condition.consumeEnergy(cost);
        body.startRace(initialDistance, .8);
        ai.startSwimming();
        function step(dt) {
            condition.syncHeartRate(body.heartRate);
            body.applyConditionSpeedScale(condition.efficiencyModifier);
            body.applyConditionCadenceScale(condition.strokeCadenceScale);
            ai.stepSimulation(dt);
            body.stepSimulation(dt);
            condition.consumeStrokes(body.consumeAiConditionStrokes());
            // 正式流程会消费反馈；测试也不积压结果队列。
            body.consumeRhythmResults();
        }
        return { body, condition, ai, profile, step };
    }
    return { ...h, load, create };
}
module.exports = { createAiHarness };
