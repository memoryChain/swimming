const test = require('node:test');
const assert = require('node:assert/strict');
const { createRig, Vec3, Quat, SWIMMER_MODEL_FILES } = require('./helpers/character-contact-harness.cjs');
const { elbowStrainSampler, shoulderVolumeSampler } = require('./helpers/skinned-arm-strain.cjs');
const position = n => n.getWorldPosition(new Vec3());
const direction = (a,b) => Vec3.subtract(new Vec3(), position(b), position(a)).normalize();
const snapshot = r => JSON.stringify([r.pose.root.position, r.pose.root.rotation, ...r.pose._manualBones.map(n => n.rotation)]);
const freestyle = r => r.pose.applyFreestylePose(.5, 2, 1, 3, .4, 1, 1, 1);

test('真实外观更新入口仅在进入／退出蝶泳时计算基础姿态，水花仍更新', () => {
    const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
    const compiler = process.env.PATH.split(path.delimiter).map(dir => path.resolve(dir, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p));
    const ts = require(compiler), file = path.resolve(__dirname, '../assets/scripts/entity/CartoonSwimmerRig.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const owner = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'CartoonSwimmerRig');
    const method = owner.members.find(n => n.name?.getText(source) === 'updateFreestyle');
    const js = ts.transpileModule(`class Rig {${method.getText(source)}}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const Rig = vm.runInNewContext(js + ';Rig'), rig = new Rig();
    let base = 0, butterfly = 0, splash = 0;
    Object.assign(rig, { _loaded: true, root: {}, _poseState: { isFreestyleActive: true },
        _butterflyPoseWeight: 0, _armAction: 0, _kickAction: 0,
        _pose: { setMovementDirection() {}, applyFreestyleTreadBlendPose() { base++; }, applyButterflyPose() { butterfly++; } },
        updateArmCycleMotion() {}, updateKickCycleMotion() {}, updateTreadWaterBlend() { return 0; },
        applyTreadBlendModelPlacement() {}, updateSplashSurface() { splash++; }, visualHandWaterEntry() { return 0; },
    });
    const tick = p => rig.updateFreestyle(1 / 60, 0, 0, 0, 0, 0, 2, 1, true, p);
    for (let i = 0; i < 10; i++) tick(.3);
    assert.ok(base > 0 && base < 10); assert.equal(rig._butterflyPoseWeight, 1);
    const before = base;
    for (let i = 0; i < 60; i++) tick(.4);
    assert.equal(base, before); assert.equal(butterfly, 70); assert.equal(splash, 70);
    tick(-1); assert.equal(base, before + 1); assert.equal(butterfly, 71);
});

for (const file of SWIMMER_MODEL_FILES) {
    test(`${file}：满权重跳过自由泳与原叠加路径相同，退出仍恢复`, () => {
        const a = createRig(file), b = createRig(file);
        a.wrapper.setRotationFromEuler(90, 90, 0); b.wrapper.setRotationFromEuler(90, 90, 0);
        for (let i = 0; i <= 120; i++) {
            freestyle(a); a.pose.applyButterflyPose(i / 120);
            b.pose.applyButterflyPose(i / 120);
            assert.equal(snapshot(a), snapshot(b));
        }
        for (const blend of [.8, .4, .1]) {
            freestyle(a); freestyle(b);
            a.pose.applyButterflyPose(1, blend); b.pose.applyButterflyPose(1, blend);
            assert.equal(snapshot(a), snapshot(b));
        }
        freestyle(a); freestyle(b); assert.equal(snapshot(a), snapshot(b));
    });
}

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
