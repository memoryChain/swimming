import test from 'node:test';
import assert from 'node:assert/strict';
import Softness from '../assets/scripts/swimmer/CollisionSoftnessModel.ts';
import Tuning from '../assets/scripts/core/CollisionSoftnessTuning.ts';
import Codec from '../assets/scripts/net/NetCollisionSoftnessCodec.ts';
import Snapshot from '../assets/scripts/net/NetRaceSnapshot.ts';
import Input from '../assets/scripts/net/NetRaceInput.ts';
import Collision from '../assets/scripts/entity/SwimmerCollisionResolver.ts';

const { CollisionSoftnessModel } = Softness;
const { collisionRelaxationTarget } = Softness;
const { COLLISION_SOFTNESS_TUNING: tuning } = Tuning;
const { encodeCollisionSoftness, decodeCollisionSoftness } = Codec;
const { resolveSwimmerCollisions, SWIMMER_COLLISION } = Collision;
const keys = ['side', 'forward', 'sideVelocity', 'forwardVelocity'];
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} / ${b}`);

test('碰撞过零时仍保持松弛，强撞的显示姿态主要由松弛目标控制', () => {
    const state = { side: 0, forward: 0, sideVelocity: 15, forwardVelocity: 0 };
    assert.ok(collisionRelaxationTarget(state) >= 0.9);
    near(collisionRelaxationTarget(state), collisionRelaxationTarget({ ...state, sideVelocity: -15 }));
    near(collisionRelaxationTarget({ ...state, sideVelocity: 0 }), 0);
    const model = new CollisionSoftnessModel();
    model.impulse(1.4, 0);
    const first = collisionRelaxationTarget(model);
    model.update(0.1);
    assert.ok(first > 0.9 && collisionRelaxationTarget(model) > 0.5);
    model.update(10);
    assert.equal(collisionRelaxationTarget(model), 0);
});

test('30、60、120Hz 在同一时刻得到相同回摆，长帧也能正确衰减', () => {
    const samples = [30, 60, 120].map(hz => {
        const model = new CollisionSoftnessModel();
        model.impulse(0.8, -1.2);
        for (let i = 0; i < hz / 2; i++) model.update(1 / hz);
        return model;
    });
    for (const key of keys) {
        near(samples[0][key], samples[1][key]);
        near(samples[1][key], samples[2][key]);
    }
    const longFrame = new CollisionSoftnessModel();
    longFrame.impulse(0.8, -1.2);
    longFrame.update(0.5);
    for (const key of keys) near(longFrame[key], samples[0][key]);
    longFrame.update(10);
    assert.equal(longFrame.active, false);
});

test('连续冲量不重置已有姿态，强碰撞有速度上限，禁用与重置能清空', () => {
    const model = new CollisionSoftnessModel();
    model.impulse(1, -1);
    model.update(0.1);
    const side = model.side;
    for (let i = 0; i < 100; i++) model.impulse(100, -100);
    assert.equal(model.side, side);
    assert.ok(Math.abs(model.sideVelocity) <= 20);
    model.impulse(NaN, Infinity);
    model.update(NaN);
    for (const key of keys) assert.ok(Number.isFinite(model[key]));
    const saved = tuning.enabled;
    try {
        tuning.enabled = 0;
        model.update(0.016);
        model.impulse(1, 1);
        assert.equal(model.active, false);
    } finally { tuning.enabled = saved; }
    model.impulse(1, 1);
    model.reset();
    assert.equal(model.active, false);
});

test('真人帧、自状态广播、房主快照都携带柔性状态，旧字段索引保持不变', () => {
    const state = { side: 0.2134, forward: -0.4567, sideVelocity: 3.1245, forwardVelocity: -4.3456 };
    const expected = decodeCollisionSoftness(encodeCollisionSoftness(state));
    const entry = {
        lane: 1, distance: 3, lateral: 0, heading: 0, headingVelocity: 0, finished: false,
        speed: 2, energy: 10, axialRoll: 0, axialRollVelocity: 0,
        collisionPitch: 0.123, collisionPitchVelocity: 0.456,
        conditionEnergyRatio: 0.5, conditionHeartRate: 120, collisionSoftness: state,
    };
    const s = Snapshot.decodeRaceSnapshot(Snapshot.encodeRaceSnapshot(0, [entry])).entries[0];
    const p = Snapshot.decodeSelfSnapshot(Snapshot.encodeSelfSnapshot(entry, 20, 2));
    const f = Input.decodeInputFrame(Input.encodeInputFrame(2, [], entry, 20, 21)).self;
    for (const decoded of [s, p, f]) {
        assert.deepEqual(decoded.collisionSoftness, expected);
        assert.equal(decoded.collisionPitch, 0.123);
        assert.equal(decoded.conditionHeartRate, 120);
    }
    assert.equal(p.ownerStateSeq, 20);
    assert.equal(p.ownerPos, 2);
    assert.equal(f.ownerStateSeq, 20);
    assert.equal(encodeCollisionSoftness(new CollisionSoftnessModel()), '0');
    for (const bad of [undefined, 'NaN:0:0:0', '1:2', 'Infinity:0:0:0']) {
        assert.deepEqual(decodeCollisionSoftness(bad), { side: 0, forward: 0, sideVelocity: 0, forwardVelocity: 0 });
    }
    assert.equal(Snapshot.decodeRaceSnapshot('S|0#1,300,0,0').entries[0].collisionSoftness.side, 0);
    assert.equal(Snapshot.decodeSelfSnapshot('P|1,300,0,0').collisionSoftness.forward, 0);
    assert.equal(Input.decodeInputFrame('2||1,300,0,0').self.collisionSoftness.sideVelocity, 0);
});

function swimmer(x, z, dir, weight) {
    return {
        node: { position: { x, z } }, isCollisionActive: true, isAI: false,
        raceDirection: dir, movementHeading: 0, currentSpeed: 2, weight,
        soft: new CollisionSoftnessModel(), hits: 0, outcomes: [],
        applyCollisionPush(x, z) { this.node.position.x += x; this.node.position.z += z; this.outcomes.push(['push', x, z]); },
        applyCollisionImpulse(x, z) { this.outcomes.push(['impulse', x, z]); },
        addCollisionEnergyBonus(v) { this.outcomes.push(['energy', v]); },
        applyCollisionAxialImpulse(v) { this.outcomes.push(['roll', v]); },
        applyCollisionPitchImpulse(v) { this.outcomes.push(['pitch', v]); },
        applyCollisionSoftnessImpulse(x, z) { this.soft.impulse(x, z); this.hits++; },
    };
}

test('碰撞柔性只在接触开始注入，启用前后位移、冲量、能量完全相同', () => {
    const saved = tuning.enabled;
    const run = enabled => {
        resolveSwimmerCollisions([]);
        tuning.enabled = enabled;
        const a = swimmer(0, 0, 1, 60);
        const b = swimmer(0.2, 0.2, -1, 90);
        resolveSwimmerCollisions([a, b]);
        const result = [a.outcomes.slice(), b.outcomes.slice()];
        assert.equal(a.hits, 1);
        assert.equal(a.soft.active, !!enabled);
        resolveSwimmerCollisions([a, b]);
        assert.equal(a.hits, 1);
        b.node.position.x = 10;
        resolveSwimmerCollisions([a, b]);
        b.node.position.x = a.node.position.x + 0.1;
        b.node.position.z = a.node.position.z + 0.1;
        resolveSwimmerCollisions([a, b]);
        assert.equal(a.hits, 2);
        return result;
    };
    try { assert.deepEqual(run(1), run(0)); }
    finally { tuning.enabled = saved; resolveSwimmerCollisions([]); }
});

test('交换碰撞数组顺序不会翻转各泳者的反馈方向', () => {
    const run = reverse => {
        resolveSwimmerCollisions([]);
        const a = swimmer(0, 0, 1, 60);
        const b = swimmer(0.3, 0.2, -1, 90);
        resolveSwimmerCollisions(reverse ? [b, a] : [a, b]);
        return [a.soft.sideVelocity, a.soft.forwardVelocity, b.soft.sideVelocity, b.soft.forwardVelocity];
    };
    const a = run(false), b = run(true);
    for (let i = 0; i < a.length; i++) near(a[i], b[i]);
    resolveSwimmerCollisions([]);
});

test('同速浅侧擦仍有可见反馈，体重分配和真实击退不受视觉下限影响', () => {
    const saved = tuning.minimumImpact;
    const run = minimum => {
        resolveSwimmerCollisions([]);
        tuning.minimumImpact = minimum;
        const a = swimmer(0, 0, 1, 60);
        const b = swimmer(0, SWIMMER_COLLISION.radius * 2 - 0.002, 1, 120);
        resolveSwimmerCollisions([a, b]);
        return { a, b };
    };
    try {
        const raw = run(0);
        const visible = run(0.8);
        assert.deepEqual(visible.a.outcomes, raw.a.outcomes);
        assert.deepEqual(visible.b.outcomes, raw.b.outcomes);
        assert.ok(Math.abs(visible.a.soft.sideVelocity) > Math.abs(raw.a.soft.sideVelocity) * 10);
        near(Math.abs(visible.a.soft.sideVelocity), 2 * Math.abs(visible.b.soft.sideVelocity));
        near(visible.a.soft.forwardVelocity, 0);
        resolveSwimmerCollisions([visible.a, visible.b]);
        assert.equal(visible.a.hits, 1);
    } finally {
        tuning.minimumImpact = saved;
        resolveSwimmerCollisions([]);
    }
});
