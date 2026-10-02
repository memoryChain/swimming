// 将 Blender 离线帧合成手机可打开的单文件；不含 Cocos 水体、粒子或实机性能数据。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.cache/butterfly-cycle');
const uri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
const frames = {};
for (const [model, folder] of [['muscle', ''], ['slim', 'CartonSwimmer13']]) {
    for (const view of ['side', 'race']) frames[`${model}-${view}`] = Array.from({ length: 29 }, (_, i) => {
        const base = path.join(directory, folder, view, String(i).padStart(3, '0'));
        const compressed = fs.existsSync(base + '.jpg')
            && fs.statSync(base + '.jpg').mtimeMs >= fs.statSync(base + '.png').mtimeMs;
        return compressed ? uri(base + '.jpg', 'image/jpeg') : uri(base + '.png', 'image/png');
    });
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>蝶泳动作精修 · 离线查看</title><style>
*{box-sizing:border-box}body{margin:0;background:#111c27;color:#e8f2fa;font:16px/1.65 system-ui,sans-serif}main{max-width:850px;margin:auto;padding:20px}h1{font-size:23px;margin:0 0 8px}p{color:#b9cad9}img{display:block;width:100%;border-radius:12px;background:#333}section{margin:16px 0;padding:16px;background:#1c2c3c;border-radius:12px}button,select{font:inherit;padding:8px 12px;margin:4px 6px 4px 0;border:1px solid #567186;border-radius:8px;background:#283f54;color:white}input{width:100%;accent-color:#67d8ff}.note{font-size:14px}.row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}label{display:inline-block}audio{width:100%}</style>
<main><h1>蝶泳动作精修</h1><p>查看手腕收尾、两次打腿轻重和脚尖跟随。保留原身体起伏、动作周期与玩法数值。</p>
<p class="note">这是实际运行时骨骼导出后的 Blender 离线渲染。白线仅为水面参照，不是游戏画面；不包含新水花、受撞演出或微信性能验证。</p>
<section><div class="row"><label>角色 <select id="model"><option value="muscle">肌肉角色</option><option value="slim">细臂角色</option></select></label>
<label>视角 <select id="view"><option value="race">斜上方</option><option value="side">侧面</option></select></label>
<button id="play">暂停</button><label>速度 <select id="speed"><option value="1">正常速度</option><option value="0.5">半速观察</option></select></label></div>
<img id="frame" alt="蝶泳连续动作离线帧"><input id="seek" type="range" min="0" max="28" value="0" aria-label="动作进度"><span id="phase"></span></section>
<section><strong>蝶泳推水声</strong><p class="note">一次主重音和短水流尾声。下方为素材试听，比赛音量还会受评价与设置控制。</p>
<audio controls preload="none" src="${uri(path.join(root, 'assets/music/sfx/butterfly_push.wav'), 'audio/wav')}"></audio></section>
<section><strong>游戏内对照方法</strong><p>在调参面板的“蝶泳测试”中，将“动作收尾细节”在 0 和 1 之间切换。该开关只控制手腕、打腿轻重与脚尖跟随，不改变水花和声音。</p><p class="note">八人场验收重点：被撞退出时恢复自然，空中没有假拍水，双手同时入水的水片不遮住手臂。</p></section></main>
<script>const frames=${JSON.stringify(frames)};
const model=document.getElementById('model'),view=document.getElementById('view'),picture=document.getElementById('frame'),seek=document.getElementById('seek'),button=document.getElementById('play'),speed=document.getElementById('speed'),phase=document.getElementById('phase');
let playing=true,time=0,previous=performance.now(),last=-1,key='';
function show(){const nextKey=model.value+'-'+view.value,index=Math.min(28,Math.floor(time/.95*29));if(index!==last||key!==nextKey){picture.src=frames[nextKey][index];seek.value=index;phase.textContent='整拍进度 '+Math.round(index/29*100)+'%';last=index;key=nextKey;}}
button.onclick=()=>{playing=!playing;button.textContent=playing?'暂停':'播放';};
seek.oninput=()=>{playing=false;button.textContent='播放';time=Number(seek.value)/29*.95;show();};model.onchange=view.onchange=show;
function tick(now){if(playing&&!document.hidden)time=(time+Math.min(.1,(now-previous)/1000)*Number(speed.value))%.95;previous=now;show();requestAnimationFrame(tick);}show();requestAnimationFrame(tick);</script></html>`;
const target = path.join(root, '.cache/butterfly-polish-review.html');
new (require('node:vm').Script)(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
fs.writeFileSync(target, html);
console.log(`蝶泳离线查看页：${path.relative(root, target)}，${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MiB，图片与音频均已内嵌。`);
