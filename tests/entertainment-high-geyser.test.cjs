const test = require('node:test');
const assert = require('node:assert/strict');
const { createImportedMeshHarness } = require('./helpers/imported-mesh-harness.cjs');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');
const frozen = require('./fixtures/butterfly-high-geyser.json');
const MODES = ['geyser-three', 'geyser-four', 'geyser-five'];
// 来源坐标不变；删除逐人找路后，固定记录新的空间选择，不覆盖来源历史记录。
const SPATIAL_MASKS = {
    3: { 0: 16, 1: 16, 42: 16, 77: 16, 12345: 16, 4294967295: 16 },
    4: { 0: 33, 1: 129, 42: 66, 77: 34, 12345: 66, 4294967295: 33 },
    5: { 0: 289, 1: 273, 42: 273, 77: 274, 12345: 530, 4294967295: 273 },
};

function fixture() { return createImportedMeshHarness('geyser'); }
function actor(h, id = 'cartonSwimmer6') {
    const f = h.create(id, 5, .7, 0);
    f.body.cartoonRig.geyserBodyScale = 1;
    f.body.cartoonRig.geyserBodyPivot = { x: 0, y: 0, z: 0 };
    return f;
}
function runtime(h, f, mode, layers = null) {
    const R = h.loadModule('app/EntertainmentRaceRuntime').EntertainmentRaceRuntime;
    return new R(h.root, f.body.courseLayout, mode, 42, 200,
        [{ lane: 0, swimmer: f.body, condition: f.condition, ai: f.ai }], layers);
}

test('三至五档108组来源排布与节奏保留，大小口仅按种子和空间选择，不消耗公共随机序列', () => {
    const h = fixture(), rules = h.loadModule('entertainment/GeyserBrawlRules');
    const safety = h.loadModule('entertainment/GeyserBrawlSafety');
    const rng = h.loadModule('core/SharedRNG');
    rng.reseedSharedRandom(71); const expected = rng.randomFloat(); rng.reseedSharedRandom(71);
    for (const f of frozen.fixtures) {
        assert.deepEqual(rules.geyserSpec(f.intensity, frozen.tuning), f.spec);
        assert.deepEqual(rules.planGeyserVents(f.seed, f.serial, f.intensity,
            f.direction * 15, 0, 25, f.halfWidth, f.direction), f.vents);
        const result = safety.selectGeyserLargeMask(f.seed, f.serial, f.intensity,
            f.vents, f.halfWidth, f.dangers, frozen.tuning);
        assert.equal(result.mask, f.scenario === 'blocked' ? 0 : SPATIAL_MASKS[f.intensity][f.seed]);
        if (f.result.rejectedRoute === 0) {
            assert.deepEqual(result, { mask: f.result.mask, rejectedSpace: f.result.rejectedSpace },
                `${f.intensity}/${f.seed}/${f.direction}/${f.scenario}`);
        }
        assert.ok(result.mask.toString(2).replace(/0/g, '').length <= f.spec.largeCount);
        if (f.scenario === 'blocked') assert.equal(result.mask, 0);
    }
    assert.equal(rng.randomFloat(), expected);
});

test('新增档位只有本地AI调试可用，一二档旧选择和低强度组合保持原档位', () => {
    const h = fixture(), p = h.loadModule('entertainment/EntertainmentDebugPlan');
    for (let i = 0; i < MODES.length; i++) {
        const mode = MODES[i], plan = p.buildEntertainmentDebugPlan(mode, 200, 42);
        assert.equal(p.normalizeEntertainmentDebugMode(mode), mode);
        assert.equal(p.entertainmentGeyserIntensity(mode), i + 3);
        assert.equal(plan.geyser, true); assert.equal(plan.geyserIntensity, i + 3);
        assert.equal(plan.supplies.length + plan.debris.length, 0);
        assert.equal(plan.sprayBuoy || plan.cannon || plan.whirlpool || plan.giantWave || !!plan.light, false);
        assert.equal(p.entertainmentDebugAllowed(true, false, false, false, false, mode), true);
        for (let gate = 0; gate < 5; gate++) {
            const gates = [true, false, false, false, false]; gates[gate] = gate !== 0;
            assert.equal(p.entertainmentDebugAllowed(...gates, mode), false);
        }
    }
    assert.equal(p.buildEntertainmentDebugPlan('geyser', 200).geyserIntensity, 1);
    assert.equal(p.buildEntertainmentDebugPlan('geyser-large', 200).geyserIntensity, 2);
    for (let seed = 0; seed < 50; seed++) assert.equal(p.buildEntertainmentDebugPlan('light-mix', 200, seed).geyserIntensity, 1);
});

test('六八十口仍只加载三份共享模型与一份材质，20次重赛数量固定，结束后零写入', () => {
    for (let i = 0; i < MODES.length; i++) {
        const h = fixture(), f = actor(createAiHarness()); let bound = 0, released = 0;
        const r = runtime(h, f, MODES[i], { registerFloatingObject() { bound++; return () => released++; } });
        r.prepare(assert.ifError);
        const count = [6, 8, 10][i], S = h.loadModule('core/GameConstants').GameState;
        const budget = h.budget();
        assert.equal(h.requests.length, 3); assert.equal(bound, count);
        assert.equal(budget.renderers, count * 4); assert.equal(budget.materials, 1); assert.equal(budget.meshes, 3);
        const geometry = h.assets;
        const faces = geometry.foam.geometry.indices.length / 3 + geometry.jet.geometry.indices.length / 3
            + 2 * geometry.drops.geometry.indices.length / 3;
        assert.equal(faces * count, [2904, 3872, 4840][i]);
        for (let round = 0; round < 20; round++) {
            f.body.startRace(10, 0); r.onStateChanged(S.COUNTDOWN); r.onStateChanged(S.RACING); r.update(.1, S.RACING);
            assert.equal(r.geyser.vents.length, count);
            assert.ok(r.geyser.vents.filter(v => v.size === 'large').length <= [1, 2, 3][i]);
            const vents = r.geyser.vents; r.update(.1, S.RACING); assert.equal(r.geyser.vents, vents);
            r.onStateChanged(S.FINISHED);
            const writes = h.nodes.reduce((n, node) => n + node.writes, 0);
            for (let frame = 0; frame < 60; frame++) r.update(1 / 60, S.FINISHED);
            assert.equal(h.nodes.reduce((n, node) => n + node.writes, 0), writes);
            assert.deepEqual(h.budget(), budget); assert.equal(h.requests.length, 3);
        }
        r.dispose(); r.dispose(); assert.equal(released, count); assert.equal(f.body._geyser, null);
        assert.ok(h.nodes.filter(n => n !== h.root).every(n => !n.isValid));
        assert.ok(h.materials.every(m => m.destroyCount === 1));
    }
});

test('所有新档位在资源失败、加载中退出和最后一个相机槽失败时完整释放', () => {
    for (let i = 0; i < MODES.length; i++) {
        for (let failure = 0; failure < 3; failure++) {
            const h = fixture(), f = actor(createAiHarness()), r = runtime(h, f, MODES[i]); let requests = 0, done = 0;
            h.setLoadOverride((p, type, callback) => requests++ === failure ? callback(new Error('加载失败')) : callback(null, h.prefabs.get(p)));
            r.prepare(error => { assert.ok(error); done++; });
            assert.equal(done, 1); assert.equal(r.disposed, true); assert.equal(f.body._geyser, null);
            assert.equal(h.budget().renderers, 0);
        }
        {
            const h = fixture(), f = actor(createAiHarness()), r = runtime(h, f, MODES[i]), pending = []; let done = 0;
            h.setLoadOverride((p, type, callback) => pending.push({ p, callback })); r.prepare(error => { assert.ok(error); done++; });
            const late = pending.shift(); r.dispose(); const budget = h.budget();
            late.callback(null, h.prefabs.get(late.p)); assert.equal(done, 1); assert.deepEqual(h.budget(), budget);
            assert.equal(h.requests.length, 1); assert.equal(f.body._geyser, null);
        }
        {
            const h = fixture(), f = actor(createAiHarness()), count = [6, 8, 10][i]; let bound = 0, released = 0;
            const r = runtime(h, f, MODES[i], { registerFloatingObject() {
                if (++bound === count) throw new Error('相机槽失败'); return () => released++;
            } });
            r.prepare(error => assert.ok(error));
            assert.equal(released, count - 1); assert.ok(h.nodes.filter(n => n !== h.root).every(n => !n.isValid));
            assert.ok(h.materials.every(m => m.destroyCount === 1)); assert.equal(f.body._geyser, null);
        }
    }
});

test('第五档最后一口第三次喷发仍有完整预警和表现，动作结束不截断最后水柱', () => {
    const h = fixture(), rules = h.loadModule('entertainment/GeyserBrawlRules');
    const { GeyserBrawlPresentation } = h.loadModule('entertainment/GeyserBrawlPresentation');
    const visual = new GeyserBrawlPresentation(h.root, 0, 10, h.assets);
    const vents = rules.applyGeyserSizes(rules.planGeyserVents(42, 1, 5, 15, 0, 25, 12, 1), 1 << 9, true);
    const vent = vents[9], spec = rules.geyserSpec(5), start = rules.geyserPulseStart(vent, 2);
    const burst = start + rules.geyserWarningSeconds(vent);
    visual.update(vents, start + .1, 3);
    assert.equal(visual.views[9].root.active, true); assert.equal(visual.views[9].jet.active, false);
    visual.update(vents, burst + .2, 3);
    assert.equal(visual.views[9].root.active, true); assert.equal(visual.views[9].jet.active, true);
    assert.ok(spec.actionSeconds >= burst + rules.GEYSER_TUNING.burstSeconds + rules.GEYSER_TUNING.fallingSeconds + .3);
    const ids = new Set();
    for (let pulse = 0; pulse < 3; pulse++) for (let v = 0; v < 10; v++) for (let lane = 0; lane < 8; lane++) {
        const id = rules.geyserHitId(1, pulse, v, lane); assert.ok(!ids.has(id)); ids.add(id);
    }
    assert.equal(ids.size, 240); visual.dispose();
});

test('12个主干角色在三至五档200/400米30/60Hz下可完赛，返程和腾空恢复均有效', () => {
    const h = fixture(), a = createAiHarness(), balance = a.load('core/GameBalance');
    const ids = a.load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.map(c => c.id);
    const C = h.loadModule('entertainment/GeyserRaceController').GeyserRaceController;
    let cases = 0;
    for (const intensity of [3, 4, 5]) for (const distance of [200, 400]) for (const fps of [30, 60]) for (const id of ids) {
        balance.setRaceDifficulty('competitive'); balance.setSoloRaceDistance(distance); a.load('core/SharedRNG').reseedSharedRandom(42);
        const f = actor(a, id); f.body.configureEntertainmentGeyser(true);
        const c = new C(h.root, f.body.courseLayout, [f.body], 42, distance, h.assets, null, null, intensity);
        let routeTime = 1, reverseSeen = false, largeSeen = false;
        for (let frame = 0; frame < fps * 600 && f.body.isRacing; frame++) {
            f.step(1 / fps); c.update(1 / fps, f.body.distance); routeTime += 1 / fps;
            reverseSeen ||= c.serial >= 2; largeSeen ||= c.vents.some(v => v.size === 'large');
            if (routeTime >= .1) { routeTime = 0; f.ai.setEntertainmentTargetZ(c.targetZForAi(f.body)); }
            assert.ok(Number.isFinite(f.body.distance) && Number.isFinite(f.body.node.position.y));
        }
        assert.equal(f.body.isRacing, false, `${intensity}/${id}/${distance}/${fps} 未完赛`);
        assert.equal(f.body.distance, distance); assert.equal(f.body.isForcedLaunchActive, false);
        assert.equal(reverseSeen, true); assert.equal(largeSeen, true);
        c.dispose(); f.body.configureEntertainmentGeyser(false); cases++;
    }
    assert.equal(cases, 144);
});
