// 从矢量源稿离线导出，不在游戏运行时绘制圆环或渐变。
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
(async () => {
    for (const [source, output, size] of [
        ['ripple-ring', 'ripple-ring', 256],
        ['inner-glow', 'inner-glow', 128],
        ['marker-glow', 'marker-glow', 64],
    ]) {
        await sharp(path.join(root, 'tools/ui-source/stroke-feedback', source + '.svg'), { density: 288 })
            .resize(size, size).png({ compressionLevel: 9 })
            .toFile(path.join(root, 'assets/race/ui/race-stroke-v1', output + '.png'));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
