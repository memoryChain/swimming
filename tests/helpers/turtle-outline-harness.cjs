const path = require('node:path');
const { createHarness } = require('./cocos-math-harness.cjs');

// 仅模拟资源与渲染组件；位置、旋转及正式海龟表现代码仍使用项目实现。
function createOutlineHarness() {
    const pending = [], resources = { meshes: [], materials: [] };
    const h = createHarness({ './RaceBundleLoader': { loadRaceAsset: (_path, _type, done) => pending.push(done) } });
    class Node extends h.Node {
        constructor(name) { super(); this.name = name; this.active = true; this.layer = 1; this.renderers = []; }
        setParent(parent) {
            if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
            this.parent = parent; if (parent) parent.children.push(this);
        }
        addComponent(ctor) { const value = new ctor(); value.node = this; value.isValid = true; this.renderers.push(value); return value; }
        getComponentsInChildren(ctor) { return [...this.renderers.filter(r => r instanceof ctor), ...this.children.flatMap(c => c.getComponentsInChildren(ctor))]; }
        destroy() { for (const child of [...this.children]) child.destroy(); this.setParent(null); this.isValid = false; }
    }
    class Material {
        constructor() { this.properties = {}; this.destroyed = 0; resources.materials.push(this); }
        initialize(options) { this.options = options; }
        setProperty(key, value) { this.properties[key] = value; }
        destroy() { this.destroyed++; }
    }
    class Renderer { setMaterial(value) { this.material = value; } }
    Object.assign(h.cc, { Node, Material, MeshRenderer: Renderer, EffectAsset: class {},
        Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
        utils: { createMesh(data) { const mesh = { data, destroyed: 0, destroy() { this.destroyed++; } }; resources.meshes.push(mesh); return mesh; } },
    });
    const { TurtleBusVisual } = h.load(path.join(h.root, 'assets/scripts/core/TurtleBusPresentation.ts'));
    const { TurtleBusOutline } = h.load(path.join(h.root, 'assets/scripts/core/TurtleBusOutline.ts'));
    return { ...h, Node, pending, resources, TurtleBusVisual, TurtleBusOutline };
}
module.exports = { createOutlineHarness };
