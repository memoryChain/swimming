const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {createSplashHarness,compiler} = require('./helpers/water-splash-harness.cjs');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} 与 ${b} 不一致`);
function request(h,extra={}) { return {owner:h.ENTERTAINMENT_SPLASH_OWNER.TIMED_BOMB,profile:h.ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION,
    position:new h.Vec3(12,.035,-3),explosionCorePosition:new h.Vec3(12,-.8,-3),...extra}; }
const live=h=>h.pool.slots.filter(s=>s.root.active);
function step(h,seconds) { while(seconds>1e-8) {const dt=Math.min(.05,seconds);h.pool.update(dt);seconds-=dt;} }

test('真实网格与槽位预算：轻4重3冲击3、单材质、无球壳或暖色核心',()=>{
    const h=createSplashHarness(), b=h.budget();
    assert.deepEqual(h.pool.slots.reduce((m,s)=>(m[s.profile]=(m[s.profile]||0)+1,m),{}),{'light-entry':4,'heavy-entry':3,explosion:3});
    assert.equal(b.meshes,6);assert.equal(b.materials,1);assert.equal(b.nodes,29);assert.equal(b.renderers,19);
    assert.equal(b.peakTriangles,2808);assert.ok(b.peakTriangles<=2868);
    assert.deepEqual(b.geometry.map(g=>g.triangles),[96,192,328,56,136,96]);
    for(const mesh of h.meshes){const g=mesh.geometry;
        assert.equal(g.positions.length/3,g.colors.length/4);
        for(const i of g.indices)assert.ok(i>=0&&i<g.positions.length/3);
        for(let i=0;i<g.positions.length;i+=3)for(let axis=0;axis<3;axis++) {
            const key=['x','y','z'][axis];assert.ok(g.positions[i+axis]>=g.minPos[key]-1e-6&&g.positions[i+axis]<=g.maxPos[key]+1e-6,'网格包围盒必须覆盖顶点');
        }
    }
    for(const index of [2,4,5])for(let i=0;i<h.meshes[index].geometry.colors.length;i+=4){
        const c=h.meshes[index].geometry.colors;assert.ok(c[i]<=c[i+1]&&c[i+1]<=c[i+2],'只能白蓝青水体');
    }
    // 局部反馈由12个互不连接的小水块组成，不能退回一个包住人的球壳。
    const g=h.meshes[5].geometry;
    for(let i=0;i<g.indices.length;i+=3)assert.equal(new Set(g.indices.slice(i,i+3).map(n=>Math.floor(n/6))).size,1);
});

test('水面、空中、水下局部反馈锁定世界位置；外部向量和携带者移动不改变事件',()=>{
    const h=createSplashHarness();h.root.setPosition(10,1,-2);h.root.setRotationFromEuler(0,20,0);
    for(const height of [0,1.8,-.8]){
        const r=request(h,{explosionCorePosition:new h.Vec3(13,height,-2),yawDegrees:73});h.pool.play(r);
        const s=live(h).at(-1),p=new h.Vec3();s.explosionCore.getWorldPosition(p);near(p.x,13);near(p.y,height);near(p.z,-2);
        r.position.set(999,99,999);r.explosionCorePosition.set(-99,50,99);h.pool.update(.1);
        s.root.getWorldPosition(p);near(p.x,12);near(p.y,.035);near(p.z,-3);
        s.explosionCore.getWorldPosition(p);near(p.x,13);near(p.y,height);near(p.z,-2);
    }
    h.pool.reset();h.pool.play(request(h,{explosionCorePosition:undefined}));
    assert.equal(live(h)[0].explosionCore.active,false);assert.equal(live(h)[0].body.active,true);
});

test('duration、方向、缩放、layer及owner轮廓偏置兼容；强度仍完整相乘',()=>{
    const h=createSplashHarness();
    for(const owner of ['timed-bomb','cannon','minefield']) {
        h.pool.play(request(h,{owner,duration:1.9,intensity:1.25,radialScale:.6,verticalScale:1.4,yawDegrees:81,layer:512}));
        const s=live(h).at(-1);assert.equal(s.duration,1.9);near(s.root.eulerAngles.y,81);
        for(const n of [s.root,s.body,s.ring,s.explosionCore])assert.equal(n.layer,512);
        near(s.body.scale.x,.2*1.25*.6*(owner==='cannon'?1.08:1));
        near(s.body.scale.y,.08*1.25*1.4*(owner==='minefield'?1.14:1));
        near(s.explosionCore.scale.x,.16*1.25*.6*(owner==='timed-bomb'?1.1:1));
    }
    step(h,.65);assert.ok(live(h).every(s=>!s.explosionCore.active&&s.body.active));
    step(h,.55);assert.ok(live(h).every(s=>!s.body.active&&s.ring.active));
    step(h,.8);assert.equal(live(h).length,0);
    h.pool.play(request(h));assert.equal(live(h)[0].root.layer,h.root.layer);
    near(live(h)[0].body.position.y,0);near(live(h)[0].ring.position.y,0);
});

test('新事件不扣掉触发前已累计时间；20Hz采样、空闲零节点写入',()=>{
    const h=createSplashHarness();h.pool.play(request(h,{duration:1}));h.pool.update(.04);
    h.pool.play(request(h,{owner:'cannon',duration:1}));h.pool.update(.01);
    near(live(h)[0].remaining,.95);near(live(h)[1].remaining,.99);
    const writes=()=>h.nodes.reduce((n,x)=>n+x.writes,0),before=writes();h.pool.update(.01);assert.equal(writes(),before);
    h.pool.reset();const idle=writes();for(let i=0;i<120;i++)h.pool.update(1/60);assert.equal(writes(),idle);
});

test('超过3次触发复用剩余最短槽位；owner取消独立，20轮重开无节点或材质增长',()=>{
    const h=createSplashHarness(),budget=h.budget();
    for(let round=0;round<20;round++){
        h.pool.play(request(h,{owner:'cannon',duration:.3}));const reused=live(h)[0].root;
        h.pool.play(request(h,{owner:'minefield',duration:.8}));h.pool.play(request(h,{duration:.6}));
        h.pool.play(request(h,{owner:'cannon',duration:1}));assert.equal(live(h).length,3);
        assert.equal(live(h).find(s=>s.owner==='cannon').root,reused);
        h.pool.cancelOwner('cannon');assert.deepEqual(live(h).map(s=>s.owner).sort(),['minefield','timed-bomb']);
        h.pool.reset();assert.equal(h.pool.activeCount,0);assert.equal(live(h).length,0);assert.deepEqual(h.budget(),budget);
    }
    h.pool.dispose();h.pool.dispose();h.pool.play(request(h));h.pool.reset();h.pool.update(1);
    assert.ok(h.nodes.slice(1).every(n=>!n.isValid));assert.ok([...h.meshes,...h.materials].every(x=>x.destroyCount===1));
});

test('主体在0.59秒前落下，碎水先退，余波沉降；浮圈搭稳时只剩低水纹',()=>{
    const h=createSplashHarness();h.pool.play(request(h));const s=live(h)[0];
    step(h,.15);const peak=s.body.scale.y;assert.ok(s.explosionCore.active);
    step(h,.2);assert.equal(s.explosionCore.active,false);assert.equal(s.body.active,true);
    step(h,.2);assert.ok(s.body.scale.y<peak);assert.ok(s.body.position.y<0);
    step(h,.1);assert.equal(s.body.active,false);assert.equal(s.ring.active,true);
    step(h,.1);assert.ok(s.ring.position.y<0);
    const maxHeight=h.meshes[4].geometry.maxPos.y*s.ring.scale.y+s.ring.position.y+s.root.position.y;
    assert.ok(maxHeight<.2,'扶圈稳定期只能留下贴水余波');
    step(h,.25);assert.equal(s.root.active,false);
});

test('轻落水、重落水、纯波纹的时长与原轮廓保持，隐藏水体不更新',()=>{
    const h=createSplashHarness();
    const old=createSplashHarness(fs.readFileSync(path.join(__dirname,'../art/water-splash-b2/baseline-water-splash.ts.txt'),'utf8'));
    for(const i of [0,1,3])assert.equal(JSON.stringify(h.meshes[i].geometry),JSON.stringify(old.meshes[i].geometry),'轻／重网格和颜色必须逐值一致');
    for(const [profile,duration] of [['light-entry',.42],['heavy-entry',.56]]) {
        h.pool.play(request(h,{profile,owner:'litter'}));const s=live(h).at(-1);
        assert.equal(s.duration,duration);assert.equal(s.explosionCore,null);
        const progress=.1/duration,expand=1-Math.pow(1-progress,3),crest=Math.sin(progress*Math.PI);
        h.pool.update(.1);
        near(s.body.scale.x,profile==='light-entry'?.22+expand*.88:.24+expand*1.04);
        near(s.body.scale.y,profile==='light-entry'?.18+crest*.72:.18+crest*1.05);
        h.pool.reset();
    }
    for(const profile of ['light-entry','heavy-entry','explosion']) {
        h.pool.play(request(h,{profile,rippleOnly:true}));const s=live(h)[0],writes=s.body.writes;
        h.pool.update(.1);assert.equal(s.body.active,false);assert.equal(s.body.writes,writes);
        if(s.explosionCore)assert.equal(s.explosionCore.active,false);
        if(s.ring)assert.equal(s.ring.active,true);h.pool.reset();
    }
});

// 提取并执行现有调用方的真实方法和数值常量，隔离无关的模型制作构造函数。
function caller(h,file,methods) {
    const ts=compiler(),text=fs.readFileSync(path.join(h.repoRoot,'assets/scripts/core',file),'utf8');
    const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    const cls=ast.statements.find(n=>ts.isClassDeclaration(n));
    const selected=cls.members.filter(n=>methods.includes(n.name?.getText(ast)));
    assert.equal(selected.length,methods.length);
    const constants=ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.every(d=>d.initializer&&ts.isNumericLiteral(d.initializer))).map(n=>n.getText(ast)).join('\n');
    const js=ts.transpileModule(`${constants}\nclass Caller {${selected.map(n=>n.getText(ast)).join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    return vm.runInNewContext(`${js};Caller`,{...h});
}
test('炮火、水雷、定时道具的真实触发方法均驱动同一池，位置和强度不变',()=>{
    const h=createSplashHarness(),course={waterY:0,distanceToWorldX:d=>100-d};
    const Cannon=caller(h,'CannonBrawlPresentation.ts',['showImpact']);const c=new Cannon();
    Object.assign(c,{waterSplashes:h.pool,course,parent:h.root,activeStrikeId:3,lastStrikeId:3,targetX:80,targetZ:2,impactWorldPosition:new h.Vec3(),setActive(){}});
    c.showImpact({strikeId:3});const cannon=live(h)[0];assert.equal(cannon.intensity,1.08);near(cannon.root.position.x,80);assert.equal(cannon.explosionCore.active,false);
    const f=require('./helpers/water-play-harness.cjs').fixture(),m=f.p,mine=m.mineNodes[0];mine.setPosition(80,-.4,2);mine.active=true;
    Object.assign(m,{waterSplashes:h.pool,course});
    m.showImpact({mineId:0,courseX:20,lateral:2,revision:1});const field=live(h)[1];assert.equal(field.intensity,1);near(field.explosionCore.getWorldPosition(new h.Vec3()).y,-.4+.25);
    mine.setScale(1,1,1);
    const Timed=caller(h,'MineRelayBrawlPresentation.ts',['showResolution','visualNode']);const t=new Timed();
    const body=new h.Node('BalloonBody');body.setParent(mine);body.setPosition(0,.14,0);
    Object.assign(t,{waterSplashes:h.pool,course,worldRoot:h.root,arm:{roundId:5},root:mine,body,model:{},inflation:1,centerLocal:new h.Vec3(),explosionCoreWorldPosition:new h.Vec3(),resolutionWorldPosition:new h.Vec3(),detachMine(){mine.active=false;}});
    t.showResolution(true,new h.Vec3(80,.035,2));const timed=live(h)[2];assert.equal(timed.intensity,1.25);near(timed.root.position.y,.035);near(timed.explosionCore.getWorldPosition(new h.Vec3()).y,-.4+.14+.245);
    mine.setPosition(999,9,999);h.pool.update(.1);near(timed.explosionCore.getWorldPosition(new h.Vec3()).x,80);
});
