import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import TimedBombModule from '../assets/scripts/core/MineRelayBrawlController.ts';
import MinefieldModule from '../assets/scripts/core/MinefieldBrawlController.ts';
import GameConstants from '../assets/scripts/core/GameConstants.ts';
import CareerRules from '../assets/scripts/progression/CareerRules.ts';
import PlayerProfile from '../assets/scripts/backend/PlayerProfile.ts';

const { MineRelayBrawlController, MINE_RELAY_ROUNDS, MINE_RELAY_TUNING } = TimedBombModule;
const { MinefieldBrawlController, MINEFIELD_TUNING } = MinefieldModule;
const { GameState } = GameConstants;
const { executeCareer } = CareerRules;
const { createDefaultProfile, normalizeProfile } = PlayerProfile;

function timedBombFixture(seed = 137) {
    const racers = Array.from({ length: 8 }, (_, lane) => ({
        active: true, finished: false, distance: lane === 0 ? 24 : 20, lateral: 8.75 - lane * 2.5,
    }));
    const arms = [], transfers = [], resolutions = [];
    const physicalContacts = new Set();
    const controller = new MineRelayBrawlController(
        racers.length, seed, 20, lane => racers[lane],
        event => arms.push({ ...event }), event => transfers.push({ ...event }),
        event => resolutions.push({ ...event }),
        MINE_RELAY_ROUNDS,
        (laneA, laneB) => physicalContacts.has(`${Math.min(laneA, laneB)}:${Math.max(laneA, laneB)}`),
    );
    return { racers, arms, transfers, resolutions, physicalContacts, controller };
}

function putTogether(fixture, laneA, laneB) {
    fixture.racers[laneB].distance = fixture.racers[laneA].distance + 0.25;
    fixture.racers[laneB].lateral = fixture.racers[laneA].lateral + 0.2;
}

function minefieldFixture(seed = 91, waveTriggerDistances = []) {
    const racers = Array.from({ length: 2 }, () => ({ active: true, finished: false, distance: 0, lateral: 0 }));
    const impacts = [];
    const controller = new MinefieldBrawlController(
        racers.length, seed, 20, lane => racers[lane], impact => impacts.push({ ...impact }),
        MINEFIELD_TUNING.mineCount, null, waveTriggerDistances,
    );
    return { racers, impacts, controller };
}

test('定时炸弹按共享种子直接随机发放，不再经过漂浮水雷阶段', () => {
    const a = timedBombFixture(912);
    const b = timedBombFixture(912);
    a.controller.update(0, GameState.RACING, true);
    b.controller.update(0, GameState.RACING, true);
    assert.deepEqual(a.arms[0], b.arms[0]);
    assert.equal(a.arms[0].roundId, 0);
    assert.equal(a.arms[0].fuseSeconds, MINE_RELAY_ROUNDS[0].fuseSeconds);
    assert.equal(a.controller.currentCarrierLane(), a.arms[0].carrierLane);
});

test('定时炸弹贴身传递具有冷却和上一持有者防回传', () => {
    const fixture = timedBombFixture();
    fixture.controller.update(0, GameState.RACING, true);
    const first = fixture.controller.currentCarrierLane();
    const second = first === 0 ? 1 : 0;
    putTogether(fixture, first, second);
    fixture.controller.update(MINE_RELAY_TUNING.initialTransferCooldownSeconds + 0.01, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 1);
    assert.equal(fixture.transfers[0].toLane, second);
    fixture.controller.update(MINE_RELAY_TUNING.transferCooldownSeconds + 0.01, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 1);
    fixture.controller.update(MINE_RELAY_TUNING.returnProtectionSeconds, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 2);
    assert.equal(fixture.transfers[1].toLane, first);
});

test('定时炸弹传递扫掠双方相对路径，单帧擦身而过也能传递', () => {
    const fixture = timedBombFixture(441);
    fixture.controller.update(0, GameState.RACING, true);
    const carrier = fixture.controller.currentCarrierLane();
    const target = carrier === 0 ? 1 : 0;
    for (let lane = 0; lane < fixture.racers.length; lane++) {
        if (lane === carrier || lane === target) continue;
        fixture.racers[lane].distance = fixture.racers[carrier].distance + 20;
    }
    fixture.racers[target].distance = fixture.racers[carrier].distance - 1.4;
    fixture.racers[target].lateral = fixture.racers[carrier].lateral;
    fixture.controller.update(MINE_RELAY_TUNING.initialTransferCooldownSeconds - 0.01, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 0);

    fixture.racers[target].distance = fixture.racers[carrier].distance + 1.4;
    fixture.controller.update(0.02, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 1);
    assert.equal(fixture.transfers[0].toLane, target);
    assert.ok(Math.abs(MINE_RELAY_TUNING.transferBodyAlongRadius * 2 - 1.6) < 1e-9);
    assert.ok(Math.abs(MINE_RELAY_TUNING.transferBodyLateralRadius * 2 - 1.3) < 1e-9);
});

test('人物碰撞已经触发翻滚时，即使求解分离到炸弹椭圆外也会交接', () => {
    const fixture = timedBombFixture(547);
    fixture.controller.update(0, GameState.RACING, true);
    const carrier = fixture.controller.currentCarrierLane();
    const target = carrier === 0 ? 1 : 0;
    for (let lane = 0; lane < fixture.racers.length; lane++) {
        if (lane === carrier || lane === target) continue;
        fixture.racers[lane].distance = fixture.racers[carrier].distance + 20;
    }
    fixture.racers[target].distance = fixture.racers[carrier].distance + 1.8;
    fixture.racers[target].lateral = fixture.racers[carrier].lateral;
    fixture.physicalContacts.add(`${Math.min(carrier, target)}:${Math.max(carrier, target)}`);

    fixture.controller.update(MINE_RELAY_TUNING.initialTransferCooldownSeconds - 0.01, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 0, '真实碰撞仍不能绕过初次接棒冷却');
    fixture.controller.update(0.02, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 1);
    assert.equal(fixture.transfers[0].toLane, target);
});

test('前方近距离目标持续对齐后触发辅助短传，瞬时进入范围不会误传', () => {
    const fixture = timedBombFixture(557);
    fixture.controller.update(0, GameState.RACING, true);
    const carrier = fixture.controller.currentCarrierLane();
    const target = carrier === 0 ? 1 : 0;
    for (let lane = 0; lane < fixture.racers.length; lane++) {
        if (lane === carrier || lane === target) continue;
        fixture.racers[lane].distance = fixture.racers[carrier].distance + 20;
    }
    fixture.racers[target].distance = fixture.racers[carrier].distance + 2;
    fixture.racers[target].lateral = fixture.racers[carrier].lateral + 1;
    fixture.controller.update(MINE_RELAY_TUNING.initialTransferCooldownSeconds, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 0);

    fixture.controller.update(MINE_RELAY_TUNING.assistedPassConfirmSeconds - 0.02, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 0);
    fixture.controller.update(0.03, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 1);
    assert.equal(fixture.transfers[0].toLane, target);
});

test('辅助短传不会把炸弹自动抛给身后或横向未对齐的人', () => {
    const fixture = timedBombFixture(559);
    fixture.controller.update(0, GameState.RACING, true);
    const carrier = fixture.controller.currentCarrierLane();
    const behind = carrier === 0 ? 1 : 0;
    const side = carrier <= 1 ? 2 : 1;
    for (let lane = 0; lane < fixture.racers.length; lane++) {
        if (lane === carrier) continue;
        fixture.racers[lane].distance = fixture.racers[carrier].distance + 20;
    }
    fixture.racers[behind].distance = fixture.racers[carrier].distance - 2;
    fixture.racers[behind].lateral = fixture.racers[carrier].lateral + 1;
    fixture.racers[side].distance = fixture.racers[carrier].distance + 2;
    fixture.racers[side].lateral = fixture.racers[carrier].lateral + 1.5;
    fixture.controller.update(
        MINE_RELAY_TUNING.initialTransferCooldownSeconds + MINE_RELAY_TUNING.assistedPassConfirmSeconds + 0.1,
        GameState.RACING,
        true,
    );
    assert.equal(fixture.transfers.length, 0);
});

test('辅助短传至少跨两个权威采样点确认，单帧卡顿不会直接传递', () => {
    const fixture = timedBombFixture(563);
    fixture.controller.update(0, GameState.RACING, true);
    const carrier = fixture.controller.currentCarrierLane();
    const target = carrier === 0 ? 1 : 0;
    for (let lane = 0; lane < fixture.racers.length; lane++) {
        if (lane === carrier || lane === target) continue;
        fixture.racers[lane].distance = fixture.racers[carrier].distance + 20;
    }
    fixture.racers[target].distance = fixture.racers[carrier].distance + 2;
    fixture.racers[target].lateral = fixture.racers[carrier].lateral + 1;
    fixture.controller.update(
        MINE_RELAY_TUNING.initialTransferCooldownSeconds + MINE_RELAY_TUNING.assistedPassConfirmSeconds + 0.1,
        GameState.RACING,
        true,
    );
    assert.equal(fixture.transfers.length, 0);
    fixture.controller.update(MINE_RELAY_TUNING.assistedPassConfirmSeconds, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 1);
    assert.equal(fixture.transfers[0].toLane, target);
});

test('定时炸弹优先发给附近存在可追目标的选手', () => {
    const fixture = timedBombFixture(733);
    const distances = [0, 18, 40, 42, 68, 87, 108, 130];
    for (let lane = 0; lane < fixture.racers.length; lane++) fixture.racers[lane].distance = distances[lane];
    fixture.controller.update(0, GameState.RACING, true);
    assert.ok([2, 3].includes(fixture.controller.currentCarrierLane()));
});

test('初次接棒保护期内附近 AI 不会立即横移逃开', () => {
    const fixture = timedBombFixture(317);
    fixture.controller.update(0, GameState.RACING, true);
    const carrier = fixture.controller.currentCarrierLane();
    const nearby = carrier === 0 ? 1 : carrier - 1;
    fixture.controller.update(MINE_RELAY_TUNING.aiReactionFastSeconds + 0.01, GameState.RACING, true);
    assert.equal(fixture.controller.targetZForAi(nearby, 1), null);
    fixture.controller.update(MINE_RELAY_TUNING.initialTransferCooldownSeconds, GameState.RACING, true);
    assert.notEqual(fixture.controller.targetZForAi(nearby, 1), null);
});

test('定时炸弹锁定后不能传递，归零只结算当前持有者', () => {
    const fixture = timedBombFixture();
    fixture.controller.update(0, GameState.RACING, true);
    const carrier = fixture.controller.currentCarrierLane();
    for (let lane = 0; lane < fixture.racers.length; lane++) if (lane !== carrier) fixture.racers[lane].distance += 20;
    fixture.controller.update(MINE_RELAY_ROUNDS[0].fuseSeconds - MINE_RELAY_TUNING.lockSeconds + 0.05, GameState.RACING, true);
    assert.equal(fixture.controller.isLocked(), true);
    fixture.controller.update(MINE_RELAY_TUNING.lockSeconds, GameState.RACING, true);
    assert.equal(fixture.resolutions.length, 1);
    assert.equal(fixture.resolutions[0].carrierLane, carrier);
    assert.equal(fixture.resolutions[0].exploded, true);
    assert.equal(fixture.resolutions[0].distance, fixture.racers[carrier].distance);
    assert.equal(fixture.resolutions[0].hitMask, 1 << carrier);
});

test('定时炸弹直接击倒携带者，并把爆炸范围内的附近泳道写入权威掩码', () => {
    const fixture = timedBombFixture(313);
    fixture.controller.update(0, GameState.RACING, true);
    const carrier = fixture.controller.currentCarrierLane();
    const nearby = carrier === 0 ? 1 : 0;
    for (let lane = 0; lane < fixture.racers.length; lane++) {
        if (lane === carrier) continue;
        fixture.racers[lane].distance = fixture.racers[carrier].distance + 20;
    }
    fixture.racers[nearby].distance = fixture.racers[carrier].distance + 4.8;
    fixture.racers[nearby].lateral = fixture.racers[carrier].lateral;
    fixture.controller.update(MINE_RELAY_ROUNDS[0].fuseSeconds + 0.01, GameState.RACING, true);
    const resolution = fixture.resolutions[0];
    assert.equal(resolution.carrierLane, carrier);
    assert.equal((resolution.hitMask & (1 << carrier)) !== 0, true);
    assert.equal((resolution.hitMask & (1 << nearby)) !== 0, true);
    assert.equal(MINE_RELAY_TUNING.blastAlongRadius, 5.2);
    assert.equal(MINE_RELAY_TUNING.blastLateralRadius, 4.2);
});

test('定时炸弹携带者冲线后拆弹，快照不会重复爆炸', () => {
    const host = timedBombFixture(77);
    const guest = timedBombFixture(77);
    host.controller.update(0, GameState.RACING, true);
    let applied = guest.controller.applySnapshotState(host.controller.snapshotState());
    assert.equal(applied.activeChanged, true);
    assert.equal(guest.controller.currentCarrierLane(), host.controller.currentCarrierLane());
    const carrier = host.controller.currentCarrierLane();
    host.racers[carrier].finished = true;
    host.controller.update(0.1, GameState.RACING, true);
    assert.equal(host.resolutions[0].exploded, false);
    applied = guest.controller.applySnapshotState(host.controller.snapshotState());
    assert.equal(applied.newlyExplodedMask, 0);
    assert.equal(guest.controller.currentArm(), null);
});

test('水雷模式的出生布局和漂移由共享种子稳定生成', () => {
    const a = minefieldFixture(123);
    const b = minefieldFixture(123);
    a.controller.update(0.5, GameState.RACING, false);
    b.controller.update(0.5, GameState.RACING, false);
    assert.deepEqual(a.controller.mines(), b.controller.mines());
    assert.equal(a.controller.mines().length, MINEFIELD_TUNING.mineCount);
    assert.ok(a.controller.mines().every(mine => mine.active));
    assert.ok(a.controller.mines().every(mine => mine.armed));
});

test('动态水雷压在选手当前位置时保持隐藏无碰撞，离开安全区后才启用', () => {
    const probeRacers = [{ active: false, finished: false, distance: 0, lateral: 0 }];
    const probe = new MinefieldBrawlController(1, 2026, 20, lane => probeRacers[lane], () => {});
    const spawn = probe.mines()[0];
    const racers = [{ active: true, finished: false, distance: spawn.courseX, lateral: spawn.lateral }];
    const impacts = [];
    const controller = new MinefieldBrawlController(
        1, 2026, 20, lane => racers[lane], impact => impacts.push({ ...impact }),
    );

    assert.equal(controller.mines()[0].active, true);
    assert.equal(controller.mines()[0].armed, false);
    controller.update(0.1, GameState.RACING, true);
    assert.equal(impacts.length, 0, '出生安全区内不能刷新同帧爆炸');

    racers[0].distance = 0;
    racers[0].lateral = 0;
    for (let elapsed = 0; elapsed < MINEFIELD_TUNING.spawnClearSeconds + 0.1; elapsed += 0.1) {
        controller.update(0.1, GameState.RACING, true);
    }
    assert.equal(controller.mines()[0].armed, true);

    const armedMine = controller.mines()[0];
    racers[0].distance = armedMine.courseX;
    racers[0].lateral = armedMine.lateral;
    controller.update(0, GameState.RACING, true);
    assert.equal(impacts.length, 1, '离开出生安全区后水雷应恢复正常碰撞');
});

test('六合一为超级漩涡预留中心区域且保持五枚水雷', () => {
    const racers = Array.from({ length: 2 }, () => ({ active: true, finished: false, distance: 0, lateral: 0 }));
    const controller = new MinefieldBrawlController(
        racers.length, 123, 20, lane => racers[lane], () => {}, 5,
        { courseX: 25, lateral: 0, alongRadius: 8.02, lateralRadius: 7.9 },
    );
    assert.equal(controller.mines().length, 5);
    assert.ok(controller.mines().every(mine => Math.abs(mine.courseX - 25) >= 7.2));
});

test('水雷碰到立即爆炸，本局永久消失并只在重开时恢复', () => {
    const fixture = minefieldFixture();
    const mine = fixture.controller.mines()[0];
    fixture.racers[0].distance = mine.courseX;
    fixture.racers[0].lateral = mine.lateral;
    fixture.racers[1].active = false;
    fixture.controller.update(0, GameState.RACING, true);
    assert.equal(fixture.impacts.length, 1);
    assert.equal(fixture.impacts[0].mineId, mine.id);
    assert.equal(fixture.impacts[0].hitMask, 1);
    assert.equal(fixture.controller.mines()[mine.id].active, false);
    fixture.racers[0].distance = 0;
    for (let elapsed = 0; elapsed < 30; elapsed += 0.1) {
        fixture.controller.update(0.1, GameState.RACING, true);
    }
    assert.equal(fixture.controller.mines()[mine.id].active, false);
    fixture.controller.reset();
    assert.equal(fixture.controller.mines()[mine.id].active, true);
});

test('单独水雷玩法在65米和130米按波次补齐已消失的水雷', () => {
    const fixture = minefieldFixture(901, [65, 130]);
    for (const mine of fixture.controller.mines()) {
        fixture.controller.applyImpact({
            mineId: mine.id,
            hitLane: 0,
            courseX: mine.courseX,
            lateral: mine.lateral,
            hitMask: 1,
            revision: fixture.controller.snapshotState().revision + 1,
        });
    }
    assert.ok(fixture.controller.mines().every(mine => !mine.active));

    fixture.controller.update(0, GameState.RACING, true, 65);
    assert.equal(fixture.controller.snapshotState().waveIndex, 1);
    assert.equal(fixture.controller.mines().filter(mine => mine.active).length, 7);
    assert.ok(fixture.controller.mines().every(mine => mine.generation === 1));

    fixture.controller.applyImpact({
        mineId: 2,
        hitLane: 0,
        courseX: fixture.controller.mines()[2].courseX,
        lateral: fixture.controller.mines()[2].lateral,
        hitMask: 1,
        revision: fixture.controller.snapshotState().revision + 1,
    });
    fixture.controller.update(0, GameState.RACING, true, 130);
    assert.equal(fixture.controller.snapshotState().waveIndex, 2);
    assert.equal(fixture.controller.mines().filter(mine => mine.active).length, 7);
    assert.equal(fixture.controller.mines()[2].generation, 2);
    assert.ok(fixture.controller.mines().filter(mine => mine.id !== 2)
        .every(mine => mine.generation === 1));
});

test('后续波只补空槽，仍存活的水雷不会重放入场或改变位置', () => {
    const fixture = minefieldFixture(903, [65, 130]);
    const surviving = fixture.controller.mines()[0];
    const before = { courseX: surviving.courseX, lateral: surviving.lateral, generation: surviving.generation };
    const consumed = fixture.controller.mines()[1];
    fixture.controller.applyImpact({
        mineId: consumed.id,
        hitLane: 0,
        courseX: consumed.courseX,
        lateral: consumed.lateral,
        hitMask: 1,
        revision: 1,
    });

    fixture.controller.update(0, GameState.RACING, true, 65);
    assert.deepEqual(
        { courseX: surviving.courseX, lateral: surviving.lateral, generation: surviving.generation },
        before,
    );
    assert.equal(fixture.controller.mines()[1].generation, 1);
    assert.equal(fixture.controller.mines().filter(mine => mine.active).length, 7);
});

test('首位完赛收尾后不再触发尚未到达的水雷波次', () => {
    const fixture = minefieldFixture(905, [65, 130]);
    fixture.controller.update(0, GameState.RACING, true, 130, false);
    assert.equal(fixture.controller.snapshotState().waveIndex, 0);
    assert.ok(fixture.controller.mines().every(mine => mine.generation === 0));
});

test('水雷快照同步波次和槽位代次，客机不会复活旧布局', () => {
    const host = minefieldFixture(907, [65, 130]);
    const guest = minefieldFixture(907, [65, 130]);
    const consumed = host.controller.mines()[3];
    host.controller.applyImpact({
        mineId: consumed.id,
        hitLane: 0,
        courseX: consumed.courseX,
        lateral: consumed.lateral,
        hitMask: 1,
        revision: 1,
    });
    host.controller.update(0, GameState.RACING, true, 65);

    assert.equal(guest.controller.applySnapshotState(host.controller.snapshotState()), true);
    assert.deepEqual(guest.controller.mines(), host.controller.mines());
    assert.equal(guest.controller.snapshotState().waveIndex, 1);
    assert.equal(guest.controller.mines()[3].generation, 1);
});

test('水雷使用自身与人物身体的扩张接触范围，身体边缘擦到即可触雷', () => {
    const fixture = minefieldFixture(811);
    const mine = fixture.controller.mines()[0];
    const centerGap = MINEFIELD_TUNING.mineItemAlongRadius
        + MINEFIELD_TUNING.swimmerContactAlongRadius * 0.75;
    assert.ok(centerGap > MINEFIELD_TUNING.mineItemAlongRadius,
        '人物中心应位于水雷自身范围之外');
    fixture.racers[0].distance = mine.courseX + centerGap;
    fixture.racers[0].lateral = mine.lateral;
    fixture.racers[1].active = false;
    fixture.controller.update(0, GameState.RACING, true);
    assert.equal(fixture.impacts.length, 1);
    assert.equal(fixture.impacts[0].mineId, mine.id);
    assert.ok(Math.abs(MINEFIELD_TUNING.mineItemAlongRadius
        + MINEFIELD_TUNING.swimmerContactAlongRadius - 1.35) < 1e-9,
        '扩张后应保持原纵向触雷总范围');
    assert.ok(Math.abs(MINEFIELD_TUNING.mineItemLateralRadius
        + MINEFIELD_TUNING.swimmerContactLateralRadius - 1.05) < 1e-9,
        '扩张后应保持原横向触雷总范围');
});

test('水雷直接触碰者和附近选手由同一房主权威范围区分', () => {
    const fixture = minefieldFixture(527);
    const mine = fixture.controller.mines()[0];
    fixture.racers[0].distance = mine.courseX;
    fixture.racers[0].lateral = mine.lateral;
    fixture.racers[1].distance = mine.courseX + 3;
    fixture.racers[1].lateral = mine.lateral;
    fixture.controller.update(0, GameState.RACING, true);
    assert.equal(fixture.impacts.length, 1);
    assert.equal(fixture.impacts[0].hitLane, 0);
    assert.equal(fixture.impacts[0].hitMask, 0b11);
    assert.equal(MINEFIELD_TUNING.blastAlongRadius, 3.2);
    assert.equal(MINEFIELD_TUNING.blastLateralRadius, 2.5);
});

test('水雷使用路径扫掠判定，单帧跨过水雷也会触发', () => {
    const fixture = minefieldFixture();
    const mine = fixture.controller.mines()[0];
    fixture.racers[0].distance = Math.max(0, mine.courseX - 2);
    fixture.racers[0].lateral = mine.lateral;
    fixture.racers[1].active = false;
    fixture.controller.update(0, GameState.RACING, true);
    fixture.racers[0].distance = mine.courseX + 2;
    fixture.controller.update(0, GameState.RACING, true);
    assert.equal(fixture.impacts.length, 1);
});

test('访客只接受递增的房主触雷事件', () => {
    const fixture = minefieldFixture();
    const mine = fixture.controller.mines()[0];
    const impact = { mineId: mine.id, hitLane: 1, courseX: mine.courseX, lateral: mine.lateral, hitMask: 0b10, revision: 1 };
    assert.equal(fixture.controller.applyImpact(impact), true);
    assert.equal(fixture.controller.applyImpact(impact), false);
});

test('水雷快照修复丢失事件、漂移时钟和永久失活状态', () => {
    const host = minefieldFixture(314);
    const guest = minefieldFixture(314);
    const mine = host.controller.mines()[0];
    host.racers[0].distance = mine.courseX;
    host.racers[0].lateral = mine.lateral;
    host.racers[1].active = false;
    host.controller.update(0, GameState.RACING, true);
    host.racers[0].distance = 0;
    host.controller.update(0.75, GameState.RACING, true);
    guest.controller.update(1.6, GameState.RACING, false);

    const activeSnapshot = host.controller.snapshotState();
    assert.equal(guest.controller.applySnapshotState(activeSnapshot), true);
    assert.deepEqual(guest.controller.mines(), host.controller.mines());
    assert.equal(guest.controller.mines()[mine.id].active, false);
    assert.equal(guest.controller.mines()[mine.id].armed, false);

    const staleSnapshot = { ...activeSnapshot, revision: activeSnapshot.revision - 1 };
    assert.equal(guest.controller.applySnapshotState(staleSnapshot), false);

    for (let elapsed = 0; elapsed < 30; elapsed += 0.1) {
        host.controller.update(0.1, GameState.RACING, true);
    }
    const laterSnapshot = host.controller.snapshotState();
    assert.equal(laterSnapshot.revision, activeSnapshot.revision);
    assert.equal(guest.controller.applySnapshotState(laterSnapshot), true);
    assert.equal(guest.controller.mines()[mine.id].active, false);
    assert.deepEqual(guest.controller.mines(), host.controller.mines());
});

test('同一水雷修订的旧快照不会回拨漂移时钟或复活障碍', () => {
    const fixture = minefieldFixture(314);
    const base = fixture.controller.snapshotState();
    const consumed = { ...base, elapsedSeconds: 2, activeMask: 0, armedMask: 0 };
    assert.equal(fixture.controller.applySnapshotState(consumed), true);
    assert.ok(fixture.controller.mines().every(mine => !mine.active));

    const stale = { ...base, elapsedSeconds: 1 };
    assert.equal(fixture.controller.applySnapshotState(stale), false);
    assert.ok(fixture.controller.mines().every(mine => !mine.active));
    assert.equal(fixture.controller.snapshotState().elapsedSeconds, 2);
});

test('两种玩法的 HUD 与表现不逐帧重建 UI，也不接管主镜头', () => {
    const hud = readFileSync(new URL('../assets/scripts/ui/MineRelayBrawlHud.ts', import.meta.url), 'utf8');
    assert.match(hud, /SAMPLE_SECONDS = 0\.1/);
    assert.match(hud, /text !== this\.lastText/);
    assert.doesNotMatch(hud, /Graphics\.clear|\.clear\(\)/);
    const presentation = readFileSync(new URL('../assets/scripts/core/MinefieldBrawlPresentation.ts', import.meta.url), 'utf8');
    assert.match(presentation, /PRESENTATION_INTERVAL = 1 \/ 20/);
    assert.match(presentation, /visible !== this\.visible/);
    assert.match(presentation, /buildMineGeometry/);
    assert.match(presentation, /ENTRY_DISTURB_SECONDS = 0\.28/);
    assert.match(presentation, /ENTRY_RISE_SECONDS = 0\.72/);
    assert.match(presentation, /ENTRY_SETTLE_SECONDS = 0\.3/);
    assert.match(presentation, /ENTRY_STAGGER_SECONDS = 0\.04/);
    assert.match(presentation, /ENTRY_START_DEPTH = 0\.82/);
    assert.match(presentation, /showWaterVisual[\s\S]*ENTRY_BREACH_INTENSITY/);
    assert.match(presentation, /entryWasArmed/);
    assert.match(presentation, /entryGeneration/);
    assert.doesNotMatch(presentation, /Graphics|\.clear\(\)/);
    const timedBombPresentation = readFileSync(new URL('../assets/scripts/core/MineRelayBrawlPresentation.ts', import.meta.url), 'utf8');
    assert.match(timedBombPresentation, /buildTimedBombGeometry/);
    assert.match(timedBombPresentation, /TimedBombWarningLamp/);
    assert.match(timedBombPresentation, /appendFacetedCylinder/);
    assert.match(timedBombPresentation, /beginThrowFromStands/);
    assert.match(timedBombPresentation, /THROW_ARC_HEIGHT = 3\.6/);
    assert.match(timedBombPresentation, /TRANSFER_THROW_SECONDS = 0\.22/);
    assert.match(timedBombPresentation, /TRANSFER_THROW_ARC_HEIGHT = 0\.55/);
    assert.match(timedBombPresentation, /transfer\(arm: MineRelayArm/);
    assert.match(timedBombPresentation, /Vec3\.transformMat4/);
    const timedBombController = readFileSync(new URL('../assets/scripts/core/MineRelayBrawlController.ts', import.meta.url), 'utf8');
    const manager = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
    assert.match(manager, /attach\(event, carrierNode, true\)/);
    assert.match(manager, /transfer\(arm \?\? \{/);
    assert.match(manager, /hasSwimmerCollisionContact/);
    assert.match(timedBombController, /pickPhysicalContactTarget/);
    assert.doesNotMatch(timedBombPresentation, /this\.clock \* \(locked \? 190 : 75\)/);
    assert.doesNotMatch(manager, /showMineFloating|showMineCarrier|showMineExplosion|updateMine\(/);
});

test('宽容传递参数写入正式调参配置并保留调试入口', () => {
    const tuning = JSON.parse(readFileSync(
        new URL('../assets/resources/config/tuning.json', import.meta.url),
        'utf8',
    ));
    assert.equal(tuning.values['mineRelay.transferBodyAlongRadius'], 0.8);
    assert.equal(tuning.values['mineRelay.transferBodyLateralRadius'], 0.65);
    assert.equal(tuning.values['mineRelay.initialTransferCooldownSeconds'], 0.55);
    assert.equal(tuning.values['mineRelay.transferCooldownSeconds'], 0.45);
    assert.equal(tuning.values['mineRelay.assistedPassMinAheadDistance'], 0.4);
    assert.equal(tuning.values['mineRelay.assistedPassMaxAheadDistance'], 2.8);
    assert.equal(tuning.values['mineRelay.assistedPassLateralDistance'], 1.2);
    assert.equal(tuning.values['mineRelay.assistedPassConfirmSeconds'], 0.18);
    assert.equal(tuning.values['mineRelay.starterNearbyAlongDistance'], 4.8);
    assert.equal(tuning.values['mineRelay.starterNearbyLateralDistance'], 5.4);
    const controls = readFileSync(new URL('../assets/scripts/core/TuningDebugControls.ts', import.meta.url), 'utf8');
    for (const id of [
        'mineRelay.initialTransferCooldownSeconds',
        'mineRelay.assistedPassMinAheadDistance',
        'mineRelay.assistedPassMaxAheadDistance',
        'mineRelay.assistedPassLateralDistance',
        'mineRelay.assistedPassConfirmSeconds',
        'mineRelay.starterNearbyAlongDistance',
        'mineRelay.starterNearbyLateralDistance',
    ]) assert.match(controls, new RegExp(id.replaceAll('.', '\\.')));
});

test('两种新玩法只允许快速比赛二百米，旧水雷接力存档迁移为定时炸弹', () => {
    const profile = createDefaultProfile();
    const characterId = Object.keys(profile.characters)[0];
    for (const rule of ['timed-bomb', 'minefield']) {
        assert.equal(executeCareer(createDefaultProfile(), {
            type: 'begin', source: 'quick', characterId, tier: 0, distance: 200, rule, seed: 17,
        }).ok, true);
        assert.equal(executeCareer(createDefaultProfile(), {
            type: 'begin', source: 'league', characterId, tier: 0, distance: 200, rule, seed: 17,
        }).ok, false);
    }
    profile.career.quick.rule = 'mine-relay';
    assert.equal(normalizeProfile(profile).career.quick.rule, 'timed-bomb');
});
