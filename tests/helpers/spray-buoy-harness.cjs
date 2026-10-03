const fs=require('node:fs'),path=require('node:path');
const {createFixedMeshHarness}=require('./fixed-mesh-harness.cjs');
const {readGlbGeometry}=require('./glb-geometry.cjs');
const {createAiHarness}=require('./ai-race-harness.cjs');
function createBuoyHarness(seed=42,distance=200,ids=['cartonSwimmer6','cartonSwimmer5'],mode='spray-buoy'){
    const prefabs=new Map(),requests=[],layers=new Set();let loadOverride;
    const h=createFixedMeshHarness({'../core/RaceBundleLoader':{loadRaceAsset(p,t,cb){requests.push(p);if(loadOverride)loadOverride(p,t,cb);else cb(null,prefabs.get(p));}}});
    Object.defineProperty(h.Node.prototype, 'worldPosition', { get(){return this.getWorldPosition(new h.Vec3());} });
    // 解析真正交付的两个可动网格，保留气球转轴与父子变换。
    function readPrefab(name){
        const file=path.join(path.resolve(__dirname,'../..'),'assets/race/items',name+'.glb'),bytes=fs.readFileSync(file),size=bytes.readUInt32LE(12);
        const doc=JSON.parse(bytes.subarray(20,20+size)),raw=bytes.subarray(28+size);
        function accessor(index){const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],count={SCALAR:1,VEC3:3,VEC4:4}[a.type],size={5126:4,5123:2,5121:1}[a.componentType],out=[];
            for(let i=0;i<a.count;i++)for(let j=0;j<count;j++){const at=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*count)+j*size;
                const n=raw[a.componentType===5126?'readFloatLE':a.componentType===5123?'readUInt16LE':'readUInt8'](at);out.push(a.normalized?n/(a.componentType===5123?65535:255):n);}return out;}
        const nodes=doc.nodes.map(n=>({name:n.name,isValid:true,position:new h.Vec3(...(n.translation||[0,0,0])),rotation:new h.Quat(...(n.rotation||[0,0,0,1])),scale:new h.Vec3(...(n.scale||[1,1,1])),children:[],components:[]}));
        doc.nodes.forEach((n,i)=>{if(n.mesh!==undefined){const p=doc.meshes[n.mesh].primitives[0],mesh=new h.cc.Mesh({positions:accessor(p.attributes.POSITION),colors:accessor(p.attributes.COLOR_0),indices:accessor(p.indices)});nodes[i].components.push({mesh});}
            for(const child of n.children||[])nodes[i].children.push(nodes[child]);});
        const roots=doc.scenes[doc.scene||0].nodes;const root=nodes[roots[0]];
        root.getComponentsInChildren=function(){const all=[];function visit(n){all.push(...n.components);for(const c of n.children)visit(c);}visit(root);return all;};return {data:root};
    }
    const paths=h.loadModule('core/ResourcePaths').RESOURCE_PATHS;
    for(const p of Object.values(paths.sprayBuoy))prefabs.set(p,readPrefab(p.split('/').pop()));
    if(mode==='cannon')for(const p of Object.values(paths.cannon))prefabs.set(p,readPrefab(p.split('/').pop()));
    prefabs.set(paths.venueHeightShadeEffect,{});
    const a=createAiHarness();a.load('core/GameBalance').setSoloRaceDistance(distance);a.load('core/GameBalance').setRaceDifficulty('competitive');
    const {laneCenterZ}=a.load('venue/LaneLayout');
    const course=new (a.load('venue/RaceCourseLayout').RaceCourseLayout)(a.load('venue/VenueConfig').DEFAULT_POOL_DEFINITION);
    const actors=ids.map((id,index)=>a.create(id,5,.7,0,laneCenterZ(index,course)));
    // 浮圈父节点使用有完整生命周期的 Node，但身体与 Motor 使用真实实现。
    for(const actor of actors){const old=actor.body.node;actor.body.node=new h.Node('Swimmer');actor.body.node.setPosition(old.position);actor.body.node.emit=()=>{};}
    const racers=actors.map((f,lane)=>({lane,swimmer:f.body,condition:f.condition,ai:f.ai}));
    const runtime=new (h.loadModule('app/EntertainmentRaceRuntime').EntertainmentRaceRuntime)(h.root,actors[0].body.courseLayout,mode,seed,distance,racers,{registerFloatingObject(n){layers.add(n);return()=>layers.delete(n);}});
    const state=a.load('core/GameConstants').GameState;
    return {...h,actors,racers,runtime,state,paths,requests,prefabs,layers,setLoadOverride:f=>loadOverride=f,
        liveBudget:()=>({nodes:h.nodes.filter(n=>n.isValid).length,materials:h.materials.filter(n=>!n.destroyCount).length,renderers:h.nodes.filter(n=>n.isValid&&n.components.length).length})};
}
module.exports={createBuoyHarness};
