// 固定种子离线测试，支持全角色／等级／智力／200与400米矩阵，不启动 Creator。
const fs = require('node:fs');
const path = require('node:path');
const { createAiHarness } = require('../tests/helpers/ai-race-harness.cjs');
const h = createAiHarness();
const { setRaceDifficulty, getRaceDistance } = h.load('core/GameBalance');
const { reseedSharedRandom } = h.load('core/SharedRNG');
const { AI_INTELLIGENCE } = h.load('competitor/AiRaceConfig');
const { PLAYER_CHARACTER_DEFINITIONS } = h.load('app/PlayerCharacterConfig');
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf('--' + key); return i < 0 ? fallback : args[i + 1]; };
const characters = option('characters', 'all') === 'all' ? PLAYER_CHARACTER_DEFINITIONS.map(c => c.id) : option('characters').split(',');
const levels = option('levels', '1,15,30').split(',').map(Number);
const tiers = option('tiers', 'rookie,normal,skilled,expert,extreme').split(',');
const distances = option('distances', '200,400').split(',').map(Number);
const seeds = option('seeds', '20260913').split(',').map(Number);
const fps = Number(option('fps', '30'));
const results = [];
for (const distance of distances) for (const character of characters) for (const level of levels) for (const tier of tiers) for (const seed of seeds) {
    if (!AI_INTELLIGENCE[tier] || !PLAYER_CHARACTER_DEFINITIONS.some(c => c.id === character)) throw new Error('角色或智力不存在');
    setRaceDifficulty(distance === 400 ? 'championship' : 'beginner');
    reseedSharedRandom(seed);
    const s = h.create(character, level, AI_INTELLIGENCE[tier].value);
    // 出发飞行由 Creator Tween 驱动，此基准从水面静速起算，不能冒充完整场景成绩。
    let seconds = 0, exhaustedAt = null, peakHeart = 80;
    for (; seconds < 600 && s.body.distance < getRaceDistance(); seconds += 1 / fps) {
        s.step(1 / fps);
        peakHeart = Math.max(peakHeart, s.body.heartRate);
        if (exhaustedAt === null && s.condition.energy <= 0) exhaustedAt = seconds;
    }
    const stats = s.body.rhythmStats;
    results.push({ character, level, tier, distance, seed, fps,
        finished: s.body.distance >= getRaceDistance(), seconds: +seconds.toFixed(3),
        perfectRate: +(stats.perfectCount / Math.max(1, stats.perfectCount + stats.goodCount + stats.missCount)).toFixed(4),
        ...stats, energy: +s.condition.energy.toFixed(3), peakHeart: +peakHeart.toFixed(2), exhaustedAt,
        ...s.ai.debugSnapshot() });
}
const output = option('output', '.cache/ai-benchmark.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ note: '真实运动和阶段，水面起步；不含出发飞行、骨骼碰撞和网络延迟。', results }, null, 2));
const summary = option('summary', '.cache/ai-benchmark-summary.md');
const mean = (rows, key) => rows.length ? rows.reduce((sum, r) => sum + r[key], 0) / rows.length : 0;
const lines = ['# 角色 AI 离线基准', '',
    `样本：${results.length}场；等级 ${levels.join('／')}；种子 ${seeds.join('、')}；模拟频率 ${fps}Hz。`, '',
    '使用当前保存调参，以及真实 AI、Swimmer、Motor、心率、体力、蓄气和比赛阶段代码。从水面低速起算，折返骨骼外壳仅提供与运行时相同的阶段时长；不含出发飞行、对手碰撞、玩家干扰或网络延迟。以下秒数不是完整场景比赛纪录。', '',
    '| 智力 | 场次 | 平均PERFECT | 200米平均秒 | 400米平均秒 | 提前耗尽场次 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |'];
for (const tier of tiers) {
    const rows = results.filter(r => r.tier === tier);
    const early = rows.filter(r => r.exhaustedAt !== null && r.seconds - r.exhaustedAt > 2).length;
    lines.push(`| ${AI_INTELLIGENCE[tier].label} | ${rows.length} | ${(mean(rows, 'perfectRate') * 100).toFixed(1)}% | ${mean(rows.filter(r => r.distance === 200), 'seconds').toFixed(2)} | ${mean(rows.filter(r => r.distance === 400), 'seconds').toFixed(2)} | ${early} |`);
}
lines.push('', '提前耗尽指距完赛超过2秒时体力归零；末次划水耗尽单独保留在原始数据中。不同角色和等级等权平均。', '',
    '## 1级变态档：首个测试种子', '', '| 角色 | 200米秒 | 400米秒 |', '| --- | ---: | ---: |');
for (const id of characters) {
    const rows = results.filter(r => r.character === id && r.level === 1 && r.tier === 'extreme' && r.seed === seeds[0]);
    if (!rows.length) continue;
    lines.push(`| ${PLAYER_CHARACTER_DEFINITIONS.find(c => c.id === id).name} | ${rows.find(r => r.distance === 200)?.seconds ?? '—'} | ${rows.find(r => r.distance === 400)?.seconds ?? '—'} |`);
}
const slower = [];
for (const row of results.filter(r => r.tier === 'extreme')) {
    const expert = results.find(e => e.tier === 'expert' && e.character === row.character && e.level === row.level && e.distance === row.distance && e.seed === row.seed);
    if (expert && row.seconds > expert.seconds + .1) slower.push({ ...row, delta: row.seconds - expert.seconds });
}
lines.push('', '## 极限档的实际边界', '',
    `本轮未完成 ${results.filter(r => !r.finished).length} 场。变态档在 ${slower.length} 个同角色、同等级、同种子组合中比专家慢超过0.1秒。它是可重复的极限输入基线，尚不保证每种策略组合都全局最优。`);
lines.push('');
for (const row of slower.sort((a, b) => b.delta - a.delta).slice(0, 5)) {
    lines.push(`- ${PLAYER_CHARACTER_DEFINITIONS.find(c => c.id === row.character).name}，${row.level}级，${row.distance}米，种子${row.seed}：慢${row.delta.toFixed(2)}秒。`);
}
lines.push('', '复现命令：', '', '```powershell',
    `npx.cmd --yes --package typescript@5.4.5 -c "node scripts/benchmark-ai.cjs --levels ${levels.join(',')} --seeds ${seeds.join(',')} --fps ${fps}"`, '```', '');
fs.mkdirSync(path.dirname(summary), { recursive: true }); fs.writeFileSync(summary, lines.join('\n'));
console.log(JSON.stringify({ output, races: results.length, unfinished: results.filter(r => !r.finished).length,
    exhausted: results.filter(r => r.exhaustedAt !== null).length,
    summary }, null, 2));
