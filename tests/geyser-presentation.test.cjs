const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeyserPresentationHarness } = require('./helpers/geyser-presentation-harness.cjs');
const vent = [{ id: 0, x: 0, z: 0, offsetSeconds: 0 }];

test('联机水柱表现使用固定喷发时长，不受本机调参影响', () => {
    const h = createGeyserPresentationHarness(1);
    const fixed = h.rules.geyserTuningForRace(true);
    const previous = h.rules.GEYSER_TUNING.burstSeconds;
    try {
        h.rules.GEYSER_TUNING.burstSeconds = .35;
        h.visual.update(vent, 2.3, 2, Infinity, fixed);
        assert.ok(h.snapshot().some(n => n.name === 'WaterJetAndCrown'));
        h.visual.hide();
        h.visual.update(vent, 2.3, 2);
        assert.ok(!h.snapshot().some(n => n.name === 'WaterJetAndCrown'));
    } finally { h.rules.GEYSER_TUNING.burstSeconds = previous; }
});

test('预警气泡持续上浮，水面泡沫在真实水面上，喷发前无水柱', () => {
    const h = createGeyserPresentationHarness(1, 0.18);
    h.visual.update(vent, 0.1, 2);
    const first = h.snapshot();
    const bubble = first.find(n => n.name === 'BubblesAndDropsA');
    assert.ok(bubble.matrix[13] < 0);
    assert.ok(first.find(n => n.name === 'SurfaceFoam').matrix[13] > 0.18);
    assert.ok(!first.some(n => n.name === 'WaterJetAndCrown'));
    h.visual.update(vent, 0.5, 2);
    assert.ok(h.snapshot().find(n => n.name === 'BubblesAndDropsA').matrix[13] > bubble.matrix[13]);
});

test('水冠喷出后碎水按弧线落下，水柱先消散，泡沫最后结束', () => {
    const h = createGeyserPresentationHarness(1);
    h.visual.update(vent, 1.7, 1);
    assert.ok(h.snapshot().some(n => n.name === 'WaterJetAndCrown'));
    h.visual.update(vent, 2.15, 1);
    assert.ok(h.snapshot().find(n => n.name === 'BubblesAndDropsA').matrix[13] < 0.4);
    h.visual.update(vent, 2.2, 1);
    assert.ok(!h.snapshot().some(n => n.name === 'BubblesAndDropsA'));
    h.visual.update(vent, 2.25, 1);
    assert.ok(h.snapshot().find(n => n.name === 'BubblesAndDropsA').matrix[13] > 1);
    h.visual.update(vent, 2.47, 1);
    const high = h.snapshot().find(n => n.name === 'BubblesAndDropsA');
    h.visual.update(vent, 2.8, 1);
    const low = h.snapshot().find(n => n.name === 'BubblesAndDropsA');
    assert.ok(low.matrix[13] < high.matrix[13]);
    assert.ok(!h.snapshot().some(n => n.name === 'WaterJetAndCrown'));
    h.visual.update(vent, 3, 1);
    assert.deepEqual(h.snapshot().map(n => n.name), ['SurfaceFoam']);
    h.visual.update(vent, 3.25, 1);
    assert.equal(h.snapshot().length, 0);
});

test('水束从真实水面生长，破水和回落时所有水柱顶点始终留在水面以上', () => {
    let referencePeak;
    for (const waterY of [0, 0.055, 0.18]) {
        const h = createGeyserPresentationHarness(1, waterY);
        h.visual.update(vent, 1.54, 1);
        assert.ok(!h.snapshot().some(n => n.name === 'WaterJetAndCrown'), '柱顶未出水时不能提前显示水冠');
        for (let step = 46; step < 89; step++) {
            h.visual.update(vent, step / 30, 1);
            const jet = h.snapshot().find(n => n.name === 'WaterJetAndCrown');
            if (!jet) continue;
            const positions = h.meshes[jet.mesh].geometry.positions;
            assert.ok(Math.abs(jet.matrix[13] - waterY) < 1e-6);
            for (let vertex = 0; vertex < positions.length; vertex += 3) {
                const worldY = jet.matrix[1] * positions[vertex] + jet.matrix[5] * positions[vertex + 1]
                    + jet.matrix[9] * positions[vertex + 2] + jet.matrix[13];
                assert.ok(worldY >= waterY - 1e-6);
            }
        }
        h.visual.update(vent, 1.8, 1);
        const jet = h.snapshot().find(n => n.name === 'WaterJetAndCrown');
        const points = h.meshes[jet.mesh].geometry.positions;
        let peak = -Infinity;
        for (let i = 1; i < points.length; i += 3) peak = Math.max(peak, points[i] * jet.matrix[5] + jet.matrix[13]);
        assert.ok(peak > 1.15 && peak < 1.3);
        if (referencePeak === undefined) referencePeak = peak;
        else assert.ok(Math.abs(peak - referencePeak) < 1e-6, '水位变化不抬高或压低水冠峰值');
    }
});

test('十口按固定资源循环，无逐帧网格生成；隐藏、停排和销毁不会补旧喷发', () => {
    const h = createGeyserPresentationHarness();
    const vents = h.rules.planGeyserVents(42, 1, 5, 0, 0, 25, 10.5);
    const original = h.budget();
    assert.equal(original.meshes, 3); assert.equal(original.materials, 1);
    assert.equal(original.nodes, 50); assert.equal(original.renderers, 40);
    assert.ok(original.triangles.reduce((a,b) => a+b, 0) < 500);
    let peak = 0;
    for (let replay = 0; replay < 20; replay++) {
        for (let step = 0; step < 450; step++) {
            h.visual.update(vents, step / 30, 3);
            peak = Math.max(peak, h.snapshot().length);
        }
        h.visual.hide();
        assert.equal(h.snapshot().length, 0);
    }
    assert.ok(peak <= 40);
    assert.deepEqual(h.budget(), original);
    h.visual.update(vents, 0.7, 3, -1);
    assert.equal(h.snapshot().length, 0);
    const writes = h.nodes.reduce((n, node) => n + node.writes, 0);
    h.visual.update(vents, 0.71, 3, -1);
    assert.equal(h.nodes.reduce((n, node) => n + node.writes, 0), writes);
    h.visual.dispose(); h.visual.dispose(); h.visual.update(vents, 2, 3);
    assert.ok(h.meshes.every(m => m.destroyCount === 1));
    assert.ok(h.materials.every(m => m.destroyCount === 1));
    assert.ok(h.root.children.every(n => !n.isValid));
});

test('纯时钟恢复与连续播放一致，停排只允许已经预警的喷口收尾', () => {
    const continuous = createGeyserPresentationHarness(1);
    const restored = createGeyserPresentationHarness(1);
    for (let step = 0; step <= 70; step++) continuous.visual.update(vent, step / 30, 3);
    restored.visual.update(vent, 70 / 30, 3);
    assert.deepEqual(restored.snapshot(), continuous.snapshot());
    restored.visual.update(vent, 2.5, 3, 1);
    assert.ok(restored.snapshot().length > 0);
    restored.visual.update(vent, 5, 3, 1);
    assert.equal(restored.snapshot().length, 0);
});
