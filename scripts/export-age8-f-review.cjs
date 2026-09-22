// 采样真实杂物显示层及 Cocos 四元数；输出独立离线页面，不启动或截图 Creator。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const testPath = path.join(root, 'tests/litter-presentation.test.cjs');
const source = fs.readFileSync(testPath, 'utf8').split("\ntest(")[0];
const mod = { exports: {} };
vm.runInThisContext(`(function(require,module,__dirname){${source}\nmodule.exports=fixture;})`)(require, mod, path.dirname(testPath));
const { cc } = require('../tests/helpers/cocos-math-harness.cjs').createHarness();
const f = mod.exports(), frames = [], q = new cc.Quat(), v = new cc.Vec3();
f.clusters.forEach((c, id) => {
    c.active = id < 6; c.courseX = c.anchorCourseX = 25 + (id % 3 - 1) * 1.4;
    c.throwSide = id % 2 ? 1 : -1; c.lateral = c.anchorLateral = c.throwSide * (2 + Math.floor(id / 2) * 2);
});
for (let frame = 0; frame <= 60; frame++) {
    const time = frame / 20;
    for (const c of f.clusters) {
        const age = time - Math.floor(c.id / 2) * .34;
        c.phase = age < 1.35 ? 'falling' : 'floating'; c.phaseProgress = Math.min(1, age / 1.35);
    }
    f.presentation.update(.05, f.clusters, true);
    frames.push(f.root.children.slice(0, 6).map(n => {
        if (!n.active) return null;
        cc.Quat.fromEuler(q, n.rotation.x, n.rotation.y, n.rotation.z);
        const g = n.renderer.mesh.data, vertices = [];
        for (let i = 0; i < g.positions.length; i += 3) {
            v.set(g.positions[i] * n.scale.x, g.positions[i+1] * n.scale.y, g.positions[i+2] * n.scale.z);
            cc.Vec3.transformQuat(v, v, q); vertices.push(v.x+n.position.x,v.y+n.position.y,v.z+n.position.z);
        }
        return { vertices, mesh: f.meshes.indexOf(n.renderer.mesh) };
    }));
}
const data = JSON.stringify({frames,meshes:f.meshes.map(m=>({indices:m.data.indices,colors:m.data.colors}))}).replace(/(-?\d+\.\d{5})\d+/g,'$1');
const image = name => 'data:image/png;base64,' + fs.readFileSync(path.join(root,'assets/race/ui/entertainment-banner-v1',name+'.png')).toString('base64');
const font = fs.readFileSync(path.join(root,'assets/race/fonts/ShuiMasterUI-Regular.ttf')).toString('base64');
function card(calm) {
    const sprite=(name,x,y,w,h)=>`<img src="${image(name)}" style="left:${320+x-w/2}px;top:${67.5-y-h/2}px;width:${w}px;height:${h}px">`;
    return `<div class="card"><img src="${image('stimulant-pickup-base')}" style="inset:0;width:640px;height:135px">${sprite(calm?'icon-calm-slush':'icon-stimulant',-214,0,110,110)}${sprite(calm?'calm-slush-pickup-title':'stimulant-pickup-title',-8,-3,245,89)}<span class="note">游戏道具效果</span><span class="energy">${calm?'推进 90%':'体力 85%'}</span><span class="heart">心率 ${calm?'100':'180'}</span></div>`;
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>F 计划 · 离线审查</title><style>
@font-face{font-family:game;src:url(data:font/ttf;base64,${font})}*{box-sizing:border-box}body{background:#102b40;color:#e7f7ff;margin:0;font:16px/1.6 system-ui}main{max-width:1000px;margin:auto;padding:18px}h1{font-size:24px}p{color:#b2d2e3}canvas{width:100%;background:#143c52;border:1px solid #476879}button,input{margin:5px;padding:8px}input{width:65%}.cards{overflow:auto}.card{width:640px;height:135px;position:relative;margin:12px auto;font-family:game}.card img,.card span{position:absolute}.card span{text-align:center;white-space:nowrap}.note{left:237px;top:104.5px;width:150px;font-size:14px;line-height:18px}.energy{left:473px;top:28.5px;width:116px;color:#7af4ff;font-size:22px;line-height:32px}.heart{left:478px;top:80.5px;width:110px;color:#ffae4f;font-size:22px;line-height:32px}
</style><main><h1>杂物高抛与共用拾取卡</h1><p>独立离线预览：真实杂物网格、显示层和 Cocos 四元数；六件样本使用原 1.35 秒预警与 0.34 秒分组。简化水面与斜俯视，不是正式游戏相机，不含泳者、网络或真实水体遮挡。</p><canvas id="view" width="1000" height="420"></canvas><button id="play">暂停</button><button id="reset">重播</button><input id="time" type="range" min="0" max="60" value="0"><output id="stamp"></output><p>从看台方向高处抛入，保留中间通路；到位后转入原漂浮姿态。可拖动检查首帧、入场末尾和三组衔接。</p><div class="cards">${card(false)}${card(true)}</div><p>原运行时图片＋实际槽位的静态排版，读数是示例；卡片动效与两格位置未变。游戏道具说明只建一次；实际读数仍由权威拾取事件提供。手机字体与完整比赛画面待验。</p></main><script>
const data=${data},canvas=document.getElementById('view'),ctx=canvas.getContext('2d');let time=0,playing=true,last=performance.now();
const project=(x,y,z)=>[500+z*37+(x-25)*13,220+(x-25)*26-y*65];
function polygon(v,color){ctx.fillStyle=color;ctx.beginPath();v.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fill()}
function draw(){ctx.clearRect(0,0,1000,420);polygon([[18,0,-10.5],[32,0,-10.5],[32,0,10.5],[18,0,10.5]].map(v=>project(...v)),'#216782');ctx.strokeStyle='#6296a4';for(let z=-10.5;z<=10.5;z+=2.625){ctx.beginPath();ctx.moveTo(...project(18,0,z));ctx.lineTo(...project(32,0,z));ctx.stroke()}
const triangles=[];for(const n of data.frames[Math.min(60,Math.floor(time*20))]){if(!n)continue;const m=data.meshes[n.mesh];for(let i=0;i<m.indices.length;i+=3){const ids=m.indices.slice(i,i+3),verts=ids.map(id=>n.vertices.slice(id*3,id*3+3)),color=m.colors.slice(ids[0]*4,ids[0]*4+3).map(c=>Math.round(c*255));triangles.push({points:verts.map(v=>project(...v)),depth:verts.reduce((s,v)=>s+v[0]+v[2]*.08+v[1]*.2,0),color:'rgb('+color.join(',')+')'})}}triangles.sort((a,b)=>a.depth-b.depth).forEach(t=>polygon(t.points,t.color));document.getElementById('stamp').textContent=time.toFixed(2)+' 秒';document.getElementById('time').value=Math.floor(time*20)}
document.getElementById('play').onclick=e=>{playing=!playing;e.target.textContent=playing?'暂停':'继续'};document.getElementById('reset').onclick=()=>{time=0;playing=true;document.getElementById('play').textContent='暂停'};document.getElementById('time').oninput=e=>{time=+e.target.value/20;playing=false;document.getElementById('play').textContent='继续';draw()};function tick(now){if(playing)time=(time+Math.min(.1,(now-last)/1000))%3.05;last=now;draw();requestAnimationFrame(tick)}draw();requestAnimationFrame(tick);
</script></html>`;
const out=path.join(root,'art/age8-f');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'review.html'),html);console.log('已生成 art/age8-f/review.html（独立离线预览）');
