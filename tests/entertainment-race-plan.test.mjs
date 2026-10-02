import test from 'node:test';
import assert from 'node:assert/strict';
import PlanModule from '../assets/scripts/core/EntertainmentRacePlan.ts';
import DirectorModule from '../assets/scripts/core/EntertainmentModeDirector.ts';
import SupplyModule from '../assets/scripts/core/StimulantBrawlRules.ts';
import MineModule from '../assets/scripts/core/MinefieldBrawlController.ts';
import ConstantsModule from '../assets/scripts/core/GameConstants.ts';
import LitterModule from '../assets/scripts/core/LitterBrawlController.ts';
import ObstacleModule from '../assets/scripts/core/ObstacleBrawlRules.ts';
import IntensityModule from '../assets/scripts/core/EntertainmentIntensity.ts';

const { buildEntertainmentRacePlan, normalizeEntertainmentRaceGrade, entertainmentScheduleSpeed } = PlanModule;
const { EntertainmentEventId: E, EntertainmentModeDirector } = DirectorModule;
const { buildGradedStimulantSchedule, avoidGradedSupplyBuoys } = SupplyModule;
const { MinefieldBrawlController } = MineModule;
const { GameState } = ConstantsModule;
const { LitterBrawlController, LITTER_BRAWL_TUNING } = LitterModule;
const { buildObstaclePlan } = ObstacleModule;
const { entertainmentIntensityProfile } = IntensityModule;

test('班车预检使用余量静默等候，失约在公开前换低档漩涡并可跨端恢复', () => {
    let seed = 1;
    while (buildEntertainmentRacePlan(seed, 200, 2).stages[0].event !== E.TURTLE_BUS) seed++;
    for (const grade of [1, 2]) {
        const plan = buildEntertainmentRacePlan(seed, 200, grade);
        let probes = 0;
        const host = new EntertainmentModeDirector(seed, 200, true, undefined, undefined, undefined,
            plan, () => { probes++; return 0; });
        const waiting = host.update(4, 40, true, 2.5);
        assert.equal(waiting.previewEvent, null);
        assert.equal(waiting.activatedEvent, null);
        host.update(.1, 41, true, 2.5);
        assert.equal(probes, 1);
        const next = host.update(1, 150, true, 2.5);
        assert.equal(next.previewEvent, grade === 1 ? null : E.WHIRLPOOL);
        assert.equal(next.activatedEvent, null);
        const guest = new EntertainmentModeDirector(seed, 200, true, undefined, undefined, undefined, plan);
        assert.equal(guest.applySnapshot(host.snapshot()).snapshotAccepted, true);
        assert.deepEqual(guest.selectedEvents(), host.selectedEvents());
        if (grade === 2) {
            assert.equal(host.update(6, 152, true, 2.5).activatedEvent, E.WHIRLPOOL);
            assert.equal(host.secondsRemaining(), 8);
            assert.equal(guest.applySnapshot(host.snapshot()).snapshotAccepted, true);
            assert.equal(guest.currentEvent(), E.WHIRLPOOL);
        } else assert.equal(host.stageSkipReason(0), 'no-boarding-window');
        host.reset();
        assert.equal(host.selectedEvents()[0], E.TURTLE_BUS);
    }
});

test('已确认海龟航段立即交给自身预告，导演按真实航次结束并保留后段', () => {
    const plan = buildEntertainmentRacePlan(5, 200, 5);
    assert.equal(plan.stages[0].event, E.TURTLE_BUS);
    const host = new EntertainmentModeDirector(5, 200, true, undefined, undefined, undefined, plan, () => 24);
    const start = host.update(4, 30, true, 2.5);
    assert.equal(start.activatedEvent, E.TURTLE_BUS);
    assert.equal(start.previewEvent, null);
    assert.equal(host.secondsRemaining(), 24);
    assert.equal(host.update(24, 90, false, 2.5).finishedEvent, null);
    assert.equal(host.update(.25, 91, true, 2.5).finishedEvent, E.TURTLE_BUS);
    assert.equal(host.update(5, 110, true, 2.5).previewEvent, E.SHARK);
});

test('各档主事件在标准短长局完整启动，短暂提速不触发永久跳段', () => {
    for (const distance of [200, 400]) for (let grade = 1; grade <= 5; grade++) {
        for (let seed = 1; seed <= 100; seed++) {
            const plan = buildEntertainmentRacePlan(seed, distance, grade);
            const director = new EntertainmentModeDirector(seed, distance, true, undefined, undefined, undefined, plan);
            const completed = new Set();
            let progress = 0;
            for (let frame = 1; progress < distance; frame++) {
                const time = frame / 30;
                progress += (time >= 12 && time < 13 ? 5 : 2.5) / 30;
                if (progress >= distance) break;
                const before = director.snapshot().eventIndex;
                const result = director.update(1 / 30, progress, true, entertainmentScheduleSpeed(progress, time));
                if (result.finishedEvent !== null && before < plan.stages.length) completed.add(before);
            }
            for (const [index, stage] of plan.stages.entries()) {
                if (stage.required) assert.ok(completed.has(index), `${distance}:${grade}:${seed}:${index}`);
            }
            if (grade !== 4) {
                assert.equal(completed.size, plan.stages.length, `${distance}:${grade}:${seed}`);
                assert.equal(director.skippedStageMask(), 0);
            }
        }
    }
});

test('短局巨浪和鲨鱼都兑现，接管延续主段且不截断已启动事件', () => {
    const plan = buildEntertainmentRacePlan(6, 200, 5);
    const host = new EntertainmentModeDirector(6, 200, true, undefined, undefined, undefined, plan);
    let guest;
    for (let frame = 1; frame < 80 * 30; frame++) {
        const distance = frame / 30 * 2.5;
        const result = host.update(1 / 30, distance, true, 2.5);
        if (!guest && result.activatedEvent === E.GIANT_WAVE) {
            guest = new EntertainmentModeDirector(6, 200, true, undefined, undefined, undefined, plan);
            assert.equal(guest.applySnapshot(host.snapshot()).snapshotAccepted, true);
            assert.equal(guest.skippedStageMask(), host.skippedStageMask());
        } else if (guest) {
            const remote = guest.update(1 / 30, distance, true, 2.5);
            assert.equal(remote.activatedEvent, result.activatedEvent);
            assert.equal(guest.snapshot().eventIndex, host.snapshot().eventIndex);
        }
    }
    assert.ok(guest);
    assert.ok(host.snapshot().activatedMask & (1 << E.GIANT_WAVE));
    assert.ok(host.snapshot().activatedMask & (1 << E.SHARK));
    const director = new EntertainmentModeDirector(6, 200, true, undefined, undefined, undefined, plan);
    director.update(4, 60, true, 2.5);
    director.update(6, 75, true, 2.5);
    assert.equal(director.currentEvent(), E.GIANT_WAVE);
    assert.equal(director.update(30, 150, false, 8).finishedEvent, null);
    assert.equal(director.currentEvent(), E.GIANT_WAVE);
    const late = new EntertainmentModeDirector(6, 200, true, undefined, undefined, undefined, plan);
    late.update(4, 150, true, 8);
    assert.notEqual(late.skippedStageMask(), 0);
    assert.equal(guest.applySnapshot({ ...late.snapshot(), revision: 999 }).snapshotAccepted, true);
    assert.equal(guest.skippedStageMask(), late.skippedStageMask());
    assert.equal(guest.update(30, 190, true, 8).activatedEvent, null);
});

test('浮标过期批次、尾段取消经快照恢复后不会再补投且保留已启用浮标', () => {
    const create = () => new MinefieldBrawlController(1, 71, 18,
        () => ({ active: false, finished: false, distance: 0, lateral: 0 }), () => {},
        3, null, [20, 80, 140], [
            { courseX: 10, lateral: -5 }, { courseX: 20, lateral: -5 }, { courseX: 30, lateral: -5 },
        ], [1, 1, 1]);
    const host = create();
    host.update(.1, GameState.RACING, true, 60, false, 10);
    assert.equal(host.snapshotState().waveIndex, 1);
    host.update(.1, GameState.RACING, true, 80, true, 10);
    assert.deepEqual(host.mines().map(mine => mine.active), [false, true, false]);
    for (let frame = 0; frame < 20; frame++) host.update(.1, GameState.RACING, true, 80, true, 10);
    assert.equal(host.mines()[1].armed, true);
    host.cancelUnarmedMines();
    const guest = create();
    assert.equal(guest.applySnapshotState(host.snapshotState()), true);
    guest.update(.1, GameState.RACING, true, 150, true, 10);
    assert.deepEqual(guest.mines().map(mine => mine.active), [false, true, false]);
});

test('短局场地优先，长局场地只穿插前中段，强挑战保留进度门槛', () => {
    for (const distance of [200, 400]) for (let grade = 2; grade <= 5; grade++) {
        const positions = new Map([E.TURTLE_BUS, E.WHIRLPOOL, E.GEYSER, E.GIANT_WAVE].map(event => [event, new Set()]));
        const schedules = new Set();
        for (let seed = 1; seed <= 1000; seed++) {
            const plan = buildEntertainmentRacePlan(seed, distance, grade);
            const baseline = plan.stages.filter(stage => stage.previewProgress > 0);
            const count = grade === 2 ? 1 : distance === 400 ? 3 : 2;
            assert.equal(baseline.length, count);
            for (const [index, stage] of baseline.entries()) {
                positions.get(stage.event)?.add(index);
                if (stage.event === E.CANNON) assert.ok(stage.previewProgress >= .28);
                if (stage.event === E.SHARK) assert.ok(stage.previewProgress >= .48);
                assert.ok(stage.previewProgress <= .67);
            }
            schedules.add(plan.stages.map(s => `${s.event}:${s.previewProgress.toFixed(3)}`).join(','));
        }
        for (const slots of positions.values()) assert.equal(slots.size, grade === 2 || distance === 200 ? 1 : 2);
        assert.ok(schedules.size > 200);
    }
});

test('环境池按两成海龟、三成漩涡、各四分之一喷泉和巨浪抽取，低档不越级', () => {
    for (const distance of [200, 400]) {
        const counts = new Map();
        for (let seed = 1; seed <= 2000; seed++) {
            for (let grade = 1; grade <= 5; grade++) {
                const plan = buildEntertainmentRacePlan(seed, distance, grade);
                const opening = plan.stages.find(stage => stage.previewProgress > 0
                    && [E.TURTLE_BUS, E.WHIRLPOOL, E.GEYSER, E.GIANT_WAVE].includes(stage.event));
                if (grade === 1) {
                    assert.ok(plan.stages.length <= 1);
                    assert.ok(!opening || opening.event === E.TURTLE_BUS);
                } else {
                    if (grade === 2) counts.set(opening.event, (counts.get(opening.event) ?? 0) + 1);
                    if (opening.event === E.GEYSER || opening.event === E.GIANT_WAVE) {
                        assert.equal(opening.intensity, Math.max(1, grade - (plan.stages.filter(s => s.previewProgress > 0).indexOf(opening) === 0 ? 2 : 1)));
                    }
                    assert.equal(plan.stages.filter(stage => stage.event === E.GIANT_WAVE).length <= 1, true);
                }
                if (opening?.event === E.TURTLE_BUS) assert.equal(opening.intensity, 1);
            }
        }
        for (const [event, expected] of [[E.TURTLE_BUS, .2], [E.WHIRLPOOL, .3], [E.GEYSER, .25], [E.GIANT_WAVE, .25]]) {
            assert.ok(Math.abs(counts.get(event) / 2000 - expected) < .035, `${distance}:${event}`);
        }
    }
});

test('各档海龟失约静默跳过，首位完赛取消后续排期，快照不能偷换成漩涡', () => {
    let seed = 1;
    while (buildEntertainmentRacePlan(seed, 200, 1).stages.length === 0) seed++;
    for (const distance of [200, 400]) for (let grade = 1; grade <= 5; grade++) {
        while (buildEntertainmentRacePlan(seed, distance, grade).stages[0]?.event !== E.TURTLE_BUS) seed++;
        const plan = buildEntertainmentRacePlan(seed, distance, grade);
        const host = new EntertainmentModeDirector(seed, distance, true, undefined, undefined, undefined, plan);
        host.update(4, distance * plan.stages[0].previewProgress);
        host.update(6, distance * plan.stages[0].previewProgress);
        assert.equal(host.currentEvent(), E.TURTLE_BUS);
        const skip = host.replaceUnavailableTurtle();
        assert.equal(skip.finishedEvent, E.TURTLE_BUS);
        assert.equal(skip.activatedEvent, null);
        assert.equal(host.snapshot().activatedMask & (1 << E.WHIRLPOOL), 0);
        const guest = new EntertainmentModeDirector(seed, distance, true, undefined, undefined, undefined, plan);
        assert.equal(guest.applySnapshot(host.snapshot()).snapshotAccepted, true);
        host.lockAfterFirstFinish();
        assert.equal(host.update(200, distance).activatedEvent, null);
    }
});

test('整局五档在两种距离及三种布局下遵守配额、白名单与容量', () => {
    const supplyTotals = [[6, 12], [9, 16], [12, 20], [16, 24], [20, 30]];
    const environment = [E.WHIRLPOOL, E.TURTLE_BUS, E.GEYSER, E.GIANT_WAVE];
    const allowed = [[E.TURTLE_BUS], environment, [...environment, E.TIMED_BOMB],
        [...environment, E.TIMED_BOMB, E.CANNON], [...environment, E.TIMED_BOMB, E.CANNON, E.SHARK]];
    for (let grade = 1; grade <= 5; grade++) {
        assert.equal(normalizeEntertainmentRaceGrade(grade), grade);
        for (const distance of [200, 400]) for (const layout of ['debris', 'buoy', 'mixed']) {
            for (let seed = 1; seed <= 100; seed++) {
                const plan = buildEntertainmentRacePlan(seed, distance, grade, layout);
                assert.deepEqual(plan, buildEntertainmentRacePlan(seed, distance, grade, layout));
                assert.equal(plan.supply.waveDistances.length * plan.supply.itemsPerWave,
                    supplyTotals[grade - 1][distance === 400 ? 1 : 0]);
                assert.equal(plan.obstacle.layout, layout);
                assert.ok(plan.obstacle.litterWaveCounts.every(count => count <= plan.obstacle.litterPoolSize));
                assert.ok(plan.obstacle.litterPoolSize <= 24);
                assert.ok(plan.obstacle.buoyBatchCounts.reduce((a, b) => a + b, 0) <= 8);
                assert.ok(plan.stages.every(stage => allowed[grade - 1].includes(stage.event)));
                const anchored = plan.stages.filter(stage => stage.previewProgress > 0);
                assert.ok(anchored.every((stage, index) => index === 0
                    || stage.previewProgress > anchored[index - 1].previewProgress));
                assert.ok(plan.stages.length <= 6);
                assert.ok(plan.supply.waveDistances.every((d, index) => index === 0
                    || d > plan.supply.waveDistances[index - 1]));
                assert.ok(plan.obstacle.litterWaveDistances.every((d, index) => index === 0
                    || d > plan.obstacle.litterWaveDistances[index - 1]));
                if (grade > 1) assert.ok(plan.stages.some(stage => stage.required));
            }
        }
    }
    assert.equal(normalizeEntertainmentRaceGrade(0), null);
    assert.equal(normalizeEntertainmentRaceGrade(6), null);
    const base = buildEntertainmentRacePlan(123, 200, 3, 'mixed').identity;
    assert.notEqual(base, buildEntertainmentRacePlan(124, 200, 3, 'mixed').identity);
    assert.notEqual(base, buildEntertainmentRacePlan(123, 400, 3, 'mixed').identity);
    assert.notEqual(base, buildEntertainmentRacePlan(123, 200, 4, 'mixed').identity);
    assert.notEqual(base, buildEntertainmentRacePlan(123, 200, 3, 'buoy').identity);
});

test('最高档完整障碍配额、首波减量及双炮只作用于长局', () => {
    const short = buildEntertainmentRacePlan(17, 200, 5, 'mixed');
    const long = buildEntertainmentRacePlan(17, 400, 5, 'debris');
    assert.deepEqual(short.obstacle.litterWaveCounts, [4, 7, 7, 7, 7]);
    assert.equal(short.obstacle.litterWaveCounts.reduce((a, b) => a + b, 0), 32);
    assert.equal(long.obstacle.litterWaveCounts.reduce((a, b) => a + b, 0), 75);
    assert.equal(short.stages.find(stage => stage.event === E.CANNON), undefined);
    assert.equal(long.stages.find(stage => stage.event === E.CANNON).actionCount, 6);
    assert.equal(long.stages.find(stage => stage.event === E.CANNON).intensity, 4);
    assert.ok(short.stages.some(stage => stage.event === E.SHARK && stage.previewProgress >= .48));
    assert.ok(long.stages.some(stage => stage.event === E.SHARK && stage.previewProgress >= .48));
});

test('全场补给经过实体泳池去重后仍保留每档配额', () => {
    for (let grade = 1; grade <= 5; grade++) for (const distance of [200, 400]) {
        for (let seed = 1; seed <= 100; seed++) {
            const plan = buildEntertainmentRacePlan(seed, distance, grade);
            const schedule = buildGradedStimulantSchedule(seed, 8, distance, 50,
                plan.supply.waveDistances, plan.supply.itemsPerWave);
            assert.equal(schedule.length,
                plan.supply.waveDistances.length * plan.supply.itemsPerWave,
                `seed=${seed} distance=${distance} grade=${grade}`);
        }
    }
});

test('导演按五档主挑战运行，一级没有主事件，重复水球保留独立窗口', () => {
    let seed = 1;
    while (buildEntertainmentRacePlan(seed, 200, 1).stages.length) seed++;
    const easyPlan = buildEntertainmentRacePlan(seed, 200, 1, 'debris');
    const easy = new EntertainmentModeDirector(seed, 200, true, undefined, undefined, undefined, easyPlan);
    assert.equal(easy.selectedEvents().length, 0);
    assert.equal(easy.update(30, 180).previewEvent, null);
    for (let seed = 1; seed <= 80; seed++) {
        const plan = buildEntertainmentRacePlan(seed, 400, 3, 'mixed');
        const director = new EntertainmentModeDirector(seed, 400, true, undefined, undefined, undefined, plan);
        const guest = new EntertainmentModeDirector(seed, 400, true, undefined, undefined, undefined, plan);
        assert.deepEqual(director.selectedEvents(), plan.stages.map(stage => stage.event));
        let serial = 0;
        for (const stage of plan.stages) {
            const distance = stage.previewProgress * 400;
            if (stage.event === E.TURTLE_BUS) {
                assert.equal(director.update(8, distance).activatedEvent, stage.event);
            } else {
                assert.equal(director.update(8, distance).previewEvent, stage.event);
                assert.equal(director.update(6, distance).activatedEvent, stage.event);
            }
            assert.equal(director.snapshot().activationSerial, ++serial);
            assert.equal(guest.applySnapshot(director.snapshot()).snapshotAccepted, true);
            assert.equal(guest.currentEvent(), stage.event);
            assert.equal(director.update(stage.durationSeconds, distance).finishedEvent, stage.event);
        }
        assert.equal(director.update(30, 290).previewEvent, E.TIMED_BOMB);
        assert.equal(guest.applySnapshot(director.snapshot()).snapshotAccepted, true);
    }
});

test('浮标按整场批次激活，已消耗槽位不会在后批复活', () => {
    const controller = new MinefieldBrawlController(1, 71, 18,
        () => ({ active: false, finished: false, distance: 0, lateral: 0 }), () => {},
        3, null, [20, 80], [
            { courseX: 10, lateral: -5 }, { courseX: 20, lateral: -5 }, { courseX: 30, lateral: -5 },
        ], [1, 2]);
    assert.equal(controller.mines().filter(mine => mine.active).length, 0);
    controller.update(0.1, GameState.RACING, true, 20);
    assert.deepEqual(controller.mines().map(mine => mine.active), [true, false, false]);
    const revision = controller.snapshotState().revision + 1;
    assert.equal(controller.applyImpact({ mineId: 0, hitLane: 0, hitMask: 1,
        courseX: 10, lateral: -5, revision }), true);
    controller.update(0.1, GameState.RACING, true, 80);
    assert.deepEqual(controller.mines().map(mine => mine.active), [false, true, true]);
    assert.deepEqual(controller.mines().map(mine => mine.generation), [1, 2, 2]);
});

test('垃圾按全场每波件数投放并复用固定对象池', () => {
    const plan = buildEntertainmentRacePlan(23, 200, 5, 'debris');
    const racer = { active: true, finished: false, distance: 0, lateral: -8 };
    const waves = [];
    const controller = new LitterBrawlController(1, 23, 20, () => racer,
        wave => waves.push(wave), undefined,
        { waveDistances: plan.obstacle.litterWaveDistances,
            waveCounts: plan.obstacle.litterWaveCounts, landingLeadDistance: LITTER_BRAWL_TUNING.landingLeadDistance },
        undefined, undefined, { itemsPerWave: 10, poolSize: plan.obstacle.litterPoolSize });
    for (let wave = 0; wave < plan.obstacle.litterWaveCounts.length; wave++) {
        racer.distance = plan.obstacle.litterWaveDistances[wave];
        controller.update(0, GameState.RACING);
        assert.equal(controller.activeCount(), plan.obstacle.litterWaveCounts[wave]);
        controller.update(30, GameState.RACING);
    }
    assert.deepEqual(waves, [0, 1, 2, 3, 4]);
    assert.equal(controller.pendingWaveCount(), 0);
});

test('补给保留全场件数且不与固定浮标锚点重叠', () => {
    const centers = Array.from({ length: 8 }, (_, lane) => (3.5 - lane) * 2.625);
    for (const distance of [200, 400]) for (let grade = 1; grade <= 5; grade++) {
        for (let seed = 1; seed <= 100; seed++) {
            const plan = buildEntertainmentRacePlan(seed, distance, grade, 'buoy');
            const profile = entertainmentIntensityProfile(plan.obstacle.intensity);
            const count = plan.obstacle.buoyBatchCounts.reduce((sum, value) => sum + value, 0);
            const obstacle = buildObstaclePlan(seed, 0, 21, { ...profile, mineCount: count }, 'buoy');
            const supplies = avoidGradedSupplyBuoys(buildGradedStimulantSchedule(seed, 8, distance, 50,
                plan.supply.waveDistances, plan.supply.itemsPerWave), centers, obstacle.buoyAnchors, 50);
            assert.equal(supplies.length, plan.supply.waveDistances.length * plan.supply.itemsPerWave);
            for (const item of supplies) {
                const leg = Math.floor(item.distance / 50);
                const local = item.distance % 50;
                const x = leg % 2 === 0 ? local : 50 - local;
                const z = centers[item.laneIndex] + item.lateralOffset;
                assert.ok(obstacle.buoyAnchors.every(anchor => Math.abs(anchor.courseX - x) >= 2.5
                    || Math.abs(anchor.lateral - z) >= 2.1),
                    `seed=${seed} distance=${distance} grade=${grade} item=${item.id}`);
            }
        }
    }
});
