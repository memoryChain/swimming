// 用真实恢复状态机和角色蒙皮导出20Hz连续动作；仅生成独立审查页，不修改模型或动作资产。
const fs=require('node:fs'),path=require('node:path');
const {load,createRig,Node,Vec3,Quat,Mat4,root}=require('../../tests/helpers/character-contact-harness.cjs');
const {createHarness}=require('../../tests/helpers/cocos-math-harness.cjs');
const {CharacterPoseStateController}=load(path.join(root,'assets/scripts/character/CharacterPoseStateController.ts'));
function glb(file){const bytes=fs.readFileSync(file),n=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+n)),bin=bytes.subarray(28+n);
 const read=index=>{const a=json.accessors[index],v=json.bufferViews[a.bufferView],dim={SCALAR:1,VEC3:3,VEC4:4}[a.type],size={5121:1,5123:2,5125:4,5126:4}[a.componentType],method={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];return Array.from({length:a.count*dim},(_,i)=>bin[method]((v.byteOffset||0)+(a.byteOffset||0)+Math.floor(i/dim)*(v.byteStride||dim*size)+(i%dim)*size)/(a.normalized?(a.componentType===5123?65535:255):1));};return {json,read};}
const output={characters:[]};
for(const file of ['MuscleMan.glb','CartonSwimmer5.glb']){
 const r=createRig(file),parent=new Node();r.wrapper.parent=parent;parent.children.push(r.wrapper);
 let callback;
 const h=createHarness({'./CharacterModelLoader':{loadSwimmerPrefab:cb=>callback=cb,setLayerRecursive(){}}});
 h.Node.prototype.setParent=function(p){this.parent=p;p.children.push(this)};
 h.cc.instantiate=()=>new h.Node();
 const {RecoveryFloatPresentation}=h.load(path.join(root,'assets/scripts/character/RecoveryFloatPresentation.ts'));
 const presentation=new RecoveryFloatPresentation(parent);callback(null,{prefab:{}});
 const controller=new CharacterPoseStateController({pose:r.pose,getModel:()=>r.wrapper,getRoot:()=>r.pose.root,getSelfTime:()=>0,
 modelScale:()=>1.35*(r.variant?.modelScaleMultiplier||1),raceModelYOffset:()=>r.variant?.raceModelYOffset||0,raceModelEulerDegrees:()=>[90,90,0],
 updateSplashSurface(){},setSplashVisible(){},onRecoveryFloat:(p,w)=>p?presentation.update(p,w):presentation.hide()});
 controller.enterFreestyle();r.pose.applyFreestylePose(.3,2,.2,1,.4,1,1,1);controller.enterEntertainmentKnockout();
 const g=glb(path.join(root,'assets/race/models',file)),parts=[],indices=[];
 let vertexCount=0;
 for(const renderer of r.renderers)for(let p=0;p<renderer.mesh.struct.primitives.length;p++){
  const pos=renderer.mesh.readAttribute(p,'POSITION'),joints=renderer.mesh.readAttribute(p,'JOINTS_0'),weights=renderer.mesh.readAttribute(p,'WEIGHTS_0');
  const ids=g.read(renderer.mesh.struct.primitives[p].indices);for(const i of ids)indices.push(vertexCount+i);
  parts.push({renderer,pos,joints,weights});vertexCount+=pos.length/3;
 }
 const frames=[],rings=[],point=new Vec3(),world=new Vec3();
 for(let frame=0;frame<=70;frame++){
  controller.syncEntertainmentKnockoutElapsed(frame*.05);
  const vertices=new Int16Array(vertexCount*3);let offset=0;
  for(const part of parts){const {renderer,pos,joints,weights}=part;const bones=renderer.skeleton.joints.map(p=>r.wrapper.getChildByPath(p));
   const matrices=bones.map((b,i)=>Mat4.multiply(new Mat4(),b.worldMatrix,renderer.skeleton.bindposes[i]));
   for(let v=0;v<pos.length/3;v++){world.set(0,0,0);for(let k=0;k<4;k++){point.set(pos[v*3],pos[v*3+1],pos[v*3+2]);Vec3.transformMat4(point,point,matrices[joints[v*4+k]]);Vec3.scaleAndAdd(world,world,point,weights[v*4+k]);}
    for(const value of [world.x,world.y,world.z]){if(Math.abs(value)>7.9)throw Error('蒙皮预览超出量化范围');vertices[offset++]=Math.round(value*4096);}}
  }
  frames.push(Buffer.from(vertices.buffer).toString('base64'));
  rings.push(presentation.ring.active?Array.from(Mat4.toArray([],presentation.ring.worldMatrix)):null);
 }
 output.characters.push({file,indices,frames,rings,vertexCount});
}
const ring=glb(path.join(root,'assets/race/items/RecoveryFloatRing.glb')),p=ring.json.meshes[0].primitives[0];
output.ring={positions:ring.read(p.attributes.POSITION),colors:ring.read(p.attributes.COLOR_0),indices:ring.read(p.indices)};
const html=fs.readFileSync(path.join(__dirname,'transition-template.html'),'utf8').replace('/*__DATA__*/',JSON.stringify(output));
fs.writeFileSync(path.join(__dirname,'transition-review.html'),html);
console.log(`已导出两种体型各71帧的真实恢复动作：${html.length}字节。`);
