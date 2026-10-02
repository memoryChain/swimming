// Boss真实输入回放：共用原划水、体力、转向、碰撞和折返，只替换渲染外壳。
const { createAiHarness } = require('./ai-race-harness.cjs');

function createBossHarness() {
    const h = createAiHarness();
    const { BOSS_AI_PRESETS } = h.load('competitor/BossAiConfig');
    const { BossAiDirector } = h.load('competitor/BossAiDirector');
    const { AI_INTELLIGENCE } = h.load('competitor/AiRaceConfig');
    const { AIRaceObserver } = h.load('competitor/AIRaceObserver');
    const { setRaceDifficulty, setSoloRaceDistance, FINISH_STRAGGLER_COUNTDOWN_SECONDS } = h.load('core/GameBalance');
    const { reseedSharedRandom } = h.load('core/SharedRNG');
    const { resolveSwimmerCollisions, SWIMMER_COLLISION } = h.load('entity/SwimmerCollisionResolver');

    function create(preset, { character = 'cartonSwimmer6', level = 30, skill = 'expert', seed = 42,
        playerIndex = 3, initialDistance = 0 } = {}) {
        setRaceDifficulty(preset.mode); setSoloRaceDistance(preset.distance); reseedSharedRandom(seed);
        SWIMMER_COLLISION.enabled = false; resolveSwimmerCollisions([]); SWIMMER_COLLISION.enabled = true;
        const count = preset.roster.length + 1;
        playerIndex %= count;
        const z = i => (i - (count - 1) / 2) * 2.625;
        const player = h.create(character, level, AI_INTELLIGENCE[skill].value, initialDistance, z(playerIndex));
        const team = preset.roster.map((slot, i) => h.create(slot.characterId, slot.level,
            AI_INTELLIGENCE[slot.skill].value, initialDistance, z(i >= playerIndex ? i + 1 : i)));
        const racers = [player, ...team], bodies = racers.map(r => r.body);
        const observer = new AIRaceObserver(player.body, bodies);
        for (const r of racers) r.ai.raceObserver = observer;
        const director = new BossAiDirector(preset, player.body, team.map(r => r.ai));
        for (let i = 0; i < team.length; i++) team[i].ai.bossOrder = director.orders[i];
        return { player, team, racers, bodies, director, preset };
    }

    function replay(preset, options = {}) {
        const fps = options.fps ?? 30, dt = 1 / fps, race = create(preset, options);
        const { player, team, racers, bodies, director } = race;
        const times = racers.map(() => null), stats = racers.map(() => ({ contacts: 0, underwater: 0 }));
        let seconds = 0, deadline = Infinity, closePressureFrames = 0, maxConcurrent = 0;
        let stalledSeconds = 0, longestStall = 0, nextSample = 1, previousDistance = 0;
        for (let i = 0; i < racers.length; i++) {
            const collision = bodies[i].addCollisionEnergyBonus.bind(bodies[i]);
            bodies[i].addCollisionEnergyBonus = impulse => { stats[i].contacts++; collision(impulse); };
        }
        for (; seconds < 600 && times.some(t => t === null); seconds += dt) {
            director.update(dt);
            let concurrent = 0;
            for (let i = 0; i < team.length; i++) if (director.phase === 'press'
                && (director.orders[i].task === 'intercept' || director.orders[i].task === 'cover')) {
                concurrent++;
                if (Math.abs(team[i].body.node.position.x - player.body.node.position.x) < 2.5
                    && Math.abs(team[i].body.node.position.z - player.body.node.position.z) < 2.1) closePressureFrames++;
            }
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            for (let i = 0; i < racers.length; i++) if (times[i] === null) {
                racers[i].step(dt);
                if (bodies[i].isUnderwater) stats[i].underwater += dt;
                if (!Number.isFinite(bodies[i].node.position.z) || !Number.isFinite(racers[i].condition.energy)
                    || racers[i].condition.energy < 0) throw Error('回放出现无效状态');
            }
            resolveSwimmerCollisions(bodies);
            for (let i = 0; i < racers.length; i++) if (times[i] === null && bodies[i].distance >= preset.distance) {
                times[i] = seconds + dt; deadline = Math.min(deadline, times[i] + FINISH_STRAGGLER_COUNTDOWN_SECONDS);
                racers[i].ai.stopSwimming(); bodies[i].stopRace();
            }
            if (seconds >= nextSample && times[0] === null) {
                stalledSeconds = player.body.distance - previousDistance < 0.1 ? stalledSeconds + 1 : 0;
                longestStall = Math.max(longestStall, stalledSeconds);
                previousDistance = player.body.distance; nextSample++;
            }
            if (!options.completeField && seconds + dt >= deadline) break;
        }
        const ordered = times.map((time, i) => ({ i, time, distance: bodies[i].distance })).sort((a, b) =>
            (a.time ?? Infinity) - (b.time ?? Infinity) || b.distance - a.distance || a.i - b.i);
        const placement = ordered.findIndex(r => r.i === 0) + 1;
        return { id: preset.id, character: options.character ?? 'cartonSwimmer6', level: options.level ?? 30,
            skill: options.skill ?? 'expert', seed: options.seed ?? 42, fps, placement, finished: times[0] !== null,
            qualified: times[0] !== null && placement <= preset.qualifyPlace, seconds: times[0],
            aiDnf: times.slice(1).filter(t => t === null).length,
            pressureSamples: director.pressureSamples, pressureBySlot: [...director.pressureBySlot],
            contactBreaks: director.contactBreaks, diveDecisions: director.diveDecisions,
            assemblies: director.assemblies, engagements: director.engagements, handoffs: director.handoffs,
            abortedAssemblies: director.abortedAssemblies, formationSamples: director.formationSamples,
            pairedPressureSeconds: director.pairedPressureSamples * .25, divePassSeconds: director.divePassSamples * .25,
            assignmentBySlot: [...director.assignmentBySlot],
            closePressureSeconds: closePressureFrames * dt, maxConcurrent, longestStall,
            playerContacts: stats[0].contacts, playerEnergy: player.condition.energy,
            team: team.map((r, i) => ({ character: r.ai.characterId, seconds: times[i + 1],
                energy: r.condition.energy, contacts: stats[i + 1].contacts, underwater: stats[i + 1].underwater,
                jumps: r.ai.debugSnapshot().jumps, kickSeconds: r.ai.debugSnapshot().kickSeconds })) };
    }
    return { ...h, createSwimmer: h.create, BOSS_AI_PRESETS, BossAiDirector, create, replay };
}
module.exports = { createBossHarness };
