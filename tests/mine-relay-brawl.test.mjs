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
    const controller = new MineRelayBrawlController(
        racers.length, seed, 20, lane => racers[lane],
        event => arms.push({ ...event }), event => transfers.push({ ...event }),
        event => resolutions.push({ ...event }),
    );
    return { racers, arms, transfers, resolutions, controller };
}

function putTogether(fixture, laneA, laneB) {
    fixture.racers[laneB].distance = fixture.racers[laneA].distance + 0.25;
    fixture.racers[laneB].lateral = fixture.racers[laneA].lateral + 0.2;
}

function minefieldFixture(seed = 91) {
    const racers = Array.from({ length: 2 }, () => ({ active: true, finished: false, distance: 0, lateral: 0 }));
    const impacts = [];
    const controller = new MinefieldBrawlController(
        racers.length, seed, 20, lane => racers[lane], impact => impacts.push({ ...impact }),
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
    fixture.controller.update(MINE_RELAY_TUNING.transferCooldownSeconds + 0.01, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 1);
    assert.equal(fixture.transfers[0].toLane, second);
    fixture.controller.update(MINE_RELAY_TUNING.transferCooldownSeconds + 0.01, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 1);
    fixture.controller.update(MINE_RELAY_TUNING.returnProtectionSeconds, GameState.RACING, true);
    assert.equal(fixture.transfers.length, 2);
    assert.equal(fixture.transfers[1].toLane, first);
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
    assert.doesNotMatch(presentation, /Graphics|\.clear\(\)/);
    const timedBombPresentation = readFileSync(new URL('../assets/scripts/core/MineRelayBrawlPresentation.ts', import.meta.url), 'utf8');
    assert.match(timedBombPresentation, /buildTimedBombGeometry/);
    assert.match(timedBombPresentation, /TimedBombWarningLamp/);
    assert.match(timedBombPresentation, /appendFacetedCylinder/);
    assert.doesNotMatch(timedBombPresentation, /this\.clock \* \(locked \? 190 : 75\)/);
    const manager = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(manager, /showMineFloating|showMineCarrier|showMineExplosion|updateMine\(/);
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
