const path = require('node:path');
const { createHarness } = require('./cocos-math-harness.cjs');

function createGeyserPresentationHarness(count = 10, waterY = 0.055) {
    const h = createHarness(), nodes = [], meshes = [], materials = [];
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
    class Material { constructor() { materials.push(this); this.destroyCount = 0; } initialize() {} setProperty() {} destroy() { this.destroyCount++; } }
    class MeshRenderer { setMaterial(m) { this.material = m; } }
    Object.assign(h.cc, { Node, Mesh, Material, MeshRenderer,
        Color: class { constructor(r,g,b,a) { Object.assign(this,{r,g,b,a}); } },
        gfx: { CullMode: { NONE: 0 } }, utils: { createMesh: g => new Mesh(g) } });
    const { GeyserBrawlPresentation } = h.load(path.join(h.root, 'assets/scripts/core/GeyserBrawlPresentation.ts'));
    const rules = h.load(path.join(h.root, 'assets/scripts/core/GeyserBrawlRules.ts'));
    const root = new Node('World');
    const visual = new GeyserBrawlPresentation(root, 0, count, waterY);
    const visible = node => node.active && (!node.parent || visible(node.parent));
    const snapshot = () => nodes.filter(n => n.components.length && visible(n)).map(n => ({
        name: n.name, mesh: meshes.indexOf(n.components[0].mesh),
        matrix: Array.from(h.Mat4.toArray([], n.worldMatrix)),
    }));
    const budget = () => ({ nodes: nodes.length - 1, meshes: meshes.length, materials: materials.length,
        renderers: nodes.filter(n => n.components.length).length,
        triangles: meshes.map(m => m.geometry.indices.length / 3) });
    return { ...h, Node, root, nodes, meshes, materials, visual, rules, snapshot, budget };
}
module.exports = { createGeyserPresentationHarness };
