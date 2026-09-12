const fs = require('node:fs');
const path = require('node:path');
const { Vec3, Mat4, root } = require('./character-contact-harness.cjs');

// 按真实三角形边测量肘部蒙皮拉伸，包含辅助 Twist 骨，不能仅检查主骨矩阵。
function elbowStrainSampler(rig, file) {
    const data = fs.readFileSync(path.join(rig.modelDirectory || path.join(root, 'assets/race/models'), file));
    const size = data.readUInt32LE(12), gltf = JSON.parse(data.subarray(20, 20 + size));
    const binary = data.subarray(28 + size), pieces = [];
    const point = new Vec3(), ratios = [];
    for (const renderer of rig.renderers) {
        const bones = renderer.skeleton.joints.map(p => rig.wrapper.getChildByPath(p));
        renderer.mesh.struct.primitives.forEach((primitive, p) => {
            const positions = renderer.mesh.readAttribute(p, 'POSITION');
            const joints = renderer.mesh.readAttribute(p, 'JOINTS_0');
            const weights = renderer.mesh.readAttribute(p, 'WEIGHTS_0');
            const accessor = gltf.accessors[primitive.indices], view = gltf.bufferViews[accessor.bufferView];
            const bytes = { 5121: 1, 5123: 2, 5125: 4 }[accessor.componentType];
            const read = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5125: 'readUInt32LE' }[accessor.componentType];
            const indices = Array.from({ length: accessor.count }, (_, i) =>
                binary[read]((view.byteOffset || 0) + (accessor.byteOffset || 0) + i * bytes));
            const labels = [], edges = [], seen = new Set();
            for (let v = 0; v < positions.length / 3; v++) {
                let category = 0, total = 0;
                for (let k = 0; k < 4; k++) {
                    const bone = bones[joints[v * 4 + k]], weight = weights[v * 4 + k];
                    if (!/^(L|R)_(Clavicle|Upperarm|Forearm|Hand)(Twist\d+)?$/.test(bone?.name)) continue;
                    total += weight;
                    if (weight > 0.15) category |= bone.name.includes('Clavicle') ? 1
                        : bone.name.includes('Upperarm') ? 2 : bone.name.includes('Forearm') ? 4 : 8;
                }
                labels.push(total > 0.45 ? category : 0);
            }
            for (let i = 0; i < indices.length; i += 3) for (let k = 0; k < 3; k++) {
                const a = indices[i + k], b = indices[i + (k + 1) % 3];
                const key = Math.min(a, b) + ':' + Math.max(a, b), category = labels[a] | labels[b];
                if (!labels[a] || !labels[b] || (category & 1) || !(category & 2)
                    || category === 2 || seen.has(key)) continue;
                seen.add(key);
                const length = Math.hypot(...[0, 1, 2].map(j => positions[a * 3 + j] - positions[b * 3 + j]));
                if (length > 0.003) edges.push({ a, b, length });
            }
            pieces.push({ bones, binds: renderer.skeleton.bindposes, positions, joints, weights, edges,
                world: new Float64Array(positions.length) });
        });
    }
    return {
        sample() {
            for (const piece of pieces) {
                const matrices = piece.bones.map((bone, i) => Mat4.multiply(new Mat4(), bone.worldMatrix, piece.binds[i]));
                const { positions, joints, weights, world } = piece;
                world.fill(0);
                for (let v = 0; v < positions.length / 3; v++) for (let k = 0; k < 4; k++) {
                    const weight = weights[v * 4 + k];
                    if (!weight) continue;
                    point.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
                    Vec3.transformMat4(point, point, matrices[joints[v * 4 + k]]);
                    world[v * 3] += point.x * weight;
                    world[v * 3 + 1] += point.y * weight;
                    world[v * 3 + 2] += point.z * weight;
                }
                for (const edge of piece.edges) {
                    const a = edge.a * 3, b = edge.b * 3;
                    ratios.push(Math.hypot(world[a] - world[b], world[a + 1] - world[b + 1], world[a + 2] - world[b + 2])
                        / (edge.length * rig.wrapper.scale.x));
                }
            }
        },
        percentile95() { ratios.sort((a, b) => a - b); return ratios[Math.floor(ratios.length * 0.95)]; },
    };
}
module.exports = { elbowStrainSampler };
