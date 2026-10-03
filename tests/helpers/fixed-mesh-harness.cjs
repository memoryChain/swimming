const path = require('node:path');
const { createHarness } = require('./cocos-math-harness.cjs');

function createFixedMeshHarness(externalModules = {}) {
    const dependencies = { '../core/RaceBundleLoader': { loadRaceAsset() { throw new Error('固定网格特效不应加载额外资产'); } }, ...externalModules };
    const h = createHarness(dependencies), nodes = [], meshes = [], materials = [];
    class Node extends h.Node {
        _active = true; layer = 1; components = [];
        constructor(name) { super(); this.name = name; nodes.push(this); }
        get active() { return this._active; }
        set active(value) { this._active = value; this.writes++; }
        setParent(parent) { parent.addChild(this); }
        addChild(node) { node.parent = this; this.children.push(node); }
        getComponent(C) { return this.components.find(c => c instanceof C) || null; }
        setWorldPosition(x,y,z) { super.setWorldPosition(typeof x === "number" ? new h.Vec3(x,y,z) : x); this.writes++; }
        addComponent(C) { const c = new C(); this.components.push(c); return c; }
        setPosition(x, y, z) { super.setPosition(x, y, z); this.writes++; }
        setScale(x, y, z) { super.setScale(x, y, z); this.writes++; }
        destroy() { this.isValid = false; for (const node of this.children) node.destroy(); }
    }
    class Mesh { constructor(g) { this.geometry = g; this.destroyCount = 0; meshes.push(this); } destroy() { this.destroyCount++; } }
    class Material { copy(other) { this.config = other.config; } constructor() { materials.push(this); this.destroyCount = 0; this.writes = 0; } initialize(config) { this.config = config; } setProperty() { this.writes++; } destroy() { this.destroyCount++; } }
    class MeshRenderer { sharedMaterials=[]; setMaterial(m,slot=0) { this.material = m; this.sharedMaterials[slot]=m; } }
    Object.assign(h.cc, { Node, Mesh, Material, MeshRenderer, Prefab: class {},
        Color: class Color { static WHITE = new Color(255,255,255,255); constructor(r,g,b,a=255) { Object.assign(this,{r,g,b,a}); }
            clone() { return new Color(this.r,this.g,this.b,this.a); } },
        Vec4: class { constructor(x,y,z,w) { Object.assign(this,{x,y,z,w}); } }, EffectAsset: class {},
        gfx: { CullMode: { NONE: 0 } }, utils: { createMesh: g => new Mesh(g) } });
    h.cc.instantiate = prefab => {
        const copy = original => {
            const node = new Node(original.name);
            node.setPosition(original.position); node.setRotation(original.rotation); node.setScale(original.scale);
            for (const component of original.components || original.getComponentsInChildren(MeshRenderer)) {
                const renderer = node.addComponent(MeshRenderer); renderer.mesh = component.mesh;
            }
            for (const child of original.children) copy(child).setParent(node);
            return node;
        };
        return copy(prefab.data);
    };
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
