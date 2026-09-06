const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, Vec3, Mat4, root, createRig } = require('./helpers/character-contact-harness.cjs');
const { CharacterHeadBounds } = load(path.join(root, 'assets/scripts/character/CharacterHeadBounds.ts'));

// 使用透视和斜俯视的投影，独立对全部头部蒙皮顶点验证，不能只检查缓存盒本身。
const camera = { worldToScreen(p, out) {
    const depth = 7 + p.z * 0.97 + p.y * 0.24;
    return out.set(375 + p.x * 700 / depth, 400 + (p.y * 0.97 - p.z * 0.24) * 700 / depth, depth / 100);
} };
const actions = ['victory', 'joyful_jump', 'ymca_dance', 'dancing_twerk', 'defeated'];
for (const file of fs.readdirSync(path.join(root, 'assets/race/models')).filter(f => f.endsWith('.glb'))) {
    test(`${file}：帽子和头发在标记下方，动作、缩放和再来一局不依赖固定头高`, () => {
        const rig = createRig(file), bounds = new CharacterHeadBounds();
        bounds.bind(rig.renderers);
        const screen = new Vec3(), point = new Vec3(), weighted = new Vec3(), projected = new Vec3();
        let maximumGap = 0;
        for (let round = 0; round < 2; round++) {
            rig.wrapper.position.set(0.3, round * 0.2, 0);
            rig.wrapper.setRotationFromEuler(0, round ? 230 : 90, 0);
            if (round) rig.wrapper.scale.set(1.8, 1.8, 1.8);
            for (const id of actions) {
                const action = JSON.parse(fs.readFileSync(path.join(root, 'assets/race/model-actions/tPose', `Tpose_${id}.json`)));
                for (const phase of [0, 0.2, 0.5, 0.8]) {
                    rig.pose.applySampledActionPose(id, phase, 1, action);
                    assert.equal(bounds.topScreenPosition(camera, screen), true);
                    const matrices = new Map();
                    let top = -Infinity, minX = Infinity, maxX = -Infinity;
                    for (const vertex of rig.fullHead) {
                        weighted.set(0, 0, 0); let weight = 0;
                        for (const influence of vertex.influences) {
                            if (!matrices.has(influence.bone)) matrices.set(influence.bone, Mat4.multiply(new Mat4(), influence.bone.worldMatrix, influence.bind));
                            Vec3.transformMat4(point, vertex.point, matrices.get(influence.bone));
                            Vec3.scaleAndAdd(weighted, weighted, point, influence.weight); weight += influence.weight;
                        }
                        Vec3.multiplyScalar(weighted, weighted, 1 / weight);
                        camera.worldToScreen(weighted, projected);
                        top = Math.max(top, projected.y); minX = Math.min(minX, projected.x); maxX = Math.max(maxX, projected.x);
                    }
                    assert.ok(screen.y >= top - 1, `${id} ${phase} 头部穿过锚点 ${top - screen.y}px`);
                    assert.ok(screen.x >= minX && screen.x <= maxX, '标记横向仍在可见头部内');
                    maximumGap = Math.max(maximumGap, screen.y - top);
                }
            }
        }
        assert.ok(maximumGap < 35, `保守包围盒距离头顶过远 ${maximumGap}px`);
        bounds.clear(); assert.equal(bounds.topScreenPosition(camera, screen), false);
        bounds.bind(rig.renderers); assert.equal(bounds.topScreenPosition(camera, screen), true);
    });
}
