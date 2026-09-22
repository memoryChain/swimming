// 只连接本任务独立浏览器中的离线页，不访问 Creator。
const fs=require('node:fs'),path=require('node:path');
async function main(){
 const tabs=await fetch('http://127.0.0.1:18951/json/list').then(r=>r.json());
 const tab=tabs.find(t=>t.url.endsWith('/cannon-clearance-review.html'));
 if(!tab)throw Error('未找到独立遮挡审查页');
 const ws=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map();let id=0;
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result)}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 try{
  await call('Page.reload',{ignoreCache:true});
  for(let i=0;i<50;i++){if(await evaluate(`typeof setClearanceState==='function'`))break;await new Promise(r=>setTimeout(r,100))}
  await call('Emulation.setDeviceMetricsOverride',{width:1180,height:850,deviceScaleFactor:1,mobile:false});
  const samples=await evaluate(`(()=>{let n=0;for(let s=0;s<60;s++)for(const t of [0,5,10,15,20,25]){setClearanceState(s,t);if(reviewErrors.some(Boolean))throw Error('WebGL 绘制错误');n++;}setClearanceState(7,21);return n})()`);
  for(const [name,shot,t] of [['near',7,21],['far',28,0]]){
   await evaluate(`setClearanceState(${shot},${t})`);
   const result=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
   fs.writeFileSync(path.join(__dirname,`cannon-clearance-${name}.png`),Buffer.from(result.data,'base64'));
  }
  await call('Emulation.setDeviceMetricsOverride',{width:360,height:900,deviceScaleFactor:1,mobile:false});
  const mobile=await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,errors:reviewErrors,external:performance.getEntriesByType('resource').filter(r=>!r.name.startsWith('data:')&&!r.name.startsWith('file:')).map(r=>r.name)})`);
  if(mobile.scrollWidth>360||mobile.external.length||mobile.errors.some(Boolean))throw Error('窄屏布局或独立资源检查失败');
  const result={samples,mobile,scope:'独立浏览器 WebGL，非 Creator／真机'};
  fs.writeFileSync(path.join(__dirname,'cannon-clearance-browser-audit.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{ws.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
