const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

const harness = createHarness();
class FakeNode extends harness.Node {
    constructor(name) {
        super();
        this.name = name; this.children = []; this.parent = null; this.active = true;
        this.layer = 1;
    }
    setParent(parent) {
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = parent;
        if (parent) parent.children.push(this);
    }
    setRotationFromEuler(x, y, z) { super.setRotationFromEuler(x,y,z); this.euler = { x, y, z }; }
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
    turtleBusPositionAt, turtleBusRingWorldLateral, turtleBusUnloadingAge, TURTLE_BUS_CONFIG } = harness.load(path.join(harness.root,
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
        captureTurtleGrip(distance, lateral) { this.distance = distance; this.capturedLateral = lateral; },
    };
    return {
        motor, node: new FakeNode('Swimmer'), startPosition: { z: 0 },
        raceDirection: -1, currentSpeed: 2.5, movementHeading: 0,
        isCollisionActive: true, isEntertainmentInvulnerable: false,
        applyCollisionPush(x,z) { this.node.position.z += z; },
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
        const t = step / 60, offset = t < 4.8 ? 38 + t * 2.5 : 50 + Math.max(0, t - 6) * 2.5;
        player.motor.distance = offset; ai.motor.distance = offset;
        player.raceDirection = ai.raceDirection = offset < 50 ? 1 : -1;
        player.node.position.x = ai.node.position.x = offset < 50 ? offset : 100 - offset;
        const target = bus.targetZForAi(0);
        if (target !== null) player.node.position.z += Math.max(-.65/60, Math.min(.65/60, target-player.node.position.z));
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
    bus.startTrip(-1, 0, 7);
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
            + TURTLE_BUS_RING_FORWARD_OFFSETS[ring] - 2.2 - 0.1;
        bus.update(1 / 60, true);
    }
    assert.equal(bus.seats.ringOfSwimmer[0], ring);
    assert.equal(bus.seats.hands[0], 3);
    assert.equal(player.motor.gripped, true);
    assert.ok(Math.abs(player.motor.tow.lateral - visibleZ) < 1e-6);
    bus.seats.age = bus.seats.gripProtectedUntil[0];
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
    bus.seats.age = bus.seats.gripProtectedUntil[0];
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

test('接近折返池端时提前浮起班车并播报发车', () => {
    const root = new FakeNode('World');
    const player = racer();
    const calls = [];
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(root, course, player, [], 1,
        direction => calls.push(`preview:${direction}`), () => calls.push('boarding'));
    for (let step = 0; step < 360 && calls.length < 2; step++) {
        player.motor.distance = 40 + step * 2.5 / 60;
        player.raceDirection = player.distance < 50 ? 1 : -1;
        bus.update(1 / 60, true);
    }
    assert.deepEqual(calls, ['preview:-1', 'boarding']);
    assert.equal(bus.seats.phase, 'boarding');
    assert.equal(root.children[0].active, true);
    bus.dispose();
});

test('水下滑行不凭空生成不可搭班次，已预告的车仍拒绝水下抓圈', () => {
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
    assert.equal(bus.seats.phase, 'idle');
    bus.startTrip(1, 0, 7);
    assert.equal(bus.seats.ringOfSwimmer[0], -1);
    player.isCollisionActive = true;
    bus.update(3, true);
    assert.equal(bus.seats.phase, 'boarding');
    assert.deepEqual(calls, [1]);
    assert.equal(root.children[0].active, true);
    bus.dispose();
});

test('从起跳开始游完首段后，池端预告能让正常前进的玩家在折返后抓圈', () => {
    const player = racer();
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(new FakeNode('World'), course, player, [], 0);
    let entry = null;
    for (let step = 0; step < 2100 && bus.seats.ringOfSwimmer[0] < 0; step++) {
        const t = step / 60;
        player.motor.distance = t < 18.8 ? 3 + 2.5 * t : 50 + Math.max(0, t - 20) * 2.5;
        player.raceDirection = player.distance < 50 ? 1 : -1;
        player.node.position.x = player.distance < 50 ? player.distance : 100 - player.distance;
        player.isCollisionActive = step >= 44 && !(t >= 18.8 && t < 20);
        const target = bus.targetZForAi(0);
        if (target !== null) player.node.position.z += Math.max(-.65/60, Math.min(.65/60, target-player.node.position.z));
        bus.update(1 / 60, true);
        if (!entry) entry = bus.snapshotState();
    }
    assert.equal(entry.direction, -1);
    assert.equal(entry.startOffset, 7);
    assert.ok(bus.seats.ringOfSwimmer[0] >= 0);
    assert.ok(bus.seats.age < 12, '折返后的上车机会不能拖到到站');
    assert.ok(player.motor.tow?.speed > 0 && player.motor.tow.speed < player.currentSpeed);
    bus.dispose();
});

test('AI 只追有剩余收益的空圈，抢到后立刻停止追圈', () => {
    const root = new FakeNode('World');
    const player = racer(), ai = racer();
    player.motor.distance = ai.motor.distance = 42;
    player.raceDirection = ai.raceDirection = 1;
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
    player.motor.distance = ai.motor.distance = 42;
    player.raceDirection = ai.raceDirection = 1;
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

test('综合班车预检不显形不牵引，确认航次后只启动一次且按实际时长结束', () => {
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const player = racer(), ai = racer();
    player.motor.distance = ai.motor.distance = 42;
    player.raceDirection = ai.raceDirection = 1;
    let previews = 0;
    const bus = new TurtleBusController(new FakeNode('World'), course, player, [ai], 1,
        () => previews++, undefined, undefined, undefined, undefined, true, undefined, [3, 4], 7);
    const duration = bus.prepareLaunch();
    assert.ok(duration > 20 && duration < 30);
    assert.equal(bus.seats.phase, 'idle');
    bus.update(5, true);
    assert.equal(bus.seats.phase, 'idle');
    assert.equal(previews, 0);
    assert.equal(player.motor.tow, null);
    bus.activatePreparedLaunch();
    bus.activatePreparedLaunch();
    assert.equal(previews, 1);
    assert.equal(bus.seats.phase, 'preview');
    assert.equal(bus.snapshotState().tripId, 7);
    for (let frame = 0; frame < Math.ceil(duration * 30) + 1; frame++) bus.update(1 / 30, true);
    assert.equal(bus.isDone, true);
    bus.dispose();
});

test('综合导演与真实班车预检串接：有窗口发车、无窗口替补，后段仍能完成', () => {
    const { EntertainmentModeDirector, EntertainmentEventId: E } = harness.load(path.join(harness.root,
        'assets/scripts/core/EntertainmentModeDirector.ts'));
    const { buildEntertainmentRacePlan } = harness.load(path.join(harness.root,
        'assets/scripts/core/EntertainmentRacePlan.ts'));
    let departures = 0;
    for (const speed of [2, 2.5, 3.5]) for (const eligible of [true, false]) {
        const plan = buildEntertainmentRacePlan(5, 200, 5);
        const player = racer(), ai = racer();
        player.isCollisionActive = ai.isCollisionActive = eligible;
        player.currentSpeed = ai.currentSpeed = speed;
        const bus = new TurtleBusController(new FakeNode('World'),
            { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 },
            player, [ai], 5, () => departures++, undefined, undefined, undefined, undefined, true);
        const director = new EntertainmentModeDirector(5, 200, true, undefined, undefined, undefined,
            plan, () => bus.prepareLaunch());
        const completed = [];
        let launched = false;
        for (let frame = 1; frame / 30 * speed < 200; frame++) {
            const progress = frame / 30 * speed;
            player.motor.distance = ai.motor.distance = progress;
            player.raceDirection = ai.raceDirection = Math.floor(progress / 50) % 2 === 0 ? 1 : -1;
            if (launched) bus.update(1 / 30, true);
            const result = director.update(1 / 30, progress,
                director.currentEvent() !== E.TURTLE_BUS || bus.isDone, speed);
            if (result.activatedEvent === E.TURTLE_BUS) { bus.activatePreparedLaunch(); launched = true; }
            if (result.finishedEvent !== null) completed.push(result.finishedEvent);
        }
        assert.ok(completed.includes(E.SHARK), `${speed}:${eligible}:${completed}`);
        assert.ok(completed.includes(E.TURTLE_BUS) || completed.includes(E.WHIRLPOOL));
        if (!eligible) assert.equal(launched, false);
        bus.dispose();
    }
    assert.ok(departures > 0);
});

test('正式班车至少两名选手有不同空圈可搭才出场，无可达窗口十八秒后请求替换', () => {
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const player = racer(), ai = racer();
    player.motor.distance = ai.motor.distance = 42;
    player.raceDirection = ai.raceDirection = 1;
    const ready = new TurtleBusController(new FakeNode('World'), course, player, [ai], 1,
        undefined, undefined, undefined, undefined, undefined, true,
        undefined, [3, 4], 42);
    ready.update(3, true);
    assert.equal(ready.seats.phase, 'preview');
    assert.equal(ready.snapshotState().tripId, 42);
    ready.dispose();

    player.motor.distance = 199;
    player.raceDirection = ai.raceDirection = -1;
    ai.motor.distance = 199;
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

test('正式发车可迎接将到池端的选手，人数多数不能把出生点推向池中段', () => {
    const racers = Array.from({ length: 5 }, racer);
    racers[0].raceDirection = 1;
    racers[1].raceDirection = 1;
    racers[0].motor.distance = 5;
    racers[1].motor.distance = 5;
    racers[0].node.position.z = -1.2;
    racers[1].node.position.z = 1.2;
    for (let index = 2; index < racers.length; index++) racers[index].motor.distance = 92;
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(new FakeNode('World'), course,
        racers[0], racers.slice(1), 123, undefined, undefined, undefined,
        undefined, undefined, true, undefined, [0, 1, 2, 3, 4], 42);
    bus.update(3, true);
    assert.equal(bus.seats.phase, 'preview');
    assert.equal(bus.snapshotState().direction, 1);
    assert.equal(bus.snapshotState().startOffset, 7);
    bus.dispose();
});

test('同一种子复现池端发车，不同种子保留短随机等待且不绕过可搭窗口', () => {
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
            player.motor.distance = 35 + index * .625;
            ai.motor.distance = player.motor.distance;
            player.raceDirection = ai.raceDirection = player.distance < 50 ? 1 : -1;
            bus.update(.25, true);
            if (bus.seats.phase === 'preview') { tick = index; break; }
        }
        const startOffset = bus.snapshotState()?.startOffset;
        const delay = bus.launchDelaySeconds;
        bus.dispose();
        return { tick, startOffset, delay };
    };
    assert.deepEqual(launch(1), launch(1));
    assert.ok(launch(1).tick >= 0);
    const timings = Array.from({ length: 12 }, (_, seed) => launch(seed));
    assert.ok(timings.every(t => t.tick >= 0 && (t.tick + 1) * .25 >= t.delay && t.startOffset === 7));
    assert.ok(new Set(timings.map(t=>t.delay)).size > 1);
});

test('两端与不同世界池长的正式出生点都留在池端，圈和最长角色不越墙',()=>{
    for(const scale of [.7,1,1.5])for(const incoming of [1,-1]){
        const player=racer();player.raceDirection=incoming;
        const course={courseLength:50,direction:1,startX:0,finishX:50*scale,waterY:0};
        const bus=new TurtleBusController(new FakeNode('World'),course,player,[],1,
            undefined,undefined,undefined,undefined,undefined,true);
        for(let offset=20;offset<49&&!bus.snapshotState();offset+=.1){
            player.motor.distance=(incoming===1?0:50)+offset;
            bus.tryStart();
        }
        const state=bus.snapshotState();assert.ok(state);
        assert.equal(state.direction,-incoming);
        const inset=state.startOffset*scale;
        assert.ok(inset>=7-1e-6&&inset<7+.1*scale+1e-6);
        assert.ok(inset-3.5-2.39>.65,'最后一排最长身体保留池壁空间');
        const origin=state.direction===1?0:course.finishX;
        assert.ok(Math.abs(bus.visualNode.position.x-origin-state.direction*inset)<1e-6);
        bus.dispose();
    }
});

test('上浮中央的选手按稳定泳道同向挤开，访客仅推动自己的角色',()=>{
    const course={courseLength:50,direction:1,startX:0,finishX:50,waterY:0};
    const hostPlayer=racer(),remote=racer(),owner=racer(),guestRemote=racer();
    const host=new TurtleBusController(new FakeNode('World'),course,hostPlayer,[remote],1,
        undefined,undefined,undefined,undefined,undefined,true,undefined,[2,4]);
    const guest=new TurtleBusController(new FakeNode('World'),course,owner,[guestRemote],1,
        undefined,undefined,undefined,undefined,undefined,true,undefined,[4,2]);
    host.startTrip(1,0,7);host.update(.8,true);
    guest.setAuthority(false);guest.applyNetSnapshot(host.snapshotState());
    remote.node.setPosition(7,0,0);owner.node.setPosition(7,0,0);guestRemote.node.setPosition(7,0,0);
    host.update(.1,true);guest.updateReplica(.1);
    assert.ok(remote.node.position.z<0);
    assert.equal(owner.node.position.z,remote.node.position.z);
    assert.equal(guestRemote.node.position.z,0);
    host.dispose();guest.dispose();
});

test('池端本体可在附近有人时逐渐挤开；水下未接触时和泳圈区域不推人', () => {
    const racers = [racer(), racer(), racer()];
    racers.forEach((swimmer, index) => {
        swimmer.motor.distance = 42; swimmer.raceDirection = 1;
        swimmer.node.position.x = 43; swimmer.node.position.z = [-4, 0, 4][index];
    });
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
    const bus = new TurtleBusController(new FakeNode('World'), course,
        racers[0], racers.slice(1), 0, undefined, undefined, undefined, undefined, undefined, true,
        undefined, [0, 1, 2], 9);
    bus.update(3, true);
    assert.equal(bus.seats.phase, 'preview');
    assert.equal(bus.snapshotState().startOffset, 7);
    const center = bus.snapshotState().routeZ;
    const swimmer = racers.find(r => r.node.position.z === center);
    const z = swimmer.node.position.z;
    bus.update(.25, true);
    assert.equal(swimmer.node.position.z, z, '龟身仍在水下时不推挤');
    for (let i = 0; i < 30; i++) bus.update(.05, true);
    assert.ok(Math.abs(swimmer.node.position.z - z) > .3, '上浮时本体确实让附近人侧移');
    assert.ok(Math.abs(swimmer.node.position.z - z) < 1.2, '渐进推开而不是瞬移');
    assert.equal(bus.seats.ringOfSwimmer[0], -1);
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
    player.motor.distance = 50 + turtleBusPositionAt(6.1, 16) + TURTLE_BUS_RING_FORWARD_OFFSETS[1] - 2.2;
    player.node.position.z = turtleBusRingWorldLateral(0, -1, 1);
    guest.updateReplica(.1);
    assert.ok(player.motor.tow);
    player.motor.distance += 1.4;
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

test('访客受击立即松圈，恢复后迟到占圈包不复挂，房主确认离圈后才可重新搭乘', () => {
    for (const beforeSnapshot of [false, true]) {
        const player = racer();
        const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 };
        const guest = new TurtleBusController(new FakeNode('World'), course, player, [], 1);
        guest.setAuthority(false);
        const state = { tripId: 1, phase: 'cruising', age: 6, direction: -1, routeZ: 0, startOffset: 16,
            occupants: [0, -1, -1, -1], hands: [3, 0, 0, 0] };
        if (!beforeSnapshot) guest.applyNetSnapshot(state);
        player.isCollisionActive = false;
        player.motor.tow = { speed: 1 };
        if (beforeSnapshot) guest.applyNetSnapshot(state);
        guest.updateReplica(1 / 60);
        assert.equal(guest.seats.hands[0], 0);
        assert.equal(player.motor.tow, null);
        player.isCollisionActive = true;
        guest.applyNetSnapshot({ ...state, age: 6.1 });
        assert.equal(guest.seats.hands[0], 0);
        guest.setAuthority(true);
        assert.equal(guest.seats.ringOfSwimmer[0], -1);
        guest.setAuthority(false);
        guest.applyNetSnapshot({ ...state, age: 6.2, occupants: [-1, -1, -1, -1], hands: [0, 0, 0, 0] });
        guest.applyNetSnapshot({ ...state, age: 8 });
        assert.equal(guest.seats.hands[0], 3);
        guest.dispose();
    }
});

test('客机在到站包延迟时也先松手再下潜，旧载客快照不会挂回本地主人',()=>{
    const player=racer(),course={courseLength:50,direction:1,startX:0,finishX:50,waterY:0};
    const guest=new TurtleBusController(new FakeNode('World'),course,player,[],1);
    guest.setAuthority(false);
    const age=turtleBusUnloadingAge(16)+TURTLE_BUS_CONFIG.unloadSeconds-.1;
    const state={tripId:1,phase:'unloading',age,direction:-1,routeZ:0,startOffset:16,
        occupants:[0,-1,-1,-1],hands:[3,0,0,0]};
    guest.applyNetSnapshot(state);
    player.motor.tow={speed:1};
    guest.updateReplica(.2);
    assert.equal(guest.seats.phase,'submerging');
    assert.equal(guest.seats.hands[0],0);
    assert.equal(player.motor.tow,null);
    guest.applyNetSnapshot(state);
    guest.updateReplica(.01);
    assert.equal(guest.seats.hands[0],0);
    assert.equal(player.motor.tow,null);
    guest.dispose();
});

test('真实两侧起划逐手离车，撞击直接清除牵引且原地不可马上重抓', () => {
    const { bus, player, ai } = runUntilBoarded();
    assert.ok(bus.seats.ringOfSwimmer[0] >= 0);
    bus.seats.age = bus.seats.gripProtectedUntil[0];
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

test('上车保护在房主与访客一致，重复快照和房主切换不延长保护',()=>{
    const {bus:host,player}=runUntilBoarded();
    const other=racer(),course={courseLength:50,direction:1,startX:0,finishX:50,waterY:0};
    const guest=new TurtleBusController(new FakeNode('World'),course,other,[],1);
    guest.setAuthority(false);guest.applyNetSnapshot(host.snapshotState());
    const until=host.seats.gripProtectedUntil[0];
    assert.equal(guest.seats.gripProtectedUntil[0],until);
    for(const [side,seq] of [[StrokeType.LEFT,1],[StrokeType.RIGHT,2]]){
        player.motor.onArmStrokeStarted(side,seq);other.motor.onArmStrokeStarted(side,seq);
    }
    assert.equal(host.seats.hands[0],3);assert.equal(guest.seats.hands[0],3);
    const later={...host.snapshotState(),age:host.seats.age+.5};
    guest.applyNetSnapshot(later);guest.applyNetSnapshot(later);guest.setAuthority(true);
    assert.equal(guest.seats.gripProtectedUntil[0],until);
    host.seats.age=guest.seats.age=until+.01;
    player.motor.onArmStrokeStarted(StrokeType.LEFT,3);other.motor.onArmStrokeStarted(StrokeType.LEFT,3);
    assert.equal(host.seats.hands[0],2);assert.equal(guest.seats.hands[0],2);
    host.dispose();guest.dispose();
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

test('非等比池长下，正反向握点、角色后置与可见圈使用同一世界坐标',()=>{
    for(const direction of [1,-1])for(const scale of [.65,1,1.7]){
        const player=racer();player.raceDirection=direction;
        let gripTarget;
        player.cartoonRig={turtleBusRootOffset:2.1,setTurtleBusRingTarget(x,y,z){gripTarget={x,y,z};}};
        const course={courseLength:50,direction:1,startX:10,finishX:10+50*scale,waterY:.055,poolWidth:20};
        const bus=new TurtleBusController(new FakeNode('World'),course,player,[],1);
        bus.startTrip(direction,0,16);bus.update(3,true);
        const base=direction===1?0:50,ring=1;
        for(let i=0;i<18;i++){
            const offset=turtleBusPositionAt(bus.seats.age+1/60,16);
            player.motor.distance=base+offset+(TURTLE_BUS_RING_FORWARD_OFFSETS[ring]-2.1)/scale;
            player.node.position.z=turtleBusRingWorldLateral(0,direction,ring);
            player.node.position.x=(direction===1?course.startX:course.finishX)+direction*(player.motor.distance-base)*scale;
            bus.update(1/60,true);
        }
        assert.equal(bus.seats.ringOfSwimmer[0],ring);
        const target=new harness.cc.Vec3();bus.visual.ringWorld(ring,target);
        assert.ok(Math.abs(gripTarget.x-target.x)<1e-6);
        assert.ok(Math.abs(Math.abs(gripTarget.x-player.node.position.x)-2.1)<1e-6);
        assert.ok(Math.abs(player.motor.tow.distance-player.distance)<1e-5);
        bus.dispose();
    }
});

test('靠近立即抓稳，保护结束后单侧起划当步通知单手姿态',()=>{
    const changes=[],player=racer(),bus=new TurtleBusController(new FakeNode('World'),
        {courseLength:50,direction:1,startX:0,finishX:50,waterY:0},player,[],1,
        undefined,undefined,undefined,undefined,(_seat,hands)=>changes.push(hands));
    bus.startTrip(-1,0,16);bus.update(3,true);
    const sample=()=>{player.motor.distance=50+turtleBusPositionAt(bus.seats.age+1/60,16)+TURTLE_BUS_RING_FORWARD_OFFSETS[1]-2.2;
        player.node.position.z=turtleBusRingWorldLateral(0,-1,1);bus.update(1/60,true);};
    sample();
    assert.equal(bus.seats.hands[0],3);
    bus.seats.age = bus.seats.gripProtectedUntil[0];
    player.motor.onArmStrokeStarted(StrokeType.LEFT,1);
    for(let i=0;i<5;i++)sample();
    assert.equal(bus.seats.hands[0],2);
    player.motor.onArmStrokeStarted(StrokeType.RIGHT,2);
    assert.equal(changes.at(-1),0);
    bus.dispose();
});

test('两端与不同池长下，空圈侧边和前后靠近均当步吸附，远处不会隔空上车',()=>{
    for(const direction of [1,-1])for(const scale of [.65,1,1.7])for(const [gap,side] of [[.55,.8],[-1,.75],[.5,-.8]]){
        const player=racer();player.raceDirection=direction;
        const course={courseLength:50,direction:1,startX:0,finishX:50*scale,waterY:0};
        const bus=new TurtleBusController(new FakeNode('World'),course,player,[],1);
        const target=16+(TURTLE_BUS_RING_FORWARD_OFFSETS[1]-2.2)/scale;
        const base=direction===1?0:50,z=turtleBusRingWorldLateral(0,direction,1);
        player.motor.distance=base+target-gap/scale;
        player.node.setPosition((direction===1?0:50*scale)+direction*(target-gap/scale)*scale,0,z+side);
        bus.startTrip(direction,0,16);bus.update(3,true);
        assert.equal(bus.seats.ringOfSwimmer[0],1,`方向${direction}，比例${scale}，位置${gap}/${side}`);
        assert.ok(Math.abs(player.motor.distance-base-target)<1e-6);
        assert.ok(Math.abs(player.motor.capturedLateral-z)<1e-6);
        bus.dispose();
    }
    const player=racer();player.motor.distance=50+16-3.5-2.2-2;
    player.node.position.z=.95;
    const bus=new TurtleBusController(new FakeNode('World'),{courseLength:50,direction:1,startX:0,finishX:50,waterY:0},player,[],1);
    bus.startTrip(-1,0,16);bus.update(3,true);
    assert.equal(bus.seats.ringOfSwimmer[0],-1,'两米外不能隔空吸附');bus.dispose();
});

test('预告空车取消保持原地潜走，客机接续取消状态不会跳到目的池端',()=>{
    const player=racer(),course={courseLength:50,direction:1,startX:0,finishX:50,waterY:0};
    const bus=new TurtleBusController(new FakeNode('World'),course,player,[],1);
    bus.startTrip(-1,0,16);bus.update(.4,true);
    const x=bus.visualNode.position.x;
    bus.stopNewBoarding();bus.update(.2,true);
    assert.equal(bus.visualNode.position.x,x);
    assert.equal(bus.seats.phase,'submerging');
    const guest=new TurtleBusController(new FakeNode('World'),course,racer(),[],1);guest.setAuthority(false);
    guest.applyNetSnapshot(bus.snapshotState());guest.updateReplica(.1);
    assert.equal(guest.visualNode.position.x,x);
    bus.update(1.3,true);guest.updateReplica(1.3);
    assert.equal(bus.isDone,true);assert.equal(guest.isDone,true);
    bus.dispose();guest.dispose();
});

test('海龟软避让有速度上限、不附加击倒，圈后握点不被推出',()=>{
    const player=racer(),course={courseLength:50,direction:1,startX:0,finishX:50,waterY:0,poolWidth:20};
    player.raceDirection=1;
    const bus=new TurtleBusController(new FakeNode('World'),course,player,[],1);
    bus.startTrip(1,0,16);bus.update(3,true);
    player.node.position.x=bus.visualNode.position.x;player.node.position.z=0;
    bus.update(.02,true);
    assert.ok(Math.abs(player.node.position.z)>.001&&Math.abs(player.node.position.z)<=.01601);
    assert.equal(bus.seats.ringOfSwimmer[0],-1);
    bus.dispose();
});

test('四个泳圈前侧均不推人；本体浮起后泳圈才依次上浮',()=>{
    const player=racer(),course={courseLength:50,direction:1,startX:0,finishX:50,waterY:0};
    const bus=new TurtleBusController(new FakeNode('World'),course,player,[],1);
    for(const direction of [1,-1]){
        player.raceDirection=direction;bus.direction=direction;bus.routeZ=0;bus.seats.phase='cruising';bus.seats.age=4;
        bus.visual.update(4,direction,0,16);
        for(let i=0;i<4;i++){
            const ring=bus.visual.rings[i].getWorldPosition(new harness.Vec3());
            player.node.setPosition(ring.x+direction*.15,0,ring.z);
            bus.applySoftAvoidance(.1,false);
            assert.equal(player.node.position.z,ring.z,'泳圈前侧不侧推');
        }
    }
    bus.visual.update(1.2,1,0,16);
    assert.ok(Math.abs(bus.visual.body.position.y)<1e-6,'本体已经浮起');
    assert.ok(bus.visual.rings.every(r=>r.position.y<-.7),'泳圈仍在水下等待');
    bus.visual.update(1.5,1,0,16);
    assert.ok(bus.visual.rings[0].position.y>bus.visual.rings[3].position.y+.15,'圈依次跟上');
    bus.visual.update(2.3,1,0,16);
    assert.ok(bus.visual.rings.every(r=>r.position.y>-.03),'开放抓取前四圈均已浮起');
    bus.dispose();
});

test('真实划水、翻滚蹬墙与水下滑行后，选手仍能抢到池端发出的空圈',()=>{
    const {createAiHarness}=require('./helpers/ai-race-harness.cjs');
    const h=createAiHarness();
    Object.assign(h.cc,{Node:FakeNode,MeshRenderer:FakeRenderer,Material:FakeMaterial,Color:FakeColor,
        primitives:harness.cc.primitives,utils:harness.cc.utils});
    const RealBus=h.load('core/TurtleBusController').TurtleBusController;
    for(const distance of [35,85])for(const id of ['cartonSwimmer6','cartonSwimmer9','cartonSwimmer15']){
        const actor=h.create(id,1,1,distance,0);
        actor.body.cartoonRig.turtleBusRootOffset=2.2;
        const bus=new RealBus(new FakeNode('World'),actor.body.courseLayout,actor.body,[],13,
            undefined,undefined,(_seat,riding)=>actor.ai.setTurtleBusRiding(riding),
            (_seat,z)=>actor.ai.setTurtleBusTargetZ(z));
        let entry=null,turned=false; const trace=[];
        for(let i=0;i<2400&&bus.seats.ringOfSwimmer[0]<0;i++){
            actor.step(1/60);bus.update(1/60,true);
            turned ||= actor.body.isFlipTurning;
            entry ||= bus.snapshotState();
            if(i%30===0&&entry&&bus.seats.age<13)trace.push([+bus.seats.age.toFixed(1),+actor.body.distance.toFixed(1),+actor.body.currentSpeed.toFixed(1),+actor.body.node.position.z.toFixed(1),actor.body.isCollisionActive,bus.targetZForAi(0)]);
        }
        assert.ok(turned,'使用真实转身阶段');
        assert.ok(entry,`${id}/${distance} 应发车`);
        assert.ok(bus.seats.ringOfSwimmer[0]>=0,`${id}/${distance} 应在真实出水后搭乘，车龄 ${bus.seats.age}，轨迹 ${JSON.stringify(trace)}`);
        bus.dispose();
    }
});

test('独立四鳍保留肩根，绳子端点在上浮、巡航和下潜都接到圈耳',()=>{
    const player=racer(),course={courseLength:50,direction:1,startX:0,finishX:50,waterY:0};
    const bus=new TurtleBusController(new FakeNode('World'),course,player,[],1);
    const {Vec3}=harness.cc;
    for(const direction of [1,-1])for(const age of [.3,1.3,4,10,17.3,18.3]){
        bus.visual.update(age,direction,0,16);
        for(let i=0;i<4;i++){
            const rope=bus.visual.ropes[i],ring=bus.visual.rings[i];
            const end=Vec3.transformMat4(new Vec3(),new Vec3(1,0,0),rope.worldMatrix);
            const eye=Vec3.transformMat4(new Vec3(),new Vec3(.71,.15,0),ring.worldMatrix);
            assert.ok(Vec3.distance(end,eye)<1e-5,'绳端与圈前绳耳保持一致');
        }
    }
    bus.dispose();
});

test('真实马达在30/60/120Hz抓稳后持续跟圈，不靠逐帧改写人物根位置',()=>{
    const {load}=require('../scripts/analyze-stroke-efficiency.cjs');
    const {SwimmerMotor}=load('swimmer/SwimmerMotor');
    for(const hz of [30,60,120]){
        const motor=new SwimmerMotor();motor.startRace(16+TURTLE_BUS_RING_FORWARD_OFFSETS[1]-2.1-.5,2);
        motor.setLateralOffset(-.35);
        const player={motor,node:new FakeNode('Player'),startPosition:{z:0},raceDirection:1,
            isCollisionActive:true,isEntertainmentInvulnerable:false,
            cartoonRig:{turtleBusRootOffset:2.1,setTurtleBusRingTarget(){}},
            get distance(){return motor.distance;},get currentSpeed(){return motor.currentSpeed;},
            get movementHeading(){return motor.heading;},applyCollisionPush(_x,z){motor.setLateralOffset(motor.lateralOffset+z);}};
        const course={courseLength:50,direction:1,startX:0,finishX:50,waterY:.055,poolWidth:20};
        const bus=new TurtleBusController(new FakeNode('World'),course,player,[],1);
        player.node.setPosition(motor.distance,0,motor.lateralOffset);
        bus.startTrip(1,0,16);bus.update(3,true);
        assert.equal(bus.seats.hands[0],3,'偏离握点0.5米、横向0.6米也在首步吸附');
        assert.ok(Math.abs(motor.lateralOffset+.95)<1e-6,'吸附后横向贴合握点');
        let boarded=false,worst=0;
        for(let frame=0;frame<5*hz;frame++){
            motor.update(1/hz,{isAI:false});player.node.setPosition(motor.distance,0,motor.lateralOffset);
            bus.update(1/hz,true);
            if(bus.seats.ringOfSwimmer[0]>=0)boarded=true;
            if(boarded){assert.equal(bus.seats.ringOfSwimmer[0],1,'未起划或受撞时持续搭乘');
                const ideal=turtleBusPositionAt(bus.seats.age,16)+TURTLE_BUS_RING_FORWARD_OFFSETS[1]-2.1;
                worst=Math.max(worst,Math.abs(ideal-motor.distance));
                assert.ok(motor.currentSpeed<=2.201,'不叠加个人推进');}
        }
        assert.ok(boarded);assert.ok(worst<.18,`跟圈误差 ${worst}，帧率${hz}`);
        bus.dispose();
    }
});
