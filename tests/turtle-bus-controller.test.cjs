const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

const harness = createHarness();
class FakeNode {
    constructor(name) {
        this.name = name; this.children = []; this.parent = null; this.active = true;
        this.position = { x: 0, y: 0, z: 0 }; this.layer = 1;
    }
    setParent(parent) {
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = parent;
        if (parent) parent.children.push(this);
    }
    setPosition(x, y, z) { Object.assign(this.position, { x, y, z }); }
    setScale() {}
    setRotationFromEuler(x, y, z) { this.euler = { x, y, z }; }
    addComponent(ctor) { return new ctor(); }
    destroy() { this.setParent(null); }
}
class FakeRenderer { setMaterial() {} }
class FakeMaterial { initialize() {} setProperty() {} destroy() {} }
class FakeColor { constructor(r, g, b) { Object.assign(this, { r, g, b }); } }
Object.assign(harness.cc, {
    Node: FakeNode, MeshRenderer: FakeRenderer, Material: FakeMaterial, Color: FakeColor,
    primitives: { sphere: () => ({}), torus: () => ({}), box: () => ({}) },
    utils: { createMesh: () => ({ destroy() {} }) },
});
const { TurtleBusController } = harness.load(path.join(harness.root,
    'assets/scripts/core/TurtleBusController.ts'));
const { TURTLE_BUS_LEFT_HAND, TURTLE_BUS_RIGHT_HAND, TURTLE_BUS_RING_FORWARD_OFFSETS,
    turtleBusPositionAt, turtleBusRingWorldLateral } = harness.load(path.join(harness.root,
    'assets/scripts/core/TurtleBusRules.ts'));
const { StrokeType } = harness.load(path.join(harness.root,
    'assets/scripts/core/GameConstants.ts'));

function racer() {
    const motor = {
        isRacing: true, distance: 50, armStrokeSequence: 0, canBeginTurtleGrip: true,
        ability: { depth: 0 }, onArmStrokeStarted: null, tow: null,
        setTurtleTowTarget(speed, distance, lateral) { this.tow = { speed, distance, lateral }; },
        clearTurtleTow() { this.tow = null; },
        beginTurtleGrip() { this.gripped = true; },
    };
    return {
        motor, node: new FakeNode('Swimmer'), startPosition: { z: 0 },
        raceDirection: -1, currentSpeed: 2.5, movementHeading: 0,
        isCollisionActive: true, isEntertainmentInvulnerable: false,
        get distance() { return motor.distance; },
    };
}

function runUntilBoarded(onGripChanged) {
    const root = new FakeNode('World');
    const player = racer(), ai = racer();
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(root, course, player, [ai], 1,
        undefined, undefined, onGripChanged);
    for (let step = 0; step < 900 && bus.seats.ringOfSwimmer[0] < 0; step++) {
        player.motor.distance = 50 + step * 2.5 / 60;
        ai.motor.distance = 50 + step * 2.5 / 60;
        bus.update(1 / 60, true);
    }
    return { bus, root, player, ai };
}

test('折返时经过画面里的空圈，即使仍按着划水也会自动双手搭乘', () => {
    const player = racer();
    player.motor.canBeginTurtleGrip = false;
    player.motor.armStrokeSequence = 4;
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(new FakeNode('World'), course, player, [], 1);
    bus.update(3, true);
    const departure = bus.snapshotState();
    assert.equal(departure.direction, -1);
    assert.equal(bus.visualNode.euler.y, 180);
    const ring = 0;
    const visibleZ = turtleBusRingWorldLateral(departure.routeZ, departure.direction, ring);
    player.node.position.z = visibleZ;
    bus.update(3, true);
    for (let step = 0; step < 15 && bus.seats.ringOfSwimmer[0] < 0; step++) {
        const nextAge = bus.seats.age + 1 / 60;
        player.motor.distance = 50 + turtleBusPositionAt(nextAge, departure.startOffset)
            + TURTLE_BUS_RING_FORWARD_OFFSETS[ring] - 0.2;
        bus.update(1 / 60, true);
    }
    assert.equal(bus.seats.ringOfSwimmer[0], ring);
    assert.equal(bus.seats.hands[0], 3);
    assert.equal(player.motor.gripped, true);
    assert.ok(Math.abs(player.motor.tow.lateral - visibleZ) < 1e-6);
    player.motor.onArmStrokeStarted(StrokeType.LEFT, 4);
    assert.equal(bus.seats.hands[0], 3);
    player.motor.onArmStrokeStarted(StrokeType.LEFT, 5);
    assert.equal(bus.seats.hands[0], TURTLE_BUS_RIGHT_HAND);
    bus.dispose();
});

test('抓稳、左右手离车和重开仅按状态边缘通知乘客', () => {
    const changes = [];
    const { bus, player } = runUntilBoarded((seat, riding) => changes.push([seat, riding]));
    assert.deepEqual(changes.filter(([seat]) => seat === 0), [[0, true]]);
    player.motor.onArmStrokeStarted(StrokeType.LEFT, 1);
    assert.deepEqual(changes.filter(([seat]) => seat === 0), [[0, true]]);
    player.motor.onArmStrokeStarted(StrokeType.RIGHT, 2);
    bus.reset();
    assert.deepEqual(changes.filter(([seat]) => seat === 0), [[0, true], [0, false]]);
    bus.dispose();
});

test('灰模入口在 AI 调试标志确定后才装配班车，并保持联机隔离', () => {
    const source = fs.readFileSync(path.join(harness.root,
        'assets/scripts/core/GameManager.ts'), 'utf8');
    const modeSet = source.indexOf("this._aiDebugMode = launchMode === 'ai-debug'");
    const setupCall = source.indexOf('this.setupTurtleBusDebugRace();', modeSet);
    const gameStart = source.indexOf('this.startGame();', modeSet);
    assert.ok(modeSet >= 0 && modeSet < setupCall && setupCall < gameStart);
    const setupBody = source.slice(source.indexOf('private setupTurtleBusDebugRace(): void'),
        source.indexOf('private setupEntertainmentMode()'));
    assert.match(setupBody, /!this\._aiDebugMode\s*\|\|\s*this\._netSession/);
    assert.match(setupBody, /getRaceDifficultyConfig\(\)\.id !== 'turtle-bus-brawl'/);
    assert.match(setupBody, /new TurtleBusController\(/);
    assert.doesNotMatch(setupBody, /\bDEV\b/);
    assert.match(source, /this\._turtleBus\?\.update\(dt,\s*this\._state === GameState\.GLIDING\s*\|\| this\._state === GameState\.RACING\)/);
});

test('首次折返后的可达窗口确实浮起班车并播报发车', () => {
    const root = new FakeNode('World');
    const player = racer();
    const calls = [];
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(root, course, player, [], 1,
        direction => calls.push(`preview:${direction}`), () => calls.push('boarding'));
    for (let step = 0; step < 360 && calls.length < 2; step++) {
        player.motor.distance = 50 + step * 2.5 / 60;
        bus.update(1 / 60, true);
    }
    assert.deepEqual(calls, ['preview:-1', 'boarding']);
    assert.equal(bus.seats.phase, 'boarding');
    assert.equal(root.children[0].active, true);
    bus.dispose();
});

test('起跳后滑行阶段先浮起海龟，水下选手仍不能抓圈', () => {
    const root = new FakeNode('World');
    const player = racer();
    player.raceDirection = 1;
    player.motor.distance = 9;
    const calls = [];
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(root, course, player, [], 0,
        direction => calls.push(direction));
    player.isCollisionActive = false;
    bus.update(3, true);
    assert.equal(bus.seats.phase, 'preview');
    assert.equal(bus.seats.ringOfSwimmer[0], -1);
    player.isCollisionActive = true;
    bus.update(3, true);
    assert.equal(bus.seats.phase, 'boarding');
    assert.deepEqual(calls, [1]);
    assert.equal(root.children[0].active, true);
    bus.dispose();
});

test('从起跳滑行进入水面后，正常前进的玩家能被池端班车追上并自动抓圈', () => {
    const root = new FakeNode('World');
    const player = racer();
    player.raceDirection = 1;
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(root, course, player, [], 0);
    for (let step = 0; step < 720 && bus.seats.ringOfSwimmer[0] < 0; step++) {
        player.motor.distance = 3 + 2.5 * step / 60;
        player.isCollisionActive = step >= 44;
        bus.update(1 / 60, true);
    }
    assert.ok(bus.seats.ringOfSwimmer[0] >= 0);
    assert.ok(bus.seats.age < 9, '抓圈不应拖到即将到站');
    assert.ok(player.motor.tow?.speed > 0 && player.motor.tow.speed < player.currentSpeed);
    bus.dispose();
});

test('AI 只追有剩余收益的空圈，抢到后立刻停止追圈', () => {
    const root = new FakeNode('World');
    const player = racer(), ai = racer();
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(root, course, player, [ai], 1);
    bus.update(3, true);
    assert.ok(Number.isFinite(bus.targetZForAi(1)));
    bus.update(3, true);
    assert.equal(bus.seats.claim(1, 1, bus.seats.age, true, 0), true);
    assert.equal(bus.targetZForAi(1), null);
    bus.reset();
    assert.equal(bus.targetZForAi(1), null);
    bus.dispose();
});

test('抢圈目标按低频回调发送，重开时清掉旧目标', () => {
    const root = new FakeNode('World');
    const player = racer(), ai = racer();
    const updates = [];
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(root, course, player, [ai], 1,
        undefined, undefined, undefined,
        (seat, targetZ) => { if (seat === 1) updates.push(targetZ); });
    bus.update(3, true);
    bus.update(0.15, true);
    assert.ok(Number.isFinite(updates.at(-1)));
    bus.reset();
    assert.equal(updates.at(-1), null);
    bus.dispose();
});

test('开发灰模从反向池端出场，玩家实际接近后自动抓稳且只占一圈', () => {
    const { bus, root, player } = runUntilBoarded();
    const ring = bus.seats.ringOfSwimmer[0];
    assert.ok(ring >= 0 && ring < 4, '玩家没有获得可达空圈');
    assert.equal(bus.seats.occupants[ring], 0);
    assert.equal(bus.seats.hands[0], TURTLE_BUS_LEFT_HAND | TURTLE_BUS_RIGHT_HAND);
    assert.ok(player.motor.gripped);
    assert.ok(player.motor.tow?.speed > 0);
    assert.equal(root.children.length, 1);
    bus.dispose();
    assert.equal(root.children.length, 0);
    assert.equal(player.motor.onArmStrokeStarted, null);
});

test('正式班车至少两名选手有不同空圈可搭才出场，无可达窗口十八秒后请求替换', () => {
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const player = racer(), ai = racer();
    const ready = new TurtleBusController(new FakeNode('World'), course, player, [ai], 1,
        undefined, undefined, undefined, undefined, undefined, true,
        undefined, [3, 4], 42);
    ready.update(3, true);
    assert.equal(ready.seats.phase, 'preview');
    assert.equal(ready.snapshotState().tripId, 42);
    ready.dispose();

    player.motor.distance = 99;
    ai.motor.distance = 99;
    let unavailable = 0;
    const blocked = new TurtleBusController(new FakeNode('World'), course, player, [ai], 1,
        undefined, undefined, undefined, undefined, undefined, true,
        () => unavailable++, [3, 4], 43);
    blocked.update(18.1, true);
    blocked.update(2, true);
    assert.equal(unavailable, 1);
    assert.equal(blocked.isDone, true);
    blocked.dispose();
});

test('正式事件从赛程中段等待到折返后，仍能在替换期限内提供两处搭车机会', () => {
    const root = new FakeNode('World');
    const racers = [racer(), racer(), racer(), racer()];
    racers.forEach((swimmer, index) => { swimmer.node.position.z = [-3.6, -1.2, 1.2, 3.6][index]; });
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    let unavailable = 0;
    const bus = new TurtleBusController(root, course, racers[0], racers.slice(1), 0,
        undefined, undefined, undefined, undefined, undefined, true,
        () => unavailable++, [0, 1, 2, 3], 8);
    let launchedAt = -1;
    for (let step = 0; step < 56; step++) {
        const elapsed = step * .25;
        for (const swimmer of racers) {
            swimmer.motor.distance = 40 + elapsed * 2.5;
            swimmer.raceDirection = swimmer.distance < 50 ? 1 : -1;
        }
        bus.update(.25, true);
        if (bus.seats.phase === 'preview') { launchedAt = elapsed; break; }
    }
    assert.ok(launchedAt >= 0 && launchedAt < 14, `未在十四秒内发车：${launchedAt}`);
    assert.equal(unavailable, 0);
    bus.dispose();
});

test('正式发车跳过临近折返的多数人，选择少数方向的可搭窗口', () => {
    const racers = Array.from({ length: 5 }, racer);
    racers[0].raceDirection = 1;
    racers[1].raceDirection = 1;
    racers[0].motor.distance = 5;
    racers[1].motor.distance = 5;
    racers[0].node.position.z = -1.2;
    racers[1].node.position.z = 1.2;
    for (let index = 2; index < racers.length; index++) racers[index].motor.distance = 95;
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(new FakeNode('World'), course,
        racers[0], racers.slice(1), 123, undefined, undefined, undefined,
        undefined, undefined, true, undefined, [0, 1, 2, 3, 4], 42);
    bus.update(3, true);
    assert.equal(bus.seats.phase, 'preview');
    assert.equal(bus.snapshotState().direction, 1);
    assert.ok(bus.snapshotState().startOffset > 16);
    bus.dispose();
});

test('同一种子复现发车时刻，不同种子给出不同随机等待', () => {
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const launch = seed => {
        const player = racer(), ai = racer();
        player.node.position.z = -1.2;
        ai.node.position.z = 1.2;
        const bus = new TurtleBusController(new FakeNode('World'), course,
            player, [ai], seed, undefined, undefined, undefined,
            undefined, undefined, true, undefined, [0, 1], 42);
        let tick = -1;
        for (let index = 0; index < 72; index++) {
            player.motor.distance = 50 + index * .625;
            ai.motor.distance = player.motor.distance;
            bus.update(.25, true);
            if (bus.seats.phase === 'preview') { tick = index; break; }
        }
        const startOffset = bus.snapshotState()?.startOffset;
        bus.dispose();
        return { tick, startOffset };
    };
    assert.deepEqual(launch(1), launch(1));
    assert.ok(launch(1).tick >= 0);
    const timings = Array.from({ length: 12 }, (_, seed) => launch(seed).tick);
    assert.ok(timings.every(tick => tick >= 0));
    assert.ok(new Set(timings).size > 1);
});

test('海龟本体出生位置有选手时延后上浮，位置空开后再发车', () => {
    const racers = [racer(), racer(), racer()];
    racers.forEach((swimmer, index) => {
        swimmer.node.position.x = 37;
        swimmer.node.position.z = [-4, 0, 4][index];
    });
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(new FakeNode('World'), course,
        racers[0], racers.slice(1), 0,
        undefined, undefined, undefined, undefined, undefined, true,
        undefined, [0, 1, 2], 9);
    bus.update(3, true);
    assert.equal(bus.seats.phase, 'idle');
    racers.forEach(swimmer => { swimmer.node.position.x = 45; });
    bus.update(.25, true);
    assert.equal(bus.seats.phase, 'preview');
    bus.dispose();
});

test('客机按固定泳道还原占圈和双手，本地主人先松手不会被旧快照拉回', () => {
    const root = new FakeNode('World');
    const player = racer(), ai = racer();
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const handsSeen = [];
    const guest = new TurtleBusController(root, course, player, [ai], 1,
        undefined, undefined, undefined, undefined,
        (seat, hands) => handsSeen.push([seat, hands]), true,
        undefined, [4, 3], 7);
    guest.setAuthority(false);
    const state = { tripId: 7, phase: 'cruising', age: 6, direction: -1, routeZ: 0, startOffset: 16,
        occupants: [3, 4, -1, -1], hands: [3, 3, 0, 0] };
    guest.applyNetSnapshot(state);
    assert.equal(guest.seats.ringOfSwimmer[1], 0);
    assert.equal(guest.seats.ringOfSwimmer[0], 1);
    assert.equal(guest.seats.hands[0], 3);
    guest.updateReplica(.1);
    assert.ok(player.motor.tow);
    player.motor.onArmStrokeStarted(StrokeType.LEFT, 1);
    guest.applyNetSnapshot(state);
    assert.equal(guest.seats.hands[0], 2);
    player.motor.onArmStrokeStarted(StrokeType.RIGHT, 2);
    guest.applyNetSnapshot(state);
    assert.equal(guest.seats.hands[0], 0);
    assert.equal(player.motor.tow, null);
    guest.applyNetSnapshot({ ...state, occupants: [3, -1, -1, -1], hands: [3, 0, 0, 0] });
    assert.equal(guest.seats.ringOfSwimmer[0], -1);
    assert.ok(guest.seats.regrabUntil[0] > guest.seats.age);
    assert.equal(guest.seats.mustExitCatchArea[0], 1);
    guest.setAuthority(true);
    assert.equal(guest.seats.ringOfSwimmer[1], 0);
    assert.deepEqual(handsSeen.filter(([seat]) => seat === 0).map(([, hands]) => hands), [3, 2, 0]);
    guest.dispose();
});

test('客机断流先停止追圈，再松开牵引；旧快照不能把本地主人挂回去', () => {
    const player = racer(), ai = racer();
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const targets = [];
    const guest = new TurtleBusController(new FakeNode('World'), course, player, [ai], 1,
        undefined, undefined, undefined,
        (seat, target) => { if (seat === 1) targets.push(target); },
        undefined, true, undefined, [4, 3], 7);
    guest.setAuthority(false);
    const state = { tripId: 7, phase: 'cruising', age: 6, direction: -1, routeZ: 0, startOffset: 16,
        occupants: [-1, 4, -1, -1], hands: [0, 3, 0, 0] };
    guest.applyNetSnapshot(state);
    guest.updateReplica(.1);
    assert.ok(player.motor.tow);
    guest.updateReplica(.7);
    assert.equal(targets.at(-1), null);
    assert.ok(player.motor.tow);
    guest.updateReplica(.5);
    assert.equal(player.motor.tow, null);
    assert.equal(guest.seats.hands[0], 0);
    guest.applyNetSnapshot(state);
    guest.updateReplica(.1);
    assert.equal(player.motor.tow, null);
    guest.dispose();
});

test('真实两侧起划逐手离车，撞击直接清除牵引且原地不可马上重抓', () => {
    const { bus, player, ai } = runUntilBoarded();
    assert.ok(bus.seats.ringOfSwimmer[0] >= 0);
    player.motor.onArmStrokeStarted(StrokeType.LEFT, 1);
    assert.equal(bus.seats.hands[0], TURTLE_BUS_RIGHT_HAND);
    player.motor.onArmStrokeStarted(StrokeType.LEFT, 2);
    assert.equal(bus.seats.hands[0], TURTLE_BUS_RIGHT_HAND);
    player.motor.onArmStrokeStarted(StrokeType.RIGHT, 3);
    assert.equal(bus.seats.ringOfSwimmer[0], -1);
    assert.equal(player.motor.tow, null);
    assert.equal(bus.seats.mustExitCatchArea[0], 1);
    bus.dispose();

    const second = runUntilBoarded();
    second.bus.onResolvedImpact(second.player, 2, second.ai, 0.2);
    assert.equal(second.bus.seats.ringOfSwimmer[0], -1);
    assert.equal(second.player.motor.tow, null);
    assert.equal(second.bus.seats.mustExitCatchArea[0], 1);
    second.bus.dispose();
});

test('短暂位置校正不误甩客，持续够不到游泳圈才解挂', () => {
    const { bus, player } = runUntilBoarded();
    assert.ok(bus.seats.ringOfSwimmer[0] >= 0);
    player.motor.distance += 4;
    bus.update(.2, true);
    assert.ok(bus.seats.ringOfSwimmer[0] >= 0);
    bus.update(.16, true);
    assert.equal(bus.seats.ringOfSwimmer[0], -1);
    assert.equal(player.motor.tow, null);
    bus.dispose();
});

test('跨越到站阶段先放人，重复重开不堆积灰模根节点和起划监听', () => {
    const { bus, root, player } = runUntilBoarded();
    bus.update(20, true);
    assert.equal(bus.seats.ringOfSwimmer[0], -1);
    assert.equal(player.motor.tow, null);
    for (let i = 0; i < 10; i++) {
        bus.reset();
        assert.equal(root.children.length, 1);
        assert.equal(typeof player.motor.onArmStrokeStarted, 'function');
    }
    bus.dispose();
    assert.equal(root.children.length, 0);
    assert.equal(player.motor.onArmStrokeStarted, null);
});
