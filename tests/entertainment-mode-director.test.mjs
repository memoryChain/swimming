import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import DirectorModule from '../assets/scripts/core/EntertainmentModeDirector.ts';
import SnapshotModule from '../assets/scripts/net/NetRaceSnapshot.ts';

const {
    EntertainmentModeDirector,
    EntertainmentEventId,
    EntertainmentDirectorPhase,
    buildEntertainmentEventOrder,
    buildEntertainmentSpecialMask,
} = DirectorModule;
const { encodeRaceSnapshot, decodeRaceSnapshot } = SnapshotModule;

function advance(director, seconds, distance, canFinish = true) {
    let last = null;
    for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
        const transition = director.update(0.1, distance, canFinish);
        if (transition.previewEvent !== null || transition.activatedEvent !== null || transition.finishedEvent !== null) last = transition;
    }
    return last ?? { previewEvent: null, activatedEvent: null, finishedEvent: null };
}

test('娱乐模式每局抽取三到四个不重复事件，三类保底且场地事件不排最后', () => {
    const counts = new Set();
    for (let seed = 0; seed < 200; seed++) {
        const events = buildEntertainmentEventOrder(seed);
        counts.add(events.length);
        assert.ok(events.length === 3 || events.length === 4);
        assert.equal(new Set(events).size, events.length);
        assert.ok(events.filter(event => event === EntertainmentEventId.WHIRLPOOL || event === EntertainmentEventId.MINEFIELD).length >= 1);
        assert.ok(events.filter(event => event === EntertainmentEventId.STIMULANT || event === EntertainmentEventId.TIMED_BOMB).length >= 1);
        assert.ok(events.filter(event => event === EntertainmentEventId.SHARK || event === EntertainmentEventId.CANNON).length >= 1);
        assert.notEqual(events.at(-1), EntertainmentEventId.WHIRLPOOL);
        assert.notEqual(events.at(-1), EntertainmentEventId.MINEFIELD);
    }
    assert.deepEqual([...counts].sort(), [3, 4]);
});

test('400 米娱乐模式抽取五到六个不重复事件，并使用六个联机锚点槽位', () => {
    const counts = new Set();
    for (let seed = 0; seed < 200; seed++) {
        const events = buildEntertainmentEventOrder(seed, 400);
        counts.add(events.length);
        assert.ok(events.length === 5 || events.length === 6);
        assert.equal(new Set(events).size, events.length);
        assert.notEqual(events.at(-1), EntertainmentEventId.WHIRLPOOL);
        assert.notEqual(events.at(-1), EntertainmentEventId.MINEFIELD);
        const director = new EntertainmentModeDirector(seed, 400);
        assert.equal(director.previewDurationSeconds(), 6);
        assert.equal(director.snapshot().eventAnchorDistances.length, 6);
    }
    assert.deepEqual([...counts].sort(), [5, 6]);
});

test('400 米长局在冲刺截止线前可依次激活完整事件表', () => {
    let seed = 0;
    while (buildEntertainmentEventOrder(seed, 400).length !== 6) seed++;
    const director = new EntertainmentModeDirector(seed, 400);
    const activated = [];
    for (let elapsed = 0; elapsed < 150 && director.snapshot().phase !== EntertainmentDirectorPhase.COMPLETE; elapsed += 0.1) {
        const transition = director.update(0.1, 200, true);
        if (transition.activatedEvent !== null) activated.push(transition.activatedEvent);
    }
    assert.deepEqual(activated, director.selectedEvents());
    assert.equal(activated.length, 6);
});

test('导演先保留四秒正常游泳，再进行五至六秒搞笑广播预告', () => {
    const director = new EntertainmentModeDirector(18);
    const previewSeconds = director.selectedEvents().length === 4 ? 5 : 6;
    let transition = director.update(3.9, 8);
    assert.equal(transition.previewEvent, null);
    transition = director.update(0.11, 8);
    assert.equal(transition.previewEvent, director.selectedEvents()[0]);
    assert.equal(director.snapshot().phase, EntertainmentDirectorPhase.PREVIEW);
    transition = director.update(previewSeconds - 0.1, 20);
    assert.equal(transition.activatedEvent, null);
    transition = director.update(0.11, 20);
    assert.equal(transition.activatedEvent, director.selectedEvents()[0]);
    assert.equal(director.snapshot().anchorDistance, 20);
});

test('四事件局压缩节奏后仍可依次激活全部四个事件', () => {
    let seed = 0;
    while (buildEntertainmentEventOrder(seed).length !== 4) seed++;
    const director = new EntertainmentModeDirector(seed);
    const activated = [];
    for (let elapsed = 0; elapsed < 90 && director.snapshot().phase !== EntertainmentDirectorPhase.COMPLETE; elapsed += 0.1) {
        const transition = director.update(0.1, 80, true);
        if (transition.activatedEvent !== null) activated.push(transition.activatedEvent);
    }
    assert.deepEqual(activated, director.selectedEvents());
    assert.equal(activated.length, 4);
});

test('事件完成后不进入空档，同一帧直接开始下一事件预告', () => {
    const director = new EntertainmentModeDirector(18);
    const previewSeconds = director.selectedEvents().length === 4 ? 5 : 6;
    director.update(4.01, 10);
    let transition = director.update(previewSeconds + 0.01, 20);
    const firstEvent = director.selectedEvents()[0];
    const secondEvent = director.selectedEvents()[1];
    assert.equal(transition.activatedEvent, firstEvent);
    transition = director.update(director.snapshot().remainingSeconds + 0.01, 40, true);
    assert.equal(transition.finishedEvent, firstEvent);
    assert.equal(transition.previewEvent, secondEvent);
    assert.equal(director.snapshot().phase, EntertainmentDirectorPhase.PREVIEW);
    assert.equal(director.snapshot().remainingSeconds, previewSeconds);
});

test('定时炸弹未结算时导演不会切段，结算后继续轮换', () => {
    let seed = 0;
    while (buildEntertainmentEventOrder(seed)[0] !== EntertainmentEventId.TIMED_BOMB) seed++;
    const director = new EntertainmentModeDirector(seed);
    if (director.snapshot().phase !== EntertainmentDirectorPhase.PREVIEW) advance(director, 7, 20, true);
    advance(director, 7, 20, true);
    assert.equal(director.snapshot().phase, EntertainmentDirectorPhase.ACTIVE);
    advance(director, 12, 40, false);
    assert.equal(director.snapshot().phase, EntertainmentDirectorPhase.ACTIVE);
    advance(director, 1, 40, true);
    assert.equal(director.snapshot().phase, EntertainmentDirectorPhase.PREVIEW);
});

test('导演状态跟随比赛快照往返，支持访客恢复和房主迁移', () => {
    const director = new EntertainmentModeDirector(92);
    advance(director, 5, 12);
    advance(director, 7, 24);
    const expected = director.snapshot();
    const payload = encodeRaceSnapshot(0, [], null, null, null, null, null, null, expected);
    const decoded = decodeRaceSnapshot(payload);
    assert.deepEqual(decoded.entertainmentDirector, {
        ...expected,
        remainingSeconds: Math.round(expected.remainingSeconds * 1000) / 1000,
    });

    const guest = new EntertainmentModeDirector(999);
    const transition = guest.applySnapshot(decoded.entertainmentDirector);
    assert.equal(transition.activatedEvent, director.selectedEvents()[0]);
    assert.deepEqual(guest.selectedEvents(), director.selectedEvents());
    assert.deepEqual(guest.snapshot(), decoded.entertainmentDirector);
});

test('超级漩涡只在已入选漩涡事件时低概率规划，并随导演快照恢复', () => {
    let eligible = 0;
    let specials = 0;
    for (let seed = 0; seed < 500; seed++) {
        const events = buildEntertainmentEventOrder(seed, 400);
        const mask = buildEntertainmentSpecialMask(seed, events);
        if (events.indexOf(EntertainmentEventId.WHIRLPOOL) < 0) {
            assert.equal(mask, 0);
            continue;
        }
        eligible++;
        if (mask !== 0) specials++;
        assert.equal(mask & ~(1 << EntertainmentEventId.WHIRLPOOL), 0);
    }
    assert.ok(specials > eligible * 0.18 && specials < eligible * 0.32);

    let seed = 0;
    while (!new EntertainmentModeDirector(seed, 400).isSpecialEvent(EntertainmentEventId.WHIRLPOOL)) seed++;
    const host = new EntertainmentModeDirector(seed, 400);
    const payload = encodeRaceSnapshot(0, [], null, null, null, null, null, null, host.snapshot());
    const guest = new EntertainmentModeDirector(seed + 1, 400);
    guest.applySnapshot(decodeRaceSnapshot(payload).entertainmentDirector);
    assert.equal(guest.isSpecialEvent(EntertainmentEventId.WHIRLPOOL), true);
});

test('正式入口收拢为娱乐模式，六合一复用原控制器并使用压缩参数', () => {
    const balance = readFileSync(new URL('../assets/scripts/core/GameBalance.ts', import.meta.url), 'utf8');
    const prepare = readFileSync(new URL('../assets/scripts/ui/PrepareRaceFlow.ts', import.meta.url), 'utf8');
    const manager = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
    assert.match(balance, /id: 'entertainment-brawl', label: '娱乐模式'/);
    assert.match(balance, /id: 'stimulant-brawl'[\s\S]*?publicEntry: false/);
    assert.match(prepare, /PUBLIC_RACE_MODE_OPTIONS/);
    assert.match(manager, /buildEntertainmentStimulantSchedule/);
    assert.match(manager, /fuseSeconds: 8/);
    assert.match(manager, /getRaceDistance\(\) >= 400 \? \[1, 3, 5, 7, 9\] : \[1, 3, 5\]/);
    assert.match(manager, /triggerDistance: this\.entertainmentAnchorDistance\(EntertainmentEventId\.TIMED_BOMB\) \+ 12/);
    assert.match(manager, /isEntertainmentBrawlMode\(\) \? 5 : MINEFIELD_TUNING\.mineCount/);
    assert.match(manager, /getRaceDistance\(\) >= 400 \? \[0, 9\] : \[0\]/);
    assert.doesNotMatch(manager, /Unified(?:Shark|Cannon|Mine|Whirlpool|Stimulant)(?:Controller|Presentation|Prefab)/);
});
