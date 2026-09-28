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

const { buildEntertainmentRacePlan, normalizeEntertainmentRaceGrade } = PlanModule;
const { EntertainmentEventId: E, EntertainmentModeDirector } = DirectorModule;
const { buildGradedStimulantSchedule, avoidGradedSupplyBuoys } = SupplyModule;
const { MinefieldBrawlController } = MineModule;
const { GameState } = ConstantsModule;
const { LitterBrawlController, LITTER_BRAWL_TUNING } = LitterModule;
const { buildObstaclePlan } = ObstacleModule;
const { entertainmentIntensityProfile } = IntensityModule;

test('整局五档在两种距离及三种布局下遵守配额、白名单与容量', () => {
    const supplyTotals = [[6, 12], [9, 16], [12, 20], [16, 24], [20, 30]];
    const allowed = [[], [E.WHIRLPOOL], [E.WHIRLPOOL, E.TURTLE_BUS, E.TIMED_BOMB],
        [E.WHIRLPOOL, E.TURTLE_BUS, E.TIMED_BOMB, E.CANNON],
        [E.WHIRLPOOL, E.TURTLE_BUS, E.TIMED_BOMB, E.CANNON, E.SHARK]];
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
                assert.ok(plan.stages.every((stage, index) => index === 0
                    || stage.previewProgress > plan.stages[index - 1].previewProgress));
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
    assert.equal(short.stages[0].actionCount, 3);
    assert.equal(long.stages[1].actionCount, 6);
    assert.equal(long.stages[1].intensity, 4);
    assert.equal(short.stages.at(-1).event, E.SHARK);
    assert.equal(long.stages.at(-1).event, E.SHARK);
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
    const easyPlan = buildEntertainmentRacePlan(31, 200, 1, 'debris');
    const easy = new EntertainmentModeDirector(31, 200, true, undefined, undefined, undefined, easyPlan);
    assert.equal(easy.selectedEvents().length, 0);
    assert.equal(easy.snapshot().eventCount, 0);
    const easyGuest = new EntertainmentModeDirector(31, 200, true, undefined, undefined, undefined, easyPlan);
    assert.equal(easyGuest.applySnapshot(easy.snapshot()).snapshotAccepted, true);
    assert.equal(easy.currentEvent(), null);
    assert.equal(easy.update(30, 180).previewEvent, null);
    const longPlan = buildEntertainmentRacePlan(31, 400, 3, 'mixed');
    const director = new EntertainmentModeDirector(31, 400, true, undefined, undefined, undefined, longPlan);
    assert.deepEqual(director.selectedEvents(), [E.WHIRLPOOL, E.TIMED_BOMB, E.TIMED_BOMB]);
    assert.equal(director.update(4, 64).previewEvent, E.WHIRLPOOL);
    assert.equal(director.update(6, 70).activatedEvent, E.WHIRLPOOL);
    assert.equal(director.update(8, 120).finishedEvent, E.WHIRLPOOL);
    assert.equal(director.update(8, 160).previewEvent, E.TIMED_BOMB);
    assert.equal(director.update(6, 165).activatedEvent, E.TIMED_BOMB);
    assert.equal(director.update(12, 260).finishedEvent, E.TIMED_BOMB);
    assert.equal(director.update(8, 264).previewEvent, E.TIMED_BOMB);
    assert.equal(director.update(6, 270).activatedEvent, E.TIMED_BOMB);
    assert.equal(director.update(12, 275).finishedEvent, E.TIMED_BOMB);
    assert.equal(director.update(12, 280).previewEvent, E.TIMED_BOMB);
    const longGuest = new EntertainmentModeDirector(31, 400, true, undefined, undefined, undefined, longPlan);
    assert.equal(longGuest.applySnapshot(director.snapshot()).snapshotAccepted, true);
    assert.equal(longGuest.currentEvent(), E.TIMED_BOMB);
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
