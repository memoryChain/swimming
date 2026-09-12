// 实际 GLB 与 Cocos 数学库检查动作外形、周期连续性和仰泳隔离。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRig: createCharacterRig, Node, Vec3, Quat, Mat4, load, root } = require('./helpers/character-contact-harness.cjs');
// 验证自由泳求解器对全部骨架的兼容性，独立于正式比赛的角色分配。
function createRig(file) {
    const rig = createCharacterRig(file);
    rig.pose.setSurfaceSwimStyle('freestyle');
    return rig;
}
const { sampleProneFreestyleArm, proneFreestyleRollSignal } = load(path.join(root, 'assets/scripts/character/ProneFreestyleMotion.ts'));
const { MOTION_TUNING } = load(path.join(root, 'assets/scripts/core/InputTuning.ts'));
const { elbowStrainSampler } = require('./helpers/skinned-arm-strain.cjs');
const TAU = Math.PI * 2;
const position = n => n.getWorldPosition(new Vec3());
const direction = (a, b) => Vec3.subtract(new Vec3(), position(b), position(a)).normalize();
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, Vec3.dot(a, b)))) * 180 / Math.PI;
const poseAt = (r, p, other = p + 0.5) => r.pose.applyFreestylePose(p * TAU, other * TAU, p * TAU * 3, p * TAU * 3 + Math.PI, p * TAU, 1, 1, 1);
const snapshot = r => JSON.stringify([r.pose.root.position, r.pose.root.rotation, ...r.pose._manualBones.map(n => n.rotation)]);

for (const file of ['CartonSwimmer13.glb', 'CartonSwimmer14.glb', 'MuscleMan.glb']) {
    test(`${file}：实际肘部网格不再被翻掌过度拧拉`, () => {
        const r = createRig(file); r.wrapper.setRotationFromEuler(90, 90, 0);
        const strain = elbowStrainSampler(r, file);
        for (let frame = 0; frame < 48; frame++) { poseAt(r, frame / 48); strain.sample(); }
        // 网格边在弯曲外侧允许拉伸；检查跨整个周期的高分位，而非单条短边的极值。
        // 旧独立翻掌在这三种模型上的 95 分位均超过 1.6。
        assert.ok(strain.percentile95() < 1.6, '包含 Twist 权重的肘部三角形边拉伸 95 分位应低于 1.6');
    });
}

test('方向曲线可循环、反向和大相位采样，不产生边界跳变', () => {
    const a = new Vec3(), b = new Vec3(), c = new Vec3(), d = new Vec3();
    for (const p of [0, 0.12, 0.26, 0.52, 0.74, 0.999999]) {
        sampleProneFreestyleArm(p * TAU, a, b);
        for (const turns of [-200, -1, 1, 200]) {
            sampleProneFreestyleArm((p + turns) * TAU, c, d);
            assert.ok(Vec3.distance(a, c) < 1e-9 && Vec3.distance(b, d) < 1e-9);
        }
    }
    sampleProneFreestyleArm(-1e-6, a, b); sampleProneFreestyleArm(1e-6, c, d);
    assert.ok(Vec3.distance(a, c) < 1e-5 && Vec3.distance(b, d) < 1e-5);
});

test('胸肩在回臂阶段侧转，同期双臂不产生虚假的左右摇摆', () => {
    for (const phase of [0, 0.15, 0.40, 0.65, 0.90]) {
        assert.equal(proneFreestyleRollSignal(phase * TAU, phase * TAU), 0);
        const signal = proneFreestyleRollSignal(phase * TAU, (phase + 0.5) * TAU);
        assert.ok(Math.abs(signal + proneFreestyleRollSignal((phase + 0.5) * TAU, phase * TAU)) < 1e-10);
        assert.ok(Math.abs(signal - proneFreestyleRollSignal((phase + 20) * TAU, (phase - 10.5) * TAU)) < 1e-10);
    }
    assert.ok(proneFreestyleRollSignal(0.72 * TAU, 0.22 * TAU) > 0.99, '左回臂侧肩膀升高');
    assert.ok(proneFreestyleRollSignal(0.22 * TAU, 0.72 * TAU) < -0.99, '右回臂侧肩膀升高');
});

for (const file of fs.readdirSync(path.join(root, 'assets/race/models')).filter(f => f.endsWith('.glb'))) {
    test(`${file}：回臂持续到周期末段，避免提前前伸停住`, () => {
        const r = createRig(file); r.wrapper.setRotationFromEuler(90, 90, 0);
        const arm = r.pose._leftArm, hand = r.pose._leftHand;
        const reach = () => Vec3.subtract(new Vec3(), position(hand), position(arm));
        poseAt(r, 1, 1); const end = reach(), armLength = end.length();
        let previous, lastMovingPhase = 0.5, peak = 0;
        for (let frame = 500; frame <= 1000; frame++) {
            const phase = frame / 1000;
            poseAt(r, phase, phase); const current = reach();
            if (Vec3.distance(current, end) > armLength * 0.03) lastMovingPhase = phase;
            if (previous) peak = Math.max(peak, Vec3.distance(current, previous) * 1000 / armLength);
            previous = current;
        }
        // 以实际肩腕轨迹而非关键帧时间验证：旧版约在 0.86 就已到位。
        assert.ok(lastMovingPhase > 0.92 && lastMovingPhase < 0.99,
            '回臂应持续到整圈的末段，同时仍在下一划前完成前伸');
        assert.ok(peak < 9, '单位周期的肩腕运动峰值不能因时间集中而过快');
        poseAt(r, 0, 0);
        assert.ok(Vec3.distance(reach(), end) < 1e-8, '周期末与下一划起点闭合');
    });

    test(`${file}：抱水屈肘、高肘回臂、前伸及整周期连续`, () => {
        const r = createRig(file); r.wrapper.setRotationFromEuler(90, 90, 0);
        r.pose.setSwimHeadLift(r.variant?.swimHeadLiftDegrees);
        const restShoulderWidth = Vec3.distance(position(r.pose._leftArm), position(r.pose._rightArm));
        const lineRoll = (left, right) => {
            const line = Vec3.subtract(new Vec3(), position(left), position(right));
            return Math.atan2(line.y, -line.z) * 180 / Math.PI;
        };
        poseAt(r, 0.72);
        const shoulderRoll = lineRoll(r.pose._leftShoulder, r.pose._rightShoulder);
        const hipRoll = lineRoll(r.pose._leftUpLeg, r.pose._rightUpLeg);
        assert.ok(shoulderRoll > 45 && shoulderRoll < 60, '高肘回臂时整片胸肩保持明显侧转');
        assert.ok(shoulderRoll - hipRoll > 25, '胸肩相对髋部有独立侧转，不能只滚动整个人物');
        poseAt(r, 0.97);
        assert.ok(Math.abs(lineRoll(r.pose._leftShoulder, r.pose._rightShoulder)) < 3, '回臂前伸时胸肩换边经过水平');
        poseAt(r, 0.72);
        const headWithRoll = r.pose._head.getWorldRotation(new Quat());
        const savedChestRoll = MOTION_TUNING.proneChestRollDegrees;
        try {
            MOTION_TUNING.proneChestRollDegrees = 0;
            poseAt(r, 0.72);
            const headWithoutRoll = r.pose._head.getWorldRotation(new Quat());
            assert.ok(2 * Math.acos(Math.min(1, Math.abs(Quat.dot(headWithRoll, headWithoutRoll)))) * 180 / Math.PI < 8,
                '不换气时头颈抵消大部分胸肩转动，不能把头一起拧向侧面');
            assert.ok(shoulderRoll - lineRoll(r.pose._leftShoulder, r.pose._rightShoulder) > 30,
                '胸肩幅度参数实际控制胸廓，不影响根节点滚转');
        } finally { MOTION_TUNING.proneChestRollDegrees = savedChestRoll; }
        for (const side of ['left', 'right']) {
            const arm = r.pose[`_${side}Arm`], fore = r.pose[`_${side}ForeArm`], hand = r.pose[`_${side}Hand`];
            // 枢轴偏置不能代表可见手臂弯曲：检查实际蒙皮矩阵是否保持同一刚性变换。
            // 如果单独扭转前臂／手腕，即使骨点共线，这项检查也必须失败。
            for (const phase of [0, 0.02, 0.05, 0.08, 0.99, 0.995, 0.999, 1.02]) {
                poseAt(r, phase, phase);
                assert.ok(Vec3.dot(direction(arm, hand), new Vec3(1, 0, 0)) > 0.99999, '整臂沿游进方向前伸');
                const shoulder = r.pose[`_${side}Shoulder`];
                assert.ok(direction(shoulder, arm).x > 0.80,
                    '肩带随前伸上举，不能停在横展方向让大臂独自折成 U 型');
                const span = Math.abs(position(r.pose._leftHand).z - position(r.pose._rightHand).z);
                assert.ok(span < restShoulderWidth * 0.80 && span > restShoulderWidth * 0.35,
                    '双臂同时前伸时靠近头部两侧，保留间距而非外展成宽 U 型');
                assert.deepEqual(arm.position, r.pose._boneBasePosition.get(arm), '保持肩关节枢轴');
                assert.deepEqual(shoulder.position, r.pose._boneBasePosition.get(shoulder), '不靠平移锁骨修正外形');
                let groups = 0;
                for (const renderer of r.renderers) {
                    const matrices = [arm, fore, hand].map(bone => {
                        const index = renderer.skeleton.joints.findIndex(p => r.wrapper.getChildByPath(p) === bone);
                        return index < 0 ? null : Mat4.multiply(new Mat4(), bone.worldMatrix, renderer.skeleton.bindposes[index]);
                    });
                    if (matrices.some(m => !m)) continue;
                    groups++;
                    for (const matrix of matrices.slice(1)) for (let i = 0; i < 16; i++) {
                        const field = `m${String(i).padStart(2, '0')}`;
                        assert.ok(Math.abs(matrix[field] - matrices[0][field]) < 1e-4,
                            '上臂、前臂和手的蒙皮变换一致，保留原始直臂外形');
                    }
                }
                assert.ok(groups > 0, '必须验证实际 GLB 蒙皮，不能仅验证目标方向');
            }
            poseAt(r, 0, 0);
            const palm = new Vec3(); r.hands.palmNormalWorld(side === 'left' ? 0 : 1, palm);
            assert.ok(palm.y < -0.65, '入水掌心朝下');
            poseAt(r, 0.26, 0.26);
            const catchBend = angle(direction(arm, fore), direction(fore, hand));
            assert.ok(catchBend > 55 && catchBend < 115, '抱水时有明确屈肘');
            assert.ok(position(hand).y < position(fore).y, '水下肘高于手');
            r.hands.palmNormalWorld(side === 'left' ? 0 : 1, palm);
            assert.ok(palm.x < -0.35, '抱水掌心向后');
            poseAt(r, 0.40, 0.40);
            assert.ok(position(hand).x < position(arm).x, '推水经过肩线向髋部送出');
            poseAt(r, 0.76, 0.76);
            const recoveryBend = angle(direction(arm, fore), direction(fore, hand));
            assert.ok(recoveryBend > 65 && recoveryBend < 110, '回臂有屈肘，但不折叠到肩旁');
            assert.ok(position(fore).y > position(arm).y && position(fore).y > position(hand).y, '回臂由高肘带动');
            poseAt(r, 0.66, 0.66);
            const elbow = r.pose.root.inverseTransformPoint(new Vec3(), position(fore));
            const wrist = r.pose.root.inverseTransformPoint(new Vec3(), position(hand));
            assert.ok((wrist.x - elbow.x) * (side === 'left' ? 1 : -1) > 0.025,
                '回臂中段手腕在肘外侧，不能向内折回头肩');
            for (const phase of [0.16, 0.26, 0.40, 0.52, 0.62, 0.74, 0.82]) {
                poseAt(r, phase, phase);
                const delta = Quat.multiply(new Quat(), fore.rotation,
                    Quat.invert(new Quat(), r.pose._boneBaseRotation.get(fore)));
                const axis = Vec3.normalize(new Vec3(), fore.position);
                assert.ok(Math.abs(delta.x * axis.x + delta.y * axis.y + delta.z * axis.z) < 1e-5,
                    '肘部相对绑定姿势只作摆动，不把翻掌的轴向扭转集中到细长前臂');
                assert.deepEqual(fore.position, r.pose._boneBasePosition.get(fore), '不拉长上臂');
                assert.deepEqual(hand.position, r.pose._boneBasePosition.get(hand), '不拉长前臂');
            }
        }
        let previous;
        const bones = [r.pose._torso, r.pose._leftShoulder, r.pose._leftArm, r.pose._leftForeArm, r.pose._leftHand,
            r.pose._rightShoulder, r.pose._rightArm, r.pose._rightForeArm, r.pose._rightHand];
        // 同期双臂和交替双臂都检查完整周期，尤其覆盖肩带上举／放回的过渡。
        for (const otherOffset of [0, 0.5]) {
            previous = undefined;
            for (let frame = 0; frame <= 480; frame++) {
                poseAt(r, frame / 480, frame / 480 + otherOffset);
                for (const side of ['left', 'right']) {
                    const arm = r.pose[`_${side}Arm`], fore = r.pose[`_${side}ForeArm`], hand = r.pose[`_${side}Hand`];
                    assert.ok(angle(direction(arm, fore), direction(fore, hand)) < 115,
                        '整个周期肘内角保留至少 65°，包含关键帧之间的插值');
                    const length = Vec3.distance(position(arm), position(fore)) + Vec3.distance(position(fore), position(hand));
                    assert.ok(Vec3.distance(position(arm), position(hand)) / length > 0.52,
                        '手腕与肩保留距离，前臂不能贴着上臂折叠');
                }
                const current = bones.map(n => Quat.clone(n.rotation));
                current.forEach((q, i) => {
                    assert.ok(Number.isFinite(q.x + q.y + q.z + q.w));
                    if (previous) {
                        const degrees = 2 * Math.acos(Math.min(1, Math.abs(Quat.dot(q, previous[i])))) * 180 / Math.PI;
                        assert.ok(degrees < 12, `${bones[i].name} 相邻帧旋转 ${degrees}°`);
                    }
                });
                previous = current;
            }
        }
        // 任意左右输入组合只依赖当前相位，无前一帧姿态残留。
        poseAt(r, 0.32, 0.05); const expected = snapshot(r);
        poseAt(r, 0.81, 0.63); poseAt(r, 0.32, 0.05);
        assert.equal(snapshot(r), expected);
    });

    test(`${file}：仰泳保留旧求解，翻身及双向游进连续`, () => {
        const r = createRig(file), swimmer = new Node();
        r.wrapper.parent = swimmer; swimmer.children.push(r.wrapper); r.wrapper.setRotationFromEuler(90, 90, 0);
        for (const facing of [0, 180]) {
            r.pose.setMovementDirection(facing ? -1 : 1);
            for (const roll of [120, 150, 180, 210, 240]) {
                swimmer.setRotationFromEuler(roll, facing, 0);
                for (let frame = 0; frame < 24; frame++) {
                    r.pose.setSurfaceBodyUpProjection(Math.cos(roll * Math.PI / 180));
                    poseAt(r, -frame / 24); const current = snapshot(r);
                    r.pose._proneFreestyleWeight = 0; poseAt(r, -frame / 24);
                    assert.equal(snapshot(r), current, '仰面使用完整旧动作');
                }
            }
            let previous;
            for (let roll = 0; roll <= 360; roll++) {
                swimmer.setRotationFromEuler(roll, facing, 0);
                r.pose.setSurfaceBodyUpProjection(Math.cos(roll * Math.PI / 180));
                poseAt(r, 0.72);
                const current = [position(r.pose._leftHand), position(r.pose._rightHand), position(r.pose._head)];
                current.forEach((p, i) => {
                    assert.ok(Number.isFinite(p.x + p.y + p.z));
                    if (previous) assert.ok(Vec3.distance(p, previous[i]) < 0.09, '翻身不瞬移');
                });
                previous = current;
            }
        }
    });
}
