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
    // 已移除入口倍率；将旧 0.68 倍等价折入基础轮速，继续回放历史手感。
    'motion.heldMotionSpeedScale': 0.8, 'strokeQuality.armCycleLowSpeedPerSecond': 1.5 * 0.68,
    'strokeQuality.armCycleHighSpeedPerSecond': 2 * 0.68,
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

test('无输入滑行保留约一秒半余韵，低体力和耗尽不降低动作轮速', () => {
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
    assert.equal(energyDepletionCadenceScale(0.1), 1);
    assert.equal(energyDepletionCadenceScale(0), 1);
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
        // 模拟真实输入分类已经耗时，不能在模拟时钟 0 倒推 200ms 到负数哨兵区。
        h.motor.update(.3, { isAI: false });
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
    const { characterWeightForModel, characterHeartRateTraitForModel } = loadModule('app/PlayerCharacterConfig');
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
                assert.equal(swimmer.motor.heartRateTrait, characterHeartRateTraitForModel(id));
                return [id, swimmer.motor.weight, swimmer.motor.heartRateTrait, aiControllers[index].difficulty];
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

test('三个入口的玩家与 AI 共用轮速，AI 策略仍统一最高档', () => {
    const h = heldStrokeFixture();
    const { setRaceDifficulty, getRaceAiDifficultyConfig, getRaceDifficultyConfig } = h.loadModule('core/GameBalance');
    let aiSpeed;
    for (const mode of ['beginner', 'competitive', 'championship']) {
        setRaceDifficulty(mode);
        assert.equal(getRaceAiDifficultyConfig(), getRaceDifficultyConfig('championship'));
        h.motor.startRace(0, 2);
        h.motor.update(0.01, { isAI: true });
        const speed = h.motor.currentActionCycleSpeed();
        if (aiSpeed === undefined) aiSpeed = speed;
        assert.equal(speed, aiSpeed);
        h.motor.startRace(0, 2);
        h.motor.update(0.01, { isAI: false });
        assert.equal(h.motor.currentActionCycleSpeed(), aiSpeed);
    }
});

test('同侧回收续划与普通起划在完整 PERFECT 区间一致，左右手和不同轮速均保留起手时间', () => {
    const h = heldStrokeFixture();
    const { setRaceDifficulty } = h.loadModule('core/GameBalance');
    for (const mode of ['beginner', 'competitive', 'championship']) {
        setRaceDifficulty(mode);
        for (const speed of [1, 2, 3]) {
            for (const side of [h.StrokeType.LEFT, h.StrokeType.RIGHT]) {
                for (const target of [.249, .25, .3, .375, .5, .501, .52]) {
                    h.motor.startRace(0, speed);
                    h.motor.update(.3, { isAI: false });
                    const first = h.start(side);
                    const rate = h.motor.currentActionCycleSpeed();
                    h.motor.update(.375 * Math.PI * 2 / rate, { isAI: false });
                    first.progress = .375 * Math.PI * 2;
                    assert.equal(h.motor.setStrokeHeld(side, false).strokeQuality, 1);
                    // 下一次按下先完成 200ms 分类，但上一划仍在回收。
                    h.motor.update(.2, { isAI: false });
                    h.motor.setStrokeHeld(side, true, .2);
                    assert.equal(h.motor.recordStroke(side), false);
                    const actions = side === h.StrokeType.LEFT ? h.motor._leftActions : h.motor._rightActions;
                    for (let frame = 0; actions[0] === first && frame < 100; frame++) {
                        h.motor.update(.001, { isAI: false });
                    }
                    const next = actions[0];
                    assert.notEqual(next, first);
                    assert.ok(Math.abs(next.startedAt - next.pressedAt - .2) < 1e-9);
                    h.motor.update((target * Math.PI * 2 - next.progress) / rate, { isAI: false });
                    next.progress = target * Math.PI * 2;
                    const shownPerfect = h.motor.isActiveStrokeInPerfectZone(side);
                    const result = h.motor.setStrokeHeld(side, false);
                    assert.equal(!!result.downgradedToKick, false);
                    assert.equal(result.strokeQuality === 1, target >= .25 && target <= .5);
                    assert.equal(result.strokeQuality === 1, shownPerfect);
                }
            }
        }
    }
});

test('普通短按仍受起手门槛限制，移除末端容错后区外不判 PERFECT', () => {
    for (const [preHeld, progress, expected] of [[0, .25, false], [.2, .25, true], [.2, .5, true], [.2, .501, false], [.2, .52, false]]) {
        const h = heldStrokeFixture();
        h.motor.update(.3, { isAI: false });
        const action = h.start(h.StrokeType.LEFT, preHeld);
        h.motor.update(progress * Math.PI * 2 / h.motor.currentActionCycleSpeed(), { isAI: false });
        action.progress = progress * Math.PI * 2;
        const result = h.motor.setStrokeHeld(h.StrokeType.LEFT, false);
        assert.equal(result.strokeQuality === 1, expected);
        assert.equal(!!result.downgradedToKick, preHeld === 0);
    }
});

test('旧本地调参不能重新引入入口轮速差异或隐藏容错', () => {
    const h = setup();
    const retired = {
        'difficulty.beginner.armCycleSpeedScale': .3,
        'difficulty.competitive.armCycleSpeedScale': .4,
        'difficulty.championship.armCycleSpeedScale': 1.5,
        'strokeQuality.perfectVisualReleaseGraceSeconds': .2,
    };
    h.saved.set('SpeedSwimming.Tuning.v1', JSON.stringify({
        version: h.project.version, updatedAt: '2099-01-01T00:00:00.000Z',
        values: { ...h.project.values, ...retired },
    }));
    h.tuning.loadSavedTuningAsync(() => {});
    const { SwimmerMotor } = h.loadModule('swimmer/SwimmerMotor');
    const { setRaceDifficulty } = h.loadModule('core/GameBalance');
    const rates = [];
    for (const mode of ['beginner', 'competitive', 'championship']) {
        setRaceDifficulty(mode);
        const motor = new SwimmerMotor(); motor.startRace(0, 2);
        rates.push(motor.currentActionCycleSpeed());
    }
    assert.equal(rates[0], rates[1]); assert.equal(rates[1], rates[2]);
    assert.equal(h.tuning.saveCurrentTuning().ok, true);
    const saved = JSON.parse(h.saved.get('SpeedSwimming.Tuning.v1')).values;
    for (const key of Object.keys(retired)) {
        assert.equal(h.controls.has(key), false);
        assert.equal(Object.hasOwn(saved, key), false);
    }
});

test('角色仅三项属性成长，体重和蓄气在升级后保持固有值', () => {
    const { tuning, loadModule } = setup();
    tuning.loadSavedTuningAsync(() => {});
    const { PLAYER_CHARACTER_DEFINITIONS } = loadModule('app/PlayerCharacterConfig');
    const { resolvePlayerBalance, resolveCharacterDisplayStats } = loadModule('progression/PlayerBalanceOverrides');
    for (const character of PLAYER_CHARACTER_DEFINITIONS) {
        const first = resolvePlayerBalance(character, 1, 30, character.weight, character.energyGain);
        const max = resolvePlayerBalance(character, 30, 30, character.weight, character.energyGain);
        assert.equal('kick' in character, false);
        assert.equal('kickMaxSpeed' in max, false);
        const firstDisplay = resolveCharacterDisplayStats(character, 1, 30);
        const maxDisplay = resolveCharacterDisplayStats(character, 30, 30);
        assert.deepEqual(Object.keys(maxDisplay).sort(), ['burst', 'stamina', 'technique']);
        assert.equal(firstDisplay.stamina, character.stamina);
        assert.equal(first.energyTotal, firstDisplay.stamina);
        assert.equal(max.energyTotal, maxDisplay.stamina);
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
    for (const character of PLAYER_CHARACTER_DEFINITIONS) for (const level of [1, 30]) {
        const motor = new SwimmerMotor();
        motor.setPlayerBalance(resolvePlayerBalance(character, level, 30, character.weight, character.energyGain));
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


test('耗尽后基础推进、按住推进和质量奖励同比减半，动作与判定不变', () => {
    const sample = (scale, progress, sideName, timeout = false, changeDuringHold = false) => {
        const h = heldStrokeFixture(.8);
        h.loadModule('core/GameBalance').setRaceDifficulty('beginner');
        h.motor.update(.3, { isAI: false });h.motor.setConditionSpeedScale(scale);
        const action = h.start(h.StrokeType[sideName]);
        const speed = h.motor.currentActionCycleSpeed();
        if (changeDuringHold) h.motor.setConditionSpeedScale(.5);
        const seconds = Math.PI * 2 * progress / speed;
        for (let i = 0; i < 120; i++) h.motor.update(seconds / 120, { isAI: false });
        let result;
        if (timeout) result = h.motor.consumeStrokeQualityResults()[0];
        else { action.progress = Math.PI * 2 * progress; result = h.motor.setStrokeHeld(h.StrokeType[sideName], false); }
        return { quality: result.strokeQuality, bad: result.badReason, speed, paid: action.heldBaseImpulse,
            total: action.heldBaseImpulse + h.motor._strokeAcceleration * h.motor._strokeAccelerationSeconds };
    };
    for (const side of ['LEFT', 'RIGHT']) for (const p of [.1, .24, .25, .375, .5]) {
        const full=sample(1,p,side),empty=sample(.5,p,side);
        assert.equal(empty.quality,full.quality);assert.equal(empty.speed,full.speed);
        assert.ok(Math.abs(empty.paid-full.paid*.5)<1e-9);
        assert.ok(Math.abs(empty.total-full.total*.5)<1e-9);
    }
    const full=sample(1,.61,'LEFT',true),empty=sample(.5,.61,'LEFT',true);
    assert.equal(full.bad,'timeout');assert.equal(empty.bad,'timeout');
    assert.ok(Math.abs(empty.total-full.total*.5)<1e-9);
    assert.deepEqual(sample(1,.375,'RIGHT',false,true),sample(1,.375,'RIGHT'), '耗尽边界不打断已经开始的一划');
});

test('体力新参数可保存重载，旧恢复、降频与心率判定配置不再生效', () => {
    const h = setup();h.tuning.loadSavedTuningAsync(() => {});
    const controls = h.controls;
    for (const id of ['condition.regenLow','condition.strokeDrainOptimal','condition.efficiencyFloor',
        'condition.cadenceWarningRatio','strokeQuality.qualityZoneScaleStrength']) assert.equal(controls.has(id),false);
    for (const [id,value] of [['condition.energyTotal',120],['condition.strokeDrain',2],['condition.exhaustedPropulsionScale',.35]]) controls.get(id).set(value);
    h.tuning.saveCurrentTuning();
    controls.get('condition.energyTotal').set(100);controls.get('condition.strokeDrain').set(1);controls.get('condition.exhaustedPropulsionScale').set(.5);
    h.tuning.loadSavedTuningAsync(() => {});
    const { PlayerConditionModel } = h.loadModule('condition/PlayerConditionModel');
    const model = new PlayerConditionModel();
    model.updateFromStroke({strokeAccepted:true,qualityScore:1,pressureScore:1,dt:0});model.tick(60);
    assert.equal(model.energy,118);assert.equal(model.strokeCadenceScale,1);
    assert.equal(controls.get('condition.exhaustedPropulsionScale').get(),.35);
});


test('真实泳者结算分别投递玩家和 AI 消耗，远端真人不重复记账', () => {
    const h=setup();h.tuning.loadSavedTuningAsync(() => {});
    let ts;try { ts=require('typescript'); } catch {
        ts=require(process.env.PATH.split(path.delimiter).map(dir=>path.resolve(dir,'../typescript/lib/typescript.js')).find(p=>fs.existsSync(p)));
    }
    const file=path.join(h.root,'assets/scripts/entity/Swimmer.ts');
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const decl=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='Swimmer');
    const names=['makeStrokeQualityResult','consumeAiConditionStrokes','consumeConditionInputs'];
    const members=decl.members.filter(n=>names.includes(n.name?.getText(source)));
    assert.equal(members.length,names.length);
    const js=ts.transpileModule(`class Settlement { ${members.map(n=>n.getText(source)).join('\n')} }`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    const C=require('node:vm').runInNewContext(js+';Settlement',{
        ...h.loadModule('core/StrokeQualityScoring'),...h.loadModule('core/GameConstants'),
    });
    for (const identity of ['player','ai','remote']) {
        const body=new C();Object.assign(body,{isAI:identity!=='player',collisionRemoteHuman:identity==='remote',
            _phases:{isUnderwater:false},_ultimate:{addStrokeRating(){}},_strokeMetrics:{effortScore:1},
            _pendingAiConditionStrokes:0,_pendingConditionInputs:[],_strokeQualityCombo:0,
            _maxStrokeQualityCombo:0,_perfectStrokeQualityCount:0,_goodStrokeQualityCount:0,_missStrokeQualityCount:0});
        assert.equal(body.makeStrokeQualityResult('left',null),null);
        for (const quality of [0,.5,1]) body.makeStrokeQualityResult('left',{strokeQuality:quality,type:'left',holdSeconds:.4});
        assert.equal(body.consumeAiConditionStrokes(),identity==='ai'?3:0);
        assert.equal(body.consumeAiConditionStrokes(),0);
        const inputs=body.consumeConditionInputs();assert.equal(inputs.length,identity==='player'?3:0);
        assert.equal(body.consumeConditionInputs().length,0);
        if(identity==='player') {
            const {PlayerConditionModel}=h.loadModule('condition/PlayerConditionModel');const condition=new PlayerConditionModel();
            for(const input of inputs) condition.updateFromStroke(input);assert.equal(condition.energy,97);
        }
    }
});


test('角色面板、升级预览、赛内上限和联机档案共用体力点数，不受默认上限换算', () => {
    const h=setup();h.tuning.loadSavedTuningAsync(() => {});
    const {PLAYER_CHARACTER_DEFINITIONS}=h.loadModule('app/PlayerCharacterConfig');
    const {resolveCharacterDisplayStats,resolvePlayerBalance}=h.loadModule('progression/PlayerBalanceOverrides');
    const {resolveModifiersFromDigest}=h.loadModule('progression/RaceModifiers');
    const {PlayerConditionModel}=h.loadModule('condition/PlayerConditionModel');
    h.controls.get('condition.energyTotal').set(250);
    for(const character of PLAYER_CHARACTER_DEFINITIONS) for(const level of [-1,1,2,3,29,30,31,60]) {
        const display=resolveCharacterDisplayStats(character,level,30);
        const balance=resolvePlayerBalance(character,level,30,character.weight,character.energyGain);
        const net=resolveModifiersFromDigest({characterId:character.id,level}).balance;
        const expected=character.stamina+Math.max(1,Math.min(30,level))-1;
        assert.equal(display.stamina,expected);assert.equal(balance.energyTotal,expected);
        assert.equal(net.energyTotal,expected);
        const model=new PlayerConditionModel();model.setProgressionOverrides({energyTotal:balance.energyTotal});model.reset();
        assert.equal(model.energy,display.stamina);
        model.updateFromStroke({strokeAccepted:true,qualityScore:1,pressureScore:1,dt:0});
        assert.ok(Math.abs(model.energy-(display.stamina-1))<1e-10);
    }
});


test('30 级封顶：旧档归一、29 升 30、批量升级和满级不扣金币', async () => {
    const h=setup();
    const {normalizeProfile}=h.loadModule('backend/PlayerProfile');
    const {MockBackend}=h.loadModule('backend/MockBackend');
    const {coinCostForLevel,PROGRESSION_BALANCE}=h.loadModule('progression/ProgressionBalance');
    const {ProgressionManager}=h.loadModule('progression/ProgressionManager');
    const {PlayerData}=h.loadModule('backend/PlayerData');
    assert.equal(PROGRESSION_BALANCE.maxLevel,30);
    assert.equal(coinCostForLevel(30),0);assert.equal(coinCostForLevel(60),0);
    const id='cartonSwimmer6',backend=new MockBackend();
    for(const [old,expected] of [[60,30],[31,30],[29,29],[-2,1],[29.9,29]]) {
        const profile=normalizeProfile({coins:999999,characters:{[id]:{level:old}}});
        assert.equal(profile.characters[id].level,expected);assert.equal(profile.coins,999999);
    }
    h.saved.set('swimming.player-profile',JSON.stringify({coins:999999,characters:{[id]:{level:29}}}));
    const last=await backend.spendCoinsForLevel(id,60);
    assert.equal(last.levelsGained,1);assert.equal(last.profile.characters[id].level,30);
    assert.equal(last.coinsSpent,coinCostForLevel(29));
    const full=await backend.spendCoinsForLevel(id,1);
    assert.equal(full.reason,'maxed');assert.equal(full.coinsSpent,0);
    assert.equal(full.profile.coins,last.profile.coins);
    h.saved.set('swimming.player-profile',JSON.stringify({coins:999999,characters:{[id]:{level:1}}}));
    const bulk=await backend.spendCoinsForLevel(id,60);
    assert.equal(bulk.levelsGained,29);assert.equal(bulk.profile.characters[id].level,30);
    PlayerData.profile.characters[id]={level:60};const manager=new ProgressionManager();
    assert.equal(manager.getCharacterLevel(id),30);assert.equal(manager.canAffordNextLevel(id),false);
    assert.equal(manager.projectSpendToMax(id).levels,0);
    h.saved.set('SpeedSwimming.Progression.v2',JSON.stringify({characters:{[id]:{level:60}}}));
    manager.migrateLegacySave();assert.equal(PlayerData.profile.characters[id].level,30);
});


test('全角色 1 到 30 级三项属性逐级各加 1，显示点数直接驱动赛内成长', () => {
    const h=setup();h.tuning.loadSavedTuningAsync(() => {});
    const {PLAYER_CHARACTER_DEFINITIONS}=h.loadModule('app/PlayerCharacterConfig');
    const {resolveCharacterDisplayStats,resolvePlayerBalance}=h.loadModule('progression/PlayerBalanceOverrides');
    const {SWIMMER_BALANCE,DIVE_BALANCE}=h.loadModule('core/GameBalance');
    for (const character of PLAYER_CHARACTER_DEFINITIONS) {
        let previous;
        for (let level=1;level<=30;level++) {
            const display=resolveCharacterDisplayStats(character,level,30);
            const balance=resolvePlayerBalance(character,level,30,character.weight,character.energyGain);
            for (const stat of ['stamina','technique','burst']) {
                assert.ok(Number.isInteger(display[stat]));
                assert.equal(display[stat],character[stat]+level-1);
                if (previous) assert.equal(display[stat]-previous[stat],1);
            }
            assert.equal(balance.energyTotal,display.stamina);
            assert.equal(balance.strokeQualityAccel,SWIMMER_BALANCE.strokeQualityAccel*(1+(display.technique-50)*.003));
            assert.equal(balance.perfectComboMaxOvercap,SWIMMER_BALANCE.perfectComboMaxOvercap*(1+(display.technique-50)*.003));
            assert.equal(balance.maxSpeed,SWIMMER_BALANCE.maxSpeed*(1+(display.burst-50)*.003));
            assert.equal(balance.diveMaxLaunchSpeed,DIVE_BALANCE.maxLaunchSpeed*(1+(display.burst-50)*.003));
            assert.equal(balance.weight,character.weight);assert.equal(balance.energyGainAptitude,character.energyGain);
            previous=display;
        }
        assert.deepEqual(resolveCharacterDisplayStats(character,31,30),previous);
        assert.deepEqual(resolveCharacterDisplayStats(character,60,30),previous);
    }
});


test('心率新参数可保存重载，旧努力采样不能重新生效', () => {
    const h=setup();h.tuning.loadSavedTuningAsync(()=>{});
    for(const key of ['condition.effortDecay','condition.easeUp','condition.easeDown'])assert.equal(h.controls.has(key),false);
    const value=h.controls.get('heartRate.riseSeconds');value.set(12);
    h.tuning.saveCurrentTuning();value.set(8);h.tuning.loadSavedTuningAsync(()=>{});
    assert.equal(value.get(),12);assert.equal(h.controls.get('heartRate.minimumWidth').get(),.3);
    const {StrokeHeartRateModel}=h.loadModule('condition/StrokeHeartRateModel');
    const model=new StrokeHeartRateModel();model.recordStart();model.tick(1);
    assert.ok(Math.abs(model.heartRate-(100-20*Math.exp(-1/12)))<1e-9);
});

test('角色固有心率贯穿本地成长、联机解析、AI模型和重新比赛，等级体重不改变特性', () => {
    const h=setup();h.tuning.loadSavedTuningAsync(()=>{});
    const {PLAYER_CHARACTER_DEFINITIONS,characterHeartRateTraitForModel}=h.loadModule('app/PlayerCharacterConfig');
    const {resolvePlayerBalance}=h.loadModule('progression/PlayerBalanceOverrides');
    const {resolveModifiersFromDigest,applyRaceModifiersToMotor}=h.loadModule('progression/RaceModifiers');
    const {SwimmerMotor}=h.loadModule('swimmer/SwimmerMotor');
    const motor=new SwimmerMotor();
    const traits={cartonSwimmer6:'balanced',cartonSwimmer8:'balanced',cartonSwimmer5:'quick',cartonSwimmer9:'quick',cartonSwimmer10:'balanced',cartonSwimmer11:'steady',cartonSwimmer12:'quick',cartonSwimmer13:'steady',cartonSwimmer14:'quick',cartonSwimmer15:'slow',muscleMan:'slow'};
    for(const c of PLAYER_CHARACTER_DEFINITIONS) for(const level of [1,15,30,60]) {
        const local=resolvePlayerBalance(c,level,30,c.weight,c.energyGain,c.heartRateTrait);
        const net=resolveModifiersFromDigest({characterId:c.id,level});
        assert.equal(c.heartRateTrait,traits[c.id]);assert.deepEqual(net.balance,local);
        applyRaceModifiersToMotor(motor,net);motor.startRace();
        assert.equal(motor.heartRateTrait,traits[c.id]);assert.equal(motor.heartRate,80);
        motor.applyAuthoritativeHeartRate(180);motor.update(.5,{isAI:false});
        motor.startRace();assert.equal(motor.heartRateTrait,traits[c.id]);assert.equal(motor.heartRate,80);
        const ai=new SwimmerMotor();ai.setHeartRateTrait(characterHeartRateTraitForModel(c.modelVariantId));
        ai.setWeight(2);ai.startRace();ai.applyAuthoritativeHeartRate(180);
        motor.applyAuthoritativeHeartRate(180);
        for(let i=0;i<120;i++){ai.update(1/60,{isAI:true});motor.update(1/60,{isAI:false});}
        assert.equal(ai.heartRate,motor.heartRate);
    }
    applyRaceModifiersToMotor(motor,resolveModifiersFromDigest({characterId:'unknown',level:30}));
    assert.equal(motor.heartRateTrait,'balanced');assert.equal(characterHeartRateTraitForModel('unknown'),'balanced');
});

test('四档心率参数可持久化，正在比赛的模型也读取最新时间常数', () => {
    const h=setup();h.tuning.loadSavedTuningAsync(()=>{});
    const {HEART_RATE_TRAITS}=h.loadModule('core/ConditionBalance');
    const {StrokeHeartRateModel}=h.loadModule('condition/StrokeHeartRateModel');
    const models=[];
    for(const [id,profile] of Object.entries(HEART_RATE_TRAITS)) {
        const m=new StrokeHeartRateModel();m.setTrait(id);models.push(m);
        h.controls.get('heartRate.'+profile.riseKey).set(14);
        h.controls.get('heartRate.'+profile.recoveryKey).set(7);
    }
    h.tuning.saveCurrentTuning();
    for(const profile of Object.values(HEART_RATE_TRAITS)) {
        h.controls.get('heartRate.'+profile.riseKey).set(1);
        h.controls.get('heartRate.'+profile.recoveryKey).set(1);
    }
    h.tuning.loadSavedTuningAsync(()=>{});
    for(const m of models) {
        m.recordStart();m.tick(1);assert.ok(Math.abs(m.heartRate-(100-20*Math.exp(-1/14)))<1e-9);
        m.reset();m.applyAuthoritative(180);m.tick(1);assert.ok(Math.abs(m.heartRate-(80+100*Math.exp(-1/7)))<1e-9);
    }
});

function dolphinBurdenFixture(conditionKind = 'player') {
    const h=setup();h.tuning.loadSavedTuningAsync(()=>{});
    let ts;try {ts=require('typescript');} catch {ts=require(process.env.PATH.split(path.delimiter).map(dir=>path.resolve(dir,'../typescript/lib/typescript.js')).find(p=>fs.existsSync(p)));}
    const file=path.join(h.root,'assets/scripts/entity/Swimmer.ts');
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const decl=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='Swimmer');
    const names=['tryDolphinJump','applyAcceptedNetDolphinJump','applyConditionSpeedScale'];
    const members=decl.members.filter(n=>names.includes(n.name?.getText(source)));
    assert.equal(members.length,names.length);
    const {DOLPHIN_JUMP}=h.loadModule('core/DolphinJumpConfig');
    const js=ts.transpileModule(`class Body {${members.map(n=>n.getText(source)).join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    const Body=require('node:vm').runInNewContext(js+';Body',{DOLPHIN_JUMP});
    const {SwimmerMotor}=h.loadModule('swimmer/SwimmerMotor');
    const {SwimmerRacePhases}=h.loadModule('entity/SwimmerRacePhases');
    const {UltimateEnergyModel}=h.loadModule('condition/UltimateEnergyModel');
    const {DEFAULT_RACE_COURSE_LAYOUT}=h.loadModule('venue/RaceCourseLayout');
    const motor=new SwimmerMotor();motor.startRace(10,2);
    const body=new Body();body._motor=motor;body._ultimate=new UltimateEnergyModel();body._ultimate.applyNetEnergy(100,1);
    const host={motor,node:new h.cc.Node(),courseLayout:DEFAULT_RACE_COURSE_LAYOUT,
        cartoonRig:{setDiveStreamlinePose(){},setLegSplashSuppressed(){},setPerfectGlowActive(){},triggerSplashBurst(){}}};
    body._phases=new SwimmerRacePhases(host);
    const gmFile=path.join(h.root,'assets/scripts/core/GameManager.ts');
    const gmSource=ts.createSourceFile(gmFile,fs.readFileSync(gmFile,'utf8'),ts.ScriptTarget.Latest,true);
    const gmDecl=gmSource.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='GameManager');
    const binding=gmDecl.members.find(n=>n.name?.getText(gmSource)==='bindDolphinEnergyCost');
    assert.ok(binding);
    const bindingJs=ts.transpileModule(`class Binder {${binding.getText(gmSource)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    const Binder=require('node:vm').runInNewContext(bindingJs+';Binder');
    const Condition=conditionKind==='player'?h.loadModule('condition/PlayerConditionModel').PlayerConditionModel:h.loadModule('condition/AiConditionModel').AiConditionModel;
    const condition=new Condition(),binder=new Binder();binder.bindDolphinEnergyCost(body,condition);
    return {...h,body,motor,host,condition,binder};
}

test('海豚跳成功只加一次25心率并封顶180，失败与重复点击不付费，保留实际划频历史', () => {
    const {body,motor,host,loadModule,condition}=dolphinBurdenFixture();
    const {StrokeType}=loadModule('core/GameConstants');
    for(const hr of [80,140,155,170,180]) {
        body._phases._dolphinActive=false;body._ultimate.applyNetEnergy(100,1);motor.startRace(10,2);
        motor.applyAuthoritativeHeartRate(hr);motor.update(.3,{isAI:false});motor.applyAuthoritativeHeartRate(hr);
        motor.setStrokeHeld(StrokeType.LEFT,true,.2);motor.recordStroke(StrokeType.LEFT);
        const rate=motor._heartRate.strokeRate;
        assert.equal(body.tryDolphinJump(),true);assert.equal(motor.heartRate,Math.min(180,hr+25));
        assert.equal(body._ultimate.energy,0);assert.equal(motor._heartRate.strokeRate,rate);
        assert.equal(motor._leftActions.length,0,'海豚阶段按原规则取消在途划水');
        assert.equal(body.tryDolphinJump(),false);assert.equal(motor.heartRate,Math.min(180,hr+25));
    }
    for(const reason of ['energy','turn','underwater','active','wall','finish','stopped','rig']) {
        motor.startRace(10,2);motor.applyAuthoritativeHeartRate(100);
        Object.assign(body._phases,{_dolphinActive:reason==='active',_flipTurnActive:reason==='turn',_diveUnderwaterActive:reason==='underwater'});
        body._ultimate.applyNetEnergy(reason==='energy'?99:100,1);
        if(reason==='wall')motor.startRace(49.9,2);
        if(reason==='finish')motor.startRace(199.9,2);
        if(reason==='stopped')motor.stopRace();
        const rig=host.cartoonRig;if(reason==='rig')host.cartoonRig=null;
        const before=motor.heartRate,energy=body._ultimate.energy,stamina=condition.energy;
        assert.equal(body.tryDolphinJump(),false,reason);assert.equal(motor.heartRate,before,reason);assert.equal(body._ultimate.energy,energy,reason);assert.equal(condition.energy,stamina,reason);
        host.cartoonRig=rig;
    }
});

test('海豚跳远端回放不叠加权威心率，迟到事件及重复快照不能再次增压', () => {
    const {body,motor}=dolphinBurdenFixture();
    for(const hr of [80,105,170,180]) {
        body._phases._dolphinActive=false;motor.startRace(10,2);motor.applyAuthoritativeHeartRate(hr,true);
        body._ultimate.applyNetEnergy(0,1);
        assert.equal(body.applyAcceptedNetDolphinJump(),true);
        assert.equal(motor.heartRate,hr);assert.equal(body._ultimate.energy,0);
        assert.equal(body.applyAcceptedNetDolphinJump(),false);assert.equal(motor.heartRate,hr);
        motor.addHeartRateBurden(25);assert.equal(motor.heartRate,hr);
        motor.applyAuthoritativeHeartRate(hr,true);assert.equal(motor.heartRate,hr);
    }
});

test('海豚心率负担可调20或30并保存，异常配置不降心率，各角色自然恢复且重新开赛归80', () => {
    const {body,motor,controls,tuning,loadModule}=dolphinBurdenFixture();
    const control=controls.get('dolphin.strainHr');
    for(const cost of [0,20,30]) {
        control.set(cost);tuning.saveCurrentTuning();control.set(99);tuning.loadSavedTuningAsync(()=>{});assert.equal(control.get(),cost);
        for(const [trait,tau] of [['quick',1.5],['balanced',2.5],['steady',3.5],['slow',4.5]]) {
            body._phases._dolphinActive=false;body._ultimate.applyNetEnergy(100,1);motor.setHeartRateTrait(trait);motor.startRace(10,2);
            assert.equal(body.tryDolphinJump(),true);assert.equal(motor.heartRate,80+cost);
            for(let i=0;i<360;i++)motor.tickRestingHeartRate(1/120,true);
            assert.equal(motor.heartRate,80+cost);
            for(let i=0;i<120;i++)motor.tickRestingHeartRate(1/120);
            assert.ok(Math.abs(motor.heartRate-(80+cost*Math.exp(-1/tau)))<1e-8);
            motor.startRace();assert.equal(motor.heartRate,80);assert.equal(motor.heartRateTrait,trait);
        }
    }
    const {StrokeHeartRateModel}=loadModule('condition/StrokeHeartRateModel');const model=new StrokeHeartRateModel();
    for(const value of [NaN,Infinity,-Infinity,-25,0]){model.addBurden(value);assert.equal(model.heartRate,80);}
    model.addBurden(1000);assert.equal(model.heartRate,180);
    motor.stopRace();motor.addHeartRateBurden(25);assert.equal(motor.heartRate,80);
});

test('成功海豚跳本地玩家和AI额外扣5体力，不足扣零，耗尽倍率在返回和发包前立即生效', () => {
    for(const kind of ['player','ai']) {
        const {body,motor,condition,binder}=dolphinBurdenFixture(kind);
        // 重绑覆盖已有回调，再赛不叠加收费。
        binder.bindDolphinEnergyCost(body,condition);binder.bindDolphinEnergyCost(body,condition);
        for(const remaining of [100,6,5,3,0]) {
            condition.reset();condition.consumeEnergy(100-remaining);
            motor.startRace(10,2);body._phases._dolphinActive=false;body._ultimate.applyNetEnergy(100,1);
            assert.equal(body.tryDolphinJump(),true,`${kind},${remaining}`);
            assert.equal(condition.energy,Math.max(0,remaining-5));
            assert.equal(condition.energyDepleted,remaining<=5);
            assert.equal(motor._conditionSpeedScale,remaining<=5?.5:1);
            assert.equal(condition.energyRatio,Math.max(0,remaining-5)/100,'同帧 self/AI snapshot 已读到扣费后的比例');
            const stamina=condition.energy;
            assert.equal(body.tryDolphinJump(),false);assert.equal(condition.energy,stamina);
        }
        condition.reset();assert.equal(condition.energy,100);assert.equal(condition.efficiencyModifier,1);
    }
});

test('海豚跳体力成本独立于每划成本和心率，参数可保存重载，远端回放不重复扣费', () => {
    const {body,motor,condition,controls,tuning,loadModule}=dolphinBurdenFixture();
    const cost=controls.get('dolphin.staminaCost');assert.equal(cost.get(),5);
    cost.set(8);tuning.saveCurrentTuning();cost.set(1);tuning.loadSavedTuningAsync(()=>{});assert.equal(cost.get(),8);
    controls.get('condition.strokeDrain').set(2);
    for(const levelEnergy of [85,114]) for(const hr of [80,180]) {
        condition.setProgressionOverrides({energyTotal:levelEnergy});condition.reset();
        body._phases._dolphinActive=false;motor.startRace(10,2);motor.applyAuthoritativeHeartRate(hr);body._ultimate.applyNetEnergy(100,1);
        assert.equal(body.tryDolphinJump(),true);assert.equal(condition.energy,levelEnergy-8);
        condition.updateFromStroke({strokeAccepted:true});assert.equal(condition.energy,levelEnergy-10,'之后一次划水按自己成本正常扣除');
    }
    for(const invalid of [NaN,Infinity,-Infinity,-5,0]) {
        const before=condition.energy;condition.consumeEnergy(invalid);assert.equal(condition.energy,before);
    }
    cost.set(0);body._phases._dolphinActive=false;body._ultimate.applyNetEnergy(100,1);
    const before=condition.energy;assert.equal(body.tryDolphinJump(),true);assert.equal(condition.energy,before);
    const {energyAfterCost}=loadModule('core/ConditionBalance');
    assert.equal(energyAfterCost(5.0000000001,5),0);assert.equal(energyAfterCost(2,10000),0);
    for(let repeat=0;repeat<3;repeat++) {
        body.collisionRemoteHuman=true;body._phases._dolphinActive=false;body._ultimate.applyNetEnergy(0,1);motor.applyAuthoritativeHeartRate(170,true);
        assert.equal(body.applyAcceptedNetDolphinJump(),true);assert.equal(condition.energy,before);assert.equal(motor.heartRate,170);
        body.onDolphinJumpEnergyCost(8);assert.equal(condition.energy,before,'远端身份防护不能消耗占位AI体力');
    }
});
