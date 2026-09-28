import test from 'node:test';
import assert from 'node:assert/strict';

import RulesModule from '../assets/scripts/core/TurtleBusRules.ts';

const {
    TURTLE_BUS_CONFIG, TURTLE_BUS_LEFT_HAND, TURTLE_BUS_RIGHT_HAND,
    TURTLE_BUS_BOTH_HANDS, TurtleBusSeats,
    turtleBusDoneAge, turtleBusEstimateClaimAge, turtleBusHasBoardingWindow,
    turtleBusPhaseAt, turtleBusPositionAt, turtleBusRingWorldLateral, turtleBusUnloadingAge,
    TURTLE_BUS_TUNING, turtleBusFeelSnapshot, turtleBusCatchInterval,
} = RulesModule;

test('抓圈轨迹连续求交：低帧率穿过、离开和大校正各自处理',()=>{
    const out={enter:0,exit:0};
    assert.equal(turtleBusCatchInterval(.85,0,-1.4,0,out),true);
    assert.ok(Math.abs(out.enter-.2/2.25)<1e-9 && Math.abs(out.exit-2/2.25)<1e-9);
    assert.equal(turtleBusCatchInterval(.1,1.2,.1,-1.2,out),true);
    assert.ok(Math.abs(out.enter-.125)<1e-9 && Math.abs(out.exit-.875)<1e-9);
    assert.equal(turtleBusCatchInterval(3,0,0,0,out),false,'大位置校正不能扫整段补抓');
    assert.equal(turtleBusCatchInterval(.1,1.1,.2,1.2,out),false);
});

function racer(seat, offset, speed, lateral = 0, direction = 1) {
    return { seat, offset, forwardSpeed: speed, lateral, direction, racing: true, boardEligible: true };
}

test('反向行驶时圈的世界横向位置随模型旋转镜像', () => {
    assert.ok(Math.abs(turtleBusRingWorldLateral(4, 1, 0) - 1.15) < 1e-9);
    assert.ok(Math.abs(turtleBusRingWorldLateral(4, -1, 0) - 6.85) < 1e-9);
    assert.ok(Math.abs(turtleBusRingWorldLateral(4, -1, 3) - 1.15) < 1e-9);
    const visibleRing = racer(0, 0, 2.5, 6.85, -1);
    assert.ok(Number.isFinite(turtleBusEstimateClaimAge(visibleRing, 0, -1, 4)));
});

test('单机调参按开赛快照冻结，联机始终使用统一默认手感', () => {
    const previous = TURTLE_BUS_TUNING.detachImpulseBoth;
    try {
        const frozen = turtleBusFeelSnapshot();
        TURTLE_BUS_TUNING.detachImpulseBoth = 2.4;
        assert.equal(frozen.detachImpulseBoth, previous);
        assert.equal(turtleBusFeelSnapshot().detachImpulseBoth, 2.4);
        assert.equal(turtleBusFeelSnapshot(true).detachImpulseBoth, TURTLE_BUS_CONFIG.detachImpulseBoth);
        const seats = new TurtleBusSeats(turtleBusFeelSnapshot());
        seats.start(3);
        seats.advance(3.01);
        assert.equal(seats.claim(0, 0, seats.age, true, 0), true);
        assert.equal(seats.hit(0, 2, seats.age), false);
        assert.equal(seats.hit(0, 2.4, seats.age), true);
    } finally { TURTLE_BUS_TUNING.detachImpulseBoth = previous; }
});

test('单程轨迹与真实池端留白：预告时不动，接客后加速，到站前下客', () => {
    assert.equal(turtleBusPhaseAt(0), 'preview');
    assert.equal(turtleBusPositionAt(0), 16);
    assert.equal(turtleBusPositionAt(3), 16);
    assert.equal(turtleBusPhaseAt(3), 'boarding');
    assert.equal(turtleBusPhaseAt(3.7), 'accelerating');
    assert.equal(turtleBusPhaseAt(5), 'cruising');
    assert.equal(turtleBusPositionAt(turtleBusUnloadingAge()), 42);
    assert.ok(turtleBusPositionAt(turtleBusDoneAge()) < 50);
    assert.equal(turtleBusPhaseAt(turtleBusDoneAge()), 'done');
    assert.ok(TURTLE_BUS_CONFIG.cruiseSpeed < 2.5);
    assert.equal(turtleBusPositionAt(0, 22), 22);
    assert.equal(turtleBusPositionAt(turtleBusUnloadingAge(22), 22), 42);
    let previous = 0;
    for (let t = 0; t <= turtleBusDoneAge(); t += 0.02) {
        const position = turtleBusPositionAt(t);
        assert.ok(position >= previous - 1e-8);
        previous = position;
    }
});

test('发车窗口要给不同人不同圈，池中段及反向选手追不上', () => {
    assert.ok(Number.isFinite(turtleBusEstimateClaimAge(racer(0, 0, 2.5), 1, 1, 0)));
    assert.equal(turtleBusEstimateClaimAge(racer(0, 20, 2.5), 1, 1, 0), Infinity);
    assert.equal(turtleBusEstimateClaimAge(racer(0, 0, 2.5, 0, -1), 1, 1, 0), Infinity);
    const two = [racer(0, 0, 2.5, -1.2), racer(1, 0, 2.5, 1.2)];
    assert.equal(turtleBusHasBoardingWindow(two, 1, 0), true);
    assert.equal(turtleBusHasBoardingWindow(two.map(value => ({ ...value, offset: 20 })), 1, 0), false);
    assert.equal(turtleBusHasBoardingWindow([two[0]], 1, 0), true);
    assert.equal(turtleBusHasBoardingWindow([two[0], racer(1, 20, 2.5)], 1, 0), false);
});

test('途中抢圈按当前时刻重新预测，不把已驶过的路程重复计算', () => {
    // 人物根在厚圈后 2.2 米；该时刻 12 米已越过握点，11.3 米仍可接近。
    assert.ok(Number.isFinite(turtleBusEstimateClaimAge(racer(1, 11.3, 2.5, -.95),
        1, 1, 0, 4)));
    assert.equal(turtleBusEstimateClaimAge(racer(1, 5, 2.5, -1.2),
        1, 1, 0, turtleBusUnloadingAge()), Infinity);
});

test('按真实左右起划释放：短点不送入状态机，重复同侧不松另一手', () => {
    const seats = new TurtleBusSeats();
    seats.start(7);
    seats.advance(TURTLE_BUS_CONFIG.previewSeconds);
    assert.equal(seats.claim(0, 1, seats.age, true, 12), true);
    assert.equal(seats.hands[0], TURTLE_BUS_BOTH_HANDS);
    seats.advance(TURTLE_BUS_CONFIG.boardingProtectionSeconds);
    assert.equal(seats.strokeStarted(0, TURTLE_BUS_LEFT_HAND, 12, seats.age), false);
    assert.equal(seats.strokeStarted(0, TURTLE_BUS_LEFT_HAND, 13, seats.age), true);
    assert.equal(seats.hands[0], TURTLE_BUS_RIGHT_HAND);
    assert.equal(seats.strokeStarted(0, TURTLE_BUS_LEFT_HAND, 14, seats.age), false);
    assert.equal(seats.ringOfSwimmer[0], 1);
    assert.equal(seats.strokeStarted(0, TURTLE_BUS_RIGHT_HAND, 15, seats.age), true);
    assert.equal(seats.ringOfSwimmer[0], -1);
    assert.equal(seats.occupants[1], -1);
    assert.equal(seats.strokeStarted(0, TURTLE_BUS_RIGHT_HAND, 15, seats.age), false);
});

test('撞落保留碰撞结果并释放圈；前乘客须离开抓取区且过冷却才可重新抓', () => {
    const seats = new TurtleBusSeats();
    seats.start(8);
    seats.advance(3);
    assert.equal(seats.claim(0, 1, seats.age, true, 0), true);
    assert.equal(seats.hit(0, 1.39, seats.age), false);
    assert.equal(seats.hit(0, 1.4, seats.age), true);
    assert.equal(seats.claim(1, 1, seats.age, true, 0), true);
    seats.detach(1, 'stroke', seats.age);
    assert.equal(seats.canClaim(0, 1, seats.age + 1, true), false);
    seats.leftCatchArea(0);
    assert.equal(seats.canClaim(0, 1, seats.age + 0.79, true), false);
    assert.equal(seats.canClaim(0, 1, seats.age + 0.81, true), true);
    assert.equal(seats.claim(0, 1, seats.age + 0.81, true, 4), true);
    seats.age = seats.gripProtectedUntil[0];
    assert.equal(seats.strokeStarted(0, TURTLE_BUS_LEFT_HAND, 5, seats.age), true);
    assert.equal(seats.hit(0, TURTLE_BUS_CONFIG.detachImpulseSingle, seats.age), true);
});

test('上车1.2秒内连划只消费动作序号，过期不补松手，重上车重新获得保护',()=>{
    const seats=new TurtleBusSeats();seats.start(1);seats.advance(3);
    seats.claim(0,0,3,true,0);
    assert.equal(seats.gripProtectedUntil[0],4.2);
    for(let seq=1;seq<=8;seq++)assert.equal(seats.strokeStarted(0,seq%2?1:2,seq,3+seq*.1),false);
    assert.equal(seats.hands[0],3);
    seats.advance(1.3);assert.equal(seats.hands[0],3,'保护结束不执行累计输入');
    assert.equal(seats.strokeStarted(0,2,8,seats.age),false,'保护内旧动作不能重放松手');
    assert.equal(seats.strokeStarted(0,1,9,seats.age),true);
    assert.equal(seats.hands[0],2);
    assert.equal(seats.strokeStarted(0,2,10,seats.age),true);
    assert.equal(seats.gripProtectedUntil[0],0);
    seats.advance(1);seats.leftCatchArea(0);assert.equal(seats.claim(0,0,seats.age,true,10),true);
    assert.equal(seats.strokeStarted(0,1,11,seats.age),false);
    assert.equal(seats.hit(0,2,seats.age),true,'保护不抵挡真实撞击');
    seats.reset();assert.equal(seats.gripProtectedUntil[0],0);
});

test('一次大步跨过下客阶段也要先释放所有人', () => {
    const seats = new TurtleBusSeats();
    seats.start(9);
    seats.advance(3);
    assert.equal(seats.claim(0, 0, seats.age, true, 0), true);
    seats.advance(turtleBusUnloadingAge() - seats.age + TURTLE_BUS_CONFIG.unloadSeconds + 0.01);
    assert.equal(seats.phase, 'submerging');
    assert.equal(seats.occupants[0], -1);
    assert.equal(seats.ringOfSwimmer[0], -1);
    seats.advance(10);
    assert.equal(seats.phase, 'done');
    assert.equal(seats.canClaim(0, 0, seats.age, true), false);
});

test('进入减速区后先降速，潜走前才放客且不再接新圈', () => {
    const seats = new TurtleBusSeats();
    seats.start(10);
    seats.advance(3);
    assert.equal(seats.claim(0, 0, seats.age, true, 0), true);
    seats.advance(turtleBusUnloadingAge() - seats.age + 0.1);
    assert.equal(seats.phase, 'unloading');
    assert.equal(seats.ringOfSwimmer[0], 0);
    assert.equal(seats.canClaim(1, 1, seats.age, true), false);
    seats.advance(TURTLE_BUS_CONFIG.unloadSeconds);
    assert.equal(seats.phase, 'submerging');
    assert.equal(seats.ringOfSwimmer[0], -1);
});
