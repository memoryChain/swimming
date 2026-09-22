// 真实表现／相机与正式场馆的离线审查；不启动或截图 Creator。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function fixtureFrom(file) {
    const full = path.join(root, file), source = fs.readFileSync(full, 'utf8').split('\ntest(')[0];
    const module = { exports: {} };
    const localRequire = require('node:module').createRequire(full);
    vm.runInThisContext(`(function(require,module,__dirname){${source}\nmodule.exports=fixture;})`)(localRequire, module, path.dirname(full));
    return module.exports;
}
const { makeReview, rayHit } = require('../tests/helpers/cannon-venue-review.cjs');
const { f: math, meshes: buildings } = makeReview();
const makePresentation = fixtureFrom('tests/litter-presentation.test.cjs');
const makeCamera = fixtureFrom('tests/litter-camera-continuity.test.cjs');
const shots = [], report = { trajectorySamples: 0, outsideFrame: 0, obstructed: 0, examples: [] };
for (const direction of [1, -1]) for (const startX of [3, 10, 25, 40, 47]) {
    const f = makePresentation(), { camera } = makeCamera();
    camera.options.course.direction = direction;
    const frames = [], q = new math.Quat(), v = new math.Vec3();
    f.clusters.forEach((c, id) => {
        c.active = id < 12;
        c.courseX = c.anchorCourseX = Math.max(1.2, Math.min(48.8, startX + Math.floor(id / 6) * direction * 6 + (id % 3 - 1) * .7));
        c.throwSide = id % 2 ? 1 : -1;
        c.lateral = c.anchorLateral = c.throwSide * (2 + Math.floor(id % 6 / 2) * 2);
    });
    for (let frame = 0; frame <= 120; frame++) {
        const time = frame / 30;
        for (const c of f.clusters) {
            const waveAge = time - Math.floor(c.id / 6) * 1.6;
            c.active = c.id < 12 && waveAge >= 0;
            const age = waveAge - Math.floor(c.id % 6 / 2) * .34;
            c.phase = age < 1.35 ? 'falling' : 'floating'; c.phaseProgress = Math.min(1, age / 1.35);
        }
        f.presentation.update(1 / 30, f.clusters, true);
        camera.updateLitter(f.clusters, true, 1 / 30);
        const eye = camera.cameraPosition, target = camera.focus;
        const forward = math.Vec3.normalize(new math.Vec3(), math.Vec3.subtract(new math.Vec3(), target, eye));
        const right = math.Vec3.normalize(new math.Vec3(), math.Vec3.cross(new math.Vec3(), forward, new math.Vec3(0,1,0)));
        const up = math.Vec3.cross(new math.Vec3(), right, forward);
        const nodes = [];
        for (const c of f.clusters) {
            const n = f.root.children[c.id]; if (!n.active) continue;
            math.Quat.fromEuler(q, n.rotation.x, n.rotation.y, n.rotation.z);
            const g = n.renderer.mesh.data, vertices = [];
            for (let i = 0; i < g.positions.length; i += 3) {
                v.set(g.positions[i] * n.scale.x, g.positions[i+1] * n.scale.y, g.positions[i+2] * n.scale.z);
                math.Vec3.transformQuat(v, v, q); vertices.push(v.x+n.position.x,v.y+n.position.y,v.z+n.position.z);
            }
            nodes.push({ positions: vertices, indices: g.indices, colors: g.colors });
            // 已建立的主拍波次；下一波在背景出现时不要求全部进入画幅。
            if (c.wave !== camera.litterWave || c.phase !== 'falling') continue;
            const delta = new math.Vec3(n.position.x-eye.x,n.position.y-eye.y,n.position.z-eye.z);
            const depth = math.Vec3.dot(delta, forward), tan = Math.tan(54*Math.PI/360);
            const outside = depth <= 0 || Math.abs(math.Vec3.dot(delta,right)) > depth*tan*16/9*.97
                || Math.abs(math.Vec3.dot(delta,up)) > depth*tan*.97;
            const obstruction = buildings.find(b => !b.ceiling && rayHit([eye.x,eye.y,eye.z],[n.position.x,n.position.y,n.position.z],b));
            report.trajectorySamples++;
            if(outside) report.outsideFrame++;
            if(obstruction) report.obstructed++;
            if((outside || obstruction) && report.examples.length < 8) report.examples.push({direction,startX,time,id:c.id,outside,obstruction:obstruction?.name});
        }
        frames.push({eye:[eye.x,eye.y,eye.z],target:[target.x,target.y,target.z],nodes,active:camera.active});
    }
    shots.push({name:`${direction > 0 ? '正向' : '反向'} · ${startX} 米`,frames});
}
const output = path.join(root,'art/litter-debris');
fs.writeFileSync(path.join(output,'airborne-camera-audit.json'), JSON.stringify(report,null,2));
const template = fs.readFileSync(path.join(root,'art/water-play-obstacles/cannon-polish-template.html'),'utf8');
const renderer = template.slice(template.indexOf('const $=id=>'),template.indexOf("const renderers="));
const data = {shots,buildings:buildings.filter(b=>!b.ceiling).map(b=>({positions:b.points.flat(),indices:b.indices}))};
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>垃圾高抛与低机位检查</title>
<style>body{background:#112a39;color:#e5f8ff;font:16px/1.6 system-ui;margin:24px}main{max-width:1000px;margin:auto}canvas{display:block;max-width:100%;margin:12px 0}select,button{font:inherit;padding:6px}input{width:70%}</style>
<main><h1>垃圾高抛与低机位检查</h1><p>真实垃圾轨迹、镜头与场馆建筑的独立离线预览；简化水面，不含观众角色、正式水体与落水粒子，不是真机实录。</p>
<select id="shot"></select><button id="play">暂停</button><input id="time" type="range" min="0" max="120" value="0"><span id="stamp"></span>
<canvas id="large" width="960" height="540"></canvas><p>下方为原始 256 × 144 画中画大小：</p><canvas id="small" width="256" height="144"></canvas></main><script>
const DATA=${JSON.stringify(data)};
${renderer}
const displays=['large','small'].map(renderer),water={positions:[0,.055,-10.5,50,.055,-10.5,0,.055,10.5,50,.055,10.5],indices:[0,1,2,2,1,3]};
DATA.shots.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=s.name;$('shot').append(o)});$('shot').value='2';
let playing=true,time=0,last=performance.now();function draw(){const frame=DATA.shots[+$('shot').value].frames[Math.floor(time)];$('stamp').textContent=(time/30).toFixed(2)+' 秒';$('time').value=Math.floor(time);for(const r of displays){r.begin(frame.eye,frame.target,54);for(const b of DATA.buildings)r.draw(b,[.20,.31,.40,1]);r.draw(water,[.02,.33,.47,1]);for(const n of frame.nodes)r.draw(n,[1,1,1,1]);}window.reviewErrors=displays.map(r=>r.gl.getError())}
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'暂停':'播放'};$('time').oninput=()=>{time=+$('time').value;playing=false;draw()};$('shot').onchange=draw;
window.setLitterReview=(shot,frame)=>{playing=false;$('shot').value=shot;time=frame;draw()};function tick(now){if(playing)time=(time+Math.min(.1,(now-last)/1000)*30)%121;last=now;draw();requestAnimationFrame(tick)}draw();requestAnimationFrame(tick);
</script></html>`;
fs.writeFileSync(path.join(output,'airborne-camera-review.html'),html);
console.log(JSON.stringify(report,null,2));
if(report.outsideFrame || report.obstructed) process.exitCode=1;
