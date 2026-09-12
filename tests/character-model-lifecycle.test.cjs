const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, root, createRig, Vec3 } = require('./helpers/character-contact-harness.cjs');
const { CharacterPoseStateController } = load(path.join(root, 'assets/scripts/character/CharacterPoseStateController.ts'));
const models = fs.readdirSync(path.join(root, 'assets/race/models')).filter(f => f.endsWith('.glb'));

function destroyTree(node) {
    for (const child of node.children) destroyTree(child);
    // 模拟 Creator 真正销毁后的节点：引用仍非空，但变换数据已释放。
    node.isValid = false;
    node.parent = null;
    node.position = node.rotation = node.scale = null;
}

test('复现旧模型销毁后，未解绑的身体查询会读取空变换', () => {
    const { pose, wrapper } = createRig(models[0]);
    destroyTree(wrapper);
    assert.throws(() => pose.getUpperBodyWorldPosition(new Vec3()), TypeError);
    assert.throws(() => pose.getSplashBoneWorldPosition('Head', new Vec3()), TypeError);
});

for (const file of models) {
    test(`${file}：完赛后卸载、等待、重新绑定均不访问旧骨骼`, () => {
        const original = createRig(file);
        const { pose } = original;
        let model = original.wrapper;
        let time = 0;
        const controller = new CharacterPoseStateController({
            pose, getModel: () => model, getRoot: () => pose.root, getSelfTime: () => time,
            updateSplashSurface() {}, setSplashVisible() {}, modelScale: () => 1.35,
            raceModelYOffset: () => 0, raceModelEulerDegrees: () => [90, 90, 0],
        });
        const out = new Vec3(123, 456, 789);
        const positions = Array.from({ length: 12 }, () => new Vec3());
        for (let cycle = 0; cycle < 3; cycle++) {
            controller.enterFreestyle();
            pose.applyFreestylePose(0.7, 2.1, 0.3, 1.2, 1, 1, 1, 1);
            controller.enterTreadWater();
            assert.equal(controller.isPresentationMotionActive, true, '完赛立即进入踩水，无过渡等待');
            time += 0.1;
            controller.update(0.1, false);
            controller.resetRuntime();
            pose.unbind();
            destroyTree(model);
            model = null;
            assert.equal(pose.getUpperBodyWorldPosition(out), false);
            assert.equal(pose.getHeadWorldPosition(out), false);
            assert.equal(pose.getHipWorldPosition(out), false);
            assert.equal(pose.getStandingFootCenterWorldPosition(out), false);
            assert.equal(pose.getSwimBoundaryWorldPositions(positions), 0);
            assert.equal(pose.getFlipTurnFootContactWorldPositions(positions), 0);
            for (const name of ['Head', 'Body', 'LeftHand', 'RightHand', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'Foot']) {
                assert.equal(pose.getSplashBoneWorldPosition(name, out), false);
            }
            assert.equal(pose.capturePoseSnapshot(), null);
            pose.restoreBasePose();
            pose.applyCollisionSoftness({ side: 1, forward: 1, sideVelocity: 1, forwardVelocity: 1 }, 0.1);
            controller.enterShowcaseStanding();
            controller.update(0.5, false);
            // 新模型异步到达，复用同一个控制器与展示状态。
            const replacement = createRig(models[(models.indexOf(file) + cycle + 1) % models.length]);
            model = replacement.wrapper;
            pose.bind(replacement.pose.root);
            pose.captureBasePose();
            controller.reapplyCurrentState();
            controller.update(0.1, false);
            assert.equal(pose.getUpperBodyWorldPosition(out), true);
            assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z));
            assert.ok(pose.getSwimBoundaryWorldPositions(positions) > 0);
        }
    });
}
