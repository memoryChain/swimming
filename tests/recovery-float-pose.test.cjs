const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, Node, Vec3, Quat, root, createRig, SWIMMER_MODEL_FILES } = require('./helpers/character-contact-harness.cjs');
const { CharacterPoseStateController } = load(path.join(root, 'assets/scripts/character/CharacterPoseStateController.ts'));
const { CHARACTER_POSE_TUNING: tuning } = load(path.join(root, 'assets/scripts/character/CharacterMotionTuning.ts'));
function make(file) {
    const rig = createRig(file);
    const parent = new Node(); rig.wrapper.parent = parent; parent.children.push(rig.wrapper);
    let shown = false;
    const controller = new CharacterPoseStateController({
        pose: rig.pose, getModel: () => rig.wrapper, getRoot: () => rig.pose.root,
        getSelfTime: () => 0, modelScale: () => 1.35 * (rig.variant?.modelScaleMultiplier || 1),
        raceModelYOffset: () => rig.variant?.raceModelYOffset || 0,
        raceModelEulerDegrees: () => [90, 90, 0], updateSplashSurface() {}, setSplashVisible() {},
        onRecoveryFloat: (pose, weight) => { shown = !!pose && weight > 0; },
    });
    return { ...rig, parent, controller, shown: () => shown };
}
function direction(a, b) { return Vec3.normalize(new Vec3(), Vec3.subtract(new Vec3(), b.getWorldPosition(new Vec3()), a.getWorldPosition(new Vec3()))); }

for (const file of SWIMMER_MODEL_FILES) test(`${file}：扶圈真实骨架接触、头露水面、双向连续20轮退出`, () => {
    const r = make(file), bones = r.pose._manualBones;
    const nodeCount = (n) => 1 + n.children.reduce((v, c) => v + nodeCount(c), 0);
    const count = nodeCount(r.parent);
    for (let round = 0; round < 20; round++) {
        r.parent.setRotationFromEuler(0, round % 2 ? 180 : 0, 0);
        r.controller.enterFreestyle();
        r.pose.applyFreestylePose(0.3, 2, .2, 1, .4, 1, 1, 1);
        r.controller.enterEntertainmentKnockout(tuning.recoveryFloatEnterSeconds);
        for (const elapsed of [0, .15, .3, .6, 1.2, 2.4, 3.4]) {
            r.controller.syncEntertainmentKnockoutElapsed(elapsed);
            if (elapsed < 1.2) continue;
            const ring = r.pose.recoveryFloat;
            assert.ok(ring.ready && ring.radius > .1 && ring.radius < .65);
            assert.ok(Math.abs(ring.position.y - tuning.recoveryFloatSurfaceY) <= tuning.recoveryFloatBobAmplitude + .035, '仅允许托浮起伏和短促压圈回弹');
            const head = r.pose._head.getWorldPosition(new Vec3());
            assert.ok(head.y > .25, `头骨必须露出水面 ${head.y}`);
            for (const limb of r.pose._collisionLimp._limbs) {
                const upper = direction(limb.upper, limb.middle), lower = direction(limb.middle, limb.end);
                const axis = Vec3.transformQuat(new Vec3(), limb.hingeAxis, limb.upper.getWorldRotation(new Quat()));
                const flex = Math.atan2(Vec3.dot(Vec3.cross(new Vec3(), upper, lower), axis), Vec3.dot(upper, lower));
                assert.ok(flex > (limb.leg ? .15 : .7) && flex < (limb.leg ? .35 : 1.5), `肘膝屈曲必须正常 ${flex}`);
                assert.ok(Math.abs(Vec3.dot(axis, lower)) < 1e-4, '肘膝不得侧折');
                if (limb.leg) continue;
                const elbow = r.parent.inverseTransformPoint(new Vec3(), limb.middle.getWorldPosition(new Vec3()));
                const hand = r.parent.inverseTransformPoint(new Vec3(), limb.end.getWorldPosition(new Vec3()));
                assert.ok(Math.abs(elbow.y - hand.y) < .001, '前臂应平铺');
                const center = Vec3.lerp(new Vec3(), elbow, hand, .5);
                Vec3.subtract(center, center, ring.position);
                Vec3.transformQuat(center, center, Quat.invert(new Quat(), ring.rotation));
                const radial = Math.hypot(center.x, center.z);
                const tubeDistance = Math.hypot(radial-ring.radius, center.y);
                assert.ok(tubeDistance - ring.radius*.24 < .055, `前臂与圈沿不能悬空 ${tubeDistance-ring.radius*.24}`);
            }
        }
        r.controller.enterFreestyle(); r.pose.restoreBasePose();
        assert.equal(r.shown(), false);
        assert.ok(Math.abs(r.wrapper.eulerAngles.x - 90) < .001);
        assert.equal(nodeCount(r.parent), count, '连续恢复不增加节点');
    }
});

test('晚到恢复、模型重绑和低帧率按权威时间落稳，重复进入不重置', () => {
    const r = make('MuscleMan.glb');
    r.controller.enterEntertainmentKnockout(.28);
    r.controller.syncEntertainmentKnockoutElapsed(2.9);
    assert.equal(r.controller._poseTransition, null);
    const p = Vec3.clone(r.wrapper.position);
    r.controller.enterEntertainmentKnockout(.28);
    assert.equal(r.controller._entertainmentKnockoutElapsedSeconds, 2.9);
    r.controller.resetRuntime(); r.controller.reapplyCurrentState();
    assert.equal(r.controller._entertainmentKnockoutElapsedSeconds, 2.9);
    assert.ok(Vec3.distance(p, r.wrapper.position) < .0001);
    r.controller.enterPreview();
    assert.equal(r.shown(), false);
    assert.ok(Math.abs(r.wrapper.eulerAngles.x - 90) < .001, '退出清掉扶圈前倾');
});

test('命中首帧保留原姿态，先失衡后出圈，全角色连续过渡且扶稳后仍有动态', () => {
    for (const file of SWIMMER_MODEL_FILES) {
        const r = make(file);
        r.controller.enterFreestyle();
        r.pose.applyFreestylePose(.3, 2, .2, 1, .4, 1, 1, 1);
        const entry = r.pose.capturePoseSnapshot(), rotation = Quat.clone(r.wrapper.rotation), position = Vec3.clone(r.wrapper.position);
        r.controller.enterEntertainmentKnockout(tuning.recoveryFloatEnterSeconds);
        assert.ok(Quat.angle(rotation, r.wrapper.rotation) < .0001, '首帧不能直接回正扶圈');
        assert.ok(Vec3.distance(position, r.wrapper.position) < .0001);
        for (const [bone,q] of entry.boneRotations) assert.ok(Math.hypot(q.x-bone.rotation.x,q.y-bone.rotation.y,q.z-bone.rotation.z,q.w-bone.rotation.w)<.00001, `${file} ${bone.name} 首帧必须原样保留`);
        assert.equal(r.shown(),false);
        let previous = Quat.clone(r.wrapper.rotation), maxStep = 0;
        for(let frame=1;frame<=30;frame++){
            const t=frame*.05;r.controller.syncEntertainmentKnockoutElapsed(t);
            maxStep=Math.max(maxStep,Quat.angle(previous,r.wrapper.rotation)*180/Math.PI);
            Quat.copy(previous,r.wrapper.rotation);
            if(t<=.2)assert.equal(r.shown(),false,'先失衡，不在受击瞬间套圈');
            if(t>=.3)assert.equal(r.shown(),true,'浮圈应在找圈阶段破水出现');
            for(const bone of r.pose._manualBones)assert.ok([bone.rotation.x,bone.rotation.y,bone.rotation.z,bone.rotation.w].every(Number.isFinite));
            if(t>=.25)for(const limb of r.pose._collisionLimp._limbs){
                const lower=direction(limb.middle,limb.end);
                const axis=Vec3.transformQuat(new Vec3(),limb.hingeAxis,limb.upper.getWorldRotation(new Quat()));
                assert.ok(Math.abs(Vec3.dot(axis,lower))<.0001,'失衡目标之后，找圈和搭圈插值也不能让肘膝侧折');
            }
        }
        assert.ok(maxStep<22,`${file} 相邻20Hz姿态不可突跳：${maxStep}`);
        const hand=Vec3.clone(r.pose._leftHand.getWorldPosition(new Vec3())),ring=Vec3.clone(r.pose.recoveryFloat.position);
        r.controller.syncEntertainmentKnockoutElapsed(2.15);
        assert.ok(Vec3.distance(hand,r.pose._leftHand.getWorldPosition(new Vec3()))>.008,'扶稳后上肢不能定格');
        assert.ok(Vec3.distance(ring,r.pose.recoveryFloat.position)>.008,'浮圈应有同步起伏');
    }
});

test('失衡、找圈和扶稳三个阶段的边界连续，采样不反复捕获骨骼快照',()=>{
    for(const file of SWIMMER_MODEL_FILES){
        const r=make(file);r.controller.enterFreestyle();r.pose.applyFreestylePose(.3,2,.2,1,.4,1,1,1);
        r.controller.enterEntertainmentKnockout();
        r.pose.capturePoseSnapshot=()=>{throw Error('连续表现采样不应分配新快照');};
        const sequence=r.controller._recoverySequence;
        const reachEnd=tuning.recoveryFloatRingDelaySeconds+tuning.recoveryFloatReachSeconds;
        for(const boundary of [tuning.recoveryFloatImpactSeconds,reachEnd,reachEnd+tuning.recoveryFloatEnterSeconds]){
            sequence.apply(r.wrapper,boundary-.000001,0);
            const body=Vec3.clone(r.wrapper.position),hand=r.pose._leftHand.getWorldPosition(new Vec3()),ring=Vec3.clone(r.pose.recoveryFloat.position);
            const ringRotation=Quat.clone(r.pose.recoveryFloat.rotation);
            sequence.apply(r.wrapper,boundary+.000001,0);
            assert.ok(Vec3.distance(body,r.wrapper.position)<.0001,`${file} 身体跨阶段连续`);
            assert.ok(Vec3.distance(hand,r.pose._leftHand.getWorldPosition(new Vec3()))<.0001,`${file} 手跨阶段连续`);
            assert.ok(Vec3.distance(ring,r.pose.recoveryFloat.position)<.0001,`${file} 圈跨阶段连续`);
            assert.ok(Quat.angle(ringRotation,r.pose.recoveryFloat.rotation)<.001,`${file} 圈旋转跨阶段连续`);
        }
    }
});

test('空中受击延后浮圈但不跳过失衡，旧快照不倒播，采样不因浮点误差降到十赫兹',()=>{
    const r=make('MuscleMan.glb');r.controller.enterFreestyle();
    r.pose.applyFreestylePose(.3,2,.2,1,.4,1,1,1);
    r.controller.enterEntertainmentKnockout();
    r.controller.syncEntertainmentKnockoutElapsed(.2,.62);
    assert.equal(r.shown(),false);
    assert.ok(Math.abs(r.wrapper.eulerAngles.z)>10,'空中也应播放失衡');
    r.controller.syncEntertainmentKnockoutElapsed(.35,.62);assert.equal(r.shown(),false);
    r.controller.syncEntertainmentKnockoutElapsed(.45,.62);assert.equal(r.shown(),true);
    r.controller.syncEntertainmentKnockoutElapsed(2,.62);
    const rotation=Quat.clone(r.wrapper.rotation);
    r.controller.syncEntertainmentKnockoutElapsed(.5,.62);
    assert.ok(Quat.angle(rotation,r.wrapper.rotation)<.0001);
    for(let i=1;i<=20;i++){
        r.controller.syncEntertainmentKnockoutElapsed(2+i*.05,.62);
        assert.equal(r.controller._lastKnockoutSample,40+i);
    }
});
