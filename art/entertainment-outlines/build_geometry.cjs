// 只读正式几何与 GLTF，离线合并位置接缝并提取轮廓；不重导或改写原模型。
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const CANNON_OUTLINE_POLICIES = { CannonBase: () => true, CannonNozzle: p => p.size[2] > .03 };
function readGltf(relative) {
    const file = path.join(root, relative), bytes = fs.readFileSync(file);
    const glb = relative.endsWith('.glb');
    const g = glb ? JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12))) : JSON.parse(bytes);
    const buffers = glb ? [bytes.subarray(28+bytes.readUInt32LE(12))] : g.buffers.map(b => b.uri.startsWith('data:') ? Buffer.from(b.uri.split(',')[1],'base64') : fs.readFileSync(path.resolve(path.dirname(file),b.uri)));
    const read = id => {
        const a=g.accessors[id],view=g.bufferViews[a.bufferView],b=buffers[view.buffer];
        const [method,size,max]=({5126:['readFloatLE',4,1],5125:['readUInt32LE',4,4294967295],5123:['readUInt16LE',2,65535],5121:['readUInt8',1,255]})[a.componentType];
        const n=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16})[a.type],result=[];
        for(let i=0;i<a.count;i++)for(let j=0;j<n;j++)result.push(b[method]((view.byteOffset||0)+(a.byteOffset||0)+i*(view.byteStride||size*n)+j*size)/(a.normalized?max:1));
        return result;
    };
    return { g, read, hash:crypto.createHash('sha256').update(bytes).digest('hex') };
}
function primitiveData(asset) {
    const p=asset.g.meshes[0].primitives[0];
    const color=asset.read(p.attributes.COLOR_0),colors=[];
    if(asset.g.accessors[p.attributes.COLOR_0].type==='VEC3'){for(let i=0;i<color.length;i+=3)colors.push(...color.slice(i,i+3),1)}else colors.push(...color);
    return {positions:asset.read(p.attributes.POSITION),normals:asset.read(p.attributes.NORMAL),colors,indices:asset.read(p.indices)};
}
function components(g) {
    const positions=[],remap=[],lookup=new Map();
    for(let i=0;i<g.positions.length;i+=3){const p=g.positions.slice(i,i+3),key=p.map(v=>v.toFixed(5)).join(',');if(!lookup.has(key)){lookup.set(key,positions.length/3);positions.push(...p)}remap.push(lookup.get(key))}
    const indices=g.indices.map(i=>remap[i]),parent=remap.map((_,i)=>i).slice(0,positions.length/3);
    const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
    for(let i=0;i<indices.length;i+=3){parent[find(indices[i+1])]=find(indices[i]);parent[find(indices[i+2])]=find(indices[i])}
    const groups=new Map(),originals=new Map();for(let i=0;i<indices.length;i+=3){const key=find(indices[i]);if(!groups.has(key)){groups.set(key,[]);originals.set(key,[])}groups.get(key).push(...indices.slice(i,i+3));originals.get(key).push(...g.indices.slice(i,i+3))}
    return [...groups.entries()].map(([key,ids])=>{const points=[...new Set(ids)].map(i=>positions.slice(i*3,i*3+3));const min=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max=[0,1,2].map(k=>Math.max(...points.map(p=>p[k])));return {indices:ids,originalIndices:originals.get(key),positions,min,max,size:min.map((v,k)=>max[k]-v)}});
}
function outline(g, keep) {
    const parts=components(g),positions=[],indices=[],normals=[];
    for(const part of parts.filter(keep)) {
        const remap=new Map();for(const id of part.indices){if(!remap.has(id)){remap.set(id,positions.length/3);positions.push(...part.positions.slice(id*3,id*3+3));normals.push(0,0,0)}indices.push(remap.get(id))}
    }
    for(let i=0;i<indices.length;i+=3){const [a,b,c]=indices.slice(i,i+3),u=[0,1,2].map(k=>positions[b*3+k]-positions[a*3+k]),v=[0,1,2].map(k=>positions[c*3+k]-positions[a*3+k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];for(const id of [a,b,c])n.forEach((x,k)=>normals[id*3+k]+=x)}
    for(let i=0;i<normals.length;i+=3){const l=Math.hypot(...normals.slice(i,i+3));if(l<1e-9)throw Error('轮廓顶点法线无效');for(let k=0;k<3;k++)normals[i+k]=+((normals[i+k]/l).toFixed(6))}
    return {positions:positions.map(v=>+v.toFixed(5)),normals,indices};
}
function inputs(){
    // 水炮运行时已合并轮廓；始终读取作者原始数据，避免重复加壳。
    const water=JSON.parse(fs.readFileSync(path.join(root,'art/water-play-obstacles/geometry.json'),'utf8'));
    const soda=primitiveData(readGltf('assets/race/items/StimulantBottle.gltf'));
    const slush=primitiveData(readGltf('assets/race/items/CalmSlush.gltf'));
    const shark=primitiveData(readGltf('assets/race/models/SharkModel.glb'));
    const fallback=fs.readFileSync(path.join(root,'assets/scripts/core/SharkFallbackGeometry.ts'),'utf8');
    const sharkFallback=JSON.parse(fallback.slice(fallback.indexOf('=')+1).trim().replace(/;$/,''));
    return {CannonBase:water.WaterBallCannon.CannonBase,CannonNozzle:water.WaterBallCannon.CannonNozzle,BuoyBody:water.SprayBuoy.BuoyBody,BuoyBalloon:water.SprayBuoy.BuoyBalloon,Soda:soda,Slush:slush,Shark:shark,SharkFallback:sharkFallback};
}
function build(){
    const source=inputs(),result={},report={};
    const policies={
        ...CANNON_OUTLINE_POLICIES,
        BuoyBody:p=>Math.max(...p.size)>1,
        BuoyBalloon:p=>p.size[1]>.7 && p.size[0]>.5,
        Soda:p=>p.size[2]>.4,
        Slush:p=>Math.max(...p.size)>.45,
        SharkFallback:p=>Math.max(...p.size)>.5,
    };
    for(const [key,keep]of Object.entries(policies)){
        result[key]=outline(source[key],keep);
        report[key]={triangles:result[key].indices.length/3,components:components(source[key]).map(p=>({size:p.size.map(v=>+v.toFixed(4)),triangles:p.indices.length/3,keep:keep(p)}))};
        if(!result[key].indices.length)throw Error(key+' 没有选中轮廓');
    }
    // 蒙皮轮廓保留原顶点属性和骨骼索引，不在颜色接缝处重新平均权重。
    const asset=readGltf('assets/race/models/SharkModel.glb'),primitive=asset.g.meshes[0].primitives[0];
    const skin={positions:[],normals:[],joints:[],weights:[],indices:[]};
    const joints=asset.read(primitive.attributes.JOINTS_0),weights=asset.read(primitive.attributes.WEIGHTS_0),map=new Map();
    for(const group of components(source.Shark).filter(p=>Math.max(...p.size)>.5))for(const i of group.originalIndices){
        if(!map.has(i)){map.set(i,skin.positions.length/3);skin.positions.push(...source.Shark.positions.slice(i*3,i*3+3));skin.normals.push(...source.Shark.normals.slice(i*3,i*3+3));skin.joints.push(...joints.slice(i*4,i*4+4));skin.weights.push(...weights.slice(i*4,i*4+4))}
        skin.indices.push(map.get(i));
    }
    result.SharkSkin=skin;
    report.SharkSkin={triangles:skin.indices.length/3,sourceSha256:asset.hash,vertices:skin.positions.length/3,sourceVertices:[...map.keys()]};
    const out=path.join(root,'assets/scripts/core/EntertainmentOutlineGeometry.ts');
    // 水炮已烘入 WaterPlayObstacleGeometry，运行时不再重复携带独立壳数据。
    const {CannonBase,CannonNozzle,...runtime}=result;
    fs.writeFileSync(out,'// 由 art/entertainment-outlines/build_geometry.cjs 从正式资产离线生成。\nexport const ENTERTAINMENT_OUTLINE_GEOMETRY = '+JSON.stringify(runtime)+';\n');
    fs.writeFileSync(path.join(__dirname,'geometry-audit.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));return result;
}
module.exports={root,readGltf,primitiveData,components,outline,inputs,build,CANNON_OUTLINE_POLICIES};
if(require.main===module)build();
