// 领奖效果的非 GUI 回归：数量/提交频率、鞋底离台面、补光恢复以及重复进出。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const dir of process.env.PATH.split(path.delimiter)) {
        const candidate = path.resolve(dir, '../typescript/lib/typescript.js');
        if (fs.existsSync(candidate)) return require(candidate);
    }
    throw Error('请通过 pnpm test:awards 运行');
}
const ts = compiler();
class Vec3 {
    static ONE = new Vec3(1, 1, 1);
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; }
    clone() { return new Vec3(this.x, this.y, this.z); }
    static transformQuat(out, value) { out.set(value.x, value.y, value.z); }
}
class Vec4 {
    constructor(x, y, z, w) { Object.assign(this, { x, y, z, w }); }
    clone() { return new Vec4(this.x, this.y, this.z, this.w); }
}
class Color { static WHITE = new Color(255, 255, 255, 255); constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }
class Quat { static fromEuler() {} }
class Material {
    isValid = true; properties = {}; writes = 0; technique = 0;
    initialize() {} setProperty(name, value) { this.writes++; this.properties[name] = value; }
    getProperty(name) { return this.properties[name]; }
    destroy() { this.isValid = false; }
}
class Mesh {
    isValid = true; updates = [];
    updateSubMesh(index, data) { this.updates.push(data); }
    destroy() { this.isValid = false; }
}
class MeshRenderer {
    sharedMaterials = [];
    setMaterial(m, slot) { this.sharedMaterials[slot] = m; }
}
class Node {
    isValid = true; active = true; children = []; components = []; layer = 1;
    constructor(name = '') { this.name = name; }
    setParent(p) { this.parent = p; p.children.push(this); }
    addComponent(C) { const c = new C(); c.node = this; this.components.push(c); return c; }
    getComponentsInChildren(C) { return [...this.components.filter(c => c instanceof C), ...this.children.flatMap(n => n.getComponentsInChildren(C))]; }
    setWorldPosition(v) { this.position = v.clone(); }
    setWorldScale(v) { this.scale = v.clone(); }
    destroy() { this.isValid = false; }
}
const cc = { Node, Vec3, Vec4, Color, Material, Mesh, MeshRenderer, Quat, utils: { MeshUtils: {
    createDynamicMesh: (index, data) => { const mesh = new Mesh(); mesh.initial = data; return mesh; },
} } };
const layout = { poolStartX: 0, poolFinishX: 50, direction: 1, platformY: 0.2 };
const bounds = { minX: -4, maxX: -3, minZ: -0.5, maxZ: 0.5, minY: 0.2, maxY: 0.98 };
const cache = {};
function load(file) {
    file = path.resolve(file); if (cache[file]) return cache[file].exports;
    const module = { exports: {} }; cache[file] = module;
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const req = id => {
        if (id === 'cc') return cc;
        if (id.endsWith('CharacterActionConfig')) return { CHARACTER_ACTION_CONFIG: { awards: {} }, selectActionFromPool: () => null };
        if (id.endsWith('AwardsPodiumSurface')) return { awardsPodiumSurface: () => bounds };
        if (id.endsWith('RaceCourseLayout')) return { DEFAULT_RACE_COURSE_LAYOUT: layout, PLATFORM_STANDING_LIFT: 0.04, STANDING_MODEL_LOCAL_Y: 0.55, collectNamedBounds: () => bounds };
        return load(path.resolve(path.dirname(file), id + '.ts'));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(req, module, module.exports);
    return module.exports;
}
const root = path.resolve(__dirname, '..');
const { AwardsConfettiEmitter } = load(path.join(root, 'assets/scripts/venue/AwardsConfettiEmitter.ts'));
const { AwardsLighting } = load(path.join(root, 'assets/scripts/venue/AwardsLighting.ts'));

test('彩带加倍为 96 片、一个网格一个材质；30Hz 提交，隐藏后零更新', () => {
    const emitter = new AwardsConfettiEmitter(), parent = new Node();
    emitter.show(parent, new Vec3());
    assert.equal(emitter._pieces.length, 96);
    assert.equal(parent.children.length, 1);
    assert.equal(emitter._positions.length, 96 * 8 * 3);
    assert.equal(emitter._indices.length, 96 * 36);
    const mesh = emitter._mesh;
    for (let i = 0; i < 120; i++) emitter.update(1 / 120);
    assert.equal(mesh.updates.length, 30);
    assert.ok(mesh.updates.every(data => data === mesh.updates[0]));
    emitter.hide(); for (let i = 0; i < 120; i++) emitter.update(1 / 60);
    assert.equal(mesh.updates.length, 30);
    emitter.show(parent, new Vec3()); assert.equal(emitter._mesh, mesh); assert.equal(parent.children.length, 1);
    emitter.dispose(); assert.equal(mesh.isValid, false);
});

test('领奖补光只写有卡通顶光参数的材质，共享材质不重复写，退出恢复原值', () => {
    const material = new Material();
    material.effectAsset = { techniques: [{ passes: [{ properties: { celParams: { value: [3, 0.62, 1, 0.25] } } }] }] };
    const outline = new Material();
    const roots = [new Node(), new Node()];
    for (const root of roots) root.addComponent(MeshRenderer).sharedMaterials = [material, outline];
    const light = new AwardsLighting(); light.show(roots);
    assert.equal(material.writes, 1); assert.equal(outline.writes, 0);
    assert.equal(material.properties.celParams.y, 0.86);
    light.hide(); assert.equal(material.properties.celParams.y, 0.62);
    const count = material.writes; light.hide(); assert.equal(material.writes, count);
    material.properties.celParams = new Vec4(4, 0.72, 1, 0.18);
    light.show(roots); light.hide(); assert.equal(material.properties.celParams.y, 0.72);
});

test('重复领奖使用本轮台面高度，仅留 2mm 鞋底间隙，起跳配置保持不变', () => {
    const { AwardsPresentation } = load(path.join(root, 'assets/scripts/venue/AwardsPresentation.ts'));
    const awards = new AwardsPresentation(layout);
    const calls = [];
    const winner = { placement: 1, swimmer: { presentStanding: (...args) => calls.push(args) } };
    for (const height of [0.98, 0.76, 0.64]) {
        bounds.maxY = height;
        awards.presentOnPodium([winner], new Node());
        const [position, facing, surface] = calls.at(-1);
        assert.equal(surface, height + 0.002);
        assert.equal(position.y, height - 0.55);
        assert.equal(facing, 180);
    }
    const shared = fs.readFileSync(path.join(root, 'assets/scripts/venue/RaceCourseLayout.ts'), 'utf8');
    assert.match(shared, /PLATFORM_STANDING_LIFT = 0\.04/);
});
