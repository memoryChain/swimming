// 仅离线审校：直接嵌入正式几何与 Creator 编译后的 GLSL，背景不是游戏场馆。
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('../tests/helpers/cocos-math-harness.cjs');
const root = path.resolve(__dirname, '..');
const h = createHarness();
const { buildWhirlpoolFunnelGeometry } = h.load(path.join(root, 'assets/scripts/core/WhirlpoolFunnelGeometry.ts'));
const effects = JSON.parse(fs.readFileSync(path.join(root, 'temp/whirlpool-review/compiled-effects.json'), 'utf8'));
const data = { effects, normal: buildWhirlpoolFunnelGeometry(1.344, false), super: buildWhirlpoolFunnelGeometry(2.016, true) };
const html = fs.readFileSync(path.join(__dirname, 'whirlpool-review-template.html'), 'utf8').replace('/*__DATA__*/', 'const DATA = ' + JSON.stringify(data) + ';');
const out = path.join(root, 'temp/whirlpool-review/index.html');
fs.writeFileSync(out, html);
console.log('自包含离线审校页：' + out);
