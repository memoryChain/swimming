// 读取正式场馆 GLB 三角面，离线核查真实水球／落点视线；不启动 Creator。
const fs=require('fs'),path=require('path'),vm=require('vm');
const {fixture}=require('./water-play-harness.cjs');
const {compiler}=require('./water-splash-harness.cjs');
function makeReview(){
    const f=fixture('cannon');Object.assign(f.course,{poolWidth:21,waterY:.15,startX:2.8,finishX:47.2});f.p.standWorldX=25;f.p.reset();
    const code=fs.readFileSync('assets/scripts/camera/RaceEventPictureInPictureCamera.ts','utf8').replace(/^import[\s\S]*?;\r?\n/gm,'');
    const ceiling=f.load(path.resolve('assets/scripts/venue/TopViewCeilingController.ts'));
    const ts=compiler(),exports={};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Vec3:f.Vec3,Color:class{},SharkState:{INACTIVE:0},setCameraVenueCeilingVisible:ceiling.setCameraVenueCeilingVisible});
    const camera=Object.create(exports.RaceEventPictureInPictureCamera.prototype);
    Object.assign(camera,{options:{course:f.course},cameraPosition:new f.Vec3(),focus:new f.Vec3(),cannonProjectilePosition:new f.Vec3(),applyCameraPose(v){this.fov=v}});
    const bytes=fs.readFileSync('assets/race/pool/LowPolyPool.glb'),json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12))),binStart=20+bytes.readUInt32LE(12)+8;
    function accessor(index){const a=json.accessors[index],v=json.bufferViews[a.bufferView],n=a.type==='VEC3'?3:1,size=a.componentType===5126||a.componentType===5125?4:2,read=a.componentType===5126?'readFloatLE':a.componentType===5125?'readUInt32LE':'readUInt16LE',out=[];for(let i=0;i<a.count;i++)for(let k=0;k<n;k++)out.push(bytes[read](binStart+(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||n*size)+k*size));return out;}
    const meshes=[];
    function visit(index,parent){const n=json.nodes[index];const local=new f.Mat4();if(n.matrix)f.Mat4.fromArray(local,n.matrix);else f.Mat4.fromRTS(local,new f.Quat(...(n.rotation||[0,0,0,1])),new f.Vec3(...(n.translation||[0,0,0])),new f.Vec3(...(n.scale||[1,1,1])));const matrix=f.Mat4.multiply(new f.Mat4(),parent,local);
        if(n.mesh!==undefined&&!/water|floor|lane|podium|props|ground|inner_wall|pool_edge/i.test(n.name)){
            for(const primitive of json.meshes[n.mesh].primitives){const positions=accessor(primitive.attributes.POSITION),indices=accessor(primitive.indices),points=[];
                for(let i=0;i<positions.length;i+=3){const p=f.Vec3.transformMat4(new f.Vec3(),new f.Vec3(...positions.slice(i,i+3)),matrix);points.push([p.x,p.y,p.z]);}
                meshes.push({name:n.name,ceiling:/ceiling/i.test(n.name),points,indices});
            }
        }for(const child of n.children||[])visit(child,matrix);
    }
    for(const root of json.scenes[json.scene||0].nodes)visit(root,new f.Mat4());
    return{f,camera,meshes,ceiling};
}
function rayHit(origin,target,mesh){
    const d=[target[0]-origin[0],target[1]-origin[1],target[2]-origin[2]],p=mesh.points;
    for(let i=0;i<mesh.indices.length;i+=3){const a=p[mesh.indices[i]],b=p[mesh.indices[i+1]],c=p[mesh.indices[i+2]],e1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],e2=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],h=[d[1]*e2[2]-d[2]*e2[1],d[2]*e2[0]-d[0]*e2[2],d[0]*e2[1]-d[1]*e2[0]],det=e1[0]*h[0]+e1[1]*h[1]+e1[2]*h[2];
        if(Math.abs(det)<1e-8)continue;const inv=1/det,s=[origin[0]-a[0],origin[1]-a[1],origin[2]-a[2]],u=inv*(s[0]*h[0]+s[1]*h[1]+s[2]*h[2]);if(u<0||u>1)continue;const q=[s[1]*e1[2]-s[2]*e1[1],s[2]*e1[0]-s[0]*e1[2],s[0]*e1[1]-s[1]*e1[0]],v=inv*(d[0]*q[0]+d[1]*q[1]+d[2]*q[2]);if(v<0||u+v>1)continue;const t=inv*(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2]);if(t>.001&&t<.999)return true;
    }return false;
}
function audit({ignoreCeiling=false}={}){
    const {f,camera:c,meshes}=makeReview(),hits={},examples=[];let samples=0,id=0,maxHeight=0;
    for(const side of [0,1])for(const targetX of [3,10,25,40,47])for(const targetZ of [-8,0,8])for(const direction of [1,-1]){
        f.course.directionAtDistance=()=>direction;id+=2;const shot={strikeId:id+side,targetDistance:targetX,targetZ,warningSeconds:1.25,revision:id};f.p.showLaunch(shot);
        Object.assign(c,{cannonSourceX:f.p.sourceX,cannonSourceY:f.p.sourceY,cannonSourceZ:f.p.sourceZ,cannonTargetX:targetX,cannonTargetZ:targetZ,cannonProjectile:f.p.projectile});
        for(let i=0;i<=20;i++){const t=i/20;f.p.projectile.setWorldPosition(f.p.sourceX+(targetX-f.p.sourceX)*t,f.p.sourceY+(.27-f.p.sourceY)*t+Math.sin(Math.PI*t)*5.8,f.p.sourceZ+(targetZ-f.p.sourceZ)*t);c.updateCannonCameraPose(t,targetX);samples++;const eye=[c.cameraPosition.x,c.cameraPosition.y,c.cameraPosition.z];maxHeight=Math.max(maxHeight,eye[1]);
            for(const [subject,target] of [['ball',[f.p.projectile.worldPosition.x,f.p.projectile.worldPosition.y,f.p.projectile.worldPosition.z]],['landing',[targetX,.20,targetZ]]])for(const mesh of meshes){if(ignoreCeiling&&mesh.ceiling)continue;if(rayHit(eye,target,mesh)){hits[mesh.name]=(hits[mesh.name]||0)+1;if(examples.length<8)examples.push({side,targetX,targetZ,direction,t,subject,eye,obstacle:mesh.name});}}
        }
    }return{samples,maxHeight,ignoreCeiling,hits,examples};
}
module.exports={makeReview,rayHit,audit};
