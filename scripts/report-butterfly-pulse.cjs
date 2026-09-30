// 单文件离线报告：样式、数据和绘图脚本内联，可在手机直接打开。
const fs=require('node:fs');
const {sample,load}=require('./analyze-butterfly-pulse.cjs');
const roster=[{name:'中性参考'},...load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS];
const data=[];
for(const c of roster)for(const level of [1,30])for(const exhausted of [false,true]){
    const o={characterId:c.id,level,exhausted,trace:true};
    const compact=r=>({mean:r.meanSpeed,min:r.min,max:r.max,peakAt:r.peakAt,wave:r.relativeAmplitude,trace:r.trace});
    data.push({name:`${c.name} · ${level}级 · ${exhausted?'耗尽条件':'体力充足'}`,before:compact(sample({...o,pulse:false})),after:compact(sample({...o,pulse:true}))});
}
const json=JSON.stringify(data).replace(/</g,'\\u003c');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>蝶泳集中发力对照</title><style>body{font:16px/1.7 system-ui,sans-serif;margin:0;background:#101d2b;color:#e8f1f8}main{max-width:900px;padding:22px;margin:auto}h1{font-size:25px}select{width:100%;padding:12px;font:inherit;border:1px solid #496177;border-radius:8px;background:#203449;color:white}.card{background:#192c3f;border-radius:12px;margin:18px 0;padding:16px}svg{width:100%;display:block}small,.note{color:#b3c6d7}b{color:#57ddbd}.key{margin:12px 0}.old{color:#ffbd70}.new{color:#57ddbd}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #34485c}</style>
<main><h1>蝶泳：集中发力 → 惯性滑行</h1><p>对照当前默认参数与改动前蝶泳。速度有真实起伏，平均速度尽量保持原水平。</p>
<select id="pick" aria-label="选择角色与状态"></select><div class="key"><span class="old">━ 改动前</span>　<span class="new">━ 集中发力</span></div>
<div class="card"><strong>一拍内的速度（米／秒）</strong><svg id="speed" viewBox="0 0 720 270" role="img" aria-label="速度曲线"></svg></div>
<div class="card"><strong>一拍内的加速度（米／秒²）</strong><svg id="accel" viewBox="0 0 720 270" role="img" aria-label="加速度曲线"></svg><small>正值为加速，负值为减速；横轴从这一拍开始计时，含下一拍前的操作门槛。</small></div>
<div class="card" id="metrics"></div><p class="note">统计条件：120Hz、固定心率80、连续完美、无额外踢腿，预热12拍后统计12个完整周期。图为其中一拍。耗尽条件保持原角色资格，机甲仍是无限体力。本图为真实运动代码的离线采样，不是游戏实录。</p>
<p class="note">44组完整赛程对照中43组在±2%内。满级健身教练自动大招的靠墙时机使一组慢5.31%；双方都采用距墙至少12米才释放的策略后，差异为0.41%。真实速度起伏会改变接触、转身和技能时机，仍需实玩确认。</p></main>
<script>const data=${json};const pick=document.getElementById('pick');data.forEach((r,i)=>{const o=document.createElement('option');o.value=i;o.textContent=r.name;pick.append(o)});
function chart(id,a,b,k){const svg=document.getElementById(id),all=a.concat(b),min=Math.min(0,...all.map(p=>p[k])),max=Math.max(...all.map(p=>p[k])),end=Math.max(...all.map(p=>p[0])),span=Math.max(.001,max-min);const x=t=>54+t/end*638,y=v=>222-(v-min)/span*190;let s='';for(let i=0;i<=4;i++){const value=min+span*i/4,yy=y(value);s+='<line x1="54" x2="692" y1="'+yy+'" y2="'+yy+'" stroke="#3c5368"/><text x="3" y="'+(yy+5)+'" fill="#b3c6d7" font-size="13">'+value.toFixed(1)+'</text>'}for(let i=0;i<=4;i++){const tt=end*i/4;s+='<text x="'+x(tt)+'" y="250" text-anchor="middle" fill="#b3c6d7" font-size="13">'+tt.toFixed(2)+'秒</text>'}for(const [points,color] of [[a,'#ffbd70'],[b,'#57ddbd']])s+='<polyline fill="none" stroke="'+color+'" stroke-width="3" points="'+points.map(p=>x(p[0])+','+y(p[k])).join(' ')+'"/>';svg.innerHTML=s;}
function show(){const r=data[+pick.value],a=r.before,b=r.after;chart('speed',a.trace,b.trace,1);chart('accel',a.trace,b.trace,2);document.getElementById('metrics').innerHTML='<p>平均速度变化：<b>'+((b.mean/a.mean-1)*100).toFixed(2)+'%</b></p><table><tr><th>指标</th><th>改动前</th><th>集中发力</th></tr>'+[['均速',a.mean,b.mean],['最高速度',a.max,b.max],['最低速度',a.min,b.min],['速度峰值时刻',a.peakAt,b.peakAt]].map(x=>'<tr><td>'+x[0]+'</td><td>'+x[1].toFixed(3)+'</td><td>'+x[2].toFixed(3)+'</td></tr>').join('')+'</table>';}
pick.addEventListener('change',show);show();</script></html>`;
fs.mkdirSync('.cache/butterfly-pulse',{recursive:true});
fs.writeFileSync('.cache/butterfly-pulse/推进对照.html',html);
console.log('已生成 .cache/butterfly-pulse/推进对照.html');
