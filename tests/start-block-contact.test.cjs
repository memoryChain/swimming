const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, Node, Vec3, Quat, root, createRig } = require('./helpers/character-contact-harness.cjs');
const { readStartBlockSurface } = load(path.join(root, 'assets/scripts/venue/StartBlockSurface.ts'));
const { CharacterPoseStateController } = load(path.join(root, 'assets/scripts/character/CharacterPoseStateController.ts'));
const prep = JSON.parse(fs.readFileSync(path.join(root, 'assets/race/model-actions/tPose/Tpose_divePrep.json')));
const waving = JSON.parse(fs.readFileSync(path.join(root, 'assets/race/model-actions/tPose/Tpose_waving.json')));

function blockSurface(yaw = 0, scale = 0.8) {
    const data = fs.readFileSync(path.join(root, 'assets/race/pool/StartBlock.glb'));
    const size = data.readUInt32LE(12), gltf = JSON.parse(data.subarray(20, 20 + size)), binary = data.subarray(28 + size);
    assert.equal(gltf.nodes.length, 1, '起跳台层级改变时需要扩展真实资源测试');
    const accessor = index => {
        const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView], values = [];
        const count = a.type === 'SCALAR' ? 1 : 3;
        const bytes = { 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
        const read = { 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' }[a.componentType];
        for (let i = 0; i < a.count; i++) for (let j = 0; j < count; j++) values.push(binary[read]((v.byteOffset || 0) + (a.byteOffset || 0) + i * (v.byteStride || bytes * count) + j * bytes));
        return values;
    };
    const node = new Node(); node.position.y = 0.2; node.setRotationFromEuler(0, yaw, 0); node.setScale(scale, scale, scale);
    const primitives = gltf.meshes[0].primitives;
    node.getComponentsInChildren = () => [{ node, mesh: { struct: { primitives }, readAttribute: p => accessor(primitives[p].attributes.POSITION), readIndices: p => accessor(primitives[p].indices) } }];
    return readStartBlockSurface(node);
}

function armClearance(exactHandBounds, side, surface, yaw) {
    let nearest = Infinity;
    for (const band of surface.obstacleBands) {
        const arm = exactHandBounds(side, band.maxY, true, band.minY);
        if (!Number.isFinite(arm.min.x) || arm.min.z >= band.maxZ || arm.max.z <= band.minZ) continue;
        nearest = Math.min(nearest, yaw ? band.minX - arm.max.x : arm.min.x - band.maxX);
    }
    return nearest;
}

test('真实起跳台识别约 11.2° 主踏面，排除更高的小边条，缩放和反向摆放生效', () => {
    const plane = blockSurface(), reverse = blockSurface(180), larger = blockSurface(0, 1);
    const angle = Math.acos(plane.ny) * 180 / Math.PI;
    assert.ok(angle > 11 && angle < 12);
    assert.ok(Math.abs(plane.nx + reverse.nx) < 1e-5);
    assert.ok(Math.abs(plane.maxY - 0.8) < 0.001);
    assert.ok(Math.abs(larger.maxY - 0.95) < 0.001);
    assert.equal(plane.obstacleBands.length, 16);
    assert.ok(plane.obstacleBands.at(-1).maxX < plane.obstacleMaxX - 0.05, '上方台沿不能复用外突底座的最远边界');
    for (let i = 0; i < plane.obstacleBands.length; i++) {
        assert.ok(Math.abs(plane.obstacleBands[i].maxX + reverse.obstacleBands[i].minX) < 1e-5);
    }
});

for (const file of fs.readdirSync(path.join(root, 'assets/race/models')).filter(f => f.endsWith('.glb'))) {
    test(`${file}：斜台展示→准备→离台，全程保留根节点轨迹`, () => {
        const { pose, soles, hands, wrapper, exactY, exactHandBounds } = createRig(file);
        const racer = new Node(); wrapper.parent = racer; racer.children.push(wrapper);
        const scale = wrapper.scale.x;
        let clock = 0;
        const controller = new CharacterPoseStateController({ pose, getModel: () => wrapper, getRoot: () => pose.root,
            getSelfTime: () => clock, updateSplashSurface() {}, setSplashVisible() {}, modelScale: () => scale,
            raceModelYOffset: () => 0, raceModelEulerDegrees: () => [90, 90, 0] });
        pose.setDivePrepPoseOverride(prep);
        controller.setShowcaseAction('waving', waving);
        let worst = 0;
        for (const yaw of [0, 180]) {
            const surface = blockSurface(yaw);
            racer.position.set(yaw ? -0.22 : 0.22, 0.1, 0);
            racer.setRotationFromEuler(0, yaw, 0);
            const rootPosition = Vec3.clone(racer.position), rootRotation = Quat.clone(racer.rotation);
            pose.setStandingSurface(surface.maxY + 0.002, soles, surface);
            controller.enterShowcaseStanding(); clock += 0.3; controller.update(0.3, false);
            assert.ok(Math.abs(exactY(0, surface) - 0.002) < 0.008, '展示脚掌直接接触斜面');
            const showcaseRotation = pose._leftFoot.getWorldRotation(new Quat());
            const fromHip = Vec3.clone(pose._hips.position);
            pose.setStandingSurface(null, soles); pose.setDiveSupportPlane(surface, soles);
            controller.enterDiveReady(0.42);
            assert.ok(Vec3.distance(pose._hips.position, fromHip) < 1e-6, '过渡起点不能跳变骨盆高度');
            const previousHands = [pose._leftHand.getWorldRotation(new Quat()), pose._rightHand.getWorldRotation(new Quat())];
            for (let i = 0; i < 30; i++) {
                controller.update(1 / 60, false);
                assert.ok(Math.min(exactY(0, surface), exactY(1, surface)) > -0.008, `展示到准备过渡第 ${i} 帧不能穿台`);
                for (let side = 0; side < 2; side++) {
                    const handRotation = (side ? pose._rightHand : pose._leftHand).getWorldRotation(new Quat());
                    const change = 2 * Math.acos(Math.min(1, Math.abs(Quat.dot(previousHands[side], handRotation)))) * 180 / Math.PI;
                    assert.ok(change < 40, `过渡 ${i} 手 ${side} 不能突然翻转：${change}°`);
                    Quat.copy(previousHands[side], handRotation);
                    assert.ok(Math.abs(exactY(side, surface) - 0.002) < 0.008,
                        `过渡第 ${i} 帧脚 ${side} 不能悬空：${exactY(side, surface)}`);
                    const margin = armClearance(exactHandBounds, side, surface, yaw);
                    assert.ok(margin > 0, `过渡 ${i} 手 ${side} 不能穿过所在高度的台身：${margin}`);
                }
            }
            for (let side = 0; side < 2; side++) {
                const contact = new Vec3();
                const error = Math.abs(exactY(side, surface, contact) - 0.002); worst = Math.max(worst, error);
                assert.ok(error < 0.008, `朝向 ${yaw} 脚 ${side} 斜面接触误差 ${error}`);
                assert.ok(contact.x >= surface.minX - 0.01 && contact.x <= surface.maxX + 0.01
                    && contact.z >= surface.minZ - 0.01 && contact.z <= surface.maxZ + 0.01,
                    `脚 ${side} 接触点必须位于踏面范围：${JSON.stringify(contact)}`);
            }
            const footRotation = pose._leftFoot.getWorldRotation(new Quat());
            assert.ok(Math.abs(Quat.dot(showcaseRotation, footRotation)) > 0.999, '展示与准备共用斜面，脚掌不应再次叠加倾角');
            assert.deepEqual(racer.position, rootPosition); assert.deepEqual(racer.rotation, rootRotation);
            // 以未做台面校正的原准备动作为基准，上身各骨骼的旋转不能被坡度改变。
            pose.setDiveSupportPlane(null); pose.applyDivePrepPose(1);
            const upperBones = [pose.root, pose._rootBone, pose._hips, pose._head];
            const upperRotations = upperBones.map(bone => bone.getWorldRotation(new Quat()));
            pose.setDiveSupportPlane(surface, soles); controller.update(1 / 60, false);
            upperBones.forEach((bone, i) => assert.ok(Math.abs(Quat.dot(bone.getWorldRotation(new Quat()), upperRotations[i])) > 0.999999,
                `${bone.name} 不能为了贴斜面改变朝向`));
            for (const tilt of [0, -8, 8]) {
                // 覆盖蓄力时外层位移和其他外层姿态，脚掌不能把已有倾角重复叠加到坡度上。
                racer.position.y = rootPosition.y - 0.05;
                racer.setRotationFromEuler(0, yaw, tilt);
                controller.update(1 / 60, false);
                for (let side = 0; side < 2; side++) {
                    assert.ok(Math.abs(exactY(side, surface) - 0.002) < 0.008,
                        `朝向 ${yaw} 倾角 ${tilt} 脚 ${side} 接触间隙 ${exactY(side, surface)}`);
                    for (const region of ['heel', 'forefoot']) {
                        const gap = exactY(side, surface, null, region);
                        assert.ok(gap > -0.008 && gap < 0.026,
                            `脚 ${side} ${region} 不能只由另一端接触台面：${gap}`);
                    }
                }
            }
            racer.position.set(rootPosition); racer.setRotation(rootRotation); controller.update(1 / 60, false);
            for (let side = 0; side < 2; side++) {
                const margin = armClearance(exactHandBounds, side, surface, yaw);
                assert.ok(margin >= 0.004, `手 ${side} 前沿间距 ${margin}`);
                const fullHand = exactHandBounds(side);
                const handOverhang = yaw ? surface.minX - fullHand.max.x : fullHand.min.x - surface.maxX;
                assert.ok(handOverhang >= 0.004, `手 ${side} 必须完整伸出台前沿，不能停在鞋边或台面上：${handOverhang}`);
                const arm = side === 0 ? pose._leftArm : pose._rightArm;
                const forearm = side === 0 ? pose._leftForeArm : pose._rightForeArm;
                const hand = side === 0 ? pose._leftHand : pose._rightHand;
                const shoulder = arm.getWorldPosition(new Vec3()), elbow = forearm.getWorldPosition(new Vec3()), wrist = hand.getWorldPosition(new Vec3());
                const upperDirection = Vec3.normalize(new Vec3(), Vec3.subtract(new Vec3(), elbow, shoulder));
                const foreDirection = Vec3.normalize(new Vec3(), Vec3.subtract(new Vec3(), wrist, elbow));
                const forward = yaw ? -1 : 1;
                const upperInward = Math.atan2(-upperDirection.x * forward, -upperDirection.y) * 180 / Math.PI;
                const foreInward = Math.atan2(-foreDirection.x * forward, -foreDirection.y) * 180 / Math.PI;
                assert.ok(upperInward > 24 && upperInward < 34 && foreInward > 18 && foreInward < 28,
                    `整条手臂应适度斜向台沿下垂，上臂 ${upperInward}° 前臂 ${foreInward}°`);
                assert.ok(upperInward - foreInward > 2 && upperInward - foreInward < 12, '前臂稍缓，保留轻微屈肘');
                assert.ok(Math.abs(upperDirection.z) < 0.01 && Math.abs(foreDirection.z) < 0.01, '向台沿收臂不能让双臂横向交叉');
                assert.ok(Math.abs(Quat.dot(hand.rotation, pose._boneBaseRotation.get(hand))) > 0.999999, '手腕保持中性，不能独立掰弯手掌');
                // 独立用已核验规范骨架的掌心轴验证，不能复用求解器的方向定义自证正确。
                const palmNormal = Vec3.transformQuat(new Vec3(), new Vec3(side === 0 ? 1 : -1, 0, 0), hand.getWorldRotation(new Quat()));
                assert.ok(-palmNormal.x * forward > 0.8, `掌心应朝向人物自身，实际法线 ${JSON.stringify(palmNormal)}`);
            }
            const closestArm = Math.min(armClearance(exactHandBounds, 0, surface, yaw), armClearance(exactHandBounds, 1, surface, yaw));
            const closestHandToLip = Math.min(...[0, 1].map(side => {
                const hand = exactHandBounds(side);
                return yaw ? surface.minX - hand.max.x : hand.min.x - surface.maxX;
            }));
            // 短臂可能略高于低侧台沿；这时检查到台前沿的间隙，不能拿后方高台面当目标。
            assert.ok(Math.min(closestArm, closestHandToLip) < 0.07, '站位应收近台前沿，不能留下过大空隙');
            assert.equal(hands.ready, true);
            for (const factor of [0.85, 1, 1.25]) {
                wrapper.setScale(scale * factor, scale * factor, scale * factor);
                for (const tilt of [0, -5]) {
                    racer.setRotationFromEuler(0, yaw, tilt); controller.update(1 / 60, false);
                    for (let side = 0; side < 2; side++) {
                        const contact = new Vec3();
                        assert.ok(Math.abs(exactY(side, surface, contact) - 0.002) < 0.008, '短臂补偿不能让脚离开台面');
                        assert.ok(contact.x >= surface.minX - 0.01 && contact.x <= surface.maxX + 0.01
                            && contact.z >= surface.minZ - 0.01 && contact.z <= surface.maxZ + 0.01, '适配腿长后的脚位必须留在踏面内');
                        const palm = Vec3.transformQuat(new Vec3(), new Vec3(side ? -1 : 1, 0, 0),
                            (side ? pose._rightHand : pose._leftHand).getWorldRotation(new Quat()));
                        assert.ok(-palm.x * (yaw ? -1 : 1) > 0.8, '改变角色尺寸和起跳前倾不能把掌心转向外侧');
                        const margin = armClearance(exactHandBounds, side, surface, yaw);
                        assert.ok(margin >= 0.004, `缩放 ${factor} 倾角 ${tilt} 手臂 ${side} 前沿间距 ${margin}`);
                        const hand = exactHandBounds(side);
                        const overhang = yaw ? surface.minX - hand.max.x : hand.min.x - surface.maxX;
                        assert.ok(overhang >= 0.004, `缩放 ${factor} 倾角 ${tilt} 手 ${side} 仍需伸出台面：${overhang}`);
                    }
                }
            }
            wrapper.setScale(scale, scale, scale); racer.setRotation(rootRotation); controller.update(1 / 60, false);
            const takeoffHip = Vec3.clone(pose._hips.position);
            const takeoffHands = [pose._leftHand.getWorldRotation(new Quat()), pose._rightHand.getWorldRotation(new Quat())];
            controller.enterDiveFlight(0.4);
            assert.equal(pose.hasDiveSupportPlane, false, '离台立即解除平面追踪');
            assert.ok(Vec3.distance(pose._hips.position, takeoffHip) < 1e-6, '离台起点必须保留适配后的姿势');
            assert.ok(Math.abs(Quat.dot(pose._leftHand.getWorldRotation(new Quat()), takeoffHands[0])) > 0.999999, '离台起点保留垂手姿势再过渡');
            racer.position.y += 1;
            controller.update(0.04, false);
            assert.ok(Math.min(exactY(0, surface), exactY(1, surface)) > 0.5, '不能把已腾空的脚重新拉回台面');
            controller.enterGlide();
            assert.equal(pose._diveTakeoffPose, null);
        }
        console.log(`${file} 斜面鞋底最大误差 ${(worst * 1000).toFixed(2)}mm`);
    });

    test(`${file}：展示舞蹈只调整支撑脚与腿，上身姿态和抬脚、跳跃保留`, () => {
        const { pose, soles, wrapper, exactY } = createRig(file);
        const surface = blockSurface();
        wrapper.position.set(-0.04, 0.6, 0);
        const upper = [pose.root, pose._rootBone, pose._hips, pose._head, pose._leftHand, pose._rightHand];
        const actions = ['waving', 'victory', 'victory_idle', 'joyful_jump', 'chicken_dance', 'ymca_dance', 'silly_dancing', 'dancing_twerk', 'defeated', 'angry', 'loser', 'happy', 'clapping', 'excited'];
        let grounded = 0, airborne = 0;
        for (const id of actions) {
            const action = JSON.parse(fs.readFileSync(path.join(root, 'assets/race/model-actions/tPose', `Tpose_${id}.json`)));
            for (let i = 0; i < action.samples.length; i += Math.max(1, Math.floor(action.samples.length / 9))) {
                const sample = action.samples[i], next = action.samples[Math.min(i + 1, action.samples.length - 1)];
                const phase = Math.min(0.999999, (sample.phase + next.phase) / 2);
                const mask = id === 'dancing_twerk' ? 3 : sample.groundedFeet & next.groundedFeet;
                pose.setStandingSurface(null, soles); pose.applySampledActionPose(id, phase, 1, action);
                const upperRotations = upper.map(bone => bone.getWorldRotation(new Quat()));
                const feet = [pose._leftFoot, pose._rightFoot];
                const freeRotations = feet.map(bone => bone.getWorldRotation(new Quat()));
                pose.setStandingSurface(surface.maxY + 0.002, soles, surface);
                pose.applySampledActionPose(id, phase, 1, action);
                upper.forEach((bone, index) => assert.ok(Math.abs(Quat.dot(bone.getWorldRotation(new Quat()), upperRotations[index])) > 0.999999,
                    `${id} ${i} ${bone.name} 不应随坡改变动作朝向`));
                for (let side = 0; side < 2; side++) {
                    if (mask & 1 << side) {
                        grounded++;
                        const point = new Vec3(), gap = exactY(side, surface, point);
                        assert.ok(Math.abs(gap - 0.002) < 0.008, `${id} ${i} 脚 ${side} 支撑间隙 ${gap}`);
                        assert.ok(point.x >= surface.minX - 0.01 && point.x <= surface.maxX + 0.01
                            && point.z >= surface.minZ - 0.01 && point.z <= surface.maxZ + 0.01, `${id} 支撑点不能移出台面`);
                    } else {
                        airborne++;
                        assert.ok(Math.abs(Quat.dot(feet[side].getWorldRotation(new Quat()), freeRotations[side])) > 0.999999,
                            `${id} ${i} 非支撑脚保留原动作角度`);
                    }
                }
            }
        }
        assert.ok(grounded > 0 && airborne > 0);
        pose.setStandingSurface(surface.maxY + 0.002, soles, surface); pose.applyPreRaceStandingPose();
        assert.ok(Math.abs(exactY(0, surface) - 0.002) < 0.008, '动作尚未加载时默认站姿也贴台');
    });
}
