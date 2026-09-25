'use strict';

// 独立浏览器只运行导出的 first-screen.js，不启动 Creator 或游戏引擎。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../build/wechatgame');
const output = path.resolve(__dirname, '../art/startup-loading-preview');
const html = `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><style>html,body{margin:0;overflow:hidden}canvas{width:100vw;height:100vh;display:block}</style>
<canvas id="canvas"></canvas><script>
window.canvas=document.getElementById('canvas');
canvas.width=Math.round(innerWidth*2.2);canvas.height=Math.round(innerHeight*2.2);
window.module={exports:{}};
</script><script src="/first-screen.js"></script><script>
window.ready=module.exports.start('false','true','true').then(()=>module.exports.setProgress(.62));
</script>`;

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const server = http.createServer((req, res) => {
        if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
        const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.png') ? 'image/png' : 'image/jpeg');
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || undefined,
            headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
        for (const [width, height] of [[1290, 720], [1920, 900]]) {
            const page = await browser.newPage({ viewport: { width, height } });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => {
                // 无头浏览器截图会触发驱动读回提示，它不是页面渲染错误。
                if ((message.type() === 'error' || message.type() === 'warning') && !message.text().includes('GPU stall due to ReadPixels')) errors.push(message.text());
            });
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            await page.evaluate(() => window.ready);
            assert.equal(await page.evaluate(() => image.width > 0 && bg.width > 0 && useLogo && useCustomBg), true);
            assert.equal(await page.evaluate(() => gl.getError()), 0);
            assert.deepEqual(errors, []);
            await page.screenshot({ path: path.join(output, `loading-${width}x${height}.png`) });
            await page.evaluate(() => module.exports.end());
            assert.equal(await page.evaluate(() => gl.getError()), 0);
            await page.close();
        }
        console.log(`首屏独立 WebGL 预览与资源释放验证通过：${output}`);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
