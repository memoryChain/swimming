import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import GameConstants from '../assets/scripts/core/GameConstants.ts';
import LitterModule from '../assets/scripts/core/LitterBrawlController.ts';
import ContactGeometry from '../assets/scripts/core/RaceContactGeometry.ts';

const { GameState } = GameConstants;
const { LitterBrawlController, LITTER_BRAWL_TUNING } = LitterModule;
const { expandedEllipseContains, segmentHitsExpandedEllipse } = ContactGeometry;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture(seed = 20260919) {
    const racers = Array.from({ length: 8 }, (_, lane) => ({
        active: true,
        finished: false,
        distance: 0,
        lateral: -7 + lane * 2,
    }));
    const waves = [];
    const impacts = [];
    const controller = new LitterBrawlController(
        8, seed, 20, lane => racers[lane], wave => waves.push(wave), impact => impacts.push(impact),
    );
    return { controller, racers, waves, impacts };
}

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

test('第一阶段入口保持隐藏且不扩展六合一与联机协议', () => {
    const balance = fs.readFileSync(path.join(root, 'assets/scripts/core/GameBalance.ts'), 'utf8');
    const director = fs.readFileSync(path.join(root, 'assets/scripts/core/EntertainmentModeDirector.ts'), 'utf8');
    const room = fs.readFileSync(path.join(root, 'assets/scripts/ui/OnlineRoomView.ts'), 'utf8');
    const protocol = fs.readFileSync(path.join(root, 'assets/scripts/net/NetRaceProtocol.ts'), 'utf8');
    assert.match(balance, /id:\s*'litter-brawl'[\s\S]*?publicEntry:\s*false/);
    assert.doesNotMatch(director, /LITTER|litter-brawl/);
    assert.doesNotMatch(room, /litter-brawl/);
    assert.doesNotMatch(protocol, /Litter|litter/);
});
