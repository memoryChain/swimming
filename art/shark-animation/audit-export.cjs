// 审计实际 GLB 数据和 PNG，不把作者说明或引擎元数据当作文件内容。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'../..'),runtime=path.join(root,'assets/race/models/SharkModel.glb');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function glb(file){const b=fs.readFileSync(file),len=b.readUInt32LE(12),g=JSON.parse(b.subarray(20,20+len)),bin=b.subarray(28+len);
function read(index){const a=g.accessors[index],v=g.bufferViews[a.bufferView],dim={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],bytes={5121:1,5123:2,5125:4,5126:4}[a.componentType],method={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType],out=[];
for(let i=0;i<a.count;i++)for(let k=0;k<dim;k++)out.push(bin[method]((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||dim*bytes)+k*bytes)/(a.normalized?(a.componentType===5123?65535:255):1));return out;}
return {b,g,read};}
function png(file){const b=fs.readFileSync(file),w=b.readUInt32BE(16),h=b.readUInt32BE(20);assert.equal(b[24],8);assert.equal(b[25],6);assert.equal(b[28],0);let at=8,parts=[];
while(at<b.length){let n=b.readUInt32BE(at),tag=b.toString('ascii',at+4,at+8);if(tag==='IDAT')parts.push(b.subarray(at+8,at+8+n));at+=n+12;}
const raw=zlib.inflateSync(Buffer.concat(parts)),pixels=Buffer.alloc(w*h*4),stride=w*4;let offset=0,min=255,max=0,occupied=0,bounds=[w,h,-1,-1];
for(let y=0;y<h;y++){const filter=raw[offset++];for(let x=0;x<stride;x++){let i=y*stride+x,a=x>=4?pixels[i-4]:0,c=y?pixels[i-stride]:0,d=y&&x>=4?pixels[i-stride-4]:0,p=a+c-d,pa=Math.abs(p-a),pb=Math.abs(p-c),pc=Math.abs(p-d);pixels[i]=(raw[offset++]+[0,a,c,Math.floor((a+c)/2),pa<=pb&&pa<=pc?a:pb<=pc?c:d][filter])&255;}
for(let x=0;x<w;x++){const alpha=pixels[(y*w+x)*4+3];min=Math.min(min,alpha);max=Math.max(max,alpha);if(alpha){occupied++;bounds=[Math.min(bounds[0],x),Math.min(bounds[1],y),Math.max(bounds[2],x),Math.max(bounds[3],y)];}}}
assert.equal(min,0);assert.equal(max,255);for(const i of [0,w-1,w*(h-1),w*h-1])assert.equal(pixels[i*4+3],0);
return {width:w,height:h,alpha_min:min,alpha_max:max,occupied_pixels:occupied,bounds,sha256:sha(b)};}
const old=glb(path.join(__dirname,'archive/SharkModel_pre_D.glb')),current=glb(runtime),{g,read}=current;
assert.equal(g.meshes.length,1);assert.equal(g.meshes[0].primitives.length,1);assert.equal(g.materials.length,1);assert.equal(g.images?.length??0,0);assert.equal(g.skins[0].joints.length,7);
const oldNames=old.g.skins[0].joints.map(i=>old.g.nodes[i].name),names=g.skins[0].joints.map(i=>g.nodes[i].name);
assert.deepEqual([...names].sort(),[...oldNames].sort());
const oldMatrices=old.read(old.g.skins[0].inverseBindMatrices),matrices=read(g.skins[0].inverseBindMatrices);let restDelta=0;
for(let j=0;j<names.length;j++)for(let k=0;k<16;k++)restDelta=Math.max(restDelta,Math.abs(matrices[j*16+k]-oldMatrices[oldNames.indexOf(names[j])*16+k]));
assert.ok(restDelta<1e-5,`原骨架绑定矩阵偏差 ${restDelta}`);
const p=g.meshes[0].primitives[0],weights=read(p.attributes.WEIGHTS_0),joints=read(p.attributes.JOINTS_0),jaw=names.indexOf('Shark_Jaw');assert.ok(jaw>=0);
let jawWeights=0;for(let i=0;i<weights.length;i++)if(joints[i]===jaw&&weights[i]>0)jawWeights++;assert.equal(jawWeights,0);
const animations=g.animations.map(a=>{const times=a.samplers.flatMap(s=>read(s.input));const min=Math.min(...times),max=Math.max(...times);assert.ok(min>=0&&min<1e-7);
let endpointDelta=0;for(const s of a.samplers){const values=read(s.output),dim={VEC3:3,VEC4:4}[g.accessors[s.output].type],cubic=s.interpolation==='CUBICSPLINE',first=cubic?dim:0,last=values.length-(cubic?2:1)*dim;for(let i=0;i<dim;i++)endpointDelta=Math.max(endpointDelta,Math.abs(values[first+i]-values[last+i]));}
return {name:a.name,start:min,duration:max,channel_endpoint_max_delta:endpointDelta};});
const meta=JSON.parse(fs.readFileSync(runtime+'.meta','utf8')),baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'baseline-meta-hashes.json'),'utf8').replace(/^\uFEFF/,''));
for(const entry of baseline)entry.Path=entry.Path.replace(/^.*?[\\/]assets[\\/]/,'assets/').replaceAll('\\','/');fs.writeFileSync(path.join(__dirname,'baseline-meta-hashes.json'),JSON.stringify(baseline,null,2)+'\n');
assert.equal(meta.uuid,'80c3b97c-f7a8-4d0a-8ba3-217482a1c8a0');const iconMeta=fs.readFileSync(path.join(root,'assets/race/ui/entertainment-banner-v1/icon-shark.png.meta'));
assert.equal(sha(iconMeta).toUpperCase(),baseline.find(x=>x.Path.endsWith('icon-shark.png.meta')).Hash);
const report={runtime:'assets/race/models/SharkModel.glb',bytes:current.b.length,previous_bytes:old.b.length,sha256:sha(current.b),uuid:meta.uuid,
meshes:g.meshes.length,materials:g.materials.length,textures:g.images?.length??0,triangles:read(p.indices).length/3,exported_vertices:g.accessors[p.attributes.POSITION].count,
bones:names,inverse_bind_max_delta:restDelta,jaw_weight_entries:jawWeights,animations,
runtime_icon:png(path.join(root,'assets/race/ui/entertainment-banner-v1/icon-shark.png')),
source_icon:png(path.join(root,'art/ui/entertainment-banner-v1/icon-shark-generated-source.png')),
creator_meta:{imported:meta.imported,mesh_triangles:Object.values(meta.subMetas??{}).filter(x=>x.importer==='gltf-mesh').reduce((n,x)=>n+(x.userData?.triangleCount??0),0),
matches_current_geometry:Object.values(meta.subMetas??{}).filter(x=>x.importer==='gltf-mesh').reduce((n,x)=>n+(x.userData?.triangleCount??0),0)===read(p.indices).length/3,
animation_names:(meta.userData.animationImportSettings??[]).map(x=>x.name),note:'仅元数据观察；若网格数量不匹配，表示最后改形尚待重导入，不是引擎画面或真机验证'}};
fs.copyFileSync(runtime,path.join(__dirname,'SharkModel_preview.glb'));fs.writeFileSync(path.join(__dirname,'export-audit.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
