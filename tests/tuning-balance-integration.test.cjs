// 使用真实业务模块与本机 Cocos 数学实现；只替代资源加载和本地存储。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { replayStrokeFeel } = require('./helpers/stroke-feel-replay.cjs');

// 保存本轮调参前的关键值，便于直接比较同一输入而非只检查配置常量。
const PREVIOUS_STROKE_FEEL = {
    'speed.strokeBaseAccel': 1.7, 'speed.strokeQualityAccel': 2.1,
    'speed.strokeHeldBaseRatio': 0.6, 'speed.strokeAccelDurationRatio': 0.35,
    'speed.strokeImpulseSharpness': 0.6, 'speed.poolDeceleration': 0.05,
    'speed.baseDrag': 0.42, 'speed.highSpeedDrag': 0.18,
    'difficulty.beginner.armCycleSpeedScale': 0.68,
    'motion.heldMotionSpeedScale': 0.8, 'strokeQuality.armCycleLowSpeedPerSecond': 1.5,
};

function setup(externalModules = {}) {
    const harness = createHarness({ 'cc/env': { NATIVE: false }, ...externalModules });
    const saved = new Map();
    const project = JSON.parse(fs.readFileSync(path.join(harness.root, 'assets/resources/config/tuning.json'), 'utf8'));
    Object.assign(harness.cc, {
        JsonAsset: class {}, native: {},
        Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
        sys: { localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } },
        resources: { load(_path, _type, callback) { callback(null, { json: project }); } },
    });
    const load = relative => harness.load(path.join(harness.root, 'assets/scripts', relative + '.ts'));
    const tuning = load('core/TuningDebugControls');
    const controls = new Map(tuning.TUNING_GROUPS.flatMap(group => group.controls.map(control => [control.id, control])));
    return { ...harness, loadModule: load, tuning, controls, project, saved };
}

function heldStrokeFixture(ratio = 0.6, fixedSpeed = true) {
    const h = setup();
    h.tuning.loadSavedTuningAsync(() => {});
    h.controls.get('speed.strokeHeldBaseRatio').set(ratio);
    const { SwimmerMotor } = h.loadModule('swimmer/SwimmerMotor');
    const { StrokeType } = h.loadModule('core/GameConstants');
    const motor = new SwimmerMotor();
    motor.startRace(0, 2);
    const inputs = [];
    if (fixedSpeed) motor._physics.step = (state, input) => { inputs.push(input); return state; };
    const start = (side = StrokeType.LEFT, preHeld = 0.2) => {
        motor.setStrokeHeld(side, true, preHeld);
        motor.recordStroke(side);
        return side === StrokeType.LEFT ? motor._leftActions[0] : motor._rightActions[0];
    };
    return { ...h, motor, StrokeType, inputs, start };
}

test('GOOD 推进倍率只改推进，完美区判定与按住预支不变，新参数可保存重载', () => {
    const sample = (progress, goodScale) => {
        const h = heldStrokeFixture();
        h.loadModule('core/GameBalance').setRaceDifficulty('beginner');
        h.controls.get('speed.strokeGoodPropulsionScale').set(goodScale);
        h.motor.update(.3, { isAI: false });
        const action = h.start();
        const seconds = Math.PI * 2 * progress / h.motor.currentActionCycleSpeed();
        for (let i = 0; i < 100; i++) h.motor.update(seconds / 100, { isAI: false });
        action.progress = Math.PI * 2 * progress;
        const result = h.motor.setStrokeHeld(h.StrokeType.LEFT, false);
        return { quality: result.strokeQuality, paid: action.heldBaseImpulse,
            total: action.heldBaseImpulse + h.motor._strokeAcceleration * h.motor._strokeAccelerationSeconds };
    };
    for (const progress of [.24, .25, .375, .5]) {
        const reduced = sample(progress, .6), full = sample(progress, 1);
        assert.equal(reduced.quality, full.quality);
        assert.equal(reduced.paid, full.paid);
        if (progress < .25) assert.ok(reduced.total < full.total);
        else { assert.equal(full.quality, 1); assert.equal(reduced.total, full.total); }
    }
    const h = setup(); h.tuning.loadSavedTuningAsync(() => {});
    for (const [id, value] of [['speed.strokeGoodPropulsionScale', .7], ['speed.strokeTimeCompensation', .85]]) {
        h.controls.get(id).set(value);
    }
    assert.equal(h.tuning.saveCurrentTuning().ok, true);
    h.controls.get('speed.strokeGoodPropulsionScale').set(0);
    h.controls.get('speed.strokeTimeCompensation').set(0);
    h.tuning.loadSavedTuningAsync(() => {});
    assert.equal(h.controls.get('speed.strokeGoodPropulsionScale').get(), .7);
    assert.equal(h.controls.get('speed.strokeTimeCompensation').get(), .85);
});

test('首版手感消除常用快速交替划水的漏接，原配置可复现每两次漏接一次', () => {
    const h = setup(); h.tuning.loadSavedTuningAsync(() => {});
    const current = replayStrokeFeel(h, { period: 0.3, hold: 0.28 });
    for (const [id, value] of Object.entries(PREVIOUS_STROKE_FEEL)) h.controls.get(id).set(value);
    const previous = replayStrokeFeel(h, { period: 0.3, hold: 0.28 });
    assert.equal(previous.rejected, 50);
    assert.equal(current.rejected, 0);
    assert.equal(current.accepted, 100);
    assert.ok(current.mean > previous.mean + 0.4);
});

test('新手感完美节奏优于抢划，换手速度起伏受控，30/60/120 帧均能接上', () => {
    const h = setup(); h.tuning.loadSavedTuningAsync(() => {});
    const steady = [];
    for (const fps of [30, 60, 120]) {
        const fast = replayStrokeFeel(h, { period: 0.3, hold: 0.28, fps });
        const perfect = replayStrokeFeel(h, { period: 0.4, hold: 0.38, fps });
        assert.equal(fast.rejected, 0);
        assert.equal(perfect.rejected, 0);
        assert.ok(perfect.mean > fast.mean + 0.05, '时机准确比无脑抢划更有效');
        assert.ok(perfect.mean > 2.35 && perfect.mean < 2.7);
        assert.ok(perfect.ripple < 0.1, '换手时保留惯性');
        steady.push(perfect.mean);
    }
    assert.ok(Math.max(...steady) - Math.min(...steady) < 0.15);
});

test('无输入滑行保留约一秒半余韵，疲劳仍只在低体力时降低动作轮速', () => {
    const h = setup(); h.tuning.loadSavedTuningAsync(() => {});
    const { SwimmerMotor } = h.loadModule('swimmer/SwimmerMotor');
    const coast = () => {
        const motor = new SwimmerMotor(); motor.startRace(0, 2.5);
        let seconds = 0;
        while (motor.currentSpeed > 1.25 && seconds < 10) {
            motor.update(1 / 120, { isAI: false }); seconds += 1 / 120;
        }
        return seconds;
    };
    const current = coast();
    assert.ok(current > 1.3 && current < 1.6);
    for (const [id, value] of Object.entries(PREVIOUS_STROKE_FEEL)) h.controls.get(id).set(value);
    assert.ok(coast() < current - 0.4);
    const { energyDepletionCadenceScale } = h.loadModule('core/ConditionBalance');
    assert.equal(energyDepletionCadenceScale(1), 1);
    assert.equal(energyDepletionCadenceScale(0.15), 1);
    assert.ok(energyDepletionCadenceScale(0.1) < 1);
    assert.equal(energyDepletionCadenceScale(0), 0.6);
});

test('按住未松手已有实际推进，左右对称且不受本地预持有时间影响', () => {
    const outcomes = [];
    for (const sideName of ['LEFT', 'RIGHT']) for (const preHeld of [0, 0.2]) {
        const h = heldStrokeFixture(0.6, false);
        const action = h.start(h.StrokeType[sideName], preHeld);
        for (let i = 0; i < 12; i++) h.motor.update(1 / 60, { isAI: preHeld === 0 });
        assert.ok(action.heldBaseImpulse > 0);
        assert.equal(action.strokeQualitySettled, false);
        assert.equal(h.motor._strokeAccelerationSeconds, 0, '按住不创建松手脉冲');
        outcomes.push(h.motor.currentSpeed);
    }
    for (const speed of outcomes) assert.ok(Math.abs(speed - outcomes[0]) < 1e-10);
    const old = heldStrokeFixture(0, false);
    old.start();
    for (let i = 0; i < 12; i++) old.motor.update(1 / 60, { isAI: false });
    assert.ok(outcomes[0] > old.motor.currentSpeed + 0.03, '真实物理下按住阶段比原规则保留更多速度');
});

test('左右换手时按住推进叠加，上一划脉冲仍按原时长衰减', () => {
    const h = heldStrokeFixture();
    h.start();
    for (let i = 0; i < 15; i++) h.motor.update(1 / 60, { isAI: false });
    h.motor.setStrokeHeld(h.StrokeType.LEFT, false);
    const seconds = h.motor._strokeAccelerationSeconds;
    const amplitude = h.motor._strokeAcceleration;
    assert.ok(seconds > 0);
    h.start(h.StrokeType.RIGHT);
    assert.equal(h.motor._strokeAccelerationSeconds, seconds);
    h.motor.update(1 / 60, { isAI: false });
    assert.ok(Math.abs(h.motor._strokeAccelerationSeconds - (seconds - 1 / 60)) < 1e-10);
    assert.equal(h.motor._strokeAcceleration, amplitude);
    assert.ok(h.motor._rightActions[0].heldBaseImpulse > 0);
});

test('松手只支付剩余基础预算，完美质量奖励保持一致且不会二次结算', () => {
    const totals = [];
    for (const ratio of [0, 0.6, 1]) {
        const h = heldStrokeFixture(ratio);
        const action = h.start();
        const targetSeconds = Math.PI * 2 * 0.375 / (h.motor.currentActionCycleSpeed()
            * h.loadModule('core/InputTuning').MOTION_TUNING.heldMotionSpeedScale);
        for (let i = 0; i < 60; i++) h.motor.update(targetSeconds / 60, { isAI: false });
        const result = h.motor.setStrokeHeld(h.StrokeType.LEFT, false);
        assert.equal(result.strokeQuality, 1);
        totals.push(action.heldBaseImpulse + h.motor._strokeAcceleration * h.motor._strokeAccelerationSeconds);
        const pulse = h.motor._strokeAcceleration;
        assert.equal(h.motor.setStrokeHeld(h.StrokeType.LEFT, false), null);
        assert.equal(h.motor._strokeAcceleration, pulse);
        const paid = action.heldBaseImpulse;
        h.motor.update(1 / 60, { isAI: false });
        assert.equal(action.heldBaseImpulse, paid, '松手之后停止预支');
    }
    for (const total of totals) assert.ok(Math.abs(total - totals[0]) < 1e-9, '同一时机的基础加质量总预算不增加');
});

test('超时停止当前划的预支，30/60/120 帧及跨超时大帧均不超预算', () => {
    const impulses = [];
    for (const fps of [30, 60, 120, 4]) {
        const h = heldStrokeFixture();
        const action = h.start();
        for (let i = 0; i < fps * 2 && !action.strokeQualitySettled; i++) h.motor.update(1 / fps, { isAI: false });
        assert.equal(action.strokeQualitySettled, true);
        assert.equal(h.motor._lastStrokeQuality, 0);
        assert.ok(action.heldBaseImpulse <= action.heldBaseImpulseBudget + 1e-10);
        const paid = action.heldBaseImpulse;
        assert.equal(h.motor.consumeHeldBaseAcceleration(action, 10), 0);
        assert.equal(action.heldBaseImpulse, paid);
        impulses.push(paid);
        h.motor.setStrokeHeld(h.StrokeType.LEFT, false);
        h.motor.startRace(0, 2);
        h.motor.update(1 / 60, { isAI: false });
        assert.equal(h.inputs.at(-1).strokeAcceleration, 0, '重开比赛不残留推进');
    }
    for (const impulse of impulses) assert.ok(Math.abs(impulse - impulses[0]) < 1e-9);
});

test('真实输入短按仅踢腿，达到长按门槛后才开始手臂预支', () => {
    const h = heldStrokeFixture();
    const { InputRouter } = h.loadModule('core/InputRouter');
    let now = 1000;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
        const router = new InputRouter(new h.cc.Node(), {
            onKickStroke: side => h.motor.recordKickTap(side),
            onStrokeHeld: (side, held, preHeld) => { h.motor.setStrokeHeld(side, held, preHeld); return true; },
            onStroke: side => h.motor.recordStroke(side),
        });
        router.handleScreenStroke(h.StrokeType.LEFT);
        now += 50;
        router.handleScreenStrokeEnd(h.StrokeType.LEFT);
        h.motor.update(0.05, { isAI: false });
        assert.equal(h.motor._leftActions.length, 0);
        assert.equal(h.inputs.at(-1).strokeAcceleration, 0);
        router.handleScreenStroke(h.StrokeType.RIGHT);
        now += 250;
        router.tick();
        h.motor.update(1 / 60, { isAI: false });
        assert.ok(h.inputs.at(-1).strokeAcceleration > 0);
    } finally {
        Date.now = originalNow;
    }
});

test('三个入口的 AI 阵容强度一致，换局后体重匹配模型，同一种子可复现', () => {
    class Rig {
        setModelVariant(id) { this.modelVariantId = id; }
        setOutlineVisible() {} setColorVariant() {} setColorOverride() {} setSkinOutfit() {} build() {}
    }
    class AiController {}
    let Motor;
    class Swimmer {
        constructor() { this.motor = new Motor(); }
        configureCourse() {} setEnergyGainAptitude() {}
    }
    const { cc, loadModule } = setup({
        '../entity/CartoonSwimmerRig': { CartoonSwimmerRig: Rig },
        '../entity/AISwimmerController': { AISwimmerController: AiController },
        '../entity/Swimmer': { Swimmer },
        '../backend/PlayerData': { PlayerData: { nickName: '测试玩家' } },
    });
    Motor = loadModule('swimmer/SwimmerMotor').SwimmerMotor;
    const MathNode = cc.Node;
    cc.Node = class extends MathNode {
        constructor(name) { super(); this.name = name; }
        setParent(parent) { this.parent = parent; parent?.children.push(this); }
        addComponent(Type) { const component = new Type(); component.node = this; return component; }
    };
    cc.Layers = { Enum: { DEFAULT: 1 } };
    const { CompetitorManager } = loadModule('competitor/CompetitorManager');
    const { characterWeightForModel } = loadModule('app/PlayerCharacterConfig');
    const { reseedSharedRandom } = loadModule('core/SharedRNG');
    const { setRaceDifficulty } = loadModule('core/GameBalance');
    const snapshots = [];
    for (const mode of ['beginner', 'competitive', 'championship']) {
        setRaceDifficulty(mode);
        reseedSharedRandom(12345);
        const manager = new CompetitorManager({
            laneLayout: { laneCount: 8, centerZ: lane => lane * 2.625 },
            courseLayout: { startX: 0, swimY: 0 }, playerLaneIndex: 0, primaryAiLaneIndex: 1,
        });
        const { aiSwimmers, aiControllers } = manager.buildAi(new cc.Node('对手'));
        const frames = [];
        for (let round = 0; round < 5; round++) {
            if (round > 0) manager.reassignAiRoster(aiSwimmers, aiControllers);
            frames.push(aiSwimmers.map((swimmer, index) => {
                const id = swimmer.cartoonRig.modelVariantId;
                assert.equal(swimmer.motor.weight, characterWeightForModel(id));
                return [id, swimmer.motor.weight, aiControllers[index].difficulty];
            }));
        }
        snapshots.push(frames);
    }
    assert.deepEqual(snapshots[0], snapshots[1]);
    assert.deepEqual(snapshots[0], snapshots[2]);
});

test('调试入口连续同侧划水不偏航，其余入口仍转向，切换不污染全局参数', () => {
    const h = heldStrokeFixture();
    const { setRaceDifficulty, getRaceModeTitle } = h.loadModule('core/GameBalance');
    const steering = h.loadModule('core/SteeringTuning').STEERING_TUNING;
    const original = { ...steering };
    for (const mode of ['beginner', 'competitive', 'beginner', 'championship']) {
        setRaceDifficulty(mode);
        h.motor.startRace(0, 2);
        h.motor.setSteeringEnabled(true);
        for (let stroke = 0; stroke < 3; stroke++) {
            h.start();
            for (let i = 0; i < 15; i++) h.motor.update(1 / 60, { isAI: false });
            h.motor.setStrokeHeld(h.StrokeType.LEFT, false);
            for (let i = 0; i < 40; i++) h.motor.update(1 / 60, { isAI: false });
        }
        if (mode === 'beginner') {
            assert.equal(getRaceModeTitle(), '手感调试');
            assert.equal(h.motor.heading, 0);
            assert.equal(h.motor.headingTurnRate, 0);
            assert.equal(h.motor.lateralOffset, 0);
            h.motor.correctHeading(0.8, 0.7, 1);
            h.motor.returnToLaneFromPoolWall(1);
            h.motor.update(1 / 60, { isAI: false });
            assert.equal(h.motor.heading, 0, '网络校正和侧墙处理不能重新引入偏航');
        } else {
            assert.ok(Math.abs(h.motor.heading) > 0.001);
            assert.ok(Math.abs(h.motor.lateralOffset) > 0.001);
        }
    }
    assert.deepEqual(steering, original);
});

test('AI 各入口共用世锦赛策略和轮速，玩家与远端真人继续使用入口轮速', () => {
    const h = heldStrokeFixture();
    const { setRaceDifficulty, getRaceAiDifficultyConfig, getRaceDifficultyConfig } = h.loadModule('core/GameBalance');
    const { getRaceArmCycleSpeedScale, RACE_DIFFICULTY_TUNING } = h.loadModule('core/InputTuning');
    let aiSpeed;
    for (const mode of ['beginner', 'competitive', 'championship']) {
        setRaceDifficulty(mode);
        assert.equal(getRaceAiDifficultyConfig(), getRaceDifficultyConfig('championship'));
        h.motor.startRace(0, 2, 0, true);
        const speed = h.motor.currentActionCycleSpeed();
        if (aiSpeed === undefined) aiSpeed = speed;
        assert.equal(speed, aiSpeed);
        assert.equal(getRaceArmCycleSpeedScale(true), RACE_DIFFICULTY_TUNING.championship.armCycleSpeedScale);
        h.motor.startRace(0, 2, 0, false);
        assert.ok(Math.abs(h.motor.currentActionCycleSpeed() / aiSpeed
            - RACE_DIFFICULTY_TUNING[mode].armCycleSpeedScale / RACE_DIFFICULTY_TUNING.championship.armCycleSpeedScale) < 1e-10);
        assert.equal(getRaceArmCycleSpeedScale(false), RACE_DIFFICULTY_TUNING[mode].armCycleSpeedScale);
    }
});

test('角色仅三项属性成长，体重和蓄气在升级后保持固有值', () => {
    const { tuning, loadModule } = setup();
    tuning.loadSavedTuningAsync(() => {});
    const { PLAYER_CHARACTER_DEFINITIONS } = loadModule('app/PlayerCharacterConfig');
    const { resolvePlayerBalance, resolveCharacterDisplayStats } = loadModule('progression/PlayerBalanceOverrides');
    for (const character of PLAYER_CHARACTER_DEFINITIONS) {
        const first = resolvePlayerBalance(character, 1, 60, character.weight, character.energyGain);
        const max = resolvePlayerBalance(character, 60, 60, character.weight, character.energyGain);
        assert.equal('kick' in character, false);
        assert.equal('kickMaxSpeed' in max, false);
        const firstDisplay = resolveCharacterDisplayStats(character, 1, 60);
        const maxDisplay = resolveCharacterDisplayStats(character, 60, 60);
        assert.deepEqual(Object.keys(maxDisplay).sort(), ['burst', 'stamina', 'technique']);
        for (const key of Object.keys(maxDisplay)) assert.ok(maxDisplay[key] > firstDisplay[key]);
        for (const value of [first, max]) {
            assert.equal(value.weight, character.weight);
            assert.equal(value.energyGainAptitude, character.energyGain);
        }
    }
});

test('所有角色和等级共用踢腿上限，全局调参即时生效且水下仍可推进', () => {
    const { tuning, loadModule, controls } = setup();
    tuning.loadSavedTuningAsync(() => {});
    const { PLAYER_CHARACTER_DEFINITIONS } = loadModule('app/PlayerCharacterConfig');
    const { resolvePlayerBalance } = loadModule('progression/PlayerBalanceOverrides');
    const { SwimmerMotor } = loadModule('swimmer/SwimmerMotor');
    const { StrokeType } = loadModule('core/GameConstants');
    for (const character of PLAYER_CHARACTER_DEFINITIONS) for (const level of [1, 60]) {
        const motor = new SwimmerMotor();
        motor.setPlayerBalance(resolvePlayerBalance(character, level, 60, character.weight, character.energyGain));
        motor.startRace(0, 2.7);
        motor.recordKickTap(StrokeType.LEFT);
        motor.recordKickTap(StrokeType.RIGHT);
        assert.equal(motor.computeKickAcceleration(), 0, '达到共用上限后，角色或等级不得提供额外踢腿推进');
        controls.get('speed.kickMaxSpeed').set(3.2);
        assert.ok(motor.computeKickAcceleration() > 0, '无需重建角色即可采用全局踢腿调参');
        controls.get('speed.kickMaxSpeed').set(2.7);
        assert.equal(motor.computeKickAcceleration(), 0);
        motor.setGlidePhase(true);
        assert.ok(motor.computeKickAcceleration() > 0, '水下踢腿继续绕过水面上限衰减');
    }
});

test('项目配置加载后保留主干柔性参数，并采用满槽消耗与新侧墙数值', () => {
    const { tuning, controls, project } = setup();
    let completed = 0;
    tuning.loadSavedTuningAsync(() => completed++);
    assert.equal(completed, 1);
    for (const [id, value] of Object.entries(project.values)) {
        assert.ok(controls.has(id), `配置必须有对应控件：${id}`);
        assert.equal(controls.get(id).get(), value, `项目配置不应被意外改写：${id}`);
    }
    assert.equal(controls.get('ultimate.dolphinCost').get(), 100);
    assert.equal(controls.get('ultimate.maxEnergy').get(), 100);
    assert.equal(controls.get('steer.poolWallMaxTurnRate').get(), 48);
});

test('非法值被忽略、超界值受限，最新本地调参与旧参数迁移仍可加载', () => {
    const { tuning, controls, project, saved } = setup();
    project.values['speed.maxSpeed'] = '错误值';
    project.values['steer.maxHeading'] = 200;
    const originalSpeed = controls.get('speed.maxSpeed').get();
    tuning.loadSavedTuningAsync(() => {});
    assert.equal(controls.get('speed.maxSpeed').get(), originalSpeed);
    assert.ok(controls.get('steer.maxHeading').get() < 90);
    const result = tuning.saveCurrentTuning();
    assert.equal(result.ok, true);
    const [key, encoded] = [...saved.entries()][0];
    const local = JSON.parse(encoded);
    local.updatedAt = '2099-01-01T00:00:00.000Z';
    local.values['speed.maxSpeed'] = 4.1;
    local.values['motion.proneChestRollDegrees'] = 39;
    local.values['ultimate.maxEnergy'] = 100;
    local.values['ultimate.dolphinCost'] = 30;
    saved.set(key, JSON.stringify(local));
    tuning.loadSavedTuningAsync(() => {});
    assert.equal(controls.get('speed.maxSpeed').get(), 4.1);
    assert.equal(controls.get('motion.proneChestRollDegrees').get(), 39);
    assert.equal(controls.get('ultimate.dolphinCost').get(), 100);
});

test('海豚跳 30 点与 99 点不可释放，100 点可释放且清空；降低上限消除溢出', () => {
    const { loadModule, controls } = setup();
    const { UltimateEnergyModel } = loadModule('condition/UltimateEnergyModel');
    const energy = new UltimateEnergyModel();
    for (const value of [30, 99, 100]) {
        energy.applyNetEnergy(value, 1);
        assert.equal(energy.canAffordDolphin, value === 100);
    }
    energy.spendDolphin();
    assert.equal(energy.energy, 0);
    assert.equal(energy.canAffordDolphin, false);
    energy.applyNetEnergy(100, 1);
    controls.get('ultimate.maxEnergy').set(60);
    controls.get('ultimate.passivePerSecond').set(0);
    energy.tick(0);
    assert.equal(energy.energy, 60);
    assert.equal(controls.get('ultimate.dolphinCost').get(), 60);
    energy.spendDolphin();
    assert.equal(energy.energy, 0);
});

test('侧墙回正限速、左右对称并能在不同帧率下脱离，不影响随后玩家转向', () => {
    const { loadModule } = setup();
    const { SwimmerMotor } = loadModule('swimmer/SwimmerMotor');
    const { STEERING_TUNING } = loadModule('core/SteeringTuning');
    const radians = Math.PI / 180;
    for (const hz of [30, 60, 120]) for (const sign of [-1, 1]) {
        const motor = new SwimmerMotor();
        motor.correctHeading(-sign * 40 * radians, -sign * 90 * radians, 1);
        motor.returnToLaneFromPoolWall(sign);
        for (let step = 0; step < hz * 5; step++) {
            // 单独推进真实转向更新，不引入位移和划水输入。
            motor.updateSteering(1 / hz);
            assert.ok(Math.abs(motor.headingTurnRate) <= STEERING_TUNING.poolWallMaxTurnRate * radians + 1e-8);
            assert.ok(sign * motor.heading <= STEERING_TUNING.poolWallEscapeHeadingDegrees * radians + 1e-8);
        }
        assert.ok(Math.abs(motor.heading - sign * STEERING_TUNING.poolWallEscapeHeadingDegrees * radians) < 0.01);
        assert.equal(motor.headingTurnRate, 0);
        motor.correctHeading(-sign * 5 * radians, 0, 1);
        motor.updateSteering(1 / hz);
        assert.equal(motor.headingTurnRate, 0, '脱墙后回正弹簧必须停止');
    }
});
