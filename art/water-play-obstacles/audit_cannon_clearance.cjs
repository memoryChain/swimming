// 使用正式场馆三角面和实际水炮相机方法；此脚本不访问 Creator。
const fs = require('node:fs');
const path = require('node:path');
const { makeReview, rayHit } = require('../../tests/helpers/cannon-venue-review.cjs');
const vec = v => [v.x, v.y, v.z];
const sub = (a, b) => a.map((v, k) => v - b[k]);
const dot = (a, b) => a.reduce((n, v, k) => n + v * b[k], 0);
const length = v => Math.hypot(...v);
const norm = v => v.map(n => n / length(v));
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function possible(a, b, mesh) {
    let lo = 0, hi = 1;
    for (let k = 0; k < 3; k++) {
        const d = b[k] - a[k];
        if (Math.abs(d) < 1e-8) { if (a[k] < mesh.min[k] || a[k] > mesh.max[k]) return false; continue; }
        const u = (mesh.min[k]-a[k])/d, v = (mesh.max[k]-a[k])/d;
        lo = Math.max(lo, Math.min(u,v)); hi = Math.min(hi, Math.max(u,v));
        if (lo > hi) return false;
    }
    return true;
}
function review() {
    const { f, camera, meshes } = makeReview({ includeAllMeshes: true });
    const { camera: before } = makeReview({ cameraSourceTransform: s => s.replace('this.constrainCannonCameraPose();', '') });
    const architecture = meshes.filter(m => !m.ceiling && !/floor|ground|lane|inner_wall|pool_edge|podium/i.test(m.name));
    for (const mesh of architecture) {
        mesh.min = [0,1,2].map(k => Math.min(...mesh.points.map(p => p[k])));
        mesh.max = [0,1,2].map(k => Math.max(...mesh.points.map(p => p[k])));
    }
    const shots = [], hits = [], projectionFailures = [], foreground = { before: 0, after: 0 };
    let samples = 0, bounded = 0, minDistanceChange = Infinity;
    const tan = Math.tan(52*Math.PI/360);
    for (const side of [0,1]) for (const x of [2.8,10,25,40,47.2]) for (const z of [-9.8,0,9.8]) for (const direction of [1,-1]) {
        f.course.directionAtDistance = () => direction;
        // 两份镜头消费同一份课程和同一个实际水球节点。
        before.options.course = f.course;
        const launch = { strikeId: shots.length*2+side, targetDistance: x, targetZ: z, warningSeconds: 1.25 };
        f.p.showLaunch(launch);
        for (const c of [camera,before]) Object.assign(c, { cannonSourceX: f.p.sourceX, cannonSourceY: f.p.sourceY,
            cannonSourceZ: f.p.sourceZ, cannonTargetX: x, cannonTargetZ: z, cannonProjectile: f.p.projectile });
        const frames = [];
        for (let i=0; i<=25; i++) {
            const t=i/25;
            f.p.projectile.setWorldPosition(f.p.sourceX+(x-f.p.sourceX)*t,
                f.p.sourceY+(.27-f.p.sourceY)*t+Math.sin(Math.PI*t)*5.8, f.p.sourceZ+(z-f.p.sourceZ)*t);
            camera.updateCannonCameraPose(t,x); before.updateCannonCameraPose(t,x); samples++;
            const eye=vec(camera.cameraPosition), oldEye=vec(before.cameraPosition), focus=vec(camera.focus), ball=vec(f.p.projectile.worldPosition);
            if (eye[0]>=2.8-1e-8 && eye[0]<=47.2+1e-8 && Math.abs(eye[2])<=8.5+1e-8 && eye[1]>=8.15-1e-8) bounded++;
            minDistanceChange=Math.min(minDistanceChange,length(sub(eye,focus))-length(sub(oldEye,focus)));
            const forward=norm(sub(focus,eye)),right=norm(cross(forward,[0,1,0])),up=cross(right,forward);
            const points=[['水球',ball],['落点',[x,.2,z]]];
            for(let j=0;j<8;j++) {
                const a=j*Math.PI/4;
                points.push(['水球边缘',ball.map((v,k)=>v+.27*(right[k]*Math.cos(a)+up[k]*Math.sin(a)))]);
                points.push(['核心边缘',[x+1.05*Math.cos(a),.2,z+.82*Math.sin(a)]]);
            }
            for(const [subject,target] of points) {
                const delta=sub(target,eye),depth=dot(delta,forward),sx=dot(delta,right)/(depth*tan*16/9),sy=dot(delta,up)/(depth*tan);
                if(!(depth>0&&Math.abs(sx)<1&&Math.abs(sy)<1)) projectionFailures.push({side,x,z,direction,t,subject,sx,sy});
                for(const mesh of architecture) if(possible(eye,target,mesh)&&rayHit(eye,target,mesh)) hits.push({side,x,z,direction,t,subject,obstacle:mesh.name});
            }
            for(const [label,e] of [['before',oldEye],['after',eye]]) {
                const fw=norm(sub(focus,e)),rt=norm(cross(fw,[0,1,0])),u=cross(rt,fw);
                for(const sx of [-.8,-.6,-.4,-.2,0,.2,.4,.6,.8]) for(const sy of [-.6,-.3,0,.3,.6]) {
                    const d=norm(fw.map((v,k)=>v+sx*tan*16/9*rt[k]+sy*tan*u[k])),end=e.map((v,k)=>v+d[k]*8);
                    if(architecture.some(mesh=>possible(e,end,mesh)&&rayHit(e,end,mesh))) foreground[label]++;
                }
            }
            frames.push({t,eye,before:oldEye,target:focus,ball,fov:52});
        }
        shots.push({name:`${side?'右':'左'}岸 → ${x} 米／横向 ${z} 米 · ${direction>0?'去程':'返程'}`,x,z,side,direction,frames});
    }
    return { shots, meshes, summary: { samples, bounded, minDistanceChange, hits, projectionFailures, foreground,
        scope: '正式场馆静态三角面；水球及核心轮廓视线、投影与8米内画面前景采样。顶棚按现有相机过滤；水面、泳道绳和人物不作建筑遮挡。非引擎／真机验证。' } };
}
if (require.main === module) {
    const result=review();
    fs.writeFileSync(path.join(__dirname,'cannon-clearance-audit.json'),JSON.stringify(result.summary,null,2)+'\n');
    fs.writeFileSync(path.join(__dirname,'cannon-clearance-frames.json'),JSON.stringify(result.shots));
    const oldTemplate=fs.readFileSync(path.join(__dirname,'cannon-polish-template.html'),'utf8');
    const rendering=oldTemplate.slice(oldTemplate.indexOf('const $='),oldTemplate.indexOf("const renderers="));
    const data={shots:result.shots,buildings:result.meshes.filter(m=>!m.ceiling).map(m=>({name:m.name,positions:m.points.flat(),indices:m.indices})),
        ball:JSON.parse(fs.readFileSync(path.join(__dirname,'geometry.json'))).CannonWaterBall.WaterBallSurface};
    fs.writeFileSync(path.join(__dirname,'cannon-clearance-review.html'),fs.readFileSync(path.join(__dirname,'cannon-clearance-template.html'),'utf8')
        .replace('/*__RENDERER__*/',rendering).replace('/*__DATA__*/',JSON.stringify(data)));
    console.log(JSON.stringify(result.summary));
    if(result.summary.hits.length||result.summary.projectionFailures.length||result.summary.bounded!==result.summary.samples) process.exitCode=1;
}
module.exports={review};
