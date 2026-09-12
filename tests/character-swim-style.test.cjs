// 按角色分配动作，并检查翻身、重置和角色切换不会串用泳姿。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRig, load, root } = require('./helpers/character-contact-harness.cjs');
const { SWIMMER_MODEL_VARIANTS } = load(path.join(root, 'assets/scripts/core/ResourcePaths.ts'));
const snapshot = rig => JSON.stringify([
    rig.pose.root.position, rig.pose.root.rotation,
    ...rig.pose._manualBones.map(bone => bone.rotation),
]);
function sample(rig, projection, phase) {
    rig.pose.setSurfaceBodyUpProjection(projection);
    rig.pose.applyFreestylePose(phase, phase + Math.PI, phase * 2, phase * 2 + Math.PI, phase, 1, 1, 1);
}

test('正式角色只有肌肉男启用新版自由泳', () => {
    assert.deepEqual(SWIMMER_MODEL_VARIANTS.filter(v => v.surfaceSwimStyle === 'freestyle').map(v => v.id), ['muscleMan']);
});

for (const variant of SWIMMER_MODEL_VARIANTS) {
    const file = path.basename(variant.candidates[0]) + '.glb';
    test(`${variant.id}：比赛与预览按角色选择，翻身复位后仍使用配置动作`, () => {
        const rig = createRig(file), reference = createRig(file);
        rig.wrapper.setRotationFromEuler(90, 90, 0);
        reference.wrapper.setRotationFromEuler(90, 90, 0);
        reference.pose.setSurfaceSwimStyle(variant.id === 'muscleMan' ? 'freestyle' : 'legacy');
        for (const projection of [1, 0.5, 0, -0.25, -1, 1]) {
            for (const phase of [0, 0.9, 2.7, 4.6, 6.2]) {
                sample(rig, projection, phase);
                sample(reference, projection, phase);
                assert.equal(snapshot(rig), snapshot(reference));
                if (variant.id !== 'muscleMan') assert.equal(rig.pose._proneFreestyleWeight, 0);
            }
        }
    });
}

test('同一控制器切换角色泳姿会清除旧配置，仰面仍沿用旧划水', () => {
    const rig = createRig('MuscleMan.glb');
    rig.wrapper.setRotationFromEuler(90, 90, 0);
    sample(rig, 1, 4.6); const freestyle = snapshot(rig);
    rig.pose.setSurfaceSwimStyle();
    sample(rig, 1, 4.6); const legacy = snapshot(rig);
    assert.notEqual(freestyle, legacy, '两套动作必须实际不同');
    rig.pose.setSurfaceSwimStyle('freestyle');
    sample(rig, 1, 4.6);
    assert.equal(snapshot(rig), freestyle, '切回自由泳不能留下旧姿态');
    sample(rig, -1, 4.6); const supine = snapshot(rig);
    rig.pose.setSurfaceSwimStyle('legacy');
    sample(rig, -1, 4.6);
    assert.equal(snapshot(rig), supine, '仰面姿态不受角色自由泳开关影响');
    rig.pose.setSurfaceSwimStyle('freestyle');
    assert.equal(rig.pose._proneFreestyleWeight, 0, '切换配置保留当前身体投影');
});
