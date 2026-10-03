// 固定 typescript@5.4.5 环境：node scripts/benchmark-geyser-layout.cjs <旧源码快照目录>
// 仅测 CPU 选口；不启动 Creator、不修改资源或生成排布文件。
const assert = require('node:assert/strict');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createHarness } = require('../tests/helpers/cocos-math-harness.cjs');
const baseline = process.argv[2];
assert.ok(baseline, '需要简化前的源码快照目录，包含 assets/scripts');
function modules(root) {
    const h = createHarness();
    return { rules: h.load(path.resolve(root, 'assets/scripts/entertainment/GeyserBrawlRules.ts')),
        safety: h.load(path.resolve(root, 'assets/scripts/entertainment/GeyserBrawlSafety.ts')) };
}
const old = modules(baseline), current = modules(path.resolve(__dirname, '..'));
for (const intensity of [2, 3, 4, 5]) {
    const cases = Array.from({ length: 200 }, (_, seed) => {
        const direction = seed % 2 ? -1 : 1;
        return { seed, vents: current.rules.planGeyserVents(seed, 1, intensity, direction * 15, 0, 25, 12, direction),
            racers: Array.from({ length: 8 }, (_, i) => ({ x: direction * 10, z: 10.5 - i * 3,
                speed: seed % 4 + 1, direction, heading: .1, turnRate: .05, roll: .1, bodyScale: 1 })) };
    });
    const callOld = c => old.safety.selectGeyserLargeMask(c.seed, 1, intensity, c.vents, 12, c.racers, [], old.rules.GEYSER_TUNING);
    const callNew = c => current.safety.selectGeyserLargeMask(c.seed, 1, intensity, c.vents, 12, [], current.rules.GEYSER_TUNING);
    const rows = [];
    for (const [name, call] of [['原检查', callOld], ['简化后', callNew]]) {
        for (const c of cases.slice(0, 30)) call(c);
        const times = [], counts = [0, 0, 0, 0];
        for (const c of cases) {
            const start = performance.now(), result = call(c);
            times.push(performance.now() - start);
            counts[result.mask.toString(2).replace(/0/g, '').length]++;
        }
        times.sort((a, b) => a - b);
        rows.push({ 实现: name, 档位: intensity, 组数: cases.length,
            毫秒: { 中位数: times[100], P95: times[190], 最大: times[199] }, 大口数量分布: counts });
    }
    console.log(JSON.stringify(rows));
}
