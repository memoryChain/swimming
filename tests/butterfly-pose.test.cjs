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
            freestyle(r); r.pose.applyButterflyPose(frame/240);
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
        freestyle(r); r.pose.applyButterflyPose(.73);
        for(const side of ['left','right']) {
            const a=r.pose[`_${side}Arm`], f=r.pose[`_${side}ForeArm`], h=r.pose[`_${side}Hand`];
            assert.ok(Vec3.dot(direction(a,f),direction(f,h))>.8,'回摆阶段接近伸臂');
        }
        freestyle(r); assert.equal(snapshot(r),before,'退出后不能残留腰背和髋部偏移');
    });
}

for (const file of ['CartonSwimmer5.glb','CartonSwimmer13.glb','CartonSwimmer14.glb','MuscleMan.glb']) {
    test(`${file}：真实肩腋蒙皮回臂不塌缩，肘部整圈不过度拉伸`, () => {
        const r=createRig(file);r.wrapper.setRotationFromEuler(90,90,0);
        const shoulder=shoulderVolumeSampler(r),elbow=elbowStrainSampler(r,file);
        for(let i=0;i<=120;i++) {
            r.pose.restoreBasePose();r.pose.applyButterflyPose(i/120);elbow.sample();
            if(i/120>=.52 && i/120<=.85) {
                const volume=shoulder.sample();assert.ok(volume.count>20);
                assert.ok(volume.percentile05>.55,`回臂肩部体积比 ${volume.percentile05}，相位 ${i/120}`);
            }
        }
        assert.ok(elbow.percentile95()<1.6,'修肩部不能把扭转转移到肘部');
    });
}

test('蝶泳短按加腿实际改变双腿姿态，但不改变躯干、手臂和双腿同相关系', () => {
    const r=createRig('CartonSwimmer5.glb');r.wrapper.setRotationFromEuler(90,90,0);
    r.pose.applyButterflyPose(.7);
    const arm=r.pose._leftArm.rotation.clone(),root=r.pose.root.rotation.clone();
    const left=r.pose._leftLeg.rotation.clone(),right=r.pose._rightLeg.rotation.clone();
    r.pose.applyButterflyPose(.7,1,Math.PI*.6);
    assert.ok(Math.abs(Quat.dot(left,r.pose._leftLeg.rotation))<.9999);
    assert.ok(Math.abs(Quat.dot(right,r.pose._rightLeg.rotation))<.9999);
    assert.ok(Math.abs(Quat.dot(arm,r.pose._leftArm.rotation))>1-1e-6);
    assert.ok(Math.abs(Quat.dot(root,r.pose.root.rotation))>1-1e-6);
});

test('升沉沿世界水面法线，正反向与不同缩放均不改变赛程根节点', () => {
    for (const yaw of [90,-90,120]) for (const scale of [1,1.6]) {
        const r=createRig('MuscleMan.glb');r.wrapper.setRotationFromEuler(90,yaw,0);
        r.wrapper.scale.set(scale,scale,scale);
        r.wrapper.setPosition(5,.15,3);
        const world=[];
        for(let i=0;i<=120;i++) {
            r.pose.applyButterflyPose(i/120);
            world.push(position(r.pose.root));
        }
        assert.ok(world.every(p=>Math.abs(p.x-5)<1e-6&&Math.abs(p.z-3)<1e-6),'升沉不能变成前后摆动');
        const range=Math.max(...world.map(p=>p.y))-Math.min(...world.map(p=>p.y));
        assert.ok(Math.abs(range-.2)<.001,'升沉振幅使用世界单位');
        assert.equal(r.wrapper.position.x,5);assert.equal(r.wrapper.position.y,.15);
        assert.ok(Vec3.distance(world[0],world.at(-1))<1e-6,'拍与拍首尾闭合');
    }
});
