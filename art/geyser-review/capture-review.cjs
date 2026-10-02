// 只截取本任务的独立审查画布，不访问 Creator 或其预览页。
const fs = require('node:fs'), path = require('node:path');
async function main() {
    const pages = await fetch('http://127.0.0.1:18800/json').then(r => r.json());
    const reviewUrl = process.argv[2] || 'http://127.0.0.1:8769/review.html';
    if (!/^http:\/\/127\.0\.0\.1:\d+\/review\.html$/.test(reviewUrl)) throw Error('仅允许本任务的本地独立审查页');
    const page = pages.find(p => p.url === reviewUrl);
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
            const sequence=out.toDataURL('image/png');
            ctx.fillStyle='#10212d';ctx.fillRect(0,0,1600,664);
            const modes=['baseline','single','head','legs','left','right','middle','graze'];
            const names=['已提交版本','当前版本','头胸先抬','腿部先扬','左侧命中','右侧命中','腹髋中央','手脚轻擦'];
            for(let i=0;i<modes.length;i++){
                window.setReviewState({mode:modes[i],time:2.15});
                const x=i%4*400,y=Math.floor(i/4)*332;
                ctx.drawImage(document.getElementById('detail'),x,y,400,276);
                ctx.fillStyle='#e6f8ff';ctx.fillText(names[i]+' · 简化代理',x+12,y+306);
            }
            window.setReviewState({mode:'head',time:2.15});
            return {sequence,reactions:out.toDataURL('image/png')};
        })()` } }));
    const result = await message;
    ws.close();
    if (result.result.exceptionDetails) throw Error(JSON.stringify(result.result.exceptionDetails));
    const target = path.resolve(__dirname, '../../.cache/geyser-review/sequence.png');
    fs.writeFileSync(target, Buffer.from(result.result.result.value.sequence.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(path.dirname(target),'body-reactions.png'),Buffer.from(result.result.result.value.reactions.split(',')[1],'base64'));
    console.log(target);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
