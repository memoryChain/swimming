import test from 'node:test';
import assert from 'node:assert/strict';
import Plan from '../assets/scripts/core/EntertainmentRacePlan.ts';
import Director from '../assets/scripts/core/EntertainmentModeDirector.ts';
import Cadence from '../assets/scripts/core/EntertainmentCadence.ts';
import Safety from '../assets/scripts/core/EntertainmentBackgroundSafety.ts';
import Codec from '../assets/scripts/net/NetRaceSnapshot.ts';

const { EntertainmentModeDirector, EntertainmentEventId: E, EntertainmentDirectorPhase: P } = Director;
const create = (seed, distance, plan) => new EntertainmentModeDirector(seed, distance, true,
    undefined, undefined, undefined, plan);

test('4档追加在途中发生，500种子中位数达标且基础段完整结束、不越级、不重复场地', () => {
    for (const distance of [200, 400]) {
        const counts = [];
        let inserted = 0;
        for (let seed = 1; seed <= 500; seed++) {
            const plan = Plan.buildEntertainmentRacePlan(seed, distance, 4), host = create(seed, distance, plan);
            const ended = new Set(), fields = new Set();
            let count = 0;
            for (let frame = 1; frame / 30 * 2.5 < distance; frame++) {
                const before = host.snapshot().eventIndex;
                const change = host.update(1 / 30, frame / 30 * 2.5, true, 2.5);
                if (change.activatedEvent !== null) {
                    count++;
                    const index = host.snapshot().eventIndex;
                    assert.notEqual(change.activatedEvent, E.SHARK);
                    if (!plan.stages[index].required && index < plan.stages.length - 2) inserted++;
                    if (Cadence.ENTERTAINMENT_FIELD_EVENTS.includes(change.activatedEvent)) {
                        assert.equal(fields.has(change.activatedEvent), false);
                        fields.add(change.activatedEvent);
                    }
                }
                if (change.finishedEvent !== null) ended.add(before);
            }
            for (const [index, stage] of plan.stages.entries()) {
                if (stage.required) assert.ok(ended.has(index), `${distance}:${seed}:${index}`);
            }
            assert.equal(host.lockAfterFirstFinish().cancelledPreview, false);
            assert.ok(count <= (distance === 400 ? 6 : 4));
            counts.push(count);
        }
        counts.sort((a, b) => a - b);
        assert.ok(counts[250] >= (distance === 400 ? 5 : 3));
        assert.ok(inserted > 0, '不能只在最后返场');
    }
});

test('追加机会预告／活动快照可往返、乱序不回拨，迁移后继续同一事件和剩余基础段', () => {
    for (const phase of [P.PREVIEW, P.ACTIVE]) {
        let tested = false;
        for (let seed = 1; seed <= 25 && !tested; seed++) {
            const plan = Plan.buildEntertainmentRacePlan(seed, 400, 4), host = create(seed, 400, plan);
            let successor = null;
            for (let frame = 1; frame < 160 * 30; frame++) {
                const distance = frame / 30 * 2.5;
                const change = host.update(1 / 30, distance, true, 2.5);
                if (successor) {
                    const remote = successor.update(1 / 30, distance, true, 2.5);
                    assert.equal(remote.activatedEvent, change.activatedEvent);
                    assert.equal(remote.finishedEvent, change.finishedEvent);
                    assert.equal(successor.snapshot().eventIndex, host.snapshot().eventIndex);
                    assert.deepEqual(successor.selectedEvents(), host.selectedEvents());
                } else if (host.phaseId() === phase && host.currentGradedStage()?.required === false) {
                    successor = create(seed, 400, plan);
                    const payload = Codec.encodeRaceSnapshot(0, [], null, null, null, null, null, null, host.snapshot());
                    assert.ok(Buffer.byteLength(payload) < 1536);
                    const state = Codec.decodeRaceSnapshot(payload).entertainmentDirector;
                    assert.equal(successor.applySnapshot(state).snapshotAccepted, true);
                    assert.equal(successor.currentEvent(), host.currentEvent());
                    assert.equal(successor.currentGradedStage().durationSeconds, host.currentGradedStage().durationSeconds);
                    assert.equal(successor.applySnapshot({ ...state, revision: state.revision - 1 }).snapshotAccepted, false);
                    assert.equal(successor.applySnapshot({ ...state,
                        packedEvents: state.packedEvents & ~0xf0 | E.SHARK << 4 }).snapshotAccepted, false);
                    tested = true;
                }
            }
        }
        assert.ok(tested, `phase=${phase}`);
    }
});

test('私人节奏调参只影响下局单机计划，正式联机身份和冻结计划保持稳定', () => {
    const before = Plan.buildEntertainmentRacePlan(1, 400, 4);
    const values = { ...Cadence.ENTERTAINMENT_CADENCE_TUNING };
    try {
        Cadence.ENTERTAINMENT_CADENCE_TUNING.grade4Extras400 = 0;
        const local = Plan.buildEntertainmentRacePlan(1, 400, 4, undefined, true);
        assert.equal(local.stages.length, 3);
        assert.notEqual(local.identity, before.identity);
        assert.deepEqual(Plan.buildEntertainmentRacePlan(1, 400, 4), before);
        assert.equal(before.stages.length, 6);
    } finally { Object.assign(Cadence.ENTERTAINMENT_CADENCE_TUNING, values); }
});

test('垃圾并行门控开放主事件稳定段，预告及首三秒不投，浮标保留原门控', () => {
    const plan = Plan.buildEntertainmentRacePlan(1, 400, 4), host = create(1, 400, plan);
    const tested = new Set();
    for (let frame = 1; frame < 160 * 30; frame++) {
        host.update(1 / 30, frame / 30 * 2.5, true, 2.5);
        if (host.phaseId() === P.PREVIEW) assert.equal(host.canSpawnResidentObstacles(true), false);
        if (host.phaseId() === P.ACTIVE) {
            const stage = host.currentGradedStage();
            const age = stage.durationSeconds - host.secondsRemaining();
            assert.equal(host.canSpawnResidentObstacles(true), age >= 3);
            if (![E.WHIRLPOOL, E.TURTLE_BUS].includes(stage.event)) {
                assert.equal(host.canSpawnResidentObstacles(false), false);
                if (age >= 3) tested.add(stage.event);
            }
        }
    }
    assert.ok(tested.has(E.CANNON));
    assert.ok(tested.has(E.TIMED_BOMB));
});

test('背景投放避让运动危险带，双向推进对称且边界保持安全', () => {
    const overlap = Safety.litterRowOverlapsDanger;
    assert.equal(overlap(10, 10, 3, 6), true);
    assert.equal(overlap(19, 10, 3, 6), true);
    assert.equal(overlap(19.1, 10, 3, 6), false);
    assert.equal(overlap(1, 10, 3, -6), true);
    assert.equal(overlap(.9, 10, 3, -6), false);
});

test('其他档位的既有返场也允许背景垃圾，不必等返场结束', () => {
    const plan = Plan.buildEntertainmentRacePlan(1, 400, 3), host = create(1, 400, plan);
    let observed = false;
    for (let frame = 1; frame < 200 * 30; frame++) {
        host.update(1 / 30, frame / 30 * 2, true, 2);
        if (host.phaseId() === P.ACTIVE && host.snapshot().eventIndex >= plan.stages.length
            && host.secondsRemaining() < 8) {
            assert.equal(host.canSpawnResidentObstacles(true), true);
            assert.equal(host.canSpawnResidentObstacles(false), false);
            observed = true;
        }
    }
    assert.ok(observed);
});
