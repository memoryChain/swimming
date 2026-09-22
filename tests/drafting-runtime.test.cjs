const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../scripts/analyze-stroke-efficiency.cjs');
const { DraftingModel, DRAFTING_TUNING: T, DRAFTING_POINTS } = load('swimmer/DraftingRules');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { PlayerConditionModel } = load('condition/PlayerConditionModel');
const { AiConditionModel } = load('condition/AiConditionModel');
const { StrokeType } = load('core/GameConstants');
const { encodeRaceSnapshot, decodeRaceSnapshot, encodeSelfSnapshot, decodeSelfSnapshot } = load('net/NetRaceSnapshot');
const { encodeInputFrame, decodeInputFrame } = load('net/NetRaceInput');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function train(count = 3, side = 0) {
    const m = new DraftingModel(count);
    for (let i = 0; i < count; i++) Object.assign(m.racers[i], { eligible: true, speed: 2.5, dx: 1, dz: 0, z: i === 1 ? side : 0 });
    for (let t = 0; t < 60; t++) {
        for (let i = 0; i < count; i++) m.racers[i].x = t / 6 - i * 3;
        m.step(1 / 15);
    }
    return m;
}

test('前后队列各受益一次，二十划省三点，技能仍扣五点，耗尽不恢复', () => {
    const m = train();
    assert.deepEqual([...m.source], [-1, 0, 1]);
    near(m.costScale(0), 1); near(m.costScale(1), .85); near(m.costScale(2), .85);
    const player = new PlayerConditionModel(), ai = new AiConditionModel();
    player.reset(); ai.reset();
    for (let n = 0; n < 20; n++) {
        player.updateFromStroke({ strokeAccepted: true, energyCost: m.costScale(1) });
        ai.consumeEnergy(m.costScale(2));
    }
    near(player.energy, 83); near(ai.energy, 83);
    player.consumeEnergy(5); near(player.energy, 78);
    player.consumeEnergy(200); player.updateFromStroke({ strokeAccepted: true, energyCost: .85 });
    near(player.energy, 0); near(player.efficiencyModifier, .15);
});

test('空间边界拒绝贴身、并排、侧移、迎面、自身和不同泳段', () => {
    const m = train(2), follower = m.racers[1];
    assert.equal(m.contains(1, 1), false);
    const saved = { ...follower };
    for (const changes of [{ x: m.racers[0].x - 1.8 }, { x: m.racers[0].x }, { z: 1 }, { dx: -1 }, { leg: 1 }, { eligible: false }]) {
        Object.assign(follower, saved, changes); near(m.costScale(1), 1);
    }
    Object.assign(follower, saved); near(m.costScale(1), .85);
});

test('弯线按真实路径生效，拐弯后不会把旧路线旋转到身体正后方', () => {
    const m = new DraftingModel(2);
    for (const r of m.racers) Object.assign(r, { eligible: true, speed: 2.5 });
    for (let i = 0; i < 75; i++) {
        const angle = i * .008, trailing = angle - .15;
        Object.assign(m.racers[0], { x: 20 * Math.sin(angle), z: 20 * (1 - Math.cos(angle)), dx: Math.cos(angle), dz: Math.sin(angle) });
        Object.assign(m.racers[1], { x: 20 * Math.sin(trailing), z: 20 * (1 - Math.cos(trailing)), dx: Math.cos(trailing), dz: Math.sin(trailing) });
        m.step(1 / 15);
    }
    near(m.costScale(1), .85);
    m.racers[1].z += 2; near(m.costScale(1), 1);
});

test('停止、硬失效、位置跳变和折返不会保留或连接旧增益', () => {
    for (const change of [{ eligible: false }, { leg: 1 }, { epoch: 1 }, { x: 45 }]) {
        const m = train(2); Object.assign(m.racers[0], change); m.step(1 / 15);
        near(m.costScale(1), 1); assert.ok(m.paths[0].count <= 1);
    }
    const m = train(2); m.racers[0].speed = 0;
    for (let i = 0; i < 8; i++) m.step(1 / 15);
    near(m.costScale(1), 1); assert.equal(m.paths[0].count, 0);
    m.reset(); assert.deepEqual([...m.source], [-1, -1]);
});

test('边缘确认、重叠不叠加、关闭玩法、长局固定容量', () => {
    const m = train(3, 1.2);
    near(m.costScale(1), 1);
    m.racers[1].z = 0; m.step(1 / 15); near(m.costScale(1), 1);
    m.step(1 / 15); m.step(1 / 15); near(m.costScale(1), .85);
    Object.assign(m.racers[2], m.racers[0]);
    for (let t = 0; t < 9000; t++) {
        for (const r of m.racers) r.x += 1 / 6;
        m.step(1 / 15);
    }
    near(m.costScale(1), .85);
    for (const p of m.paths) assert.equal(p.count, DRAFTING_POINTS);
    T.enabled = false; near(m.costScale(1), 1); T.enabled = true;
});

test('真实运动模型按左右起划分别锁价，离开后在途价格不变，重复松手不结算', () => {
    for (const fps of [30, 60, 120]) {
        const motor = new SwimmerMotor(); motor.startRace(0, 2);
        let scale = .85; motor.strokeCostScale = () => scale;
        motor.update(.3, { isAI: false });
        motor.setStrokeHeld(StrokeType.LEFT, true, .2); motor.recordStroke(StrokeType.LEFT);
        near(motor._leftActions[0].energyCost, .85);
        scale = 1;
        motor.setStrokeHeld(StrokeType.RIGHT, true, .2); motor.recordStroke(StrokeType.RIGHT);
        near(motor._rightActions[0].energyCost, 1);
        motor.update(1 / fps, { isAI: false });
        motor._leftActions[0].progress = .375 * Math.PI * 2;
        const result = motor.setStrokeHeld(StrokeType.LEFT, false);
        near(result.energyCost, .85);
        assert.equal(motor.setStrokeHeld(StrokeType.LEFT, false), null);
        const queued = [];
        for (let n = 0; n < fps * 2; n++) {
            motor.update(1 / fps, { isAI: false }); queued.push(...motor.consumeStrokeQualityResults());
            if (queued.length) { motor.setStrokeHeld(StrokeType.RIGHT, false); break; }
        }
        assert.equal(queued.length, 1); near(queued[0].energyCost, 1);
    }
});

function entry(source, eligible) {
    return { lane: 7, distance: 20, lateral: 0, finished: false, heading: 0, headingVelocity: 0,
        speed: 2.5, energy: 50, axialRoll: 0, axialRollVelocity: 0, collisionPitch: 0, collisionPitchVelocity: 0,
        conditionEnergyRatio: .85, conditionHeartRate: 120, draftingSource: source, draftingEligible: eligible };
}
test('可靠输入、广播兜底和房主快照均携带同一受益状态，旧包不提供资格', () => {
    for (const source of [-1, 0, 6, 7]) for (const eligible of [true, false]) {
        const e = entry(source, eligible);
        const copies = [decodeRaceSnapshot(encodeRaceSnapshot(0, [e])).entries[0],
            decodeSelfSnapshot(encodeSelfSnapshot(e, 20, 2)),
            decodeInputFrame(encodeInputFrame(2, [], e, 10, 20)).self];
        for (const copy of copies) {
            assert.equal(copy.draftingEligible, eligible);
            assert.equal(copy.draftingSource, eligible ? source : -1);
        }
    }
    const parts = encodeSelfSnapshot(entry(0, true), 20, 2).split(',');
    parts[3] = '0';
    const old = parts.join(',');
    assert.equal(decodeSelfSnapshot(old).draftingEligible, false);
    assert.equal(decodeSelfSnapshot(old).draftingSource, -1);
    const finished = decodeSelfSnapshot(encodeSelfSnapshot({ ...entry(0, true), finished: true }, 21, 2));
    assert.equal(finished.finished, true); assert.equal(finished.draftingEligible, false);
});

test('控制器起划复核、关闭显示、权威切换、断流与重开不产生旧优惠', () => {
    const path = require('node:path');
    const h = require('./helpers/cocos-math-harness.cjs').createHarness({
        './DraftingPresentation': { DraftingPresentation: class { update() {} hide() {} dispose() {} } },
    });
    const { DraftingController } = h.load(path.join(h.root, 'assets/scripts/swimmer/DraftingController.ts'));
    const tuning = h.load(path.join(h.root, 'assets/scripts/swimmer/DraftingRules.ts')).DRAFTING_TUNING;
    const courseLayout = { courseLength: 50, directionAtDistance: () => 1, distanceToWorldX: v => v };
    const bodies = [0, 1].map(() => ({ distance: 0, netLateralOffset: 0, netHeading: 0, netSpeed: 2.5,
        draftingEligible: true, draftingEpoch: 0, courseLayout, startPosition: { z: 0 }, motor: {},
        collisionRemoteHuman: false, isAI: true, draftingSource: -1, draftingTargetZ: null }));
    let stale = false;
    const net = { activeHostPos: 0, isHost: true, draftingSnapshot(lane) {
        return stale ? null : { ...entry(-1, true), distance: bodies[lane].distance, speed: 2.5 };
    } };
    bodies[0].collisionRemoteHuman = true;
    const c = new DraftingController({}, bodies, 1, net, 0);
    const advance = () => {
        bodies[0].distance += 1 / 6; bodies[1].distance = bodies[0].distance - 3;
        c.update(1 / 15, true);
    };
    for (let i = 0; i < 60; i++) advance();
    near(bodies[1].motor.strokeCostScale(), .85);
    tuning.visuals = false; advance(); near(bodies[1].motor.strokeCostScale(), .85);
    bodies[1].draftingEpoch++; near(bodies[1].motor.strokeCostScale(), 1);
    for (let i = 0; i < 6; i++) advance(); near(bodies[1].motor.strokeCostScale(), .85);
    bodies[0].draftingEligible = false; near(bodies[1].motor.strokeCostScale(), 1);
    bodies[0].draftingEligible = true;
    stale = true; advance(); near(bodies[1].motor.strokeCostScale(), 1);
    stale = false;
    for (let i = 0; i < 60; i++) advance(); near(bodies[1].motor.strokeCostScale(), .85);
    net.activeHostPos = 1;
    near(bodies[1].motor.strokeCostScale(), 1); // 换房主后、下一次采样前起划也不能使用旧确认。
    advance(); near(bodies[1].motor.strokeCostScale(), 1);
    for (let i = 0; i < 60; i++) advance();
    c.update(.1, false); near(bodies[1].motor.strokeCostScale(), 1);
    assert.equal(bodies[1].draftingSource, -1);
    c.dispose(); assert.equal(bodies[1].motor.strokeCostScale, null);
});

test('两次采样之间发生大位移，领游者与跟随者都立即失去旧路径优惠', () => {
    for (const [lane, offset] of [[0, 1.6], [1, -1.6]]) {
        const model = train(2);
        near(model.costScale(1), .85);
        model.racers[lane].x += offset;
        near(model.costScale(1), 1);
    }
});

test('客机AI预测拒绝失效、断流、离房、自身及越界的尾迹来源', () => {
    const path = require('node:path');
    const h = require('./helpers/cocos-math-harness.cjs').createHarness({
        './DraftingPresentation': { DraftingPresentation: class { update() {} hide() {} dispose() {} } },
    });
    const { DraftingController } = h.load(path.join(h.root, 'assets/scripts/swimmer/DraftingController.ts'));
    const courseLayout = { courseLength: 50, directionAtDistance: () => 1, distanceToWorldX: v => v };
    const bodies = [0, 1, 2].map(() => ({ distance: 10, netLateralOffset: 0, netHeading: 0, netSpeed: 2.5,
        draftingEligible: true, draftingEpoch: 0, courseLayout, startPosition: { z: 0 }, motor: {},
        collisionRemoteHuman: false, draftingSource: -1 }));
    bodies[0].collisionRemoteHuman = true;
    const snapshots = [entry(-1, true), null, entry(0, true)];
    const net = { activeHostPos: 0, isHost: false, draftingSnapshot: lane => snapshots[lane] };
    const c = new DraftingController({}, bodies, 1, net, 0);
    c.update(1 / 15, true);
    near(bodies[2].motor.strokeCostScale(), .85);
    snapshots[0] = null;
    near(bodies[2].motor.strokeCostScale(), 1);
    snapshots[0] = entry(-1, false);
    near(bodies[2].motor.strokeCostScale(), 1);
    snapshots[0] = entry(-1, true);
    for (const source of [2, 7]) {
        snapshots[2].draftingSource = source;
        near(bodies[2].motor.strokeCostScale(), 1);
    }
    snapshots[2].draftingSource = 1;
    near(bodies[2].motor.strokeCostScale(), .85);
    bodies[1].draftingEligible = false;
    near(bodies[2].motor.strokeCostScale(), 1);
    c.dispose();
});

test('真实泳者结算成本进入AI体力模型，预算避开补给恢复，跟游让位于事件避险和冲刺', () => {
    const h = require('./helpers/ai-race-harness.cjs').createAiHarness();
    const { setRaceMode } = h.load('core/GameBalance');
    setRaceMode('competitive');
    const { body, ai, condition, step } = h.create('cartonSwimmer6', 1, 4, 10);
    body.motor.strokeCostScale = () => .85;
    const start = condition.energy;
    for (let i = 0; i < 180; i++) step(1 / 60);
    assert.ok(body.settledStrokeEnergy > 0);
    near(start - condition.energy, body.settledStrokeEnergy);
    near(body.settledStrokeEnergy / .85, Math.round(body.settledStrokeEnergy / .85));
    condition.consumeEnergy(condition.energyTotal * .3);
    body.draftingTargetZ = 1.2; body.draftingTargetSpeed = 3;
    ai.planner.action = 'swim'; ai.observe(); assert.equal(ai._targetZ, 1.2);
    ai.setMinefieldTargetZ(-2); ai.observe(); assert.equal(ai._targetZ, -2);
    ai.setMinefieldTargetZ(null); ai.planner.action = 'sprint'; ai.observe(); assert.notEqual(ai._targetZ, 1.2);
});

test('八人真实运动与碰撞下200／400米可完赛，尾迹有实际收益且容量不增长', () => {
    const path = require('node:path');
    const h = require('./helpers/ai-race-harness.cjs').createAiHarness();
    const ch = require('./helpers/cocos-math-harness.cjs').createHarness({
        './DraftingPresentation': { DraftingPresentation: class { update() {} hide() {} dispose() {} } },
    });
    const { DraftingController } = ch.load(path.join(ch.root, 'assets/scripts/swimmer/DraftingController.ts'));
    const { setRaceMode } = h.load('core/GameBalance');
    const { reseedSharedRandom } = h.load('core/SharedRNG');
    const { AIRaceObserver } = h.load('competitor/AIRaceObserver');
    const { resolveSwimmerCollisions, SWIMMER_COLLISION } = h.load('entity/SwimmerCollisionResolver');
    for (const distance of [200, 400]) {
        setRaceMode(distance === 200 ? 'competitive' : 'championship'); reseedSharedRandom(812);
        SWIMMER_COLLISION.enabled = false; resolveSwimmerCollisions([]); SWIMMER_COLLISION.enabled = true;
        const racers = Array.from({ length: 8 }, (_, i) => h.create('cartonSwimmer6', 15, .95, 10 + i * 3, 0));
        const bodies = racers.map(r => r.body), observer = new AIRaceObserver(null, bodies);
        for (const r of racers) r.ai.raceObserver = observer;
        const controller = new DraftingController({}, bodies, 0, null, 0);
        let benefits = 0;
        for (let step = 0; step < 18000 && bodies.some(b => b.distance < distance); step++) {
            controller.update(1 / 30, true);
            for (const r of racers) if (r.body.distance < distance) {
                if (r.body.draftingSource >= 0) benefits++;
                r.step(1 / 30);
            }
            resolveSwimmerCollisions(bodies);
        }
        assert.ok(benefits > 0, '阵列必须能实际获得尾迹');
        for (const r of racers) {
            assert.ok(r.body.distance >= distance, `未完赛：${r.body.distance}`);
            assert.ok(Number.isFinite(r.condition.energy) && r.condition.energy >= 0);
        }
        for (const p of controller.model.paths) assert.ok(p.count <= DRAFTING_POINTS);
        controller.dispose();
    }
    SWIMMER_COLLISION.enabled = false; resolveSwimmerCollisions([]); SWIMMER_COLLISION.enabled = true;
});
