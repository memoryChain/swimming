const test = require('node:test');
const assert = require('node:assert/strict');
const { createImportedMeshHarness } = require('./helpers/imported-mesh-harness.cjs');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');

// 用排序后的危险区间独立检查一排的剩余通道，避免复用被测函数的判断。
function rowHasGap(vents, row, mask, halfWidth, tuning) {
    const intervals = vents.filter(v => Math.floor(v.id / 4) === row).map(v => {
        const radius = tuning.edgeRadius * (mask & (1 << v.id) ? tuning.largeRadiusScale : 1) + .25;
        return [v.z - radius, v.z + radius];
    }).sort((a, b) => a[0] - b[0]);
    const bound = halfWidth - .8;
    let covered = -bound;
    for (const [from, to] of intervals) {
        if (from > covered) return true;
        covered = Math.max(covered, to);
        if (covered >= bound) return false;
    }
    return covered < bound;
}

test('3200组排布保留大口上限、池边通道和错峰，不依赖选手状态', () => {
    const h = createImportedMeshHarness('geyser');
    const rules = h.loadModule('entertainment/GeyserBrawlRules');
    const { selectGeyserLargeMask } = h.loadModule('entertainment/GeyserBrawlSafety');
    const tuning = rules.GEYSER_TUNING;
    let cases = 0, fullFive = 0;
    for (const intensity of [2, 3, 4, 5]) for (const seed of Array.from({ length: 200 }, (_, i) => i))
        for (const direction of [-1, 1]) for (const serial of [1, 2]) {
        const vents = rules.planGeyserVents(seed, serial, intensity, direction * 15, 0, 25, 12, direction);
        const result = selectGeyserLargeMask(seed, serial, intensity, vents, 12, [], tuning);
        assert.deepEqual(selectGeyserLargeMask(seed, serial, intensity, vents, 12, [], tuning), result);
        const large = vents.filter(v => result.mask & (1 << v.id));
        assert.ok(large.length > 0 && large.length <= rules.geyserSpec(intensity).largeCount);
        for (const v of large) assert.ok(Math.abs(v.z) + tuning.edgeRadius * tuning.largeRadiusScale + .25 <= 12);
        for (let i = 0; i < large.length; i++) for (let j = i + 1; j < large.length; j++) {
            assert.notEqual(Math.floor(large[i].id / 4), Math.floor(large[j].id / 4));
            const gap = Math.abs(large[i].offsetSeconds - large[j].offsetSeconds);
            assert.ok(gap >= tuning.burstSeconds + .02);
            assert.ok(rules.geyserCycleSeconds(tuning) - gap >= tuning.burstSeconds + .02);
        }
        for (let row = 0; row <= Math.floor((vents.length - 1) / 4); row++) assert.ok(rowHasGap(vents, row, result.mask, 12, tuning));
        if (intensity === 5 && large.length === 3) fullFive++;
        cases++;
    }
    assert.equal(cases, 3200);
    assert.ok(fullFive > 400, '五档仍要经常出现三个大口，不能以关闭大口代替优化');
});

test('无横向通道的排布与贴近已有障碍仍拒绝大口，不跳过空间限制', () => {
    const h = createImportedMeshHarness('geyser'), rules = h.loadModule('entertainment/GeyserBrawlRules');
    const { selectGeyserLargeMask } = h.loadModule('entertainment/GeyserBrawlSafety');
    const tuning = rules.GEYSER_TUNING;
    const vents = [-1.8, -.6, .6, 1.8].map((z, id) => ({ id, x: 10, z, offsetSeconds: id * .08 }));
    const covered = selectGeyserLargeMask(42, 1, 2, vents, 4, [], tuning);
    assert.equal(covered.mask, 0); assert.equal(covered.rejectedSpace, 4);
    const open = [{ id: 0, x: 10, z: 0, offsetSeconds: 0 }];
    assert.equal(selectGeyserLargeMask(42, 1, 2, open, 12, [], tuning).mask, 1);
    assert.equal(selectGeyserLargeMask(42, 1, 2, open, 12, [{ x: 10, z: 0, radius: 1 }], tuning).mask, 0);
});

test('赛前选定所有泳段，重赛及正返程启动不再选口或读取选手来生成排布', () => {
    const h = createImportedMeshHarness('geyser'), a = createAiHarness();
    const f = a.create('cartonSwimmer6', 5, .7, 0);
    f.body.cartoonRig.geyserBodyScale = 1; f.body.cartoonRig.geyserBodyPivot = { x: 0, y: 0, z: 0 };
    const originalSample = f.body.sampleGeyserBody.bind(f.body);
    let samples = 0;
    f.body.sampleGeyserBody = (...args) => { samples++; return originalSample(...args); };
    const safety = h.loadModule('entertainment/GeyserBrawlSafety'), originalSelect = safety.selectGeyserLargeMask;
    let selections = 0;
    safety.selectGeyserLargeMask = (...args) => { selections++; return originalSelect(...args); };
    const C = h.loadModule('entertainment/GeyserRaceController').GeyserRaceController;
    const c = new C(h.root, f.body.courseLayout, [f.body], 42, 400, h.assets, null, null, 5);
    assert.equal(samples, 0); assert.equal(selections, c.patches.length);
    assert.ok(c.patches.every(p => p.vents.some(v => v.size === 'large')));
    const planned = c.patches.map(p => p.vents);
    safety.selectGeyserLargeMask = () => { throw new Error('比赛中禁止生成喷泉排布'); };
    for (let round = 0; round < 20; round++) {
        c.reset();
        for (let i = 0; i < c.patches.length; i++) {
            const p = c.patches[i]; f.body.startRace(p.anchorDistance, 0); samples = 0;
            c.update(.1, p.anchorDistance);
            assert.equal(c.vents, planned[i]); assert.equal(samples, 1, '启动只采一次实际命中所需的身体基线');
            c.update(c.spec.actionSeconds, p.anchorDistance);
        }
    }
    c.dispose();
});
