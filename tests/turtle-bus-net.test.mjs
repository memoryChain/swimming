import test from 'node:test';
import assert from 'node:assert/strict';

import Codec from '../assets/scripts/net/NetTurtleBusSnapshot.ts';
import RaceSnapshot from '../assets/scripts/net/NetRaceSnapshot.ts';
import Director from '../assets/scripts/core/EntertainmentModeDirector.ts';
import RacePlan from '../assets/scripts/core/EntertainmentRacePlan.ts';
import Geometry from '../assets/scripts/core/TurtleBusGeometry.ts';

const { encodeTurtleBusSnapshot, decodeTurtleBusSnapshot,
    encodeTurtleBusPacket, decodeTurtleBusPacket } = Codec;
const { encodeRaceSnapshot, decodeRaceSnapshot } = RaceSnapshot;
const { EntertainmentModeDirector, EntertainmentEventId, EntertainmentDirectorPhase,
    buildEntertainmentEventOrder } = Director;
const { buildEntertainmentRacePlan } = RacePlan;
const { TURTLE_BUS_GEOMETRY } = Geometry;

test('四圈快照按固定泳道恢复，旧房主空包与非法双占拒绝', () => {
    const state = { tripId: 17, phase: 'cruising', age: 6.75, direction: -1, routeZ: 4, startOffset: 18.6,
        occupants: [3, -1, 0, 7], hands: [3, 0, 1, 2] };
    const packed = encodeTurtleBusSnapshot(state);
    assert.ok(packed.startsWith('^'));
    assert.deepEqual(decodeTurtleBusSnapshot(packed), state);
    assert.equal(decodeTurtleBusSnapshot(packed.replace('.56.', '.zz.')), null);
    assert.equal(encodeTurtleBusSnapshot(null), '');
    assert.equal(decodeTurtleBusSnapshot('^1.4.a.1.1.zzzz.0'), null);
    assert.equal(encodeTurtleBusSnapshot({ ...state, occupants: [3, 3, -1, -1], hands: [3, 3, 0, 0] }), '');
    const invalidDuplicate = packed.replace(/\.[0-9a-z]+\.[0-9a-z]+$/, '.44.5');
    assert.equal(decodeTurtleBusSnapshot(invalidDuplicate), null);
});

test('保护截止按圈量化往返，拒绝空圈保护及超长保护字段',()=>{
    const state={tripId:7,phase:'cruising',age:6.75,direction:-1,routeZ:0,startOffset:16,
        occupants:[4,-1,2,-1],hands:[3,0,3,0],gripProtectedUntil:[7.95,0,7.3,0]};
    const packed=encodeTurtleBusPacket(0,1,state);
    assert.deepEqual(decodeTurtleBusPacket(packed).state,state);
    assert.ok(Buffer.byteLength(packed)<100);
    assert.equal(encodeTurtleBusSnapshot({...state,gripProtectedUntil:[7.95,1,7.3,0]}),'');
    assert.equal(encodeTurtleBusSnapshot({...state,gripProtectedUntil:[99,0,7.3,0]}),'');
    assert.equal(decodeTurtleBusSnapshot(encodeTurtleBusSnapshot(state).replace(/~.*/,'~zzzz.0.0.0')),null);
    assert.equal(decodeTurtleBusSnapshot(encodeTurtleBusSnapshot(state)+'.0'),null);
});

test('独立 TB 包不挤占满载 S 包，带比赛前缀仍低于 768 字节', () => {
    const state = { tripId: 1, phase: 'boarding', age: 3.25, direction: 1, routeZ: 0, startOffset: 16,
        occupants: [2, -1, -1, -1], hands: [3, 0, 0, 0] };
    const plain = encodeRaceSnapshot(0, []);
    const packet = encodeTurtleBusPacket(7, 999999, state);
    assert.deepEqual(decodeTurtleBusPacket(packet), { hostPos: 7, sequence: 999999, state });
    assert.ok(Buffer.byteLength('G|7.zzzzzzzzzzz|' + packet) < 768);
    assert.equal(decodeTurtleBusPacket(packet.replace('TB|7,', 'TB|8,')), null);
    assert.equal(decodeTurtleBusPacket(packet + '!'), null);
    const shark = { sequence: 1, state: 2, raceElapsed: 2, remainingSeconds: 1,
        huntOpeningGraceSeconds: 0, x: 10, z: 0, facingX: 1, facingZ: 0,
        targetLane: 0, knockedLane: -1, huntIndex: 0 };
    const combined = encodeRaceSnapshot(0, [], null, shark);
    assert.ok(combined.length > plain.length);
    assert.equal(decodeRaceSnapshot(combined).shark.sequence, 1);
});

test('正式编排的海龟只出现在非末位，超时无车可搭可权威替换', () => {
    let found = false;
    for (let seed = 0; seed < 200; seed++) {
        const events = buildEntertainmentEventOrder(seed, 200);
        const index = events.indexOf(EntertainmentEventId.TURTLE_BUS);
        if (index < 0) continue;
        found = true;
        assert.ok(index < events.length - 1);
    }
    assert.ok(found);
    let seed = 0;
    while (buildEntertainmentEventOrder(seed, 200)[0] !== EntertainmentEventId.TURTLE_BUS) seed++;
    const host = new EntertainmentModeDirector(seed, 200);
    host.update(5, 200);
    host.update(host.previewDurationSeconds() + .01, 200);
    assert.equal(host.snapshot().phase, EntertainmentDirectorPhase.ACTIVE);
    const changed = host.replaceUnavailableTurtle();
    assert.equal(changed.finishedEvent, EntertainmentEventId.TURTLE_BUS);
    assert.ok(changed.activatedEvent >= 0);
    assert.ok(!buildEntertainmentEventOrder(seed, 200).includes(changed.activatedEvent));
    assert.equal(new Set(host.selectedEvents()).size, host.selectedEvents().length);
    const guest = new EntertainmentModeDirector(seed, 200);
    assert.equal(guest.applySnapshot(host.snapshot()).snapshotAccepted, true);
    assert.equal(guest.currentEvent(), changed.activatedEvent);
    const plan = buildEntertainmentRacePlan(seed, 400, 4);
    const graded = new EntertainmentModeDirector(seed, 400, true, undefined, undefined,
        undefined, plan);
    assert.equal(graded.selectedEvents().length, plan.stages.length);
});

test('不同随机种子下班车失约替代不重复已选事件，三类事件仍齐全', () => {
    let checked = 0;
    for (const distance of [200, 400]) {
        for (let seed = 0; seed < 160; seed++) {
            const order = buildEntertainmentEventOrder(seed, distance);
            if (order[0] !== EntertainmentEventId.TURTLE_BUS) continue;
            const host = new EntertainmentModeDirector(seed, distance);
            host.update(5, distance);
            host.update(host.previewDurationSeconds() + .01, distance);
            const transition = host.replaceUnavailableTurtle();
            assert.equal(transition.finishedEvent, EntertainmentEventId.TURTLE_BUS);
            assert.ok(!order.includes(transition.activatedEvent));
            const selected = host.selectedEvents();
            assert.equal(new Set(selected).size, selected.length);
            assert.ok(selected.some(event => event === EntertainmentEventId.WHIRLPOOL
                || event === EntertainmentEventId.OBSTACLE));
            assert.ok(selected.some(event => event === EntertainmentEventId.STIMULANT
                || event === EntertainmentEventId.TIMED_BOMB));
            assert.ok(selected.some(event => event === EntertainmentEventId.SHARK
                || event === EntertainmentEventId.CANNON));
            checked++;
        }
    }
    assert.ok(checked >= 10);
});

test('离线作者模型共享圈绳、独立四鳍，实例总面数和实体范围符合预算', () => {
    const groups = Object.values(TURTLE_BUS_GEOMETRY);
    assert.equal(groups.length, 7);
    let triangles = 0;
    for (const mesh of groups) {
        assert.equal(mesh.positions.length % 3, 0);
        assert.equal(mesh.colors.length, mesh.positions.length / 3 * 4);
        assert.equal(mesh.indices.length % 3, 0);
        assert.ok(mesh.indices.every(index => index >= 0 && index < mesh.positions.length / 3));
        triangles += mesh.indices.length / 3;
    }
    triangles += (TURTLE_BUS_GEOMETRY.ring.indices.length + TURTLE_BUS_GEOMETRY.rope.indices.length);
    assert.ok(triangles <= 4000);
    const x=TURTLE_BUS_GEOMETRY.body.positions.filter((_,i)=>i%3===0);
    assert.ok(Math.max(...x)-Math.min(...x)<3.4);
});

test('预告原地潜走携带取消时刻，非法载客取消与未来取消被拒绝',()=>{
    const state={tripId:3,phase:'submerging',age:1.2,direction:1,routeZ:0,startOffset:16,
        occupants:[-1,-1,-1,-1],hands:[0,0,0,0],cancelAge:.8};
    assert.deepEqual(decodeTurtleBusPacket(encodeTurtleBusPacket(0,8,state)).state,state);
    assert.equal(encodeTurtleBusPacket(0,8,{...state,cancelAge:2}), '');
    assert.equal(encodeTurtleBusPacket(0,8,{...state,occupants:[0,-1,-1,-1],hands:[3,0,0,0]}),'');
});
