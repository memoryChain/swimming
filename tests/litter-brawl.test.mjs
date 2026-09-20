import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import GameConstants from '../assets/scripts/core/GameConstants.ts';
import LitterModule from '../assets/scripts/core/LitterBrawlController.ts';
import ContactGeometry from '../assets/scripts/core/RaceContactGeometry.ts';

const { GameState } = GameConstants;
const {
    LitterBrawlController,
    LITTER_BRAWL_TUNING,
    LITTER_BRAWL_INDEPENDENT_SCHEDULE,
    buildEntertainmentLitterSchedule,
    litterCorridorOverlapsObstacle,
} = LitterModule;
const { expandedEllipseContains, segmentHitsExpandedEllipse } = ContactGeometry;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture(seed = 20260919, schedule = LITTER_BRAWL_INDEPENDENT_SCHEDULE, isWaveSafe) {
    const racers = Array.from({ length: 8 }, (_, lane) => ({
        active: true,
        finished: false,
        distance: 0,
        lateral: -7 + lane * 2,
    }));
    const waves = [];
    const impacts = [];
    const contacts = [];
    const controller = new LitterBrawlController(
        8, seed, 20, lane => racers[lane], wave => waves.push(wave), impact => impacts.push(impact),
        schedule, isWaveSafe, contact => contacts.push(contact),
    );
    return { controller, racers, waves, impacts, contacts };
}

test('独立赛程保持五波，统一娱乐覆盖按赛程生成两波或三波', () => {
    assert.deepEqual(LITTER_BRAWL_INDEPENDENT_SCHEDULE.waveDistances, [18, 48, 82, 118, 154]);
    const short = buildEntertainmentLitterSchedule(70, 200);
    const long = buildEntertainmentLitterSchedule(120, 400);
    assert.deepEqual(short.waveDistances, [70, 77]);
    assert.deepEqual(long.waveDistances, [120, 126, 132]);
    assert.equal(short.landingLeadDistance, LITTER_BRAWL_TUNING.landingLeadDistance);
    assert.equal(long.landingLeadDistance, LITTER_BRAWL_TUNING.landingLeadDistance);

    const shortFixture = fixture(41, short);
    shortFixture.racers[0].distance = 200;
    shortFixture.controller.update(0, GameState.RACING);
    assert.deepEqual(shortFixture.waves, [0, 1]);
    assert.equal(shortFixture.controller.activeCount(), 4);
    assert.equal(shortFixture.controller.pendingWaveCount(), 0);

    const longFixture = fixture(42, long);
    longFixture.racers[0].distance = 400;
    longFixture.controller.update(0, GameState.RACING);
    assert.deepEqual(longFixture.waves, [0, 1, 2]);
    assert.equal(longFixture.controller.activeCount(), 6);
});

test('统一赛程受终点安全距离约束且不会生成重复触发点', () => {
    const nearFinish = buildEntertainmentLitterSchedule(195, 200);
    assert.deepEqual(nearFinish.waveDistances, [191]);
    assert.ok(nearFinish.waveDistances[0] + nearFinish.landingLeadDistance <= 198);
});

test('组合安全不满足时保持同一候选通道等待，安全后才投放', () => {
    const schedule = buildEntertainmentLitterSchedule(30, 200);
    const checks = [];
    let safe = false;
    const { controller, racers, waves } = fixture(44, schedule, (courseX, safeCenter, safeHalfWidth) => {
        checks.push([courseX, safeCenter, safeHalfWidth]);
        return safe;
    });
    racers[0].distance = 30;
    controller.update(0, GameState.RACING);
    controller.update(0.25, GameState.RACING);
    assert.equal(controller.activeCount(), 0);
    assert.equal(controller.pendingWaveCount(), 2);
    assert.equal(checks.length, 2);
    assert.deepEqual(checks[1], checks[0], '等待期间不能随帧数重新抽取安全通道');

    safe = true;
    controller.update(0.25, GameState.RACING);
    assert.equal(controller.activeCount(), 2);
    assert.deepEqual(waves, [0]);
    assert.equal(controller.cancelledCount(), 0);
});

test('组合安全持续不满足超过窗口后取消该波且不生成贴脸垃圾', () => {
    const schedule = { waveDistances: [10], landingLeadDistance: 7 };
    const { controller, racers, waves } = fixture(45, schedule, () => false);
    racers[0].distance = 10;
    for (let index = 0; index < 13; index++) controller.update(0.25, GameState.RACING);
    assert.equal(controller.activeCount(), 0);
    assert.equal(controller.pendingWaveCount(), 0);
    assert.equal(controller.cancelledCount(), 1);
    assert.deepEqual(waves, [], '被取消波次不能触发已投放广播');
    assert.equal(controller.isComplete(), true);
});

test('安全通道同时排除活动水雷、普通漩涡和超级漩涡的影响范围', () => {
    const courseX = 20;
    const safeCenter = 0;
    const safeHalfWidth = LITTER_BRAWL_TUNING.safeHalfWidth;
    const mineAlongRadius = 0.67 + 0.68 + LITTER_BRAWL_TUNING.spawnMineAlongMargin;
    const mineLateralRadius = 0.65 + 0.4 + LITTER_BRAWL_TUNING.spawnMineLateralMargin;
    assert.equal(litterCorridorOverlapsObstacle(
        courseX, safeCenter, safeHalfWidth,
        courseX + mineAlongRadius - 0.001, safeCenter + safeHalfWidth + mineLateralRadius - 0.001,
        mineAlongRadius, mineLateralRadius,
    ), true, '边界上的活动水雷仍占用安全通道');
    assert.equal(litterCorridorOverlapsObstacle(
        courseX, safeCenter, safeHalfWidth,
        courseX + mineAlongRadius + 0.01, safeCenter,
        mineAlongRadius, mineLateralRadius,
    ), false, '纵向范围之外的水雷不应误挡波次');

    const normalAlongRadius = 5.2 + LITTER_BRAWL_TUNING.spawnWhirlpoolAlongMargin;
    const normalLateralRadius = 4.2 + LITTER_BRAWL_TUNING.spawnWhirlpoolLateralMargin;
    assert.equal(litterCorridorOverlapsObstacle(
        courseX, -5.9, safeHalfWidth,
        courseX, 0,
        normalAlongRadius, normalLateralRadius,
    ), true, '普通漩涡的完整影响范围不能与安全通道重叠');
    assert.equal(litterCorridorOverlapsObstacle(
        courseX, -6.01, safeHalfWidth,
        courseX, 0,
        normalAlongRadius, normalLateralRadius,
    ), false, '普通漩涡外侧应保留真实通路');

    const superAlongRadius = 5.2 * 1.35 + LITTER_BRAWL_TUNING.spawnWhirlpoolAlongMargin;
    const superLateralRadius = 4.2 * 1.5 + LITTER_BRAWL_TUNING.spawnWhirlpoolLateralMargin;
    assert.equal(litterCorridorOverlapsObstacle(
        courseX, -8, safeHalfWidth,
        courseX, 0,
        superAlongRadius, superLateralRadius,
    ), true, '超级漩涡必须使用放大后的范围');
    assert.equal(litterCorridorOverlapsObstacle(
        courseX + superAlongRadius + 0.01, -8, safeHalfWidth,
        courseX, 0,
        superAlongRadius, superLateralRadius,
    ), false, '超级漩涡纵向范围之外不应误挡波次');
});

test('权威快照恢复活动槽位和漂移内部状态，旧快照不能回拨', () => {
    const schedule = buildEntertainmentLitterSchedule(30, 200);
    const host = fixture(46, schedule);
    host.racers[0].distance = 30;
    host.controller.update(2, GameState.RACING);
    const snapshot = host.controller.snapshotState();
    assert.equal(snapshot.slots.length, 2);

    const guest = fixture(999, schedule);
    guest.racers[0].distance = 200;
    guest.controller.update(1, GameState.RACING, false);
    assert.equal(guest.controller.activeCount(), 0, '访客不得自行触发已越过的波次');
    assert.equal(guest.controller.applySnapshotState(snapshot).applied, true);
    assert.equal(guest.controller.activeCount(), 2);
    assert.deepEqual(
        guest.controller.snapshotState(),
        snapshot,
        '恢复必须覆盖随机流、波次、活动槽位及后续漂移所需内部状态',
    );

    guest.controller.update(0.2, GameState.RACING, false);
    const advanced = guest.controller.snapshotState();
    assert.ok(advanced.elapsedSeconds > snapshot.elapsedSeconds);
    assert.equal(guest.impacts.length, 0, '访客只做表现预测，不自行结算接触');
    assert.equal(guest.controller.applySnapshotState({
        ...snapshot,
        elapsedSeconds: snapshot.elapsedSeconds - 0.01,
    }).applied, false, '同修订倒序快照不能回拨垃圾');
    assert.deepEqual(guest.controller.snapshotState(), advanced);
});

test('较新权威快照可静默回收旧槽位且不会补播波次或碰撞反馈', () => {
    const schedule = { waveDistances: [10], landingLeadDistance: 7 };
    const host = fixture(47, schedule);
    host.racers[0].distance = 10;
    host.controller.update(0, GameState.RACING);
    const active = host.controller.snapshotState();
    host.controller.update(
        LITTER_BRAWL_TUNING.fallingSeconds
            + LITTER_BRAWL_TUNING.floatingLifetime
            + LITTER_BRAWL_TUNING.retireSeconds
            + 0.1,
        GameState.RACING,
    );
    const retired = host.controller.snapshotState();
    assert.equal(retired.slots.length, 0);

    const guest = fixture(48, schedule);
    assert.equal(guest.controller.applySnapshotState(active).applied, true);
    assert.equal(guest.controller.applySnapshotState(retired).activeChanged, true);
    assert.equal(guest.controller.activeCount(), 0);
    assert.deepEqual(guest.waves, [], '快照恢复不能补播旧投放提示');
    assert.deepEqual(guest.impacts, [], '快照恢复不能补播旧碰撞反馈');
    assert.equal(guest.controller.applySnapshotState(active).applied, false, '已回收槽位不能被旧包复活');
});

test('可靠垃圾接触按全局修订去重并把权威受推轨迹应用到访客', () => {
    const schedule = { waveDistances: [0], landingLeadDistance: 7 };
    const host = fixture(49, schedule);
    host.racers[0].distance = 0;
    host.controller.update(LITTER_BRAWL_TUNING.fallingSeconds + 0.1, GameState.RACING);
    const beforeContact = host.controller.snapshotState();
    const rigid = host.controller.clusters().find(slot => slot.active && slot.kind === 'rigid');
    host.racers[0].distance = rigid.courseX;
    host.racers[0].lateral = rigid.lateral;
    host.controller.update(0.05, GameState.RACING);
    assert.equal(host.contacts.length, 1);
    const contact = host.contacts[0];
    assert.equal(contact.kind, 'rigid');

    const guest = fixture(50, schedule);
    assert.equal(guest.controller.applySnapshotState(beforeContact).applied, true);
    assert.equal(guest.controller.applyContact(contact), true);
    assert.equal(guest.controller.applyContact(contact), false, '重复可靠事件不能重复结算');
    assert.equal(guest.controller.applyContact({ ...contact, revision: contact.revision - 1 }), false,
        '迟到事件不能回拨垃圾轨迹');
    const guestSlot = guest.controller.snapshotState().slots.find(slot => slot.id === contact.slotId);
    assert.equal(guestSlot.bounceAlongVelocity, contact.bounceAlongVelocity);
    assert.equal(guestSlot.bounceLateralVelocity, contact.bounceLateralVelocity);
});

test('房主迁移从最近快照继续下一波，不重抽通道或重投旧波次', () => {
    const schedule = buildEntertainmentLitterSchedule(30, 200);
    const oldHost = fixture(51, schedule);
    oldHost.racers[0].distance = 30;
    oldHost.controller.update(0, GameState.RACING);
    const migration = oldHost.controller.snapshotState();

    const promoted = fixture(9999, schedule);
    promoted.racers[0].distance = 30;
    assert.equal(promoted.controller.applySnapshotState(migration).applied, true);
    assert.deepEqual(promoted.waves, [], '迁移恢复不能补播已经投放的旧波次');

    oldHost.racers[0].distance = 200;
    promoted.racers[0].distance = 200;
    oldHost.controller.update(0, GameState.RACING, true);
    promoted.controller.update(0, GameState.RACING, true);
    assert.deepEqual(promoted.waves, [1]);
    assert.deepEqual(promoted.controller.snapshotState(), oldHost.controller.snapshotState(),
        '新房主必须沿用权威随机流和相同安全通道继续');
});

test('导演收尾只取消待投波次，已出现垃圾继续自然下沉并在重启后复用当前预设', () => {
    const schedule = buildEntertainmentLitterSchedule(30, 200);
    const { controller, racers, waves } = fixture(43, schedule);
    racers[0].distance = 30;
    controller.update(0, GameState.RACING);
    assert.deepEqual(waves, [0]);
    assert.equal(controller.activeCount(), 2);
    assert.equal(controller.pendingWaveCount(), 1);

    controller.cancelPendingWaves();
    racers[0].distance = 200;
    controller.update(0, GameState.RACING);
    assert.deepEqual(waves, [0], '收尾后不能继续投放尚未出现的波次');
    assert.equal(controller.activeCount(), 2, '已经出现的垃圾不能在收尾边沿瞬间消失');

    controller.update(
        LITTER_BRAWL_TUNING.fallingSeconds
            + LITTER_BRAWL_TUNING.floatingLifetime
            + LITTER_BRAWL_TUNING.retireSeconds
            + 0.1,
        GameState.RACING,
    );
    assert.equal(controller.activeCount(), 0);
    assert.equal(controller.isComplete(), true);

    controller.restart();
    racers[0].distance = 200;
    controller.update(0, GameState.RACING);
    assert.deepEqual(waves, [0, 0, 1], '普通重启应继续使用统一模式预设而不是退回独立五波');
    assert.equal(controller.activeCount(), 4);
});

test('赛程触发垃圾落入并在落水后才产生柔性阻力', () => {
    const { controller, racers, waves } = fixture();
    controller.update(1, GameState.COUNTDOWN);
    assert.equal(controller.clusters().filter(cluster => cluster.active).length, 0);
    racers[0].distance = LITTER_BRAWL_TUNING.waveDistances[0];
    controller.update(0, GameState.RACING);
    const spawned = controller.clusters().filter(cluster => cluster.active);
    assert.equal(spawned.length, 2);
    assert.deepEqual(spawned.map(cluster => cluster.kind), ['rigid', 'soft']);
    assert.deepEqual(waves, [0]);
    assert.ok(spawned.every(cluster => cluster.phase === 'falling'));
    const soft = spawned.find(cluster => cluster.kind === 'soft');
    racers[1].distance = soft.courseX;
    racers[1].lateral = soft.lateral;
    assert.equal(controller.environmentDragForLane(1), 0, '垃圾还在空中时不能减速');
    controller.update(LITTER_BRAWL_TUNING.fallingSeconds, GameState.RACING);
    const landed = controller.clusters().find(cluster => cluster.id === soft.id);
    racers[1].distance = landed.courseX;
    racers[1].lateral = landed.lateral;
    assert.ok(controller.environmentDragForLane(1) > LITTER_BRAWL_TUNING.maxEnvironmentDrag * 0.95);
    racers[1].lateral += LITTER_BRAWL_TUNING.contactLateralRadius;
    assert.equal(controller.environmentDragForLane(1), 0, '接触区边缘平滑归零');
});

test('硬垃圾首次接触触发反弹事件且没有持续拖拽，离开后才允许再次碰撞', () => {
    const { controller, racers, impacts } = fixture();
    racers[0].distance = LITTER_BRAWL_TUNING.waveDistances[0];
    controller.update(LITTER_BRAWL_TUNING.fallingSeconds, GameState.RACING);
    const rigid = controller.clusters().find(cluster => cluster.active && cluster.kind === 'rigid');
    racers[3].distance = rigid.courseX;
    racers[3].lateral = rigid.lateral;
    controller.update(1 / 60, GameState.RACING);
    assert.equal(impacts.length, 1);
    assert.equal(impacts[0].slotId, rigid.id);
    assert.equal(impacts[0].lane, 3);
    assert.equal(controller.environmentDragForLane(3), 0, '硬垃圾不使用软垃圾的持续水阻');
    controller.update(1 / 60, GameState.RACING);
    assert.equal(impacts.length, 1, '持续贴住时不能逐帧重复结算');
    racers[3].lateral = rigid.lateral + 3;
    const hitX = rigid.courseX;
    const hitZ = rigid.lateral;
    controller.update(0.2, GameState.RACING);
    assert.ok(Math.hypot(rigid.courseX - hitX, rigid.lateral - hitZ) > 0.25, '轻塑料瓶受击后应明显被拨走');
    racers[3].distance = rigid.courseX;
    racers[3].lateral = rigid.lateral;
    controller.update(1 / 60, GameState.RACING);
    assert.equal(impacts.length, 2);
});

test('人物身体边缘接触垃圾时触发实体反馈，且跨帧扫掠使用相同扩张范围', () => {
    const { controller, racers, impacts } = fixture(711);
    racers[0].distance = LITTER_BRAWL_TUNING.waveDistances[0];
    controller.update(LITTER_BRAWL_TUNING.fallingSeconds, GameState.RACING);
    const rigid = controller.clusters().find(cluster => cluster.active && cluster.kind === 'rigid');
    const soft = controller.clusters().find(cluster => cluster.active && cluster.kind === 'soft');

    const rigidGap = LITTER_BRAWL_TUNING.rigidItemAlongRadius
        + LITTER_BRAWL_TUNING.swimmerContactAlongRadius * 0.75;
    assert.ok(rigidGap > LITTER_BRAWL_TUNING.rigidItemAlongRadius,
        '人物中心应处于瓶子自身范围之外');
    racers[5].distance = rigid.courseX + rigidGap;
    racers[5].lateral = rigid.lateral;
    controller.update(0, GameState.RACING);
    assert.equal(impacts.length, 1, '身体边缘碰到瓶子时应立即触发硬碰反馈');

    const softGap = LITTER_BRAWL_TUNING.softPushContactLateralRadius
        + LITTER_BRAWL_TUNING.swimmerContactLateralRadius * 0.75;
    racers[6].distance = soft.courseX;
    racers[6].lateral = soft.lateral + softGap;
    controller.update(0, GameState.RACING);
    assert.equal(soft.impactRevision, 1, '身体边缘碰到零食袋时也应带动袋子漂移');

    assert.equal(expandedEllipseContains(
        1.05, 0, 0, 0,
        0.42, 0.18,
        0.68, 0.4,
    ), true);
    assert.equal(expandedEllipseContains(
        1.11, 0, 0, 0,
        0.42, 0.18,
        0.68, 0.4,
    ), false, '扩张范围之外仍须保留明确空隙');
    assert.equal(segmentHitsExpandedEllipse(
        -1.3, 0, 1.3, 0,
        0, 0,
        0.42, 0.18,
        0.68, 0.4,
    ), true, '高速跨帧经过时不应穿透扩张后的接触区');
});

test('垃圾波次保留可通过的安全空隙，AI只获得横向绕行目标', () => {
    const { controller, racers } = fixture();
    racers[0].distance = LITTER_BRAWL_TUNING.waveDistances[0];
    controller.update(LITTER_BRAWL_TUNING.fallingSeconds, GameState.RACING);
    const landed = controller.clusters().filter(cluster => cluster.active && cluster.phase === 'floating');
    assert.equal(landed.length, 2);
    for (const cluster of landed) {
        assert.ok(Math.abs(cluster.lateral - cluster.safeCenter) > LITTER_BRAWL_TUNING.safeHalfWidth);
    }
    const obstacle = landed[0];
    racers[2].distance = Math.max(0, obstacle.courseX - 1);
    racers[2].lateral = obstacle.lateral;
    assert.equal(controller.targetZForAi(2), obstacle.safeCenter);
    racers[2].lateral = obstacle.safeCenter;
    assert.equal(controller.targetZForAi(2), null);
});

test('落水垃圾沿前后与横向自然漂移而不是原地小幅晃动', () => {
    const { controller, racers } = fixture(86);
    racers[0].distance = LITTER_BRAWL_TUNING.waveDistances[0];
    controller.update(LITTER_BRAWL_TUNING.fallingSeconds, GameState.RACING);
    const soft = controller.clusters().find(cluster => cluster.active && cluster.kind === 'soft');
    const path = [[soft.courseX, soft.lateral]];
    for (let index = 0; index < 12; index++) {
        controller.update(0.5, GameState.RACING);
        path.push([soft.courseX, soft.lateral]);
    }
    const courseValues = path.map(point => point[0]);
    const lateralValues = path.map(point => point[1]);
    assert.ok(Math.max(...courseValues) - Math.min(...courseValues) > 0.15, '应能看出沿赛道方向的水流漂移');
    assert.ok(Math.max(...lateralValues) - Math.min(...lateralValues) > 0.15, '应能看出横向水流漂移');
});

test('软垃圾首次穿入时被柔和带走，持续接触不逐帧叠加推力', () => {
    const pushedFixture = fixture(193);
    const controlFixture = fixture(193);
    pushedFixture.racers[0].distance = LITTER_BRAWL_TUNING.waveDistances[0];
    controlFixture.racers[0].distance = LITTER_BRAWL_TUNING.waveDistances[0];
    pushedFixture.controller.update(LITTER_BRAWL_TUNING.fallingSeconds, GameState.RACING);
    controlFixture.controller.update(LITTER_BRAWL_TUNING.fallingSeconds, GameState.RACING);
    const pushed = pushedFixture.controller.clusters().find(cluster => cluster.active && cluster.kind === 'soft');
    const control = controlFixture.controller.clusters().find(cluster => cluster.active && cluster.kind === 'soft');

    pushedFixture.racers[4].distance = pushed.courseX;
    pushedFixture.racers[4].lateral = pushed.lateral;
    pushedFixture.controller.update(1 / 60, GameState.RACING);
    controlFixture.controller.update(1 / 60, GameState.RACING);
    assert.equal(pushed.impactRevision, 1);
    assert.equal(pushedFixture.impacts.length, 0, '软垃圾不能触发硬碰撞回调');
    assert.ok(pushedFixture.controller.environmentDragForLane(4) > 0, '推开袋子时仍保留穿过减速');

    pushedFixture.controller.update(1 / 60, GameState.RACING);
    controlFixture.controller.update(1 / 60, GameState.RACING);
    assert.equal(pushed.impactRevision, 1, '持续处于同一袋身范围内不重复施加推力');
    pushedFixture.racers[4].lateral = pushed.lateral + 3;
    pushedFixture.controller.update(0.45, GameState.RACING);
    controlFixture.controller.update(0.45, GameState.RACING);
    assert.ok(Math.hypot(pushed.courseX - control.courseX, pushed.lateral - control.lateral) > 0.2,
        '受推零食袋应相对未接触对照组产生清晰位移');
});

test('十件垃圾各有独立槽位，新波次不覆盖仍可见旧垃圾，重置后布局一致', () => {
    const { controller, racers } = fixture(42);
    racers[0].distance = 200;
    controller.update(0, GameState.RACING);
    assert.equal(LITTER_BRAWL_TUNING.poolSize,
        LITTER_BRAWL_TUNING.waveDistances.length * LITTER_BRAWL_TUNING.waveCount);
    assert.equal(controller.clusters().length, LITTER_BRAWL_TUNING.poolSize);
    assert.equal(controller.clusters().filter(cluster => cluster.active).length, LITTER_BRAWL_TUNING.poolSize);
    assert.ok(controller.clusters().every(cluster => cluster.generation === 1), '同一批次不能覆盖复用仍活跃的槽位');
    const first = controller.clusters().map(cluster => [cluster.wave, cluster.courseX, cluster.lateral, cluster.safeCenter]);
    controller.reset();
    controller.update(0, GameState.RACING);
    const second = controller.clusters().map(cluster => [cluster.wave, cluster.courseX, cluster.lateral, cluster.safeCenter]);
    assert.deepEqual(second, first);
});

test('旧垃圾停止碰撞后留在原地附近缓慢下沉，完全沉没后才回收', () => {
    const { controller, racers } = fixture(314);
    racers[0].distance = LITTER_BRAWL_TUNING.waveDistances[0];
    controller.update(LITTER_BRAWL_TUNING.fallingSeconds, GameState.RACING);
    const soft = controller.clusters().find(cluster => cluster.active && cluster.kind === 'soft');
    const startCourseX = soft.courseX;
    const startLateral = soft.lateral;
    controller.update(
        LITTER_BRAWL_TUNING.floatingLifetime + LITTER_BRAWL_TUNING.retireSeconds * 0.5,
        GameState.RACING,
    );
    assert.equal(soft.phase, 'retiring');
    assert.equal(soft.active, true, '退场过程中仍应保持可见');
    assert.ok(Math.hypot(soft.courseX - startCourseX, soft.lateral - startLateral) < 0.15,
        '退场时只能在原位置附近轻微随水漂动，不能横穿泳池');
    racers[5].distance = soft.courseX;
    racers[5].lateral = soft.lateral;
    assert.equal(controller.environmentDragForLane(5), 0, '漂出赛道阶段不再影响比赛判定');
    controller.update(LITTER_BRAWL_TUNING.retireSeconds * 0.6, GameState.RACING);
    assert.equal(soft.active, false, '完全下沉后才回收对象');
});

test('实现不引入 Graphics 每帧重绘，也不将垃圾挂到角色节点', () => {
    const presentation = fs.readFileSync(path.join(root, 'assets/scripts/core/LitterBrawlPresentation.ts'), 'utf8');
    const geometry = fs.readFileSync(path.join(root, 'assets/scripts/core/LitterDebrisGeometry.ts'), 'utf8');
    const manager = fs.readFileSync(path.join(root, 'assets/scripts/core/GameManager.ts'), 'utf8');
    assert.doesNotMatch(presentation, /\bGraphics\b|\.clear\s*\(/);
    assert.match(presentation, /PRESENTATION_INTERVAL\s*=\s*1\s*\/\s*20/);
    assert.doesNotMatch(manager, /setParent\([^\n]*swimmer/i);
    assert.match(manager, /applyEnvironmentDrag/);
    assert.match(manager, /applyEnvironmentSpeedRetain/);
    const rigidHandler = manager.match(/private handleLitterRigidImpact[\s\S]*?private clearLitterInfluence/)?.[0] ?? '';
    assert.match(rigidHandler, /applyCollisionImpulse/);
    assert.doesNotMatch(rigidHandler, /applyEventKnockdown|beginEventKnockdown|eliminat/i);
    assert.match(geometry, /buildRigidLitterGeometry/);
    assert.match(geometry, /buildSoftLitterGeometry/);
    assert.match(geometry, /COLA_LABEL/);
    assert.match(geometry, /SNACK_ORANGE/);
    assert.doesNotMatch(geometry, /CARTON|handleOuter|ovalProfile/);
    assert.match(presentation, /this\.clock \* 24 \* rollDirection/);
    assert.match(presentation, /smoothstep\(retireProgress\) \* 0\.72/);
    assert.match(presentation, /SOFT_PUSH_PULSE_SECONDS/);
    assert.doesNotMatch(presentation, /retireFinish/);
    assert.doesNotMatch(presentation, /retireTargetLateral/);
});

test('阶段 I 正式启用七合一轮换但公开独立垃圾入口仍保持关闭', () => {
    const balance = fs.readFileSync(path.join(root, 'assets/scripts/core/GameBalance.ts'), 'utf8');
    const director = fs.readFileSync(path.join(root, 'assets/scripts/core/EntertainmentModeDirector.ts'), 'utf8');
    const manager = fs.readFileSync(path.join(root, 'assets/scripts/core/GameManager.ts'), 'utf8');
    const ai = fs.readFileSync(path.join(root, 'assets/scripts/entity/AISwimmerController.ts'), 'utf8');
    const room = fs.readFileSync(path.join(root, 'assets/scripts/ui/OnlineRoomView.ts'), 'utf8');
    const protocol = fs.readFileSync(path.join(root, 'assets/scripts/net/NetRaceProtocol.ts'), 'utf8');
    const input = fs.readFileSync(path.join(root, 'assets/scripts/net/NetRaceInput.ts'), 'utf8');
    const litterSnapshot = fs.readFileSync(path.join(root, 'assets/scripts/net/NetLitterSnapshot.ts'), 'utf8');
    assert.match(balance, /id:\s*'litter-brawl'[\s\S]*?publicEntry:\s*false/);
    assert.match(director, /EntertainmentEventId\.LITTER/);
    assert.match(director, /ENTERTAINMENT_LITTER_SELECTION_ENABLED\s*=\s*true/);
    assert.match(manager, /case EntertainmentEventId\.LITTER:[\s\S]*?setupLitterBrawl\(\)/);
    assert.match(manager, /currentWhirlpoolSpawns\(\)/);
    assert.match(manager, /_minefieldBrawl\?\.mines\(\)/);
    assert.match(manager, /spawnSwimmerClearAlongRadius/);
    assert.match(ai, /_litterTargetZ !== null\) desiredPriority = 3/);
    assert.match(ai, /_mineRelayTargetZ !== null\) desiredPriority = 4/);
    assert.match(manager, /setLitterStateListener/);
    assert.match(manager, /setLitterContactListener/);
    assert.match(input, /LitterContact\s*=\s*'g'/);
    assert.match(litterSnapshot, /const TAG = 'L\|'/);
    assert.doesNotMatch(room, /litter-brawl/);
    assert.match(protocol, /NET_RACE_PROTOCOL_VERSION\s*=\s*89/);
});
