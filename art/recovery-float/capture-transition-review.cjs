// 从独立浏览器导出连续动作证据，不接触 Creator。
const fs=require('node:fs'),path=require('node:path');
async function main(){
 const pages=await fetch('http://127.0.0.1:18800/json').then(r=>r.json());
 const page=pages.find(p=>p.url==='http://127.0.0.1:8767/transition-review.html');
 if(!page)throw Error('请先在独立浏览器打开扶圈过渡审查页');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const waiting=new Map();ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(waiting.has(d.id)){waiting.get(d.id)(d);waiting.delete(d.id);}});
 const call=(method,params)=>new Promise(resolve=>{const request=++id;waiting.set(request,resolve);ws.send(JSON.stringify({id:request,method,params}));});
 const result=await call('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
  const times=[0,.1,.2,.4,.65,.85,1.1,1.4,2.2,3.1],sheet=document.createElement('canvas');sheet.width=2000;sheet.height=720;const ctx=sheet.getContext('2d');ctx.fillStyle='#102633';ctx.fillRect(0,0,2000,720);ctx.font='14px sans-serif';
  for(let character=0;character<2;character++)for(let col=0;col<times.length;col++){
   setTransitionReview(times[col],character);
   for(let view=0;view<2;view++){const x=col*200,y=(character*2+view)*180;ctx.drawImage(document.getElementById(view?'front':'side'),x,y,200,150);ctx.fillStyle='#e3f5fc';ctx.fillText((character?'窄肩':'宽肩')+(view?'斜前':'侧面')+' '+times[col].toFixed(2)+'秒',x+4,y+172);}
  }
  setTransitionReview(.85,0);return sheet.toDataURL('image/png');
 })()`});
 if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));
 fs.writeFileSync(path.join(__dirname,'transition-sequence.png'),Buffer.from(result.result.result.value.split(',')[1],'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
 const mobile=await call('Runtime.evaluate',{returnByValue:true,expression:'({width:innerWidth,content:document.documentElement.scrollWidth,externalScripts:[...document.scripts].filter(s=>s.src).length})'});
 console.log('小屏检查',mobile.result.result.value);
 if(mobile.result.result.value.content>360)throw Error('小屏页面出现横向溢出');
 await call('Emulation.clearDeviceMetricsOverride',{});
 ws.close();console.log('已导出双体型、双视角的完整过渡时序。');
}
main().catch(e=>{console.error(e);process.exit(1)});
