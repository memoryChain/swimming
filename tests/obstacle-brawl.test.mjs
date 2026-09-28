import test from 'node:test';
import assert from 'node:assert/strict';

import Rules from '../assets/scripts/core/ObstacleBrawlRules.ts';
import Intensity from '../assets/scripts/core/EntertainmentIntensity.ts';
import Minefield from '../assets/scripts/core/MinefieldBrawlController.ts';
import Litter from '../assets/scripts/core/LitterBrawlController.ts';
import Obstacle from '../assets/scripts/core/ObstacleBrawlController.ts';
import Director from '../assets/scripts/core/EntertainmentModeDirector.ts';
import Constants from '../assets/scripts/core/GameConstants.ts';

const { buildObstaclePlan, buildObstacleSoloLitterSchedule, obstacleCourseX,
    OBSTACLE_SOLO_ANCHOR_DISTANCE, OBSTACLE_SOLO_LANDING_SEARCH_METERS } = Rules;
const { entertainmentIntensityProfile } = Intensity;
const { MinefieldBrawlController, MINEFIELD_TUNING } = Minefield;
const { LitterBrawlController, buildEntertainmentLitterSchedule,
    litterCorridorOverlapsObstacle, LITTER_BRAWL_TUNING } = Litter;
const { ObstacleBrawlController } = Obstacle;
const { buildEntertainmentEventOrder, EntertainmentEventId, EntertainmentModeDirector } = Director;
const { GameState } = Constants;

test('融合障碍三种布局有界、可复现，浮标漂动范围不侵入同一安全通路', () => {
    for (let level = 1; level <= 5; level++) {
        const profile = entertainmentIntensityProfile(level);
        for (let seed = 1; seed <= 100; seed++) {
            for (const layout of ['debris', 'buoy', 'mixed']) {
                const plan = buildObstaclePlan(seed, 20, 21, profile, layout);
                assert.deepEqual(plan, buildObstaclePlan(seed, 20, 21, profile, layout));
                assert.ok(plan.identity > 0);
                assert.equal(plan.layout, layout);
                assert.equal(plan.buoyAnchors.length,
                    layout === 'debris' ? 0 : layout === 'mixed' ? profile.obstacleMixedBuoyCount : profile.mineCount);
                assert.ok(plan.litterPoolSize <= 30);
                assert.ok(plan.litterWaves200 * plan.litterItemsPerWave <= plan.litterPoolSize);
                assert.ok(plan.litterWaves400 * plan.litterItemsPerWave <= plan.litterPoolSize);
                if (layout === 'debris') assert.equal(plan.buoyAnchors.length, 0);
                if (layout === 'buoy') assert.equal(plan.litterItemsPerWave, 0);
                if (layout === 'mixed') {
                    assert.ok(plan.litterItemsPerWave < profile.litterItemsPerWave);
                    assert.ok(plan.buoyAnchors.length < profile.mineCount);
                }
                for (const anchor of plan.buoyAnchors) {
                    const protectedHalfWidth = LITTER_BRAWL_TUNING.safeHalfWidth
                        + MINEFIELD_TUNING.driftLateralRadius
                        + MINEFIELD_TUNING.mineItemLateralRadius
                        + MINEFIELD_TUNING.swimmerContactLateralRadius
                        + LITTER_BRAWL_TUNING.spawnMineLateralMargin;
                    assert.ok(Math.abs(anchor.lateral - plan.safeCenter) >= protectedHalfWidth);
                    assert.ok(Math.abs(anchor.lateral) <= 21 / 2 - 0.9);
                }
            }
        }
    }
});

test('计划身份随种子、事件锚点和布局变化', () => {
    const profile = entertainmentIntensityProfile(3);
    const base = buildObstaclePlan(77, 24, 21, profile, 'mixed');
    assert.notEqual(base.identity, buildObstaclePlan(78, 24, 21, profile, 'mixed').identity);
    assert.notEqual(base.identity, buildObstaclePlan(77, 25, 21, profile, 'mixed').identity);
    assert.notEqual(base.identity, buildObstaclePlan(77, 24, 21, profile, 'buoy').identity);
});

test('独立障碍按强度把杂物铺满赛程，综合娱乐仍采用短窗口配额', () => {
    const profile = entertainmentIntensityProfile(5);
    const formal = buildObstaclePlan(77, 18, 21, profile, 'mixed');
    const solo = buildObstaclePlan(77, 18, 21, profile, 'mixed', 5);
    assert.equal(formal.litterWaves200, 3);
    assert.equal(formal.litterWaves400, 3);
    assert.equal(solo.litterWaves200, 6);
    assert.equal(solo.litterWaves400, 11);
    assert.notEqual(solo.identity, formal.identity);
    assert.equal(buildObstacleSoloLitterSchedule(400, 5).waveDistances.at(-1), 368);
    assert.equal(buildObstacleSoloLitterSchedule(200, 1).waveDistances.length, 2);
});

test('调试输入的每波件数超过槽位时，融合计划收敛为可完整执行的有效配置', () => {
    const profile = { ...entertainmentIntensityProfile(5),
        litterItemsPerWave: 15, litterPoolSize: 2,
        obstacleMixedLitterCount: 10, obstacleMixedPoolSize: 3 };
    for (const layout of ['debris', 'mixed']) {
        const plan = buildObstaclePlan(41, 20, 21, profile, layout);
        assert.ok(plan.litterPoolSize >= plan.litterItemsPerWave);
        assert.ok(plan.litterWaves200 >= 1);
        assert.ok(plan.litterWaves400 >= 1);
        assert.ok(plan.litterWaves400 * plan.litterItemsPerWave <= plan.litterPoolSize);
    }
});

test('独立混合障碍的首波等选手游到前方才触发，跳水滑行位置不会取消杂物', () => {
    assert.equal(OBSTACLE_SOLO_ANCHOR_DISTANCE, LITTER_BRAWL_TUNING.waveDistances[0]);
    const profile = entertainmentIntensityProfile(5);
    const racers = Array.from({ length: 8 }, () =>
        ({ active: true, finished: false, distance: 7, lateral: 0 }));
    const safety = (x) => racers.every(racer => Math.abs(racer.distance - x)
        > LITTER_BRAWL_TUNING.spawnSwimmerClearAlongRadius
            + LITTER_BRAWL_TUNING.rigidItemAlongRadius
            + LITTER_BRAWL_TUNING.swimmerContactAlongRadius);
    const make = anchor => {
        const plan = buildObstaclePlan(20260913, anchor, 21, profile, 'mixed');
        return new LitterBrawlController(8, 20260913, 21, lane => racers[lane],
            undefined, undefined, buildEntertainmentLitterSchedule(anchor, 200, plan.litterWaves200),
            safety, undefined,
            { itemsPerWave: plan.litterItemsPerWave, poolSize: plan.litterPoolSize },
            () => plan.safeCenter,
            (x, z) => plan.buoyAnchors.every(buoy =>
                Math.abs(buoy.courseX - x) >= 2.5 || Math.abs(buoy.lateral - z) >= 2.1),
            2.2);
    };
    const previous = make(0);
    const shifted = make(OBSTACLE_SOLO_ANCHOR_DISTANCE);
    for (let tick = 0; tick < 40; tick++) {
        previous.update(.1, GameState.RACING, true);
        shifted.update(.1, GameState.RACING, true);
    }
    assert.ok(previous.cancelledCount() >= 1);
    assert.equal(shifted.cancelledCount(), 0);
    assert.equal(shifted.spawnedItemCount(), 0);
    racers[0].distance = OBSTACLE_SOLO_ANCHOR_DISTANCE;
    shifted.update(.1, GameState.RACING, true);
    assert.equal(shifted.spawnedItemCount(), profile.obstacleMixedLitterCount);
    previous.dispose(); shifted.dispose();
});

test('难度五独立混合障碍按全赛程分波，池复用并保持出生安全', () => {
    for (const raceDistance of [200, 400]) {
        const profile = entertainmentIntensityProfile(5);
        const plan = buildObstaclePlan(20260913, OBSTACLE_SOLO_ANCHOR_DISTANCE, 21, profile, 'mixed', 5);
        const schedule = buildObstacleSoloLitterSchedule(raceDistance, 5);
        assert.equal(plan.litterWaves200, 6);
        if (raceDistance === 200) assert.deepEqual(schedule.waveDistances, [18, 55, 78, 108, 138, 168]);
        const racers = Array.from({ length: 8 }, (_, lane) =>
            ({ active: true, finished: false, distance: 7 - lane * .35, lateral: 0 }));
        const buoys = new MinefieldBrawlController(8, 20260913, 21,
            lane => racers[lane], () => {}, plan.buoyAnchors.length, null, [], plan.buoyAnchors);
        const waveTimes = [];
        let simTime = 0;
        const debris = new LitterBrawlController(8, 20260913, 21, lane => racers[lane],
            () => waveTimes.push(simTime), undefined,
            schedule,
            (x, safeCenter, halfWidth) => {
                const swimmerClearance = LITTER_BRAWL_TUNING.spawnSwimmerClearAlongRadius
                    + LITTER_BRAWL_TUNING.rigidItemAlongRadius
                    + LITTER_BRAWL_TUNING.swimmerContactAlongRadius;
                if (racers.some(racer => Math.abs(obstacleCourseX(racer.distance) - x) <= swimmerClearance)) return false;
                return buoys.mines().every(mine => !mine.active
                    || !litterCorridorOverlapsObstacle(x, safeCenter, halfWidth,
                        mine.courseX, mine.lateral,
                        MINEFIELD_TUNING.mineItemAlongRadius
                            + MINEFIELD_TUNING.swimmerContactAlongRadius
                            + LITTER_BRAWL_TUNING.spawnMineAlongMargin,
                        MINEFIELD_TUNING.mineItemLateralRadius
                            + MINEFIELD_TUNING.swimmerContactLateralRadius
                            + LITTER_BRAWL_TUNING.spawnMineLateralMargin));
            }, undefined, { itemsPerWave: plan.litterItemsPerWave, poolSize: plan.litterPoolSize },
            () => plan.safeCenter,
            (x, z) => plan.buoyAnchors.every(buoy =>
                Math.abs(buoy.courseX - x) >= 2.5 || Math.abs(buoy.lateral - z) >= 2.1),
            2.2, OBSTACLE_SOLO_LANDING_SEARCH_METERS);
        for (let tick = 0; tick < (raceDistance === 200 ? 550 : 1150); tick++) {
            simTime += .1;
            for (let lane = 0; lane < racers.length; lane++) racers[lane].distance += (3.4 - lane * .08) * .1;
            buoys.update(.1, GameState.RACING, true);
            debris.update(.1, GameState.RACING, true);
        }
        const plannedWaves = raceDistance === 200 ? plan.litterWaves200 : plan.litterWaves400;
        const minExpectedWaves = raceDistance === 200 ? plannedWaves : plannedWaves - 1;
        assert.ok(debris.spawnedItemCount() >= minExpectedWaves * plan.litterItemsPerWave,
            JSON.stringify({ raceDistance, waveTimes, cancelled: debris.cancelledCount(), nextWave: debris.snapshotState().nextWave }));
        assert.ok(waveTimes.length >= minExpectedWaves);
        assert.ok(waveTimes.at(-1) > (raceDistance === 200 ? 40 : 95), '最后一波必须进入赛程后段');
        for (let wave = 1; wave < waveTimes.length; wave++) {
            assert.ok(waveTimes[wave] - waveTimes[wave - 1] >= 2.19);
        }
        assert.ok(debris.cancelledCount() <= (raceDistance === 200 ? 0 : 1));
        assert.ok(debris.activeCount() <= plan.litterPoolSize);
        debris.dispose(); buoys.reset();
    }
});

test('融合障碍五档在无外部阻挡时能按容量投完，浮标自然漂动不拦截自己的安全通路', () => {
    const racers = [{ active: true, finished: false, distance: 100, lateral: 0 }];
    for (const raceDistance of [200, 400]) {
        for (let level = 1; level <= 5; level++) {
            const profile = entertainmentIntensityProfile(level);
            for (let seed = 1; seed <= 40; seed++) {
                for (const layout of ['debris', 'mixed']) {
                    const plan = buildObstaclePlan(seed, 20, 21, profile, layout);
                    const waveCount = raceDistance === 200 ? plan.litterWaves200 : plan.litterWaves400;
                    const schedule = buildEntertainmentLitterSchedule(20, raceDistance, waveCount);
                    const buoys = new MinefieldBrawlController(1, seed, 21,
                        () => racers[0], () => {}, plan.buoyAnchors.length, null, [], plan.buoyAnchors);
                    const debris = new LitterBrawlController(1, seed, 21, () => racers[0],
                        undefined, undefined, schedule,
                        (x, safeCenter, halfWidth) => buoys.mines().every(mine =>
                            !mine.active || !litterCorridorOverlapsObstacle(x, safeCenter, halfWidth,
                                mine.courseX, mine.lateral,
                                MINEFIELD_TUNING.mineItemAlongRadius
                                    + MINEFIELD_TUNING.swimmerContactAlongRadius
                                    + LITTER_BRAWL_TUNING.spawnMineAlongMargin,
                                MINEFIELD_TUNING.mineItemLateralRadius
                                    + MINEFIELD_TUNING.swimmerContactLateralRadius
                                    + LITTER_BRAWL_TUNING.spawnMineLateralMargin)),
                        undefined, { itemsPerWave: plan.litterItemsPerWave, poolSize: plan.litterPoolSize },
                        () => plan.safeCenter,
                        (x, z) => plan.buoyAnchors.every(anchor =>
                            Math.abs(anchor.courseX - x) >= 2.5 || Math.abs(anchor.lateral - z) >= 2.1),
                        2.2);
                    for (let tick = 0; tick < 75; tick++) {
                        buoys.update(.1, GameState.RACING, true);
                        debris.update(.1, GameState.RACING, true);
                    }
                    assert.equal(debris.spawnedItemCount(), waveCount * plan.litterItemsPerWave,
                        `seed=${seed}, level=${level}, distance=${raceDistance}, layout=${layout}`);
                    assert.equal(debris.cancelledCount(), 0);
                    debris.dispose(); buoys.reset();
                }
            }
        }
    }
});

test('障碍截止只撤销尚未安全上浮的浮标，客机等待权威快照', () => {
    const plan = buildObstaclePlan(31, 20, 21, entertainmentIntensityProfile(3), 'buoy');
    const racers = Array.from({ length: 8 }, () => ({ active: false, finished: false, distance: 0, lateral: 0 }));
    racers[0] = { active: true, finished: false,
        distance: plan.buoyAnchors[0].courseX, lateral: plan.buoyAnchors[0].lateral };
    const buoys = new MinefieldBrawlController(8, 31, 21, lane => racers[lane], () => {},
        plan.buoyAnchors.length, null, [], plan.buoyAnchors);
    assert.equal(buoys.mines()[0].armed, false);
    assert.ok(buoys.mines().slice(1).some(mine => mine.armed));
    const obstacle = new ObstacleBrawlController(plan, 21, buoys, null);
    obstacle.stopSpawning(false);
    assert.equal(buoys.mines()[0].active, true);
    obstacle.stopSpawning(true);
    assert.equal(buoys.mines()[0].active, false);
    assert.ok(buoys.mines().slice(1).some(mine => mine.active));
});

test('高速跨多个锚点时融合杂物按间隔投放，旧独立规则仍可同帧补齐', () => {
    const racers = [{ active: true, finished: false, distance: 90, lateral: 0 }];
    const schedule = { waveDistances: [0, 1, 2], landingLeadDistance: 7 };
    const create = interval => new LitterBrawlController(1, 7, 21, () => racers[0],
        undefined, undefined, schedule, undefined, undefined,
        { itemsPerWave: 2, poolSize: 6 }, () => 0, undefined, interval);
    const merged = create(2.2);
    const legacy = create(0);
    merged.update(.1, GameState.RACING, true);
    legacy.update(.1, GameState.RACING, true);
    assert.equal(merged.spawnedItemCount(), 2);
    assert.equal(legacy.spawnedItemCount(), 6);
    const guest = create(2.2);
    assert.equal(guest.applySnapshotState(merged.snapshotState()).applied, true);
    for (let i = 0; i < 20; i++) merged.update(.1, GameState.RACING, true);
    assert.equal(merged.spawnedItemCount(), 2);
    merged.update(.3, GameState.RACING, true);
    assert.equal(merged.spawnedItemCount(), 4);
    assert.equal(guest.applySnapshotState(merged.snapshotState()).applied, true);
    assert.equal(guest.spawnedItemCount(), 4);
    merged.dispose(); legacy.dispose(); guest.dispose();
});

test('混合布局沿同一通路投放，浮标权威状态恢复后不会复活已触发物件', () => {
    const profile = entertainmentIntensityProfile(3);
    const plan = buildObstaclePlan(314159, 20, 21, profile, 'mixed');
    const racers = Array.from({ length: 8 }, () => ({ active: false, finished: false, distance: 0, lateral: 0 }));
    const createBuoys = () => new MinefieldBrawlController(8, 314159, 21,
        lane => racers[lane], () => {}, plan.buoyAnchors.length, null, [], plan.buoyAnchors);
    const hostBuoys = createBuoys();
    hostBuoys.update(0.1, GameState.RACING, true);
    const guestBuoys = createBuoys();
    assert.equal(guestBuoys.applySnapshotState(hostBuoys.snapshotState()), true);
    assert.deepEqual(guestBuoys.mines(), hostBuoys.mines());

    const litter = new LitterBrawlController(8, 314159, 21, lane => racers[lane],
        undefined, undefined, buildEntertainmentLitterSchedule(20, 200, 2),
        undefined, undefined,
        { itemsPerWave: plan.litterItemsPerWave, poolSize: plan.litterPoolSize },
        () => plan.safeCenter,
        (x, z) => plan.buoyAnchors.every(anchor =>
            Math.abs(anchor.courseX - x) >= 2.5 || Math.abs(anchor.lateral - z) >= 2.1));
    racers[0].active = true;
    racers[0].distance = 20;
    litter.update(0.1, GameState.RACING, true);
    assert.equal(litter.spawnedItemCount(), plan.litterItemsPerWave);
    for (const item of litter.clusters()) {
        if (!item.active) continue;
        assert.equal(item.safeCenter, plan.safeCenter);
        assert.ok(Math.abs(item.anchorLateral - plan.safeCenter) >= LITTER_BRAWL_TUNING.safeHalfWidth);
    }
    const obstacle = new ObstacleBrawlController(plan, 21, hostBuoys, litter);
    obstacle.stopSpawning();
    assert.equal(litter.pendingWaveCount(), 0);
    assert.equal(litter.activeCount(), plan.litterItemsPerWave);

    const mine = hostBuoys.mines()[0];
    const impact = { mineId: mine.id, hitLane: 0, courseX: mine.courseX,
        lateral: mine.lateral, hitMask: 1, revision: hostBuoys.snapshotState().revision + 1 };
    assert.equal(hostBuoys.applyImpact(impact), true);
    assert.equal(hostBuoys.applyImpact(impact), false);
    assert.equal(guestBuoys.applySnapshotState(hostBuoys.snapshotState()), true);
    assert.equal(guestBuoys.mines()[0].active, false);
});

test('统一避障会同时衡量前方浮标与杂物，返程仍按前方判定', () => {
    const plan = buildObstaclePlan(9, 20, 21, entertainmentIntensityProfile(3), 'mixed');
    const buoys = { mines: () => [{ active: true, armed: true, courseX: 25, lateral: 0 }] };
    const debris = { clusters: () => [{ active: true, phase: 'floating', kind: 'rigid', courseX: 25,
        lateral: -3 }] };
    const obstacle = new ObstacleBrawlController(plan, 21, buoys, debris);
    const approaching = { active: true, finished: false, distance: 22, lateral: 0 };
    const target = obstacle.targetZForRacer(approaching);
    assert.ok(target > 2, `应从没有杂物的一侧绕过浮标，实际目标 ${target}`);
    assert.equal(obstacle.urgentTarget(), true);
    assert.equal(obstacle.targetZForRacer({ ...approaching, distance: 32 }), null);
    buoys.mines = () => [{ active: true, armed: true, courseX: 43, lateral: 0 }];
    debris.clusters = () => [];
    assert.notEqual(obstacle.targetZForRacer({ ...approaching, distance: 55 }), null);
    assert.equal(obstacle.targetZForRacer({ ...approaching, active: false }), null);
});

test('融合 AI 选路在不同渲染帧率下约十赫兹采样，停帧不会补跑历史计算', () => {
    const plan = buildObstaclePlan(9, 20, 21, entertainmentIntensityProfile(3), 'mixed');
    for (const hz of [30, 60, 120]) {
        const obstacle = new ObstacleBrawlController(plan, 21, null, null);
        let samples = 0;
        for (let frame = 0; frame < hz; frame++) if (obstacle.shouldSampleAi(1 / hz)) samples++;
        assert.ok(samples >= 10 && samples <= 11, `${hz}Hz 采样 ${samples} 次`);
        assert.equal(obstacle.shouldSampleAi(0), false);
    }
    const stalled = new ObstacleBrawlController(plan, 21, null, null);
    assert.equal(stalled.shouldSampleAi(0.5), true);
    assert.equal(stalled.shouldSampleAi(0), true);
    assert.equal(stalled.shouldSampleAi(0), false);
});

test('正式娱乐只抽取一个障碍事件，200与400米抽取数量和三类保底保持', () => {
    const counts200 = new Set();
    const counts400 = new Set();
    for (let seed = 0; seed < 200; seed++) for (const distance of [200, 400]) {
        const order = buildEntertainmentEventOrder(seed, distance);
        (distance === 200 ? counts200 : counts400).add(order.length);
        assert.equal(order.includes(EntertainmentEventId.LITTER), false);
        assert.equal(new Set(order).size, order.length);
        assert.ok(order.some(id => id === EntertainmentEventId.OBSTACLE
            || id === EntertainmentEventId.WHIRLPOOL || id === EntertainmentEventId.GEYSER));
        assert.ok(order.some(id => id === EntertainmentEventId.STIMULANT || id === EntertainmentEventId.TIMED_BOMB
            || id === EntertainmentEventId.TURTLE_BUS));
        assert.ok(order.some(id => id === EntertainmentEventId.SHARK || id === EntertainmentEventId.CANNON));
        assert.notEqual(order.at(-1), EntertainmentEventId.OBSTACLE);
        assert.notEqual(order.at(-1), EntertainmentEventId.GEYSER);
        const host = new EntertainmentModeDirector(seed, distance);
        const guest = new EntertainmentModeDirector(seed + 1, distance);
        assert.equal(guest.applySnapshot(host.snapshot()).snapshotAccepted, true);
        assert.deepEqual(guest.selectedEvents(), order);
    }
    assert.deepEqual([...counts200].sort(), [3, 4]);
    assert.deepEqual([...counts400].sort(), [5, 6]);
});
