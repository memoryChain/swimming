// 执行实际观众生成代码，审计几何，并导出后台 Blender 可读的离线预览数据。
// npx --yes --package typescript@5.4.5 -c "node scripts/preview-spectator-crowd.cjs"
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'temp/spectator-preview');
fs.mkdirSync(output, { recursive: true });
let ts;
for (const dir of process.env.PATH.split(path.delimiter)) {
    const candidate = path.resolve(dir, '../typescript/lib/typescript.js');
    if (fs.existsSync(candidate)) { ts = require(candidate); break; }
}
if (!ts) throw Error('请使用注释中的固定版本 TypeScript 命令');
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { if (typeof x === 'object') return this.set(x.x, x.y, x.z); Object.assign(this, { x, y, z }); return this; }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    clone() { return new Vec3(this.x, this.y, this.z); }
    static transformQuat(out, a, q) {
        const { x, y, z } = a;
        const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
        return out.set(x + q.w * tx + q.y * tz - q.z * ty, y + q.w * ty + q.z * tx - q.x * tz, z + q.w * tz + q.x * ty - q.y * tx);
    }
}
class Quat {
    // 与项目 Creator 3.8.8 的 YZX 欧拉角公式保持一致。
    static fromEuler(out, x, y, z) {
        const k = Math.PI / 360, sx = Math.sin(x * k), cx = Math.cos(x * k), sy = Math.sin(y * k), cy = Math.cos(y * k), sz = Math.sin(z * k), cz = Math.cos(z * k);
        Object.assign(out, { x: sx * cy * cz + cx * sy * sz, y: cx * sy * cz + sx * cy * sz, z: cx * cy * sz - sx * sy * cz, w: cx * cy * cz - sx * sy * sz });
    }
}
class Color { constructor(r, g, b, a = 255) { Object.assign(this, { r, g, b, a }); } }
class Component {}
const cc = { Vec3, Quat, Color, Component, _decorator: { ccclass: () => c => c, property: () => {} } };
function load(source, filename, dependencies = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(id => {
        if (id === 'cc') return cc;
        if (id.endsWith('TimeScale')) return { scaledDelta: dt => dt };
        if (id.endsWith('SpectatorCameraFlashEmitter')) return {};
        if (dependencies[id]) return dependencies[id];
        throw Error(id);
    }, module, module.exports);
    return module.exports;
}
const templateModule = load(fs.readFileSync(path.join(root, 'assets/scripts/venue/SpectatorGeometry.ts'), 'utf8'), 'SpectatorGeometry.ts');
const relative = 'assets/scripts/venue/SpectatorCrowdBuilder.ts';
const expose = '\nexport { buildSpectatorGeometry, collectGrandstands, collectCornerAnchors, SPECTATOR_COLORS };';
const current = load(fs.readFileSync(path.join(root, relative), 'utf8') + expose, relative, { './SpectatorGeometry': templateModule });
// 可传入旧提交作对照；默认与当前 HEAD 比较工作区。
const baseline = process.argv[2] || 'HEAD';
const previous = load(execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, encoding: 'utf8' }) + expose, 'previous.ts', { './SpectatorGeometry': templateModule });

// 从最终 GLB 的节点矩阵和 accessor 包围盒恢复 Cocos 所见的世界坐标。
const bytes = fs.readFileSync(path.join(root, 'assets/race/pool/LowPolyPool.glb'));
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) { return Array.from({ length: 16 }, (_, i) => { const row = i % 4, col = Math.floor(i / 4); let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + row] * b[col * 4 + k]; return v; }); }
function transform(m, p) { return [0, 1, 2].map(i => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]); }
function localMatrix(n) {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1], t = n.translation || [0, 0, 0];
    return [(1 - 2*y*y - 2*z*z)*s[0], (2*x*y + 2*z*w)*s[0], (2*x*z - 2*y*w)*s[0], 0,
        (2*x*y - 2*z*w)*s[1], (1 - 2*x*x - 2*z*z)*s[1], (2*y*z + 2*x*w)*s[1], 0,
        (2*x*z + 2*y*w)*s[2], (2*y*z - 2*x*w)*s[2], (1 - 2*x*x - 2*y*y)*s[2], 0, ...t, 1];
}
function sceneNode(index, parent) {
    const n = gltf.nodes[index], world = mul(parent, localMatrix(n));
    let renderer = null;
    if (n.mesh !== undefined) {
        const points = [];
        for (const primitive of gltf.meshes[n.mesh].primitives) {
            const a = gltf.accessors[primitive.attributes.POSITION];
            for (let mask = 0; mask < 8; mask++) points.push(transform(world, [0, 1, 2].map(i => mask & (1 << i) ? a.max[i] : a.min[i])));
        }
        const min = [0, 1, 2].map(i => Math.min(...points.map(p => p[i]))), max = [0, 1, 2].map(i => Math.max(...points.map(p => p[i])));
        renderer = { model: { worldBounds: { center: new Vec3(...min.map((v, i) => (v + max[i]) / 2)), halfExtents: new Vec3(...min.map((v, i) => (max[i] - v) / 2)) } } };
    }
    return { name: n.name || '', worldPosition: new Vec3(...transform(world, [0, 0, 0])), children: (n.children || []).map(i => sceneNode(i, world)), getComponent: () => renderer };
}
const scene = { name: 'pool', children: gltf.scenes[gltf.scene || 0].nodes.map(i => sceneNode(i, identity)), getComponent: () => null };
function audit(g) {
    const count = g.positions.length / 3;
    assert.equal(g.colors.length, count * 4);
    assert(g.positions.every(Number.isFinite)); assert(g.colors.every(Number.isFinite));
    assert(count < 65536, '合并组必须保持 16 位索引');
    for (let i = 0; i < g.indices.length; i += 3) {
        const ids = g.indices.slice(i, i + 3); ids.forEach(v => assert(v >= 0 && v < count));
        const p = ids.map(v => g.positions.slice(v * 3, v * 3 + 3));
        const a = p[1].map((v, j) => v - p[0][j]), b = p[2].map((v, j) => v - p[0][j]);
        assert(Math.hypot(a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]) > 1e-10, '不能有退化三角形');
    }
    for (let i = 0; i < count; i++) for (const [axis, j] of [['x', 0], ['y', 1], ['z', 2]]) {
        assert(g.positions[i*3+j] >= g.minPos[axis] - 1e-6 && g.positions[i*3+j] <= g.maxPos[axis] + 1e-6);
    }
}
const report = {};
for (const [name, module] of [['before', previous], ['after', current]]) {
    const buckets = Array.from({ length: 15 }, () => []), builder = new module.SpectatorCrowdBuilder();
    const stands = module.collectGrandstands(scene);
    if (name === 'after') for (const stand of stands) {
        const x = (stand.bounds.minX + stand.bounds.maxX) / 2, z = (stand.bounds.minZ + stand.bounds.maxZ) / 2;
        const angle = stand.yaw * Math.PI / 180;
        assert(-Math.sin(angle) * (25 - x) + Math.cos(angle) * z > 0, '四侧观众必须面向泳池');
    }
    for (const stand of stands) builder.collectGrandstandSpectators(buckets, stand);
    builder.collectCornerSpectators(buckets, stands, module.collectCornerAnchors(scene));
    const geometry = buckets.map((b, i) => module.buildSpectatorGeometry(b, module.SPECTATOR_COLORS[i % 5]));
    geometry.forEach(audit);
    const samples = [0, 1, 2].map(pose => module.buildSpectatorGeometry([{ pos: new Vec3(pose * 0.95, 0.4, 0), width: 0.45, height: 0.75, topWidthScale: 1, topOffset: 0, row: 1, col: pose, side: 1, yaw: 0, brightness: 1, saturation: 1, detailed: true, pose }], module.SPECTATOR_COLORS[pose]));
    const sampleRear = module.buildSpectatorGeometry([{ pos: new Vec3(3 * 0.95, 0.4, 0), width: 0.45, height: 0.75, topWidthScale: 1, topOffset: 0, row: 1, col: 3, side: 1, yaw: 0, brightness: 1, saturation: 1, detailed: false, pose: 1 }], module.SPECTATOR_COLORS[3]);
    fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify({ geometry, samples: [...samples, sampleRear] }));
    report[name] = { spectators: buckets.flat().length, detailed: buckets.flat().filter(s => s.detailed).length, groups: geometry.length, triangles: geometry.reduce((sum, g) => sum + g.indices.length / 3, 0), vertices: geometry.reduce((sum, g) => sum + g.positions.length / 3, 0), maxGroupVertices: Math.max(...geometry.map(g => g.positions.length / 3)), sampleTriangles: [...samples, sampleRear].map(g => g.indices.length / 3) };
}
assert.equal(report.before.spectators, report.after.spectators, '不改变观众数量和落位规则');
// 装饰动画停用与节流：检查实际组件逻辑，而非只检查常量。
const wobble = new current.SpectatorGroupWobble(); let writes = 0;
wobble.node = { activeInHierarchy: true, position: new Vec3(), setPosition: () => writes++ };
wobble.start(); for (let i = 0; i < 120; i++) wobble.update(1 / 60);
assert(writes <= 48); const count = writes;
wobble.node.activeInHierarchy = false; wobble.update(1); assert.equal(writes, count);
wobble.node.activeInHierarchy = true; wobble.update(0); assert.equal(writes, count);
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
