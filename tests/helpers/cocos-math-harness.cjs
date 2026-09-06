// 使用本机 Creator 的真实四元数与向量实现；节点仅模拟父子变换，不启动编辑器。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
let engine = process.env.COCOS_ENGINE_ROOT;
if (!engine) {
    const config = path.join(root, 'temp/tsconfig.cocos.json');
    if (fs.existsSync(config)) {
        const internal = JSON.parse(fs.readFileSync(config, 'utf8')).compilerOptions.paths['db://internal/*'][0];
        engine = path.resolve(internal, '../../..');
    }
}
const available = engine && fs.existsSync(path.join(engine, 'cocos/core/math/quat.ts'));
function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const dir of process.env.PATH.split(path.delimiter)) {
        const candidate = path.resolve(dir, '../typescript/lib/typescript.js');
        if (fs.existsSync(candidate)) return require(candidate);
    }
    throw new Error('需要 typescript@5.4.5');
}

function createHarness(externalModules = {}) {
    assert.ok(available, '需要本机 Cocos 数学实现，不能跳过骨架验证');
    const ts = compiler(), cache = {};
    let cc;
    const stubs = {
        './CharacterModelLoader': { findNode: (node, name) => node.name === name ? node : node.children.map(child => stubs['./CharacterModelLoader'].findNode(child, name)).find(Boolean) || null },
        '../data/class': { CCClass: { fastDefine() {} } },
        '../value-types/value-type': { ValueType: class {} },
        '../global-exports': { legacyCC: {} },
        '../platform/debug': { warnID() {} },
        './mat3': { Mat3: class {} }, './mat4': { Mat4: class {} },
        './utils': { EPSILON: 1e-6, toDegree: v => v * 180 / Math.PI,
            clamp: (v, a, b) => Math.max(a, Math.min(b, v)), lerp: (a, b, t) => a + (b - a) * t, random: Math.random },
    };
    function load(file) {
        if (cache[file]) return cache[file].exports;
        const module = { exports: {} }; cache[file] = module;
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
        } }).outputText;
        const local = id => id === 'cc' ? cc : externalModules[id] ?? stubs[id] ?? load(path.resolve(path.dirname(file), id + '.ts'));
        vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(local, module, module.exports);
        return module.exports;
    }
    const { Vec3 } = load(path.join(engine, 'cocos/core/math/vec3.ts'));
    const { Quat } = load(path.join(engine, 'cocos/core/math/quat.ts'));
    const { Mat4 } = load(path.join(engine, 'cocos/core/math/mat4.ts'));
    class Node {
        isValid = true; rotation = new Quat(); position = new Vec3(); scale = new Vec3(1, 1, 1); children = []; name = ''; writes = 0;
        constructor(parent = null, x = 0, y = 0, z = 0) { this.parent = parent; this.position.set(x, y, z); if (parent) parent.children.push(this); }
        get eulerAngles() { const v = new Vec3(); Quat.toEuler(v, this.rotation); return v; }
        get worldMatrix() { return Mat4.fromRTS(new Mat4(), this.getWorldRotation(new Quat()), this.getWorldPosition(new Vec3()), this.getWorldScale(new Vec3())); }
        getChildByPath(value) { let node = this; for (const name of value.split('/').filter(Boolean)) node = node?.children.find(child => child.name === name); return node || null; }
        setWorldPosition(value) { if (this.parent) this.parent.inverseTransformPoint(this.position, value); else Vec3.copy(this.position, value); }
        setRotation(q) { Quat.copy(this.rotation, q); this.writes++; }
        setRotationFromEuler(x, y, z) { Quat.fromEuler(this.rotation, x, y, z); this.writes++; }
        setPosition(x, y, z) { if (typeof x === 'number') this.position.set(x, y, z); else Vec3.copy(this.position, x); }
        setScale(x, y, z) { if (typeof x === 'number') this.scale.set(x, y, z); else Vec3.copy(this.scale, x); }
        getWorldScale(out) { if (!this.parent) return Vec3.copy(out, this.scale); this.parent.getWorldScale(out); return Vec3.multiply(out, out, this.scale); }
        inverseTransformPoint(out, point) {
            const q = new Quat(), p = new Vec3(), scale = new Vec3();
            this.getWorldRotation(q); Quat.invert(q, q); this.getWorldPosition(p); this.getWorldScale(scale);
            Vec3.subtract(out, point, p); Vec3.transformQuat(out, out, q); return Vec3.divide(out, out, scale);
        }
        getWorldRotation(out) {
            if (!this.parent) return Quat.copy(out, this.rotation);
            this.parent.getWorldRotation(out);
            return Quat.multiply(out, out, this.rotation);
        }
        getWorldPosition(out) {
            if (!this.parent) return Vec3.copy(out, this.position);
            const q = new Quat(), p = new Vec3();
            this.parent.getWorldRotation(q); this.parent.getWorldPosition(p);
            this.parent.getWorldScale(out); Vec3.multiply(out, out, this.position); Vec3.transformQuat(out, out, q);
            return Vec3.add(out, out, p);
        }
        setWorldRotation(q) {
            const inverse = new Quat();
            if (this.parent) this.parent.getWorldRotation(inverse);
            Quat.invert(inverse, inverse);
            Quat.multiply(this.rotation, inverse, q); this.writes++;
        }
    }
    cc = { Node, Vec3, Quat, Mat4, gfx: { AttributeName: { ATTR_POSITION: 'POSITION', ATTR_JOINTS: 'JOINTS_0', ATTR_WEIGHTS: 'WEIGHTS_0' } } };
    return { load, Node, Vec3, Quat, Mat4, cc, root };
}
module.exports = { createHarness };
