// 将已确认的单色遮罩预览离线导出为透明纹理，不重画图案或生成新素材。
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'art/character-skill-icons-v1');
const outputDir = path.join(root, 'assets/race/ui/character-skills');
const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
const size = 112; // 大厅/详情最大约 64px；低于小纹理压缩阈值，避免额外变体。

(async () => {
    fs.mkdirSync(outputDir, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        for (const item of manifest.items) {
            const uri = 'data:image/png;base64,' + fs.readFileSync(path.join(sourceDir, item.file)).toString('base64');
            await page.setContent(`<style>html,body{margin:0;background:transparent}#icon{width:${size}px;height:${size}px;background:${item.color};mask:url('${uri}') center/contain no-repeat}</style><div id="icon"></div>`);
            await page.evaluate(async (src) => { const image = new Image(); image.src = src; await image.decode(); }, uri);
            await page.locator('#icon').screenshot({ path: path.join(outputDir, item.file), omitBackground: true });
        }
        console.log(`已导出 ${manifest.items.length} 枚 ${size}×${size} 透明技能图标。`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
