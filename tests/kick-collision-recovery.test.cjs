const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');
const h = createAiHarness();
const { SwimmerMotor } = h.load('swimmer/SwimmerMotor');
const { StrokeType } = h.load('core/GameConstants');
const { setRaceDifficulty } = h.load('core/GameBalance');
const { KICK_RECOVERY_TUNING: tuning } = h.load('core/CollisionPitchTuning');
const { SWIMMER_COLLISION, resolveSwimmerCollisions: resolve } = h.load('entity/SwimmerCollisionResolver');
const snapshot = h.load('net/NetRaceSnapshot');
const input = h.load('net/NetRaceInput');
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} / ${b}`);

function motor() { const m = new SwimmerMotor(); m.startRace(10, 3); return m; }
function advance(m, seconds, fps = 60) { for (let i = 0; i < seconds * fps; i++) m.update(1 / fps, { isAI: false }); }
function clear() { resolve([]); }
function swimmer(x, direction, weight = 1, z = 0) {
    const m = motor(); m.setWeight(weight); m.setLateralOffsetBounds(-10 - z, 10 - z);
    const s = {
        motor: m, node: { position: { x, z } }, startPosition: { z }, raceDirection: direction,
        isCollisionActive: true, collisionMinZ: -10, collisionMaxZ: 10, weight, impacts: 0, bonuses: 0,
        get currentSpeed() { return m.currentSpeed; },
        get movementHeading() { return m.heading; },
        get kickRecoveryActive() { return m.kickRecoveryActive; },
        sync() { this.node.position.x = x + (m.distance - 10) * direction; this.node.position.z = z + m.lateralOffset; },
        applyCollisionPush(dx, dz) { m.nudgeDistance(dx * direction); m.setLateralOffset(m.lateralOffset + dz); this.sync(); },
        applyCollisionImpulse(d, l) { this.impacts++; m.applyCollisionImpulse(d, l); },
        applyCollisionAxialImpulse(v) { m.applyCollisionAxialImpulse(v); },
        applyCollisionPitchImpulse(v) { m.applyCollisionPitchImpulse(v); },
        applyCollisionSoftnessImpulse(a, b) { m.collisionSoftness.impulse(a, b); },
        sustainKickEscape(side) { m.sustainKickEscape(side); },
        addCollisionEnergyBonus() { this.bonuses++; },
    };
    return s;
}

test('只有确认短按触发恢复，反复踢水不叠加强度，长按起划及特殊阶段清除', () => {
    const m = motor();
    m.recordKickTap(StrokeType.LEFT, false); assert.equal(m.kickRecoveryActive, false);
    m.confirmKickAbility(); near(m.kickRecoveryRemaining, tuning.holdSeconds);
    for (let n = 0; n < 20; n++) m.confirmKickAbility();
    near(m.kickRecoveryRemaining, tuning.holdSeconds);
    advance(m, .6); assert.equal(m.kickRecoveryActive, false);
    m.recordKickTap(StrokeType.LEFT); assert.equal(m.kickRecoveryActive, true);
    m.setStrokeHeld(StrokeType.LEFT, true, .3); m.recordStroke(StrokeType.LEFT);
    advance(m, .05); assert.equal(m.kickRecoveryActive, false);
    for (const reset of [m => m.beginFlipTurnPhase(), m => m.setGlidePhase(true),
        m => m.restoreAxialBalance(0), m => m.stopRace(), m => m.startRace()]) {
        const fresh = motor(); fresh.recordKickTap(StrokeType.LEFT); reset(fresh);
        assert.equal(fresh.kickRecoveryActive, false);
    }
    const glide = motor(); glide.setGlidePhase(true); glide.recordKickTap(StrokeType.LEFT);
    assert.equal(glide.kickRecoveryActive, false);
});

test('踢水逐步恢复倒置前翻并保留早期失衡和仰泳，30/60/120Hz一致', () => {
    for (const fps of [30, 60, 120]) {
        const passive = motor(), active = motor();
        for (const m of [passive, active]) {
            m.correctCollisionPitch(Math.PI, 0, 1); m.correctAxialRoll(Math.PI, 3, 1);
            m.applyCollisionImpulse(-3, 2);
        }
        for (let i = 0; i < fps * .8; i++) {
            if (i % (fps / 5) === 0) active.recordKickTap(StrokeType.LEFT);
            for (const m of [passive, active]) m.update(1 / fps, { isAI: false });
        }
        assert.ok(Math.abs(active.collisionPitchRadians) > .35, '0.8秒时仍保留可见倾斜，不能立即拉平');
        assert.ok(Math.abs(active.collisionPitchRadians) < .75, '连续踢水仍比完全倒置更接近正常姿态');
        assert.ok(Math.abs(active.collisionPitchAngularVelocity) < .5);
        assert.ok(Math.abs(passive.collisionPitchRadians) > 2.5);
        assert.ok(Math.abs(active.axialRollRadians) > 2.8);
        assert.ok(Math.abs(active._knockbackDistance) < Math.abs(passive._knockbackDistance) * .25);
        near(active._knockbackLateral, passive._knockbackLateral);
        for (let i = 0; i < fps * 1.2; i++) {
            if (i % (fps / 5) === 0) active.recordKickTap(StrokeType.LEFT);
            active.update(1 / fps, { isAI: false });
        }
        assert.ok(Math.abs(active.collisionPitchRadians) < .1, '持续踢水两秒后能恢复');
    }
});

test('正撞减罚仅影响踢水者，身体分离与侧滑保持；同向接触不获得减罚', () => {
    const run = (kick, sameDirection = false, reverse = false) => {
        clear();
        const a = swimmer(-.85, 1), b = swimmer(.85, sameDirection ? 1 : -1);
        a.motor._currentSpeed = b.motor._currentSpeed = 1;
        if (kick) a.motor.recordKickTap(StrokeType.LEFT);
        resolve(reverse ? [b, a] : [a, b]);
        return [a, b].map(s => ({ position: { ...s.node.position }, back: s.motor._knockbackDistance,
            roll: s.motor.axialRollAngularVelocity, pitch: s.motor.collisionPitchAngularVelocity }));
    };
    const base = run(false), kicked = run(true);
    assert.deepEqual(kicked, run(true, false, true));
    assert.deepEqual(kicked.map(s => s.position), base.map(s => s.position));
    near(kicked[0].back, base[0].back * tuning.headOnPenaltyScale);
    near(kicked[0].roll, base[0].roll * tuning.headOnPenaltyScale);
    near(kicked[0].pitch, base[0].pitch * tuning.headOnPenaltyScale);
    assert.deepEqual(kicked[1], base[1]);
    assert.deepEqual(run(true, true), run(false, true));
});

function encounter(fps, weightA, weightB, z, both, confirmed = true, reverse = false) {
    clear();
    const a = swimmer(-.85, 1, weightA, z), b = swimmer(.85, -1, weightB, z);
    const pair = reverse ? [b, a] : [a, b]; resolve(pair);
    for (let i = 0; i < fps * 8; i++) {
        if (i >= fps * .2 && i % (fps / 5) === 0) {
            a.motor.recordKickTap(StrokeType.LEFT, confirmed);
            if (both) b.motor.recordKickTap(StrokeType.RIGHT, confirmed);
        }
        for (const s of pair) { s.motor.update(1 / fps, { isAI: false }); s.sync(); }
        resolve(pair);
        assert.ok(Math.abs(a.node.position.z) <= 10 && Math.abs(b.node.position.z) <= 10);
        assert.ok(Math.hypot(a.node.position.x - b.node.position.x, a.node.position.z - b.node.position.z) >= 1.8 - 1e-7, JSON.stringify({fps, weightA, weightB, z, both, i, a:a.node.position, b:b.node.position}));
        if (a.node.position.x > b.node.position.x + 1.8) return { time: (i + 1) / fps, impacts: a.impacts };
    }
    return { time: Infinity, impacts: a.impacts };
}

test('实际运动与碰撞循环：双方或单方踢水、不同体重、池边都能错身且不穿透', t => {
    let longest = 0;
    setRaceDifficulty('competitive');
    for (const fps of [30, 60, 120]) for (const weights of [[1, 1], [.85, 1.3], [1.3, .85]]) {
        for (const z of [0, -10, 10]) for (const both of [false, true]) {
            const result = encounter(fps, ...weights, z, both);
            longest = Math.max(longest, result.time);
            assert.ok(result.time < 5, JSON.stringify({ fps, weights, z, both, ...result }));
        }
    }
    const regular = encounter(60, 1, 1, 0, true, false);
    const recovered = encounter(60, 1, 1, 0, true);
    t.diagnostic(JSON.stringify({ 最慢脱困秒数: longest, 无恢复效果: regular, 踢水恢复: recovered }));
    assert.ok(recovered.time < regular.time, JSON.stringify({ regular, recovered }));
    assert.deepEqual(recovered, encounter(60, 1, 1, 0, true, true, true));
});

test('持续接触只维持侧滑下限，不重复撞击、发能量或累积速度', () => {
    clear(); const a = swimmer(-.85, 1), b = swimmer(.85, -1);
    resolve([a, b]); a.motor.recordKickTap(StrokeType.LEFT);
    for (let i = 0; i < 100; i++) resolve([a, b]);
    assert.equal(a.impacts, 1); assert.equal(a.bonuses, 1);
    assert.ok(Math.abs(a.motor._knockbackLateral) <= SWIMMER_COLLISION.knockbackMaxImpulse);
});

test('恢复余时经过三条同步通道量化，旧包和异常值安全回退', () => {
    const s = { lane: 0, distance: 10, lateral: 0, finished: false, heading: 0, headingVelocity: 0,
        speed: 2, energy: 10, axialRoll: 0, axialRollVelocity: 0, collisionPitch: 0,
        collisionPitchVelocity: 0, kickRecoveryRemaining: .3216 };
    const decoded = [snapshot.decodeRaceSnapshot(snapshot.encodeRaceSnapshot(0, [s])).entries[0],
        snapshot.decodeSelfSnapshot(snapshot.encodeSelfSnapshot(s, 4, 0)),
        input.decodeInputFrame(input.encodeInputFrame(0, [], s, 4, 1)).self];
    for (const state of decoded) near(state.kickRecoveryRemaining, .322);
    for (const token of [undefined, 'garbage', 'NaN', 'Infinity', '-20']) near(snapshot.decodeKickRecovery(token), 0);
    near(snapshot.decodeKickRecovery('999999'), 2);
    const legacy = snapshot.encodeSelfSnapshot(s, 4, 0).split(',').slice(0, -1).join(',');
    near(snapshot.decodeSelfSnapshot(legacy).kickRecoveryRemaining, 0);
});

test('权威快照只应用一次，断流自然到期，远端普通踢腿事件不误触发恢复', () => {
    const { body } = h.create(); const packet = { kickRecoveryRemaining: .3 };
    body.handleKickStroke(StrokeType.LEFT, false); assert.equal(body.kickRecoveryActive, false);
    body.applyNetKickRecovery(packet); assert.equal(body.kickRecoveryActive, true);
    advance(body.motor, .2); body.applyNetKickRecovery(packet); near(body.motor.kickRecoveryRemaining, .1);
    advance(body.motor, .2); body.applyNetKickRecovery(packet); assert.equal(body.kickRecoveryActive, false);
    body.applyNetKickRecovery({ kickRecoveryRemaining: .3 }); assert.equal(body.kickRecoveryActive, true);
    body.applyNetKickRecovery({ kickRecoveryRemaining: 0 }); assert.equal(body.kickRecoveryActive, false);
});

test('AI识别碰撞并使用共享踢水，远端真人不运行AI决策', () => {
    for (const difficulty of [.3, 1]) {
        const s = h.create('cartonSwimmer15', 1, difficulty, 20);
        s.body.motor.applyCollisionPitchImpulse(-8);
        let recovered = false;
        for (let i = 0; i < 90; i++) { s.step(1 / 30); recovered ||= s.body.kickRecoveryActive; }
        assert.ok(recovered); assert.ok(s.ai.debugSnapshot().kickSeconds > 0);
    }
    const remote = h.create(); remote.ai.remoteDriven = true;
    remote.body.motor.applyCollisionPitchImpulse(-8);
    for (let i = 0; i < 90; i++) remote.ai.stepSimulation(1 / 30);
    assert.equal(remote.body.kickRecoveryActive, false);
});

test('AI不会在近身碰撞前自动开减罚，撞后可将短按起手转为脱困且不重复踢腿', () => {
    const { AIRaceObserver } = h.load('competitor/AIRaceObserver');
    for (const mode of ['beginner', 'competitive']) {
        setRaceDifficulty(mode);
        const a = h.create('cartonSwimmer15', 1, 1, 20), b = h.create('muscleMan', 1, 1, 78.3);
        a.body.stepSimulation(1 / 30); b.body.stepSimulation(1 / 30);
        assert.notEqual(a.body.raceDirection, b.body.raceDirection);
        a.ai.raceObserver = new AIRaceObserver(a.body, [a.body, b.body]);
        a.ai._phase = 'press'; a.ai._heldSeconds = 0;
        a.body.handleKickStroke(StrokeType.LEFT, false);
        a.body.handleKickStroke = () => assert.fail('已按下的短按只确认，不追加同帧踢腿');
        a.ai.stepSimulation(1 / 30);
        assert.equal(a.ai.planner.action, 'swim');
        assert.equal(a.body.kickRecoveryActive, false);
        clear(); resolve([a.body, b.body]);
        assert.ok(a.body.motor.needsCollisionRecovery);
        a.ai._decisionClock = a.ai.intelligence.decisionSeconds;
        a.ai.stepSimulation(1 / 30);
        assert.equal(a.ai.planner.action, 'evade');
        assert.equal(a.ai.planner.reason, 'contact');
        assert.equal(a.body.kickRecoveryActive, true);
    }
});

test('转身和海豚阶段拒绝旧恢复快照，零持续时间可关闭新增效果', () => {
    const { body } = h.create();
    for (const flag of ['_flipTurnActive', '_dolphinActive', '_diveUnderwaterActive']) {
        body._phases[flag] = true;
        body.applyNetKickRecovery({ kickRecoveryRemaining: .45 });
        assert.equal(body.kickRecoveryActive, false);
        body._phases[flag] = false;
    }
    const saved = tuning.holdSeconds;
    try {
        tuning.holdSeconds = 0;
        const m = motor(); m.recordKickTap(StrokeType.LEFT);
        assert.equal(m.kickRecoveryActive, false);
    } finally { tuning.holdSeconds = saved; }
});

test('调试参数保存后重载，默认项目配置也包含脱困参数', () => {
    const controls = h.load('core/TuningDebugControls');
    const keys = ['collision.kickRecoveryHoldSeconds', 'collision.kickRecoveryRate',
        'collision.kickHeadOnPenaltyScale', 'collision.kickEscapeSpeed'];
    const projectValues = require('../assets/resources/config/tuning.json').values;
    for (const key of keys) assert.ok(Number.isFinite(projectValues[key]));
    const values = [.6, 10, .4, 2.2];
    const selected = keys.map(id => controls.TUNING_GROUPS.flatMap(g => g.controls).find(c => c.id === id));
    const saved = selected.map(c => c.get());
    const oldStorage = h.cc.sys.localStorage;
    const storage = new Map(); h.cc.sys.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    try {
        selected.forEach((c, i) => c.set(values[i])); controls.saveCurrentTuning();
        selected.forEach((c, i) => c.set(saved[i]));
        assert.equal(controls.loadSavedTuning(), true);
        selected.forEach((c, i) => near(c.get(), values[i]));
    } finally { selected.forEach((c, i) => c.set(saved[i])); h.cc.sys.localStorage = oldStorage; }
});

test('多人迎面挤压合并脱困方向，不因本地玩家数组排序改变侧滑', () => {
    const run = reverse => {
        clear();
        const a = swimmer(-.85, 1), b = swimmer(.85, -1, 1, -.4), c = swimmer(.85, -1, 1, .4);
        a.motor.recordKickTap(StrokeType.LEFT);
        resolve(reverse ? [c, b, a] : [a, b, c]);
        return a.motor._knockbackLateral;
    };
    near(run(false), 0); near(run(true), 0);
});

test('同样的松软冲量按原速消退，踢水不加速抹掉四肢碰撞表现', () => {
    for (const fps of [30, 60, 120]) {
        const active = motor(), passive = motor();
        for (const m of [active, passive]) m.collisionSoftness.impulse(1, -1);
        for (let i = 0; i < fps * .4; i++) {
            if (i % (fps / 5) === 0) active.recordKickTap(StrokeType.LEFT);
            for (const m of [active, passive]) m.update(1 / fps, { isAI: false });
        }
        assert.deepEqual(active.collisionSoftness, passive.collisionSoftness);
        assert.equal(active.collisionSoftness.active, true);
    }
});

test('旧版备份只迁移过强的默认脱困参数，新版主动调参与无关参数保持原样', () => {
    const controls = h.load('core/TuningDebugControls');
    const oldStorage = h.cc.sys.localStorage;
    const stored = new Map();
    const saved = { ...tuning };
    h.cc.sys.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
    try {
        controls.saveCurrentTuning();
        const key = [...stored.keys()][0], data = JSON.parse(stored.get(key));
        data.version = 49;
        Object.assign(data.values, { 'collision.kickRecoveryRate': 8,
            'collision.kickHeadOnPenaltyScale': .25, 'collision.kickEscapeSpeed': 1.8,
            'collision.kickRecoveryHoldSeconds': .6 });
        stored.set(key, JSON.stringify(data)); controls.loadSavedTuning();
        near(tuning.poseRecoveryRate, 2); near(tuning.headOnPenaltyScale, .4); near(tuning.escapeSpeed, .9);
        near(tuning.holdSeconds, .6);
        data.values['collision.kickRecoveryRate'] = 5;
        data.values['collision.kickHeadOnPenaltyScale'] = .7;
        data.values['collision.kickEscapeSpeed'] = 1.3;
        stored.set(key, JSON.stringify(data)); controls.loadSavedTuning();
        near(tuning.poseRecoveryRate, 5); near(tuning.headOnPenaltyScale, .7); near(tuning.escapeSpeed, 1.3);
        data.version = 50; data.values['collision.kickRecoveryRate'] = 8;
        stored.set(key, JSON.stringify(data)); controls.loadSavedTuning(); near(tuning.poseRecoveryRate, 8);
    } finally { Object.assign(tuning, saved); h.cc.sys.localStorage = oldStorage; }
});
