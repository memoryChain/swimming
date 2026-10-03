const path = require('node:path');
const { createHarness } = require('./cocos-math-harness.cjs');

function createFixedMeshHarness() {
    const dependencies = { '../core/RaceBundleLoader': { loadRaceAsset() { throw new Error('固定网格特效不应加载额外资产'); } } };
    const h = createHarness(dependencies), nodes = [], meshes = [], materials = [];
    class Node extends h.Node {
        _active = true; layer = 1; components = [];
        constructor(name) { super(); this.name = name; nodes.push(this); }
        get active() { return this._active; }
        set active(value) { this._active = value; this.writes++; }
        addChild(node) { node.parent = this; this.children.push(node); }
        addComponent(C) { const c = new C(); this.components.push(c); return c; }
        setPosition(x, y, z) { super.setPosition(x, y, z); this.writes++; }
        setScale(x, y, z) { super.setScale(x, y, z); this.writes++; }
        destroy() { this.isValid = false; for (const node of this.children) node.destroy(); }
    }
    class Mesh { constructor(g) { this.geometry = g; this.destroyCount = 0; meshes.push(this); } destroy() { this.destroyCount++; } }
    class Material { constructor() { materials.push(this); this.destroyCount = 0; this.writes = 0; } initialize(config) { this.config = config; } setProperty() { this.writes++; } destroy() { this.destroyCount++; } }
    class MeshRenderer { setMaterial(m) { this.material = m; } }
    Object.assign(h.cc, { Node, Mesh, Material, MeshRenderer,
        Color: class { constructor(r,g,b,a) { Object.assign(this,{r,g,b,a}); } },
        gfx: { CullMode: { NONE: 0 } }, utils: { createMesh: g => new Mesh(g) } });
    const root = new Node('World');
    const visible = node => node.active && (!node.parent || visible(node.parent));
    const snapshot = () => nodes.filter(n => n.components.length && visible(n)).map(n => ({
        name: n.name, mesh: meshes.indexOf(n.components[0].mesh),
        matrix: Array.from(h.Mat4.toArray([], n.worldMatrix)),
    }));
    const budget = () => ({ nodes: nodes.length - 1, meshes: meshes.length, materials: materials.length,
        renderers: nodes.filter(n => n.components.length).length,
        triangles: meshes.map(m => m.geometry.indices.length / 3) });
    const loadModule = name => h.load(path.join(h.root, 'assets/scripts', name + '.ts'));
    return { ...h, Node, root, nodes, meshes, materials, snapshot, budget, loadModule };
}
module.exports = { createFixedMeshHarness };
