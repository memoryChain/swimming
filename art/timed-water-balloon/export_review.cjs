// C1 只读采样现有角色真实蒙皮；不修改角色资源，不启动编辑器。
const fs = require('node:fs');
const path = require('node:path');
const { createRig, Node, Vec3, Mat4, Quat, root, SWIMMER_MODEL_FILES } = require('../../tests/helpers/character-contact-harness.cjs');
const rows = [], mounts = [];
function find(n, name) { if(n.name===name)return n; for(const c of n.children){const v=find(c,name);if(v)return v;} }
function skin(rig, file) {
    const raw=fs.readFileSync(path.join(root,'assets/race/models',file));
    const size=raw.readUInt32LE(12), g=JSON.parse(raw.subarray(20,20+size)),bin=raw.subarray(28+size);
    return rig.renderers.flatMap(renderer=>{
        const matrices=renderer.skeleton.joints.map((p,i)=>Mat4.multiply(new Mat4(),rig.wrapper.getChildByPath(p).worldMatrix,renderer.skeleton.bindposes[i]));
        return renderer.mesh.struct.primitives.map((primitive,p)=>{
            const positions=renderer.mesh.readAttribute(p,'POSITION'),joints=renderer.mesh.readAttribute(p,'JOINTS_0'),weights=renderer.mesh.readAttribute(p,'WEIGHTS_0'), vertices=[];
            const v=new Vec3(),w=new Vec3();
            for(let i=0;i<positions.length/3;i++){w.set(0,0,0);for(let k=0;k<4;k++){v.set(...positions.slice(i*3,i*3+3));Vec3.transformMat4(v,v,matrices[joints[i*4+k]]);Vec3.scaleAndAdd(w,w,v,weights[i*4+k]);}vertices.push([w.x,w.y,w.z]);}
            const a=g.accessors[primitive.indices],b=g.bufferViews[a.bufferView],stride=a.componentType===5123?2:4;
            const indices=Array.from({length:a.count},(_,i)=>bin[stride===2?'readUInt16LE':'readUInt32LE']((b.byteOffset||0)+(a.byteOffset||0)+i*stride));
            return {vertices,indices};
        });
    });
}
for(const file of SWIMMER_MODEL_FILES){
    const rig=createRig(file), frame=new Node();rig.wrapper.parent=frame;frame.children.push(rig.wrapper);
    const spine=find(rig.wrapper,'Spine02');
    const base=rig.wrapper.inverseTransformPoint(new Vec3(),spine.getWorldPosition(new Vec3()));
    const rest=skin(rig,file),temp=new Vec3();let back=Infinity;
    for(const m of rest)for(const p of m.vertices){rig.wrapper.inverseTransformPoint(temp,new Vec3(...p));if(Math.abs(temp.y-base.y)<.07 && Math.abs(temp.x-base.x)<.06)back=Math.min(back,temp.z);}
    if(!Number.isFinite(back))throw Error('缺少背部采样 '+file);
    const local=new Vec3(base.x,base.y,back+.012),scale=rig.wrapper.scale.x;
    const anchor=new Node();anchor.parent=spine;spine.children.push(anchor);
    const world=Vec3.transformMat4(new Vec3(),local,rig.wrapper.worldMatrix);
    const offset=spine.inverseTransformPoint(new Vec3(),world);
    anchor.position.set(offset);
    const rotation=Quat.multiply(new Quat(),rig.wrapper.getWorldRotation(new Quat()),Quat.fromEuler(new Quat(),-90,0,0));
    Quat.multiply(rotation,Quat.invert(new Quat(),spine.getWorldRotation(new Quat())),rotation);anchor.setRotation(rotation);
    const size=spine.getWorldScale(new Vec3());anchor.scale.set(1/size.x,1/size.y,1/size.z);
    const mount={id:rig.variant.id,file,local:[local.x,local.y,local.z],position:[offset.x,offset.y,offset.z],rotation:[rotation.x,rotation.y,rotation.z,rotation.w],scale:[anchor.scale.x,anchor.scale.y,anchor.scale.z]};mounts.push(mount);
    rig.wrapper.setRotationFromEuler(90,90,0);
    rig.pose.applyFreestylePose(.3,2,.2,1,.4,1,1,1);
    const meshes=skin(rig,file).map(m=>({...m,vertices:m.vertices.map(([x,y,z])=>[x,-z,y])}));
    // 原点随肩背骨移动，背向由角色模型轴定义。
    const pos=anchor.getWorldPosition(new Vec3()),q=anchor.getWorldRotation(new Quat());
    rows.push({file,id:mount.id,meshes,position:[pos.x,-pos.z,pos.y],rotation:[q.w,q.x,-q.z,q.y]});
}
fs.writeFileSync(path.join(__dirname,'mounts.json'),JSON.stringify(mounts,null,2)+'\n');
fs.mkdirSync(path.join(root,'.cache'),{recursive:true});fs.writeFileSync(path.join(root,'.cache/timed-water-balloon-review.json'),JSON.stringify(rows));
console.log('已采样 '+rows.length+' 个角色的肩背挂点及真实划水几何。');
