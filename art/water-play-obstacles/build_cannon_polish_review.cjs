// 正式场馆几何与实际相机方法的独立对照页；不启动 Creator。
const fs=require('fs'),path=require('path');
const {makeReview}=require('../../tests/helpers/cannon-venue-review.cjs');
const {f,camera:c,meshes}=makeReview(),shots=[];
for(const side of [0,1])for(const x of [3,25,47]){
    const id=shots.length*2+side,shot={strikeId:id,targetDistance:x,targetZ:8,warningSeconds:1.25};
    f.p.showLaunch(shot);Object.assign(c,{cannonSourceX:f.p.sourceX,cannonSourceY:f.p.sourceY,cannonSourceZ:f.p.sourceZ,cannonTargetX:x,cannonTargetZ:8,cannonProjectile:f.p.projectile});
    const frames=[];
    for(let i=0;i<=40;i++){
        const t=i/40;f.p.projectile.setWorldPosition(f.p.sourceX+(x-f.p.sourceX)*t,f.p.sourceY+(.27-f.p.sourceY)*t+Math.sin(Math.PI*t)*5.8,f.p.sourceZ+(8-f.p.sourceZ)*t);
        c.updateCannonCameraPose(t,x);frames.push({eye:[c.cameraPosition.x,c.cameraPosition.y,c.cameraPosition.z],target:[c.focus.x,c.focus.y,c.focus.z],fov:c.fov,ball:[f.p.projectile.worldPosition.x,f.p.projectile.worldPosition.y,f.p.projectile.worldPosition.z]});
    }
    shots.push({name:(side?'右侧':'左侧')+'发射 · 落点 '+x+' 米',x,frames});
}
const data={shots,buildings:meshes.map(m=>({name:m.name,ceiling:m.ceiling,positions:m.points.flat(),indices:m.indices})),ball:JSON.parse(fs.readFileSync(path.join(__dirname,'geometry.json'))).CannonWaterBall.WaterBallSurface,old:f.cc.primitives.sphere(.25,{segments:12})};
fs.writeFileSync(path.join(__dirname,'cannon-polish-review.html'),fs.readFileSync(path.join(__dirname,'cannon-polish-template.html'),'utf8').replace('/*__DATA__*/',JSON.stringify(data)));
console.log('已生成正式场馆视线与水球细节对照页。');
