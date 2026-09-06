const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, Node, Vec3, Quat, root, createRig } = require('./helpers/character-contact-harness.cjs');
const { awardsPodiumSurface } = load(path.join(root, 'assets/scripts/venue/AwardsPodiumSurface.ts'));

test('轻微离地跨过支撑阈值时骨盆与脚位连续，不突然吸附或弹起', () => {
    const { pose, soles, wrapper } = createRig('CartonSwimmer10.glb');
    wrapper.position.y = .982; pose.setStandingSurface(.982, soles);
    const source = JSON.parse(fs.readFileSync(path.join(root, 'assets/race/model-actions/tPose/Tpose_happy.json')));
    const sample = { ...source.samples[240], phase: 0, footLiftHeights: [0, .00299] };
    const action = { ...source, samples: [sample] };
    pose.applySampledActionPose('happy', 0, 1, action);
    const hip = pose._hips.getWorldPosition(new Vec3()), foot = pose._rightFoot.getWorldPosition(new Vec3());
    sample.footLiftHeights[1] = .00301;
    pose.applySampledActionPose('happy', 0, 1, action);
    assert.ok(Vec3.distance(hip, pose._hips.getWorldPosition(new Vec3())) < .001);
    assert.ok(Vec3.distance(foot, pose._rightFoot.getWorldPosition(new Vec3())) < .001);
});

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
        assert.ok(soles._feet.every(foot => foot.length <= 32));
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
                    const lift = sample.footLiftHeights.map((v, side) => (v + next.footLiftHeights[side]) / 2);
                    const mask = (lift[0] <= 0.003 ? 1 : 0) | (lift[1] <= 0.003 ? 2 : 0);
                    for (let side = 0; side < 2; side++) if (mask & (1 << side)) {
                        const scale = pose._sampledActionHipTranslationScale * pose.root.getWorldScale(new Vec3()).y;
                        const error = Math.abs(exactY(side) - surface - lift[side] * scale);
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

for (const file of fs.readdirSync(path.join(root, 'assets/race/models')).filter(f => f.endsWith('.glb'))) {
    test(`${file}：领奖按源足部运动适配，抬脚自由运动且不穿台`, () => {
        const { pose, soles, wrapper, exactY } = createRig(file);
        const surface = 0.982;
        wrapper.position.y = surface;
        const grounding = pose.applySampledActionGrounding, penetration = pose.preventRaisedFootPenetration;
        const bones = [pose._leftUpLeg, pose._leftLeg, pose._leftFoot, pose._leftToe,
            pose._rightUpLeg, pose._rightLeg, pose._rightFoot, pose._rightToe];
        const modelUp = Vec3.transformQuat(new Vec3(), Vec3.UNIT_Y, pose.root.getWorldRotation(new Quat()));
        const soleNormals = [2, 3, 6, 7].map(index => Vec3.transformQuat(new Vec3(), modelUp,
            Quat.invert(new Quat(), bones[index].getWorldRotation(new Quat()))));
        let raisedFrames = 0;
        for (const id of ['angry', 'happy', 'dancing_twerk', 'ymca_dance', 'joyful_jump', 'victory_idle']) {
            const action = JSON.parse(fs.readFileSync(path.join(root, 'assets/race/model-actions/tPose', `Tpose_${id}.json`)));
            for (let i = 0; i < action.samples.length - 1; i += 3) {
                const a = action.samples[i], b = action.samples[i + 1], phase = (a.phase + b.phase) / 2;
                const lift = a.footLiftHeights.map((v, side) => (v + b.footLiftHeights[side]) / 2);
                pose.setStandingSurface(surface, soles);
                pose.applySampledActionGrounding = () => {};
                pose.preventRaisedFootPenetration = () => {};
                pose.applySampledActionPose(id, phase, 1, action);
                const rotations = bones.map(bone => bone.getWorldRotation(new Quat()));
                const rawDelta = exactY(0) - exactY(1);
                pose.applySampledActionGrounding = grounding; pose.preventRaisedFootPenetration = penetration;
                pose.setStandingSurface(surface, soles); pose.applySampledActionPose(id, phase, 1, action);
                // 从源数据独立复核鞋底法线；既防止把全部脚掌压平，也防止复用目标错误前倾。
                for (let index = 0; index < 4; index++) {
                    const q = Quat.slerp(new Quat(), new Quat(...a.footOrientationDeltas[index]), new Quat(...b.footOrientationDeltas[index]), .5);
                    const expected = Vec3.transformQuat(new Vec3(), Vec3.UNIT_Y, q);
                    Vec3.transformQuat(expected, expected, pose.root.getWorldRotation(new Quat()));
                    const actual = Vec3.transformQuat(new Vec3(), soleNormals[index], bones[[2, 3, 6, 7][index]].getWorldRotation(new Quat()));
                    assert.ok(Vec3.distance(actual, expected) < .00001, `${id} 帧 ${i} 足部 ${index} 应跟随源脚掌倾角`);
                }
                assert.ok(Math.min(exactY(0), exactY(1)) >= surface - 0.008, `${id} 帧 ${i} 不压平脚掌也不能穿台：${exactY(0)-surface},${exactY(1)-surface}，源高度 ${lift}`);
                for (let side = 0; side < 2; side++) {
                    const safelyRaised = lift[side] >= 0.012 && (lift[1 - side] >= 0.012
                        || (lift[1 - side] <= 0.003 && (side === 0 ? rawDelta : -rawDelta) > 0.015));
                    for (let joint = safelyRaised ? 0 : 2; joint < 4; joint++) {
                        const index = side * 4 + joint;
                        assert.ok(Math.abs(Quat.dot(rotations[index], bones[index].getWorldRotation(new Quat()))) > 0.999999,
                            `${id} 帧 ${i} ${bones[index].name} 必须保留原动作，不能压平/拉回抬脚腿`);
                    }
                    if (safelyRaised && lift[1 - side] <= 0.003) {
                        raisedFrames++;
                        assert.ok(exactY(side) - surface > 0.006, `${id} 帧 ${i} 的抬脚不能被吸到台面`);
                    }
                }
            }
        }
        assert.ok(raisedFrames > 0, '必须实际覆盖支撑脚旁的抬脚');
    });

    test(`${file}：拍手维持原鞋底形状并落台，不能把足骨轴向误当成踮脚`, () => {
        const { pose, soles, wrapper, exactY } = createRig(file);
        const action = JSON.parse(fs.readFileSync(path.join(root, 'assets/race/model-actions/tPose/Tpose_clapping.json')));
        const surface = .982;
        // 原鞋型可能带鞋跟或翘起的鞋头，应检查相对静止鞋底的变化，不能把鞋本身压平。
        const restGaps = [0, 1].map(side => exactY(side, null, null, 'heel') - exactY(side, null, null, 'forefoot'));
        for (const yaw of [0, 90, 270]) {
            wrapper.position.y = surface; wrapper.setRotationFromEuler(0, yaw, 0);
            pose.setStandingSurface(surface, soles);
            for (let i = 0; i < action.samples.length - 1; i++) {
                pose.applySampledActionPose('clapping', (action.samples[i].phase + action.samples[i + 1].phase) / 2, 1, action);
                for (let side = 0; side < 2; side++) {
                    const heel = exactY(side, null, null, 'heel'), front = exactY(side, null, null, 'forefoot');
                    assert.ok(Math.abs(heel - front - restGaps[side]) < .008,
                        `朝向 ${yaw} 帧 ${i} 脚 ${side} 额外踮脚高度 ${heel-front-restGaps[side]}`);
                    assert.ok(Math.abs(Math.min(heel, front) - surface) < .008,
                        `拍手支撑脚应落台：脚跟 ${heel-surface}，前掌 ${front-surface}`);
                }
            }
        }
    });
}
