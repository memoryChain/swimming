import test from 'node:test';
import assert from 'node:assert/strict';
import Body from '../assets/scripts/swimmer/GeyserBodyContact.ts';
import Reaction from '../assets/scripts/swimmer/GeyserReactionModel.ts';
import Rules from '../assets/scripts/core/GeyserBrawlRules.ts';
import Codec from '../assets/scripts/net/GeyserReactionCodec.ts';
const { emptyGeyserBodyPose, emptyGeyserContact, sampleGeyserBodyContact } = Body;
const { createGeyserReaction, sampleGeyserReaction } = Reaction;
const sample = () => ({ pitch: 0, roll: 0, weight: 0, forward: 0, side: 0 });
function contact(x, z, pose = emptyGeyserBodyPose(), large = false) {
    return sampleGeyserBodyContact({ id: 0, x, z, offsetSeconds: 0, size: large ? 'large' : 'small' }, 0,
        pose, pose, 2, 2.01, 2, 2.01, 0, .055, emptyGeyserContact());
}

test('头胸与腿部抬升方向相反，左右命中在反向泳段正确镜像', () => {
    for (const yaw of [0, Math.PI, .6, -1.1]) {
        const pose = { ...emptyGeyserBodyPose(), yaw };
        const head = contact(.9 * Math.cos(yaw), .9 * Math.sin(yaw), pose);
        const legs = contact(-Math.cos(yaw), -Math.sin(yaw), pose);
        assert.equal(head.strength, 2); assert.equal(legs.strength, 2);
        assert.ok(head.along > .4); assert.ok(legs.along < -.5);
        const a = createGeyserReaction(1001, 2, 1, 0, 0, 0, 0, head);
        const b = createGeyserReaction(1001, 2, 1, 0, 0, 0, 0, legs);
        assert.ok(sampleGeyserReaction(a, .2, sample()).pitch > 0);
        assert.ok(sampleGeyserReaction(b, .2, sample()).pitch < 0);
        for (const side of [-1, 1]) {
            const hit = contact(-Math.sin(yaw) * .5 * side, Math.cos(yaw) * .5 * side, pose);
            assert.equal(hit.strength, 2);
            const reaction = createGeyserReaction(1001, 2, 1, 0, 0, 0, 0, hit);
            assert.equal(Math.sign(reaction.rollVelocity), -side);
        }
    }
});

test('大口中央覆盖更广但不强加随机翻转，远处、空中越顶与预警无核心命中', () => {
    const small = contact(0, 0), large = contact(0, 0, emptyGeyserBodyPose(), true);
    assert.ok(large.coverage > small.coverage);
    assert.ok(Math.abs(large.along) < .12); assert.ok(Math.abs(large.side) < 1e-9);
    assert.equal(contact(0, 4).strength, 0);
    assert.equal(contact(0, 0, { ...emptyGeyserBodyPose(), y: 3 }).strength, 0);
    const p = emptyGeyserBodyPose();
    assert.equal(sampleGeyserBodyContact({ id: 0, x: 0, z: 0, offsetSeconds: 0 }, 0,
        p, p, 1, 1.01, 1, 1.01, 0, .055, emptyGeyserContact()).strength, 0);
    assert.equal(contact(-1.7, 0).strength, 1, '足尖外缘不会变成核心');
});

test('连续穿越在 15/30/60/120Hz 下保持命中方向、接触时刻和姿态', () => {
    for (const speed of [2.5, 6, 12]) {
        const results = [];
        for (const fps of [15, 30, 60, 120]) {
            let previous = { ...emptyGeyserBodyPose(), x: -2.6 };
            for (let i = 1; i < fps * 2; i++) {
                const from = 1.8 + (i - 1) / fps, to = 1.8 + i / fps;
                const current = { ...previous, x: -2.6 + speed * i / fps };
                const hit = sampleGeyserBodyContact({ id: 0, x: 0, z: 0, offsetSeconds: 0 }, 0,
                    previous, current, from, to, from, Math.min(to, 2.449999), 0, .055, emptyGeyserContact());
                if (hit.strength === 2) { results.push(hit); break; }
                previous = current;
            }
        }
        assert.equal(results.length, 4);
        assert.ok(Math.max(...results.map(h => h.time)) - Math.min(...results.map(h => h.time)) <= 1 / 240 + 1e-6);
        assert.ok(results.every(h => h.along > 0));
        const angles = results.map(h => sampleGeyserReaction(createGeyserReaction(1001, 2, 1, 0, 0, 0, 0, h), .3, sample()).pitch);
        assert.ok(Math.max(...angles) - Math.min(...angles) < Math.PI / 60);
    }
});

test('瞬移不扫中间喷口；倾斜和水下接触使用身体高度', () => {
    const a = { ...emptyGeyserBodyPose(), x: -6 }, b = { ...a, x: 6 };
    assert.equal(sampleGeyserBodyContact({ id: 0, x: 0, z: 0, offsetSeconds: 0 }, 0,
        a, b, 2, 2.03, 2, 2.03, 0, .055, emptyGeyserContact()).strength, 0);
    assert.equal(contact(.8, 0, { ...emptyGeyserBodyPose(), y: -.5 }).strength, 2);
    assert.equal(contact(.8, 0, { ...emptyGeyserBodyPose(), y: 2, pitch: .8 }).strength, 0);
});

test('轻擦限幅、已有姿态延续，落水后余摆归零且不修改基础轨迹', () => {
    const hit = contact(.9, 0);
    for (const strength of [1, 2]) {
        const duration = strength === 1 ? .25 : 1;
        const start = createGeyserReaction(1001, strength, duration, .7, -.6, 0, 0, hit);
        assert.equal(sampleGeyserReaction(start, 0, sample()).pitch, .7);
        const peak = sampleGeyserReaction(start, duration, sample());
        assert.ok(peak.pitch >= .7);
        assert.ok(peak.pitch - .7 <= (strength === 1 ? 10 : 50) * Math.PI / 180 + 1e-9);
        assert.equal(sampleGeyserReaction(start, duration + .35, sample()).weight, 0);
        assert.ok(sampleGeyserReaction(start, duration + .1, sample()).weight > 0);
        const packed = Codec.encodeGeyserReaction({ start, age: .2 });
        const restored = Codec.decodeGeyserReaction(packed);
        assert.ok(restored);
        assert.ok(Math.abs(sampleGeyserReaction(restored.start, .4, sample()).pitch
            - sampleGeyserReaction(start, .4, sample()).pitch) < .002);
    }
    assert.equal(Codec.decodeGeyserReaction('1.2.3'), null);
    assert.equal(Codec.decodeGeyserReaction('NaN'), null);
    const fixed = Rules.geyserTuningForRace(true), prior = Rules.GEYSER_TUNING.pitchMaxDegrees;
    Rules.GEYSER_TUNING.pitchMaxDegrees = 5;
    assert.equal(fixed.pitchMaxDegrees, 50);
    Rules.GEYSER_TUNING.pitchMaxDegrees = prior;
});

test('跨过正负半圈或继承多圈海豚姿态，恢复只走最短角度', () => {
    const blend = Reaction.blendGeyserAngle;
    assert.ok(Math.abs(blend(-3.1, 3.1, .5) + Math.PI) < .01);
    assert.ok(Math.abs(blend(.2, Math.PI * 8 + .4, .5) - .3) < 1e-9);
    const start = createGeyserReaction(1001, 2, 1, 0, Math.PI * 8 + .4, 0, 0);
    assert.ok(Math.abs(start.roll - .4) < 1e-9);
});
