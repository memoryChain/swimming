// 焦点选手由AI输入代表操作基线；此回放不代表真人通关率。
const fs = require('node:fs');
const path = require('node:path');
const { createBossHarness } = require('../tests/helpers/boss-race-harness.cjs');
const h = createBossHarness();
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const characters = option('characters', 'all') === 'all' ? h.load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.map(c => c.id)
    : option('characters', '').split(',');
const seeds = option('seeds', '42').split(',').map(Number);
const rates = option('fps', '30,60').split(',').map(Number);
const ids = option('bosses', 'all');
const levels = [4, 10, 14, 17, 22, 25, 30, 30];
const skills = ['normal', 'skilled', 'skilled', 'skilled', 'expert', 'expert', 'expert', 'expert'];
const results = [];
for (let i = 0; i < h.BOSS_AI_PRESETS.length; i++) {
    const preset = h.BOSS_AI_PRESETS[i];
    if (ids !== 'all' && !ids.split(',').includes(preset.id)) continue;
    for (const character of characters) for (const seed of seeds) for (const fps of rates) results.push(h.replay(preset,
        { character, seed, fps, level: Number(option('level', levels[i])), skill: option('skill', skills[i]),
            completeField: args.includes('--complete-field') }));
    const rows = results.filter(r => r.id === preset.id);
    console.log(JSON.stringify({ id: preset.id, races: rows.length, dnf: rows.filter(r => !r.finished).length,
        qualified: rows.filter(r => r.qualified).length, meanPlace: rows.reduce((n, r) => n + r.placement, 0) / rows.length,
        pressureRaces: rows.filter(r => r.closePressureSeconds > 0).length,
        contactBreaks: rows.reduce((n, r) => n + r.contactBreaks, 0), maxStall: Math.max(...rows.map(r => r.longestStall)) }));
}
const output = option('output', '.cache/boss-benchmark.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ note: '真实输入、转向、资源、碰撞与折返；水面起步，不含真人触屏、出发飞行或网络。',
    completeField: args.includes('--complete-field'), results }, null, 2));
console.log(JSON.stringify({ output, races: results.length, focusDnf: results.filter(r => !r.finished).length }));
