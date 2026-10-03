const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { createBuoyHarness } = require('./helpers/spray-buoy-harness.cjs');
const { runCannonScenario } = require('./helpers/cannon-scenarios.cjs');
const frozen = require('./fixtures/butterfly-cannon-levels.json');
const modes = ['cannon-one', 'cannon-two', 'cannon-three'];
const fixture = () => { const h = createHarness(); return { ...h, load: n => h.load(path.join(h.root, 'assets/scripts', n + '.ts')) }; };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('一至三档计划使用冻结来源的发数、间隔与单发限制；门禁排除普通、联机、房间、教学及Boss', () => {
    const h = fixture(), p = h.load('entertainment/EntertainmentDebugPlan');
    for (const spec of frozen.specs) for (const distance of [200, 400]) {
        const mode = modes[spec.level - 1], plan = p.buildEntertainmentDebugPlan(mode, distance, 42), c = plan.cannonPlan;
        assert.equal(p.normalizeEntertainmentDebugMode(mode), mode); assert.equal(p.entertainmentCannonIntensity(mode), spec.level);
        assert.ok(plan.cannon && !plan.sprayBuoy && !plan.geyser && !plan.giantWave && !plan.whirlpool && !plan.light && !plan.supplies.length && !plan.debris.length);
        assert.equal(c.maxConcurrentLaunches, spec.concurrency); near(c.minimumLaunchIntervalSeconds, spec.interval);
        assert.deepEqual(c.triggers, Array.from({ length: distance === 400 ? spec.strikes400 : spec.strikes200 }, (_, i) => 20 + i * 3));
        assert.ok(p.entertainmentDebugAllowed(true, false, false, false, false, mode));
        for (const args of [[false, false, false, false, false], [true, true, false, false, false], [true, false, true, false, false], [true, false, false, true, false], [true, false, false, false, true]])
            assert.equal(p.entertainmentDebugAllowed(...args, mode), false);
    }
});

test('48组低档落点、命中和AI避让与冻结来源一致，无并行水球，最短间隔生效且公共随机不变', () => {
    const h = fixture(), C = h.load('entertainment/CannonBrawlController').CannonBrawlController;
    const p = h.load('entertainment/EntertainmentDebugPlan'), rng = h.load('core/SharedRNG');
    rng.reseedSharedRandom(73); const expected = rng.randomFloat(); rng.reseedSharedRandom(73);
    for (const f of frozen.fixtures) {
        const plan = p.buildCannonDebugPlan(modes[f.level - 1], f.raceDistance);
        let time = 0, previousLaunch = -Infinity;
        const actual = runCannonScenario((racers, world, launch, impact) => {
            const c = new C(4, f.seed, 24, l => racers[l], e => {
                assert.ok(time - previousLaunch >= plan.minimumLaunchIntervalSeconds - 1e-8);
                previousLaunch = time; launch(e);
            }, impact, f.raceDistance - 20, world, plan.triggers, plan.maxConcurrentLaunches, plan.minimumLaunchIntervalSeconds);
            return { step: dt => { time += dt; c.update(dt); assert.equal(c.currentSecondaryLaunch(), null); }, ai: (...args) => c.targetZForAi(...args) };
        }, f.seed, f.length, f.raceDistance, f.fps);
        assert.deepEqual({ level: f.level, ...actual }, f, `${f.level}/${f.seed}/${f.length}/${f.raceDistance}/${f.fps}`);
        assert.equal(actual.events.filter(e => e[0] === 'launch').length, plan.triggers.length);
    }
    assert.equal(rng.randomFloat(), expected);
});

test('低档八人池仍为17个渲染部件、四份材质，重赛20次不加载不增建，结束后零表现写入', () => {
    const ids = fixture().load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.slice(0, 8).map(d => d.id);
    for (const mode of modes) {
        const h = createBuoyHarness(42, 200, ids, mode); h.runtime.prepare(assert.ifError);
        const budget = h.liveBudget(), loads = h.requests.length, layers = h.layers.size;
        assert.equal(budget.renderers, 17); assert.equal(budget.materials, 4); assert.equal(loads, 9);
        for (let round = 0; round < 20; round++) {
            h.runtime.onStateChanged(h.state.COUNTDOWN); h.runtime.onStateChanged(h.state.RACING);
            for (const a of h.actors) { a.body.startRace(35, .8); a.ai.startSwimming(); }
            h.runtime.update(.01, h.state.RACING); assert.ok(h.runtime.cannon.rules.currentLaunch());
            for (let i = 0; i < 120; i++) h.runtime.update(.1, h.state.RACING);
            assert.equal(h.runtime.cannon.rules.currentLaunch(), null); assert.equal(h.runtime.cannon.rules.currentSecondaryLaunch(), null);
            assert.deepEqual(h.liveBudget(), budget); assert.equal(h.requests.length, loads); assert.equal(h.layers.size, layers);
            h.runtime.onStateChanged(h.state.FINISHED); const writes = h.nodes.reduce((sum, n) => sum + n.writes, 0);
            for (let i = 0; i < 120; i++) h.runtime.update(1 / 60, h.state.FINISHED);
            assert.equal(h.nodes.reduce((sum, n) => sum + n.writes, 0), writes);
        }
        h.runtime.dispose(); assert.equal(h.layers.size, 0); assert.equal(h.liveBudget().materials, 0);
    }
});

test('低档三个入口支持全部角色200/400米30/60Hz完赛，实际比赛接线按选择的计划发射', () => {
    const ids = fixture().load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.map(d => d.id);
    for (const mode of modes) for (const distance of [200, 400]) for (const fps of [30, 60]) for (const group of [ids.slice(0, 8), ids.slice(8)]) {
        const h = createBuoyHarness(42, distance, group, mode); h.runtime.prepare(assert.ifError);
        h.runtime.onStateChanged(h.state.COUNTDOWN); h.runtime.onStateChanged(h.state.RACING);
        const launches = [], original = h.runtime.cannon.presentation.showLaunch.bind(h.runtime.cannon.presentation);
        h.runtime.cannon.presentation.showLaunch = shot => { launches.push(shot); original(shot); };
        const budget = h.liveBudget(), loads = h.requests.length;
        for (let frame = 0; frame < fps * 600; frame++) {
            h.runtime.update(1 / fps, h.state.RACING);
            assert.equal(h.runtime.cannon.rules.currentSecondaryLaunch(), null);
            for (const f of h.actors) if (f.body.distance < distance) f.step(1 / fps);
            if (h.actors.every(f => f.body.distance >= distance)) break;
        }
        for (const f of h.actors) assert.ok(f.body.distance >= distance, `${mode}/${f.profile.characterId}/${distance}/${fps}未完赛`);
        assert.ok(launches.length > 0); assert.ok(launches.length <= h.runtime.cannon.rules.triggers.length);
        assert.deepEqual(h.liveBudget(), budget); assert.equal(h.requests.length, loads); h.runtime.dispose(); assert.equal(h.layers.size, 0);
    }
});

test('三个新间隔可保存，旧配置缺键用默认值，后续调参不修改已创建的比赛计划', () => {
    const h = fixture(), saved = new Map();
    Object.assign(h.cc, { JsonAsset: class {}, native: {}, sys: { localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) } },
        resources: { load(p, t, cb) { cb(null, { json: { version: 52, values: {} } }); } } });
    const t = h.load('core/TuningDebugControls'), p = h.load('entertainment/EntertainmentDebugPlan');
    const b = h.load('core/EntertainmentBalance').CANNON_BRAWL_TUNING;
    t.loadSavedTuningAsync(() => {}); const plans = modes.map(mode => p.buildCannonDebugPlan(mode, 400));
    const fields = ['oneMinimumIntervalSeconds', 'twoMinimumIntervalSeconds', 'threeMinimumIntervalSeconds'];
    for (let i = 0; i < fields.length; i++) {
        const key = fields[i], entry = t.TUNING_GROUPS.flatMap(g => g.controls).find(c => c.id === `entertainment.cannon.${key}`);
        assert.ok(entry); near(b[key], frozen.specs[i].interval); entry.set(3.5); assert.equal(t.saveCurrentTuning().ok, true);
        entry.set(.85); t.loadSavedTuningAsync(() => {}); near(b[key], 3.5);
        near(plans[i].minimumLaunchIntervalSeconds, frozen.specs[i].interval);
        near(p.buildCannonDebugPlan(modes[i], 400).minimumLaunchIntervalSeconds, 3.5);
    }
});
