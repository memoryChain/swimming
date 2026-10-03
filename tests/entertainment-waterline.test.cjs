const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');

function waterLayers() {
    const file = 'assets/scripts/venue/WaterRefractionController.ts';
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'WaterRefractionController');
    const names = ['registerFloatingObject', 'applyFloatingObjectLayers', 'setUnderwaterViewActive', 'dispose'];
    const methods = cls.members.filter(n => names.includes(n.name?.getText(source)));
    const helpers = source.statements.filter(n => ts.isFunctionDeclaration(n)
        && ['captureNodeLayers', 'restoreNodeLayers'].includes(n.name.text));
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(`${helpers.map(n => n.getText(source)).join('\n')}
        export class Subject { ${methods.map(n => n.getText(source)).join('\n')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText, { module, exports: module.exports, Layers: { Enum: { DEFAULT: 1 } }, SWIMMER_LAYER: 1024,
        REBIND_WARMUP_FRAMES: 2, setSwimmerReflectClip() {}, setSpectatorCameraUnderwater() {} });
    const owner = new module.exports.Subject();
    Object.assign(owner, { _floatingObjects: [], _laneFloatNodes: [], _floorTints: [], _underwaterViewActive: false,
        _swimmerCamera: { isValid: true, node: { isValid: true, destroy() {} } },
        _poolsideWaterline: { setUnderwaterViewActive() {}, dispose() {} },
        applyFloorTint() {}, tagLaneFloats() {} });
    return owner;
}

function renderingFixture() {
    let materialCount = 0, materialDestroyed = 0, nodeCount = 0;
    class Color { static WHITE = new Color(255, 255, 255, 255); constructor(...rgba) { this.rgba = rgba; } }
    class Vec4 { constructor(x, y, z, w) { Object.assign(this, { x, y, z, w }); } }
    class Material {
        constructor() { materialCount++; this.writes = 0; this.properties = {}; }
        initialize(config) { this.config = config; }
        setProperty(key, value) { this.properties[key] = value; this.writes++; }
        destroy() { materialDestroyed++; }
    }
    class MeshRenderer {
        constructor() { this.sharedMaterials = []; this.writes = 0; }
        setMaterial(material, slot) { this.sharedMaterials[slot] = material; this.writes++; }
    }
    class Node {
        constructor(name) {
            this.name = name; this.children = []; this.isValid = true; this.active = true;
            this._layer = 1; this.layerWrites = 0; this.transformWrites = 0;
            this.scale = { x: 1, y: 1, z: 1 }; nodeCount++;
        }
        get layer() { return this._layer; }
        set layer(v) { this.layerWrites++; this._layer = v; }
        getComponent() { return this.renderer; }
        addComponent() { this.renderer = new MeshRenderer(); return this.renderer; }
        setParent(parent) { this.parent = parent; parent.children.push(this); }
        setScale(x, y, z) { Object.assign(this.scale, { x, y, z }); }
        setWorldPosition() { this.transformWrites++; }
        setRotationFromEuler() { this.transformWrites++; }
        destroy() { this.isValid = false; for (const child of this.children) child.destroy(); }
    }
    const h = createHarness();
    Object.assign(h.cc, { Color, Vec4, Material, MeshRenderer, Node, EffectAsset: class {},
        primitives: { PrimitiveMode: { TRIANGLE_LIST: 4 } },
        utils: { createMesh: geometry => ({ geometry, destroy() { this.destroyed = true; } }) },
        instantiate: prefab => {
            const node = new Node(prefab.name); node.addComponent();
            node.renderer.sharedMaterials = [{ name: '来源受光材质' }]; return node;
        } });
    const { FloatingItemRenderer } = h.load(h.root + '/assets/scripts/entertainment/FloatingItemRenderer.ts');
    const layers = waterLayers();
    const rendering = new FloatingItemRenderer({}, .125, layers);
    return { h, layers, rendering, Node, MeshRenderer, counts: () => ({ materialCount, materialDestroyed, nodeCount }) };
}

test('动态物体及子网格随相机切层；隐藏对象和水下迟到注册一致，注销恢复原层且不重复写', () => {
    const f = renderingFixture(), a = new f.Node('补给'), child = new f.Node('子网格');
    child.layer = 32; child.setParent(a); a.active = false;
    const release = f.layers.registerFloatingObject(a);
    assert.equal(f.layers.registerFloatingObject(a), release);
    assert.equal(f.layers._floatingObjects.length, 1);
    assert.equal(a.layer, 1024); assert.equal(child.layer, 1024);
    const registry = f.layers._floatingObjects, nodes = registry[0].nodes;
    for (let i = 0; i < 20; i++) {
        f.layers.setUnderwaterViewActive(true); assert.equal(a.layer, 1); assert.equal(child.layer, 1);
        const writes = a.layerWrites; f.layers.setUnderwaterViewActive(true); assert.equal(a.layerWrites, writes);
        f.layers.setUnderwaterViewActive(false); assert.equal(a.layer, 1024);
        assert.equal(f.layers._floatingObjects, registry); assert.equal(registry[0].nodes, nodes);
    }
    f.layers.setUnderwaterViewActive(true);
    const late = new f.Node('迟到杂物'); f.rendering.bind(late); assert.equal(late.layer, 1);
    release(); release(); assert.equal(a.layer, 1); assert.equal(child.layer, 32);
    assert.equal(registry.length, 1);
    f.layers.dispose(); f.layers.dispose(); f.rendering.unbind(late); f.rendering.dispose();
    assert.equal(registry.length, 0); assert.equal(late.layer, 1);
});

test('真实补给与杂物池共用单一材质、使用世界水线，20次重赛无节点／材质／注册增长', () => {
    const f = renderingFixture(), world = new f.Node('世界');
    const course = { waterY: .125, poolWidth: 21, distanceToWorldX: x => x };
    const { SupplyRacePresentation } = f.h.load(f.h.root + '/assets/scripts/entertainment/SupplyRacePresentation.ts');
    const { LitterBrawlPresentation } = f.h.load(f.h.root + '/assets/scripts/entertainment/LitterBrawlPresentation.ts');
    const supply = new SupplyRacePresentation(world, course, 6, { name: '苏打' }, { name: '冰沙' }, f.rendering);
    const litter = new LitterBrawlPresentation(world, course, 6, f.rendering);
    const renderNodes = world.children.flatMap(n => n.renderer ? [n] : n.children);
    assert.equal(renderNodes.length, 18); assert.equal(f.layers._floatingObjects.length, 12);
    const material = renderNodes[0].renderer.sharedMaterials[0];
    for (const node of renderNodes) {
        assert.equal(node.renderer.sharedMaterials[0], material); assert.equal(node.layer, 1024);
    }
    assert.equal(material.config.defines.USE_FLOATING_VERTEX_COLOR, true);
    assert.equal(material.config.defines.USE_INSTANCING, true);
    assert.equal(material.config.states.depthStencilState.depthWrite, true);
    assert.equal(material.properties.waterLine.x, course.waterY);
    assert.deepEqual(material.properties.underwaterColor.rgba, [13, 87, 158, 184]);
    const initial = f.counts(), uniformWrites = material.writes;
    const slots = Array.from({ length: 6 }, (_, id) => ({ id, active: true, kind: 'heartbeat-soda', age: 2, courseX: 20, lateral: id }));
    const clusters = Array.from({ length: 6 }, (_, id) => ({ id, active: true, phase: 'floating', phaseProgress: 1,
        generation: 1, kind: id % 2 ? 'soft' : 'rigid', visualVariant: id % 3, impactRevision: 0, courseX: 20, lateral: id }));
    for (let round = 0; round < 20; round++) {
        supply.reset(); litter.reset();
        for (let frame = 0; frame < 60; frame++) { supply.update(1 / 60, slots, true); litter.update(1 / 60, clusters, true); }
        f.layers.setUnderwaterViewActive(true);
        for (const node of renderNodes) assert.equal(node.layer, 1);
        f.layers.setUnderwaterViewActive(false);
        supply.update(0, slots, false); litter.update(0, clusters, false);
        const writes = world.children.map(n => n.transformWrites);
        for (let frame = 0; frame < 60; frame++) { supply.update(1 / 60, slots, false); litter.update(1 / 60, clusters, false); }
        assert.deepEqual(world.children.map(n => n.transformWrites), writes);
        assert.deepEqual(f.counts(), initial); assert.equal(material.writes, uniformWrites);
        assert.equal(f.layers._floatingObjects.length, 12);
    }
    const meshes = [...litter.bottleMeshes, litter.trayMesh];
    supply.dispose(); litter.dispose(); supply.dispose(); litter.dispose();
    assert.equal(f.layers._floatingObjects.length, 0);
    for (const node of renderNodes) assert.equal(node.isValid, false);
    for (const mesh of meshes) assert.equal(mesh.destroyed, true);
    f.rendering.dispose(); f.rendering.dispose(); assert.equal(f.counts().materialDestroyed, 1);
    f.layers.setUnderwaterViewActive(true); assert.equal(f.layers._floatingObjects.length, 0);
});

test('没有水相机时使用原主相机层，销毁节点和重复解绑安全', () => {
    const f = renderingFixture(); f.layers._swimmerCamera = null;
    const node = new f.Node('编辑器物体'); node.addComponent(); f.rendering.bind(node);
    assert.equal(node.layer, 1); assert.equal(f.layers._floatingObjects.length, 0);
    node.isValid = false; f.rendering.unbind(node); f.rendering.unbind(node); f.rendering.dispose();
    assert.equal(f.counts().materialDestroyed, 1);
});
