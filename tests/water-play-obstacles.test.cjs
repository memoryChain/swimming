const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./helpers/water-play-harness.cjs');
const impact={mineId:0,hitLane:0,courseX:10,lateral:0,hitMask:1,revision:2};
const launch={strikeId:0,targetDistance:40,targetZ:2,warningSeconds:2.8,revision:1};

test('精修水球同源多色且保持单网格，晚加载不重置飞行、隐藏或销毁状态',()=>{
    const f=fixture('cannon');f.p.showLaunch(launch);f.p.update(.5,launch,1,true);
    const ball=f.p.projectile,surface=ball.children[0],g=surface.components[0].mesh.geometry;
    assert.equal(ball.children.length,1);assert.equal(g.indices.length/3,720);
    assert.ok(new Set(g.colors.map((v,i)=>i%4===0?g.colors.slice(i,i+3).join(','):null)).size>50);
    assert.ok(Math.max(...g.colors.filter((v,i)=>i%4===0))>.7,'水球有可辨识高光');
    const position={...ball.worldPosition};f.ready();f.ready();
    assert.equal(f.p.projectileNode,ball);assert.deepEqual({...ball.worldPosition},position);
    assert.ok(surface.components[0].mesh.imported);assert.equal(f.materials.length,3);
    const exit=fixture('cannon');exit.p.showLaunch(launch);exit.p.beginExit();exit.ready();exit.ready();assert.equal(exit.p.projectileNode,null);
    const dead=fixture('cannon');dead.p.dispose();const count=dead.nodes.length;dead.ready();dead.ready();assert.equal(dead.nodes.length,count);assert.ok(dead.meshes.every(m=>m.destroyed));
    const failed=fixture('cannon');failed.ready();failed.ready(new Error('离线'));assert.equal(failed.p.projectile.children[0].components[0].mesh.geometry.indices.length/3,720);
});

test('水炮飞行和落水停留只排除本相机顶棚，退出恢复且主画面建筑不变',()=>{
    const {f,camera:c,ceiling}=require('./helpers/cannon-venue-review.cjs').makeReview();
    const main={visibility:1},pool=new f.Node('pool'),beam=new f.Node('ceiling_lighting_rig');beam.setParent(pool);
    const controller=new ceiling.TopViewCeilingController();controller.bind(pool,main);
    const mainMask=main.visibility,mask=mainMask,feed={visibility:mask,isValid:true};
    Object.assign(c,{camera:feed,ceilingVisible:true,mode:'none',setCopy(){},setVisible(){},shouldRender(){return false}});
    c.showCannonLaunch(launch,25);assert.equal(feed.visibility&ceiling.VENUE_CEILING_LAYER,0);
    c.showCannonImpact({strikeId:0,knockedLane:-1,hitMask:0});c.updateCannon(null,0,true,.05);
    assert.equal(c.mode,'cannon');assert.equal(feed.visibility&ceiling.VENUE_CEILING_LAYER,0);
    assert.equal(main.visibility,mainMask);assert.equal(beam.active,true);assert.equal(beam.layer,ceiling.VENUE_CEILING_LAYER);
    c.updateCannon(null,0,true,2);assert.equal(c.mode,'none');assert.equal(feed.visibility,mask);
    c.mode='shark';c.showCannonLaunch(launch,25);assert.equal(c.mode,'shark');assert.equal(feed.visibility,mask);
});

test('正式场馆两侧、折返及远近落点的 1260 个采样，排除顶棚后无建筑遮挡',()=>{
    const {audit}=require('./helpers/cannon-venue-review.cjs');
    const result=audit({ignoreCeiling:true});assert.equal(result.samples,1260);assert.deepEqual(result.hits,{});
});

test('E 源资源与运行时相同，网格、材质及接触轮廓符合预算',()=>{
    for(const [name,count,budget] of [['WaterBallCannon',2,1350],['SprayBuoy',2,1500],['CannonWaterBall',1,800]]){
        const bytes=fs.readFileSync('art/water-play-obstacles/'+name+'.glb');
        assert.deepEqual(bytes,fs.readFileSync('assets/race/items/'+name+'.glb'));
        const g=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
        assert.equal(g.meshes.length,count);assert.equal(g.materials.length,1);assert.equal(g.textures?.length||0,0);
        assert.ok(g.meshes.reduce((n,m)=>n+m.primitives.reduce((s,p)=>s+g.accessors[p.indices].count/3,0),0)<=budget);
    }
    const g=JSON.parse(fs.readFileSync('art/water-play-obstacles/geometry.json')).SprayBuoy.BuoyBody;
    const x=g.positions.filter((v,i)=>i%3===0),z=g.positions.filter((v,i)=>i%3===2);
    assert.ok(Math.max(...x)>=.65&&Math.max(...x)<=.67);assert.ok(Math.max(...z)>=.64&&Math.max(...z)<=.66);
    assert.doesNotMatch(fs.readFileSync('assets/scripts/core/MinefieldBrawlPresentation.ts','utf8'),/MineRelayBrawlPresentation|buildMineGeometry|makeMineVertexMaterial/);
});

test('浮标命中立即喷水，随后下压退出；下一代替换旧尾段',()=>{
    const f=fixture();f.p.update(1.5,f.states,true);const n=f.p.mineNodes[0];
    f.states[0].active=f.states[0].armed=false;
    const expected=f.Vec3.transformMat4(new f.Vec3(),new f.Vec3(0,.25,0),n.worldMatrix);
    f.p.showImpact(impact,f.states[0],2);const splash=f.splashes.at(-1);
    assert.equal(splash.profile,'explosion');assert.ok(f.Vec3.equals(expected,splash.explosionCorePosition));
    assert.ok(n.active&&n.scale.y<1);f.p.update(.1,f.states,true);assert.ok(n.active);
    f.states[0]={...f.states[0],generation:1,active:true,armed:true};f.p.update(.05,f.states,true);
    assert.equal(f.p.exitElapsed[0],.3);assert.equal(n.scale.y,1);
    const count=f.splashes.length;f.p.showImpact({...impact,revision:3},f.states[0],4);
    assert.equal(f.splashes.length,count);f.p.update(.5,f.states,true);assert.ok(n.active);
});

test('浮标重复、旧代事件与未武装快照不重播；隐藏帧和重开清理',()=>{
    const f=fixture();f.p.update(1.5,f.states,true);f.states[0].active=f.states[0].armed=false;
    f.p.showImpact(impact,f.states[0],2);const count=f.splashes.length;
    f.p.showImpact(impact,f.states[0],2);assert.equal(f.splashes.length,count);
    f.p.update(.31,f.states,true);assert.equal(f.p.mineNodes[0].active,false);
    for(let i=0;i<10;i++)f.p.update(.1,f.states,true);assert.equal(f.splashes.length,count);
    f.p.update(.05,f.states,false);const writes=f.nodes.reduce((n,x)=>n+x.writes,0);
    for(let i=0;i<120;i++)f.p.update(.016,f.states,false);
    assert.equal(f.nodes.reduce((n,x)=>n+x.writes,0),writes);
    f.p.reset();assert.ok(f.p.mineNodes.every(n=>!n.active&&n.scale.y===1));
});

test('模型晚加载仅交换网格，失败保留新造型；销毁后不创建节点',()=>{
    const f=fixture();f.p.update(1.5,f.states,true);const node=f.p.mineNodes[0],matrix=Array.from(f.Mat4.toArray([],node.worldMatrix));
    f.ready();assert.deepEqual(Array.from(f.Mat4.toArray([],node.worldMatrix)),matrix);
    assert.ok(node.children[0].components[0].mesh.imported);
    const failed=fixture();failed.ready(new Error('离线'));assert.ok(failed.p.mineNodes[0].children[0].components[0].mesh.geometry);
    const dead=fixture();dead.p.dispose();const count=dead.nodes.length;dead.ready();assert.equal(dead.nodes.length,count);
});

test('水炮弹道从真实炮口开始，两侧转向一致；回弹归零且落点只触发一次',()=>{
    const f=fixture('cannon');assert.ok(f.p.cannons.every(n=>!n.active));
    for(let id=0;id<2;id++){
        const shot={...launch,strikeId:id};f.p.showLaunch(shot);
        const expected=f.Vec3.transformMat4(new f.Vec3(),new f.Vec3(0,0,1.02),f.p.nozzles[id].worldMatrix);
        assert.ok(f.Vec3.equals(f.p.projectile.worldPosition,expected));
        f.p.update(.05,shot,2.75,true);assert.ok(f.p.nozzles[id].position.z<0);
        f.p.update(.3,shot,2.45,true);assert.equal(f.p.nozzles[id].position.z,0);
        const event={strikeId:id,hitMask:0,knockedLane:-1,revision:id+2};f.p.showImpact(event);f.p.showImpact(event);
        assert.equal(f.splashes.length,id+1);assert.equal(f.splashes.at(-1).position.x,40);
    }
});

test('水炮取消预告、跨轮快照和晚加载不残留；重开恢复预热隐藏',()=>{
    const f=fixture('cannon');f.p.beginEntrance();f.p.update(.4,null,0,true);const z=f.p.cannons[0].position.z;
    f.p.beginExit();assert.equal(f.p.cannons[0].position.z,z);f.p.update(1.3,null,0,true);assert.ok(f.p.cannons.every(n=>!n.active));
    f.p.showLaunch(launch);f.p.update(.5,launch,1,true);const count=f.nodes.length;
    f.p.beginExit();assert.equal(f.p.projectileNode,null);f.ready();assert.equal(f.p.projectileNode,null);
    f.p.update(1.3,null,0,true);assert.ok(f.p.cannons.every(n=>!n.active));
    f.p.reset();f.p.showLaunch(launch);assert.ok(f.p.projectileNode);f.p.reset();
    const writes=f.nodes.reduce((s,n)=>s+n.writes,0);for(let i=0;i<100;i++)f.p.update(.02,null,0,true);
    assert.equal(f.nodes.reduce((s,n)=>s+n.writes,0),writes);assert.ok(f.nodes.length<=count+3);
});

test('水炮结束快照先到仍可补一次当前落水反馈，退场后旧结果不复活水花',()=>{
    const f=fixture('cannon');f.p.showLaunch(launch);f.p.syncLaunch(null);
    const event={strikeId:0,hitMask:0,knockedLane:-1,revision:2};f.p.showImpact(event);f.p.showImpact(event);
    assert.equal(f.splashes.length,1);
    f.p.showLaunch({...launch,strikeId:1});f.p.beginExit();f.p.showImpact({...event,strikeId:1});assert.equal(f.splashes.length,1);
});

test('水炮画中画读取实际水球，水球与落点都在画面内，保留鲨鱼优先级',()=>{
    const f=fixture('cannon'),ts=require('./helpers/water-splash-harness.cjs').compiler(),vm=require('node:vm');
    const source=fs.readFileSync('assets/scripts/camera/RaceEventPictureInPictureCamera.ts','utf8').replace(/^import[\s\S]*?;\r?\n/gm,'');
    const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Vec3:f.Vec3,Color:class{}});
    const c=Object.create(exports.RaceEventPictureInPictureCamera.prototype);
    Object.assign(c,{options:{course:f.course},cameraPosition:new f.Vec3(),focus:new f.Vec3(),cannonProjectilePosition:new f.Vec3(),applyCameraPose(v){this.fov=v},setCopy(){},setVisible(){},setCeilingVisible(){},mode:'shark'});
    f.p.showLaunch(launch);c.showCannonLaunch(launch,25,f.p.launchSource);assert.equal(c.mode,'shark');
    c.cannonProjectile=f.p.projectile;
    for(const targetZ of [-7,0,7])for(let i=0;i<=20;i++){
        const t=i/20;c.cannonTargetZ=targetZ;
        const point=new f.Vec3(f.p.sourceX+(40-f.p.sourceX)*t,f.p.sourceY+(.12-f.p.sourceY)*t+Math.sin(Math.PI*t)*5.8,f.p.sourceZ+(targetZ-f.p.sourceZ)*t);
        f.p.projectile.setWorldPosition(point);c.updateCannonCameraPose(t,40);
        const forward=f.Vec3.normalize(new f.Vec3(),f.Vec3.subtract(new f.Vec3(),c.focus,c.cameraPosition));
        const right=f.Vec3.normalize(new f.Vec3(),f.Vec3.cross(new f.Vec3(),forward,new f.Vec3(0,1,0)));
        const up=f.Vec3.cross(new f.Vec3(),right,forward),tan=Math.tan(c.fov*Math.PI/360);
        for(const p of [point,new f.Vec3(40,.05,targetZ)]){
            const delta=f.Vec3.subtract(new f.Vec3(),p,c.cameraPosition),depth=f.Vec3.dot(delta,forward);
            const x=f.Vec3.dot(delta,right)/(depth*tan*16/9),y=f.Vec3.dot(delta,up)/(depth*tan);
            assert.ok(depth>0&&Math.abs(x)<1&&Math.abs(y)<1,`落点 ${targetZ}、进度 ${t} 投影 (${x},${y})`);
        }
    }
});

test('气球在扣座上展开与摆动，接触当帧喷水并仅播一次声音，百毫秒内爆开',()=>{
    const f=fixture();let pops=0;f.p.playPop=()=>pops++;
    f.states[0].armed=false;f.p.update(.05,f.states,true);
    const body=f.p.mineNodes[0],balloon=f.p.balloonNodes[0];
    assert.ok(balloon.scale.y<.5);f.states[0].armed=true;f.p.update(.05,f.states,true);
    assert.ok(body.active&&body.worldPosition.y>=-.04,'已启用的底座必须可见');
    f.p.update(1.5,f.states,true);assert.equal(balloon.scale.y,1);
    const expected=f.Vec3.transformMat4(new f.Vec3(),new f.Vec3(-.32,.195,.05),body.worldMatrix);
    assert.ok(f.Vec3.equals(expected,balloon.worldPosition),'摆动锚点固定在实际扣座');
    f.states[0].active=f.states[0].armed=false;f.p.showImpact(impact,f.states[0],2);
    assert.equal(pops,1);assert.ok(balloon.active&&balloon.scale.x>1);assert.equal(f.splashes.at(-1).profile,'explosion');
    f.p.showImpact(impact,f.states[0],2);assert.equal(pops,1);
    f.p.update(.1,f.states,true);assert.equal(balloon.active,false);assert.equal(body.active,true);
    f.p.update(.21,f.states,true);assert.equal(body.active,false);
});

test('气球入场可被命中中断，旧尾段与迟到加载不会隐藏新一代',()=>{
    const f=fixture();let pops=0;f.p.playPop=()=>pops++;
    f.p.update(.01,f.states,true);assert.ok(f.p.mineNodes.every(n=>n.active),'武装状态不等待槽位错开');
    f.states[0].active=f.states[0].armed=false;f.p.showImpact(impact,f.states[0],2);
    f.p.update(.1,f.states,true);assert.equal(f.p.balloonNodes[0].active,false);
    f.states[0]={...f.states[0],generation:1,active:true,armed:true};f.p.update(.05,f.states,true);
    assert.ok(f.p.balloonNodes[0].active);const scale=f.p.balloonNodes[0].scale.y;
    f.ready();assert.equal(f.p.balloonNodes[0].scale.y,scale);assert.ok(f.p.balloonNodes[0].components[0].mesh.imported);
    f.p.showImpact(impact,f.states[0],3);assert.equal(pops,1);assert.ok(f.p.balloonNodes[0].active);
});

test('成熟快照恢复气球就位，已消耗快照与隐藏重开不补播声画',()=>{
    const f=fixture();let pops=0;f.p.playPop=()=>pops++;
    f.p.restoreSnapshot(f.states);f.p.update(0,f.states,true);
    assert.equal(f.p.balloonNodes[0].scale.y,1);assert.equal(f.splashes.length,0);
    f.states[0].active=f.states[0].armed=false;f.p.restoreSnapshot(f.states);f.p.update(0,f.states,true);
    assert.equal(f.p.mineNodes[0].active,false);assert.equal(pops,0);assert.equal(f.splashes.length,0);
    f.p.update(.05,f.states,false);const writes=f.nodes.reduce((n,v)=>n+v.writes,0);
    for(let i=0;i<60;i++)f.p.update(.016,f.states,false);
    assert.equal(f.nodes.reduce((n,v)=>n+v.writes,0),writes);f.p.reset();assert.equal(pops,0);
});

test('气球短音复用原音量与输出，延迟加载不补播、重复预载和密集触碰受限',()=>{
    const {createHarness}=require('./helpers/cocos-math-harness.cjs');const h=createHarness(),pending=[],played=[];
    const source={isValid:true,playOneShot:(clip,volume)=>played.push({clip,volume})};
    class AudioNode{isValid=true;addComponent(){return source}}
    Object.assign(h.cc,{Node:AudioNode,AudioClip:class{},AudioSource:class{},director:{getScene:()=>({addChild(){}})},game:{addPersistRootNode(){}},assetManager:{getBundle:()=>({load:(p,t,cb)=>pending.push(cb)})}});
    const M=h.load(path.resolve('assets/scripts/app/StrokeSfxManager.ts')).StrokeSfxManager;
    M.preloadBuoyPop();M.preloadBuoyPop();assert.equal(pending.length,1);
    M.playBuoyPop();assert.equal(played.length,0);pending.shift()(null,{name:'pop'});assert.equal(played.length,0);
    M.setVolume(.5);M.playBuoyPop();M.playBuoyPop();assert.equal(played.length,1);assert.equal(played[0].volume,.24);
    M._lastBuoyPopMs-=120;M.playBuoyPop();assert.equal(played.length,2);
    M.setVolume(0);M._lastBuoyPopMs-=120;M.playBuoyPop();assert.equal(played.length,2);
    const bytes=fs.readFileSync('assets/music/sfx/buoy_balloon_pop.wav');assert.ok(bytes.length<16*1024);assert.deepEqual(bytes,fs.readFileSync('art/water-play-obstacles/buoy_balloon_pop.wav'));
});

test('七套浮标连续二十轮只复用固定节点、两份网格和同一材质',()=>{
    const f=fixture('buoy',7);const nodes=f.nodes.length,meshes=f.meshes.length,materials=f.materials.length;
    assert.equal(meshes,2);assert.equal(materials,1);
    for(let round=0;round<20;round++){
        f.p.reset();for(const state of f.states){state.active=state.armed=true;state.generation=round;}
        f.p.update(1.5,f.states,true);assert.equal(f.snapshot().length,14);
        for(let id=0;id<7;id++){f.states[id].active=f.states[id].armed=false;f.p.showImpact({...impact,mineId:id,revision:round*7+id+2},f.states[id],round*7+id+2);}
        f.p.update(.31,f.states,true);assert.equal(f.snapshot().length,0);
        assert.equal(f.nodes.length,nodes);assert.equal(f.meshes.length,meshes);assert.equal(f.materials.length,materials);
    }
});
