const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { createBuoyHarness } = require('./helpers/spray-buoy-harness.cjs');
const { runCannonScenario } = require('./helpers/cannon-scenarios.cjs');
const frozen = require('./fixtures/butterfly-cannon-double.json');
const fixture = () => { const h = createHarness(); return { ...h, load: n => h.load(path.join(h.root, 'assets/scripts', n + '.ts')) }; };
const modes = ['cannon-four', 'cannon-five'];
const cannon = (mode = modes[0], distance = 200, ids) => createBuoyHarness(42, distance, ids, mode);
const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
function position(s, distance, z) {
    s.motor.setFlipTurnDistance(distance); s.motor.setLateralOffset(z - s.startPosition.z);
    s.node.setPosition(s.courseLayout.distanceToWorldX(distance), s.courseLayout.swimY, z);
}

test('双发四五档沿用来源发数、间隔和触发进度；只开放本地AI，单发与组合保持', () => {
    const h = fixture(), p = h.load('entertainment/EntertainmentDebugPlan');
    for (const spec of frozen.specs) for (const distance of [200, 400]) {
        const mode = `cannon-${spec.level === 4 ? 'four' : 'five'}`;
        assert.equal(p.normalizeEntertainmentDebugMode(mode), mode);
        const plan = p.buildEntertainmentDebugPlan(mode, distance, 42), c = plan.cannonPlan;
        assert.ok(plan.cannon && !plan.sprayBuoy && !plan.geyser && !plan.giantWave && !plan.whirlpool && !plan.light && !plan.supplies.length && !plan.debris.length);
        assert.equal(c.maxConcurrentLaunches, spec.concurrency); assert.equal(c.minimumLaunchIntervalSeconds, spec.interval);
        assert.deepEqual(c.triggers, Array.from({ length: distance === 400 ? spec.strikes400 : spec.strikes200 }, (_, i) => 20 + i * 3));
        assert.equal(p.entertainmentDebugAllowed(true, false, false, false, false, mode), true);
        for (const args of [[false, false, false, false, false], [true, true, false, false, false], [true, false, true, false, false], [true, false, false, true, false], [true, false, false, false, true]])
            assert.equal(p.entertainmentDebugAllowed(...args, mode), false);
    }
    assert.equal(p.buildEntertainmentDebugPlan('light-mix', 200, 42).cannon, false);
    assert.equal(p.buildCannonDebugPlan('cannon', 200).maxConcurrentLaunches, 1);
    assert.equal(p.buildCannonDebugPlan('cannon', 400).minimumLaunchIntervalSeconds, 0);
    assert.equal(p.buildCannonDebugPlan('none', 200), null);
});

test('72组双发落点、取消、命中和AI避让与固定来源一致，公共随机序列不变', () => {
    const h = fixture(), C = h.load('entertainment/CannonBrawlController').CannonBrawlController;
    const p = h.load('entertainment/EntertainmentDebugPlan'), rng = h.load('core/SharedRNG');
    rng.reseedSharedRandom(71); const expected = rng.randomFloat(); rng.reseedSharedRandom(71);
    let overlapping = 0;
    for (const f of frozen.fixtures) {
        const plan = p.buildCannonDebugPlan(f.level === 4 ? modes[0] : modes[1], f.raceDistance);
        const actual = runCannonScenario((racers, world, launch, impact) => {
            const c = new C(4, f.seed, 24, l => racers[l], launch, impact, f.raceDistance - 20, world,
                plan.triggers, plan.maxConcurrentLaunches, plan.minimumLaunchIntervalSeconds);
            return { step: dt => { c.update(dt); if (c.currentSecondaryLaunch()) overlapping++; }, ai: (...args) => c.targetZForAi(...args) };
        }, f.seed, f.length, f.raceDistance, f.fps);
        assert.deepEqual({ level: f.level, ...actual }, f, `${f.level}/${f.seed}/${f.length}/${f.raceDistance}/${f.fps}`);
    }
    assert.ok(overlapping > 0, '固定记录必须真正覆盖两发同时飞行');
    assert.equal(rng.randomFloat(), expected);
});

test('每次最多发一球、至少保留横移空隙，窄池放不下就取消；停止新发后两球仍落水且不重复命中', () => {
    const h = fixture(), C = h.load('entertainment/CannonBrawlController').CannonBrawlController;
    for (const width of [8, 24]) {
        const racers = [{ active: true, finished: false, damageable: true, distance: 40, lateral: 0, speed: 2 }];
        const launches = [], impacts = [], c = new C(1, 42, width, i => racers[i], e => launches.push(e), e => impacts.push(e), 180, d => d, [0, 0, 0, 0], 2, .85);
        c.update(.01); assert.equal(launches.length, 1);
        for (let i = 0; i < 8; i++) c.update(.1);
        assert.equal(launches.length, 1); c.update(.05);
        if (width === 8) { assert.equal(c.currentSecondaryLaunch(), null); assert.equal(launches.length, 1); }
        else {
            assert.equal(launches.length, 2); assert.ok(c.currentSecondaryLaunch());
            assert.ok(Math.abs(launches[1].targetZ - launches[0].targetZ) >= 6.4 - 1e-10);
        }
        c.stopNewStrikes(); for (let i = 0; i < 80; i++) c.update(.1);
        assert.equal(impacts.length, launches.length); assert.equal(new Set(impacts.map(e => e.strikeId)).size, impacts.length);
        assert.equal(c.currentLaunch(), null); assert.equal(c.currentSecondaryLaunch(), null);
        c.reset(); c.update(.01); assert.equal(c.currentLaunch().strikeId, 0);
    }
});

test('两发在同一步落水分别结算，第一发进入保护的人不会抢走第二发的击倒名额', () => {
    const h = fixture(), C = h.load('entertainment/CannonBrawlController').CannonBrawlController;
    const racers = Array.from({ length: 2 }, () => ({ active: true, finished: false, damageable: true, distance: 40, lateral: 0, speed: 2 }));
    const launches = [], hits = [], c = new C(2, 42, 24, i => racers[i], e => launches.push(e), e => {
        hits.push(e);
        if (e.knockedLane >= 0) racers[e.knockedLane].damageable = false;
        // 第一发命中者紧接着处在另一爆心，用于验证第二发必须读到最新保护状态。
        if (hits.length === 1) racers[0].lateral = launches[1].targetZ;
    }, 180, () => 0, [0, 0], 2, .85);
    c.update(.01); c.update(.9); assert.equal(launches.length, 2);
    racers[0].lateral = launches[0].targetZ; racers[1].lateral = launches[1].targetZ;
    c.update(2);
    assert.deepEqual(hits.map(e => e.knockedLane), [0, 1]);
    assert.deepEqual(hits.map(e => e.hitMask), [1, 2]);
    assert.deepEqual(hits.map(e => e.targetZ), launches.map(e => e.targetZ));
});

test('两颗水球有独立轨迹与水线；第一发落水不盖掉第二发，第二发接续计时不重播', () => {
    const h = cannon(); h.runtime.prepare(assert.ifError); h.runtime.onStateChanged(h.state.COUNTDOWN);
    const p = h.runtime.cannon.presentation, shots = [
        { strikeId: 0, targetDistance: 35, targetZ: -5, warningSeconds: 1.25, revision: 1 },
        { strikeId: 1, targetDistance: 77, targetZ: 5, warningSeconds: 3, revision: 2 },
    ];
    for (const shot of shots) p.showLaunch(shot);
    const first = p.flights[0], second = p.flights[1], target = second.target.clone(), source = second.source.clone();
    p.update(.05, shots[0], .625, shots[1], 1.5);
    for (const f of p.flights) {
        assert.ok(f.marker.active && f.projectile.active);
        near(f.projectile.worldPosition.x, (f.source.x + f.target.x) / 2);
        near(f.projectile.worldPosition.y, (f.source.y + f.target.y) / 2 + 5.8);
        assert.equal(f.projectile.components[0].material.name, 'RuntimeEntertainmentWaterline');
    }
    p.showImpact({ strikeId: 0, hitMask: 0, knockedLane: -1, knockedDistance: 0, targetZ: -5, revision: 3 });
    assert.ok(!first.marker.active && !first.projectile.active); assert.ok(second.marker.active && second.projectile.active);
    p.update(.05, shots[1], .75);
    assert.ok(h.Vec3.equals(second.source, source) && h.Vec3.equals(second.target, target));
    near(second.projectile.worldPosition.x, source.x + (target.x - source.x) * .75);
    p.showImpact({ strikeId: 1, hitMask: 0, knockedLane: -1, knockedDistance: 0, targetZ: 5, revision: 4 });
    assert.equal(h.runtime.cannon.splashes.slots.filter(s => s.root.active).length, 2);
    const splashPositions = h.runtime.cannon.splashes.slots.map(s => s.root.worldPosition);
    near(splashPositions[0].x, first.target.x); near(splashPositions[0].z, -5);
    near(splashPositions[1].x, second.target.x); near(splashPositions[1].z, 5);
    p.hide(); h.runtime.cannon.splashes.reset(); const writes = h.nodes.reduce((v, n) => v + n.writes, 0);
    for (let i = 0; i < 120; i++) { p.update(1 / 60, null, 0); h.runtime.cannon.splashes.update(1 / 60); }
    assert.equal(h.nodes.reduce((v, n) => v + n.writes, 0), writes); h.runtime.dispose(); assert.equal(h.layers.size, 0);
});

test('双发九个加载点失败、加载中退出和十个相机层绑定点异常都完整清理', () => {
    for (const mode of modes) {
        for (let fail = 0; fail < 9; fail++) {
            const h = cannon(mode), pending = []; let index = 0, done = 0, error;
            h.setLoadOverride((p, t, cb) => pending.push({ p, cb })); h.runtime.prepare(e => { done++; error = e; });
            while (pending.length) { assert.equal(done, 0); const { p, cb } = pending.shift(); cb(index++ === fail ? new Error('资源失败') : null, h.prefabs.get(p)); }
            assert.ok(error); assert.equal(done, 1); assert.equal(h.layers.size, 0); assert.equal(h.liveBudget().materials, 0);
            assert.equal(h.liveBudget().nodes, 3); assert.ok(h.meshes.every(m => m.destroyCount === 0));
        }
        const late = cannon(mode), pending = []; let done = 0;
        late.setLoadOverride((p, t, cb) => pending.push({ p, cb })); late.runtime.prepare(e => { assert.ok(e); done++; });
        late.runtime.dispose(); pending[0].cb(null, late.prefabs.get(pending[0].p)); assert.equal(done, 1); assert.equal(late.layers.size, 0);
        for (let failAt = 1; failAt <= 10; failAt++) {
            const h = cannon(mode); let count = 0, error;
            h.runtime.waterLayers = { registerFloatingObject(n) { if (++count === failAt) throw new Error('绑定失败'); h.layers.add(n); return () => h.layers.delete(n); } };
            h.runtime.prepare(e => error = e); assert.ok(error); assert.equal(h.layers.size, 0);
            assert.equal(h.liveBudget().materials, 0); assert.equal(h.liveBudget().nodes, 3);
            assert.ok(h.actors.every(a => a.body.cartoonRig.onEntertainmentRecoveryFloat === null));
        }
    }
});

test('八人双发池反复重赛不增建或加载，共用四份材质；完赛取消后续但两球继续落水，隐藏零写入', () => {
    const ids = fixture().load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.slice(0, 8).map(d => d.id);
    for (const mode of modes) {
        const h = cannon(mode, 200, ids); h.runtime.prepare(assert.ifError);
        const budget = h.liveBudget(), loads = h.requests.length;
        assert.equal(budget.renderers, 22); assert.equal(budget.materials, 4); assert.equal(h.layers.size, 16);
        for (let round = 0; round < 20; round++) {
            h.runtime.onStateChanged(h.state.COUNTDOWN); h.runtime.onStateChanged(h.state.RACING);
            for (const a of h.actors) { a.body.startRace(0, .8); a.ai.startSwimming(); position(a.body, 60, 0); }
            h.runtime.update(.01, h.state.RACING);
            for (let i = 0; i < 11; i++) h.runtime.update(.1, h.state.RACING);
            const c = h.runtime.cannon; assert.ok(c.rules.currentLaunch() && c.rules.currentSecondaryLaunch());
            position(h.actors[0].body, 200, 0); h.runtime.update(.1, h.state.RACING);
            for (let i = 0; i < 25; i++) h.runtime.update(.1, h.state.RACING);
            assert.equal(c.rules.currentLaunch(), null); assert.equal(c.rules.currentSecondaryLaunch(), null);
            assert.deepEqual(h.liveBudget(), budget); assert.equal(h.requests.length, loads); assert.equal(h.layers.size, 16);
            h.runtime.onStateChanged(h.state.FINISHED);
            const writes = h.nodes.reduce((v, n) => v + n.writes, 0);
            for (let i = 0; i < 120; i++) h.runtime.update(1 / 60, h.state.FINISHED);
            assert.equal(h.nodes.reduce((v, n) => v + n.writes, 0), writes);
        }
        h.runtime.dispose(); assert.equal(h.layers.size, 0); assert.equal(h.liveBudget().materials, 0);
    }
});

test('双发全部角色在200/400米30/60Hz可完赛，真实击倒后保留体力与蓄气并恢复', () => {
    const ids = fixture().load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.map(d => d.id);
    for (const mode of modes) for (const distance of [200, 400]) for (const fps of [30, 60]) for (const group of [ids.slice(0, 8), ids.slice(8)]) {
        const h = cannon(mode, distance, group); h.runtime.prepare(assert.ifError);
        h.runtime.onStateChanged(h.state.COUNTDOWN); h.runtime.onStateChanged(h.state.RACING);
        const a = h.actors[0].body, c = h.runtime.cannon, budget = h.liveBudget(), loads = h.requests.length;
        position(a, 20, 0); h.runtime.update(1 / fps, h.state.RACING);
        const shot = c.rules.currentLaunch(); assert.ok(shot); position(a, shot.targetDistance, shot.targetZ);
        h.actors[0].condition.consumeEnergy(h.actors[0].condition.energyTotal * .1); a.ultimate.applyNetEnergy(37, 1);
        const energy = h.actors[0].condition.energyRatio, charge = a.ultimate.energy;
        for (let i = 0; i < Math.ceil(shot.warningSeconds * fps) + 1; i++) h.runtime.update(1 / fps, h.state.RACING);
        assert.ok(a.isEntertainmentKnocked); assert.equal(c.states[0].damageable, false); const recoveryDistance = a.distance;
        for (let i = 0; i < fps * 4; i++) h.runtime.update(1 / fps, h.state.RACING);
        assert.ok(!a.isEntertainmentKnocked && a.isRacing && a.isEntertainmentInvulnerable);
        near(a.distance, recoveryDistance); near(h.actors[0].condition.energyRatio, energy); assert.equal(a.ultimate.energy, charge);
        for (let frame = 0; frame < fps * 600; frame++) {
            h.runtime.update(1 / fps, h.state.RACING); for (const f of h.actors) if (f.body.distance < distance) f.step(1 / fps);
            if (h.actors.every(f => f.body.distance >= distance)) break;
        }
        for (const f of h.actors) assert.ok(f.body.distance >= distance, `${mode}/${f.profile.characterId}/${distance}/${fps}未完赛`);
        assert.deepEqual(h.liveBudget(), budget); assert.equal(h.requests.length, loads); h.runtime.dispose(); assert.equal(h.layers.size, 0);
    }
});

test('双发间隔可调并保存，旧配置缺键使用来源默认；赛前计划不随之后调参改变', () => {
    const h = fixture(), saved = new Map();
    Object.assign(h.cc, { JsonAsset: class {}, native: {}, sys: { localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) } },
        resources: { load(p, t, cb) { cb(null, { json: { version: 52, values: {} } }); } } });
    const t = h.load('core/TuningDebugControls'), p = h.load('entertainment/EntertainmentDebugPlan');
    const b = h.load('core/EntertainmentBalance').CANNON_BRAWL_TUNING;
    t.loadSavedTuningAsync(() => {}); near(b.fourMinimumIntervalSeconds, 1); near(b.fiveMinimumIntervalSeconds, .85);
    const before = modes.map(m => p.buildCannonDebugPlan(m, 200));
    for (const key of ['fourMinimumIntervalSeconds', 'fiveMinimumIntervalSeconds']) {
        const entry = t.TUNING_GROUPS.flatMap(s => s.controls).find(c => c.id === `entertainment.cannon.${key}`);
        assert.ok(entry); entry.set(1.5); assert.equal(t.saveCurrentTuning().ok, true);
        entry.set(.85); t.loadSavedTuningAsync(() => {}); near(b[key], 1.5);
    }
    near(before[0].minimumLaunchIntervalSeconds, 1); near(before[1].minimumLaunchIntervalSeconds, .85);
    for (const mode of modes) near(p.buildCannonDebugPlan(mode, 200).minimumLaunchIntervalSeconds, 1.5);
});
