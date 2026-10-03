// 冻结明确提交的一至三档规则，不切分支、不修改来源工作树或已有单发记录。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHarness } = require('../tests/helpers/cocos-math-harness.cjs');
const { runCannonScenario } = require('../tests/helpers/cannon-scenarios.cjs');
const source = path.resolve(process.argv[2] || '');
const sourceCommit = 'e5dca0327ed8d5e70bf5f38d39489022491e8e4b';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), sourceCommit);
assert.equal(execFileSync('git', ['status', '--porcelain', '--', 'assets/scripts/core'], { cwd: source, encoding: 'utf8' }), '');
const h = createHarness(), C = h.load(path.join(source, 'assets/scripts/core/CannonBrawlController.ts')).CannonBrawlController;
const state = h.load(path.join(source, 'assets/scripts/core/GameConstants.ts')).GameState;
const intensity = h.load(path.join(source, 'assets/scripts/core/EntertainmentIntensity.ts'));
const specs = [1, 2, 3].map(level => {
    const p = intensity.entertainmentIntensityProfile(level);
    return { level, strikes200: p.cannonStrikes200, strikes400: p.cannonStrikes400,
        concurrency: p.cannonConcurrency, interval: p.cannonMinimumIntervalSeconds };
});
const fixtures = [];
for (const spec of specs) for (const seed of [42, 20260913]) for (const length of [25, 50])
    for (const distance of [200, 400]) for (const fps of [30, 60]) {
        const triggers = Array.from({ length: distance >= 400 ? spec.strikes400 : spec.strikes200 }, (_, i) => 20 + i * 3);
        fixtures.push({ level: spec.level, ...runCannonScenario((racers, world, launch, impact) => {
            const c = new C(4, seed, 24, l => racers[l], launch, impact, triggers, distance - 20, world, spec.concurrency, spec.interval);
            return { step: dt => c.update(dt, state.RACING, true), ai: (...args) => c.targetZForAi(...args) };
        }, seed, length, distance, fps) });
    }
const target = path.resolve(__dirname, '../tests/fixtures/butterfly-cannon-levels.json');
assert.ok(!fs.existsSync(target), '来源记录已经存在，禁止覆盖');
fs.writeFileSync(target, JSON.stringify({ sourceCommit, specs, fixtures }));
console.log(`已冻结 ${fixtures.length} 组原分支一至三档炮击记录。`);
