const fs=require('node:fs'),path=require('node:path');
const {root,inputs,outline,CANNON_OUTLINE_POLICIES}=require('./build_geometry.cjs');
const {INK,WIDTH}=require('../water-play-obstacles/build_cannon_merged.cjs');
const {fixture}=require('../../tests/helpers/water-play-harness.cjs');
const h=fixture('cannon'),source=inputs();
const merged=h.load(path.join(root,'assets/scripts/core/WaterPlayObstacleGeometry.ts')).WATER_PLAY_GEOMETRY.WaterBallCannon;
function transform(g,node){
    const positions=[],normals=[],v=new h.Vec3();
    for(let i=0;i<g.positions.length;i+=3){
        v.set(...g.positions.slice(i,i+3));h.Vec3.transformQuat(v,v,node.rotation);h.Vec3.add(v,v,node.position);positions.push(v.x,v.y,v.z);
        if(g.normals?.length){v.set(...g.normals.slice(i,i+3));h.Vec3.normalize(v,v);h.Vec3.transformQuat(v,v,node.rotation);normals.push(v.x,v.y,v.z)}
    }
    return {...g,positions,normals};
}
const frames=[];
for(const [name,distance,z,recoil]of [['默认就位',null,0,false],['远处发射',47,8,false],['近处抬头',25,-8,false],['发射回弹',40,2,true]]){
    h.p.reset();
    if(distance!==null){const shot={strikeId:0,targetDistance:distance,targetZ:z,warningSeconds:1.25,revision:1};h.p.showLaunch(shot);if(recoil)h.p.update(.05,shot,1.20,true)}
    frames.push({name,pitch:-h.p.nozzles[0].eulerAngles.x,parts:Object.keys(CANNON_OUTLINE_POLICIES).map(key=>{
        const node=h.p.models.part(0,key);
        return {base:transform(source[key],node),shell:transform(outline(source[key],CANNON_OUTLINE_POLICIES[key]),node),merged:transform(merged[key],node)};
    })});
}
h.p.dispose();
const turtle=fs.readFileSync(path.join(root,'art/turtle-bus/outline-review-template.html'),'utf8');
let renderer=turtle.slice(turtle.indexOf('const $='),turtle.indexOf("const renderers=['before'"));
// Cocos 3.8.8 builtin-unlit 的顶点色先平方再开方；不用旧预览的标准线性→sRGB转换。
renderer=renderer.replace('vec4(srgb,1.)','vec4(c.rgb,1.)');
const html=fs.readFileSync(path.join(__dirname,'cannon-review-template.html'),'utf8')
    .replace('/*__DATA__*/',JSON.stringify({frames,ink:INK,width:WIDTH})).replace('/*__RENDERER__*/',renderer);
const output=path.join(root,'.cache/cannon-merged-outline-review');fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'index.html'),html);
console.log(JSON.stringify(frames.map(f=>({name:f.name,pitch:f.pitch}))));
