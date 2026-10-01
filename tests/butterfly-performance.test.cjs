const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../scripts/analyze-stroke-efficiency.cjs');
const { ButterflyPropulsion, ButterflyPhysicsIntegrator } = load('swimmer/ButterflyPropulsion');
const { SwimPhysicsModel } = load('swimmer/SwimPhysicsModel');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { SWIMMER_BALANCE: balance } = load('core/GameBalance');
const near = (a, b, error = 1e-9) => assert.ok(Math.abs(a - b) <= error, `${a} != ${b}`);

function integrate(deltas, overrides = {}) {
    const pulse = new ButterflyPropulsion(), integrator = new ButterflyPhysicsIntegrator(), physics = new SwimPhysicsModel();
    pulse.start(2.5, .2);
    let speed = .8, distance = 0, time = 0, frame = 0;
    while (time < 2 - 1e-10) {
        const dt = Math.min(deltas[frame++ % deltas.length], 2 - time);
        const out = integrator.step(physics, pulse, speed, dt, 0, overrides.kick ?? 0,
            overrides.cap ?? 0, overrides.glide ?? 0, overrides.environment ?? 0, overrides.scale ?? 1);
        speed = out.currentSpeed; distance += out.averageSpeed * dt; time += dt;
    }
    return { speed, distance, active: pulse.active };
}

test('相同输入预算在 15／30／60／120 帧及混合长帧下得到一致速度和位移', () => {
    for (const options of [{}, { kick: .4, cap: 1.2, environment: .8, scale: .9 }, { glide: 1.5 }]) {
        const reference = integrate([1 / 120], options);
        for (const steps of [[1 / 15], [1 / 30], [1 / 60], [1 / 120], [1 / 30, .1, 1 / 60, .25]]) {
            const actual = integrate(steps, options);
            near(actual.speed, reference.speed); near(actual.distance, reference.distance);
            assert.equal(actual.active, false);
        }
        const high = integrate([1 / 240], options);
        assert.ok(Math.abs(high.distance / reference.distance - 1) < .005);
    }
});

test('帧中超时只从实际超时时刻消费脉冲，非法时间不消费', () => {
    const p = new ButterflyPropulsion(), q = new ButterflyPropulsion(), physics = new SwimPhysicsModel();
    const integrator = new ButterflyPhysicsIntegrator(); p.start(2.5, .2); q.start(2.5, .2);
    for (const dt of [0, -1, NaN, Infinity]) near(integrator.step(physics, p, .8, dt, 0, 0, 0, 0, 0).currentSpeed, .8);
    integrator.step(physics, p, .8, .05, 0, 0, 0, 0, 0, 1, .037);
    q.consume(.013);
    near(p.consume(.1), q.consume(.1));
});

test('严重卡顿最多 33 次物理计算，复用读数和输入，清理后不残留预算', () => {
    const p = new ButterflyPropulsion(), integrator = new ButterflyPhysicsIntegrator(), physics = new SwimPhysicsModel();
    p.start(2.5, .2); let calls = 0, input;
    const original = physics.speedAfterStep.bind(physics);
    physics.speedAfterStep = (speed, next) => {
        calls++; if (input) assert.equal(next, input); input = next; return original(speed, next);
    };
    const out = integrator.step(physics, p, .8, 3, 0, 0, 0, 0, 0, 1, .03);
    assert.ok(calls <= 33); assert.ok(Number.isFinite(out.currentSpeed)); assert.equal(p.active, false);
    p.start(2, .2); p.reset();
    assert.equal(integrator.step(physics, p, .8, .1, 0, 0, 0, 0, 0), out);
    near(p.consume(.2), 0);
});

test('真实蝶泳运动层使用小步平均速度累计距离，不把帧末速度乘满整帧', () => {
    const rows = [];
    for (const fps of [15, 30, 60, 120]) {
        const m = new SwimmerMotor(); m.enableButterfly(true); m.startRace(0, .8);
        m.setSteeringEnabled(false); m.applyAuthoritativeHeartRate(80, true);
        assert.equal(m.beginButterfly(), true); m.butterfly.advance(m.butterfly.duration * .4); m.releaseButterfly();
        for (let elapsed = 0; elapsed < .5 - 1e-10;) {
            const dt = Math.min(1 / fps, .5 - elapsed); m.update(dt, { isAI: false }); elapsed += dt;
        }
        rows.push([m.currentSpeed, m.distance]);
        assert.equal(m.consumeStrokeQualityResults().length, 1);
    }
    for (const row of rows) { near(row[0], rows[0][0]); near(row[1], rows[0][1]); }
});

test('普通及联机自由泳未创建积分器，标量提取与原物理公式逐值相同', () => {
    const motor = new SwimmerMotor(); assert.equal(motor._butterflyPhysics, null);
    const physics = new SwimPhysicsModel();
    for (const speed of [0, .8, 2.7, 3.4]) for (const dt of [1 / 15, 1 / 60, .25]) {
        const input = { dt, strokeAcceleration: 3, kickAcceleration: .4, speedCapBonus: 1, glideDrag: .1, environmentDrag: .3 };
        const max = balance.maxSpeed + 1, limit = .16 + .84 * (1 - Math.pow(Math.min(1, Math.max(0, speed / max)), 1.6));
        const drag = balance.poolDeceleration + balance.baseDrag * speed + balance.highSpeedDrag * speed * speed + .1 * speed + .3 * speed;
        const expected = Math.max(balance.minSpeed, Math.min(max, speed + (3 * limit + .4 - drag) * dt));
        assert.deepEqual(physics.step({ currentSpeed: speed, distance: 12 }, input), { currentSpeed: expected, distance: 12 });
    }
});
