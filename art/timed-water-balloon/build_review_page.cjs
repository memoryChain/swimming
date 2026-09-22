const fs=require('node:fs'),path=require('node:path');
const groups=[['三种状态',['normal','inflated','locked'].flatMap((s,i)=>['front','side','race'].map((v,j)=>[s+'-'+v,['正常','鼓胀','锁定'][i]+' · '+['正面','侧面','比赛相近视角'][j]]))],['六面补充',['back','left','top','bottom'].map((v,i)=>['structure-'+v,['背面','左面','顶部','底部'][i]])],['角色挂载',[[ 'all-character-mounts','11 个角色 · 最大鼓胀'],...[0,1].flatMap(i=>['front','side','race'].map((v,j)=>['mount-'+i+'-'+v,(i?'最窄角色':'最宽角色')+' · '+['正面','侧面','比赛相近视角'][j]]))]],['转交路径',[['transfer-arc','同一水球的五个时刻 · 短弧线示意']]]];
const samples=JSON.parse(fs.readFileSync(path.join(__dirname,'animation-samples.json'),'utf8'));
const motion=`<h2>临近喷水 · 动画预览</h2><p>直接采样游戏表现代码，展示示例 10 秒倒计时的最后 4.8 秒；离线渲染，不是游戏实录。</p>
<div class="motion"><canvas id="motion" width="256" height="256" aria-label="水球逐渐鼓胀、脉动与锁定抖动"></canvas>
<div><p id="time"></p><button id="play">暂停</button><p><label>逐帧查看 <input id="frame" type="range" min="0" max="95" value="0"></label></p>
<p>三面喷水警示印花<br>后段鼓胀与挤压回弹<br>最后锁定时绷紧抖动</p></div></div>
<script>
const samples=${JSON.stringify(samples)},canvas=document.getElementById('motion'),ctx=canvas.getContext('2d'),atlas=new Image();
const slider=document.getElementById('frame'),button=document.getElementById('play'),readout=document.getElementById('time');
let playing=true,start=0,index=0,ready=false;
function draw(i){index=i;const f=samples.frames[i];ctx.clearRect(0,0,256,256);ctx.drawImage(atlas,(i%8)*256,Math.floor(i/8)*256,256,256,0,0,256,256);slider.value=i;readout.textContent='剩余 '+f.remaining.toFixed(2)+' 秒 · '+(f.locked?'即将喷水 · 无法转交':'鼓胀中');}
atlas.onload=()=>{ready=true;draw(0);};atlas.src='animation-strip.png';
button.onclick=()=>{playing=!playing;start=performance.now()-index*50;button.textContent=playing?'暂停':'播放';};
slider.oninput=()=>{playing=false;button.textContent='播放';if(ready)draw(Number(slider.value));};
function tick(t){if(!start)start=t;if(ready&&playing){const next=Math.min(95,Math.floor(((t-start)%5800)/50));if(next!==index)draw(next);}requestAnimationFrame(tick);}requestAnimationFrame(tick);
</script>`;
fs.writeFileSync(path.join(__dirname,'review.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>定时水球离线预览</title><style>body{background:#142330;color:#eff8fc;font:18px/1.65 sans-serif;margin:24px auto;padding:0 20px;max-width:1400px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}figure{margin:0}img{width:100%;border-radius:10px}figcaption{padding:10px}h2{margin-top:40px}.motion{display:flex;gap:30px;align-items:center;flex-wrap:wrap}canvas{width:320px;max-width:100%;border-radius:12px}button{padding:8px 22px;font:inherit;color:#113e58;background:#ffe27a;border:0;border-radius:8px}input{max-width:100%}</style><h1>定时水球 · 喷水警示强化</h1><p>实际模型与角色蒙皮离线渲染，不是游戏实机。精确秒数由 HUD 显示；转交图为时序示意。</p>'+motion+groups.map(([title,rows])=>'<h2>'+title+'</h2><main>'+rows.map(([file,label])=>'<figure><img loading="lazy" src="'+file+'.png"><figcaption>'+label+'</figcaption></figure>').join('')+'</main>').join('')+'</html>');
