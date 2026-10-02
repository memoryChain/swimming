const test = require('node:test');
const assert = require('node:assert/strict');
const { createOutlineHarness } = require('./helpers/turtle-outline-harness.cjs');

function setup() {
    const h = createOutlineHarness();
    const visual = new h.TurtleBusVisual(new h.Node('World'), 7,
        { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 });
    return { ...h, visual };
}

test('异步描边不提前显示海龟，只挂主体与四鳍并共享材质', () => {
    const h = setup();
    assert.equal(h.resources.meshes.length, 7);
    h.pending[0](null, {});
    assert.equal(h.visual.node.active, false);
    assert.equal(h.resources.meshes.length, 12);
    const nodes = [h.visual.body, ...h.visual.fins].map(n => n.children.find(c => c.name === 'TurtleOutline'));
    assert.equal(nodes.length, 5);
    assert.ok(nodes.every(n => n && n.layer === 7));
    assert.equal(new Set(nodes.map(n => n.renderers[0].material)).size, 1);
    assert.ok([...h.visual.rings, ...h.visual.ropes].every(n => n.children.length === 0));
    for (const direction of [1, -1]) for (const age of [0, 2, 7, 12]) {
        h.visual.update(age, direction, 1.3);
        for (const n of nodes) {
            assert.deepEqual(n.worldMatrix, n.parent.worldMatrix);
            assert.equal(n.writes, 0);
        }
    }
    h.visual.dispose();
    assert.ok(h.resources.meshes.every(m => m.destroyed === 1));
    assert.ok(h.resources.materials.every(m => m.destroyed === 1));
});

test('描边开关在加载前后均有效，多次切换不增加模型和材质', () => {
    const h = setup(); h.visual.setOutlineVisible(false); h.pending[0](null, {});
    const nodes = [h.visual.body, ...h.visual.fins].map(n => n.children.find(c => c.name === 'TurtleOutline'));
    assert.ok(nodes.every(n => !n.active));
    for (let i = 0; i < 30; i++) { h.visual.setOutlineVisible(true); h.visual.setOutlineVisible(true); h.visual.setOutlineVisible(false); }
    assert.equal(h.resources.meshes.length, 12); assert.equal(h.resources.materials.length, 2);
    h.visual.dispose();
});

test('效果加载失败与销毁后晚回调不会产生残留资源', () => {
    for (const late of [false, true]) {
        const h = setup();
        if (late) h.visual.dispose();
        h.pending[0](late ? null : new Error('模拟资源失败'), late ? {} : null);
        assert.equal(h.resources.meshes.length, 7); assert.equal(h.resources.materials.length, 1);
        if (!late) h.visual.dispose();
        assert.ok(h.resources.meshes.every(m => m.destroyed === 1));
    }
});

test('描边网格法线连续有效且额外预算限制在750三角面以内', () => {
    const h = setup(); h.pending[0](null, {});
    const data = h.resources.meshes.slice(7).map(m => m.data);
    assert.equal(data.reduce((s, g) => s + g.indices.length / 3, 0), 700);
    for (const g of data) {
        assert.equal(g.normals.length, g.positions.length);
        assert.ok(g.indices.every(i => Number.isInteger(i) && i >= 0 && i < g.positions.length / 3));
        for (let i = 0; i < g.normals.length; i += 3)
            assert.ok(Math.abs(Math.hypot(...g.normals.slice(i, i + 3)) - 1) < 2e-6);
    }
    h.visual.dispose();
});
