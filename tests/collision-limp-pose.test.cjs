const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { load, Node, Vec3, Quat, root } = createHarness();
const { FreestylePoseController } = load(path.join(root, 'assets/scripts/character/FreestylePoseController.ts'));
const { COLLISION_SOFTNESS_TUNING: tuning } = load(path.join(root, 'assets/scripts/core/CollisionSoftnessTuning.ts'));
const { CollisionSoftnessModel } = load(path.join(root, 'assets/scripts/swimmer/CollisionSoftnessModel.ts'));
const zero = { side: 0, forward: 0, sideVelocity: 0, forwardVelocity: 0 };
const models = fs.readdirSync(path.join(root, 'assets/race/models')).filter(f => f.endsWith('.glb'));
const records = [];
function rig(file) {
    const data = fs.readFileSync(path.join(root, 'assets/race/models', file));
    const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
    const nodes = gltf.nodes.map(n => {
        assert.ok(!n.matrix, '测试需要显式支持矩阵节点');
        const node = new Node(); node.name = n.name || '';
        node.position.set(...(n.translation || [0, 0, 0]));
        node.rotation.set(...(n.rotation || [0, 0, 0, 1]));
        node.scale.set(...(n.scale || [1, 1, 1]));
        assert.ok(Math.abs(node.scale.x - node.scale.y) < 1e-5 && Math.abs(node.scale.y - node.scale.z) < 1e-5,
            '测试替身只支持均匀缩放');
        return node;
    });
    gltf.nodes.forEach((n, i) => (n.children || []).forEach(j => { nodes[j].parent = nodes[i]; nodes[i].children.push(nodes[j]); }));
    // 正式比赛在 prefab 包装节点应用 [90, 90, 0]，划水前进方向依赖它。
    // 不能用裸 GLB 的直立方向代替比赛模型设置。
    const wrapper = new Node(); wrapper.setRotationFromEuler(90, 90, 0);
    nodes.filter(n => !n.parent).forEach(n => { n.parent = wrapper; wrapper.children.push(n); });
    const byName = Object.fromEntries(nodes.map(n => [n.name, n]));
    const body = byName.Armature || byName.Root.parent;
    const pose = new FreestylePoseController(); pose.bind(body); pose.captureBasePose();
    const positions = nodes.map(n => Vec3.clone(n.position));
    const inv = body.getWorldRotation(new Quat()); Quat.invert(inv, inv);
    const origin = body.getWorldPosition(new Vec3());
    const rest = Object.fromEntries(nodes.map(n => {
        const p = n.getWorldPosition(new Vec3()), q = n.getWorldRotation(new Quat());
        Vec3.subtract(p, p, origin); Vec3.transformQuat(p, p, inv); Quat.multiply(q, inv, q);
        return [n.name, { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] }];
    }));
    return { nodes, byName, body, pose, positions, rest };
}
function direction(a, b) { return Vec3.normalize(new Vec3(), Vec3.subtract(new Vec3(), b.getWorldPosition(new Vec3()), a.getWorldPosition(new Vec3()))); }
function segmentDistance(p, a, b) {
    const ab = Vec3.subtract(new Vec3(), b, a), ap = Vec3.subtract(new Vec3(), p, a);
    const t = Math.max(0, Math.min(1, Vec3.dot(ap, ab) / ab.lengthSqr()));
    return Vec3.distance(p, Vec3.scaleAndAdd(new Vec3(), a, ab, t));
}
function normal(r, phase, roll) {
    r.pose.applyFreestylePose(phase, phase + Math.PI, phase * 2, phase * 2 + Math.PI, phase, 1, 1, 1);
    const tumble = new Quat(); Quat.fromEuler(tumble, roll, roll * 0.5, roll * 0.3);
    Quat.multiply(r.body.rotation, tumble, r.body.rotation);
}
for (const file of models) test(`${file}：真实自由泳全周期、撞击与翻滚的关节方向`, () => {
    const r = rig(file), limp = r.pose._collisionLimp;
    assert.equal(limp._limbs.length, 4, '四条真实肢链必须全部绑定');
    const width = Vec3.distance(r.byName.L_Upperarm.getWorldPosition(new Vec3()), r.byName.R_Upperarm.getWorldPosition(new Vec3()));
    const inverse = new Quat(), relative = new Quat();
    // 包含用户保存的较大幅度，不能仅验证缺省参数。
    tuning.armDegrees = 40; tuning.legDegrees = 30;
    for (const phaseStart of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) for (const sign of [-1, 0, 1]) {
        limp.reset();
        for (let frame = 0; frame < 180; frame++) {
            normal(r, phaseStart + frame * 0.13, frame * 9);
            const beforeRoot = Quat.clone(r.body.rotation);
            const beforePosition = Vec3.clone(r.body.position);
            limp.apply({ side: sign, forward: sign === 0 ? -1 : 0.3, sideVelocity: 20, forwardVelocity: -10 }, 1 / 60);
            assert.deepEqual(r.body.rotation, beforeRoot, '视效不改变角色根旋转');
            assert.deepEqual(r.body.position, beforePosition, '视效不改变角色根位置');
            r.body.getWorldRotation(inverse); Quat.invert(inverse, inverse);
            const head = r.byName.Head.getWorldPosition(new Vec3());
            const headUp = Vec3.transformQuat(new Vec3(), limp._bodyUp, r.body.getWorldRotation(new Quat()));
            Vec3.scaleAndAdd(head, head, headUp, width * 0.15);
            for (const limb of limp._limbs) {
                const upper = direction(limb.upper, limb.middle), lower = direction(limb.middle, limb.end);
                const axis = Vec3.transformQuat(new Vec3(), limb.hingeAxis, limb.upper.getWorldRotation(new Quat()));
                const signedFlex = Math.atan2(Vec3.dot(Vec3.cross(new Vec3(), upper, lower), axis), Vec3.dot(upper, lower));
                assert.ok(signedFlex >= -1e-5 && signedFlex <= (limb.leg ? 1.4 : 1.9) + 1e-5, `${file} ${limb.upper.name} 铰链反折／超限 ${signedFlex}`);
                assert.ok(Math.abs(Vec3.dot(axis, lower)) < 1e-4, '肘膝不得侧折');
                if (frame > 35) {
                    const rootUpper = Vec3.transformQuat(new Vec3(), upper, inverse);
                    assert.ok(Vec3.dot(rootUpper, limp._bodySide) * limb.side > 0, '近端保持在身体自身外侧');
                    const rootBend = Vec3.transformQuat(new Vec3(), Vec3.scaleAndAdd(new Vec3(), lower, upper, -Vec3.dot(upper, lower)), inverse);
                    assert.ok(Vec3.dot(rootBend, limp._bodyFront) * (limb.leg ? -1 : 1) >= -1e-5, `膝盖向后、肘部向前弯 ${limb.upper.name} frame=${frame} flex=${signedFlex} bend=${Vec3.dot(rootBend, limp._bodyFront)} dir=${JSON.stringify(rootUpper)}`);
                }
                if (!limb.leg) {
                    const elbow = limb.middle.getWorldPosition(new Vec3()), hand = limb.end.getWorldPosition(new Vec3());
                    assert.ok(segmentDistance(head, elbow, hand) > width * 0.26, `${file} 前臂侵入头部保护区`);
                }
            }
            for (let i = 0; i < r.nodes.length; i++) {
                if (r.nodes[i] !== r.body) assert.deepEqual(r.nodes[i].position, r.positions[i], '骨骼长度不得改变');
                const q = r.nodes[i].rotation;
                assert.ok(Number.isFinite(q.x + q.y + q.z + q.w) && Math.abs(Quat.dot(q, q) - 1) < 1e-4);
            }
            if (process.env.COLLISION_LIMP_AUDIT && file === 'CartonSwimmer11.glb' && phaseStart === 0 && sign === 0 && [3, 12, 45, 110].includes(frame)) {
                // 导出真实控制器的世界姿态供独立 Blender 蒙皮检查，消去比赛根朝向便于比较。
                const origin = r.body.getWorldPosition(new Vec3());
                records.push({ file, frame, rest: r.rest, nodes: r.nodes.filter(n => n !== r.body).map(n => {
                    const p = n.getWorldPosition(new Vec3()); Vec3.subtract(p, p, origin); Vec3.transformQuat(p, p, inverse);
                    n.getWorldRotation(relative); Quat.multiply(relative, inverse, relative);
                    return { name: n.name, p: [p.x, p.y, p.z], q: [relative.x, relative.y, relative.z, relative.w] };
                }) });
            }
        }
    }
    // 一个真实衰减冲量在持续划水中恢复，静止时不再写骨骼。
    const model = new CollisionSoftnessModel(); model.impulse(1.4, -0.25);
    for (let frame = 0; frame < 360; frame++) {
        normal(r, frame * 0.12, 0);
        const baseline = limp._limbs.map(limb => Quat.clone(limb.middle.rotation));
        model.update(1 / 60); limp.apply(model, 1 / 60);
        if (limp._weight > 0 && limp._weight < 0.002) limp._limbs.forEach((limb, i) => {
            const error = 2 * Math.acos(Math.min(1, Math.abs(Quat.dot(baseline[i], limb.middle.rotation))));
            assert.ok(error < 0.025, '恢复尾部不能从铰链突跳回原动作');
        });
    }
    normal(r, 0.75, 0);
    const writes = r.nodes.map(n => n.writes), rotations = r.nodes.map(n => Quat.clone(n.rotation));
    limp.apply(zero, 1 / 60);
    assert.deepEqual(r.nodes.map(n => n.writes), writes, '恢复后零骨骼写入');
    assert.deepEqual(r.nodes.map(n => n.rotation), rotations, '恢复当前划水姿态');
});

test('一次真实冲量产生独立速度、回弹和手脚滞后，不是单向插值到固定姿势', () => {
    const r = rig('CartonSwimmer11.glb'), limp = r.pose._collisionLimp;
    const signal = new CollisionSoftnessModel(); signal.impulse(1.4, -0.25);
    const samples = [];
    for (let frame = 0; frame < 120; frame++) {
        normal(r, frame * 0.1, 0); signal.update(1 / 60); limp.apply(signal, 1 / 60);
        samples.push(limp._limbs.map(limb => ({
            up: Vec3.dot(limb.follower, limp._bodyUp), front: Vec3.dot(limb.follower, limp._bodyFront),
            flex: limb.flex, end: limb.endAngle, velocity: limb.flexVelocity,
        })));
    }
    const span = (i, key) => Math.max(...samples.slice(0, 75).map(s => s[i][key])) - Math.min(...samples.slice(0, 75).map(s => s[i][key]));
    const metrics = { armSwing: span(0, 'front'), elbowSwing: span(0, 'flex'), kneeSwing: span(2, 'flex'), wristSwing: span(0, 'end') };
    assert.ok(metrics.armSwing > 0.35, `单次碰撞必须有明显甩臂 ${JSON.stringify(metrics)}`);
    assert.ok(metrics.elbowSwing > 0.4 && metrics.kneeSwing > 0.4, `肘膝必须有独立屈伸 ${JSON.stringify(metrics)}`);
    assert.ok(metrics.wristSwing > 0.08, '末端应有可见滞后');
    assert.ok(samples.slice(5, 90).some(s => s[0].velocity > 0.3) && samples.slice(5, 90).some(s => s[0].velocity < -0.3), '肘部需要越过静止点后反向回弹');
    assert.ok(samples.some(s => Math.abs(s[0].flex - s[1].flex) > 0.25), '左右肢体不能同步摆到同一姿势');
});

test('身体转动时四肢保留世界惯性，异常长帧与重置不残留速度', () => {
    const a = rig('CartonSwimmer11.glb'), b = rig('CartonSwimmer11.glb');
    const signal = new CollisionSoftnessModel(); signal.impulse(1.4, -0.25);
    for (let frame = 0; frame < 18; frame++) {
        signal.update(1 / 60);
        normal(a, 0.8, 0); normal(b, 0.8, frame >= 10 ? 30 : 0);
        a.pose.applyCollisionSoftness(signal, 1 / 60); b.pose.applyCollisionSoftness(signal, 1 / 60);
    }
    assert.ok(Vec3.distance(a.pose._collisionLimp._limbs[0].follower, b.pose._collisionLimp._limbs[0].follower) > 0.1, '身体转动不能带着四肢一起僵硬转动');
    normal(b, 0, 0); b.pose.applyCollisionSoftness(signal, 3);
    for (const limb of b.pose._collisionLimp._limbs) assert.ok(Number.isFinite(limb.flex + limb.endAngle + limb.velocity.length()));
    b.pose.resetCollisionSoftness();
    const before = b.nodes.map(n => n.writes); b.pose.applyCollisionSoftness(zero, 1 / 60);
    assert.deepEqual(b.nodes.map(n => n.writes), before);
});

test.after(() => {
    if (process.env.COLLISION_LIMP_AUDIT) fs.writeFileSync(process.env.COLLISION_LIMP_AUDIT, JSON.stringify(records));
    if (!process.env.COLLISION_LIMP_SEQUENCE) return;
    const r = rig('CartonSwimmer11.glb'), signal = new CollisionSoftnessModel(), sequence = [];
    // 动态检查沿用当前用户保存的参数，开始后 0.5 秒侧撞，2.5 秒正面撞。
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/tuning.json'), 'utf8'));
    for (const [key, value] of Object.entries(saved.values || saved)) {
        const match = /^collision\.soft(.+)$/.exec(key);
        if (match) { const field = match[1][0].toLowerCase() + match[1].slice(1); if (field in tuning && typeof value === 'number') tuning[field] = value; }
    }
    for (let frame = 0; frame < 150; frame++) {
        if (frame === 15) signal.impulse(1.4, -0.25);
        if (frame === 75) signal.impulse(0, -1.4);
        normal(r, frame * 0.2, 0); signal.update(1 / 30); r.pose.applyCollisionSoftness(signal, 1 / 30);
        const inverse = r.body.getWorldRotation(new Quat()); Quat.invert(inverse, inverse);
        const origin = r.body.getWorldPosition(new Vec3());
        sequence.push({ file: 'CartonSwimmer11.glb', frame, rest: r.rest, nodes: r.nodes.filter(n => n !== r.body).map(n => {
            const p = n.getWorldPosition(new Vec3()), q = n.getWorldRotation(new Quat());
            Vec3.subtract(p, p, origin); Vec3.transformQuat(p, p, inverse); Quat.multiply(q, inverse, q);
            return { name: n.name, p: [p.x,p.y,p.z], q: [q.x,q.y,q.z,q.w] };
        }) });
    }
    fs.writeFileSync(process.env.COLLISION_LIMP_SEQUENCE, JSON.stringify(sequence));
});
