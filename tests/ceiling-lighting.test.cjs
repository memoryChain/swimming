// 固定版本执行：npx --yes --package typescript@5.4.5 -c "node --test tests/ceiling-lighting.test.cjs"
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
class Component {}
class Material {
    initialize(config) { this.config = config; }
    setProperty() {}
    destroy() { this.destroyed = true; }
}
class MeshRenderer {
    mesh = { borrowed: true };
    setMaterial(material) { this.material = material; }
}
class Node {
    isValid = true; active = true; children = []; components = [];
    constructor(name) { this.name = name; }
    addComponent(Type) { const component = new Type(); component.node = this; this.components.push(component); return component; }
    getComponent(Type) { return this.components.find(c => c instanceof Type); }
}
const cc = { Component, Material, MeshRenderer, Node, Color: { WHITE: {} }, gfx: { CullMode: { BACK: 2 } }, _decorator: { ccclass: () => Type => Type } };
function load(name) {
    const file = path.resolve(__dirname, '../assets/scripts/venue', name + '.ts');
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    const module = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(() => cc, module, module.exports);
    return module.exports;
}
const { applyCeilingLightArray, CeilingLightingMaterialOwner } = load('CeilingLightArray');
const { TopViewCeilingController } = load('TopViewCeilingController');
test('灯具重复绑定不增节点或材质，俯视切换完整隐藏并恢复', () => {
    const pool = new Node('pool'), imported = new Node('LowPolyPool'), rig = new Node('ceiling_lighting_rig');
    pool.children.push(imported); imported.children.push(rig);
    const renderer = rig.addComponent(MeshRenderer);
    applyCeilingLightArray(pool);
    const material = renderer.material;
    const owner = rig.getComponent(CeilingLightingMaterialOwner);
    assert(material && owner);
    assert.equal(typeof owner.update, 'undefined');
    assert.equal(typeof owner.lateUpdate, 'undefined');
    assert.equal(material.config.states.depthStencilState.depthWrite, true);
    assert.equal(material.config.technique, undefined);
    for (let i = 0; i < 10; i++) applyCeilingLightArray(pool);
    assert.equal(renderer.material, material);
    assert.equal(rig.components.length, 2);
    assert.equal(pool.children.length, 1);
    assert.equal(imported.children.length, 1);
    const top = new TopViewCeilingController();
    assert.equal(top.bind(pool), 1);
    for (let i = 0; i < 10; i++) {
        top.update(true); assert.equal(rig.active, false);
        top.update(true); top.update(false); assert.equal(rig.active, true);
    }
    rig.active = false; top.update(true); top.update(false); assert.equal(rig.active, false);
    owner.onDestroy(); assert.equal(material.destroyed, true); assert.equal(owner.material, null);
    assert.equal(renderer.mesh.borrowed, true);
});
test('缺少导入模型时安全返回，不重建旧灯或创建逐帧控制器', () => {
    applyCeilingLightArray(null);
    const pool = new Node('pool'); applyCeilingLightArray(pool);
    assert.equal(pool.children.length, 0); assert.equal(pool.components.length, 0);
});
