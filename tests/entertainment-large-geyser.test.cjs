const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createGeyserPresentationHarness } = require('./helpers/geyser-presentation-harness.cjs');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');
const frozen = require('./fixtures/butterfly-large-geyser.json');
const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

function fixture() {
    const h = createGeyserPresentationHarness(2);
    h.loadModule = name => h.load(path.resolve(__dirname, '../assets/scripts', name + '.ts'));
    return h;
}
function actor(h, id = 'cartonSwimmer6', distance = 10, z = 0) {
    const f = h.create(id, 5, .7, distance, z);
    f.body.cartoonRig.geyserBodyScale = 1;
    f.body.cartoonRig.geyserBodyPivot = { x: 0, y: 0, z: 0 };
    f.body.configureEntertainmentGeyser(true);
    return f;
}
function controller(v, actors, seed = 42, distance = 200, intensity = 2, layers = null) {
    const C = v.loadModule('entertainment/GeyserRaceController').GeyserRaceController;
    return new C(v.root, actors[0].body.courseLayout, actors.map(f => f.body), seed, distance, v.assets, layers, null, intensity);
}
function runtime(v, f, mode = 'geyser-large', layers = null) {
    const R = v.loadModule('app/EntertainmentRaceRuntime').EntertainmentRaceRuntime;
    return new R(v.root, f.body.courseLayout, mode, 42, 200,
        [{ lane: 0, swimmer: f.body, condition: f.condition, ai: f.ai }], layers);
}

test('二档保留来源36组空间选择，大小口不依赖选手速度，公共随机序列不变', () => {
    const h = fixture(), safety = h.loadModule('entertainment/GeyserBrawlSafety');
    const rng = h.loadModule('core/SharedRNG');
    rng.reseedSharedRandom(42); const next = rng.randomFloat(); rng.reseedSharedRandom(42);
    for (const f of frozen.fixtures) {
        const result = safety.selectGeyserLargeMask(f.seed, f.serial, f.intensity, f.vents,
            f.halfWidth, f.dangers, frozen.tuning);
        assert.deepEqual(result, { mask: f.result.mask, rejectedSpace: f.result.rejectedSpace }, `${f.seed}/${f.direction}/${f.scenario}`);
        assert.ok(result.mask === 0 || (result.mask & (result.mask - 1)) === 0);
        if (f.scenario === 'blocked') assert.equal(result.mask, 0);
    }
    assert.equal(rng.randomFloat(), next);
});

test('大口贴墙、排布盖满横向通道或紧邻已有障碍时拒绝放大', () => {
    const h = fixture(), s = h.loadModule('entertainment/GeyserBrawlSafety'), t = h.rules.GEYSER_TUNING;
    const vent = { id: 0, x: 4.5, z: 0, offsetSeconds: 0, size: 'large', mixed: true };
    assert.equal(s.selectGeyserLargeMask(42, 1, 2, [{ ...vent, z: 11 }], 12, [], t).mask, 0);
    assert.equal(s.selectGeyserLargeMask(42, 1, 2, [vent], 2.2, [], t).mask, 0);
    assert.equal(s.selectGeyserLargeMask(42, 1, 2, [vent], 12, [{ x: 4.5, z: 0, radius: 1 }], t).mask, 0);
    assert.equal(s.selectGeyserLargeMask(42, 1, 2, [vent], 12, [], t).mask, 1);
});

test('大小喷泉同轮喷发，大口提前0.3秒预警，两轮泡沫气泡露出实际水面', () => {
    const h = fixture(), r = h.rules, t = r.GEYSER_TUNING;
    const vents = [{ id: 0, x: 10, z: 0, offsetSeconds: 0, size: 'large', mixed: true },
        { id: 1, x: 10, z: 5, offsetSeconds: 0, size: 'small', mixed: true }];
    const views = h.visual.views;
    for (let pulse = 0; pulse < 2; pulse++) {
        const start = pulse * r.geyserCycleSeconds(t);
        h.visual.update(vents, start + .1, 2);
        assert.equal(views[0].root.active, true); assert.equal(views[1].root.active, false);
        h.visual.update(vents, start + .6, 2);
        assert.ok(views.every(v => v.foam.active && !v.jet.active));
        for (const view of views) {
            assert.ok(view.foam.position.y > .055);
            const bubble = view.drops[0];
            const ys = bubble.components[0].mesh.geometry.positions.filter((_, i) => i % 3 === 1);
            assert.ok(Math.max(...ys) * bubble.scale.y + bubble.position.y > .055 + .05);
        }
        h.visual.update(vents, start + 1.79, 2); assert.ok(views.every(v => !v.jet.active));
        h.visual.update(vents, start + 2, 2); assert.ok(views.every(v => v.jet.active));
        near(views[0].jet.scale.y / views[1].jet.scale.y, 1.5);
        near(views[0].foam.scale.x / views[1].foam.scale.x, 1.6);
    }
});

test('大喷口身体命中在15/30/60/120Hz下时刻一致，范围确实大于小口', () => {
    const h = fixture(), b = h.loadModule('swimmer/GeyserBodyContact');
    const vent = { id: 0, x: 0, z: 0, offsetSeconds: 0, size: 'large', mixed: true };
    const times = [];
    for (const fps of [15, 30, 60, 120]) {
        let previous = { ...b.emptyGeyserBodyPose(), x: -2.6 };
        for (let i = 1; i < fps * 2; i++) {
            const from = 2 + (i - 1) / fps, to = 2 + i / fps;
            const current = { ...previous, x: -2.6 + 6 * i / fps };
            const hit = b.sampleGeyserBodyContact(vent, 0, previous, current, from, to, from,
                Math.min(to, 2.749999), 0, .055, b.emptyGeyserContact());
            if (hit.strength === 2) { times.push(hit.time); break; }
            previous = current;
        }
    }
    assert.equal(times.length, 4); assert.ok(Math.max(...times) - Math.min(...times) <= 1 / 240 + 1e-6);
    const pose = { ...b.emptyGeyserBodyPose(), z: 1.85 };
    const hit = v => b.sampleGeyserBodyContact(v, 0, pose, pose, 2.1, 2.11, 2.1, 2.11, 0, .055, b.emptyGeyserContact()).strength;
    assert.ok(hit(vent) > 0); assert.equal(hit({ ...vent, size: 'small' }), 0);
});

test('核心实际命中用大口弹起高度和时长，腾空期间拒绝输入，落水后能继续划水', () => {
    const v = fixture(), a = createAiHarness(), f = actor(a), c = controller(v, [f]);
    f.body.startRace(10, 0); c.update(.1, 10);
    const vent = c.vents.find(vent => vent.size === 'large'); assert.ok(vent);
    const course = f.body.courseLayout;
    const distance = (vent.x - course.startX) / (course.finishX - course.startX) * course.courseLength;
    f.body.startRace(distance, 0); f.body.motor.setLateralOffset(vent.z - f.body.startPosition.z); f.body.stepSimulation(.001);
    const original = f.body.applyGeyserHit.bind(f.body); const accepted = [];
    f.body.applyGeyserHit = (...args) => { const ok = original(...args); if (ok) accepted.push(args); return ok; };
    for (let i = 0; i < 40 && !f.body.isForcedLaunchActive; i++) c.update(.05, 10);
    assert.equal(f.body.isForcedLaunchActive, true);
    const core = accepted.find(args => args[1] === 2); assert.ok(core);
    near(core[3].duration, 1.1); assert.ok(core[3].peakHeight >= 1.35 && core[3].peakHeight <= 1.8);
    const { StrokeType } = a.load('core/GameConstants');
    f.body.handleStrokeHeld(StrokeType.LEFT, true); f.body.handleStroke(StrokeType.LEFT);
    f.body.handleKickStroke(StrokeType.RIGHT, true);
    assert.equal(f.body.motor.isActiveStrokeHeld(StrokeType.LEFT), false);
    for (let i = 0; i < 120; i++) f.body.stepSimulation(1 / 60);
    assert.equal(f.body.isForcedLaunchActive, false);
    f.body.handleStrokeHeld(StrokeType.LEFT, true); f.body.handleStroke(StrokeType.LEFT); f.body.stepSimulation(.02);
    assert.equal(f.body.motor.isActiveStrokeHeld(StrokeType.LEFT), true);
    c.dispose();
});

test('大小喷口赛前定稿，比赛和重赛不再选口，普通喷泉及低强度组合保持两个小口', () => {
    const v = fixture(), a = createAiHarness(), f = actor(a), p = v.loadModule('entertainment/EntertainmentDebugPlan');
    const rng = v.loadModule('core/SharedRNG'); rng.reseedSharedRandom(77);
    const expected = rng.randomFloat(); rng.reseedSharedRandom(77);
    const c = controller(v, [f]); c.update(.1, 10);
    assert.equal(c.vents.length, 4); assert.equal(c.vents.filter(v => v.size === 'large').length, 1);
    const first = c.vents; c.update(.1, 10); assert.equal(c.vents, first);
    assert.equal(rng.randomFloat(), expected);
    c.reset(); f.body.startRace(60, 0); c.update(.1, 60);
    assert.equal(c.serial, 2); assert.equal(c.vents.length, 4); assert.ok(c.vents !== first);
    c.dispose();
    assert.equal(p.buildEntertainmentDebugPlan('geyser', 200).geyserIntensity, 1);
    for (let seed = 0; seed < 50; seed++) assert.equal(p.buildEntertainmentDebugPlan('light-mix', 200, seed).geyserIntensity, 1);
    const small = controller(v, [f], 42, 200, 1); f.body.startRace(10, 0); small.update(.1, 10);
    assert.equal(small.vents.length, 2); assert.ok(small.vents.every(v => v.size !== 'large')); small.dispose();
});

test('新入口先经过正式赛、房间、联机、教学和Boss门禁，旧配置默认关闭', () => {
    const h = fixture(), p = h.loadModule('entertainment/EntertainmentDebugPlan'), options = h.loadModule('core/GameLaunchOptions');
    assert.equal(p.normalizeEntertainmentDebugMode('geyser-large'), 'geyser-large');
    assert.equal(p.entertainmentDebugAllowed(true, false, false, false, false, 'geyser-large'), true);
    for (const i of [0, 1, 2, 3, 4]) {
        const gates = [true, false, false, false, false]; gates[i] = i !== 0;
        assert.equal(p.entertainmentDebugAllowed(...gates, 'geyser-large'), false);
    }
    assert.equal(p.normalizeEntertainmentDebugMode(options.getAiDebugSetup().entertainment), 'none');
    options.setAiDebugSetup({ ...options.getAiDebugSetup(), entertainment: 'geyser-large' });
    assert.equal(options.getAiDebugSetup().entertainment, 'geyser-large');
    const plan = p.buildEntertainmentDebugPlan('geyser-large', 200);
    assert.equal(plan.geyser, true); assert.equal(plan.geyserIntensity, 2);
    assert.equal(plan.supplies.length + plan.debris.length, 0);
    assert.equal(plan.sprayBuoy || plan.whirlpool || plan.giantWave || !!plan.light, false);
});

test('大喷泉仍只加载三份既有GLB，四个相机分层槽位，20次重赛资源数量固定，结束隐藏后零写入', () => {
    const v = fixture(), a = createAiHarness(), f = actor(a); let bound = 0, released = 0;
    const before = v.budget(), r = runtime(v, f, 'geyser-large', { registerFloatingObject() { bound++; return () => released++; } });
    const S = v.loadModule('core/GameConstants').GameState;
    let done = 0; r.prepare(e => { assert.ifError(e); done++; }); assert.equal(done, 1);
    assert.equal(v.requests.length, 3); assert.equal(bound, 4);
    const budget = v.budget(); assert.equal(budget.renderers - before.renderers, 16);
    assert.equal(budget.materials - before.materials, 1); assert.equal(budget.meshes, before.meshes);
    const patches = JSON.stringify(r.geyser.patches), reaction = f.body._geyser;
    for (let round = 0; round < 20; round++) {
        f.body.startRace(10, 0); r.onStateChanged(S.COUNTDOWN); r.onStateChanged(S.RACING); r.update(.1, S.RACING);
        assert.equal(r.geyser.vents.length, 4); assert.ok(r.geyser.vents.filter(v => v.size === 'large').length <= 1);
        r.onStateChanged(S.FINISHED); r.update(.1, S.FINISHED);
        const writes = v.nodes.reduce((n, node) => n + node.writes, 0);
        for (let i = 0; i < 60; i++) r.update(1 / 60, S.FINISHED);
        assert.equal(v.nodes.reduce((n, node) => n + node.writes, 0), writes);
        assert.deepEqual(v.budget(), budget); assert.equal(v.requests.length, 3); assert.equal(f.body._geyser, reaction);
        assert.equal(JSON.stringify(r.geyser.patches), patches);
    }
    r.dispose(); r.dispose(); assert.equal(released, 4); assert.equal(f.body._geyser, null);
    assert.equal(f.body.motor._entertainment, null);
});

test('任一模型失败、迟到回调和第四个相机槽绑定失败均释放已创建部分', () => {
    for (const failureIndex of [0, 1, 2]) {
        const v = fixture(), f = actor(createAiHarness()), r = runtime(v, f); let requests = 0, done = 0;
        v.setLoadOverride((p, type, callback) => requests++ === failureIndex ? callback(new Error('加载失败')) : callback(null, v.prefabs.get(p)));
        const nodes = v.nodes.length, materials = v.materials.length;
        r.prepare(e => { assert.ok(e); done++; }); assert.equal(done, 1); assert.equal(r.disposed, true);
        assert.ok(v.nodes.slice(nodes).every(n => !n.isValid)); assert.ok(v.materials.slice(materials).every(m => m.destroyCount));
        assert.equal(f.body._geyser, null);
    }
    {
        const v = fixture(), f = actor(createAiHarness()), r = runtime(v, f), pending = []; let done = 0;
        v.setLoadOverride((p, t, callback) => pending.push({ p, callback })); r.prepare(e => { assert.ok(e); done++; });
        for (let i = 0; i < 2; i++) { const next = pending.shift(); next.callback(null, v.prefabs.get(next.p)); }
        const late = pending.shift(); r.dispose(); const budget = v.budget();
        late.callback(null, v.prefabs.get(late.p)); assert.equal(done, 1); assert.deepEqual(v.budget(), budget);
    }
    {
        const v = fixture(), f = actor(createAiHarness()); let calls = 0, released = 0, done = 0;
        const r = runtime(v, f, 'geyser-large', { registerFloatingObject() { if (++calls === 4) throw new Error('相机失败'); return () => released++; } });
        const nodes = v.nodes.length, materials = v.materials.length;
        r.prepare(e => { assert.ok(e); done++; }); assert.equal(done, 1); assert.equal(released, 3);
        assert.ok(v.nodes.slice(nodes).every(n => !n.isValid)); assert.ok(v.materials.slice(materials).every(m => m.destroyCount));
    }
});

test('全角色200/400米、30/60Hz含大喷泉均能完赛，返程和弹起后的AI操作继续有效', () => {
    const v = fixture(), a = createAiHarness(), balance = a.load('core/GameBalance');
    const ids = a.load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.map(c => c.id);
    let largeGroups = 0;
    for (const distance of [200, 400]) for (const fps of [30, 60]) for (const id of ids) {
        balance.setRaceDifficulty('competitive'); balance.setSoloRaceDistance(distance);
        a.load('core/SharedRNG').reseedSharedRandom(42);
        const f = actor(a, id, 0), c = controller(v, [f], 42, distance);
        let routeTime = 1, largeSeen = false, reverseSeen = false;
        for (let frame = 0; frame < fps * 600 && f.body.isRacing; frame++) {
            f.step(1 / fps); c.update(1 / fps, f.body.distance); routeTime += 1 / fps;
            largeSeen ||= c.vents.some(v => v.size === 'large'); reverseSeen ||= c.serial >= 2;
            if (routeTime >= .1) { routeTime = 0; f.ai.setEntertainmentTargetZ(c.targetZForAi(f.body)); }
            assert.ok(Number.isFinite(f.body.distance) && Number.isFinite(f.body.node.position.y));
        }
        assert.equal(f.body.isRacing, false, `${id}/${distance}/${fps} 没有完赛`);
        assert.equal(f.body.distance, distance); assert.equal(f.body.isForcedLaunchActive, false); assert.equal(reverseSeen, true);
        if (largeSeen) largeGroups++;
        c.dispose(); f.body.configureEntertainmentGeyser(false);
    }
    assert.equal(largeGroups, ids.length * 4, '每组比赛必须实际出现大口');
});

test('五个大喷泉参数可保存重载，旧配置缺键仍为原版默认值', () => {
    const h = fixture(), saved = new Map();
    Object.assign(h.cc, { JsonAsset: class {}, native: {}, sys: { localStorage: { getItem: k => saved.get(k) ?? null,
        setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) } },
        resources: { load(p, t, callback) { callback(null, { json: { version: 52, values: {} } }); } } });
    const tuning = h.loadModule('core/TuningDebugControls'), t = h.rules.GEYSER_TUNING;
    const controls = tuning.TUNING_GROUPS.flatMap(g => g.controls);
    const values = [['largeRadiusScale', 1.6, 1.7], ['largeJetHeightScale', 1.5, 1.8],
        ['largePeakHeightScale', 1.5, 1.6], ['largeFlightExtraSeconds', .1, .2], ['largeWarningLeadSeconds', .3, .4]];
    tuning.loadSavedTuningAsync(() => {});
    for (const [key, initial, value] of values) { near(t[key], initial); controls.find(c => c.id === 'entertainment.geyser.' + key).set(value); }
    assert.equal(tuning.saveCurrentTuning().ok, true);
    for (const [key, initial] of values) controls.find(c => c.id === 'entertainment.geyser.' + key).set(initial);
    tuning.loadSavedTuningAsync(() => {});
    for (const [key, initial, value] of values) near(t[key], value);
});
