const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createOutlineHarness}=require('./helpers/turtle-outline-harness.cjs');
const {fixture}=require('./helpers/water-play-harness.cjs');
function setup(){const h=createOutlineHarness();
    h.cc.gfx={Attribute:class {constructor(name,format){Object.assign(this,{name,format})}},AttributeName:{ATTR_JOINTS:'a_joints',ATTR_WEIGHTS:'a_weights'},Format:{RGBA32F:1}};
    h.cc.SkinnedMeshRenderer=class {enabled=true;setMaterial(m,i){(this.materials??=[])[i]=m}
        get skinningRoot(){return this.root}set skinningRoot(v){this.root=v;this.baked=v?.animation?.useBakedAnimation;this.animation=v?.animation?.clip}
        setUseBakedAnimation(){throw Error('不应覆盖原动画的蒙皮模式')}uploadAnimation(){throw Error('不应清空当前动画片段')}};
    const {EntertainmentPropOutline}=h.load(path.join(h.root,'assets/scripts/core/EntertainmentPropOutline.ts'));
    return {...h,EntertainmentPropOutline};
}
test('七个浮标共享两份轮廓网格和一个材质，加载不会提前激活隐藏父节点',()=>{
    const h=fixture('buoy',7),before=h.meshes.length;
    assert.equal(h.outlinePending.length,1);h.outlinePending[0](null,{});
    const shells=h.nodes.filter(n=>n.name==='PropOutline');assert.equal(shells.length,14);
    assert.equal(h.meshes.length-before,2);assert.equal(new Set(shells.map(n=>n.components[0].material)).size,1);
    assert.ok(h.p.mineNodes.every(n=>!n.active));
    for(let round=0;round<20;round++){h.p.update(.1,h.states,true);h.p.reset()}
    assert.equal(h.nodes.filter(n=>n.name==='PropOutline').length,14);
    h.ready();assert.ok(shells.every(n=>n.isValid));
    h.p.dispose();h.p.dispose();assert.ok(h.meshes.every(m=>m.destroyed));assert.ok(h.materials.every(m=>m.destroyed));
});
test('水炮本体与轮廓共用两次绘制，回弹和重复进出不新增资源，晚加载水球不覆盖轮廓',()=>{
    const h=fixture('cannon');assert.equal(h.outlinePending.length,0);
    assert.equal(h.nodes.filter(n=>n.name==='PropOutline').length,0);
    const parts=h.nodes.filter(n=>['CannonBase','CannonNozzle'].includes(n.name));assert.equal(parts.length,4);
    const meshes=parts.map(n=>n.components[0].mesh);
    assert.equal(new Set(meshes).size,2);
    assert.equal(new Set(parts.map(n=>n.components[0].material)).size,1);
    for(const part of parts){
        assert.equal(part.components.length,1);
        assert.equal(part.components[0].material.options.states.rasterizerState.cullMode,h.cc.gfx.CullMode.BACK);
        assert.equal(part.components[0].mesh.geometry.indices.length/3,part.name==='CannonBase'?1336:1252);
    }
    const launch={strikeId:0,targetDistance:40,targetZ:2,warningSeconds:2.8,revision:1};h.p.showLaunch(launch);
    h.p.update(.05,launch,2.75,true);assert.ok(h.p.nozzles[0].position.z<0);
    assert.equal(h.pending.length,1);h.ready();
    const counts=[h.nodes.length,h.meshes.length,h.materials.length];
    for(let i=0;i<20;i++){h.p.reset();h.p.showLaunch({...launch,strikeId:i%2});h.p.update(.4,launch,2.4,true)}
    assert.deepEqual([h.nodes.length,h.meshes.length,h.materials.length],counts);
    parts.forEach((n,i)=>assert.equal(n.components[0].mesh,meshes[i]));
    h.p.dispose();h.p.dispose();assert.ok(h.meshes.every(m=>m.destroyed));assert.ok(h.materials.every(m=>m.destroyed));
});

test('水炮离线合并保持原几何和其他道具不变，轮廓沿法线外扩且反向绕序',()=>{
    const {build,WIDTH,INK}=require('../art/water-play-obstacles/build_cannon_merged.cjs');
    const {water,text}=build(),source=JSON.parse(fs.readFileSync('art/water-play-obstacles/geometry.json','utf8'));
    assert.equal(fs.readFileSync('assets/scripts/core/WaterPlayObstacleGeometry.ts','utf8'),text);
    assert.deepEqual(water.SprayBuoy,source.SprayBuoy);assert.deepEqual(water.CannonWaterBall,source.CannonWaterBall);
    const {outline,CANNON_OUTLINE_POLICIES}=require('../art/entertainment-outlines/build_geometry.cjs');
    for(const [name,base]of Object.entries(source.WaterBallCannon)){
        const g=water.WaterBallCannon[name],shell=outline(base,CANNON_OUTLINE_POLICIES[name]),offset=base.positions.length/3;
        assert.equal(shell.indices.length/3,name==='CannonBase'?668:588);
        assert.deepEqual(g.positions.slice(0,base.positions.length),base.positions);
        assert.deepEqual(g.colors.slice(0,base.colors.length),base.colors);
        assert.deepEqual(g.indices.slice(0,base.indices.length),base.indices);
        for(let i=0;i<shell.positions.length;i+=3){
            const displacement=g.positions.slice(base.positions.length+i,base.positions.length+i+3).map((v,k)=>v-shell.positions[i+k]);
            assert.ok(Math.abs(Math.hypot(...displacement)-WIDTH)<1e-12);
            assert.ok(displacement.reduce((s,v,k)=>s+v*shell.normals[i+k],0)>0);
            assert.deepEqual(g.colors.slice((offset+i/3)*4,(offset+i/3+1)*4),INK);
        }
        for(let i=0;i<shell.indices.length;i+=3)assert.deepEqual(g.indices.slice(base.indices.length+i,base.indices.length+i+3),[shell.indices[i],shell.indices[i+2],shell.indices[i+1]].map(v=>v+offset));
    }
});
test('玩具鲨专用轮廓共用原骨架，重复绑定及销毁不释放原模型',()=>{
    const h=setup(),model=new h.Node('Shark'),source=model.addComponent(h.cc.SkinnedMeshRenderer);
    model.animation={useBakedAnimation:true,clip:'Shark_Swim'};
    const mesh={struct:{primitives:[{}]},destroy(){throw Error('不应销毁借用网格')}};
    Object.assign(source,{mesh,skeleton:{joints:['head','tail']},skinningRoot:model});
    const outline=new h.EntertainmentPropOutline(2);outline.attachSharkModel(model);h.pending[0](null,{});
    const shell=model.children[0],renderer=shell.renderers[0];
    assert.notEqual(renderer.mesh,mesh);assert.equal(renderer.mesh.data.indices.length/3,1157);
    assert.deepEqual(renderer.mesh.data.customAttributes.map(a=>a.attr.name),['a_joints','a_weights']);
    assert.equal(renderer.skeleton,source.skeleton);assert.equal(renderer.skinningRoot,model);assert.equal(renderer.baked,true);assert.equal(renderer.animation,'Shark_Swim');
    outline.attachSharkModel(model);assert.equal(model.children.length,1);
    model.setScale(1.5,1.5,1.5);model.setRotationFromEuler(0,120,0);assert.deepEqual(shell.worldMatrix,model.worldMatrix);
    outline.dispose();outline.dispose();assert.equal(model.children.length,0);assert.ok(model.isValid);assert.equal(h.resources.materials[0].destroyed,1);assert.equal(h.resources.meshes[0].destroyed,1);
});
test('晚加载、失败重试及父节点先销毁不会留下网格或材质',()=>{
    for(const mode of ['dispose','parent','failure']){
        const h=setup(),parent=new h.Node('Bottle'),outline=new h.EntertainmentPropOutline(2);outline.attachStatic(parent,'Soda');
        if(mode==='dispose')outline.dispose();else if(mode==='parent')parent.destroy();
        h.pending[0](mode==='failure'?new Error('模拟失败'):null,mode==='failure'?null:{});
        assert.equal(h.resources.meshes.length,0);assert.equal(h.resources.materials.length,0);
        if(mode==='failure'){outline.attachStatic(parent,'Soda');h.pending[1](null,{});assert.equal(h.resources.meshes.length,1)}
        outline.dispose();assert.ok(h.resources.meshes.every(m=>m.destroyed===1));assert.ok(h.resources.materials.every(m=>m.destroyed===1));
    }
});
test('离线轮廓只包含选定实体，法线有效且与源坐标一致',()=>{
    const h=setup(),{ENTERTAINMENT_OUTLINE_GEOMETRY:g}=h.load(path.join(h.root,'assets/scripts/core/EntertainmentOutlineGeometry.ts'));
    const {inputs}=require('../art/entertainment-outlines/build_geometry.cjs'),source=inputs();
    const expected={CannonBase:668,CannonNozzle:588,BuoyBody:424,BuoyBalloon:356,Soda:236,Slush:172,SharkFallback:601};
    for(const [key,mesh]of Object.entries(g)){
        if(key==='SharkSkin')continue;
        assert.equal(mesh.indices.length/3,expected[key]);assert.equal(mesh.positions.length,mesh.normals.length);
        const original=new Set();for(let i=0;i<source[key].positions.length;i+=3)original.add(source[key].positions.slice(i,i+3).map(v=>Math.round(v*1e5)).join(','));
        for(let i=0;i<mesh.positions.length;i+=3){assert.ok(Math.abs(Math.hypot(...mesh.normals.slice(i,i+3))-1)<2e-6);assert.ok(original.has(mesh.positions.slice(i,i+3).map(v=>Math.round(v*1e5)).join(',')))}
        assert.ok(mesh.indices.every(i=>Number.isInteger(i)&&i>=0&&i<mesh.positions.length/3));
    }
});

test('鲨鱼轮廓的绑定位置、法线、骨骼索引与权重逐顶点沿用当前正式GLB',()=>{
    const h=setup(),{ENTERTAINMENT_OUTLINE_GEOMETRY:g}=h.load(path.join(h.root,'assets/scripts/core/EntertainmentOutlineGeometry.ts'));
    const {readGltf}=require('../art/entertainment-outlines/build_geometry.cjs'),asset=readGltf('assets/race/models/SharkModel.glb');
    const audit=JSON.parse(fs.readFileSync(path.join(h.root,'art/entertainment-outlines/geometry-audit.json'),'utf8')).SharkSkin;
    assert.equal(asset.hash,audit.sourceSha256,'鲨鱼换模后需要重新生成专用轮廓');
    const attrs=asset.g.meshes[0].primitives[0].attributes;
    for(const [key,attribute,size]of [['positions','POSITION',3],['normals','NORMAL',3],['joints','JOINTS_0',4],['weights','WEIGHTS_0',4]]){
        const original=asset.read(attrs[attribute]);
        audit.sourceVertices.forEach((source,i)=>assert.deepEqual(g.SharkSkin[key].slice(i*size,i*size+size),original.slice(source*size,source*size+size)));
    }
    assert.equal(g.SharkSkin.indices.length/3,1157);
});
