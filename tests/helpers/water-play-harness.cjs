// 真实表现类、真实 Cocos 数学与固定几何；替换 GPU 组件与资源完成时机。
const {createHarness}=require('./cocos-math-harness.cjs');
const path=require('node:path');
const fs=require('node:fs');
function fixture(kind='buoy', count=2) {
    const pending=[],splashes=[],nodes=[],meshes=[],materials=[];
    const loader={loadSwimmerPrefab:(cb,candidates)=>pending.push({cb,candidates}),setLayerRecursive:()=>{},findNode:(n,name)=>n.name===name?n:n.children.map(c=>loader.findNode(c,name)).find(Boolean)||null};
    const core={};
    const h=createHarness({'../core':core,'../character/CharacterModelLoader':loader,'./EntertainmentWaterSplash':{
        ENTERTAINMENT_SPLASH_OWNER:{CANNON:'cannon',MINEFIELD:'minefield'},
        ENTERTAINMENT_SPLASH_PROFILE:{EXPLOSION:'explosion',HEAVY_ENTRY:'heavy-entry'},
    }});
    core.Vec3=h.Vec3;
    const config=JSON.parse(fs.readFileSync(path.join(h.root,'temp/tsconfig.cocos.json'),'utf8'));
    const engine=process.env.COCOS_ENGINE_ROOT||path.resolve(config.compilerOptions.paths['db://internal/*'][0],'../../..');
    const sphere=h.load(path.join(engine,'cocos/primitive/sphere.ts')).default;
    class Node extends h.Node {
        _active=true;components=[];layer=1;
        constructor(name=''){super();this.name=name;nodes.push(this);}
        get active(){return this._active}set active(v){this._active=v;this.writes++}
        get worldPosition(){return this.getWorldPosition(new h.Vec3())}
        setParent(p){this.parent=p;if(p)p.children.push(this)}
        addComponent(C){const c=new C();this.components.push(c);return c}
        getComponent(C){return this.components.find(c=>c instanceof C)||null}
        setPosition(x,y,z){super.setPosition(x,y,z);this.writes++}
        setScale(x,y,z){super.setScale(x,y,z);this.writes++}
        setWorldPosition(x,y,z){super.setWorldPosition(typeof x==='number'?new h.Vec3(x,y,z):x);this.writes++}
        destroy(){this.isValid=false;this.children.forEach(n=>n.destroy())}
    }
    class Material{constructor(){materials.push(this)}initialize(){}setProperty(){}destroy(){this.destroyed=true}}
    class MeshRenderer{setMaterial(m){this.material=m}}
    class Color{constructor(r,g,b,a){Object.assign(this,{r,g,b,a})}static WHITE=new Color(255,255,255,255)}
    Object.assign(h.cc,{Node,Material,MeshRenderer,Color,gfx:{CullMode:{NONE:0}},
        utils:{createMesh:g=>{const mesh={geometry:g,destroy(){this.destroyed=true}};meshes.push(mesh);return mesh}},
        primitives:{sphere},
        instantiate:prefab=>{const imported=new Node('imported');for(const name of prefab.waterBall?['WaterBallSurface']:kind==='buoy'?['BuoyBody','BuoyBalloon']:['CannonBase','CannonNozzle']){const n=new Node(name);n.setParent(imported);n.addComponent(MeshRenderer).mesh={imported:true,name}}return imported},
    });
    const world=new Node('world');
    const course={waterY:0,poolWidth:20,startX:0,finishX:50,direction:1,distanceToWorldX:x=>x,directionAtDistance:()=>1,swimPosition:(x,z)=>({x,z})};
    const pool={play:r=>splashes.push({...r,position:{...r.position},explosionCorePosition:r.explosionCorePosition?{...r.explosionCorePosition}:undefined}),cancelOwner:()=>{}};
    const type=kind==='buoy'?'MinefieldBrawlPresentation':'CannonBrawlPresentation';
    const C=h.load(path.join(h.root,'assets/scripts/core/'+type+'.ts'))[type];
    const p=kind==='buoy'?new C(world,course,count,pool):new C(world,course,pool,true);
    const states=Array.from({length:count},(_,id)=>({id,generation:0,active:true,armed:true,courseX:10+id*10,lateral:id*3}));
    return {...h,Node,p,world,course,pool,states,nodes,meshes,materials,pending,splashes,
        ready:(error=null)=>{const request=pending.shift();request.cb(error,error?null:{prefab:{waterBall:request.candidates[0].includes('CannonWaterBall')}})},
        snapshot:()=>nodes.filter(n=>n.isValid&&n.active&&n.components.length&&active(n)).map(n=>({name:n.name,geometry:n.components[0].mesh.geometry,matrix:Array.from(h.Mat4.toArray([],n.worldMatrix))})),
    };
    function active(n){return !n.parent||(n.parent.active&&active(n.parent))}
}
module.exports={fixture};
