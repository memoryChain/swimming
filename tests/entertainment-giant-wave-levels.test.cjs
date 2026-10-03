const test = require('node:test');
const assert = require('node:assert/strict');
const { createImportedMeshHarness } = require('./helpers/imported-mesh-harness.cjs');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');
const frozen = require('./fixtures/butterfly-giant-wave-levels.json');
const MODES = ['giant-wave-one', 'giant-wave-two', 'giant-wave', 'giant-wave-four', 'giant-wave-five'];
function actor(h, id = 'cartonSwimmer6') {
    const f = h.create(id, 5, .7, 2);
    f.body.motor.configureEntertainment(true, false);
    f.body.cartoonRig.giantWaveLift = 0;
    f.body.cartoonRig.setGiantWaveLift = function (v) { this.giantWaveLift = v; };
    return f;
}
function runtime(h, actors, mode, layers = null) {
    const R = h.loadModule('app/EntertainmentRaceRuntime').EntertainmentRaceRuntime;
    return new R(h.root, actors[0].body.courseLayout, mode, 42, 200,
        actors.map((f, lane) => ({ lane, swimmer: f.body, condition: f.condition, ai: f.ai })), layers);
}

test('五档规格和30组起浪与固定来源一致，不提高顺浪收益、不扰动公共随机数', () => {
    const h = createImportedMeshHarness('giantWave'), r = h.loadModule('entertainment/GiantWaveRules');
    const rng = h.loadModule('core/SharedRNG');
    rng.reseedSharedRandom(71); const next = rng.randomFloat(); rng.reseedSharedRandom(71);
    for (let level = 1; level <= 5; level++) assert.deepEqual(r.giantWaveSpec(level), frozen.specs[level - 1]);
    const directions = new Set();
    for (const f of frozen.cases) {
        const sim = new r.GiantWaveSimulation(50, 0, 50, 24, f.seed, 'three', 44.4, f.intensity, 200);
        sim.update(.1, [{ distance: 5 }], false);
        assert.deepEqual(sim.state, f.prepared, `${f.intensity}/${f.seed}`);
        directions.add(sim.state.direction);
        assert.ok(Math.abs(sim.state.z) + sim.state.width / 2 <= 12 - .3 + 1e-6);
        assert.equal(sim.spec.boostSpeed, frozen.specs[2].boostSpeed);
        assert.equal(sim.spec.travelSpeed, frozen.specs[2].travelSpeed);
        assert.equal(sim.spec.height, frozen.specs[2].height);
    }
    assert.equal(directions.size, 2); assert.equal(rng.randomFloat(), next);
});

test('新档只开放本地AI测试，原普通巨浪仍是三档，低强度组合仍是一档', () => {
    const h = createImportedMeshHarness('giantWave'), p = h.loadModule('entertainment/EntertainmentDebugPlan');
    for (const [index, mode] of MODES.entries()) {
        assert.equal(p.normalizeEntertainmentDebugMode(mode), mode);
        assert.equal(p.entertainmentGiantWaveIntensity(mode), index + 1);
        const plan = p.buildEntertainmentDebugPlan(mode, 200, 42);
        assert.equal(plan.giantWave, true); assert.equal(plan.giantWaveIntensity, index + 1);
        assert.equal(plan.geyser || plan.whirlpool || plan.cannon || plan.sprayBuoy || !!plan.light, false);
        assert.equal(plan.supplies.length + plan.debris.length, 0);
        assert.equal(p.entertainmentDebugAllowed(true, false, false, false, false, mode), true);
        for (let gate = 0; gate < 5; gate++) {
            const flags = [true, false, false, false, false]; flags[gate] = gate !== 0;
            assert.equal(p.entertainmentDebugAllowed(...flags, mode), false);
        }
    }
    assert.equal(p.normalizeEntertainmentDebugMode('giant-wave-six'), 'none');
    for (let seed = 0; seed < 100; seed++) assert.equal(p.buildEntertainmentDebugPlan('light-mix', 200, seed).giantWaveIntensity, 1);
});

test('各档八人池都只加载三份GLB，20次重赛部件数量固定，结束后零写入', () => {
    for (const [index, mode] of MODES.entries()) {
        const h = createImportedMeshHarness('giantWave'), a = createAiHarness();
        const actors = Array.from({ length: 8 }, () => actor(a)); let bound = 0, released = 0;
        const r = runtime(h, actors, mode, { registerFloatingObject() { bound++; return () => released++; } });
        r.prepare(assert.ifError);
        const S = h.loadModule('core/GameConstants').GameState, sim = r.giantWave.simulation;
        assert.equal(sim.intensity, index + 1);
        assert.equal(h.requests.length, 3); assert.equal(bound, 3);
        const budget = h.budget();
        assert.equal(budget.meshes, 3); assert.equal(budget.materials, 3); assert.equal(budget.renderers, 3);
        const initialInfluences = actors.map(f => f.body.motor._giantWave);
        for (let round = 0; round < 20; round++) {
            r.onStateChanged(S.COUNTDOWN);
            for (const f of actors) f.body.startRace(20, 4);
            r.onStateChanged(S.RACING); r.update(.1, S.RACING); r.update(3, S.RACING); r.update(4, S.RACING);
            const visible = h.nodes.find(n => n.name === 'GiantWave');
            assert.equal(visible.active, true);
            assert.equal(sim.state.width, actors[0].body.courseLayout.poolWidth * sim.spec.widthFraction);
            r.onStateChanged(S.FINISHED);
            const writes = h.nodes.reduce((sum, node) => sum + node.writes, 0);
            const materialWrites = h.materials.reduce((sum, m) => sum + m.writes, 0);
            for (let frame = 0; frame < 60; frame++) r.update(1 / 60, S.FINISHED);
            assert.equal(h.nodes.reduce((sum, node) => sum + node.writes, 0), writes);
            assert.equal(h.materials.reduce((sum, m) => sum + m.writes, 0), materialWrites);
            assert.deepEqual(h.budget(), budget); assert.equal(h.requests.length, 3);
            for (let i = 0; i < actors.length; i++) {
                assert.equal(actors[i].body.motor._giantWave, initialInfluences[i]);
                assert.equal(actors[i].body.motor.giantWaveLift, 0);
                assert.equal(actors[i].ai._entertainmentTargetZ, null);
            }
        }
        r.dispose(); r.dispose(); assert.equal(released, 3);
        assert.ok(actors.every(f => f.body.motor._giantWave === null));
        assert.ok(h.materials.every(m => m.destroyCount === 1));
        assert.ok(h.meshes.every(m => m.destroyCount === 0));
    }
});

test('新增各档在加载失败、加载中退出或相机层失败时清理完整', () => {
    for (const mode of MODES.filter(m => m !== 'giant-wave')) {
        for (let failed = 0; failed < 3; failed++) {
            const h = createImportedMeshHarness('giantWave'), f = actor(createAiHarness()); let calls = 0, error;
            h.setLoadOverride((path, _type, done) => {
                if (calls++ === failed) done(new Error('资源失败'));
                else done(null, h.prefabs.get(path));
            });
            const r = runtime(h, [f], mode); r.prepare(e => { error = e; });
            assert.ok(error); assert.equal(f.body.motor._giantWave, null);
            r.dispose(); assert.ok(h.materials.every(m => m.destroyCount === 1));
        }
        const h = createImportedMeshHarness('giantWave'), f = actor(createAiHarness()); let callback, completed = 0;
        h.setLoadOverride((_path, _type, done) => { callback = done; });
        const r = runtime(h, [f], mode); r.prepare(() => completed++); r.dispose();
        callback(null, h.prefabs.values().next().value);
        assert.equal(completed, 1); assert.equal(f.body.motor._giantWave, null);
        assert.equal(h.budget().renderers, 0);
        const failedLayer = createImportedMeshHarness('giantWave'), g = actor(createAiHarness()); let slots = 0, released = 0, error;
        const broken = runtime(failedLayer, [g], mode, { registerFloatingObject() {
            if (++slots === 3) throw new Error('相机层失败');
            return () => released++;
        } });
        broken.prepare(e => { error = e; }); assert.ok(error); broken.dispose();
        assert.equal(released, 2); assert.equal(g.body.motor._giantWave, null);
        assert.ok(failedLayer.materials.every(m => m.destroyCount === 1));
        assert.ok(failedLayer.nodes.filter(n => n !== failedLayer.root).every(n => !n.isValid));
    }
});

test('12个主干角色在新增四档200/400米30/60Hz下可完赛，正反浪与折返不残留助力', () => {
    const h = createImportedMeshHarness('giantWave'), a = createAiHarness();
    const balance = a.load('core/GameBalance'), rng = a.load('core/SharedRNG');
    const C = h.loadModule('entertainment/GiantWaveRaceController').GiantWaveRaceController;
    const characters = a.load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS;
    let cases = 0, previews = 0, rides = 0, opposed = 0;
    for (const level of [1, 2, 4, 5]) for (const distance of [200, 400]) for (const fps of [30, 60]) for (const character of characters) {
        balance.setRaceDifficulty(distance === 200 ? 'competitive' : 'championship'); rng.reseedSharedRandom(42);
        const f = actor(a, character.id), c = new C(h.root, f.body.courseLayout, [f.body], 42, distance, h.assets, null, null, level);
        assert.ok(f.body.motor._giantWave, '直接测试控制器时也必须启用真实巨浪运动作用');
        let steps = 0, clock = 1;
        while (f.body.motor.isRacing && steps < fps * 350) {
            f.step(1 / fps); c.update(1 / fps); clock += 1 / fps;
            if (clock >= .1) { clock = 0; f.ai.setEntertainmentTargetZ(c.targetZForAi(0)); }
            if (f.body.motor.isGiantWaveRiding) rides++;
            if (f.body.motor.isGiantWaveOpposed) opposed++;
            assert.ok(Number.isFinite(f.body.distance) && Number.isFinite(f.body.node.position.y)); steps++;
        }
        assert.equal(f.body.motor.isRacing, false, `${level}/${character.id}/${distance}/${fps}`);
        assert.equal(f.body.distance, distance); assert.equal(f.body.motor.giantWaveLift, 0);
        assert.equal(f.body.cartoonRig.giantWaveLift, 0);
        assert.ok(c.simulation.previews <= c.simulation.maxWaves);
        previews += c.simulation.previews; c.dispose(); cases++;
    }
    assert.equal(cases, 192); assert.ok(previews > 0 && rides > 0 && opposed > 0);
});
