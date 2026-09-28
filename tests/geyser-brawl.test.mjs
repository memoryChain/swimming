import assert from 'node:assert/strict';
import test from 'node:test';

import Rules from '../assets/scripts/core/GeyserBrawlRules.ts';
import Launch from '../assets/scripts/swimmer/ForcedLaunchModel.ts';
import Input from '../assets/scripts/net/NetRaceInput.ts';

const { GEYSER_TUNING, geyserSpec, geyserPhaseAt, geyserBurstOverlap,
    geyserSweptHit, planGeyserVents } = Rules;
const { sampleForcedLaunch } = Launch;
const { NetInputKind, encodeInputFrame, decodeInputFrame } = Input;

test('五档喷口时间轴保留完整预警与间歇，布局对种子和轮次确定', () => {
    const counts = [2, 4, 6, 8, 10];
    for (let level = 1; level <= 5; level++) {
        const spec = geyserSpec(level);
        assert.equal(spec.ventCount, counts[level - 1]);
        const vents = planGeyserVents(1927, 3, level, 14, 0, 25, 9);
        assert.deepEqual(vents, planGeyserVents(1927, 3, level, 14, 0, 25, 9));
        assert.notDeepEqual(vents, planGeyserVents(1927, 4, level, 14, 0, 25, 9));
        assert.equal(vents.length, counts[level - 1]);
        for (const vent of vents) {
            assert.equal(geyserPhaseAt(vent, vent.offsetSeconds, spec.pulseCount), 'warning');
            assert.equal(geyserPhaseAt(vent, vent.offsetSeconds + GEYSER_TUNING.warningSeconds, spec.pulseCount), 'burst');
            assert.equal(geyserBurstOverlap(vent, 0, vent.offsetSeconds,
                vent.offsetSeconds + GEYSER_TUNING.warningSeconds), 0);
            assert.ok(geyserBurstOverlap(vent, 0, vent.offsetSeconds + 1.4,
                vent.offsetSeconds + 1.8) > 0);
        }
    }
});

test('五档增加真实喷发总量，每片预算容纳全部轮次且所有喷口均先完整预警', () => {
    let previous = 0;
    for (let level = 1; level <= 5; level++) {
        const spec = geyserSpec(level);
        for (const direction of [-1, 1]) for (let seed = 0; seed < 100; seed++) {
            const vents = planGeyserVents(seed, 1, level, 0, 0, 25, 10.5, direction);
            let bursts = 0;
            for (const vent of vents) for (let pulse = 0; pulse < spec.pulseCount; pulse++) {
                const start = Rules.geyserPulseStart(vent, pulse);
                const end = start + GEYSER_TUNING.warningSeconds + GEYSER_TUNING.burstSeconds
                    + GEYSER_TUNING.fallingSeconds;
                assert.ok(end <= spec.actionSeconds, `${level}/${seed}/${vent.id}/${pulse}`);
                assert.equal(geyserBurstOverlap(vent, pulse, start, start + GEYSER_TUNING.warningSeconds), 0);
                if (geyserBurstOverlap(vent, pulse, 0, spec.actionSeconds) > 0) bursts++;
            }
            assert.equal(bursts, spec.ventCount * spec.pulseCount);
            assert.ok(bursts > previous);
        }
        previous = spec.ventCount * spec.pulseCount;
    }
});

test('跨帧扫掠分出中心、边缘和安全通道', () => {
    const vent = { id: 0, x: 5, z: 1, offsetSeconds: 0 };
    assert.equal(geyserSweptHit(vent, 3, 1, 7, 1), 2);
    assert.equal(geyserSweptHit(vent, 3, 2, 7, 2), 1);
    assert.equal(geyserSweptHit(vent, 3, 2.6, 7, 2.6), 0);
});

test('受迫腾空从命中点升起，落回水面并保留减速后的前进', () => {
    const start = { distance: 12, lateral: 0.5, y: -0.2, surfaceY: 0,
        speed: 3, heading: 0, duration: 1, peakHeight: 1.2,
        entryScale: 0.75, exitScale: 0.6 };
    const out = { distance: 0, lateral: 0, y: 0, speed: 0, done: false };
    sampleForcedLaunch(start, 0, out);
    assert.equal(out.y, -0.2);
    assert.equal(out.distance, 12);
    sampleForcedLaunch(start, 0.45, out);
    assert.equal(out.y, 1.2);
    sampleForcedLaunch(start, 1, out);
    assert.equal(out.y, 0);
    assert.equal(out.done, true);
    assert.ok(out.distance > 12 && out.distance < 15);
    assert.ok(Math.abs(out.speed - 1.8) < 1e-8);
});

test('房主喷泉命中事件携带代次和时刻并往返解码', () => {
    const event = { kind: NetInputKind.GeyserHit, eventEpoch: 4,
        effectTime: 31.125, geyserHitId: 4025, targetLane: 3, geyserStrength: 2,
        geyserDistance: 87.25, geyserLateral: -0.325, geyserY: -0.15,
        geyserSpeed: 3.25, geyserHeading: 0.12, geyserSurfaceY: 0,
        geyserDuration: 1, geyserPeakHeight: 1.2, geyserEntryScale: 0.75,
        geyserExitScale: 0.6 };
    const frame = encodeInputFrame(0, [event]);
    assert.deepEqual(decodeInputFrame(frame).events, [event]);
    const edge = { kind: NetInputKind.GeyserHit, eventEpoch: 4,
        effectTime: 31.5, geyserHitId: 4026, targetLane: 4, geyserStrength: 1 };
    assert.deepEqual(decodeInputFrame(encodeInputFrame(0, [edge])).events, [edge]);
});
