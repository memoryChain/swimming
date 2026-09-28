const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const h=require('./helpers/character-contact-harness.cjs');
const {TURTLE_BUS_LAYOUT:L}=h.load(path.join(h.root,'assets/scripts/core/TurtleBusLayout.ts'));
const {TURTLE_BUS_PASSENGER_FIT:FIT}=h.load(path.join(h.root,'assets/scripts/core/TurtleBusPassengerFit.ts'));
const {bodySurface}=require('./helpers/recovery-body-contact-harness.cjs');
for(const file of h.SWIMMER_MODEL_FILES)test(`${file}：班车双手对准真实握把，反向与单手恢复不改另一侧`,()=>{
 const r=h.createRig(file),frame=new h.Node();r.wrapper.parent=frame;frame.children.push(r.wrapper);
 r.wrapper.setRotationFromEuler(90,90,0);
 const grip=r.pose.recoveryFloat;
 let worst=0;
 for(const direction of [1,-1])for(const hands of [3,1,2])for(const phase of [.1,.3,.7]){
  frame.setRotationFromEuler(0,direction===1?0:180,0);
  r.pose.applyFreestylePose(phase,2,.2,1,.4,1,1,1);
  const rootBack=FIT[r.variant.id],ring=new h.Vec3(direction*rootBack,-.005,0);
  const before=r.pose._manualBones.filter(b=>/_(Upperarm|Forearm|Hand)$/.test(b.name)).map(b=>[b,h.Quat.clone(b.rotation)]);
  grip.applyTowGrip(r.wrapper,hands,ring,direction,r.hands);
  for(const side of [0,1]){
   if(!(hands&(1<<side)))continue;
   const a=new h.Vec3(),b=new h.Vec3();r.hands.handWorldBounds(side,a,b);
   const center=h.Vec3.lerp(new h.Vec3(),a,b,.5);
   const target=new h.Vec3(ring.x+direction*L.gripForward,ring.y+L.gripHeight+.05,direction*(side?1:-1)*L.gripLateral);
   const error=h.Vec3.distance(center,target);worst=Math.max(error,worst);
   assert.ok(error<.09,`${file} 掌心误差 ${error}，方向${direction}，状态${hands}，相位${phase}`);
  }
  for(const [bone,q] of before){
   const bit=bone.name.startsWith('L_')?1:2;
   if(!(hands&bit))assert.ok(h.Quat.angle(q,bone.rotation)<.001,'松开的手保留正常游姿');
  }
  for(const limb of r.pose._collisionLimp._limbs){
   if(limb.leg||!(hands&(limb.upper.name.startsWith('L_')?1:2)))continue;
   const upper=h.Vec3.normalize(new h.Vec3(),h.Vec3.subtract(new h.Vec3(),limb.middle.getWorldPosition(new h.Vec3()),limb.upper.getWorldPosition(new h.Vec3())));
   const lower=h.Vec3.normalize(new h.Vec3(),h.Vec3.subtract(new h.Vec3(),limb.end.getWorldPosition(new h.Vec3()),limb.middle.getWorldPosition(new h.Vec3())));
   const axis=h.Vec3.transformQuat(new h.Vec3(),limb.hingeAxis,limb.upper.getWorldRotation(new h.Quat()));
   const flex=Math.atan2(h.Vec3.dot(h.Vec3.cross(new h.Vec3(),upper,lower),axis),h.Vec3.dot(upper,lower));
   assert.ok(Math.abs(h.Vec3.dot(axis,lower))<.0001,'肘不能侧折');
   assert.ok(flex>=0&&flex<2.8,`肘不能反折：${flex}`);
  }
 }
});

test('真实蒙皮胸腹与厚圈保持空间，包含最大最小体型',()=>{
 for(const file of h.SWIMMER_MODEL_FILES){
  const r=h.createRig(file),frame=new h.Node();r.wrapper.parent=frame;frame.children.push(r.wrapper);
  r.wrapper.setRotationFromEuler(90,90,0);r.pose.applyFreestylePose(.3,2,.2,1,.4,1,1,1);
  const x=FIT[r.variant.id],ring=new h.Vec3(x,-.005,0);
  r.pose.recoveryFloat.applyTowGrip(r.wrapper,3,ring,1,r.hands);
  const result=bodySurface(r,file)({position:new h.Vec3(x,.015,0),rotation:new h.Quat(),radius:L.majorRadius,tubeRadius:L.tubeRadius});
  assert.ok(result.minimum>.025,`${file} 胸腹净距 ${result.minimum}`);
  let headMax=-Infinity;
  for(const vertex of r.fullHead){
   const out=new h.Vec3();
   for(const inf of vertex.influences){
    const m=h.Mat4.multiply(new h.Mat4(),inf.bone.worldMatrix,inf.bind);
    h.Vec3.scaleAndAdd(out,out,h.Vec3.transformMat4(new h.Vec3(),vertex.point,m),inf.weight);
   }
   headMax=Math.max(headMax,out.x);
  }
  assert.ok(x-L.majorRadius-L.tubeRadius-headMax>.025,`${file} 头部必须完全留在圈后`);
 }
});
