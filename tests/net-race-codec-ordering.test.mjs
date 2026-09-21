import test from 'node:test';
import assert from 'node:assert/strict';

import SnapshotCodec from '../assets/scripts/net/NetRaceSnapshot.ts';
import InputCodec from '../assets/scripts/net/NetRaceInput.ts';
import Ordering from '../assets/scripts/net/NetInputOrdering.ts';
import Protocol from '../assets/scripts/net/NetRaceProtocol.ts';
import ResultCodec from '../assets/scripts/net/NetRaceResult.ts';
import ConditionBalance from '../assets/scripts/core/ConditionBalance.ts';
import LitterCodec from '../assets/scripts/net/NetLitterSnapshot.ts';

const {
    decodeConditionHeartRate,
    decodeRaceSnapshot,
    decodeSelfSnapshot,
    encodeConditionHeartRate,
    encodeRaceSnapshot,
    encodeSelfSnapshot,
} = SnapshotCodec;
const { decodeInputFrame, encodeInputFrame } = InputCodec;
const { MonotonicSequenceTracker, ownerLaneMatches, shouldUseTransientPacketCondition } = Ordering;
const {
    NET_RACE_PROTOCOL_VERSION,
    decodeProtocolHello,
    decodeProtocolRequest,
    encodeProtocolHello,
    encodeProtocolRequest,
    hasCompatibleProtocol,
    isCompatibleProtocolVersion,
} = Protocol;
const { conditionQualityScale } = ConditionBalance;
const { decodeLitterSnapshot, encodeLitterSnapshot } = LitterCodec;
const { decodeRaceResult, encodeRaceResult } = ResultCodec;

function entry(overrides = {}) {
    return {
        lane: 2,
        distance: 12.34,
        lateral: -0.125,
        finished: false,
        heading: 0.222,
        headingVelocity: -0.333,
        speed: 4.56,
        energy: 78,
        axialRoll: 0.444,
        axialRollVelocity: -0.555,
        collisionPitch: 0.666,
        collisionPitchVelocity: -0.777,
        conditionEnergyRatio: 0.1496,
        conditionHeartRate: 149.9,
        conditionDepletionCooldown: 0.321,
        calmSlushRemaining: 2.345,
        ...overrides,
    };
}

function litterState(slotCount = 18) {
    return {
        revision: 999999,
        elapsedSeconds: 999.999,
        nextWave: 3,
        spawnOrder: slotCount,
        randomState: 0xffffffff,
        spawnRetryRemaining: 0.25,
        blockedWaveSeconds: 2.999,
        cancelledWaveCount: 1,
        slots: Array.from({ length: slotCount }, (_, id) => ({
            id,
            generation: 3,
            wave: Math.floor(id / 6),
            kind: id % 6 === 1 || id % 6 === 4 ? 'soft' : 'rigid',
            phase: id < 2 ? 'floating' : 'retiring',
            age: 18.999,
            courseX: 48.8,
            lateral: id % 2 === 0 ? -9.999 : 9.999,
            anchorCourseX: 48.8,
            anchorLateral: id % 2 === 0 ? -9.999 : 9.999,
            safeCenter: id % 2 === 0 ? -7.777 : 7.777,
            throwSide: id % 2 === 0 ? -1 : 1,
            visualVariant: id % 3,
            impactRevision: 99,
            driftPhase: 6.283,
            spawnOrder: id,
            insideMask: 0xff,
            bounceAlongVelocity: 2.45,
            bounceLateralVelocity: -1.764,
            retireStartCourseX: 48.8,
            retireStartLateral: id % 2 === 0 ? -9.999 : 9.999,
        })),
    };
}

test('S| keeps legacy pose fields and appends condition cooldown', () => {
    const encoded = encodeRaceSnapshot(3, [entry()], { revision: 7, collectedMask: 0x1fffff });
    const fields = encoded.slice(encoded.indexOf('#') + 1).split(',');
    assert.equal(fields[10], '666');
    assert.equal(fields[11], '-777');
    assert.equal(fields[12], '150');
    assert.equal(fields[13], '149');
    assert.equal(fields[14], '321');

    const decoded = decodeRaceSnapshot(encoded);
    assert.equal(decoded.hostPos, 3);
    assert.equal(decoded.stimulantRevision, 7);
    assert.equal(decoded.stimulantMask, 0x1fffff);
    assert.equal(decoded.entries[0].collisionPitchVelocity, -0.777);
    assert.equal(decoded.entries[0].conditionEnergyRatio, 0.15);
    assert.equal(decoded.entries[0].conditionHeartRate, 149);
    assert.equal(decoded.entries[0].conditionDepletionCooldown, 0.321);
    assert.equal(decoded.entries[0].calmSlushRemaining, 2.345);
});

test('stimulant pickup event round-trips on the reliable input channel', () => {
    const encoded = encodeInputFrame(2, [{ kind: 'p', itemId: 20, collectorLane: 6, revision: 9 }], null, -1, 44);
    const decoded = decodeInputFrame(encoded);
    assert.equal(decoded.senderPos, 2);
    assert.equal(decoded.inputSeq, 44);
    assert.deepEqual(decoded.events, [{ kind: 'p', itemId: 20, collectorLane: 6, revision: 9 }]);
});

test('minefield impact round-trips on the reliable input channel', () => {
    const encoded = encodeInputFrame(0, [{
        kind: 'i', mineId: 4, mineHitLane: 6, mineDistance: 27.35, mineLateral: -2.125, hitMask: 0b11100000, revision: 8,
    }], null, -1, 45);
    const decoded = decodeInputFrame(encoded);
    assert.deepEqual(decoded.events, [{
        kind: 'i', mineId: 4, mineHitLane: 6, mineDistance: 27.35, mineLateral: -2.125, hitMask: 0b11100000, revision: 8,
    }]);
});

test('garbage contact round-trips with slot generation, trajectory and monotonic revision', () => {
    const event = {
        kind: 'g',
        litterSlotId: 4,
        litterGeneration: 2,
        litterKind: 0,
        litterLane: 6,
        litterAway: -1,
        litterCourseX: 27.35,
        litterLateral: -2.125,
        litterBounceAlong: 2.45,
        litterBounceLateral: -1.764,
        revision: 18,
    };
    const decoded = decodeInputFrame(encodeInputFrame(0, [event], null, -1, 46));
    assert.deepEqual(decoded.events, [event]);
});

test('unified entertainment knockdown round-trips with the global recovery revision', () => {
    const event = {
        kind: 'u',
        recoveryLane: 6,
        recoveryReason: 4,
        knockedDistance: 127.35,
        revision: 19,
    };
    const decoded = decodeInputFrame(encodeInputFrame(0, [event], null, -1, 46));
    assert.deepEqual(decoded.events, [event]);
});

test('shark state and knockdown event round-trip across both sync fallbacks', () => {
    const shark = {
        sequence: 3,
        state: 6,
        raceElapsed: 55.432,
        remainingSeconds: 7.321,
        huntOpeningGraceSeconds: 0.444,
        x: 18.27,
        z: -2.31,
        facingX: 0.707,
        facingZ: -0.707,
        targetLane: 5,
        knockedLane: 2,
        huntIndex: 2,
    };
    const snapshot = decodeRaceSnapshot(encodeRaceSnapshot(0, [entry()], null, shark));
    assert.deepEqual(snapshot.shark, shark);

    const event = decodeInputFrame(encodeInputFrame(
        0,
        [{ kind: 'e', sharkSequence: 3, targetLane: 2, knockedDistance: 86.42 }],
        null,
        -1,
        45,
    ));
    assert.deepEqual(event.events, [{ kind: 'e', sharkSequence: 3, targetLane: 2, knockedDistance: 86.42 }]);
});

test('authoritative results preserve shark and cannon elimination separately from ordinary DNF', () => {
    const entries = [
        { lane: 2, placement: 7, finished: false, time: 0, eliminated: true, sharkEliminated: true, cannonEliminated: false, quit: false },
        { lane: 3, placement: 6, finished: false, time: 0, eliminated: true, sharkEliminated: false, cannonEliminated: true, quit: false },
    ];
    assert.deepEqual(decodeRaceResult(encodeRaceResult(entries, 0, 1)), { hostPos: 0, sequence: 1, entries });
});

test('成绩来源与序号严格校验，非法或重复泳道不能生成部分有效结果', () => {
    for (const payload of ['R|0,1,1,100,0,0,0', 'R|0,0|0,1,1,100,0,0,0',
        'R|8,1|0,1,1,100,0,0,0', 'R|0,1|0,1,1,-1,0,0,0',
        'R|0,1|0,1,1,100,0,0,0;0,2,1,100,0,0,0',
        'R|0,1|0,1,1,100,0,0,0;1,1,1,100,0,0,0']) assert.equal(decodeRaceResult(payload), null);
    const rows = Array.from({ length: 8 }, (_, lane) => ({ lane, placement: lane + 1, finished: true, time: 999.99 }));
    const payload = encodeRaceResult(rows, 7, 999999);
    assert.equal(decodeRaceResult(payload).entries.length, 8);
    assert.ok(Buffer.byteLength(payload) < 512);
});

test('权威成绩保留主动退出标记，兼容旧行并拒绝非法退出值', () => {
    const rows = [{ lane: 1, placement: 2, finished: false, time: 0, eliminated: true, quit: true }];
    const result = decodeRaceResult(encodeRaceResult(rows, 0, 1));
    assert.equal(result.entries[0].quit, true);
    assert.equal(result.entries[0].eliminated, true);
    assert.equal(decodeRaceResult('R|0,1|1,2,0,0,1,0,0').entries[0].quit, false);
    for (const value of ['2', '-1', '', 'true']) {
        assert.equal(decodeRaceResult(`R|0,1|1,2,0,0,1,0,0,${value}`), null);
    }
});

test('cannon launch, impact and active strike round-trip across reliable events and snapshot fallback', () => {
    const launch = decodeInputFrame(encodeInputFrame(
        0,
        [{ kind: 'l', cannonStrikeId: 3, targetDistance: 87.36, targetZ: -4.125, warningSeconds: 1.25, revision: 7 }],
        null,
        -1,
        46,
    ));
    assert.deepEqual(launch.events, [{
        kind: 'l', cannonStrikeId: 3, targetDistance: 87.36, targetZ: -4.125, warningSeconds: 1.25, revision: 7,
    }]);
    const impact = decodeInputFrame(encodeInputFrame(
        0,
        [{ kind: 'x', cannonStrikeId: 3, hitMask: 0b01010100, knockedLane: 6, knockedDistance: 87.12, revision: 8 }],
        null,
        -1,
        47,
    ));
    assert.deepEqual(impact.events, [{ kind: 'x', cannonStrikeId: 3, hitMask: 0b01010100, knockedLane: 6, knockedDistance: 87.12, revision: 8 }]);

    const state = {
        revision: 7,
        completedStrikeMask: 0b111,
        activeStrikeId: 3,
        targetDistance: 87.36,
        targetZ: -4.125,
        remainingSeconds: 0.73,
    };
    const snapshot = decodeRaceSnapshot(encodeRaceSnapshot(0, [entry()], null, null, state));
    assert.equal(snapshot.cannonRevision, 7);
    assert.equal(snapshot.cannonCompletedMask, 0b111);
    assert.equal(snapshot.cannonActiveStrikeId, 3);
    assert.equal(snapshot.cannonTargetDistance, 87.36);
    assert.equal(snapshot.cannonTargetZ, -4.125);
    assert.equal(snapshot.cannonRemainingSeconds, 0.73);
});

test('entertainment recovery phases and authoritative respawn distance round-trip in S|', () => {
    const recovery = {
        revision: 9,
        lanes: [
            { phase: 0, reason: 0, remainingSeconds: 0, distance: 0, revision: 0 },
            { phase: 1, reason: 1, remainingSeconds: 1.234, distance: 54.32, revision: 8 },
            { phase: 2, reason: 3, remainingSeconds: 0.876, distance: 87.65, revision: 9 },
        ],
    };
    const snapshot = decodeRaceSnapshot(encodeRaceSnapshot(0, [entry()], null, null, null, null, recovery));
    assert.deepEqual(snapshot.recovery, recovery);
});

test('minefield lifecycle state round-trips in S|', () => {
    const minefield = {
        revision: 8,
        elapsedSeconds: 14.321,
        activeMask: 0b1011011,
        armedMask: 0b0011011,
        waveIndex: 2,
        slotWavesPacked: 0b10_01_01_00_00_00_00,
    };
    const snapshot = decodeRaceSnapshot(encodeRaceSnapshot(
        0, [entry()], null, null, null, null, null, minefield,
    ));
    assert.deepEqual(snapshot.minefield, minefield);
});

test('garbage lifecycle and active slot state round-trips in the periodic L| fallback', () => {
    const litter = litterState(18);
    const snapshot = decodeLitterSnapshot(encodeLitterSnapshot(3, litter));
    assert.equal(snapshot.hostPos, 3);
    assert.deepEqual(snapshot.state, litter);
});

test('18槽负坐标和高接触修订含房间前缀仍有载荷余量，量化精度不变', () => {
    const state = litterState(18);
    for (const slot of state.slots) {
        slot.lateral = slot.anchorLateral = slot.retireStartLateral = -9.999;
        slot.safeCenter = -7.777;
        slot.impactRevision = 999999;
        slot.bounceAlongVelocity = -2.45;
    }
    const payload = encodeLitterSnapshot(7, state, Number.MAX_SAFE_INTEGER);
    const bytes = Buffer.byteLength(Protocol.raceMessagePrefix('7.zzzzzzzzzzz') + payload);
    assert.ok(bytes <= 1450, `18槽须在1536字节内保留余量，实际${bytes}`);
    assert.deepEqual(decodeLitterSnapshot(payload), { hostPos: 7, sequence: Number.MAX_SAFE_INTEGER, state });
});

test('整包序号支持旧格式读取与安全整数边界，非法序号不能降级成无序快照', () => {
    const race = sequence => encodeRaceSnapshot(0, [entry()], null, null, null, null, null, null, null, null, sequence);
    const litter = sequence => encodeLitterSnapshot(0, litterState(0), sequence);
    assert.equal(decodeRaceSnapshot(race()).sequence, -1);
    assert.equal(decodeLitterSnapshot(litter()).sequence, -1);
    for (const sequence of [0, 1, 36, 999999, Number.MAX_SAFE_INTEGER]) {
        assert.equal(decodeRaceSnapshot(race(sequence)).sequence, sequence);
        assert.equal(decodeLitterSnapshot(litter(sequence)).sequence, sequence);
    }
    for (const invalid of ['!', '!-1', '!1$', '!zzzzzzzzzzzzz']) {
        for (const [payload, slot, decode] of [[race(1), 4, decodeRaceSnapshot], [litter(1), 9, decodeLitterSnapshot]]) {
            const [header, body] = payload.split('#');
            const fields = header.split(','); fields[slot] = invalid;
            assert.equal(decode(fields.join(',') + '#' + body), null);
        }
    }
});

test('八泳道满状态快照保持在项目的一点五千字节回归预算内', () => {
    const entries = Array.from({ length: 8 }, (_, lane) => entry({
        lane,
        distance: 400,
        lateral: lane % 2 === 0 ? -10 : 10,
        finished: lane === 7,
        heading: Math.PI,
        headingVelocity: -20,
        speed: 12,
        energy: 100,
        axialRoll: Math.PI,
        axialRollVelocity: -20,
        collisionPitch: Math.PI,
        collisionPitchVelocity: -20,
        conditionEnergyRatio: 1,
        conditionHeartRate: 180,
        conditionDepletionCooldown: 10,
        collisionSoftness: { side: 2, forward: -2, sideVelocity: 20, forwardVelocity: -20 },
        abilityState: { depth: 2, kickRemaining: 2, stacks: 10, idleRemaining: 10 },
    }));
    const recovery = {
        revision: 999999,
        lanes: entries.map((_, lane) => ({
            phase: 2,
            reason: 4,
            remainingSeconds: 99.999,
            distance: 400,
            revision: 999999 - lane,
        })),
    };
    const payload = encodeRaceSnapshot(
        7,
        entries,
        { revision: 999999, collectedMask: 0x7fffffff, collectorLanes: Array(21).fill(7), pickupRevisions: Array.from({ length: 21 }, (_, i) => 21 - i) },
        {
            sequence: 999999, state: 4, raceElapsed: 999.999, remainingSeconds: 99.999,
            huntOpeningGraceSeconds: 9.999, x: 400, z: -10, facingX: -1, facingZ: 1,
            targetLane: 7, knockedLane: 7, huntIndex: 99,
        },
        {
            revision: 999999, completedStrikeMask: 0x7fffffff, activeStrikeId: 9,
            targetDistance: 400, targetZ: -10, remainingSeconds: 99.999,
        },
        {
            revision: 999999, completedRoundMask: 0x7fffffff, explodedRoundMask: 0x7fffffff,
            resolvedCarrierLanesPacked: 0x7fffffff, activeRoundId: 9, carrierLane: 7,
            previousCarrierLane: 6, lastStarterLane: 7, remainingSeconds: 99.999,
            transferCooldownSeconds: 9.999, returnProtectionSeconds: 9.999, recoverySeconds: 9.999,
        },
        recovery,
        {
            revision: 999999, elapsedSeconds: 999.999,
            activeMask: 0x7fffffff, armedMask: 0x7fffffff,
            waveIndex: 2, slotWavesPacked: 0x3fff,
        },
        {
            revision: 999999, phase: 4, eventIndex: 5, eventCount: 6, remainingSeconds: 99.999,
            packedEvents: 0x7fffffff, activatedMask: 0x7fffffff, residentMask: 0x7fffffff,
            specialMask: 0x7fffffff, activationSerial: 999999, lastActivatedEvent: 5,
            encoreRound: 999999, encoreEvent: 5, anchorDistance: 400,
            eventAnchorDistances: [32, 96, 160, 224, 288, 360],
        },
        [999999, 999999, 999999],
        Number.MAX_SAFE_INTEGER,
    );
    const prefix = Protocol.raceMessagePrefix('7.zzzzzzzzzzz');
    const snapshotBytes = Buffer.byteLength(prefix + payload, 'utf8');
    assert.ok(snapshotBytes <= 1536, `snapshot bytes=${snapshotBytes}`);
    const decoded = decodeRaceSnapshot(payload);
    assert.equal(decoded.sequence, Number.MAX_SAFE_INTEGER);
    for (const revision of [decoded.stimulantRevision, decoded.cannonRevision, decoded.mineRelay.revision,
        decoded.recovery.revision, decoded.minefield.revision, decoded.entertainmentDirector.revision,
        decoded.entertainmentDirector.activationSerial, decoded.entertainmentDirector.encoreRound]) {
        assert.equal(revision, 999999);
    }
    assert.deepEqual(decoded.eventEpochs, [999999, 999999, 999999]);
    assert.deepEqual(decoded.entertainmentDirector.eventAnchorDistances, [32, 96, 160, 224, 288, 360]);
    const litterPayload = encodeLitterSnapshot(7, litterState(18), Number.MAX_SAFE_INTEGER);
    const litterBytes = Buffer.byteLength(prefix + litterPayload, 'utf8');
    assert.ok(litterBytes <= 1536, `litter snapshot bytes=${litterBytes}`);
});

test('timed bomb arm, transfer, resolution and active state round-trip across both sync paths', () => {
    const events = [
        { kind: 'm', mineRoundId: 2, mineCarrierLane: 5, fuseSeconds: 6.5, revision: 11 },
        { kind: 't', mineRoundId: 2, mineFromLane: 5, mineToLane: 3, remainingSeconds: 4.321, revision: 12 },
        { kind: 'b', mineRoundId: 2, mineCarrierLane: 3, exploded: true, mineDistance: 91.24, mineLateral: -1.25, hitMask: 0b00111000, revision: 13 },
    ];
    const decoded = decodeInputFrame(encodeInputFrame(0, events, null, -1, 48));
    assert.deepEqual(decoded.events, events);

    const state = {
        revision: 12,
        completedRoundMask: 0b11,
        explodedRoundMask: 0b01,
        resolvedCarrierLanesPacked: 0x46,
        activeRoundId: 2,
        carrierLane: 3,
        previousCarrierLane: 5,
        lastStarterLane: 5,
        remainingSeconds: 4.321,
        transferCooldownSeconds: 0.612,
        returnProtectionSeconds: 1.012,
        recoverySeconds: 0,
    };
    const snapshot = decodeRaceSnapshot(encodeRaceSnapshot(0, [entry()], null, null, null, state));
    assert.deepEqual(snapshot.mineRelay, state);
});

test('legacy S| and P| payloads keep safe sentinel defaults', () => {
    const legacyS = decodeRaceSnapshot('S|0#2,1234,-125,0,222,456,78,444,-555,-333,666,-777');
    assert.equal(legacyS.entries[0].conditionEnergyRatio, -1);
    assert.equal(legacyS.entries[0].conditionHeartRate, -1);
    assert.equal(legacyS.entries[0].conditionDepletionCooldown, -1);
    assert.equal(legacyS.entries[0].calmSlushRemaining, -1);
    assert.equal(legacyS.mineRelay.activeRoundId, -1);
    assert.equal(legacyS.mineRelay.carrierLane, -1);
    assert.deepEqual(legacyS.minefield, {
        revision: 0,
        elapsedSeconds: 0,
        activeMask: 0,
        armedMask: 0,
        waveIndex: 0,
        slotWavesPacked: 0,
    });

    const legacyP = decodeSelfSnapshot('P|2,1234,-125,0,222,456,78,444,-555,-333,666,-777');
    assert.equal(legacyP.conditionEnergyRatio, -1);
    assert.equal(legacyP.ownerStateSeq, -1);
    assert.equal(legacyP.ownerPos, -1);
    assert.equal(legacyP.calmSlushRemaining, -1);
});

test('P| appends owner sequence and seat after condition without shifting pose fields', () => {
    const encoded = encodeSelfSnapshot(entry(), 41, 5);
    const fields = encoded.slice(2).split(',');
    assert.equal(fields[10], '666');
    assert.equal(fields[11], '-777');
    assert.equal(fields[12], '150');
    assert.equal(fields[13], '149');
    assert.equal(fields[14], '41');
    assert.equal(fields[15], '5');
    const decoded = decodeSelfSnapshot(encoded);
    assert.equal(decoded.ownerStateSeq, 41);
    assert.equal(decoded.ownerPos, 5);
    assert.equal(decoded.calmSlushRemaining, 2.345);
});

test('frame self and input sequence round-trip, including an empty self slot', () => {
    const payload = encodeInputFrame(
        5,
        [{ kind: 'H', side: 1 }],
        entry(),
        42,
        99,
    );
    const decoded = decodeInputFrame(payload);
    assert.equal(decoded.senderPos, 5);
    assert.equal(decoded.inputSeq, 99);
    assert.equal(decoded.self.ownerStateSeq, 42);
    assert.equal(decoded.self.calmSlushRemaining, 2.345);
    assert.deepEqual(decoded.events, [{ kind: 'H', side: 1 }]);

    const noSelf = decodeInputFrame(encodeInputFrame(5, [], null, -1, 100));
    assert.equal(noSelf.self, undefined);
    assert.equal(noSelf.inputSeq, 100);
});

test('状态快照保留整数心率，旧condition质量倍率维持中性', () => {
    for (const heartRate of [109.49, 109.5, 109.99, 110, 149.49, 149.5, 149.99, 150, 174.49, 174.5, 174.99, 175]) {
        const wire = decodeConditionHeartRate(encodeConditionHeartRate(heartRate));
        assert.equal(wire, Math.floor(heartRate));
        assert.equal(conditionQualityScale(wire), 1);
        assert.equal(conditionQualityScale(wire), conditionQualityScale(heartRate), `heartRate=${heartRate}`);
    }
});

test('one monotonic tracker orders reliable and broadcast input permanently', () => {
    const order = new MonotonicSequenceTracker();
    assert.equal(order.accept(7, 100), true);
    assert.equal(order.accept(7, 101), true);
    assert.equal(order.accept(7, 100), false);
    assert.equal(order.accept(7, 101), false);
    assert.equal(order.accept(7, 36), false, 'old input stays rejected beyond the former 64-frame window');
    assert.equal(order.accept(7, -1), false, 'legacy input cannot roll back a sequenced sender');
    assert.equal(order.latest(7), 101);

    assert.equal(order.accept(8, -1), true, 'pure legacy sender remains parse-compatible');
    assert.equal(order.accept(8, -1), true);
    assert.equal(order.accept(8, 1), true);
    assert.equal(order.accept(8, -1), false);
});

test('an overtaken IN| uses its own condition only for its accepted events', () => {
    assert.equal(shouldUseTransientPacketCondition(true, 1, false, 0.04, 149), true);
    assert.equal(shouldUseTransientPacketCondition(false, 1, false, 0.04, 149), false);
    assert.equal(shouldUseTransientPacketCondition(true, 0, false, 0.04, 149), false);
    assert.equal(shouldUseTransientPacketCondition(true, 1, true, 0.04, 149), false);
    assert.equal(shouldUseTransientPacketCondition(true, 1, false, -1, -1), false);
});

test('an attributed P| or frame self cannot update another registered lane', () => {
    assert.equal(ownerLaneMatches(3, 3), true);
    assert.equal(ownerLaneMatches(3, 4), false);
    assert.equal(ownerLaneMatches(undefined, 4), true, 'registration startup stays compatible');
});

test('lobby protocol hello rejects missing or mixed versions', () => {
    assert.equal(NET_RACE_PROTOCOL_VERSION, 103);
    const hello = decodeProtocolHello(encodeProtocolHello(4));
    assert.deepEqual(hello, { pos: 4, version: NET_RACE_PROTOCOL_VERSION });
    assert.equal(decodeProtocolHello('PV|4|bad'), null);
    assert.equal(hasCompatibleProtocol([0, 4], { 0: NET_RACE_PROTOCOL_VERSION, 4: NET_RACE_PROTOCOL_VERSION }), true);
    assert.equal(hasCompatibleProtocol([0, 4], { 0: NET_RACE_PROTOCOL_VERSION }), false);
    assert.equal(hasCompatibleProtocol([0, 4], { 0: NET_RACE_PROTOCOL_VERSION, 4: NET_RACE_PROTOCOL_VERSION - 1 }), false);
    assert.equal(isCompatibleProtocolVersion(NET_RACE_PROTOCOL_VERSION), true);
    assert.equal(isCompatibleProtocolVersion(undefined), false, 'legacy start without pv is rejected');
    assert.equal(isCompatibleProtocolVersion(NET_RACE_PROTOCOL_VERSION - 1), false);
});

test('lobby protocol request lets a missing declaration be retried without a hello echo', () => {
    const request = decodeProtocolRequest(encodeProtocolRequest(0));
    assert.deepEqual(request, { requesterPos: 0 });
    assert.equal(decodeProtocolRequest('PVQ|'), null);
    assert.equal(decodeProtocolRequest('PVQ|0|2'), null);
    assert.equal(decodeProtocolRequest('PVQ|-1'), null);
    assert.equal(decodeProtocolRequest('PVQ|1.5'), null);
    assert.equal(decodeProtocolRequest(encodeProtocolHello(0)), null, 'a hello is never decoded as a request');
    assert.equal(decodeProtocolHello(encodeProtocolRequest(0)), null, 'a request is never decoded as a hello');

    // Reproduce the asymmetric-loss case: the guest already knows both versions,
    // while the host lost the guest's first hello. The explicit request causes one
    // fresh guest hello, after which the host can pass the protocol gate.
    const hostVersions = { 0: NET_RACE_PROTOCOL_VERSION };
    const guestVersions = { 0: NET_RACE_PROTOCOL_VERSION, 4: NET_RACE_PROTOCOL_VERSION };
    assert.equal(hasCompatibleProtocol([0, 4], hostVersions), false);
    assert.equal(hasCompatibleProtocol([0, 4], guestVersions), true);
    const retriedHello = decodeProtocolHello(encodeProtocolHello(4));
    hostVersions[retriedHello.pos] = retriedHello.version;
    assert.equal(hasCompatibleProtocol([0, 4], hostVersions), true);
});


test('三个同步通道均保留正体力与耗尽边界', () => {
    for (const ratio of [1, .01, .00049, .000001, 0]) {
        const e = entry({ conditionEnergyRatio: ratio });
        const copies = [decodeRaceSnapshot(encodeRaceSnapshot(0, [e])).entries[0],
            decodeSelfSnapshot(encodeSelfSnapshot(e, 1, 1)),
            decodeInputFrame(encodeInputFrame(1, [], e, 1, 1)).self];
        for (const copy of copies) {
            assert.equal(copy.conditionEnergyRatio > 0, ratio > 0);
            assert.equal(ConditionBalance.conditionEfficiencyScale(copy.conditionEnergyRatio),
                ConditionBalance.conditionEfficiencyScale(ratio));
        }
    }
});


test('划水事件携带动作心率，百分之一精度与同包及旧包状态独立', () => {
    for(const hr of [80,100.01,139.99,160,179.98,180]) {
        const packet=encodeInputFrame(0,[{kind:'s',side:1,heartRate:hr}],entry({conditionHeartRate:180}),3);
        const decoded=decodeInputFrame(packet);
        assert.equal(decoded.events[0].heartRate,hr);
        assert.equal(decoded.events[0].side,1);
    }
    assert.deepEqual(decodeInputFrame('0|s0').events,[{kind:'s',side:0}]);
});
