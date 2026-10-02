// 纯离线数据处理，不打开 Blender，不修改原 GLB；只为水炮合并现有细轮廓。
const fs = require('node:fs'), path = require('node:path');
const { root, outline, CANNON_OUTLINE_POLICIES } = require('../entertainment-outlines/build_geometry.cjs');
const WIDTH = .003;
// 与当前 PlayerOutline 完全一致：linear:true 先平方，片元再 SRGBToLinear。
// builtin-unlit 也会对顶点色做 SRGBToLinear，因此这里存材质上传后的值，不能再按标准 sRGB 转换。
const INK = [12, 24, 32].map(v => (v / 255) ** 2).concat(1);
function merge(base, shell) {
    const offset = base.positions.length / 3;
    const positions = [...base.positions], colors = [...base.colors], indices = [...base.indices];
    for (let i = 0; i < shell.positions.length; i += 3) {
        const length = Math.hypot(...shell.normals.slice(i, i + 3));
        for (let k = 0; k < 3; k++) positions.push(shell.positions[i + k] + shell.normals[i + k] / length * WIDTH);
        colors.push(...INK);
    }
    // 反转轮廓的绕序，与本体一起使用背面剔除；全部放在同一 primitive 中。
    for (let i = 0; i < shell.indices.length; i += 3) {
        indices.push(offset + shell.indices[i], offset + shell.indices[i + 2], offset + shell.indices[i + 1]);
    }
    if (positions.length / 3 > 65535) throw Error('合并网格超出 16 位索引预算');
    return { positions, colors, indices };
}
function build() {
    const water = JSON.parse(fs.readFileSync(path.join(__dirname, 'geometry.json'), 'utf8'));
    const report = {};
    for (const [name, keep] of Object.entries(CANNON_OUTLINE_POLICIES)) {
        const base = water.WaterBallCannon[name], shell = outline(base, keep);
        water.WaterBallCannon[name] = merge(base, shell);
        report[name] = { bodyTriangles: base.indices.length / 3, outlineTriangles: shell.indices.length / 3,
            mergedTriangles: water.WaterBallCannon[name].indices.length / 3, drawsBefore: 2, drawsAfter: 1 };
    }
    const text = '// 由 art/water-play-obstacles/build_cannon_merged.cjs 从作者 geometry.json 生成；不要手改。\n'
        + 'export const WATER_PLAY_GEOMETRY = ' + JSON.stringify(water) + ';\n';
    return { water, report, text };
}
if (require.main === module) {
    const { report, text } = build();
    const target = path.join(root, 'assets/scripts/core/WaterPlayObstacleGeometry.ts');
    if (process.argv.includes('--check')) {
        if (fs.readFileSync(target, 'utf8') !== text) throw Error('水炮合并数据过期，请运行 build_cannon_merged.cjs');
    } else fs.writeFileSync(target, text);
    console.log(JSON.stringify(report));
}
module.exports = { build, merge, WIDTH, INK };
