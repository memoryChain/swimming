// 离线用真实蒙皮三角面检查胸腹与圈的间隙；正式运行时不执行逐顶点检测。
const fs=require('node:fs'),path=require('node:path');
const h=require('./character-contact-harness.cjs');
function bodySurface(rig,file){
    const bytes=fs.readFileSync(path.join(rig.modelDirectory,file)),length=bytes.readUInt32LE(12);
    const json=JSON.parse(bytes.subarray(20,20+length)),bin=bytes.subarray(28+length),parts=[];
    function indices(index){const a=json.accessors[index],v=json.bufferViews[a.bufferView],size=a.componentType===5125?4:2;
        return Array.from({length:a.count},(_,i)=>bin[size===4?'readUInt32LE':'readUInt16LE']((v.byteOffset||0)+(a.byteOffset||0)+i*size));}
    for(const renderer of rig.renderers){
        const bones=renderer.skeleton.joints.map(p=>rig.wrapper.getChildByPath(p));
        for(let p=0;p<renderer.mesh.struct.primitives.length;p++){
            const pos=renderer.mesh.readAttribute(p,'POSITION'),joints=renderer.mesh.readAttribute(p,'JOINTS_0'),weights=renderer.mesh.readAttribute(p,'WEIGHTS_0');
            const torso=Array.from({length:pos.length/3},(_,v)=>{let sum=0;for(let k=0;k<4;k++)if(/^(Hip|Pelvis|Waist|Spine\d*)$/.test(bones[joints[v*4+k]]?.name))sum+=weights[v*4+k];return sum;});
            const ids=indices(renderer.mesh.struct.primitives[p].indices),triangles=[];
            for(let i=0;i<ids.length;i+=3)if(Math.max(torso[ids[i]],torso[ids[i+1]],torso[ids[i+2]])>=.5)triangles.push(ids.slice(i,i+3));
            parts.push({renderer,bones,pos,joints,weights,torso,triangles});
        }
    }
    return function clearance(ring,offset=0){
        const point=new h.Vec3(),world=new h.Vec3(),local=new h.Vec3(),inverse=h.Quat.invert(new h.Quat(),ring.rotation);
        let minimum=Infinity,hit=null;
        for(const part of parts){
            const {renderer,bones,pos,joints,weights,torso,triangles}=part;
            const matrices=bones.map((b,i)=>h.Mat4.multiply(new h.Mat4(),b.worldMatrix,renderer.skeleton.bindposes[i]));
            const vertices=Array.from({length:pos.length/3},(_,v)=>{world.set(0,0,0);for(let k=0;k<4;k++){
                point.set(pos[v*3],pos[v*3+1],pos[v*3+2]);h.Vec3.transformMat4(point,point,matrices[joints[v*4+k]]);h.Vec3.scaleAndAdd(world,world,point,weights[v*4+k]);}
                return rig.wrapper.parent.inverseTransformPoint(new h.Vec3(),world);});
            for(const ids of triangles)for(let a=0;a<=5;a++)for(let b=0;b<=5-a;b++){
                const u=a/5,v=b/5,w=1-u-v;if(torso[ids[0]]*u+torso[ids[1]]*v+torso[ids[2]]*w<.5)continue;
                point.set(0,0,0);h.Vec3.scaleAndAdd(point,point,vertices[ids[0]],u);h.Vec3.scaleAndAdd(point,point,vertices[ids[1]],v);h.Vec3.scaleAndAdd(point,point,vertices[ids[2]],w);
                h.Vec3.subtract(local,point,ring.position);local.x-=offset;h.Vec3.transformQuat(local,local,inverse);
                const gap=Math.hypot(Math.hypot(local.x,local.z)-ring.radius,local.y)-ring.radius*.24;
                if(gap<minimum){minimum=gap;hit=h.Vec3.clone(point);}
            }
        }
        return {minimum,hit};
    };
}
function makeRecovery(file){
    const r=h.createRig(file),parent=new h.Node();r.wrapper.parent=parent;parent.children.push(r.wrapper);
    const {CharacterPoseStateController}=h.load(path.join(h.root,'assets/scripts/character/CharacterPoseStateController.ts'));
    const controller=new CharacterPoseStateController({pose:r.pose,getModel:()=>r.wrapper,getRoot:()=>r.pose.root,getSelfTime:()=>0,
        modelScale:()=>1.35*(r.variant?.modelScaleMultiplier||1),raceModelYOffset:()=>r.variant?.raceModelYOffset||0,raceModelEulerDegrees:()=>[90,90,0],updateSplashSurface(){},setSplashVisible(){}});
    controller.enterFreestyle();r.pose.applyFreestylePose(.3,2,.2,1,.4,1,1,1);controller.enterEntertainmentKnockout();
    return {...r,controller,parent,clearance:bodySurface(r,file)};
}
module.exports={...h,makeRecovery};
