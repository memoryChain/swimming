// 仅截取离线 HTML 设计稿，不启动或截取 Cocos Creator。
const { chromium } = require('playwright');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(__dirname, 'preview.html')).href);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.sheet').screenshot({ path: path.join(__dirname, 'overview.png') });
    await page.getByRole('button', { name: '同色辨识' }).click();
    await page.locator('.sheet').screenshot({ path: path.join(__dirname, 'overview-monochrome.png') });
    console.log('已生成主题色及同色总览；图标数量：', await page.locator('article').count());
    if (require('node:fs').existsSync(path.join(__dirname, 'fuller-comparison.html'))) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(pathToFileURL(path.join(__dirname, 'fuller-comparison.html')).href);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.sheet').screenshot({ path: path.join(__dirname, 'fuller-comparison.png') });
    }
    if (require('node:fs').existsSync(path.join(__dirname, 'concept-review.html'))) {
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.goto(pathToFileURL(path.join(__dirname, 'concept-review.html')).href);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.sheet').screenshot({ path: path.join(__dirname, 'concept-review.png') });
    }
    if (require('node:fs').existsSync(path.join(__dirname, 'frog-review.html'))) {
      await page.setViewportSize({ width: 560, height: 800 });
      await page.goto(pathToFileURL(path.join(__dirname, 'frog-review.html')).href);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.sheet').screenshot({ path: path.join(__dirname, 'frog-review.png') });
    }
    if (require('node:fs').existsSync(path.join(__dirname, 'diver-review.html'))) {
      await page.setViewportSize({ width: 560, height: 800 });
      await page.goto(pathToFileURL(path.join(__dirname, 'diver-review.html')).href);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.sheet').screenshot({ path: path.join(__dirname, 'diver-review.png') });
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exit(1); });
