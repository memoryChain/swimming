// 执行：npx --yes --package typescript@5.4.5 -c "node --test tests/poolside-waterline.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let ts;
for (const dir of process.env.PATH.split(path.delimiter)) {
    const file = path.resolve(dir, '../typescript/lib/typescript.js');
    if (fs.existsSync(file)) { ts = require(file); break; }
}
if (!ts) throw Error('请通过文件顶部的固定版本命令执行');
class Color { static WHITE = new Color(255, 255, 255, 255); constructor(...rgba) { this.rgba = rgba; } }
class Vec4 { constructor(x, y, z, w) { Object.assign(this, { x, y, z, w }); } }
class Texture2D {}
class Material {
    properties = {}; writes = 0;
    initialize(config) { this.config = config; }
    setProperty(key, value) { this.properties[key] = value; this.writes++; }
    getProperty(key) { return this.properties[key]; }
    destroy() { this.destroyed = true; }
}
class MeshRenderer {
    isValid = true; mesh = {}; writes = 0;
    constructor(source) { this.sharedMaterials = [source]; }
    getSharedMaterial(i) { return this.sharedMaterials[i]; }
    setMaterial(material, i) { this.sharedMaterials[i] = material; this.writes++; }
}
class Node {
    isValid = true; children = []; layerWrites = 0; _layer = 1;
    constructor(name, renderer) { this.name = name; this.renderer = renderer; }
    get layer() { return this._layer; }
    set layer(layer) { this.layerWrites++; this._layer = layer; }
    getComponent() { return this.renderer; }
}
function harness() {
    const pending = [];
    const cc = { Color, Vec4, Texture2D, Material, MeshRenderer, Node, EffectAsset: class {}, Layers: { Enum: { DEFAULT: 1 } } };
    const file = path.resolve(__dirname, '../assets/scripts/venue/PoolsideWaterline.ts');
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const module = { exports: {} };
    const requireMock = name => name === 'cc' ? cc : name.endsWith('RaceBundleLoader')
        ? { loadRaceAsset: (_path, _type, callback) => pending.push(callback) }
        : name.endsWith('ResourcePaths') ? { RESOURCE_PATHS: { venueHeightShadeEffect: 'effects/VenueHeightShade' } }
        : { SWIMMER_LAYER: 1024 };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(requireMock, module, module.exports);
    const source = new Material(), texture = new Texture2D(), emissive = new Color(255, 255, 255, 255);
    source.setProperty('emissiveMap', texture); source.setProperty('emissive', emissive);
    source.setProperty('albedo', new Color(0, 0, 0, 255));
    const renderer = new MeshRenderer(source), props = new Node('PoolsideProps_Merged', renderer);
    const pool = new Node('pool'), deck = new Node('pool_edge_batch');
    pool.children.push(deck, props);
    return { binding: new module.exports.PoolsideWaterline(), pending, source, texture, emissive, renderer, props, pool, deck };
}
test('保留自发光图集及单网格，切换视角不重建材质、不逐帧写属性，销毁恢复原状态', () => {
    const h = harness(), mesh = h.renderer.mesh;
    h.binding.bind(h.pool, 0.125);
    h.binding.bind(h.pool, 0.125);
    assert.equal(h.pending.length, 1);
    assert.equal(h.props.layer, 1);
    h.pending.shift()(null, {});
    const material = h.renderer.getSharedMaterial(0);
    assert.equal(material.properties.mainTexture, h.texture);
    assert.equal(material.properties.mainColor, h.emissive);
    assert.equal(material.properties.waterLine.x, 0.125);
    assert.equal(material.config.defines.USE_POOLSIDE_WATERLINE, true);
    assert.equal(material.config.states.depthStencilState.depthWrite, true);
    assert.equal(h.props.layer, 1024);
    const writes = material.writes;
    for (let i = 0; i < 20; i++) {
        h.binding.setUnderwaterViewActive(true);
        assert.equal(h.props.layer, 1);
        h.binding.setUnderwaterViewActive(false);
        assert.equal(h.props.layer, 1024);
        const layerWrites = h.props.layerWrites;
        h.binding.setUnderwaterViewActive(false);
        assert.equal(h.props.layerWrites, layerWrites);
        h.binding.bind(h.pool, 0.125);
    }
    assert.equal(material.writes, writes);
    assert.equal(h.renderer.writes, 1);
    assert.equal(h.renderer.mesh, mesh);
    assert.equal(h.deck.layerWrites, 0);
    assert.equal(h.pool.children.length, 2);
    h.binding.dispose(); h.binding.dispose();
    assert.equal(h.renderer.getSharedMaterial(0), h.source);
    assert.equal(h.props.layer, 1);
    assert.equal(material.destroyed, true);
    assert.equal(h.source.destroyed, undefined);
});
test('材质尚未加载时进入水下，完成后直接采用当前视角；过期回调不会复活场景', () => {
    const h = harness();
    h.binding.bind(h.pool, 0.055);
    h.binding.setUnderwaterViewActive(true);
    h.pending.shift()(null, {});
    assert.equal(h.props.layer, 1);
    h.binding.setUnderwaterViewActive(false);
    assert.equal(h.props.layer, 1024);
    h.binding.dispose();
    h.binding.bind(h.pool, 0.055);
    h.binding.dispose();
    h.pending.shift()(null, {});
    assert.equal(h.renderer.getSharedMaterial(0), h.source);
    assert.equal(h.props.layer, 1);
});
test('缺少图集时保留原材质和分层，场景销毁后的回调不创建材质', () => {
    const h = harness();
    delete h.source.properties.emissiveMap;
    h.binding.bind(h.pool, 0.055);
    assert.equal(h.pending.length, 0);
    assert.equal(h.renderer.writes, 0);
    h.source.properties.emissiveMap = h.texture;
    h.binding.bind(h.pool, 0.055);
    h.props.isValid = false;
    h.pending.shift()(null, {});
    assert.equal(h.renderer.writes, 0);
});
test('运行时场馆的池岸道具仍满足单图集合批契约', () => {
    const buffer = fs.readFileSync(path.resolve(__dirname, '../assets/race/pool/LowPolyPool.glb'));
    const doc = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
    const node = doc.nodes.find(n => n.name === 'PoolsideProps_Merged');
    assert(node);
    const mesh = doc.meshes[node.mesh];
    assert.equal(mesh.primitives.length, 1);
    const primitive = mesh.primitives[0];
    assert.notEqual(primitive.attributes.TEXCOORD_0, undefined);
    assert(doc.materials[primitive.material].emissiveTexture);
    assert.deepEqual(doc.materials[primitive.material].emissiveFactor, [1, 1, 1]);
});
