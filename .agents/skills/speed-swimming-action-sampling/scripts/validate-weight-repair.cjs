// 比较独立蒙皮候选与固定基线，检查全部共享动作和选区三角边。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../../../..');
assert.equal(process.argv.length, 6, '用法：node validate-weight-repair.cjs 基线目录 候选目录 报告目录 模型.glb');
const { createRig, Vec3, Mat4 } = require(path.join(ROOT, 'tests/helpers/character-contact-harness.cjs'));
const P = path.resolve(process.argv[4]), file = process.argv[5];
fs.mkdirSync(P, { recursive: true });
const modelDirectories = [process.argv[2], process.argv[3]].map(p => path.resolve(p));
const rigs = modelDirectories.map(folder => createRig(file, folder));
const bytes = fs.readFileSync(path.join(modelDirectories[0], file)), size = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + size)), bin = bytes.subarray(28 + size), primitive = doc.meshes[0].primitives[0];
function values(i) { const a = doc.accessors[i], v = doc.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], size = { 5123: 2, 5126: 4 }[a.componentType], read = { 5123: 'readUInt16LE', 5126: 'readFloatLE' }[a.componentType]; return Array.from({ length: a.count * n }, (_, k) => bin[read]((v.byteOffset || 0) + (a.byteOffset || 0) + Math.floor(k / n) * (v.byteStride || n * size) + k % n * size)); }
const indices = values(primitive.indices), pos = values(primitive.attributes.POSITION), uv = values(primitive.attributes.TEXCOORD_0), changed = new Set(JSON.parse(fs.readFileSync(path.join(modelDirectories[1], file.replace(/\.glb$/, '.report.json')))).changedVertices);
// 先独立核对字节改动，只允许 WEIGHTS_0；验证候选报告没有遗漏顶点。
const candidateBytes = fs.readFileSync(path.join(modelDirectories[1], file)), weightAcc = doc.accessors[primitive.attributes.WEIGHTS_0], weightView = doc.bufferViews[weightAcc.bufferView];
assert.equal(candidateBytes.length, bytes.length);
const allowed = new Set(), actual = new Set();
for (let v = 0; v < weightAcc.count; v++) {
    const offset = 28 + size + (weightView.byteOffset || 0) + (weightAcc.byteOffset || 0) + v * (weightView.byteStride || 16);
    if (!bytes.subarray(offset, offset + 16).equals(candidateBytes.subarray(offset, offset + 16)))
        actual.add(v);
    for (let k = 0; k < 16; k++)
        allowed.add(offset + k);
}
assert.deepEqual(actual, changed);
for (let i = 0; i < bytes.length; i++)
    if (bytes[i] !== candidateBytes[i])
        assert.ok(allowed.has(i), '检测到非权重字节改动');
const edges = [], seen = new Set();
for (let i = 0; i < indices.length; i += 3)
    for (let k = 0; k < 3; k++) {
        const a = indices[i + k], b = indices[i + (k + 1) % 3], id = Math.min(a, b) + ':' + Math.max(a, b);
        if (!changed.has(a) && !changed.has(b) || seen.has(id))
            continue;
        seen.add(id);
        const l = Math.hypot(...[0, 1, 2].map(j => pos[a * 3 + j] - pos[b * 3 + j]));
        if (l > .003)
            edges.push([a, b, l]);
    }
const pieces = rigs.map(r => { const render = r.renderers[0]; return { r, bones: render.skeleton.joints.map(p => r.wrapper.getChildByPath(p)), binds: render.skeleton.bindposes, joints: render.mesh.readAttribute(0, 'JOINTS_0'), weights: render.mesh.readAttribute(0, 'WEIGHTS_0') }; });
const q = new Vec3();
function skin(g) { const matrices = g.bones.map((b, i) => Mat4.multiply(new Mat4(), b.worldMatrix, g.binds[i])), out = new Float64Array(pos.length); for (let v = 0; v < pos.length / 3; v++)
    for (let k = 0; k < 4; k++) {
        const w = g.weights[v * 4 + k];
        if (!w)
            continue;
        q.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        Vec3.transformMat4(q, q, matrices[g.joints[v * 4 + k]]);
        assert.ok(Number.isFinite(q.x + q.y + q.z));
        out[v * 3] += q.x * w;
        out[v * 3 + 1] += q.y * w;
        out[v * 3 + 2] += q.z * w;
    } return out; }
const percentile = (a, p) => { a.sort((x, y) => x - y); return a[Math.floor((a.length - 1) * p)]; };
const selected = ['clapping', 'waving', 'arm_stretching', 'ymca_dance', 'divePrep', 'victory'];
const frames = [];
let maxOutside = 0, maxRest = 0;
function check(name, phase, draw = false) {
    const vertices = pieces.map(skin), ratios = vertices.map((a, i) => edges.map(([v, w, l]) => Math.hypot(...[0, 1, 2].map(j => a[v * 3 + j] - a[w * 3 + j])) / (l * rigs[i].wrapper.scale.x)));
    let delta = 0;
    for (let v = 0; v < pos.length / 3; v++) {
        const d = Math.hypot(...[0, 1, 2].map(j => vertices[0][v * 3 + j] - vertices[1][v * 3 + j]));
        if (!changed.has(v))
            maxOutside = Math.max(maxOutside, d);
        delta = Math.max(delta, d);
    }
    if (name === 'rest')
        maxRest = delta;
    if (draw)
        for (let i = 0; i < 2; i++)
            frames.push({ name: name + '-' + phase + '-' + (i ? 'candidate' : 'baseline'), vertices: Array.from({ length: pos.length / 3 }, (_, v) => [vertices[i][v * 3], -vertices[i][v * 3 + 2], vertices[i][v * 3 + 1]]) });
    return { before: percentile(ratios[0], .95), after: percentile(ratios[1], .95), delta };
}
check('rest', 0, true);
const rows = [];
for (const f of fs.readdirSync(path.join(ROOT, 'assets/race/model-actions/tPose')).filter(f => f.endsWith('.json')).sort()) {
    const action = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/race/model-actions/tPose', f))), samples = action.samples || [action];
    assert.equal(samples.length, action.frameEnd - action.frameStart + 1, '动作样本数必须覆盖首尾全部原帧');
    const row = { id: action.id, count: samples.length, p95Before: 0, p95After: 0, maxDelta: 0 };
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        for (const r of rigs) {
            r.pose.restoreBasePose();
            if (action.id === 'breaststroke')
                r.pose.applyBreaststrokeSampleRotations(s, 1);
            else
                r.pose.applySampledActionRotations(s, 1, action);
            if (s.hipTranslation)
                r.pose.applySampledActionTranslation(s, 1, action);
        }
        const result = check(action.id, i, selected.includes(action.id) && [0, Math.floor(samples.length / 2)].includes(i));
        row.p95Before = Math.max(row.p95Before, result.before);
        row.p95After = Math.max(row.p95After, result.after);
        row.maxDelta = Math.max(row.maxDelta, result.delta);
    }
    rows.push(row);
    console.log(JSON.stringify(row));
}
assert.ok(maxOutside < 1e-12);
assert.ok(maxRest < 1e-6);
for (const row of rows)
    assert.ok(row.p95After <= row.p95Before + .03, JSON.stringify(row));
fs.writeFileSync(path.join(P, 'shared-action-audit.json'), JSON.stringify({ rows, totalSamples: rows.reduce((a, r) => a + r.count, 0), changedVertices: changed.size, edges: edges.length, maxOutside, maxRest }, null, 2));
fs.writeFileSync(path.join(P, 'render-poses.json'), JSON.stringify({ indices, uv, frames }));
console.log({ maxOutside, maxRest, frames: frames.length });
