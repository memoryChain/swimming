// 用正式 GLB、正式姿态代码导出离线接触样件；没有手绘替代骨架。
const fs=require('node:fs'),path=require('node:path');
const h=require('../../tests/helpers/character-contact-harness.cjs');
const {bodySurface}=require('../../tests/helpers/recovery-body-contact-harness.cjs');
const {TURTLE_BUS_LAYOUT:L}=h.load(path.join(h.root,'assets/scripts/core/TurtleBusLayout.ts'));
const report=[],models=[];
for(const file of h.SWIMMER_MODEL_FILES){
 const r=h.createRig(file),frame=new h.Node();r.wrapper.parent=frame;frame.children.push(r.wrapper);
 r.wrapper.setRotationFromEuler(90,90,0);r.pose.applyFreestylePose(.3,2,.2,1,.4,1,1,1);
 const back=r.pose.recoveryFloat.towRootOffset(r.wrapper),ring=new h.Vec3(back,-.005,0);
 r.pose.recoveryFloat.applyTowGrip(r.wrapper,3,ring,1,r.hands);
 const handErrors=[0,1].map(side=>{const a=new h.Vec3(),b=new h.Vec3();r.hands.handWorldBounds(side,a,b);
 return h.Vec3.distance(h.Vec3.lerp(new h.Vec3(),a,b,.5),new h.Vec3(back+L.gripForward,ring.y+L.gripHeight+.05,(side?1:-1)*L.gripLateral));});
 const torso=bodySurface(r,file)({position:new h.Vec3(back,.015,0),rotation:new h.Quat(),radius:L.majorRadius,tubeRadius:L.tubeRadius}).minimum;
 const bytes=fs.readFileSync(path.join(r.modelDirectory,file)),jsonLength=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonLength)),bin=bytes.subarray(28+jsonLength);
 function accessor(i){const a=gltf.accessors[i],v=gltf.bufferViews[a.bufferView],width=a.componentType===5125?4:2;return Array.from({length:a.count},(_,j)=>bin[width===4?'readUInt32LE':'readUInt16LE']((v.byteOffset||0)+(a.byteOffset||0)+j*width));}
 const parts=[],point=new h.Vec3(),world=new h.Vec3();
 for(const renderer of r.renderers){const bones=renderer.skeleton.joints.map(p=>r.wrapper.getChildByPath(p)),matrices=bones.map((b,i)=>h.Mat4.multiply(new h.Mat4(),b.worldMatrix,renderer.skeleton.bindposes[i]));
  for(let p=0;p<renderer.mesh.struct.primitives.length;p++){
   const primitive=renderer.mesh.struct.primitives[p],positions=renderer.mesh.readAttribute(p,'POSITION'),joints=renderer.mesh.readAttribute(p,'JOINTS_0'),weights=renderer.mesh.readAttribute(p,'WEIGHTS_0'),vertices=[];
   for(let v=0;v<positions.length/3;v++){world.set(0,0,0);for(let k=0;k<4;k++){
    point.set(...positions.slice(v*3,v*3+3));h.Vec3.transformMat4(point,point,matrices[joints[v*4+k]]);h.Vec3.scaleAndAdd(world,world,point,weights[v*4+k]);}
    vertices.push([world.x-back,world.z,world.y+.005]);}
   parts.push({vertices,indices:accessor(primitive.indices),color:gltf.materials[primitive.material]?.pbrMetallicRoughness?.baseColorFactor||[.63,.66,.69,1]});
  }
 }
 let headMax=-Infinity;
 for(const vertex of r.fullHead){world.set(0,0,0);for(const inf of vertex.influences){
  const m=h.Mat4.multiply(new h.Mat4(),inf.bone.worldMatrix,inf.bind);
  h.Vec3.scaleAndAdd(world,world,h.Vec3.transformMat4(point,vertex.point,m),inf.weight);}
  headMax=Math.max(headMax,world.x);}
 report.push({file,variantId:r.variant.id,rootBack:back,palmErrors:handErrors,torsoClearance:torso,
    headClearance:back-L.majorRadius-L.tubeRadius-headMax});
 if(['MuscleMan.glb','CartonSwimmer5.glb','CartonSwimmer15.glb'].includes(file))models.push({file,parts});
}
fs.writeFileSync(path.join(__dirname,'grip-audit.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(h.root,'assets/scripts/core/TurtleBusPassengerFit.ts'),
 '// 正式角色在统一基准姿态下离线测量；禁止使用各客户端当前动画推导乘车距离。\n'
 +'export const TURTLE_BUS_PASSENGER_FIT: Readonly<Record<string, number>> = '
 +JSON.stringify(Object.fromEntries(report.map(r=>[r.variantId,Number(r.rootBack.toFixed(6))])),null,2)+';\n');
fs.writeFileSync(path.join(__dirname,'grip-review-data.json'),JSON.stringify(models));
console.log('已导出11角色接触报告与3个体型的真实蒙皮样件');
