const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createHarness}=require('./helpers/cocos-math-harness.cjs');

function fixture(){
    const pending=[],splashes=[],owners=[];
    const loader={loadSwimmerPrefab:cb=>pending.push(cb),setLayerRecursive:(n,l)=>{n.layer=l;n.children.forEach(c=>loader.setLayerRecursive(c,l));},findNode:(n,name)=>n.name===name?n:n.children.map(c=>loader.findNode(c,name)).find(Boolean)||null};
    const h=createHarness({'../character/CharacterModelLoader':loader,'./EntertainmentWaterSplash':{
        ENTERTAINMENT_SPLASH_OWNER:{TIMED_BOMB:'timed-bomb'},ENTERTAINMENT_SPLASH_PROFILE:{EXPLOSION:'explosion'},
    }});
    let created=0;
    class Node extends h.Node {
        active=true;
        constructor(name=''){super();this.name=name;created++;}
        setParent(p){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=p;if(p)p.children.push(this);}
        get worldPosition(){return this.getWorldPosition(new h.Vec3());}
        get worldRotation(){return this.getWorldRotation(new h.Quat());}
        setWorldPosition(x,y,z){super.setWorldPosition(typeof x==='number'?new h.Vec3(x,y,z):x);}
        destroy(){this.children.slice().forEach(n=>n.destroy());this.setParent(null);this.isValid=false;this.active=false;}
    }
    h.cc.Node=Node;
    h.cc.instantiate=()=>{const model=new Node('TimedWaterBalloon'),body=new Node('BalloonBody'),connector=new Node('BalloonConnector');body.setParent(model);body.setPosition(0,.14,0);connector.setParent(model);return model;};
    const {MineRelayBrawlPresentation}=h.load(path.join(h.root,'assets/scripts/core/MineRelayBrawlPresentation.ts'));
    const world=new Node('world'),a=new Node('a'),b=new Node('b');a.setParent(world);b.setParent(world);a.setPosition(1,-1,2);b.setPosition(3,-.5,2);
    const presentation=new MineRelayBrawlPresentation(world,{waterY:0,poolWidth:20,direction:1},{play:r=>splashes.push({...r,position:{...r.position},explosionCorePosition:{...r.explosionCorePosition}}),cancelOwner:o=>owners.push(o)},n=>n);
    return{...h,Node,p:presentation,world,a,b,pending,splashes,owners,created:()=>created,ready:()=>pending.shift()(null,{prefab:{}})};
}
const arm={roundId:0,carrierLane:0,fuseSeconds:10,revision:1};

test('C1 导出预算、节点与源导出一致；水雷接口保持原几何',()=>{
    const file=fs.readFileSync('art/timed-water-balloon/TimedWaterBalloon.glb');
    assert.deepEqual(file,fs.readFileSync('assets/race/items/TimedWaterBalloon.glb'));
    const gltf=JSON.parse(file.subarray(20,20+file.readUInt32LE(12)));
    assert.equal(gltf.meshes.length,2);assert.equal(gltf.materials.length,1);assert.equal(gltf.textures?.length||0,0);
    assert.equal(gltf.meshes.reduce((sum,m)=>sum+m.primitives.reduce((s,p)=>s+gltf.accessors[p.indices].count/3,0),0),696);
    for(const name of ['TimedWaterBalloon','BalloonBody','BalloonConnector'])assert.ok(gltf.nodes.some(n=>n.name===name));
    assert.equal(gltf.skins?.length||0,0);
    const current=fs.readFileSync('assets/scripts/core/MineRelayBrawlPresentation.ts','utf8');
    assert.ok(current.includes('export function buildMineGeometry'));assert.ok(current.includes('export function makeMineVertexMaterial'));
    const f=fixture();
    const geometry=f.load(path.join(f.root,'assets/scripts/core/MineRelayBrawlPresentation.ts')).buildMineGeometry();
    assert.equal(require('node:crypto').createHash('sha256').update(JSON.stringify(geometry)).digest('hex'),
        '146ae06c412b2c653b1116694d5ae90c2611c4399c56bc4ff0c93a67c28a4ccc','障碍水雷的顶点、颜色、索引和范围保持原值');
});

test('发放、连续转交保持一份实例、鼓胀与剩余时间，锁定快照不补发动画',()=>{
    const f=fixture();f.ready();f.p.attach(arm,f.a,true);assert.ok(f.p.throwRemaining>0);
    f.p.update(.6,arm,f.a,9.4,false,true);assert.equal(f.p.throwRemaining,0);
    f.p.update(.1,arm,f.a,5,false,true);const inflation=f.p.body.scale.x,count=f.created();
    for(let i=0;i<20;i++){
        const from=i%2?f.b:f.a,to=i%2?f.a:f.b,next={...arm,carrierLane:i%2?0:1,revision:i+2};
        f.p.transfer(next,from,to);assert.equal(f.p.body.scale.x,inflation);
        f.p.update(.1,next,to,5,false,true);assert.ok(f.p.root.worldPosition.y>Math.min(from.position.y,to.position.y));
        f.p.update(.13,next,to,5,false,true);assert.ok(f.Vec3.equals(f.p.root.worldPosition,to.worldPosition));
    }
    assert.equal(f.created(),count);
    f.p.syncSnapshot({...arm,carrierLane:1},f.b,.4,true);
    assert.equal(f.p.throwRemaining,0);assert.ok(f.p.body.scale.x>1.2);assert.equal(f.p.locked,true);
    f.p.reset();assert.equal(f.p.visualNode,null);assert.ok(f.owners.length>0);
});

test('水下、空中和翻滚跟随真实挂点；到时解绑前记录球心，水面反馈分离',()=>{
    const f=fixture();f.ready();f.p.attach(arm,f.a);
    for(const y of [-2,0,3])for(const angle of [0,90,180,270]){
        f.a.setPosition(1,y,2);f.a.setRotationFromEuler(angle,30,0);
        f.p.update(.05,arm,f.a,3,false,true);
        assert.ok(f.Vec3.equals(f.p.root.worldPosition,f.a.worldPosition));assert.ok(f.Quat.equals(f.p.root.worldRotation,f.a.worldRotation));
    }
    f.a.setPosition(1,-2,2);f.a.setRotationFromEuler(0,0,0);f.p.update(.05,arm,f.a,.01,true,true);
    f.p.showResolution(true,new f.Vec3(99,0,99));
    assert.equal(f.splashes.length,1);assert.equal(f.p.visualNode,null);
    assert.equal(f.splashes[0].position.x,1);assert.equal(f.splashes[0].position.y,.035);
    assert.ok(f.splashes[0].explosionCorePosition.y < -1.4);
});

test('晚加载恢复当前锁定状态；退出、销毁后回调不能复活道具',()=>{
    const f=fixture();f.p.attach(arm,f.a,true);f.p.syncSnapshot(arm,f.a,.5,true);f.ready();
    assert.equal(f.p.throwRemaining,0);assert.ok(f.p.body.scale.x>1.2);
    f.p.showResolution(false,null);assert.ok(f.p.deflateRemaining>0);
    f.p.updateResidualEffects(.4,true);assert.equal(f.p.visualNode,null);
    const late=fixture();late.p.attach(arm,late.a,true);late.p.reset();late.ready();assert.equal(late.p.visualNode,null);
    const dead=fixture();dead.p.dispose();const count=dead.created();dead.ready();assert.equal(dead.created(),count);
});

test('模型挂点重建、保活重开和隐藏帧不残留、不写变换',()=>{
    const f=fixture();f.ready();f.p.attach(arm,f.a);f.a.destroy();
    f.p.update(.1,arm,f.a,4,false,true);assert.equal(f.p.visualNode,null);assert.ok(f.p.root.isValid);
    f.p.syncSnapshot(arm,f.b,4,false);assert.ok(f.p.visualNode);
    f.p.reset();const writes=f.p.root.writes;
    for(let i=0;i<120;i++)f.p.update(.016,null,null,0,false,true);
    assert.equal(f.p.root.writes,writes);
    f.p.attach(arm,f.b,true);assert.ok(f.p.throwRemaining>0);f.p.update(3,arm,f.b,7,false,false);assert.equal(f.p.visualNode,null);
});

test('11 个角色完整划水与翻滚时，最大鼓胀球体不侵入头部及上臂',()=>{
    const h=require('./helpers/character-contact-harness.cjs');
    h.cc.Node=class extends h.Node { constructor(name){ super(); this.name=name; } };
    const {createTimedWaterBalloonMount}=h.load(path.join(h.root,'assets/scripts/character/TimedWaterBalloonMount.ts'));
    const {TIMED_WATER_BALLOON_MOUNTS}=h.load(path.join(h.root,'assets/scripts/character/TimedWaterBalloonMount.ts'));
    for(const row of JSON.parse(fs.readFileSync('art/timed-water-balloon/mounts.json','utf8'))){
        const expected=[...row.position,...row.rotation,...row.scale];
        expected.forEach((n,i)=>assert.ok(Math.abs(n-TIMED_WATER_BALLOON_MOUNTS[row.id][i])<1e-7));
    }
    h.Node.prototype.setParent=function(p){this.parent=p;p.children.push(this);};
    for(const file of h.SWIMMER_MODEL_FILES){
        const r=h.createRig(file),frame=new h.Node();r.wrapper.parent=frame;frame.children.push(r.wrapper);
        const anchor=createTimedWaterBalloonMount(r.wrapper,r.variant.id);assert.ok(anchor);
        const local=new h.Vec3(0,.14+.245*1.22,0),center=new h.Vec3(),point=new h.Vec3(),world=new h.Vec3();
        for(let i=0;i<24;i++){
            r.wrapper.setRotationFromEuler(90,90,0);frame.setRotationFromEuler(i*15,0,0);frame.setPosition(0,i%3-1,0);
            r.pose.applyFreestylePose(i*Math.PI/12,i*Math.PI/12+Math.PI,.2,1,.4,1,1,1);
            h.Vec3.transformMat4(center,local,anchor.worldMatrix);
            let min=Infinity;
            for(const v of r.fullHead){world.set(0,0,0);for(const inf of v.influences){h.Vec3.transformMat4(point,v.point,h.Mat4.multiply(new h.Mat4(),inf.bone.worldMatrix,inf.bind));h.Vec3.scaleAndAdd(world,world,point,inf.weight);}min=Math.min(min,h.Vec3.distance(world,center));}
            assert.ok(min>.18*1.22,`${file} 头部间距 ${min}`);
            for(const limb of r.pose._collisionLimp._limbs.filter(l=>!l.leg)){
                for(const n of [limb.upper,limb.middle,limb.end])assert.ok(h.Vec3.distance(n.getWorldPosition(point),center)>.18*1.22,`${file} 手臂骨骼穿入球体`);
            }
        }
    }
});

function compiler(){
    for(const dir of process.env.PATH.split(path.delimiter)){
        const file=path.resolve(dir,'../typescript/lib/typescript.js');if(fs.existsSync(file))return require(file);
    }
    return require('typescript');
}

test('实际画中画方法跟随短弧线与水下球体，到时拉开且沿用镜头让位',()=>{
    const h=createHarness(),ts=compiler(),vm=require('node:vm');
    const source=fs.readFileSync('assets/scripts/camera/RaceEventPictureInPictureCamera.ts','utf8').replace(/^import[\s\S]*?;\r?\n/gm,'');
    const exports={};
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Vec3:h.Vec3,Color:class{constructor(r,g,b,a){Object.assign(this,{r,g,b,a});}}});
    const C=exports.RaceEventPictureInPictureCamera,c=Object.create(C.prototype);
    for(const key of ['subjectPosition','targetPosition','timedBombDesiredFocus','timedBombDesiredCameraPosition','cameraPosition','focus','timedBombBlastPosition'])c[key]=new h.Vec3();
    c.timedBombVisualCenter=new h.Vec3(0,.36,0);c.timedBombCarrier=new h.Node();c.timedBombVisual=new h.Node();c.timedBombVisual.active=true;
    c.options={course:{waterY:0,direction:1}};c.timedBombResolution='none';c.applyCameraPose=fov=>{c.testFov=fov;};
    c.timedBombCarrier.setPosition(0,-2,0);c.timedBombVisual.setPosition(1,-2,0);c.updateTimedBombCameraPose(.1);
    assert.ok(c.focus.y< -1.4,'水下携带不继续盯住水面');
    const prior=c.focus.x;c.timedBombVisual.setPosition(4,2,0);c.updateTimedBombCameraPose(.1);
    assert.ok(c.focus.x>prior&&c.focus.y>0,'短弧线镜头消费真实道具位置');
    c.timedBombResolution='exploded';c.timedBombBlastPositionReady=true;c.timedBombBlastPosition.set(5,0,2);c.timedBombPoseReady=false;c.updateTimedBombCameraPose(.1);
    assert.equal(c.cameraPosition.y,4.2);assert.equal(c.focus.x,5);assert.equal(c.testFov,56);
    for(const mode of ['shark','cannon']){c.mode=mode;assert.equal(c.isTimedBombBlockedByHigherPriority(),true);}
    c.mode='whirlpool';assert.equal(c.isTimedBombBlockedByHigherPriority(),false,'保留既有漩涡镜头让位规则');
    c.resetTimedBombTrackingState();assert.equal(c.timedBombVisual,null);assert.equal(c.timedBombCarrier,null);
});
