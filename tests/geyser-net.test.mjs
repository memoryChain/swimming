import test from 'node:test';
import assert from 'node:assert/strict';
import Codec from '../assets/scripts/net/NetGeyserSnapshot.ts';
import Snapshot from '../assets/scripts/net/NetRaceSnapshot.ts';
import Protocol from '../assets/scripts/net/NetRaceProtocol.ts';
const { encodeGeyserPacket, decodeGeyserPacket } = Codec;

function state(serial = 1) {
    return { world: { serial, intensity: 5, anchorDistance: 320, age: 12.3, stoppedAt: 11.2, active: true, largeVentMask: 273 },
        raceElapsed: 180.25, lanes: Array.from({ length: 8 }, (_, lane) => ({
            lane, edges: 0x3fffffff, cores: 0x3fffffff, grace: 0, edge: 0,
            hitId: serial * 1000 + 2 * 128 + 9 * 8 + lane + 1, launchAge: 0.4,
            start: { distance: 320, lateral: -10, y: -1.5, surfaceY: 0, speed: 3.4,
                heading: -0.4, duration: 1.2, peakHeight: 1.2, entryScale: 0.75, exitScale: 0.6 },
        })) };
}

test('八人三轮完整账本和腾空快照往返，带比赛前缀不超过 1536 字节', () => {
    const source = state(999999);
    const packet = encodeGeyserPacket(7, Number.MAX_SAFE_INTEGER, source);
    assert.ok(packet);
    assert.deepEqual(decodeGeyserPacket(packet).state, source);
    const bytes = Buffer.byteLength(Protocol.raceMessagePrefix('7.zzzzzzzzzzz') + packet);
    assert.ok(bytes <= 1536, String(bytes));
});

test('恢复包拒绝重复泳道、非法账本、跨代次起飞、异常时钟和超长包', () => {
    const source = state();
    for (const change of [
        s => s.lanes.push(s.lanes[0]),
        s => s.lanes[1].lane = 0,
        s => s.lanes[0].edges = 0,
        s => s.lanes[0].cores = 0x7fffffff,
        s => s.lanes[0].hitId += 1000,
        s => s.lanes[0].start.duration = -1,
        s => s.lanes[0].launchAge = 8,
        s => s.world.stoppedAt = 14,
        s => s.world.age = NaN,
        s => s.world.largeVentMask = 1024,
        s => s.world.largeVentMask = 3,
        s => s.world.largeVentMask = 24,
        s => s.world.largeVentMask = -1,
        s => { s.world.intensity = 1; s.world.largeVentMask = 1; },
        s => s.raceElapsed = -1,
    ]) {
        const copy = structuredClone(source);
        change(copy);
        assert.equal(encodeGeyserPacket(0, 1, copy), '');
    }
    assert.equal(decodeGeyserPacket('GY|' + 'a'.repeat(1500)), null);
});

test('结束恢复包保留落水保护和账本，无活动轨迹时不要求重新起飞', () => {
    const source = state();
    source.world.active = false;
    for (const lane of source.lanes) Object.assign(lane, { start: null, launchAge: 0, hitId: 0, grace: 0.65 });
    assert.deepEqual(decodeGeyserPacket(encodeGeyserPacket(0, 4, source)).state, source);
});

test('第四事件代次完整往返，默认零与大整数不丢槽', () => {
    for (const epochs of [[0, 0, 0, 0], [1, 2, 3, 4], [999998, 999997, 999996, 999999],
        [1048575, 1048575, 1048575, 1048575], [1048576, 2, 3, 4]]) {
        const packet = Snapshot.encodeRaceSnapshot(0, [], null, null, null, null, null, null, null, epochs);
        assert.deepEqual(Snapshot.decodeRaceSnapshot(packet).eventEpochs, epochs);
    }
});
