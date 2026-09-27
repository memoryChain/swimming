import test from 'node:test';
import assert from 'node:assert/strict';

import IntensityModule from '../assets/scripts/core/EntertainmentIntensity.ts';
import CannonModule from '../assets/scripts/core/CannonBrawlController.ts';
import LitterModule from '../assets/scripts/core/LitterBrawlController.ts';
import MinefieldModule from '../assets/scripts/core/MinefieldBrawlController.ts';
import GameConstants from '../assets/scripts/core/GameConstants.ts';
import WhirlpoolModule from '../assets/scripts/core/WhirlpoolBrawlRules.ts';
import DirectorModule from '../assets/scripts/core/EntertainmentModeDirector.ts';

const { entertainmentIntensityProfile, normalizeEntertainmentIntensity,
    getEntertainmentIntensityTuning, setEntertainmentIntensityTuning } = IntensityModule;
const { CannonBrawlController, CANNON_BRAWL_TUNING } = CannonModule;
const { LitterBrawlController } = LitterModule;
const { MinefieldBrawlController } = MinefieldModule;
const { entertainmentGradedWhirlpoolSpawns, isSuperWhirlpool } = WhirlpoolModule;
const { GameState } = GameConstants;
const { EntertainmentModeDirector, EntertainmentEventId, EntertainmentDirectorPhase } = DirectorModule;

test('五档数量有界且逐档增强，非法档位不进入比赛配置', () => {
    let last = null;
    for (let level = 1; level <= 5; level++) {
        assert.equal(normalizeEntertainmentIntensity(level), level);
        const p = entertainmentIntensityProfile(level);
        assert.ok(p.litterPoolSize <= 30);
        assert.ok(p.stimulantItemsPerWave * p.stimulantWaves400 <= 30);
        assert.ok(p.cannonConcurrency <= 2 && p.whirlpoolCount <= 2);
        if (last) {
            for (const key of ['litterItemsPerWave', 'mineCount', 'stimulantItemsPerWave',
                'cannonStrikes200', 'sharkHunts200', 'timedBallRounds200', 'whirlpoolCount']) {
                assert.ok(p[key] >= last[key], `${key} 的 ${level} 档低于上一档`);
            }
        }
        last = p;
    }
    assert.equal(normalizeEntertainmentIntensity(0), null);
    assert.equal(normalizeEntertainmentIntensity(6), null);
    assert.equal(normalizeEntertainmentIntensity(2.5), null);
});

test('分档调参受硬预算约束，已锁定的比赛配置不被后续改值污染', () => {
    const original = getEntertainmentIntensityTuning(5, 'litterItemsPerWave');
    const locked = entertainmentIntensityProfile(5);
    try {
        setEntertainmentIntensityTuning(5, 'litterItemsPerWave', 100);
        assert.equal(entertainmentIntensityProfile(5).litterItemsPerWave, 15);
        setEntertainmentIntensityTuning(5, 'litterItemsPerWave', 12);
        assert.equal(entertainmentIntensityProfile(5).litterItemsPerWave, 12);
        assert.equal(locked.litterItemsPerWave, 15);
        setEntertainmentIntensityTuning(5, 'litterPoolSize', 3);
        assert.equal(entertainmentIntensityProfile(5).litterPoolSize, 12);
    } finally {
        setEntertainmentIntensityTuning(5, 'litterItemsPerWave', original);
        setEntertainmentIntensityTuning(5, 'litterPoolSize', 30);
    }
});

test('超强杂物每波十五件，三十槽上限且始终保留可通过通道', () => {
    for (let seed = 1; seed <= 50; seed++) {
        const racers = Array.from({ length: 8 }, () => ({ active: true, finished: false, distance: 20, lateral: 0 }));
        const controller = new LitterBrawlController(8, seed, 20, lane => racers[lane],
            undefined, undefined, { waveDistances: [0], landingLeadDistance: 7 },
            undefined, undefined, { itemsPerWave: 15, poolSize: 30 });
        controller.update(0.1, GameState.RACING, true);
        const slots = controller.clusters();
        const active = slots.filter(slot => slot.active);
        assert.equal(slots.length, 30);
        assert.equal(active.length, 15);
        const corridor = active[0].safeCenter;
        assert.ok(active.every(slot => Math.abs(slot.anchorLateral - corridor) >= 1.45 + 0.75),
            `种子 ${seed} 的安全通道被杂物覆盖`);
        controller.dispose();
    }
});

test('浮标第五档有十二个不同锚点，低档只创建所需节点', () => {
    const racers = Array.from({ length: 8 }, (_, lane) => ({
        active: true, finished: false, distance: 0, lateral: 8.75 - lane * 2.5,
    }));
    for (const count of [2, 3, 5, 8, 12]) {
        const controller = new MinefieldBrawlController(8, 41, 20, lane => racers[lane],
            () => {}, count);
        const mines = controller.mines();
        assert.equal(mines.length, count);
        assert.equal(new Set(mines.map(mine => mine.courseX)).size, count);
        assert.ok(mines.every(mine => Math.abs(mine.lateral) <= 9.2));
    }
});

test('高档双炮错峰发射、各自结算且两个落点留有躲避间距', () => {
    const racers = Array.from({ length: 8 }, (_, lane) => ({ active: true, finished: false,
        damageable: true, distance: 30, lateral: 8.75 - lane * 2.5, speed: 3 }));
    const launches = [];
    const impacts = [];
    const controller = new CannonBrawlController(8, 41, 20, lane => racers[lane],
        launch => launches.push(launch), impact => impacts.push(impact), [0, 0, 0],
        180, distance => distance, 2, 0.85);
    controller.update(0, GameState.RACING, true);
    assert.equal(launches.length, 1);
    controller.update(0.85, GameState.RACING, true);
    assert.equal(launches.length, 2);
    assert.ok(Math.abs(launches[0].targetZ - launches[1].targetZ)
        >= CANNON_BRAWL_TUNING.splashLateralRadius * 2 + 0.7);
    assert.equal(controller.currentSecondaryLaunch()?.strikeId, 1);
    controller.update(0.41, GameState.RACING, true);
    assert.equal(impacts.length, 1);
    assert.equal(controller.isLatestImpact(impacts[0]), true);
    assert.equal(controller.currentLaunch()?.strikeId, 1);
    controller.update(0.45, GameState.RACING, true);
    assert.equal(launches.length, 3);
    assert.equal(controller.currentSecondaryLaunch()?.strikeId, 2);
    controller.cancelPendingStrikesAfterCurrent();
    controller.update(2, GameState.RACING, true);
    assert.equal(impacts.length, 3);
    assert.equal(controller.currentLaunch(), null);
});

test('双炮首发落点已远离泳者时，AI 仍躲避第二发附近落点', () => {
    const racers = [{ active: true, finished: false, damageable: true,
        distance: 30, lateral: 0, speed: 3 }];
    const controller = new CannonBrawlController(1, 41, 20, lane => racers[lane],
        () => {}, () => {}, [0, 0], 180, distance => distance, 2);
    assert.equal(controller.applyLaunch({ strikeId: 0, targetDistance: 100, targetZ: -5,
        warningSeconds: 1.25, revision: 1 }), true);
    assert.equal(controller.applyLaunch({ strikeId: 1, targetDistance: 30, targetZ: 0,
        warningSeconds: 1.25, revision: 2 }), true);
    controller.update(0.7, GameState.RACING, false);
    assert.notEqual(controller.targetZForAi(30, 0, 0.8), null);
});

test('高档双涡只生成两处，第五档包含一个超级漩涡', () => {
    const ordinary = entertainmentGradedWhirlpoolSpawns(41, 20, 200, 2, 1, 1, 0);
    const superPair = entertainmentGradedWhirlpoolSpawns(41, 20, 200, 2, 1, 1, 1);
    assert.equal(ordinary.length, 2);
    assert.equal(ordinary.filter(isSuperWhirlpool).length, 0);
    assert.equal(superPair.length, 2);
    assert.equal(superPair.filter(isSuperWhirlpool).length, 1);
});

test('固定组合先驻留后爆发，完成后不随机返场', () => {
    const order = [EntertainmentEventId.OBSTACLE, EntertainmentEventId.CANNON, EntertainmentEventId.STIMULANT];
    const director = new EntertainmentModeDirector(41, 200, true, () => 1, order, false);
    assert.deepEqual(director.selectedEvents(), order);
    const activated = [];
    for (let step = 0; step < 180; step++) {
        const transition = director.update(1, 200, true);
        if (transition.activatedEvent !== null) activated.push(transition.activatedEvent);
    }
    assert.deepEqual(activated, order);
    assert.equal(director.snapshot().phase, EntertainmentDirectorPhase.COMPLETE);
    assert.equal(director.currentEvent(), null);
});
