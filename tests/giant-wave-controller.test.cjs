const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

test('完整浪体固定三网格：从小浪长大、到岸才扬水花、余沫最后消失，重开不增资源', () => {
    let destroyed = 0, writes = 0;
    const geometries = [], nodes = [], options = [];
    class Node {
        active = true; isValid = true; layer = 1; eulerAngles = { y: 0 };
        position = { x: 0, y: 0, z: 0 }; scale = { x: 1, y: 1, z: 1 };
        constructor(name) { this.name = name; nodes.push(this); }
        addChild() {} addComponent() { return { setMaterial() {} }; }
        setPosition(x, y, z) { this.position = { x, y, z }; writes++; }
        setScale(x, y, z) { this.scale = { x, y, z }; writes++; }
        setRotationFromEuler(x, y) { this.eulerAngles.y = y; writes++; }
        destroy() { this.isValid = false; }
    }
    class Color { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }
    class Material {
        initialize(value) { options.push(value); }
        setProperty() { writes++; } destroy() { destroyed++; }
    }
    const h = createHarness();
    Object.assign(h.cc, { Node, Material, Color, MeshRenderer: class {}, gfx: { CullMode: { NONE: 0 } },
        utils: { createMesh(g) { geometries.push(g); return { destroy() { destroyed++; } }; } } });
    const { GiantWavePresentation } = h.load(path.join(h.root, 'assets/scripts/core/GiantWavePresentation.ts'));
    const R = h.load(path.join(h.root, 'assets/scripts/core/GiantWaveRules.ts'));
    const p = new GiantWavePresentation(new Node('World'), 0);
    const body = nodes[1], wake = nodes[2], shore = nodes[3];
    assert.equal(geometries.length, 3);
    assert.equal(geometries.reduce((n, g) => n + g.indices.length / 3, 0), 1200);
    for (const g of geometries) {
        assert.ok(g.positions.every(Number.isFinite));
        assert.ok(g.colors.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
        assert.ok(g.indices.every(i => i < g.positions.length / 3));
    }
    assert.ok(options.every(o => o.technique === 1 && o.states.depthStencilState.depthWrite === false));
    const g = geometries[0];
    for (let col = 0; col <= 28; col++) for (let row = 0; row < 12; row++) {
        if (col === 0 || col === 28 || row === 0 || row === 11)
            assert.equal(g.colors[(col * 12 + row) * 4 + 3], 0, '四边透明融入水面');
    }
    assert.ok(g.positions[(2 * 12 + 5) * 3 + 1] < .1, '侧边逐渐降低');
    const s = R.newGiantWaveState(), initialWrites = writes;
    for (let i = 0; i < 60; i++) p.update(s);
    assert.equal(writes, initialWrites, '隐藏时无逐帧工作');
    s.phase = 'active'; s.width = 10; s.length = 6;
    s.startX = 3; s.endX = 47; s.travelDistance = 44;
    for (const dir of [1, -1]) {
        s.direction = dir; s.startX = dir > 0 ? 3 : 47; s.endX = dir > 0 ? 47 : 3;
        s.age = .1; s.x = s.startX + dir * R.waveTravel(s, s.age); p.begin(); p.update(s);
        const smallHeight = body.scale.y, smallWidth = body.scale.z;
        assert.equal(shore.active, false);
        s.age = s.growthTime; s.x = s.startX + dir * R.waveTravel(s, s.age); p.update(s);
        assert.ok(body.scale.y > smallHeight * 5); assert.ok(body.scale.z > smallWidth);
        assert.equal(body.active, true); assert.equal(wake.active, true); assert.equal(shore.active, false);
        const stableWrites = writes; for (let i = 0; i < 60; i++) p.update(s);
        assert.equal(writes, stableWrites, '同一状态不重复写属性');
        s.age = R.waveArrivalTime(s) + .3; s.x = s.endX; p.update(s);
        assert.equal(shore.active, true, '到岸才扬起水片');
        assert.ok(Math.abs(shore.position.x - (dir > 0 ? 50 : 0)) < .03, '使用真实岸边落点');
        s.age = R.waveArrivalTime(s) + s.impactTime + s.fadeTime / 2; p.update(s);
        assert.equal(body.active, false); assert.equal(shore.active, false); assert.equal(wake.active, true);
        s.age = R.waveDuration(s); p.update(s);
        assert.ok(nodes.slice(1).every(n => !n.active), '余沫完全淡出');
        s.phase = 'gap'; const hiddenWrites = writes;
        for (let i = 0; i < 60; i++) p.update(s);
        assert.equal(writes, hiddenWrites); s.phase = 'active';
    }
    assert.equal(geometries.length, 3); assert.equal(nodes.length, 4);
    p.dispose(); assert.equal(destroyed, 6);
});
test('控制器只创建一套表现，AI追浪、HUD、重开和销毁正确清理', () => {
    let built = 0, disposed = 0, sounds = 0, uiBuilds = 0;
    const listeners = new Map();
    class Presentation { constructor() { built++; } begin() {} update() {} hide() {} dispose() { disposed++; } }
    class Strip {
        root = { isValid: true, setPosition() {} }; visible = false;
        constructor() { uiBuilds++; }
        setContent(...args) { this.visible = true; this.content = args; } hide() { this.visible = false; }
        reset() { this.hide(); } dispose() { this.root.isValid = false; }
    }
    const h = createHarness({
        './GiantWavePresentation': { GiantWavePresentation: Presentation },
        '../ui/EntertainmentStatusStrip': { EntertainmentStatusStrip: Strip },
        '../app/StrokeSfxManager': { StrokeSfxManager: { playStroke() { sounds++; } } },
    });
    h.cc.view = {
        getVisibleSize: () => ({ height: 720 }),
        on(name, fn) { listeners.set(name, fn); },
        off(name) { listeners.delete(name); },
    };
    const { GiantWaveController } = h.load(path.join(h.root, 'assets/scripts/core/GiantWaveController.ts'));
    const swimmers = Array.from({ length: 8 }, (_, i) => ({ distance: 10,
        startPosition: { z: i - 3.5 }, motor: { currentSpeed: 3, lateralOffset: 0 },
        canRideGiantWave: true, isGiantWaveRiding: false, giantWaveState: null,
        clearGiantWave() { this.isGiantWaveRiding = false; },
    }));
    const ai = Array.from({ length: 7 }, () => ({ target: null, remoteDriven: false,
        setGiantWaveTargetZ(v) { this.target = v; } }));
    const course = { courseLength: 50, startX: 0, finishX: 50, poolStartX: -2, poolFinishX: 52, poolWidth: 20, waterY: 0,
        distanceToWorldX: d => d, directionAtDistance: () => 1 };
    const events = [], banner = { showEvent(...args) { events.push(args); }, hideEvent() {} };
    const cameraEvents = [];
    const camera = { showGiantWavePreview(state, impact = false) { cameraEvents.push({ impact, x: state.x }); }, updateGiantWave() {} };
    const c = new GiantWaveController({}, {}, course, swimmers, ai, 17, 'three', banner, camera);
    assert.ok(swimmers.every(s => s.giantWaveState === c.simulation.state));
    c.update(.01, true, null);
    assert.equal(c.simulation.state.phase, 'preview');
    assert.ok(ai.some(a => a.target !== null), 'AI 可根据公开预告提前并入或避让');
    for (let i = 0; i < 539; i++) c.update(.01, true, null);
    assert.equal(c.simulation.state.phase, 'active');
    swimmers[0].isGiantWaveRiding = true;
    for (let i = 0; i < 100; i++) c.update(.01, true, null);
    assert.equal(c.strip.visible, true); assert.equal(sounds, 2);
    assert.equal(events.length, 2);
    assert.ok(events[0][0].includes(c.simulation.state.direction > 0 ? '出发端' : '折返端'));
    assert.deepEqual(c.strip.content, ['借浪加速', '继续划水', 'protect']);
    swimmers[0].isGiantWaveRiding = false; swimmers[0].isGiantWaveOpposed = true;
    c.update(.2, true, null);
    assert.deepEqual(c.strip.content, ['迎浪减速', '侧移避浪', 'warning']);
    for (let i = 0; i < 1300; i++) c.update(.01, true, null);
    assert.equal(sounds, 3, '到岸只触发一次拍水声音');
    assert.equal(cameraEvents.length, 2);
    assert.equal(cameraEvents[1].impact, true);
    assert.equal(cameraEvents[1].x, c.simulation.state.endX, '拍岸镜头跟随真实端点');
    c.update(.01, false, null);
    assert.equal(c.strip.visible, false); assert.equal(c.simulation.state.phase, 'waiting');
    assert.ok(ai.every(a => a.target === null));
    for (let i = 0; i < 10; i++) c.reset();
    assert.equal(built, 1); assert.equal(uiBuilds, 1);
    c.dispose();
    assert.equal(disposed, 1); assert.equal(listeners.size, 0);
    assert.ok(swimmers.every(s => s.giantWaveState === null));
});
