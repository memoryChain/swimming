// 生涯真实阵容回放。焦点选手由指定AI操作作为输入基线，不代表真人胜率。
const fs = require('node:fs');
const path = require('node:path');
const { createAiHarness } = require('../tests/helpers/ai-race-harness.cjs');
const h = createAiHarness();
const { createDefaultProfile } = h.load('backend/PlayerProfile');
const { executeCareer, cupRounds } = h.load('progression/CareerRules');
const { setSoloAiEvent, buildRandomizedAiRoster } = h.load('competitor/CompetitorConfig');
const { AI_INTELLIGENCE } = h.load('competitor/AiRaceConfig');
const { AIRaceObserver } = h.load('competitor/AIRaceObserver');
const { setRaceDifficulty, setSoloRaceDistance } = h.load('core/GameBalance');
const { reseedSharedRandom } = h.load('core/SharedRNG');
const { resolveSwimmerCollisions, SWIMMER_COLLISION } = h.load('entity/SwimmerCollisionResolver');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const tiers = option('tiers', '0,1,2,3,4,5').split(',').map(Number);
const seeds = option('seeds', '42,2468,20261001').split(',').map(Number);
const characters = option('characters', 'cartonSwimmer6,cartonSwimmer16,muscleMan').split(',');
const levels = option('levels', '1,4,8,13,21,30').split(',').map(Number);
const skills = option('skills', 'rookie,normal,normal,skilled,skilled,expert').split(',');
const fps = Number(option('fps', '30'));
const focusInput = option('focus-input', 'ai');
const kickHz = Number(option('kick-hz', '2'));
const { StrokeType } = h.load('core/GameConstants');
const results = [];

for (const tier of tiers) for (const character of characters) for (const seed of seeds) {
    const events = [{ source: 'league', variant: 0 }, { source: 'league', variant: 1 },
        ...Array.from({ length: cupRounds(tier) }, (_, round) => ({ source: 'cup', round }))];
    for (const event of events) {
        const profile = createDefaultProfile();
        profile.career.league = tier; profile.career.points = 100;
        profile.career.leagueStarts[tier] = event.variant ?? 0;
        profile.characters[character].level = levels[tier];
        if (event.source === 'cup') profile.career.cups[character] = {
            id: 'benchmark-cup', tier, round: event.round, state: 'active', coins: 0, seed,
        };
        const start = executeCareer(profile, { type: 'begin', source: event.source, characterId: character,
            tier, seed, distance: 200, rule: 'wild' });
        if (!start.ok) throw Error(start.message);
        const ticket = start.ticket;
        setRaceDifficulty(ticket.rule === 'standard' ? 'beginner' : 'competitive');
        setSoloRaceDistance(ticket.distance); setSoloAiEvent(ticket.ai); reseedSharedRandom(ticket.seed);
        const roster = buildRandomizedAiRoster(ticket.ai.opponentCount).map(r => r.profile);
        const focus = { characterId: character, level: levels[tier], difficulty: AI_INTELLIGENCE[skills[tier]].value };
        const racers = [focus, ...roster].map((r, i) => h.create(r.characterId, r.level, r.difficulty, 0,
            (i - roster.length / 2) * 2.625));
        if (focusInput === 'kick-only') racers[0].ai.stopSwimming();
        const bodies = racers.map(r => r.body), observer = new AIRaceObserver(null, bodies);
        for (const r of racers) r.ai.raceObserver = observer;
        SWIMMER_COLLISION.enabled = false; resolveSwimmerCollisions([]); SWIMMER_COLLISION.enabled = true;
        const times = racers.map(() => null);
        let deadline = Infinity, seconds = 0, nextKick = 0, side = StrokeType.LEFT;
        for (; seconds < 600 && times.some(t => t === null); seconds += 1 / fps) {
            if (focusInput === 'kick-only' && times[0] === null && seconds >= nextKick) {
                racers[0].body.handleKickStroke(side);
                side = side === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
                nextKick += 1 / kickHz;
            }
            for (let i = 0; i < racers.length; i++) if (times[i] === null) racers[i].step(1 / fps);
            resolveSwimmerCollisions(bodies);
            for (let i = 0; i < racers.length; i++) if (times[i] === null && bodies[i].distance >= ticket.distance) {
                times[i] = seconds + 1 / fps;
                deadline = Math.min(deadline, times[i] + ticket.terms.finishGraceSeconds);
                if (i === 0) deadline = Math.min(deadline, times[i] + 10);
                racers[i].ai.stopSwimming(); bodies[i].stopRace();
            }
            if (seconds + 1 / fps >= deadline) break;
        }
        const ordered = racers.map((r, i) => ({ i, time: times[i], distance: r.body.distance })).sort((a, b) =>
            (a.time ?? Infinity) - (b.time ?? Infinity) || b.distance - a.distance || a.i - b.i);
        const placement = ordered.findIndex(r => r.i === 0) + 1;
        const settled = executeCareer(profile, { type: 'settle', ticketId: ticket.id,
            placement, racerCount: racers.length, finished: times[0] !== null, time: times[0] ?? 0,
            ...racers[0].body.rhythmStats });
        if (!settled.ok) throw Error(settled.message);
        results.push({ tier, eventId: ticket.terms.eventId, character, level: levels[tier], skill: skills[tier],
            seed, fps, focusInput, kickHz, rule: ticket.rule, distance: ticket.distance, racerCount: racers.length, placement,
            finished: times[0] !== null, seconds: times[0], qualified: times[0] !== null
                && placement <= ticket.terms.qualifyPlace, points: settled.receipt.points,
            coins: settled.receipt.coinsGained, regularCoins: settled.receipt.regular,
            championCoins: settled.receipt.podium, firstClearCoins: settled.receipt.first,
            factor: ticket.terms.factor,
            aiDnf: times.slice(1).filter(t => t === null).length });
    }
}
setSoloAiEvent(null); setSoloRaceDistance(null);
SWIMMER_COLLISION.enabled = false; resolveSwimmerCollisions([]); SWIMMER_COLLISION.enabled = true;
const output = option('output', '.cache/career-benchmark.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ note: '真实阵容与碰撞，水面起步，焦点选手是AI输入基线；不含出发飞行、真人触屏与网络。', results }, null, 2));
console.log(JSON.stringify({ output, races: results.length, focusDnf: results.filter(r => !r.finished).length }));
for (const tier of tiers) {
    const rows = results.filter(r => r.tier === tier);
    console.log(JSON.stringify({ tier, races: rows.length, dnf: rows.filter(r => !r.finished).length,
        meanPlacement: rows.reduce((n, r) => n + r.placement, 0) / rows.length,
        leagueCoinsPerMinute: (() => { const leagues = rows.filter(r => r.eventId.includes('-league-') && r.finished);
            return leagues.reduce((n, r) => n + r.regularCoins, 0) / leagues.reduce((n, r) => n + r.seconds, 0) * 60; })(),
        cupQualifies: rows.filter(r => r.eventId.includes('-cup-') && r.qualified).length }));
}
