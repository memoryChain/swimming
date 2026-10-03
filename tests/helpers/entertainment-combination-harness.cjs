const path=require('node:path');
const {createFixedMeshHarness}=require('./fixed-mesh-harness.cjs');
const {readGlbGeometry}=require('./glb-geometry.cjs');
const {createAiHarness}=require('./ai-race-harness.cjs');
function createCombinationHarness(seed=42,distance=200,characterIds=['cartonSwimmer6']) {
    const prefabs=new Map(),requests=[],layers=new Set();let loadOverride=null;
    const h=createFixedMeshHarness({'../core/RaceBundleLoader':{loadRaceAsset(assetPath,type,done){
        requests.push(assetPath);
        if(loadOverride)loadOverride(assetPath,type,done);
        else done(null,prefabs.get(assetPath));
    }}});
    const paths=h.loadModule('core/ResourcePaths').RESOURCE_PATHS;
    for(const group of ['entertainmentDebris','entertainmentSupplies','giantWave','geyser'])for(const assetPath of Object.values(paths[group])){
        const mesh=new h.cc.Mesh(readGlbGeometry(path.join(path.resolve(__dirname,'../..'),'assets/race/items',assetPath.split('/').pop()+'.glb')).geometry);
        const data={name:assetPath,isValid:true,position:new h.Vec3(),rotation:new h.Quat(),scale:new h.Vec3(1,1,1),children:[],getComponentsInChildren(){return[{mesh}];}};
        prefabs.set(assetPath,{data});
    }
    prefabs.set(paths.venueHeightShadeEffect,{});prefabs.set(paths.whirlpoolFunnelEffect,{});
    const a=createAiHarness();a.load('core/GameBalance').setRaceDifficulty('competitive');a.load('core/GameBalance').setSoloRaceDistance(distance);
    const actors=characterIds.map((id,index)=>a.create(id,5,.7,0,-10.5+index*3));
    const racers=actors.map((f,lane)=>({lane,swimmer:f.body,condition:f.condition,ai:f.ai}));
    const runtime=new (h.loadModule('app/EntertainmentRaceRuntime').EntertainmentRaceRuntime)(h.root,actors[0].body.courseLayout,'light-mix',seed,distance,racers,{registerFloatingObject(node){
        layers.add(node);return()=>layers.delete(node);
    }});
    const state=a.load('core/GameConstants').GameState;
    return{...h,actors,runtime,state,paths,requests,prefabs,layers,setLoadOverride(value){loadOverride=value;},
        liveBudget(){return{nodes:h.nodes.filter(n=>n.isValid).length,materials:h.materials.filter(m=>!m.destroyCount).length,renderers:h.nodes.filter(n=>n.isValid&&n.components.length).length};}};
}
module.exports={createCombinationHarness};
