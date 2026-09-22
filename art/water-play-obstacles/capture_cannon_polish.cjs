// 仅连接独立审查页，不访问 Creator。
const fs=require('fs'),path=require('path');
async function main(){
 const tabs=await fetch('http://127.0.0.1:18800/json/list').then(r=>r.json()),tab=tabs.find(t=>t.url==='http://127.0.0.1:8770/cannon-polish-review.html');
 if(!tab)throw Error('先打开水炮独立对照页');
 const ws=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map();let id=0;
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result)}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 try{
  await call('Emulation.setDeviceMetricsOverride',{width:1180,height:1400,deviceScaleFactor:1,mobile:false});
  const samples=await evaluate(`(()=>{let samples=0;for(let s=0;s<6;s++)for(let t=0;t<=40;t++){setPolishState(s,t,t*9);if(reviewErrors.some(Boolean))throw Error('WebGL 绘制错误');samples++;}setPolishState(0,0,0);return samples})()`);
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(__dirname,'cannon-polish-comparison.png'),Buffer.from(shot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:360,height:900,deviceScaleFactor:1,mobile:false});
  const mobile=await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,errors:reviewErrors,external:performance.getEntriesByType('resource').filter(r=>!r.name.startsWith('data:')&&!r.name.startsWith(location.origin)).map(r=>r.name)})`);
  if(mobile.scrollWidth>360||mobile.external.length)throw Error('离线页溢出或存在外部请求');
  await call('Emulation.setDeviceMetricsOverride',{width:1180,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://127.0.0.1:8770/cannon-review.html'});
  for(let i=0;i<40;i++){if(await evaluate(`typeof setReviewState==='function'`))break;await new Promise(r=>setTimeout(r,100));}
  const runtime=await evaluate(`(()=>{for(let angle=0;angle<3;angle++)for(let t=0;t<=6;t+=.1)setReviewState({time:t,angle});setReviewState({time:2.55,angle:0});return window.reviewState})()`);
  const frame=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'offline-cannon.png'),Buffer.from(frame.data,'base64'));
  fs.writeFileSync(path.join(__dirname,'cannon-polish-browser-audit.json'),JSON.stringify({samples,mobile,runtime,scope:'独立浏览器；非 Creator 或真机'},null,2));
  await call('Page.navigate',{url:'http://127.0.0.1:8770/cannon-polish-review.html'});
  console.log(JSON.stringify({samples,mobile,runtime}));
 }finally{ws.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
