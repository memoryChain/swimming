// GLB、PNG、资源身份与源文件同一性审计；不把元数据通过视为引擎画面通过。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function png(file){const b=fs.readFileSync(file),width=b.readUInt32BE(16),height=b.readUInt32BE(20),depth=b[24],type=b[25];if(depth!==8||type!==6)throw Error('图标必须为 8 位 RGBA');let offset=8,data=[];
 while(offset<b.length){const n=b.readUInt32BE(offset),t=b.toString('ascii',offset+4,offset+8);if(t==='IDAT')data.push(b.subarray(offset+8,offset+8+n));offset+=12+n;}
 const raw=zlib.inflateSync(Buffer.concat(data)),stride=width*4,rows=[];let min=255,max=0,borderMax=0,bounds=[width,height,-1,-1];
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
 for(let y=0;y<height;y++){const row=Buffer.alloc(stride),filter=raw[y*(stride+1)],prior=rows[y-1];for(let x=0;x<stride;x++){const a=x>=4?row[x-4]:0,b=prior?.[x]||0,c=x>=4?prior?.[x-4]||0:0;row[x]=(raw[y*(stride+1)+x+1]+(filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):0))&255;}
 rows.push(row);for(let x=0;x<width;x++){const a=row[x*4+3];min=Math.min(min,a);max=Math.max(max,a);if(x===0||y===0||x===width-1||y===height-1)borderMax=Math.max(borderMax,a);if(a>5){bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y)}}}
 if(min!==0||max!==255||borderMax!==0)throw Error('透明边界或主体 alpha 异常');return{width,height,depth,type,alpha:[min,max],borderMax,bounds,bytes:b.length};}
const audit={date:'2026-09-22',models:{},icons:{},sourceRuntimeEquality:{},codeBytes:fs.statSync(path.join(root,'assets/scripts/core/WaterPlayObstacleGeometry.ts')).size,engineVisual:'待验',devices:'待验'};
for(const name of ['WaterBallCannon','SprayBuoy','CannonWaterBall']){
 const b=fs.readFileSync(path.join(__dirname,name+'.glb')),runtime=path.join(root,'assets/race/items',name+'.glb'),g=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
 if(!b.equals(fs.readFileSync(runtime)))throw Error('GLB 副本不一致');const meta=fs.existsSync(runtime+'.meta')?JSON.parse(fs.readFileSync(runtime+'.meta','utf8')):{imported:false,importer:'待 Creator 导入',subMetas:{},uuid:null};
 audit.models[name]={bytes:b.length,sha256:hash(b),meshes:g.meshes.length,materials:g.materials.length,textures:g.textures?.length||0,triangles:g.meshes.reduce((n,m)=>n+m.primitives.reduce((n,p)=>n+g.accessors[p.indices].count/3,0),0),nodes:g.nodes.map(n=>n.name),imported:meta.imported,importer:meta.importer,subResources:Object.keys(meta.subMetas).length,uuid:meta.uuid};
 audit.sourceRuntimeEquality[name]=true;
}
for(const name of ['cannon','mine']){
 const p='assets/race/ui/entertainment-banner-v1/icon-'+name+'.png',file=path.join(root,p),meta=JSON.parse(fs.readFileSync(file+'.meta','utf8'));
 const prior=cp.spawnSync('git',['show','HEAD:'+p+'.meta'],{cwd:root,encoding:'utf8'});if(prior.status!==0)throw Error('找不到旧图标身份');const old=JSON.parse(prior.stdout);if(old.uuid!==meta.uuid)throw Error('图标 UUID 改变');
 const oldPng=cp.spawnSync('git',['show','HEAD:'+p],{cwd:root,maxBuffer:10e6}).stdout;
 audit.icons[name]={...png(file),uuid:meta.uuid,uuidPreserved:true,byteDelta:fs.statSync(file).size-oldPng.length,sourceMatches:fs.readFileSync(file).equals(fs.readFileSync(path.join(root,'art/ui/entertainment-banner-v1/icon-'+name+'-generated-source.png')))};
}
audit.rawAssetByteDelta=Object.values(audit.models).reduce((n,x)=>n+x.bytes,0)+Object.values(audit.icons).reduce((n,x)=>n+x.byteDelta,0);
const soundPath=path.join(root,'assets/music/sfx/buoy_balloon_pop.wav');
const sound=fs.readFileSync(soundPath),soundMeta=JSON.parse(fs.readFileSync(soundPath+'.meta','utf8'));
if(!sound.equals(fs.readFileSync(path.join(__dirname,'buoy_balloon_pop.wav')))||sound.length>=16384)throw Error('短音来源副本或包体不符合预算');
audit.sound={...JSON.parse(fs.readFileSync(path.join(__dirname,'sound-audit.json'),'utf8')),uuid:soundMeta.uuid,imported:soundMeta.imported,sha256:hash(sound),sourceMatches:true};
audit.rawAssetByteDelta+=sound.length;
audit.note='原始文件字节变化不等于微信构建包体；GLB 无内嵌纹理，纹理策略扫描数量可保持不变。';
fs.writeFileSync(path.join(__dirname,'delivery-audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit,null,2));
