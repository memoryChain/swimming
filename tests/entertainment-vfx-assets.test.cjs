const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readGlbGeometry } = require('./helpers/glb-geometry.cjs');
const { createImportedMeshHarness } = require('./helpers/imported-mesh-harness.cjs');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');

test('六份交付GLB逐个三角角点保持原造型和顶点色，没有新增纹理或几何', () => {
    const root = path.resolve(__dirname, '..');
    for (const effect of ['GiantWave','Geyser']) {
        const reference=JSON.parse(fs.readFileSync(path.join(root,'modelresource/entertainment',effect+'-reference.json'),'utf8'));
        for (const [name, original] of Object.entries(reference.meshes)) {
            const {document:d,geometry:g}=readGlbGeometry(path.join(root,'assets/race/items',name+'.glb'));
            assert.equal(d.nodes.length,1);assert.equal(d.meshes.length,1);assert.equal(d.scenes.length,1);
            assert.equal(d.nodes[0].name,name);
            for(const property of ['rotation','translation','scale','matrix'])assert.equal(d.nodes[0][property],undefined);
            assert.equal(d.meshes[0].primitives.length,1);
            assert.ok(d.materials[0].extensions.KHR_materials_unlit);
            assert.equal(d.textures,undefined);assert.equal(d.images,undefined);assert.equal(d.animations,undefined);
            assert.equal(g.indices.length,original.indices.length);
            for(let i=0;i<g.indices.length;i++){
                const a=g.indices[i],b=original.indices[i];
                for(let k=0;k<3;k++)assert.ok(Math.abs(g.positions[a*3+k]-original.positions[b*3+k])<1e-6,`${name}位置`);
                for(let k=0;k<4;k++)assert.ok(Math.abs(g.colors[a*4+k]-original.colors[b*4+k])<=1/65535+1e-6,`${name}颜色`);
            }
        }
    }
});

function runtimeFixture(mode) {
    const h=createImportedMeshHarness(mode==='geyser'?'geyser':'giantWave');
    const a=createAiHarness(),f=a.create('cartonSwimmer6',5,.7,20);
    f.body.cartoonRig.giantWaveLift=0;f.body.cartoonRig.setGiantWaveLift=function(v){this.giantWaveLift=v;};
    const R=h.loadModule('app/EntertainmentRaceRuntime').EntertainmentRaceRuntime;
    return {h,f,runtime:new R(h.root,f.body.courseLayout,mode,42,200,[{lane:0,swimmer:f.body,condition:f.condition,ai:null}])};
}

test('巨浪与喷泉都等三份资源就绪才放行，等待中不创建表现或提前绑定选手', () => {
    for(const mode of ['giant-wave','geyser']){
        const {h,f,runtime}=runtimeFixture(mode),pending=[];
        h.setLoadOverride((assetPath,type,done)=>pending.push({assetPath,done}));
        let completed=0;runtime.prepare(error=>{assert.ifError(error);completed++;});
        for(let index=0;index<3;index++){
            assert.equal(completed,0);assert.equal(h.budget().renderers,0);
            assert.equal(f.body.motor.hasEntertainmentGiantWave,false);assert.equal(f.body._geyser,null);
            const current=pending.shift();assert.ok(current);
            current.done(null,h.prefabs.get(current.assetPath));
        }
        assert.equal(completed,1);assert.equal(h.requests.length,3);assert.ok(h.budget().renderers>0);
        runtime.dispose();assert.ok(h.meshes.every(mesh=>mesh.destroyCount===0));
    }
});

test('任一模型缺失、导入结构错误或场景失效都只报告一次失败并清理玩法状态', () => {
    for(const mode of ['giant-wave','geyser'])for(const reason of ['error','missing','transform','multiple','world'])for(const failureIndex of [0,1,2]){
        const {h,f,runtime}=runtimeFixture(mode);let loaded=0,completed=0;
        h.setLoadOverride((assetPath,type,done)=>{
            if(loaded++!==failureIndex){done(null,h.prefabs.get(assetPath));return;}
            if(reason==='error'){done(new Error('模型加载失败'));return;}
            if(reason==='missing'){done(null,null);return;}
            const prefab=h.prefabs.get(assetPath);
            if(reason==='transform')prefab.data.position.x=1;
            if(reason==='multiple')prefab.data.getComponentsInChildren=()=>[{mesh:h.meshes[0]},{mesh:h.meshes[1]}];
            if(reason==='world')h.root.isValid=false;
            done(null,prefab);
        });
        runtime.prepare(error=>{assert.ok(error);completed++;});
        assert.equal(completed,1);assert.equal(runtime.disposed,true);assert.equal(h.budget().renderers,0);
        assert.equal(f.body.motor._entertainment,null);assert.equal(f.body._geyser,null);
        assert.equal(f.body.motor.hasEntertainmentGiantWave,false);
        runtime.dispose();assert.equal(completed,1);assert.ok(h.meshes.every(mesh=>mesh.destroyCount===0));
    }
});

test('加载中离场后迟到回调不能继续请求资源、创建节点或复活比赛', () => {
    for(const mode of ['giant-wave','geyser'])for(const cancelIndex of [0,1,2]){
        const {h,f,runtime}=runtimeFixture(mode),pending=[];
        h.setLoadOverride((assetPath,type,done)=>pending.push({assetPath,done}));
        let completed=0;runtime.prepare(error=>{assert.ok(error);completed++;});
        for(let index=0;index<cancelIndex;index++){
            const current=pending.shift();current.done(null,h.prefabs.get(current.assetPath));
        }
        const late=pending.shift();runtime.dispose();assert.equal(completed,1);
        const budget=h.budget(),loads=h.requests.length;
        late.done(null,h.prefabs.get(late.assetPath));late.done(new Error('迟到失败'));
        assert.equal(completed,1);assert.equal(h.requests.length,loads);assert.deepEqual(h.budget(),budget);
        assert.equal(f.body._geyser,null);assert.equal(f.body.motor.hasEntertainmentGiantWave,false);
        assert.ok(h.meshes.every(mesh=>mesh.destroyCount===0));
    }
});
