// 只截取本任务的独立审查画布，不访问 Creator 或其预览页。
const fs = require('node:fs'), path = require('node:path');
async function main() {
    const pages = await fetch('http://127.0.0.1:18800/json').then(r => r.json());
    const page = pages.find(p => p.url === 'http://127.0.0.1:8769/review.html');
    if (!page) throw Error('请先打开本任务独立审查页');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    const message = new Promise((resolve, reject) => {
        ws.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id === 1) resolve(data); });
        ws.addEventListener('error', reject, { once: true });
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true,
        expression: `(() => {
            const times=[0.4,1.2,1.55,1.85,2.35,2.65,2.95,3.25];
            const labels=['气泡上浮','蓄压','破水','水冠喷涌','持续碎滴','水束消散','余沫','结束'];
            const out=document.createElement('canvas');out.width=1600;out.height=664;
            const ctx=out.getContext('2d');ctx.fillStyle='#10212d';ctx.fillRect(0,0,1600,664);ctx.font='18px sans-serif';
            for(let i=0;i<times.length;i++){
                window.setReviewState({mode:'single',time:times[i]});
                const x=i%4*400,y=Math.floor(i/4)*332;
                ctx.drawImage(document.getElementById('detail'),x,y,400,276);
                ctx.fillStyle='#e6f8ff';ctx.fillText(labels[i]+' · '+times[i].toFixed(2)+' 秒',x+12,y+306);
            }
            window.setReviewState({mode:'single',time:1.85});
            return out.toDataURL('image/png');
        })()` } }));
    const result = await message;
    ws.close();
    if (result.result.exceptionDetails) throw Error(JSON.stringify(result.result.exceptionDetails));
    const target = path.resolve(__dirname, '../../.cache/geyser-review/sequence.png');
    fs.writeFileSync(target, Buffer.from(result.result.result.value.split(',')[1], 'base64'));
    console.log(target);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
