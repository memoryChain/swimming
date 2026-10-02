const fs=require('node:fs'),path=require('node:path');
const {root,inputs,outline:makeOutline,CANNON_OUTLINE_POLICIES}=require('./build_geometry.cjs');
const {createHarness}=require('../../tests/helpers/cocos-math-harness.cjs');
const h=createHarness({'../character/CharacterModelLoader':{}});
const {ENTERTAINMENT_OUTLINE_GEOMETRY:outline}=h.load(path.join(root,'assets/scripts/core/EntertainmentOutlineGeometry.ts'));
const {WATER_CANNON_PIVOT:pivot,WATER_CANNON_REST_PITCH:pitch,SPRAY_BUOY_TETHER_ANCHOR:anchor}=h.load(path.join(root,'assets/scripts/core/WaterPlayObstacleModel.ts'));
const source=inputs();
for(const [key,keep]of Object.entries(CANNON_OUTLINE_POLICIES))outline[key]=makeOutline(source[key],keep);
const pickupScale=Number(fs.readFileSync(path.join(root,'assets/scripts/core/StimulantBrawlController.ts'),'utf8').match(/const ITEM_MODEL_SCALE = ([\d.]+)/)[1]);
function transformed(g,translation=[0,0,0],rotation=[0,0,0],scale=1){
    const q=h.Quat.fromEuler(new h.Quat(),...rotation),v=new h.Vec3(),positions=[],normals=[];
    for(let i=0;i<g.positions.length;i+=3){v.set(...g.positions.slice(i,i+3));h.Vec3.transformQuat(v,v,q);positions.push(v.x*scale+translation[0],v.y*scale+translation[1],v.z*scale+translation[2]);if(g.normals?.length){v.set(...g.normals.slice(i,i+3));h.Vec3.transformQuat(v,v,q);normals.push(v.x,v.y,v.z)}}
    return {...g,positions,normals};
}
const part=(key,translation,rotation,scale)=>({base:transformed(source[key],translation,rotation,scale),shell:transformed(key==='Shark'?outline.SharkSkin:outline[key],translation,rotation,scale)});
const data=[
    {name:'岸边水炮',note:'底座、支座与炮管增加细轮廓，喷口内部不额外描边。',width:.003,draws:2,parts:[part('CannonBase'),part('CannonNozzle',[pivot.x,pivot.y,pivot.z],[-pitch,0,0])]},
    {name:'警示气球浮标',note:'只描气球外缘和浮盘轮廓，系带、警示图案及细小扣座不加黑线。',width:.003,draws:2,parts:[part('BuoyBody'),part('BuoyBalloon',[anchor.x,anchor.y,anchor.z])]},
    {name:'玩具鲨',note:'只描身体和鱼鳍，天线、螺旋桨、眼睛和接缝不额外描边。游戏中共用原骨架；此页为静态姿态。',width:.003,draws:1,parts:[part('Shark',[0,0,0],[0,90,0],1.5)]},
    {name:'心跳苏打',note:'只强化瓶身、瓶颈和瓶盖，能量核心与闪电不增加描边。',width:.002*pickupScale,draws:1,parts:[part('Soda',[0,0,0],[0,0,0],pickupScale)]},
    {name:'冷静冰沙',note:'只强化杯体与上盖，吸管和雪花标志保持原样。',width:.002*pickupScale,draws:1,parts:[part('Slush',[0,0,0],[0,0,0],pickupScale)]},
];
for(const m of data){const positions=m.parts.flatMap(p=>p.base.positions),min=[0,1,2].map(k=>Math.min(...positions.filter((_,i)=>i%3===k))),max=[0,1,2].map(k=>Math.max(...positions.filter((_,i)=>i%3===k)));m.center=min.map((v,k)=>(v+max[k])/2);m.size=Math.max(...min.map((v,k)=>max[k]-v));m.triangles=m.parts.reduce((s,p)=>s+p.shell.indices.length/3,0)}
// 两份对照页复用同一离线背面外扩渲染器，避免新旧页使用不同的线条算法。
const turtle=fs.readFileSync(path.join(root,'art/turtle-bus/outline-review-template.html'),'utf8');
const renderer=turtle.slice(turtle.indexOf('const $='),turtle.indexOf("const renderers=['before'"));
const template=fs.readFileSync(path.join(__dirname,'review-template.html'),'utf8');
const output=path.join(root,'.cache/entertainment-outline-review');fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'index.html'),template.replace('/*__DATA__*/',JSON.stringify(data)).replace('/*__RENDERER__*/',renderer));
console.log(JSON.stringify(data.map(m=>({name:m.name,extraDraws:m.draws,extraTriangles:m.triangles}))));
