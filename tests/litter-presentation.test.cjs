// 执行真实网格生成与显示层；渲染外壳只统计节点、资源和属性写入，不启动 Creator。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function compiler() {
    try { return require('typescript'); } catch {}
    for (const dir of process.env.PATH.split(path.delimiter)) {
        const candidate = path.resolve(dir, '../typescript/lib/typescript.js');
        if (fs.existsSync(candidate)) return require(candidate);
    }
    throw new Error('请用 npm run test:litter，需固定 typescript@5.4.5');
}
const ts = compiler();

function fixture() {
    const stats = { nodes: 0, meshes: 0, materials: 0, meshWrites: 0, activeWrites: 0,
        scaleWrites: 0, transformWrites: 0, destroyedMeshes: 0, splashes: 0 };
    class Vec3 {
        constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
        set(x, y, z) { this.x = x; this.y = y; this.z = z; }
    }
    class MeshRenderer {
        set mesh(value) { this._mesh = value; stats.meshWrites++; }
        get mesh() { return this._mesh; }
        setSharedMaterial() {}
        setMaterial(material) { this.material = material; }
    }
    class Node {
        constructor(name) {
            this.name = name; this.isValid = true; this.children = []; this._active = true;
            this.scale = new Vec3(1, 1, 1); stats.nodes++;
        }
        set active(value) { this._active = value; stats.activeWrites++; }
        get active() { return this._active; }
        setParent(parent) { this.parent = parent; parent.children.push(this); }
        addComponent(Type) { return this.renderer = new Type(); }
        getComponent() { return this.renderer; }
        setWorldPosition(x, y, z) { this.position = { x, y, z }; stats.transformWrites++; }
        setRotationFromEuler(x, y, z) { this.rotation = { x, y, z }; stats.transformWrites++; }
        setScale(x, y, z) { this.scale.set(x, y, z); stats.scaleWrites++; }
        destroy() { this.isValid = false; }
    }
    const meshes = [];
    class Material {
        constructor() { stats.materials++; }
        initialize(info) { this.info = info; }
        setProperty() {}
        destroy() {}
    }
    const cc = { Node, Vec3, MeshRenderer, Material, Color: { WHITE: {} }, utils: { createMesh(data) {
        stats.meshes++;
        const mesh = { data, destroy() { stats.destroyedMeshes++; } };
        meshes.push(mesh); return mesh;
    } } };
    const mocks = {
        cc,
        './EntertainmentWaterSplash': { ENTERTAINMENT_SPLASH_OWNER: { LITTER: 1 },
            ENTERTAINMENT_SPLASH_PROFILE: { HEAVY_ENTRY: 1, LIGHT_ENTRY: 2 } },
    };
    const cache = new Map();
    function load(file) {
        if (cache.has(file)) return cache.get(file);
        const module = { exports: {} };
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        } }).outputText;
        const local = id => mocks[id] ?? load(path.resolve(path.dirname(file), id + '.ts'));
        vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(local, module, module.exports);
        cache.set(file, module.exports); return module.exports;
    }
    const core = path.resolve(__dirname, '../assets/scripts/core');
    const geometry = load(path.join(core, 'LitterDebrisGeometry.ts'));
    const { LitterBrawlPresentation } = load(path.join(core, 'LitterBrawlPresentation.ts'));
    const root = new Node('world');
    const splashRequests = [];
    const presentation = new LitterBrawlPresentation(root,
        { distanceToWorldX: x => x, poolWidth: 21, waterY: 0.055 }, 18,
        { cancelOwner() {}, play(request) { stats.splashes++; splashRequests.push({ ...request, position: { ...request.position } }); } });
    const clusters = Array.from({ length: 18 }, (_, id) => ({ id, active: true, generation: 1,
        wave: Math.floor(id / 6), phase: 'floating', phaseProgress: 1,
        kind: id % 6 === 1 || id % 6 === 4 ? 'soft' : 'rigid', visualVariant: Math.floor(id / 2) % 3,
        courseX: 25, lateral: id - 9, anchorCourseX: 25, anchorLateral: id - 9,
        throwSide: 1, impactRevision: 0 }));
    return { stats, meshes, root, geometry, presentation, clusters, splashRequests };
}

test('杂物两侧高处抛入保持完整预警，到位水花使用权威落点且不改变槽位', () => {
    for (const side of [-1, 1]) {
        const f = fixture();
        for (const c of f.clusters) {
            c.throwSide = side;
            c.lateral = c.anchorLateral = side * (2 + c.id % 6);
            c.phase = 'falling'; c.phaseProgress = -0.01;
        }
        f.presentation.update(0, f.clusters, true);
        assert.ok(f.root.children.every(n => !n.active), '分组等待不能提前出现');
        for (let frame = 0; frame <= 27; frame++) {
            for (const c of f.clusters) c.phaseProgress = frame / 27;
            const before = JSON.stringify(f.clusters);
            f.presentation.update(0.05, f.clusters, true);
            assert.equal(JSON.stringify(f.clusters), before, '表现不能写入玩法或同步状态');
            for (const c of f.clusters) {
                const p = f.root.children[c.id].position;
                assert.ok(Math.abs(p.x - c.anchorCourseX) <= .65 + 1e-8);
                assert.ok(p.y > 0.055 && p.y < 5.8, '抛物线保持可读高度');
                if (frame === 0) {
                    assert.equal(p.z, side * 15.1);
                    assert.ok(p.y > 5.4, '从看台方向高处开始');
                }
                if (frame === 13) assert.ok(p.y > 4, '飞行中段仍明显离开水面');
                if (frame === 27) {
                    assert.ok(Math.abs(p.z - c.anchorLateral) < 1e-8);
                    assert.ok(p.y < .25, '末段接回水面');
                }
            }
            assert.equal(f.stats.splashes, 0, '整个 1.35 秒预警内不提前播落点水花');
        }
        const last = f.root.children.map(n => ({ p: n.position, r: n.rotation }));
        for (const c of f.clusters) { c.phase = 'floating'; c.phaseProgress = 0; }
        f.presentation.update(0.05, f.clusters, true);
        assert.equal(f.splashRequests.length, 18);
        f.splashRequests.forEach((s, id) => {
            assert.equal(s.position.x, f.clusters[id].anchorCourseX);
            assert.equal(s.position.z, f.clusters[id].anchorLateral);
            assert.ok(Math.abs(f.root.children[id].position.y - last[id].p.y) < 0.02);
            assert.ok(Math.abs(f.root.children[id].rotation.x - last[id].r.x) < 3);
        });
        assert.equal(f.stats.nodes, 19);
        assert.equal(f.stats.meshes, 4);
        assert.equal(f.stats.materials, 1);
    }
});

test('18槽仅创建四份共享网格和一份不透明材质，三种瓶型正确绑定且网格满足预算', () => {
    const f = fixture();
    f.presentation.update(0, f.clusters, true);
    assert.equal(f.stats.nodes, 19);
    assert.equal(f.stats.meshes, 4);
    assert.equal(f.stats.materials, 1);
    const material = f.root.children[0].renderer.material;
    assert.equal(material.info.effectName, 'builtin-unlit');
    assert.equal(material.info.technique, 0);
    assert.equal(material.info.defines.USE_INSTANCING, true);
    assert.equal(material.info.defines.USE_VERTEX_COLOR, true);
    assert.equal(new Set(f.root.children.map(node => node.renderer.mesh)).size, 4,
        '满池样本必须实际包含三种硬瓶和餐盒');
    for (const slot of f.clusters) {
        assert.equal(f.root.children[slot.id].renderer.material, material);
        assert.equal(f.root.children[slot.id].renderer.mesh,
            f.meshes[slot.kind === 'soft' ? 3 : slot.visualVariant]);
    }
    let vertices = 0, triangles = 0;
    for (const { data } of f.meshes) {
        assert.ok(data.indices.length / 3 <= 250);
        assert.equal(data.colors.length, data.positions.length / 3 * 4);
        for (let i = 0; i < data.positions.length; i++) {
            const axis = ['x', 'y', 'z'][i % 3];
            assert.ok(Number.isFinite(data.positions[i]));
            assert.ok(data.positions[i] >= data.minPos[axis] - 1e-6);
            assert.ok(data.positions[i] <= data.maxPos[axis] + 1e-6);
        }
        assert.ok(data.indices.every(i => i >= 0 && i < data.positions.length / 3));
        vertices += data.positions.length / 3; triangles += data.indices.length / 3;
    }
    assert.ok(vertices <= 1000 && triangles <= 1000);
    assert.equal(new Set(f.meshes.map(m => JSON.stringify(m.data.positions))).size, 4);
    console.log(`垃圾共享几何：${vertices}顶点、${triangles}三角形、4网格、1材质`);
});

test('满池以20Hz展示，稳定漂浮不重写缩放或网格，隐藏后零槽位读取且不补水花', () => {
    const f = fixture();
    f.presentation.update(0, f.clusters, true);
    assert.equal(f.stats.splashes, 0, '晚加入浮动态不得补播入水');
    const baseline = { ...f.stats };
    for (let i = 0; i < 600; i++) f.presentation.update(1 / 60, f.clusters, true);
    assert.equal(f.stats.nodes, baseline.nodes);
    assert.equal(f.stats.meshes, baseline.meshes);
    assert.equal(f.stats.materials, baseline.materials);
    assert.equal(f.stats.meshWrites, baseline.meshWrites);
    assert.equal(f.stats.scaleWrites, baseline.scaleWrites);
    assert.equal(f.stats.activeWrites, baseline.activeWrites);
    assert.ok(f.stats.transformWrites - baseline.transformWrites <= 200 * 18 * 2);
    f.presentation.update(0, f.clusters, false);
    const hidden = { ...f.stats };
    const unreadable = new Proxy([], { get() { throw new Error('隐藏后不得读取槽位'); } });
    for (let i = 0; i < 120; i++) f.presentation.update(1 / 60, unreadable, false);
    assert.deepEqual(f.stats, hidden);
    f.presentation.dispose(); f.presentation.dispose();
    assert.equal(f.stats.destroyedMeshes, 4);
    assert.ok(f.root.children.every(node => !node.isValid));
});

test('分组待投槽位保持隐藏；reset复用节点并按新代次切换瓶型', () => {
    const f = fixture();
    for (const slot of f.clusters) {
        slot.phase = 'falling'; slot.phaseProgress = slot.id < 2 ? 0 : -1;
    }
    f.presentation.update(0, f.clusters, true);
    assert.equal(f.root.children.filter(n => n.active).length, 2);
    f.presentation.reset();
    for (const slot of f.clusters) {
        slot.generation++; slot.phase = 'floating'; slot.phaseProgress = 1;
        slot.visualVariant = (slot.visualVariant + 1) % 3;
    }
    f.presentation.update(0, f.clusters, true);
    assert.equal(f.root.children.filter(n => n.active).length, 18);
    assert.equal(f.stats.nodes, 19); assert.equal(f.stats.meshes, 4);
    assert.equal(f.stats.splashes, 0);
    for (const slot of f.clusters) assert.equal(f.root.children[slot.id].renderer.mesh,
        f.meshes[slot.kind === 'soft' ? 3 : slot.visualVariant]);
});
