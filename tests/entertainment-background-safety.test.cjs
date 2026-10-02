const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const h = createHarness();
const tsPath = process.env.TYPESCRIPT_PATH || process.env.PATH.split(path.delimiter)
    .map(p => path.resolve(p, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p));
const ts = require(tsPath);
const load = name => h.load(path.join(h.root, 'assets/scripts', name));
const geyser = load('core/GeyserBrawlRules.ts'), turtle = load('core/TurtleBusRules.ts');
const safety = load('core/EntertainmentBackgroundSafety.ts');
const { LitterBrawlController, LITTER_BRAWL_TUNING } = load('core/LitterBrawlController.ts');
const { GameState } = load('core/GameConstants.ts');
function actualMethods(file, name, methods, context) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(h.root, 'assets/scripts', file), 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === name);
    const body = methods.map(name => cls.members.find(n => n.name?.getText(source) === name).getText(source)).join('\n');
    return vm.runInNewContext(ts.transpileModule(`class Subject { ${body} }; Subject`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
}
const Geyser = actualMethods('core/GeyserBrawlController.ts', 'GeyserBrawlController',
    ['isBackgroundLitterRowSafe'], { ...safety, geyserRadiusScale: geyser.geyserRadiusScale });
const Bus = actualMethods('core/TurtleBusController.ts', 'TurtleBusController',
    ['isBackgroundLitterRowSafe', 'worldScale'], { ...safety, ...turtle });
const Wave = actualMethods('core/GiantWaveController.ts', 'GiantWaveController',
    ['isBackgroundLitterRowSafe'], safety);
const Manager = actualMethods('core/GameManager.ts', 'GameManager', ['isEntertainmentLitterWaveSafe'], {
    COURSE_LAYOUT: { distanceToWorldX: d => d }, LITTER_BRAWL_TUNING,
    LANE_LAYOUT: { laneCount: 1 }, getRaceDistance: () => 200, raceDistanceToCourseX: d => d,
    CANNON_BRAWL_TUNING: load('core/CannonBrawlController.ts').CANNON_BRAWL_TUNING,
    isWhirlpoolBrawlMode: () => false,
});
function fixture() {
    const fountain = new Geyser();
    Object.assign(fountain, { isDone: false, vents: [{ x: 32, size: 'large' }], tuning: geyser.GEYSER_TUNING });
    const manager = new Manager();
    Object.assign(manager, { _entertainmentRacePlan: {}, _geyserBrawl: fountain, swimmerForLane: () => null });
    return { manager, fountain };
}

test('真实投放检查同时避开喷泉、两发炮击、载球者和鲨鱼目标，安全水面不被整段锁死', () => {
    const { manager } = fixture();
    assert.equal(manager.isEntertainmentLitterWaveSafe(32, 0, 1), false);
    assert.equal(manager.isEntertainmentLitterWaveSafe(20, 0, 1), true);
    manager._geyserBrawl = null;
    manager._cannonBrawl = { currentLaunch: () => ({ targetDistance: 12 }), currentSecondaryLaunch: () => ({ targetDistance: 30 }) };
    assert.equal(manager.isEntertainmentLitterWaveSafe(12, 0, 1), false);
    assert.equal(manager.isEntertainmentLitterWaveSafe(30, 0, 1), false);
    assert.equal(manager.isEntertainmentLitterWaveSafe(45, 0, 1), true);
    manager._cannonBrawl = null;
    manager._mineRelayBrawl = { currentArm: () => ({ carrierLane: 0 }) };
    manager.swimmerForLane = () => ({ distance: 20 });
    assert.equal(manager.isEntertainmentLitterWaveSafe(24, 0, 1), false);
    manager._mineRelayBrawl = null;
    manager._shark = { target: { distance: 20 } };
    assert.equal(manager.isEntertainmentLitterWaveSafe(24, 0, 1), false);
    assert.equal(manager.isEntertainmentLitterWaveSafe(30, 0, 1), true);
});

test('危险落点只延后真实垃圾波次，主事件状态不变，解除后访客仍不自行投放', () => {
    const { manager, fountain } = fixture();
    const racer = { active: true, finished: false, distance: 25, lateral: -8 };
    let thrown = 0;
    const litter = new LitterBrawlController(1, 33, 21, () => racer, () => thrown++, undefined,
        { waveDistances: [20], waveCounts: [2], landingLeadDistance: 7 },
        (x, z, half) => manager.isEntertainmentLitterWaveSafe(x, z, half),
        undefined, { poolSize: 2, itemsPerWave: 2 }, undefined, undefined, 8, 0, () => true, Infinity, true);
    for (let frame = 0; frame < 30; frame++) litter.update(1 / 30, GameState.RACING, true);
    assert.equal(thrown, 0);
    assert.equal(litter.pendingWaveCount(), 1);
    assert.equal(fountain.isDone, false, '背景安全检查不能结束主事件');
    manager._geyserBrawl = null;
    for (let frame = 0; frame < 15; frame++) litter.update(1 / 30, GameState.RACING, false);
    assert.equal(thrown, 0);
    for (let frame = 0; frame < 15; frame++) litter.update(1 / 30, GameState.RACING, true);
    assert.equal(thrown, 1);
    assert.equal(litter.activeCount(), 2);
});

test('海龟和巨浪用真实状态保护短期运动带，两个方向均能在远处投放', () => {
    for (const direction of [1, -1]) {
        const bus = new Bus();
        Object.assign(bus, { started: true, isDone: false, awaitingActivation: false, direction,
            seats: { age: 5 }, startOffset: 7,
            course: { direction: 1, startX: 0, finishX: 50, courseLength: 50 } });
        const center = (direction > 0 ? 0 : 50) + direction * turtle.turtleBusPositionAt(5, 7);
        assert.equal(bus.isBackgroundLitterRowSafe(center), false);
        assert.equal(bus.isBackgroundLitterRowSafe(center + direction * 15), true);
        const wave = new Wave();
        wave.simulation = { state: { phase: 'active', x: 25, length: 5, speed: 3, direction } };
        assert.equal(wave.isBackgroundLitterRowSafe(25 + direction * 6), false);
        assert.equal(wave.isBackgroundLitterRowSafe(25 - direction * 6), true);
    }
});
