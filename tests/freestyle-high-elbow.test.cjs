const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRig,Node,Vec3,Quat,load,root,SWIMMER_MODEL_FILES}=require('./helpers/character-contact-harness.cjs');
const {FreestyleBodyRollMotion}=load(path.join(root,'assets/scripts/character/FreestyleBodyRollMotion.ts'));
const {replayBreathingInput}=require('./helpers/freestyle-breathing-replay.cjs');
const {shoulderVolumeSampler,elbowStrainSampler}=require('./helpers/skinned-arm-strain.cjs');
const TAU=2*Math.PI;
const phase=c=>((c/TAU)%1+1)%1;
const angle=(a,b)=>2*Math.acos(Math.min(1,Math.abs(Quat.dot(a,b))/Math.sqrt(Quat.dot(a,a)*Quat.dot(b,b))))*180/Math.PI;
function rigFor(file){const r=createRig(file),parent=new Node();r.wrapper.setRotationFromEuler(90,90,0);r.wrapper.parent=parent;parent.children.push(r.wrapper);r.pose.setSwimHeadLift(r.variant?.swimHeadLiftDegrees);return {r,parent};}
function arm(r,side){
    const a=r.pose[`_${side}Arm`].getWorldPosition(new Vec3()),e=r.pose[`_${side}ForeArm`].getWorldPosition(new Vec3()),h=r.pose[`_${side}Hand`].getWorldPosition(new Vec3());
    const u=new Vec3(),v=new Vec3();Vec3.subtract(u,e,a);Vec3.subtract(v,h,e);const length=Vec3.len(u)+Vec3.len(v);Vec3.normalize(u,u);Vec3.normalize(v,v);
    return {a,e,h,length,bend:Math.acos(Math.max(-1,Math.min(1,Vec3.dot(u,v))))*180/Math.PI};
}
function body(r){return [r.pose.root,r.pose._hips,r.pose._torso,r.pose._head].map(n=>({p:n.getWorldPosition(new Vec3()),q:n.getWorldRotation(new Quat())}));}
function present(r,f,m,enabled){r.pose.setBodyRollTestPose(m.weight,m.roll,enabled?m.leftRecovery:0,enabled?m.rightRecovery:0);const d=Math.max(.85,Math.min(1.45,.9+f.speed*.16));r.pose.applyFreestylePose(f.left,f.right,f.leftKick,f.rightKick,f.bodyPhase,d,d,d);}

for(const fps of [15,30,60,120]) test(`${fps}帧：稳定俯泳准入，翻滚退出，半次回臂不重新折肘`,()=>{
    const m=new FreestyleBodyRollMotion();let t=0;
    const step=(up=1,pitch=0,rate=0)=>{t+=1/fps;m.update(1/fps,t*TAU,(t+.5)*TAU,true,up,pitch,rate,0);};
    for(let i=0;i<fps*2;i++)step();assert.ok(m.leftRecovery>.98&&m.rightRecovery>.98);
    for(let i=0;i<fps;i++)step(-1,Math.PI,4);assert.equal(m.leftRecovery,0);assert.equal(m.rightRecovery,0);
    // 两臂都在回臂中后段恢复水平；即使准入时间满足，也须等各自下一圈。
    for(let i=0;i<fps/2;i++)m.update(1/fps,(4.6+i/fps*.2)*TAU,(4.6+i/fps*.2)*TAU,true,1,0,0,0);
    assert.equal(m.leftRecovery,0);assert.equal(m.rightRecovery,0);
    for(let i=0;i<fps/2;i++)m.update(1/fps,(5+i/fps*.6)*TAU,(5+i/fps*.6)*TAU,true,1,0,0,0);
    assert.ok(m.leftRecovery>.98&&m.rightRecovery>.98);
    m.update(1/fps,NaN,0,true,1,0,0,0);assert.equal(m.leftRecovery,0);
});

for(const mode of ['player','ai']) for(const fps of [30,60]) test(`${mode} ${fps}帧：真实独立输入及AI降频能完整抬肘`,()=>{
    const frames=replayBreathingInput({mode,fps,seconds:8});
    for(const stride of mode==='ai'?[1,2,3]:[1]){
        const m=new FreestyleBodyRollMotion();let dt=0,visible=0;
        for(let i=0;i<frames.length;i++){const f=frames[i];dt+=f.dt;if(i%stride)continue;m.update(dt,f.left,f.right,f.surface,Math.cos(f.roll)*Math.cos(f.pitch),f.pitch,f.rollSpeed,f.pitchSpeed);dt=0;
            if((m.leftRecovery>.9&&phase(f.left)>.64&&phase(f.left)<.9)||(m.rightRecovery>.9&&phase(f.right)>.64&&phase(f.right)<.9))visible++;
        }assert.ok(visible>=3,`完整回臂可见样本不足：${visible}`);
    }
});

let replay;
for(const file of SWIMMER_MODEL_FILES)test(`${file}：高肘真实骨架、身体不变、入水轮廓和蒙皮`,()=>{
    const {r,parent}=rigFor(file),reference=rigFor(file),m=new FreestyleBodyRollMotion();
    reference.r.pose.setSurfaceSwimStyle('freestyle');
    const volume=shoulderVolumeSampler(r),strain=elbowStrainSampler(r,file),referenceStrain=elbowStrainSampler(reference.r,file);
    replay??=replayBreathingInput({fps:30,seconds:8});let visible=0;
    for(const f of replay){
        const projection=Math.cos(f.roll)*Math.cos(f.pitch);m.update(f.dt,f.left,f.right,f.surface,projection,f.pitch,f.rollSpeed,f.pitchSpeed);
        for(const [rig,p] of [[r,parent],[reference.r,reference.parent]]){p.rotation.set(...f.rotation);rig.pose.setMovementHeadingRadians(f.heading);rig.pose.setMovementPitchRadians(f.pitch);rig.pose.setSurfaceBodyUpProjection(projection);}
        present(r,f,m,false);const before=body(r),baseVolume=volume.sample().percentile05,oldArms=[arm(r,'left'),arm(r,'right')];
        present(r,f,m,true);const after=body(r);
        for(let j=0;j<before.length;j++){assert.ok(Vec3.distance(before[j].p,after[j].p)<1e-7);assert.ok(angle(before[j].q,after[j].q)<.001,'身体转肩及头部不得改变');}
        assert.ok(volume.sample().percentile05>=baseVolume-.03,'肩腋相对已认可直臂版本不得额外塌缩');strain.sample();
        for(const [i,side,cycle,admission] of [[0,'left',f.left,m.leftRecovery],[1,'right',f.right,m.rightRecovery]]){
            const a=arm(r,side),p=phase(cycle);
            if(p<=.4||p>.999)assert.ok(Vec3.distance(a.h,oldArms[i].h)<1e-6,'原水下拉水与完整前伸保留');
            if(p>.4&&p<1){assert.ok(a.bend<115);assert.ok(Vec3.distance(a.a,a.h)>a.length*.52,'不得过度折叠到肩头');}
            if(admission>.95&&p>.68&&p<.9){assert.ok(a.bend>35&&a.bend<115);assert.ok(a.e.y>a.h.y+.01,'侧倾后的手应低于肘，形成手先落下的轮廓');visible++;}
        }
        // 高肘会改变弯曲区的边长，肘部对照已有并经过验证的屈肘曲线；
        // 原直臂转体的+0.03回归仍由 freestyle-body-roll.test.cjs 原样保留。
        reference.r.pose.setBodyRollTestPose(-1);const d=Math.max(.85,Math.min(1.45,.9+f.speed*.16));
        reference.r.pose.applyFreestylePose(f.left,f.right,f.leftKick,f.rightKick,f.bodyPhase,d,d,d);referenceStrain.sample();
    }
    assert.ok(visible>10);assert.ok(strain.percentile95()<=referenceStrain.percentile95()+.03,'高肘肘部形变不应超过既有屈肘曲线');
});

for(const file of ['MuscleMan.glb','CartonSwimmer13.glb'])test(`${file}：往返、双臂同期、完整周期及退出无残留`,()=>{
    const {r,parent}=rigFor(file);const basePositions=r.pose._manualBones.map(n=>JSON.stringify([n.position,n.scale]));
    for(const direction of [1,-1]){
        parent.setRotationFromEuler(0,direction>0?0:180,0);r.pose.setMovementDirection(direction);let previous=null,previousBase=null;
        for(let i=0;i<=480;i++){
            const cycle=i/480*TAU;
            r.pose.setBodyRollTestPose(1,0,0,0);r.pose.applyFreestylePose(cycle,cycle,0,Math.PI,0,1,1,1);
            const baseline=[r.pose._leftArm,r.pose._leftForeArm,r.pose._leftHand,r.pose._rightArm,r.pose._rightForeArm,r.pose._rightHand].map(n=>n.getWorldRotation(new Quat()));
            r.pose.setBodyRollTestPose(1,0,1,1);r.pose.applyFreestylePose(cycle,cycle,0,Math.PI,0,1,1,1);
            const now=[r.pose._leftArm,r.pose._leftForeArm,r.pose._leftHand,r.pose._rightArm,r.pose._rightForeArm,r.pose._rightHand].map(n=>n.getWorldRotation(new Quat()));
            // 原直臂求解在前伸阈值存在跳变；检查回臂不新增、更不放大这些变化。
            if(previous)for(let j=0;j<now.length;j++)assert.ok(angle(previous[j],now[j])<Math.max(12,angle(previousBase[j],baseline[j])+.01),`插值不可新增跳变：${i}/480 骨${j} ${angle(previous[j],now[j])}`);previous=now;previousBase=baseline;
            r.pose._manualBones.forEach((n,j)=>assert.equal(JSON.stringify([n.position,n.scale]),basePositions[j]));
        }
        r.pose.setBodyRollTestPose(1,.5,0,0);r.pose.applyFreestylePose(.7*TAU,.2*TAU,0,Math.PI,0,1,1,1);
        const before=JSON.stringify(r.pose._manualBones.map(n=>n.rotation));
        r.pose.setBodyRollTestPose(1,.5,1,1);r.pose.applyFreestylePose(.7*TAU,.2*TAU,0,Math.PI,0,1,1,1);
        r.pose.setBodyRollTestPose(1,.5,0,0);r.pose.applyFreestylePose(.7*TAU,.2*TAU,0,Math.PI,0,1,1,1);
        assert.equal(JSON.stringify(r.pose._manualBones.map(n=>n.rotation)),before);
    }
});
