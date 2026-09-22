// 从真实规则及表现模块采样固定网格与变换，导出离线单文件预览；不是引擎截图。
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('../tests/helpers/cocos-math-harness.cjs');
const h = createHarness(), parts = [];
class Node {
    active = true; isValid = true; layer = 1;
    pos = [0, 0, 0]; scale = [1, 1, 1]; direction = 1;
    constructor(name) { this.name = name; }
    addChild(node) { parts.push(node); }
    addComponent() { const node = this; return { set mesh(g) { node.geometry = g; }, setMaterial(m) { node.material = m; } }; }
    setPosition(...v) { this.pos = v; } setScale(...v) { this.scale = v; }
    setRotationFromEuler(x, y) { this.direction = y ? -1 : 1; }
    destroy() {}
}
class Material { alpha = 0; initialize() {} setProperty(k, v) { this.alpha = v.a / 255; } destroy() {} }
class Color { constructor(r, g, b, a) { this.a = a; } }
Object.assign(h.cc, { Node, Material, Color, MeshRenderer: class {}, gfx: { CullMode: { NONE: 0 } },
    utils: { createMesh: g => g } });
const R = h.load(path.join(h.root, 'assets/scripts/core/GiantWaveRules.ts'));
const { GiantWavePresentation } = h.load(path.join(h.root, 'assets/scripts/core/GiantWavePresentation.ts'));
const sim = new R.GiantWaveSimulation(50, 0, 50, 20, 712, 'single');
const racer = { distance: 10, x: 10, z: 0, direction: 1, speed: 3, eligible: true };
for (let i = 0; i < 1000 && sim.state.phase !== 'active'; i++) sim.update(.01, [racer], false);
if (sim.state.phase !== 'active') throw new Error('起浪失败');
const p = new GiantWavePresentation(new Node('World'), 0), s = sim.state;
const frames = [], duration = R.waveDuration(s), arrival = R.waveArrivalTime(s);
for (let t = 0; t <= duration + 1; t += 1 / 30) {
    s.age = Math.min(t, duration); s.x = s.startX + s.direction * R.waveTravel(s, s.age);
    p.update(s);
    frames.push(parts.map(n => [n.active ? n.material.alpha : 0, ...n.pos, ...n.scale, n.direction]));
}
const payload = JSON.stringify({ geometry: parts.map(p => p.geometry), frames, duration, arrival })
    .replace(/(-?\d+\.\d{5})\d+/g, '$1');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>巨浪冲浪 · 完整行程预览</title><style>
*{box-sizing:border-box}body{margin:0;background:#071c29;color:#e3f9ff;font:15px/1.6 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:20px}h1{font-size:24px;margin:0}p{color:#99bdca;margin:8px 0 16px}canvas{display:block;width:100%;height:56vh;min-height:300px;background:#0d3044;border-radius:16px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}button{font:inherit;border:1px solid #315b70;background:#163e53;color:#ecfcff;border-radius:10px;padding:9px 14px}input{width:100%;accent-color:#7edfd4}small{color:#91b2bf}#stage{font-size:18px;color:#92f0de}
</style><main><h1>巨浪冲浪</h1><p>池端起浪 → 逐渐长大 → 推进至对岸 → 拍岸回落</p>
<canvas id="canvas"></canvas><nav><button id="play">暂停</button><button id="replay">重播</button><button id="camera">切换近景</button><button id="direction">反向观察</button><button id="shore">看拍岸</button></nav>
<input id="time" aria-label="播放进度" type="range" min="0" max="1000" value="0"><div id="stage"></div><small>离线浪体预览：使用当前游戏代码导出的网格与演出变换。泳池为示意，非 Cocos 实机画面；游戏水面、光照和角色需在原调试入口确认。</small></main>
<script>const data=${payload};
const canvas=document.getElementById('canvas'),gl=canvas.getContext('webgl',{alpha:false,antialias:true});
if(!gl)document.getElementById('stage').textContent='此设备未提供 WebGL，请在支持的浏览器打开。';
else {
const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s};
const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,
'attribute vec3 p;attribute vec4 c;uniform vec3 pos,scale;uniform vec4 view;uniform float opacity,dir;varying vec4 color;void main(){vec3 v=p*scale*vec3(dir,1.,dir)+pos;v.x-=view.x;float hx=v.x*.86+v.z*.5;float hy=v.y*.94+v.x*.16-v.z*.32;gl_Position=vec4(hx/view.y,hy/view.z-.12,(v.x*.12+v.z*.7-v.y*.3)/100.,1.);color=vec4(c.rgb,c.a*opacity);}'));
gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float;varying vec4 color;void main(){gl_FragColor=color;}'));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const uniforms={};for(const name of ['pos','scale','view','opacity','dir'])uniforms[name]=gl.getUniformLocation(program,name);
const buffer=(values,target,type)=>{const b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,new type(values),gl.STATIC_DRAW);return b};
const mesh=g=>({p:buffer(g.positions,gl.ARRAY_BUFFER,Float32Array),c:buffer(g.colors,gl.ARRAY_BUFFER,Float32Array),i:buffer(g.indices,gl.ELEMENT_ARRAY_BUFFER,Uint16Array),count:g.indices.length});
const meshes=data.geometry.map(mesh);
const water=mesh({positions:[0,0,-10,50,0,-10,50,0,10,0,0,10],colors:[.08,.44,.57,1,.08,.44,.57,1,.05,.33,.46,1,.05,.33,.46,1],indices:[0,1,2,0,2,3]});
const markings={positions:[],colors:[],indices:[]};
function rect(x0,x1,z0,z1,r,g,b){const a=markings.positions.length/3;markings.positions.push(x0,.005,z0,x1,.005,z0,x1,.005,z1,x0,.005,z1);for(let i=0;i<4;i++)markings.colors.push(r,g,b,1);markings.indices.push(a,a+1,a+2,a,a+2,a+3)}
rect(-.55,0,-10.5,10.5,.6,.76,.78);rect(50,50.55,-10.5,10.5,.6,.76,.78);rect(0,50,-10.5,-10,.3,.53,.6);rect(0,50,10,10.5,.3,.53,.6);
for(let z=-7.5;z<10;z+=2.5)rect(0,50,z-.025,z+.025,.22,.63,.7);const lines=mesh(markings);
const posLoc=gl.getAttribLocation(program,'p'),colorLoc=gl.getAttribLocation(program,'c');
function draw(m,f){if(!f[0])return;gl.bindBuffer(gl.ARRAY_BUFFER,m.p);gl.vertexAttribPointer(posLoc,3,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(posLoc);gl.bindBuffer(gl.ARRAY_BUFFER,m.c);gl.vertexAttribPointer(colorLoc,4,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(colorLoc);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.i);gl.uniform3f(uniforms.pos,f[1],f[2],f[3]);gl.uniform3f(uniforms.scale,f[4],f[5],f[6]);gl.uniform1f(uniforms.dir,f[7]);gl.uniform1f(uniforms.opacity,f[0]);gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0)}
let seconds=0,playing=true,close=false,reverse=false,last=performance.now();
const slider=document.getElementById('time'),stage=document.getElementById('stage'),play=document.getElementById('play');
play.onclick=()=>{playing=!playing;play.textContent=playing?'暂停':'继续'};document.getElementById('replay').onclick=()=>{seconds=0;playing=true;play.textContent='暂停'};
document.getElementById('camera').onclick=e=>{close=!close;e.target.textContent=close?'切换全景':'切换近景'};
document.getElementById('direction').onclick=()=>reverse=!reverse;document.getElementById('shore').onclick=()=>{seconds=data.arrival-.6;playing=true;play.textContent='暂停'};
slider.oninput=()=>{seconds=slider.value/1000*(data.duration+1);playing=false;play.textContent='继续'};
window.waveReview={seek(t){seconds=t;playing=false;play.textContent='继续'},get state(){return {seconds,close,reverse,triangles:data.geometry.reduce((n,g)=>n+g.indices.length/3,0)}}};
function render(now){const dt=Math.max(0,Math.min(.1,(now-last)/1000));last=now;if(playing)seconds=(seconds+dt)%(data.duration+1);const frame=data.frames[Math.max(0,Math.min(data.frames.length-1,Math.floor(seconds*30)))];
const w=Math.round(canvas.clientWidth*Math.min(2,devicePixelRatio)),h=Math.round(canvas.clientHeight*Math.min(2,devicePixelRatio));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}gl.viewport(0,0,w,h);gl.clearColor(.035,.13,.19,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
const focus=close?(reverse?50-frame[0][1]:frame[0][1]):25;const halfW=close?12:29;gl.uniform4f(uniforms.view,focus,halfW,halfW*h/w,0);
gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);draw(water,[1,0,0,0,1,1,1,1]);draw(lines,[1,0,0,0,1,1,1,1]);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
for(const i of [1,0,2]){const f=frame[i].slice();if(reverse){f[1]=50-f[1];f[7]*=-1}draw(meshes[i],f)}
slider.value=seconds/(data.duration+1)*1000;stage.textContent=(seconds<3.5?'小浪逐渐长大':seconds<data.arrival?'带着泡沫向对岸推进':seconds<data.arrival+1.2?'浪头拍岸 · 水花扬起回落':'余沫铺开 · 慢慢消散')+'　'+seconds.toFixed(1)+' 秒';requestAnimationFrame(render)}requestAnimationFrame(render);
}</script></html>`;
const output = path.join(h.root, 'art/giant-wave/巨浪完整行程预览.html');
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, html);
console.log(`已导出 ${output}，${frames.length} 帧，${parts.reduce((n, p) => n + p.geometry.indices.length / 3, 0)} 三角形。`);
if (process.argv.includes('--serve')) {
    require('node:http').createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
    }).listen(8768, '127.0.0.1', () => console.log('独立预览：http://127.0.0.1:8768'));
}
