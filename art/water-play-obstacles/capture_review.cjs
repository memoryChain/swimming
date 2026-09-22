// 只访问 E 独立离线审查标签；不连接或截图 Creator 页面。
const fs=require('node:fs'),path=require('node:path');
async function main(){
    const tabs=await fetch('http://127.0.0.1:18800/json/list').then(r=>r.json());
    const tab=tabs.find(t=>/^http:\/\/127\.0\.0\.1:8770\/(cannon|buoy)-review\.html$/.test(t.url));
    if(!tab)throw Error('请先打开 E 独立审查页');
    const ws=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map();let id=0;
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
    ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result)}};
    const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
    const report=[];
    try{
        for(const kind of ['cannon','buoy']){
            await call('Page.navigate',{url:'http://127.0.0.1:8770/'+kind+'-review.html'});
            for(let n=0;n<40;n++){
                const ready=await evaluate(`typeof window.setReviewState === 'function' && window.reviewState?.kind === '${kind}'`);
                if(ready)break;if(n===39)throw Error('页面未就绪');await new Promise(r=>setTimeout(r,100));
            }
            const checks=await evaluate(`(()=>{const rows=[];for(const angle of [0,1,2])for(const time of ${JSON.stringify(kind==='cannon'?[0,1,1.9,2.05,2.5,3.3,4.6,5.8]:[0,.3,.8,1.6,3.05,3.25,4.2])})rows.push(window.setReviewState({angle,time}));return {rows,webglError:document.getElementById('main').getContext('webgl').getError(),external:performance.getEntriesByType('resource').filter(r=>!r.name.startsWith('data:')).map(r=>r.name)}})()`);
            if(checks.webglError!==0)throw Error('WebGL 错误');
            if(checks.external.length)throw Error('预览不自包含：'+checks.external.join(','));
            await evaluate(`window.setReviewState({angle:0,time:${kind==='cannon'?2.5:3.05}})`);
            const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'offline-'+kind+'.png'),Buffer.from(shot.data,'base64'));
            if(kind==='buoy'){
                for(const [name,time] of [['ready',1.8],['pop',3],['spent',3.15]]){
                    await evaluate(`window.setReviewState({angle:0,time:${time}})`);
                    const stage=await call('Page.captureScreenshot',{format:'png'});
                    fs.writeFileSync(path.join(__dirname,'offline-buoy-'+name+'.png'),Buffer.from(stage.data,'base64'));
                }
                const crowd=await evaluate(`(()=>{document.getElementById('crowd').checked=true;window.setReviewState({angle:0,time:1.8});return {meshes:DATA.crowdFrames[36].parts.length,soundBytes:atob(DATA.popSound.split(',')[1]).length}})()`);
                if(crowd.meshes!==14||crowd.soundBytes>=16384)throw Error('七套网格或音频预算错误');checks.crowd=crowd;
                checks.audio=await evaluate(`(async()=>{const data=Uint8Array.from(atob(DATA.popSound.split(',')[1]),c=>c.charCodeAt(0));const context=new AudioContext();try{const clip=await context.decodeAudioData(data.buffer);return {duration:clip.duration,channels:clip.numberOfChannels,decoded:true}}finally{await context.close()}})()`);
                if(Math.abs(checks.audio.duration-.18)>.001||checks.audio.channels!==1)throw Error('浏览器音频解码结果错误');
                const stage=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'offline-buoy-seven.png'),Buffer.from(stage.data,'base64'));
                await evaluate(`document.getElementById('crowd').checked=false;window.setReviewState({time:1.8})`);
            }
            await call('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:false});
            const mobile=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');if(mobile.scroll>mobile.width)throw Error('窄屏横向溢出');
            await call('Emulation.clearDeviceMetricsOverride');report.push({kind,...checks,mobile});
        }
        fs.writeFileSync(path.join(__dirname,'browser-audit.json'),JSON.stringify({date:'2026-09-22',note:'独立浏览器离线检查；非 Creator／微信真机',results:report},null,2)+'\n');
        console.log('离线页面三角度／全状态、WebGL、零外部资源和 360px 宽度检查通过。');
    }finally{await call('Emulation.clearDeviceMetricsOverride');ws.close()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
