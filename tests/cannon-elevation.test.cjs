const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./helpers/water-play-harness.cjs');
const launch={strikeId:0,targetDistance:40,targetZ:2,warningSeconds:1.25,revision:1};
function world(f,node,x,y,z){return f.Vec3.transformMat4(new f.Vec3(),new f.Vec3(x,y,z),node.worldMatrix)}

test('两岸远近落点的炮口仰角沿真实起始切线，水球从喷管端面出发',()=>{
    const f=fixture('cannon');let id=0,minPitch=90,maxPitch=0;
    for(const x of [3,10,25,40,47])for(const z of [-8,0,8])for(const side of [0,1]){
        id+=2;const shot={...launch,strikeId:id+side,targetDistance:x,targetZ:z};f.p.showLaunch(shot);
        const nozzle=f.p.nozzles[side],muzzle=world(f,nozzle,0,0,1.02),origin=world(f,nozzle,0,0,0);
        const axis=f.Vec3.normalize(new f.Vec3(),f.Vec3.subtract(new f.Vec3(),muzzle,origin));
        assert.ok(f.Vec3.equals(muzzle,f.p.projectile.worldPosition),'球心应在可见喷口中心');
        const pitch=Math.asin(axis.y)*180/Math.PI;assert.ok(pitch>25&&pitch<85);minPitch=Math.min(minPitch,pitch);maxPitch=Math.max(maxPitch,pitch);
        const t=.0001;f.p.update(.05,shot,shot.warningSeconds*(1-t),true);
        const direction=f.Vec3.normalize(new f.Vec3(),f.Vec3.subtract(new f.Vec3(),f.p.projectile.worldPosition,muzzle));
        assert.ok(f.Vec3.dot(axis,direction)>.99999999,`落点 ${x}/${z}、岸侧 ${side} 出射方向不一致`);
        f.p.update(.3,shot,0,true);assert.ok(f.Vec3.equals(f.p.projectile.worldPosition,new f.Vec3(x,.12,z)),'落点高度、横纵位置保持');
    }
    assert.ok(maxPitch-minPitch>25,'近处更陡，远处更平');
});

test('回弹沿抬高的炮管轴线，加载和快照保留仰角，重开恢复就位姿态',()=>{
    const f=fixture('cannon');f.p.showLaunch(launch);const n=f.p.nozzles[0];
    const start={...f.p.launchSource},origin=world(f,n,0,0,0),muzzle=world(f,n,0,0,1.02);
    const axis=f.Vec3.normalize(new f.Vec3(),f.Vec3.subtract(new f.Vec3(),muzzle,origin));
    f.p.update(.05,launch,1.20,true);assert.ok(n.position.y<1.04&&n.position.z<0);
    const recoil=f.Vec3.normalize(new f.Vec3(),f.Vec3.subtract(new f.Vec3(),world(f,n,0,0,0),origin));
    assert.ok(f.Vec3.dot(axis,recoil)<-.99999999);assert.deepEqual({...f.p.launchSource},start);
    const matrix=Array.from(f.Mat4.toArray([],n.worldMatrix));f.ready();assert.deepEqual(Array.from(f.Mat4.toArray([],n.worldMatrix)),matrix);
    f.p.update(.05,launch,.2,true);assert.equal(n.position.y,1.04);assert.equal(n.position.z,0);
    f.p.beginExit();assert.equal(n.position.y,1.04);f.p.reset();
    assert.ok(Math.abs(n.eulerAngles.x+40)<.0001);assert.equal(f.p.projectileNode,null);
});

test('可编辑源与运行时都保留独立俯仰喷管，转轴、喷口和资源身份一致',()=>{
    const bytes=fs.readFileSync('art/water-play-obstacles/WaterBallCannon.glb');
    assert.deepEqual(bytes,fs.readFileSync('assets/race/items/WaterBallCannon.glb'));
    const g=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12))),n=g.nodes.find(n=>n.name==='CannonNozzle');
    assert.equal(g.meshes.length,2);assert.equal(g.materials.length,1);assert.equal(g.textures?.length||0,0);
    assert.ok(n.rotation,'喷管保留可编辑旋转');
    const [qx,qy,qz,qw]=n.rotation;
    assert.ok(Math.abs(2*(qy*qz-qx*qw)-Math.sin(40*Math.PI/180))<1e-6,'GLB 喷管正向朝天');
    assert.ok(Math.abs(n.translation[1]-1.04)<1e-6);
    const audit=JSON.parse(fs.readFileSync('art/water-play-obstacles/asset-audit.json')).WaterBallCannon;
    assert.equal(audit.triangles,1332);assert.deepEqual(audit.pivot,[0,1.04,0]);assert.deepEqual(audit.muzzleInNozzle,[0,0,1.02]);
    const geometry=JSON.parse(fs.readFileSync('art/water-play-obstacles/geometry.json')).WaterBallCannon.CannonNozzle;
    const y=geometry.positions.filter((v,i)=>i%3===1);assert.ok(Math.max(...y)<.45&&Math.min(...y)>-.45,'喷管网格原点应在转轴');
});
