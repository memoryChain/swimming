// 执行真实水花池和真实 Cocos 数学；仅替代渲染器与资源，不启动编辑器。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness } = require('./cocos-math-harness.cjs');
function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const dir of process.env.PATH.split(path.delimiter)) {
        const file = path.resolve(dir, '../typescript/lib/typescript.js');
        if (fs.existsSync(file)) return require(file);
    }
    throw new Error('请通过 typescript@5.4.5 的 npx 环境运行');
}
function createSplashHarness(source) {
    const h = createHarness(), meshes = [], materials = [], nodes = [];
    class Node extends h.Node {
        _active = true; layer = 1; components = []; writes = 0;
        constructor(name) { super(); this.name = name; nodes.push(this); }
        set active(v) { this._active = v; this.writes++; }
        get active() { return this._active; }
        setParent(p) { this.parent = p; p.children.push(this); }
        addComponent(C) { const c = new C(); c.node = this; this.components.push(c); return c; }
        setWorldPosition(x, y, z) { super.setWorldPosition(typeof x === 'number' ? new h.Vec3(x,y,z) : x); this.writes++; }
        setPosition(x,y,z) { super.setPosition(x,y,z); this.writes++; }
        setScale(x,y,z) { super.setScale(x,y,z); this.writes++; }
        destroy() { this.isValid = false; this.children.forEach(n => n.destroy()); }
    }
    class Mesh { constructor(g) { this.geometry = g; this.destroyCount = 0; meshes.push(this); } destroy() { this.destroyCount++; } }
    class Material { constructor() { materials.push(this); this.destroyCount = 0; } initialize(o) { this.options = o; } setProperty() {} destroy() { this.destroyCount++; } }
    class MeshRenderer { setMaterial(m) { this.material = m; } }
    const cc = { ...h.cc, Node, Mesh, Material, MeshRenderer, Color: { WHITE: {} },
        gfx: { PrimitiveMode: { TRIANGLE_LIST: 0 }, CullMode: { NONE: 0 } }, utils: { createMesh: g => new Mesh(g) } };
    const filename = path.join(h.root, 'assets/scripts/core/EntertainmentWaterSplash.ts');
    const ts = compiler(), module = { exports: {} };
    const code = ts.transpileModule(source ?? fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, {filename})(id => {
        if (id === 'cc') return cc; throw new Error(id);
    }, module, module.exports);
    const root = new Node('world'), pool = new module.exports.EntertainmentWaterSplashPool(root);
    const budget = () => ({meshes:meshes.length, materials:materials.length, nodes:nodes.length-1,
        renderers:nodes.reduce((n,x)=>n+x.components.length,0),
        geometry:meshes.map(m=>({vertices:m.geometry.positions.length/3,triangles:m.geometry.indices.length/3})),
        peakTriangles:pool.slots.reduce((n,s)=>n+[s.body,s.ring,s.explosionCore].filter(Boolean).reduce((n,x)=>n+x.components[0].mesh.geometry.indices.length/3,0),0)});
    const snapshot = () => pool.slots.filter(s=>s.root.active).flatMap(s=>[s.body,s.ring,s.explosionCore].filter(n=>n?.active).map(n=>({
        name:n.name, mesh:meshes.indexOf(n.components[0].mesh), matrix:Array.from(h.Mat4.toArray([],n.worldMatrix)), owner:s.owner,
    })));
    return {...h,...module.exports,repoRoot:h.root,Node,root,pool,meshes,materials,nodes,budget,snapshot};
}
module.exports={createSplashHarness,compiler};
