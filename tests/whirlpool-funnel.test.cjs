const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

function fixture() {
    const pending = [], meshes = [], materials = [];
    const h = createHarness({ './RaceBundleLoader': { loadRaceAsset: (p, type, cb) => pending.push(cb) } });
    class Node extends h.Node {
        active = true; layer = 1; components = [];
        constructor(name = '') { super(); this.name = name; }
        setParent(parent) { this.parent = parent; parent.children.push(this); }
        setWorldPosition(x,y,z) { super.setWorldPosition(new h.Vec3(x,y,z)); }
        addComponent(Type) { const c = new Type(); this.components.push(c); return c; }
        getComponent(Type) { return this.components.find(c => c instanceof Type); }
        destroy() { this.isValid = false; this.children.forEach(c => c.destroy()); }
    }
    class Material {
        isValid = true; props = {}; writes = 0;
        constructor() { materials.push(this); }
        initialize(options) { this.options = options; }
        copy(source) { this.options = source.options; }
        setProperty(key, value) {
            this.writes++;
            this.props[key] = Array.isArray(value) ? value.map(v => ({...v})) : {...value};
        }
        destroy() { this.isValid = false; }
    }
    class MeshRenderer { setMaterial(material) { this.material = material; } }
    class Color {
        constructor(r=0,g=0,b=0,a=255) { Object.assign(this,{r,g,b,a}); }
        clone() { return new Color(this.r,this.g,this.b,this.a); }
        static WHITE = new Color(255,255,255);
    }
    Object.assign(h.cc, {Node, Material, MeshRenderer, Color, EffectAsset: class {}, gfx:{CullMode:{NONE:0}},
        utils:{createMesh:geometry=>{const m={geometry,destroy(){this.destroyed=true}};meshes.push(m);return m}}});
    const load = name => h.load(path.join(h.root, 'assets/scripts', name + '.ts'));
    const controller = load('core/WhirlpoolBrawlController');
    const geometry = load('core/WhirlpoolFunnelGeometry');
    const world = new Node('world');
    const course={waterY:0.055,poolWidth:20,directionAtDistance:()=>-1,swimPosition:(distance,z)=>({x:50-distance,z})};
    const spawns=[{id:0,distance:30,centerFraction:-0.12,spin:1,variant:'normal',radiusScale:0.7},
        {id:1,distance:33,centerFraction:0.12,spin:-1,variant:'super'}];
    const resources=controller.createWhirlpoolVisualResources();
    const c = new controller.WhirlpoolBrawlController(world,course,12,()=>{},spawns,resources);
    return {h,controller,geometry,world,resources,c,pending,meshes,materials,spawns};
}

test('开放水带几何有效、无高浪且面数受控',()=>{
    const f=fixture();
    for(const superVariant of [false,true]) {
        const g=f.geometry.buildWhirlpoolFunnelGeometry(superVariant?2.016:1.344,superVariant);
        assert.equal(g.indices.length/3,superVariant?812:588);
        assert.equal(g.positions.length,g.normals.length);
        assert.equal(g.uvs.length,g.positions.length/3*2);
        assert.equal(g.colors.length,g.positions.length/3*4);
        for(let i=0;i<g.positions.length;i+=3){
            const [x,y,z]=g.positions.slice(i,i+3);
            assert.ok([x,y,z].every(Number.isFinite));
            assert.ok(y>=g.minY && y<=g.maxY && Math.hypot(x,z)<=g.radius);
        }
        for(let i=0;i<g.indices.length;i+=3){
            const a=g.indices[i]*3,b=g.indices[i+1]*3,c=g.indices[i+2]*3;
            assert.ok(Math.max(a,b,c)<g.positions.length);
            const u=g.positions.slice(b,b+3).map((v,k)=>v-g.positions[a+k]);
            const v=g.positions.slice(c,c+3).map((n,k)=>n-g.positions[a+k]);
            assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-8);
        }
        assert.ok(Math.max(...g.positions.filter((_,i)=>i%3===1))<-.035);
        assert.ok(Math.min(...g.positions.filter((_,i)=>i%3===1))<-1.2);
        for(let i=3;i<g.colors.length;i+=4)assert.ok(g.colors[i]>=0 && g.colors[i]<=.5);
    }
});

test('水下主线恢复原螺旋轨迹，各水带之间没有封闭连接面',()=>{
    const f=fixture();
    for(const big of [false,true]) {
        const radius=big?2.016:1.344,arms=big?4:3,depth=big?1.75:1.35;
        const g=f.geometry.buildWhirlpoolFunnelGeometry(radius,big);
        const lines=g.strips.filter(s=>s.kind==='underwater');
        assert.equal(lines.length,arms);
        lines.forEach((strip,arm)=>{
            for(let i=0;i<strip.count;i+=2) {
                const t=i/(strip.count-2),k=(strip.start+i)*3;
                const center=[0,1,2].map(axis=>(g.positions[k+axis]+g.positions[k+3+axis])/2);
                const r=radius*(.84-t*t*(3-2*t)*.70);
                const angle=arm/arms*Math.PI*2+t*Math.PI*(big?3.4:3);
                assert.ok(Math.abs(center[0]-Math.cos(angle)*r)<1e-8);
                assert.ok(Math.abs(center[1]-(-.06-depth*t))<1e-8);
                assert.ok(Math.abs(center[2]-Math.sin(angle)*r)<1e-8);
            }
        });
        for(const strip of g.strips) {
            const inside=index=>index>=strip.start && index<strip.start+strip.count;
            for(let i=0;i<g.indices.length;i+=3) {
                const triangle=g.indices.slice(i,i+3);
                if(triangle.some(inside))assert.ok(triangle.every(inside),'水带不能相互连成壳');
            }
        }
    }
});

test('薄漏斗逐层收窄且保留缺口，透明边界不封底，先画水膜再画线条',()=>{
    const f=fixture();
    for(const big of [false,true]) {
        const g=f.geometry.buildWhirlpoolFunnelGeometry(big?2.016:1.344,big);
        const sheets=g.strips.filter(s=>s.kind==='membrane');
        assert.equal(sheets.length,big?4:3);
        for(const sheet of sheets) {
            assert.equal(sheet.count,63);
            for(let ring=0;ring<7;ring++) {
                const a=sheet.start+ring*9;
                const radius=Math.hypot(g.positions[a*3],g.positions[a*3+2]);
                if(ring>0) {
                    const previous=a-9;
                    assert.ok(radius<Math.hypot(g.positions[previous*3],g.positions[previous*3+2]));
                    assert.ok(g.positions[a*3+1]<g.positions[previous*3+1]);
                }
                for(let segment=0;segment<9;segment++) {
                    const alpha=g.colors[(a+segment)*4+3];
                    assert.ok(alpha>=0 && alpha<=.30);
                    if(ring===0 || ring===6 || segment===0 || segment===8)assert.ok(alpha<1e-8);
                }
                let angle=0;
                for(let segment=0;segment<8;segment++) {
                    const k=(a+segment)*3,l=k+3;
                    angle+=Math.acos(Math.min(1,(g.positions[k]*g.positions[l]+g.positions[k+2]*g.positions[l+2])/(radius*radius)));
                }
                assert.ok(Math.abs(angle/(Math.PI*2/sheets.length)-.78)<1e-7,'每圈保留 22% 几何缺口');
            }
        }
        const firstLine=g.strips.find(s=>s.kind==='underwater');
        assert.ok(sheets.every(s=>s.start+s.count<firstLine.start));
    }
});

test('大小漩涡共用预建资源、方向镜像和原世界位置，异步材质加载后替换一次',()=>{
    const f=fixture();
    f.c.updatePresentation(25,.1,false);
    const roots=f.world.children;
    const cores=roots.map(n=>n.children.find(c=>c.name==='DangerCore'));
    assert.equal(roots[0].position.x,20);assert.equal(roots[1].position.x,17);
    assert.ok(roots[0].position.z<0 && roots[1].position.z>0);
    assert.equal(roots[0].scale.x,.7);
    assert.ok(cores[0].scale.z*cores[1].scale.z<0);
    assert.equal(f.resources.normal.funnelMaterial,null);
    f.pending.shift()(null,{});
    f.c.updatePresentation(25,.1,false);
    assert.equal(cores[0].components[0].material,f.resources.normal.funnelMaterial);
    assert.equal(cores[1].components[0].material,f.resources.super.funnelMaterial);
    assert.ok(roots.every(n=>n.children.length===3));
    assert.equal(f.meshes.length,6);
    const count=f.materials.length;
    for(let i=0;i<100;i++)f.c.updatePresentation(25,1/60,false);
    assert.equal(f.materials.length,count);assert.equal(f.meshes.length,6);
});

test('隐藏重开和销毁正确，迟到的资源回调不能复活材质',()=>{
    const f=fixture();f.pending.shift()(null,{});
    f.c.updatePresentation(25,.1,false);
    assert.ok(f.world.children.some(n=>n.active));
    f.c.reset();assert.ok(f.world.children.every(n=>!n.active));
    f.c.updatePresentation(25,.1,false);
    f.c.updatePresentation(90,.1,false);
    assert.ok(f.world.children.every(n=>!n.active));
    f.c.dispose();assert.ok(f.world.children.every(n=>!n.isValid));
    const r=f.controller.createWhirlpoolVisualResources();
    f.controller.disposeWhirlpoolVisualResources(r);
    const count=f.materials.length;
    f.pending.shift()(null,{});
    assert.equal(f.materials.length,count);assert.equal(r.normal.funnelMaterial,null);
});

test('水面线条随展开保持贴水，暂停或全隐藏不继续写共享材质',()=>{
    const f=fixture();f.pending.shift()(null,{});
    for(const distance of [-5,10,25,42,65]) {
        f.c.updatePresentation(distance,.1,false);
        for(const root of f.world.children) {
            if(!root.active)continue;
            const core=root.children.find(c=>c.name==='DangerCore');
            assert.ok(Math.abs(.035+core.position.y-.037*core.scale.y)<1e-8);
            const g=root.name.startsWith('Super')?f.resources.super.coreMesh.geometry:f.resources.normal.coreMesh.geometry;
            for(let i=1;i<g.positions.length;i+=3)assert.ok(.035+core.position.y+g.positions[i]*core.scale.y<=.00101);
        }
    }
    f.c.updatePresentation(90,.1,false);
    const n=f.resources.normal.funnelMaterial,s=f.resources.super.funnelMaterial;
    const writes=n.writes+s.writes;
    for(let i=0;i<10;i++)f.c.updatePresentation(90,.1,false);
    assert.equal(n.writes+s.writes,writes);
    f.c.updatePresentation(25,.1,false);
    const activeWrites=n.writes+s.writes;
    f.c.updatePresentation(25,0,false);
    assert.equal(n.writes+s.writes,activeWrites);
});

test('水流不写实体深度，池水不再开孔，保留柔边与流动',()=>{
    const fs=require('node:fs'),read=p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');
    const effect=read('assets/race/effects/WhirlpoolFunnel.effect');
    assert.match(effect,/depthWrite: false/);
    assert.match(effect,/smoothstep/);assert.match(effect,/flowMotion/);
    assert.doesNotMatch(effect,/waterOpacity|funnelProfile|discard/);
    for(const p of ['assets/scripts/core/WhirlpoolBrawlController.ts','assets/scripts/venue/WaterSurfaceBinder.ts','assets/race/material-effects/RagingPoolWater.effect'])
        assert.doesNotMatch(read(p),/WhirlpoolWaterCutout|whirlpoolCuts|whirlpoolEnabled/);
});
