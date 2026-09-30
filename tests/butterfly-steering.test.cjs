const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../scripts/analyze-stroke-efficiency.cjs');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const B = load('core/GameBalance');
const { StrokeType } = load('core/GameConstants');
const { STEERING_TUNING: T } = load('core/SteeringTuning');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function motor(enabled = true, mode = 'competitive') {
    B.setRaceMode(mode);
    const m = new SwimmerMotor();
    m.enableButterfly(enabled); m.startRace(0, .8); m.setSteeringEnabled(true);
    return m;
}
function stroke(m, side = StrokeType.LEFT) {
    m.setStrokeHeld(side, true, .2);
    assert.equal(m.recordStroke(side), true);
    m.update(.3, { isAI: false });
    m.setStrokeHeld(side, false);
    for (let i = 0; i < 180 && m.isArmStrokeActive; i++) m.update(1 / 60, { isAI: false });
    assert.equal(m.isArmStrokeActive, false);
}
function current(m, yaw) { m.applyWaterCurrent(0, 0, yaw, 0, .1, 4); }

test('蝶泳起划只清单侧划水的转向，保留当前朝向', () => {
    const m = motor(); stroke(m);
    assert.ok(m.heading > 0); assert.ok(m.headingTurnRate > 0);
    const heading = m.heading;
    assert.equal(m.beginButterfly(), true);
    near(m.heading, heading); near(m.headingTurnRate, 0);
});

test('同向与反向水流叠加划水后，起划均保留水流的原角速度', () => {
    for (const yaw of [2, -2]) {
        const m = motor(); stroke(m); current(m, yaw);
        const before = m.heading;
        assert.equal(m.beginButterfly(), true);
        near(m.heading, before); near(m.headingTurnRate, yaw * .1);
    }
});

test('划水和水流互相抵消或共同达到限速，不能借起划抹掉水流', () => {
    const cancelled = motor(); stroke(cancelled);
    const own = cancelled.headingTurnRate;
    current(cancelled, -own / .1); near(cancelled.headingTurnRate, 0);
    assert.equal(cancelled.beginButterfly(), true); near(cancelled.headingTurnRate, -own);
    const capped = motor(); stroke(capped);
    const max = T.maxTurnRate * Math.PI / 180;
    const external = max * .9;
    current(capped, external / .1); near(capped.headingTurnRate, max);
    assert.equal(capped.beginButterfly(), true); near(capped.headingTurnRate, external);
});

test('蝶泳中持续水流与停止后的惯性沿用原衰减，反复退出再起划不会卸力', () => {
    const m = motor(), reference = motor(false);
    current(m, .8); current(reference, .8);
    assert.equal(m.beginButterfly(), true);
    for (let i = 0; i < 20; i++) {
        if (i < 8) { current(m, .4); current(reference, .4); }
        m.update(.01, { isAI: false }); reference.update(.01, { isAI: false });
        near(m.heading, reference.heading); near(m.headingTurnRate, reference.headingTurnRate);
        m.cancelButterfly(false);
        assert.equal(m.beginButterfly(), true);
        near(m.headingTurnRate, reference.headingTurnRate);
    }
    assert.ok(m.headingTurnRate > 0);
});

test('撞击的纵横击退、翻滚与俯仰不被蝶泳起划清理', () => {
    const m = motor();
    m.applyCollisionImpulse(.3, .4);
    m.applyCollisionAxialImpulse(.1); m.applyCollisionPitchImpulse(.1);
    const before = [m._knockbackDistance, m._knockbackLateral,
        m.axialRollAngularVelocity, m.collisionPitchAngularVelocity];
    assert.ok(before.every(v => Math.abs(v) > 0));
    assert.equal(m.beginButterfly(), true);
    assert.deepEqual([m._knockbackDistance, m._knockbackLateral,
        m.axialRollAngularVelocity, m.collisionPitchAngularVelocity], before);
});

test('蝶泳起划保留池壁恢复转向，正常脱墙后不留下旧外力', () => {
    const m = motor(); m.returnToLaneFromPoolWall(1);
    const rate = m.headingTurnRate; assert.ok(rate > 0);
    assert.equal(m.beginButterfly(), true); near(m.headingTurnRate, rate);
    for (let i = 0; i < 360; i++) m.update(1 / 60, { isAI: false });
    near(m.heading, T.poolWallEscapeHeadingDegrees * Math.PI / 180);
    near(m.headingTurnRate, 0);
    m.cancelButterfly(false); assert.equal(m.beginButterfly(), true); near(m.headingTurnRate, 0);
});

test('转身、重生、重新起跑和标准规则清理来源，下一拍不恢复旧外力', () => {
    for (const reset of [m => m.beginFlipTurnPhase(), m => m.resumeAfterEntertainmentHit(10, .8),
        m => m.startRace(0, .8), m => { B.setRaceMode('beginner'); m.update(.01, { isAI: false }); }]) {
        const m = motor(); current(m, 1); reset(m);
        near(m._externalHeadingTurnRate, 0);
        m.startRace(0, .8); B.setRaceMode('competitive');
        assert.equal(m.beginButterfly(), true); near(m.headingTurnRate, 0);
    }
});

test('权威朝向校正被保留，零比例校正不改变来源', () => {
    const m = motor(); stroke(m); m.correctHeading(.1, -.2, 1);
    assert.equal(m.beginButterfly(), true); near(m.headingTurnRate, -.2);
    const unchanged = motor(); stroke(unchanged); unchanged.correctHeading(.1, -.2, 0);
    assert.equal(unchanged.beginButterfly(), true); near(unchanged.headingTurnRate, 0);
});

test('未使用蝶泳时来源追踪不改变自由泳轨迹，无蝶泳的联机路径保持一致', () => {
    for (const mode of ['beginner', 'competitive', 'entertainment-brawl']) {
        const tracked = motor(true, mode), original = motor(false, mode);
        for (let i = 0; i < 90; i++) {
            for (const m of [tracked, original]) {
                if (i === 0 || i === 45) {
                    const side = i === 0 ? StrokeType.LEFT : StrokeType.RIGHT;
                    m.setStrokeHeld(side, true, .2); m.recordStroke(side);
                }
                if (i === 18 || i === 63) m.setStrokeHeld(i === 18 ? StrokeType.LEFT : StrokeType.RIGHT, false);
                if (i < 24) current(m, -.3);
                if (i === 70) m.returnToLaneFromPoolWall(1);
                m.update(1 / 60, { isAI: false });
            }
            assert.deepEqual([tracked.heading, tracked.headingTurnRate, tracked.distance, tracked.lateralOffset],
                [original.heading, original.headingTurnRate, original.distance, original.lateralOffset]);
        }
        near(original._externalHeadingTurnRate, 0);
    }
});
