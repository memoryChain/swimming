// 运行实际 E 表现与 B2 池，输出两份无需服务器或外部脚本的离线状态预览。
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture}=require('../../tests/helpers/water-play-harness.cjs');
const {createSplashHarness,compiler}=require('../../tests/helpers/water-splash-harness.cjs');
const out=__dirname,root=path.resolve(out,'../..');
const template=fs.readFileSync(path.join(out,'review-template.html'),'utf8');
function cameraFixture(f){
    const ts=compiler(),source=fs.readFileSync(path.join(root,'assets/scripts/camera/RaceEventPictureInPictureCamera.ts'),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'');
    const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Vec3:f.Vec3,Color:class{}});
    const c=Object.create(exports.RaceEventPictureInPictureCamera.prototype);
    Object.assign(c,{options:{course:f.course},cameraPosition:new f.Vec3(),focus:new f.Vec3(),cannonProjectilePosition:new f.Vec3(),applyCameraPose(v){this.fov=v}});
    return c;
}
const onlyIndex=process.argv.indexOf('--only');const only=onlyIndex>=0?process.argv[onlyIndex+1]:null;
for(const kind of ['cannon','buoy']){
    if(only&&kind!==only)continue;
    const f=fixture(kind),h=createSplashHarness(),frames=[],geometries=[],lookup=new Map();
    f.p.waterSplashes=h.pool;
    let camera=null;
    if(kind==='cannon'){Object.assign(f.course,{poolWidth:8,startX:-4,finishX:4});f.p.standWorldX=0;f.p.reset();f.p.beginEntrance();camera=cameraFixture(f)}
    else{f.states[0].courseX=0;f.states[1].active=f.states[1].armed=false}
    function collect(g,m,name){if(!g)return null;if(!lookup.has(g)){lookup.set(g,geometries.length);geometries.push(g)}return{mesh:lookup.get(g),matrix:m,name};}
    const total=kind==='cannon'?6:4.4,shot={strikeId:0,targetDistance:4,targetZ:0,warningSeconds:1.25,revision:1};
    for(let i=0;i<=Math.round(total*20);i++){
        const t=i/20;
        if(kind==='cannon'){
            if(i===40){f.p.showLaunch(shot);Object.assign(camera,{cannonTargetX:4,cannonTargetZ:0,cannonSourceX:f.p.launchSource.x,cannonSourceY:f.p.launchSource.y,cannonSourceZ:f.p.launchSource.z,cannonProjectile:f.p.projectile})}
            if(i===65){f.p.showImpact({strikeId:0,hitMask:1,knockedLane:0,revision:2});}
            if(i===88)f.p.beginExit();
            f.p.update(i===0?0:.05,i>=40&&i<65?shot:null,Math.max(0,3.25-t),true);
            if(i>=40&&i<=65){camera.updateCannonCameraPose(Math.min(1,(t-2)/1.25),4)}
        }else{
            if(i===60){f.states[0].active=f.states[0].armed=false;f.p.showImpact({mineId:0,courseX:0,lateral:0,hitMask:1,hitLane:0,revision:1},f.states[0],1)}
            f.p.update(i===0?0:.05,f.states,true);
        }
        if(i>0)h.pool.update(.05);
        const parts=f.snapshot().map(n=>collect(n.geometry,n.matrix,n.name));
        for(const n of h.snapshot())parts.push(collect(h.meshes[n.mesh].geometry,n.matrix,n.name));
        frames.push({time:t,parts:parts.filter(Boolean),phase:kind==='cannon'?(t<1.8?'水炮入场':t<2?'就位':t<2.28?'发射与回弹':t<3.25?'水球飞行':t<4.2?'落点喷水':t<4.4?'待退场':t<5.6?'退场':'已隐藏'):(t<.28?'水下扰动':t<1?'破水上浮':t<1.3?'回落稳定':t<3?'共享漂浮':t<3.3?'触碰喷水与下潜':t<3.95?'水面余波':'已退出'),
            camera:camera&&t>=2&&t<=4.2?{eye:[camera.cameraPosition.x,camera.cameraPosition.y,camera.cameraPosition.z],target:[camera.focus.x,camera.focus.y,camera.focus.z],fov:camera.fov}:null});
    }
    const crowdFrames=[];
    if(kind==='buoy'){
        const crowd=fixture('buoy',7),water=createSplashHarness();crowd.p.waterSplashes=water.pool;
        for(let id=0;id<7;id++){crowd.states[id].courseX=(id%3-1)*2.2;crowd.states[id].lateral=(Math.floor(id/3)-1)*2.2;}
        for(let i=0;i<=Math.round(total*20);i++){
            if(i===60){const state=crowd.states[0];state.active=state.armed=false;crowd.p.showImpact({mineId:0,courseX:state.courseX,lateral:state.lateral,hitMask:1,hitLane:0,revision:1},state,1);}
            crowd.p.update(i===0?0:.05,crowd.states,true);if(i>0)water.pool.update(.05);
            const parts=crowd.snapshot().map(n=>collect(n.geometry,n.matrix,n.name));
            for(const n of water.snapshot())parts.push(collect(water.meshes[n.mesh].geometry,n.matrix,n.name));
            crowdFrames.push({...frames[i],parts:parts.filter(Boolean)});
        }
    }
    const asset=kind==='cannon'?'WaterBallCannon':'SprayBuoy';
    const views=['front','back','left','right','top','bottom','review','icon'].map(view=>({view,url:'data:image/png;base64,'+fs.readFileSync(path.join(out,asset+'-'+view+'.png')).toString('base64')}));
    const data={kind,title:kind==='cannon'?'运动场水炮':'气球喷水浮标',total,geometries,frames,crowdFrames,views,audit:JSON.parse(fs.readFileSync(path.join(out,'asset-audit.json'),'utf8'))[asset],
        popSound:kind==='buoy'?'data:audio/wav;base64,'+fs.readFileSync(path.join(out,'buoy_balloon_pop.wav')).toString('base64'):null,
        reference:JSON.parse(fs.readFileSync(path.join(root,'art/water-splash-b2/recovery-reference.json'),'utf8'))};
    fs.writeFileSync(path.join(out,kind+'-review.html'),template.replace('/*__DATA__*/',JSON.stringify(data)).replaceAll('__TITLE__',data.title));
}
console.log('已导出'+(only==='buoy'?'浮标':only==='cannon'?'水炮':'两套')+'自包含预览，动作与 B2 水花来自实际方法采样。');
