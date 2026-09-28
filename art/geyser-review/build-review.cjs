// 从真实表现层采样网格和节点变换；仅生成独立审查页，不启动 Creator。
const fs = require('node:fs'), path = require('node:path');
const { createGeyserPresentationHarness } = require('../../tests/helpers/geyser-presentation-harness.cjs');
const root = path.resolve(__dirname, '../..');
const h = createGeyserPresentationHarness(10);
const single = [{ id: 0, x: 0, z: 0, offsetSeconds: 0 }];
const { selectGeyserLargeMask } = h.load(path.join(root, 'assets/scripts/core/GeyserBrawlSafety.ts'));
const base = h.rules.planGeyserVents(42, 1, 5, 0, 0, 25, 10.5);
const mask = selectGeyserLargeMask(42, 1, 5, base, 10.5, [], [], h.rules.GEYSER_TUNING).mask;
const dense = h.rules.applyGeyserSizes(base, mask, true);
const comparison = h.rules.applyGeyserSizes([
    { id: 0, x: -2.6, z: 0, offsetSeconds: 0 },
    { id: 1, x: 2.6, z: 0, offsetSeconds: 0 }], 2, true);
const data = { meshes: h.meshes.map(m => m.geometry), sequences: {}, budget: h.budget() };
for (const [key, vents, length] of [['single', single, 3.5], ['comparison', comparison, 3.8], ['dense', dense, 15.3]]) {
    h.visual.hide();
    const frames = [];
    for (let step = 0; step <= length * 30; step++) {
        h.visual.update(vents, step / 30, key === 'dense' ? 3 : 1);
        frames.push(h.snapshot());
    }
    data.sequences[key] = frames;
}
data.peakRenderers = Math.max(...data.sequences.dense.map(frame => frame.length));
// 复用项目现有独立 WebGL 审查器，避免另写一套与引擎几何无关的效果。
const reference = fs.readFileSync(path.join(root, 'art/water-splash-b2/review-template.html'), 'utf8');
const renderer = reference.slice(reference.indexOf('const $=id=>'), reference.indexOf('const drawMain='))
    .replaceAll('DATA[version].meshes', 'DATA.meshes');
const output = path.join(root, '.cache/geyser-review');
fs.mkdirSync(output, { recursive: true });
const html = fs.readFileSync(path.join(__dirname, 'review-template.html'), 'utf8')
    .replace('/*__DATA__*/', JSON.stringify(data)).replace('/*__RENDERER__*/', renderer);
fs.writeFileSync(path.join(output, 'review.html'), html);
fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify({ ...data.budget, peakRenderers: data.peakRenderers }, null, 2));
console.log(JSON.stringify({ output, ...data.budget, peakRenderers: data.peakRenderers }));
