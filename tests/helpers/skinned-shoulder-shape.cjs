// 以绑定空间的大臂中段为固定测量区，包含所有实际蒙皮影响骨。
const {Vec3,Mat4}=require('./character-contact-harness.cjs');
function shoulderShapeSampler(rig){
 const groups=[];
 for(const renderer of rig.renderers){
  const bones=renderer.skeleton.joints.map(p=>rig.wrapper.getChildByPath(p)),binds=renderer.skeleton.bindposes;
  for(const side of ['L','R']){
   const arm=bones.findIndex(b=>b.name===side+'_Upperarm'),fore=bones.findIndex(b=>b.name===side+'_Forearm');
   const origin=Vec3.transformMat4(new Vec3(),new Vec3(),Mat4.invert(new Mat4(),binds[arm]));
   const elbow=Vec3.transformMat4(new Vec3(),new Vec3(),Mat4.invert(new Mat4(),binds[fore]));
   const axis=Vec3.subtract(new Vec3(),elbow,origin),length=axis.length();axis.normalize();
   const vertices=[];
   for(let p=0;p<renderer.mesh.struct.primitives.length;p++){
    const pos=renderer.mesh.readAttribute(p,'POSITION'),joints=renderer.mesh.readAttribute(p,'JOINTS_0'),weights=renderer.mesh.readAttribute(p,'WEIGHTS_0');
    for(let i=0;i<pos.length/3;i++){
     const point=new Vec3(...pos.slice(i*3,i*3+3)),offset=Vec3.subtract(new Vec3(),point,origin),t=Vec3.dot(offset,axis)/length;
     if(t<.35||t>.65||Vec3.scaleAndAdd(new Vec3(),offset,axis,-t*length).length()>length*.45)continue;
     let armFamily=0;for(let k=0;k<4;k++)if(bones[joints[i*4+k]].name.startsWith(side+'_'))armFamily+=weights[i*4+k];
     if(armFamily<.9)continue;
     vertices.push({point,joints:joints.slice(i*4,i*4+4),weights:weights.slice(i*4,i*4+4)});
    }
   }
   groups.push({side,bones,binds,arm,vertices,length});
  }
 }
 return {sample(){return groups.map(g=>{
  const matrices=g.bones.map((bone,i)=>Mat4.multiply(new Mat4(),bone.worldMatrix,g.binds[i]));
  const values=g.vertices.map(v=>{const deformed=new Vec3();for(let k=0;k<4;k++){if(!v.weights[k])continue;const p=Vec3.transformMat4(new Vec3(),v.point,matrices[v.joints[k]]);Vec3.scaleAndAdd(deformed,deformed,p,v.weights[k]);}const rigid=Vec3.transformMat4(new Vec3(),v.point,matrices[g.arm]);return Vec3.distance(rigid,deformed)/(g.length*rig.wrapper.scale.x);});
  values.sort((a,b)=>a-b);return {side:g.side,count:values.length,p95:values[Math.floor(values.length*.95)]||0,max:values.at(-1)||0};
 });}};
}
module.exports={shoulderShapeSampler};
