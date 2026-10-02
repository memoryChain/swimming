// 用真实输入、骨架和蒙皮验证转体；程序权重不作为实机可读性验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRig, Node, Quat, Vec3, load, root, SWIMMER_MODEL_FILES } = require('./helpers/character-contact-harness.cjs');
const { FreestyleBodyRollMotion } = load(path.join(root, 'assets/scripts/character/FreestyleBodyRollMotion.ts'));
const { replayBreathingInput } = require('./helpers/freestyle-breathing-replay.cjs');
const { shoulderVolumeSampler, elbowStrainSampler } = require('./helpers/skinned-arm-strain.cjs');
const TAU = 2 * Math.PI;
const angle = (a,b) => 2*Math.acos(Math.min(1,Math.abs(Quat.dot(a,b))))*180/Math.PI;
function snapshot(r) { return JSON.stringify([r.pose.root.position,r.pose.root.rotation,...r.pose._manualBones.map(b=>b.rotation)]); }
function present(r,l,rh,weight,roll,drive=1) {
    r.pose.setBodyRollTestPose(weight,roll);
    r.pose.applyFreestylePose(l,rh,0,Math.PI,0,drive,drive,drive);
}
function rigFor(file) {
    const r=createRig(file);r.wrapper.setRotationFromEuler(90,90,0);
    r.pose.setSwimHeadLift(r.variant?.swimHeadLiftDegrees);
    const parent=new Node();r.wrapper.parent=parent;parent.children.push(r.wrapper);
    return {r,parent};
}

for(const fps of [30,60,120]) test(`${fps}帧：单侧、双侧同期、停划和受撞不产生虚假交替`,()=>{
    const m=new FreestyleBodyRollMotion();let hi=0,lo=0;
    for(let i=0;i<fps*3;i++) {
        m.update(1/fps,i/fps*TAU,0,true,1,0,0,0);
        hi=Math.max(hi,m.roll*m.weight);lo=Math.min(lo,m.roll*m.weight);
    }
    assert.ok(hi>.8);assert.equal(lo,0,'只划左侧不能凭空转向右侧');
    for(let i=0;i<fps;i++)m.update(1/fps,3*TAU,0,true,1,0,0,0);
    assert.equal(m.weight,0);assert.equal(m.roll,0);
    m.reset();
    for(let i=0;i<fps*2;i++) {
        const cycle=i/fps*TAU;m.update(1/fps,cycle,cycle,true,1,0,0,0);
        assert.equal(m.roll,0,'双臂同期应居中');
    }
    m.reset();
    for(let i=0;i<fps*2;i++)m.update(1/fps,i/fps*TAU,0,true,1,0,0,0);
    for(let i=0;i<fps;i++)m.update(1/fps,(2+i/fps)*TAU,0,true,-1,Math.PI,4,4);
    assert.equal(m.weight,0,'仰面、倒立、高速翻滚退出');
    m.update(1/fps,NaN,0,true,1,0,0,0);assert.equal(m.weight,0);
});

for(const mode of ['player','ai']) for(const fps of [30,60]) test(`${mode} ${fps}帧真实输入及降频：两侧转体有完整变化`,()=>{
    const frames=replayBreathingInput({mode,fps,seconds:8});
    for(const stride of mode==='ai'?[1,2,3]:[1]) {
        const m=new FreestyleBodyRollMotion();let dt=0,lo=0,hi=0,previous=0;
        for(let i=0;i<frames.length;i++) {
            const f=frames[i];dt+=f.dt;if(i%stride)continue;
            m.update(dt,f.left,f.right,f.surface,Math.cos(f.roll)*Math.cos(f.pitch),f.pitch,f.rollSpeed,f.pitchSpeed);
            const value=m.roll*m.weight;hi=Math.max(hi,value);lo=Math.min(lo,value);
            assert.ok(Math.abs(value-previous)<=12*dt+1e-5,'连续转体不能跳帧瞬移');previous=value;dt=0;
        }
        assert.ok(hi>.50&&lo<-.50,`身体双向转动范围 ${lo.toFixed(3)}..${hi.toFixed(3)}`);
    }
});

for(const file of SWIMMER_MODEL_FILES) test(`${file}：模型48°、胸肩56°、髋部枢轴固定及多次切换完整恢复`,()=>{
    const {r,parent}=rigFor(file);
    for(const direction of [1,-1]) {
        parent.setRotationFromEuler(0,direction>0?0:180,0);r.pose.setMovementDirection(direction);
        const l=.64*TAU,rh=.14*TAU;
        present(r,l,rh,-1,0);const baseline=snapshot(r);
        present(r,l,rh,1,0);
        const chest=r.pose._torso.getWorldRotation(new Quat()),hip=r.pose._hips.getWorldRotation(new Quat()),head=r.pose._head.getWorldRotation(new Quat());
        const model=r.pose.root.getWorldRotation(new Quat()),pivot=r.pose._hips.getWorldPosition(new Vec3());
        const hipLocal=JSON.stringify(r.pose._hips.rotation),physical=JSON.stringify([parent.rotation,parent.position,r.wrapper.rotation,r.wrapper.position]);
        for(const sign of [-1,1]) {
            present(r,l,rh,1,sign);
            assert.ok(Math.abs(angle(model,r.pose.root.getWorldRotation(new Quat()))-48)<.1,'整个骨架显示根确实侧倾');
            assert.ok(Math.abs(angle(chest,r.pose._torso.getWorldRotation(new Quat()))-56)<.1);
            assert.ok(Math.abs(angle(hip,r.pose._hips.getWorldRotation(new Quat()))-48)<.1);
            assert.equal(JSON.stringify(r.pose._hips.rotation),hipLocal,'髋部不再追加局部扭转');
            assert.ok(Vec3.distance(pivot,r.pose._hips.getWorldPosition(new Vec3()))<1e-5,'不得绕模型脚底公转或抬离水面');
            assert.equal(JSON.stringify([parent.rotation,parent.position,r.wrapper.rotation,r.wrapper.position]),physical,'外层物理节点与模型安装节点不变');
            const headAngle=angle(head,r.pose._head.getWorldRotation(new Quat()));
            assert.ok(headAngle>8&&headAngle<12,'头部小幅跟随，不能完全锁死或随着肩膀大幅甩动');
            const peak=snapshot(r);for(let n=0;n<20;n++)present(r,l,rh,1,sign);
            assert.equal(snapshot(r),peak,'不得累积旋转');
            present(r,l,rh,-1,0);assert.equal(snapshot(r),baseline,'退出恢复所有基础骨骼');
            present(r,l,rh,1,sign);r.pose.setBodyRollTestPose(-1);r.pose.applyButterflyPose(.65,1,0);
            present(r,l,rh,-1,0);assert.equal(snapshot(r),baseline,'蝶泳接管后无残留');
        }
    }
});

for(const file of ['MuscleMan.glb','CartonSwimmer5.glb']) test(`${file}：倾斜外层与不同缩放下枢轴稳定，踩水衔接与原路径一致`,()=>{
    const {r,parent}=rigFor(file);
    parent.setRotationFromEuler(23,137,-31);parent.setPosition(7,2,-4);
    r.pose.setMovementHeadingRadians(.55);r.pose.setMovementPitchRadians(.2);
    const originalScale=r.wrapper.scale.x;
    for(const scale of [.85,1.25]) {
        r.wrapper.scale.set(originalScale*scale,originalScale*scale,originalScale*scale);
        for(const weight of [.25,.5,1]) {
            present(r,.64*TAU,.14*TAU,weight,0);
            const pivot=r.pose._hips.getWorldPosition(new Vec3()),rotation=r.pose.root.getWorldRotation(new Quat());
            present(r,.64*TAU,.14*TAU,weight,1);
            assert.ok(Vec3.distance(pivot,r.pose._hips.getWorldPosition(new Vec3()))<1e-5);
            assert.ok(Math.abs(angle(rotation,r.pose.root.getWorldRotation(new Quat()))-48*weight)<.01);
        }
        // 比较相同的自由泳→踩水→自由泳路径，隔离原踩水姿态对其余骨骼的影响。
        present(r,1,2,-1,0);
        for(const weight of [.1,.5,1])r.pose.applyFreestyleTreadBlendPose(1,2,0,Math.PI,0,1,1,1,0,weight);
        present(r,1,2,-1,0);const baseline=snapshot(r);
        present(r,1,2,1,1);
        r.pose.setBodyRollTestPose(-1);
        for(const weight of [.1,.5,1])r.pose.applyFreestyleTreadBlendPose(1,2,0,Math.PI,0,1,1,1,0,weight);
        present(r,1,2,-1,0);assert.equal(snapshot(r),baseline);
    }
});

let replay;
for(const file of SWIMMER_MODEL_FILES) test(`${file}：真实输入肩腋和肘部形变检查`,()=>{
    const {r,parent}=rigFor(file),m=new FreestyleBodyRollMotion();
    const volume=shoulderVolumeSampler(r),baseStrain=elbowStrainSampler(r,file),turnStrain=elbowStrainSampler(r,file);
    replay??=replayBreathingInput({fps:30,seconds:8});
    for(let i=0;i<replay.length;i++) {
        const f=replay[i],projection=Math.cos(f.roll)*Math.cos(f.pitch);
        m.update(f.dt,f.left,f.right,f.surface,projection,f.pitch,f.rollSpeed,f.pitchSpeed);
        parent.rotation.set(...f.rotation);r.pose.setMovementHeadingRadians(f.heading);r.pose.setMovementPitchRadians(f.pitch);r.pose.setSurfaceBodyUpProjection(projection);
        const drive=Math.max(.85,Math.min(1.45,.9+f.speed*.16));
        present(r,f.left,f.right,-1,0,drive);const base=volume.sample();baseStrain.sample();
        present(r,f.left,f.right,m.weight,m.roll,drive);const changed=volume.sample();turnStrain.sample();
        assert.ok(changed.percentile05>=base.percentile05-.03,`肩腋体积 ${f.time.toFixed(3)}: ${base.percentile05} -> ${changed.percentile05}`);
        for(const bone of r.pose._manualBones)assert.ok(Number.isFinite(bone.rotation.x+bone.rotation.y+bone.rotation.z+bone.rotation.w));
    }
    assert.ok(turnStrain.percentile95()<=baseStrain.percentile95()+.03,`肘部拉伸 ${baseStrain.percentile95()} -> ${turnStrain.percentile95()}`);
});
