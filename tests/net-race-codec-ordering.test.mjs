import test from 'node:test';
import assert from 'node:assert/strict';

import SnapshotCodec from '../assets/scripts/net/NetRaceSnapshot.ts';
import InputCodec from '../assets/scripts/net/NetRaceInput.ts';
import Ordering from '../assets/scripts/net/NetInputOrdering.ts';
import Protocol from '../assets/scripts/net/NetRaceProtocol.ts';
import ConditionBalance from '../assets/scripts/core/ConditionBalance.ts';

const {
    decodeConditionHeartRate,
    decodeRaceSnapshot,
    decodeSelfSnapshot,
    encodeConditionHeartRate,
    encodeRaceSnapshot,
    encodeSelfSnapshot,
} = SnapshotCodec;
const { decodeInputFrame, encodeInputFrame } = InputCodec;
const {
    AiActionSequenceTracker,
    MonotonicSequenceTracker,
    ownerLaneMatches,
    shouldUseTransientPacketCondition,
} = Ordering;
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
        ...overrides,
    };
}

test('S| keeps legacy pose fields and appends condition cooldown', () => {
    const encoded = encodeRaceSnapshot(3, [entry()]);
    const fields = encoded.slice(encoded.indexOf('#') + 1).split(',');
    assert.equal(fields[10], '666');
    assert.equal(fields[11], '-777');
    assert.equal(fields[12], '150');
    assert.equal(fields[13], '149');
    assert.equal(fields[14], '321');

    const decoded = decodeRaceSnapshot(encoded);
    assert.equal(decoded.hostPos, 3);
    assert.equal(decoded.entries[0].collisionPitchVelocity, -0.777);
    assert.equal(decoded.entries[0].conditionEnergyRatio, 0.15);
    assert.equal(decoded.entries[0].conditionHeartRate, 149);
    assert.equal(decoded.entries[0].conditionDepletionCooldown, 0.321);
});

test('legacy S| and P| payloads keep safe sentinel defaults', () => {
    const legacyS = decodeRaceSnapshot('S|0#2,1234,-125,0,222,456,78,444,-555,-333,666,-777');
    assert.equal(legacyS.entries[0].conditionEnergyRatio, -1);
    assert.equal(legacyS.entries[0].conditionHeartRate, -1);
    assert.equal(legacyS.entries[0].conditionDepletionCooldown, -1);

    const legacyP = decodeSelfSnapshot('P|2,1234,-125,0,222,456,78,444,-555,-333,666,-777');
    assert.equal(legacyP.conditionEnergyRatio, -1);
    assert.equal(legacyP.ownerStateSeq, -1);
    assert.equal(legacyP.ownerPos, -1);
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
    assert.deepEqual(decoded.events, [{ kind: 'H', side: 1 }]);

    const noSelf = decodeInputFrame(encodeInputFrame(5, [], null, -1, 100));
    assert.equal(noSelf.self, undefined);
    assert.equal(noSelf.inputSeq, 100);
});

test('AI dolphin action keeps one identity and authoritative launch edge across packets', () => {
    const aiStart = {
        distance: 21.01,
        lateral: -0.123,
        heading: 0.222,
        headingVelocity: -0.333,
        speed: 4.56,
        axialRoll: 0.444,
        axialRollVelocity: -0.555,
        collisionPitch: 0.666,
        collisionPitchVelocity: -0.777,
        knockbackDistance: 0.888,
        knockbackLateral: -0.999,
    };
    const event = {
        kind: 'a',
        aiLane: 3,
        dolphinDive: true,
        aiActionSeq: 17,
        aiStart,
    };
    for (const packetSeq of [100, 101, 105]) {
        const decoded = decodeInputFrame(encodeInputFrame(2, [event], null, -1, packetSeq));
        assert.equal(decoded.inputSeq, packetSeq);
        assert.deepEqual(decoded.events, [event]);
    }
});

test('AI action ordering survives repeats, loss, delay, and host migration', () => {
    const order = new AiActionSequenceTracker();
    let applied = 0;
    const apply = (host, lane, sequence) => {
        if (sequence <= order.latest(host, lane)) return false;
        applied++;
        return order.markApplied(host, lane, sequence);
    };

    assert.equal(apply(1, 3, 7), true, 'a later redundant packet can recover a lost first packet');
    for (let i = 0; i < 10; i++) {
        assert.equal(apply(1, 3, 7), false);
    }
    assert.equal(applied, 1, 'the same action executes once even after its phase would have ended');
    assert.equal(apply(1, 3, 6), false, 'an older delayed action cannot roll the lane back');
    assert.equal(apply(1, 4, 1), true, 'each lane has an independent sequence');
    assert.equal(apply(5, 3, 1), true, 'a migrated host has an independent authority key');
    assert.equal(apply(1, 3, 8), true, 'the original seat may continue its monotonic counter if trusted again');
});

test('heart-rate quantization never crosses a quality-zone boundary', () => {
    for (const heartRate of [109.49, 109.5, 109.99, 110, 149.49, 149.5, 149.99, 150, 174.49, 174.5, 174.99, 175]) {
        const wire = decodeConditionHeartRate(encodeConditionHeartRate(heartRate));
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
