// 对实际交付水球的最大鼓胀/抖动包围盒，检查主干角色头部和手臂真实蒙皮。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRig,SWIMMER_MODEL_FILES,Mat4,Vec3,Quat,load,root}=require('../tests/helpers/character-contact-harness.cjs');
const {createBuoyHarness}=require('../tests/helpers/spray-buoy-harness.cjs');
const mounts=require('../modelresource/entertainment/timed-water-balloon/mounts.json');
const game=createBuoyHarness(42,200,undefined,'water-balloon');let error;game.runtime.prepare(e=>error=e);assert.ifError(error);
const p=game.runtime.waterBalloon.presentation,arm={roundId:0,carrierLane:0,fuseSeconds:8,revision:1};p.attach(arm,game.actors[0].body.node,false);
const bounds={body:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},connector:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}},point=new Vec3(),localPoint=new Vec3();
for(let i=0;i<=160;i++){
 const remaining=8-i/20;p.update(.05,arm,game.actors[0].body.node,remaining,remaining<=.8,true);
 for(const [part,node] of [['body',p.body],['connector',p.connector]]){
  const bound=bounds[part];
  const positions=node.getComponent(game.cc.MeshRenderer).mesh.geometry.positions;
  for(let v=0;v<positions.length;v+=3){Vec3.transformMat4(point,new Vec3(...positions.slice(v,v+3)),node.worldMatrix);p.root.inverseTransformPoint(localPoint,point);
   for(const [axis,value] of [localPoint.x,localPoint.y,localPoint.z].entries()){bound.min[axis]=Math.min(bound.min[axis],value);bound.max[axis]=Math.max(bound.max[axis],value);}
  }
 }
}
game.runtime.dispose();
const curves=load(path.join(root,'assets/scripts/character/FlipTurnPoseCurve.ts')),rows=[];
for(const file of SWIMMER_MODEL_FILES){
 const rig=createRig(file),m=mounts.find(m=>m.id===rig.variant.id),spine=rig.wrapper.getChildByPath(rig.renderers[0].skeleton.joints.find(p=>p.endsWith('/Spine02')));
 const mount=Mat4.fromRTS(new Mat4(),new Quat(...m.rotation),new Vec3(...m.position),new Vec3(...m.scale));
 rig.wrapper.setRotationFromEuler(90,90,0);
 const row={id:rig.variant.id,headMinimum:Infinity,armMinimum:Infinity,samples:0,overlapSamples:0};
 const poses=Array.from({length:10},(_,i)=>()=>rig.pose.applyFreestylePose(i/10,i/10+.5,i/10,i/10+.5,i/10,1,1,1));
 poses.push(()=>rig.pose.applyDivePrepPose(),()=>rig.pose.applyDivePrepToStreamlinePose(.5),()=>rig.pose.applyFlipTurnKeyPose(curves.FLIP_TURN_KEYFRAME_1),()=>rig.pose.applyFlipTurnKeyPose(curves.FLIP_TURN_KEYFRAME_2));
 for(const [poseIndex,apply] of poses.entries()){
  apply();const inverse=Mat4.invert(new Mat4(),Mat4.multiply(new Mat4(),spine.worldMatrix,mount)),matrices=new Map(),tmp=new Vec3(),world=new Vec3(),out=new Vec3();
  for(const [region,vertices] of [['head',rig.fullHead],['arm',rig.fullArms.flat()]])for(const v of vertices){
   world.set(0,0,0);let weight=0;
   for(const influence of v.influences){const i=influence;if(!matrices.has(i.bone))matrices.set(i.bone,Mat4.multiply(new Mat4(),i.bone.worldMatrix,i.bind));Vec3.transformMat4(tmp,v.point,matrices.get(i.bone));Vec3.scaleAndAdd(world,world,tmp,i.weight);weight+=i.weight;}
   Vec3.multiplyScalar(world,world,1/weight);Vec3.transformMat4(out,world,inverse);
   for(const bound of Object.values(bounds)) {
    let sq=0;for(const [axis,value] of [out.x,out.y,out.z].entries()){const d=Math.max(0,bound.min[axis]-value,value-bound.max[axis]);sq+=d*d;}
    const distance=Math.sqrt(sq);row[region+'Minimum']=Math.min(row[region+'Minimum'],distance);row.samples++;if(distance===0)row.overlapSamples++;
   }
  }
 }
 rows.push(row);
}
const result={bounds,rows,samples:rows.reduce((n,r)=>n+r.samples,0),overlapSamples:rows.reduce((n,r)=>n+r.overlapSamples,0)};
fs.writeFileSync(path.join(root,'modelresource/entertainment/timed-water-balloon/clearance-audit.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));assert.equal(result.overlapSamples,0,'水球各部件保守包围盒与头部/手臂采样交叠，需审查具体姿态');
