// 当前保存调参下的蝶泳踢腿衔接对照；只改离线进程内的候选比例。
// 执行：npx --yes --package typescript@5.4.5 -c "node scripts/analyze-butterfly-kick-carry.cjs"
const fs = require('node:fs'), path = require('node:path');
const { race } = require('./analyze-butterfly-race.cjs');
const { load } = require('./analyze-stroke-efficiency.cjs');
const { BUTTERFLY_TUNING: tuning } = load('core/ButterflyTuning');
const characters = [undefined, ...load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.map(c => c.id)];
const previousScale = tuning.kickCarryScale, previousSeconds = tuning.kickCarrySeconds;
const rows = [];
try {
    tuning.kickCarrySeconds = .3;
    for (const characterId of characters) for (const level of characterId ? [1,30] : [1])
        for (const distance of [200,400]) for (const mixed of [false,true])
            for (const quality of ['perfect','mixed']) for (const kickHz of [0,4.8]) {
                const options = {characterId, level, distance, mixed, quality, kickHz, fps:60,
                    butterfly:true, dolphin:true, pressKicks:true, dolphinMinClearance:12};
                const runs = [];
                for (const scale of [0,.25,.5]) {
                    tuning.kickCarryScale = scale;
                    const {trace, phaseEvents, ...r} = race(options);
                    runs.push({scale, ...r});
                }
                rows.push({options, runs});
            }
} finally { tuning.kickCarryScale = previousScale; tuning.kickCarrySeconds = previousSeconds; }
const variants = [.25,.5].map((scale, i) => {
    const comparisons = rows.map(row => ({ ...row.options, baseline: row.runs[0].seconds,
        seconds: row.runs[i+1].seconds, improvementPercent: 100*(1-row.runs[i+1].seconds/row.runs[0].seconds),
        depletedAt: row.runs[i+1].depletedAt, extraKicks: row.runs[i+1].extraKicks,
        jumps: row.runs[i+1].jumps }));
    const ordered = [...comparisons].sort((a,b)=>a.improvementPercent-b.improvementPercent);
    return {scale, min:ordered[0], max:ordered.at(-1),
        flagged:comparisons.filter(r=>r.improvementPercent>(r.characterId?5:3)),
        neutral:comparisons.filter(r=>!r.characterId)};
});
const output = process.argv[2] || '.cache/butterfly-balance/kick-carry-variants.json';
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output, JSON.stringify({scenarios:rows.length,runs:rows.length*3,variants,rows},null,2));
console.log(JSON.stringify({output,scenarios:rows.length,runs:rows.length*3,variants},null,2));
