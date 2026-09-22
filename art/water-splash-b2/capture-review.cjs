// 只读取本任务已打开的独立浏览器审查页，导出完整时间序列；不接触 Creator。
const fs=require('node:fs'),path=require('node:path');
async function main(){
    const pages=await fetch('http://127.0.0.1:18800/json').then(r=>r.json());
    const page=pages.find(p=>p.url==='http://127.0.0.1:8766/review.html');
    if(!page)throw Error('请先在独立浏览器打开本任务审查页');
    const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
    let id=0;const waiting=new Map();ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(waiting.has(d.id)){waiting.get(d.id)(d);waiting.delete(d.id);}});
    const call=(method,params)=>new Promise(resolve=>{const request=++id;waiting.set(request,resolve);ws.send(JSON.stringify({id:request,method,params}));});
    const result=await call('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
        const times=[0,.1,.2,.35,.5,.65,.8,1],rows=[['before','timed-bomb',.15,'旧版'],['after','timed-bomb',.15,'定时水球'],['after','cannon',.15,'水球炮'],['after','minefield',.15,'喷水浮标'],['after','timed-bomb',-.8,'水下'],['after','timed-bomb',1.8,'空中']];
        const out={},sheet=document.createElement('canvas');sheet.width=1536;sheet.height=rows.length*178;const ctx=sheet.getContext('2d');ctx.fillStyle='#102733';ctx.fillRect(0,0,sheet.width,sheet.height);ctx.font='14px sans-serif';
        for(let row=0;row<rows.length;row++){const [version,owner,height,label]=rows[row];for(let col=0;col<times.length;col++){
            setReviewState({version,owner,height,time:times[col],reference:true});const x=col*192,y=row*178;ctx.drawImage(document.getElementById('main'),x,y,192,108);ctx.drawImage(document.getElementById('pip'),x,y+108,96,54);ctx.fillStyle='#e0f7ff';ctx.fillText(label+' '+times[col].toFixed(2)+'s',x+2,y+174);
        }}out['sequence-sheet.png']=sheet.toDataURL('image/png');
        for(const time of [.2,.5,.75]){setReviewState({version:'after',owner:'timed-bomb',height:.15,time});out['main-'+time+'.png']=document.getElementById('main').toDataURL('image/png');out['pip-'+time+'.png']=document.getElementById('pip').toDataURL('image/png');}
        setReviewState({version:'after',owner:'timed-bomb',height:.15,time:.2});return out;
    })()`});
    if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));
    for(const [name,data]of Object.entries(result.result.result.value))fs.writeFileSync(path.join(__dirname,name),Buffer.from(data.split(',')[1],'base64'));
    ws.close();console.log('已导出六组完整时序、主视角与256×144画中画证据。');
}
main().catch(e=>{console.error(e);process.exit(1)});
