// 从真实池采样网格与20Hz变换，生成可离线打开的独立审查页。
// 运行：npx --yes --package typescript@5.4.5 -c "node art/water-splash-b2/build-review.cjs"
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createSplashHarness}=require('../../tests/helpers/water-splash-harness.cjs');
const root=path.resolve(__dirname,'../..'),runtime='assets/scripts/core/EntertainmentWaterSplash.ts';
const before=fs.readFileSync(path.join(__dirname,'baseline-water-splash.ts.txt'),'utf8');
const after=fs.readFileSync(path.join(root,runtime),'utf8'),data={};
const cameraSource=fs.readFileSync(path.join(root,'assets/scripts/camera/RaceEventPictureInPictureCamera.ts'),'utf8');
const pipHeight=Number(cameraSource.match(/timedBombBlastPosition\.x - this\.options\.course\.direction \* 2\.8,[\s\S]*?waterY \+ ([\d.]+)/)?.[1]);
if(!Number.isFinite(pipHeight))throw new Error('无法确认现有结算画中画高度');
data.pipCamera={eye:[-2.8,pipHeight,3.8],target:[0,.08,0],fov:56};
const configs=[['定时水球','timed-bomb',1.25],['水球炮落点','cannon',1.08],['喷水浮标','minefield',1]];
for(const [key,source] of [['before',before],['after',after]]){
    const h=createSplashHarness(source),sequences={};
    for(const [label,owner,intensity] of configs)for(const height of [-.8,.15,1.8]){
        h.pool.reset();h.pool.play({owner,profile:'explosion',position:new h.Vec3(0,.035,0),
            explosionCorePosition:owner==='cannon'?undefined:new h.Vec3(0,height,0),intensity,yawDegrees:53,duration:.95});
        const frames=[h.snapshot()];for(let i=0;i<26;i++){h.pool.update(.05);frames.push(h.snapshot());}
        sequences[owner+':'+height]=frames;
    }
    // 轻、重与纯波纹用于快速对照，仍直接采样正式代码。
    for(const profile of ['light-entry','heavy-entry','ripple-only']){
        h.pool.reset();h.pool.play({owner:'litter',profile:profile==='ripple-only'?'heavy-entry':profile,
            position:new h.Vec3(0,.035,0),rippleOnly:profile==='ripple-only'});
        const frames=[h.snapshot()];for(let i=0;i<26;i++){h.pool.update(.05);frames.push(h.snapshot());}sequences[profile]=frames;
    }
    data[key]={meshes:h.meshes.map(m=>m.geometry),sequences,budget:h.budget(),sha256:crypto.createHash('sha256').update(source).digest('hex')};
}
// B1真实蒙皮姿态与浮圈仅作固定遮挡参照，不伪装成完整比赛或受击动画。
const referenceFile=path.join(root,'.cache/recovery-float-review.json');
const referenceSource=path.join(__dirname,'recovery-reference.json');
if(fs.existsSync(referenceFile)){
    const row=JSON.parse(fs.readFileSync(referenceFile,'utf8'))[0];
    const vertices=[],indices=[];
    for(const mesh of row.meshes){const offset=vertices.length/3;for(const [x,z,y]of mesh.vertices)vertices.push(x,y,-z);for(const i of mesh.indices)indices.push(i+offset);}
    fs.writeFileSync(referenceSource,JSON.stringify({positions:vertices,indices,ring:row.ring,file:row.file}));
}
if(!fs.existsSync(referenceSource))throw new Error('请先执行 scripts/export-recovery-float-review.cjs 导出 B1 遮挡参照');
data.reference=JSON.parse(fs.readFileSync(referenceSource,'utf8'));
const ringBytes=fs.readFileSync(path.join(root,'assets/race/items/RecoveryFloatRing.glb'));
const jsonSize=ringBytes.readUInt32LE(12),gltf=JSON.parse(ringBytes.subarray(20,20+jsonSize)),bin=ringBytes.subarray(28+jsonSize);
function read(index){const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView],dim={SCALAR:1,VEC3:3,VEC4:4}[a.type],bytes={5126:4,5123:2,5125:4}[a.componentType],method={5126:'readFloatLE',5123:'readUInt16LE',5125:'readUInt32LE'}[a.componentType];
    const divisor=a.normalized?(a.componentType===5123?65535:255):1;
    const out=[];for(let i=0;i<a.count;i++)for(let k=0;k<dim;k++)out.push(bin[method]((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||dim*bytes)+k*bytes)/divisor);return out;}
const primitive=gltf.meshes[0].primitives[0],ringColors=read(primitive.attributes.COLOR_0);
const rgba=gltf.accessors[primitive.attributes.COLOR_0].type==='VEC3'?ringColors.flatMap((c,i)=>i%3===2?[c,1]:[c]):ringColors;
data.ring={positions:read(primitive.attributes.POSITION),colors:rgba,indices:read(primitive.indices)};
// 记录静态成本及源文件摘要；不将替身计数称作真机性能。
const audit={generated:new Date().toISOString(),before:data.before.budget,after:data.after.budget,beforeSha256:data.before.sha256,afterSha256:data.after.sha256,
    explosionTriangles:{before:580,after:560},capacity:{light:4,heavy:3,impact:3},note:'离线真实几何与池行为采样，未包含引擎渲染和真机帧耗'};
fs.writeFileSync(path.join(__dirname,'audit.json'),JSON.stringify(audit,null,2)+'\n');
const template=fs.readFileSync(path.join(__dirname,'review-template.html'),'utf8');
fs.writeFileSync(path.join(__dirname,'review.html'),template.replace('/*__DATA__*/',JSON.stringify(data)));
console.log('已生成自包含喷水审查页及预算记录。');
