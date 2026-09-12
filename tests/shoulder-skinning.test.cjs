// 前伸时大臂中段应保留绑定外形，不能只检查三根主骨的矩阵。
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRig}=require('./helpers/character-contact-harness.cjs');
const {shoulderShapeSampler}=require('./helpers/skinned-shoulder-shape.cjs');

for(const file of ['CartonSwimmer6.glb','CartonSwimmer8.glb','CartonSwimmer11.glb','CartonSwimmer12.glb','CartonSwimmer13.glb','CartonSwimmer14.glb','MuscleMan.glb']){
 test(`${file}：前伸时真实大臂中段不再受胸肩牵拉`,()=>{
  const rig=createRig(file);rig.wrapper.setRotationFromEuler(90,90,0);
  // 保留自由泳候选的蒙皮回归检查；正式动作由角色配置决定。
  rig.pose.setSurfaceSwimStyle('freestyle');
  const sampler=shoulderShapeSampler(rig),tau=Math.PI*2;
  for(const phase of [0,.025,.05,.995])for(const offset of [0,.5]){
   rig.pose.applyFreestylePose(phase*tau,(phase+offset)*tau,0,Math.PI,phase*tau,1,1,1);
   // 交替时只检验处于前伸保持段的一侧；同期时同时检验两侧。
   for(const result of sampler.sample().filter(s=>offset===0||s.side==='L')){
    assert.ok(result.count>=8,'必须覆盖实际网格顶点');
    assert.ok(result.p95<.001,`${result.side} 大臂中段相对刚性外形偏移超过骨长的千分之一：${result.p95}`);
   }
  }
 });
}
