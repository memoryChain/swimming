const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, Node, Vec3, root, createRig } = require('./helpers/character-contact-harness.cjs');
const { awardsPodiumSurface } = load(path.join(root, 'assets/scripts/venue/AwardsPodiumSurface.ts'));

test('台面取当前本体几何，忽略过期渲染包围盒与高出的描边，并应用父级变换', () => {
    const parent = new Node(); parent.position.set(2, 3, 4); parent.scale.set(2, 2, 2);
    const podium = new Node(parent); podium.name = 'award_podium_1';
    podium.position.set(1, 0.2, -1); podium.setRotationFromEuler(0, 35, 0);
    podium.getComponent = () => ({ model: { worldBounds: { center: new Vec3(0, 100, 0), halfExtents: new Vec3(99, 99, 99) } },
        mesh: { struct: { primitives: [{}] }, readAttribute: () => [-0.6, 0, -0.55, 0.6, 0.78, 0.55] } });
    const outline = new Node(podium); outline.name = '描边'; outline.position.y = 100;
    outline.getComponent = () => { throw Error('不能读取描边包围盒'); };
    const bounds = awardsPodiumSurface(parent, 'award_podium_1');
    assert.ok(Math.abs(bounds.maxY - (3 + 2 * (0.2 + 0.78))) < 1e-6);
    assert.equal(awardsPodiumSurface(parent, 'award_podium_2'), null);
});


for (const file of fs.readdirSync(path.join(root, 'assets/race/models')).filter(f => f.endsWith('.glb'))) {
    test(`${file}：实际蒙皮鞋底对齐三种台高，重开解除接地，跳跃保留腾空`, () => {
        const { pose, soles, wrapper, exactY } = createRig(file);
        assert.ok(soles.ready, '必须识别两只鞋底');
        assert.ok(soles._feet.every(foot => foot.length <= 16));
        const actions = ['victory', 'victory_idle', 'joyful_jump', 'chicken_dance', 'ymca_dance', 'silly_dancing', 'dancing_twerk', 'defeated', 'angry', 'loser', 'happy', 'waving_0713', 'clapping', 'excited'];
        let maxError = 0, airborneLift = 0;
        for (let round = 0; round < 3; round++) {
            const surface = [0.982, 0.762, 0.642][round];
            wrapper.position.set(-4, surface, -0.3);
            wrapper.setRotationFromEuler(0, [90, 270, 45][round], 0);
            pose.setStandingSurface(surface, soles);
            pose.applyPreRaceStandingPose();
            assert.ok(Math.abs(Math.min(exactY(0), exactY(1)) - surface) < 0.008, '动作未加载时仍应接地');
            for (const id of actions) {
                const action = JSON.parse(fs.readFileSync(path.join(root, 'assets/race/model-actions/tPose', `Tpose_${id}.json`)));
                for (let i = 0; i < action.samples.length; i += Math.max(1, Math.floor(action.samples.length / 9))) {
                    const sample = action.samples[i];
                    const next = action.samples[Math.min(i + 1, action.samples.length - 1)];
                    const phase = Math.min(0.999999, (sample.phase + next.phase) / 2);
                    pose.applySampledActionPose(id, phase, 1, action);
                    const mask = id === 'dancing_twerk' ? 3 : sample.groundedFeet & next.groundedFeet;
                    for (let side = 0; side < 2; side++) if (mask & (1 << side)) {
                        const error = Math.abs(exactY(side) - surface);
                        maxError = Math.max(maxError, error);
                        assert.ok(error < 0.008, `${id} 帧 ${i} 脚 ${side} 偏差 ${error}`);
                    }
                    if (id === 'joyful_jump' && !mask) airborneLift = Math.max(airborneLift, Math.min(soles.worldY(0), soles.worldY(1)) - surface);
                }
            }
            pose.setStandingSurface(null, soles);
            assert.equal(pose._standingSurfaceY, null);
        }
        assert.ok(airborneLift > 0.03, '跳跃不能被吸到台面');
        console.log(`${file} 最大接地偏差 ${(maxError * 1000).toFixed(2)}mm，跳跃高度 ${airborneLift.toFixed(3)}m`);
    });
}
