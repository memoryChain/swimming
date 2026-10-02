const fs = require('node:fs');
const path = require('node:path');
const { createOutlineHarness } = require('../../tests/helpers/turtle-outline-harness.cjs');
const h = createOutlineHarness();
const visual = new h.TurtleBusVisual(new h.Node('Review'), 1,
    { courseLength: 50, direction: 1, startX: 0, finishX: 50, waterY: 0 });
h.pending[0](null, {});
const frames = [];
for (const age of [6, 6.1111, 7.2222]) {
    visual.update(age, 1, 0); visual.node.setPosition(0, -.06, 0);
    const meshes = [];
    const visit = node => {
        for (const renderer of node.renderers) {
            const g = renderer.mesh.data, positions = [], normals = [], v = new h.Vec3(), q = node.getWorldRotation(new h.Quat());
            for (let i = 0; i < g.positions.length; i += 3) {
                v.set(...g.positions.slice(i, i + 3)); h.Vec3.transformMat4(v, v, node.worldMatrix); positions.push(v.x, v.y, v.z);
                if (g.normals) { v.set(...g.normals.slice(i, i + 3)); h.Vec3.transformQuat(v, v, q); normals.push(v.x, v.y, v.z); }
            }
            meshes.push({ positions, normals, colors: g.colors, indices: g.indices, outline: node.name === 'TurtleOutline' });
        }
        node.children.forEach(visit);
    };
    visit(visual.node); frames.push(meshes);
}
const gripPath = path.join(__dirname, 'grip-review-data.json');
const character = [];
if (fs.existsSync(gripPath)) {
    const samples = JSON.parse(fs.readFileSync(gripPath, 'utf8'));
    const sample = samples.find(s => s.file === 'CartonSwimmer5.glb') || samples[0];
    for (const part of sample.parts) {
        const positions = part.vertices.flatMap(v => [v[0] - 2.85, v[2] - .06, v[1] + 2.85]);
        // 样件只交换了位置的 Y/Z，保存的索引仍是原 GLB 绕序；换回 Cocos 后直接使用。
        const indices = part.indices;
        const accum = new Map(), keys = positions.map((_, i) => i % 3 === 0 ? positions.slice(i,i+3).map(v => v.toFixed(5)).join(',') : null).filter(Boolean);
        for (let i = 0; i < indices.length; i += 3) {
            const a = indices[i], b = indices[i+1], c = indices[i+2], u = [], v = [];
            for (let j = 0; j < 3; j++) { u.push(positions[b*3+j]-positions[a*3+j]); v.push(positions[c*3+j]-positions[a*3+j]); }
            const n = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
            for (const id of [a,b,c]) { const value = accum.get(keys[id]) || [0,0,0]; n.forEach((x,j) => value[j] += x); accum.set(keys[id],value); }
        }
        const normals = keys.flatMap(key => { const n = accum.get(key) || [0,1,0], l = Math.hypot(...n) || 1; return n.map(v=>v/l); });
        character.push({ positions, normals, indices, colors: keys.flatMap(()=>part.color || [.63,.66,.69,1]) });
    }
}
const { TURTLE_BUS_OUTLINE_STYLE: style } = h.load(path.join(h.root, 'assets/scripts/core/TurtleBusOutline.ts'));
const output = path.join(h.root, '.cache/turtle-outline-review'); fs.mkdirSync(output,{recursive:true});
const template = fs.readFileSync(path.join(__dirname,'outline-review-template.html'),'utf8');
fs.writeFileSync(path.join(output,'index.html'), template.replace('/*__DATA__*/',JSON.stringify({ frames, character, style })));
visual.dispose(); console.log('已生成 .cache/turtle-outline-review/index.html');
