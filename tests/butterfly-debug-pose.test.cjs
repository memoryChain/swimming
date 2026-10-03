const test = require('node:test');
const assert = require('node:assert/strict');
const { createRig, Vec3, Quat, SWIMMER_MODEL_FILES } = require('./helpers/character-contact-harness.cjs');
const { elbowStrainSampler, shoulderVolumeSampler } = require('./helpers/skinned-arm-strain.cjs');
const position = n => n.getWorldPosition(new Vec3());
const direction = (a,b) => Vec3.subtract(new Vec3(), position(b), position(a)).normalize();
const snapshot = r => JSON.stringify([r.pose.root.position, r.pose.root.rotation, ...r.pose._manualBones.map(n => n.rotation)]);
const freestyle = r => r.pose.applyFreestylePose(.5, 2, 1, 3, .4, 1, 1, 1);

for (const file of SWIMMER_MODEL_FILES) {
    test(`${file}：蝶泳整拍有限、肩腕不交叉、回摆伸臂且退出完全恢复`, () => {
        const r = createRig(file); r.wrapper.setRotationFromEuler(90,90,0);
        freestyle(r); const before = snapshot(r);
        let previous = null, peak = 0;
        for(let frame=0;frame<=240;frame++) {
            freestyle(r); r.pose.applyButterflyDebugPose(frame/240);
            const rotations = r.pose._manualBones.map(n => n.rotation.clone());
            for (let i=0;i<rotations.length;i++) {
                const q=rotations[i]; assert.ok([q.x,q.y,q.z,q.w].every(Number.isFinite));
                if(previous) peak=Math.max(peak,2*Math.acos(Math.min(1,Math.abs(Quat.dot(q,previous[i]))))*180/Math.PI);
            }
            previous=rotations;
            const left = position(r.pose._leftHand), right = position(r.pose._rightHand);
            assert.ok(left.z < right.z, '双手不交叉到身体另一侧');
        }
        assert.ok(peak < 25, `相邻帧不能突跳，峰值 ${peak}`);
        freestyle(r); r.pose.applyButterflyDebugPose(.73);
        for(const side of ['left','right']) {
            const a=r.pose[`_${side}Arm`], f=r.pose[`_${side}ForeArm`], h=r.pose[`_${side}Hand`];
            assert.ok(Vec3.dot(direction(a,f),direction(f,h))>.8,'回摆阶段接近伸臂');
        }
        r.pose.restoreBasePose(); freestyle(r); assert.equal(snapshot(r),before,'退出后不能残留腰背和髋部偏移');
    });
}

for (const file of SWIMMER_MODEL_FILES) {
    test(`${file}：真实肩腋蒙皮回臂不塌缩，肘部整圈不过度拉伸`, () => {
        const r=createRig(file);r.wrapper.setRotationFromEuler(90,90,0);
        const shoulder=shoulderVolumeSampler(r),elbow=elbowStrainSampler(r,file);
        for(let i=0;i<=120;i++) {
            r.pose.restoreBasePose();r.pose.applyButterflyDebugPose(i/120);elbow.sample();
            if(i/120>=.52 && i/120<=.85) {
                const volume=shoulder.sample();assert.ok(volume.count>20);
                assert.ok(volume.percentile05>.55,`回臂肩部体积比 ${volume.percentile05}，相位 ${i/120}`);
            }
        }
        assert.ok(elbow.percentile95()<1.6,'修肩部不能把扭转转移到肘部');
    });
}

test('升沉沿世界水面法线，正反向与不同缩放均不改变赛程根节点', () => {
    for (const yaw of [90,-90,120]) for (const scale of [1,1.6]) {
        const r=createRig('MuscleMan.glb');r.wrapper.setRotationFromEuler(90,yaw,0);
        r.wrapper.scale.set(scale,scale,scale);
        r.wrapper.setPosition(5,.15,3);
        const world=[];
        for(let i=0;i<=120;i++) {
            r.pose.applyButterflyDebugPose(i/120);
            world.push(position(r.pose.root));
        }
        assert.ok(world.every(p=>Math.abs(p.x-5)<1e-6&&Math.abs(p.z-3)<1e-6),'升沉不能变成前后摆动');
        const range=Math.max(...world.map(p=>p.y))-Math.min(...world.map(p=>p.y));
        assert.ok(Math.abs(range-.2)<.001,'升沉振幅使用世界单位');
        assert.equal(r.wrapper.position.x,5);assert.equal(r.wrapper.position.y,.15);
        assert.ok(Vec3.distance(world[0],world.at(-1))<1e-6,'拍与拍首尾闭合');
    }
});

// 统计动作求解器自己的临时数学对象，不将节点测试替身的内部运算误算成分配。
test('蝶泳全周期复用向量和四元数，采样不创建临时数学对象', () => {
    const path = require('node:path');
    const { createHarness } = require('./helpers/cocos-math-harness.cjs');
    const counted = createHarness(); let allocations = 0;
    for (const name of ['Vec3', 'Quat']) {
        const Original = counted.cc[name];
        counted.cc[name] = class extends Original { constructor(...args) { super(...args); allocations++; } };
    }
    const { FreestylePoseController } = counted.load(path.join(counted.root, 'assets/scripts/character/FreestylePoseController.ts'));
    const r = createRig('CartonSwimmer16.glb'); r.wrapper.setRotationFromEuler(90, 90, 0);
    const p = new FreestylePoseController(); p.bind(r.pose.root); p.captureBasePose(); p.setDiveHandContact(r.hands);
    const before = allocations;
    for (let i = 0; i < 480; i++) p.applyButterflyDebugPose(i / 480);
    assert.equal(allocations, before);
});

test('重复采样从基姿重建，周期闭合且不会改变骨长或赛程根节点', () => {
    for (const file of SWIMMER_MODEL_FILES) {
        const r = createRig(file); r.wrapper.setRotationFromEuler(90, 90, 0);
        const positions = r.pose._basePoseBones.map(p => [p.bone, p.bone.position.clone()]);
        r.pose.applyButterflyDebugPose(0); const first = snapshot(r);
        for (let lap = 0; lap < 3; lap++) {
            for (let i = 0; i <= 120; i++) r.pose.applyButterflyDebugPose(i / 120);
            const previous = JSON.parse(first), current = JSON.parse(snapshot(r));
            for (let k = 0; k < previous.length; k++) for (const key of Object.keys(previous[k])) {
                assert.ok(Math.abs(previous[k][key] - current[k][key]) < 1e-9, `${file} 周期边界 ${k}.${key}`);
            }
        }
        for (const [bone, base] of positions.filter(([bone]) => bone !== r.pose.root)) assert.ok(Vec3.distance(bone.position, base) < 1e-9, bone.name);
        for (const phase of [NaN, Infinity, -Infinity, -10, 10]) {
            r.pose.applyButterflyDebugPose(phase);
            assert.ok(r.pose._manualBones.every(n => [n.rotation.x,n.rotation.y,n.rotation.z,n.rotation.w].every(Number.isFinite)));
        }
    }
});
