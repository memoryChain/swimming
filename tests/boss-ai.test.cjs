const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createBossHarness } = require('./helpers/boss-race-harness.cjs');
const h = createBossHarness();
const { BOSS_AI_PRESETS: presets } = h;
const { AI_CHARACTER_STRATEGIES, AI_INTELLIGENCE } = h.load('competitor/AiRaceConfig');
const { findBossPreset, bossRoster } = h.load('competitor/BossAiConfig');
const launch = h.load('core/GameLaunchOptions');
const { setSoloAiEvent, getFixedSoloAiCount } = h.load('competitor/CompetitorConfig');
const balance = h.load('core/GameBalance');
const tsPath = process.env.TYPESCRIPT_PATH || process.env.PATH.split(path.delimiter)
    .map(dir => path.resolve(dir, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p));
const ts = require(tsPath);
const source = ts.createSourceFile('GameManager.ts', fs.readFileSync(path.join(h.root, 'assets/scripts/core/GameManager.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'GameManager');
const method = name => cls.members.find(n => n.name?.getText(source) === name).getText(source);
const compile = (methods, context) => vm.runInNewContext(ts.transpileModule(`class Flow { ${methods.join('\n')} }; Flow`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);

function stationary(id = 'champion-muscles') {
    const r = h.create(findBossPreset(id), { initialDistance: 10 });
    r.player.body.node.position.z = 0;
    r.team.forEach((s, i) => { s.body.node.position.z = i % 2 ? -.8 - i * .1 : .8 + i * .1; });
    return r;
}
function decide(r, seconds) { for (let t = 0; t + 1e-8 < seconds; t += .25) r.director.update(.25); }

test('八个Boss固定席位保留各自角色、等级和智力，不被普通调试统一参数覆盖', () => {
    assert.equal(presets.length, 8); assert.equal(new Set(presets.map(p => p.id)).size, 8);
    for (const p of presets) {
        launch.setAiDebugSetup({ characterId: 'cartonSwimmer6', level: 1, mode: 'championship', seed: 42,
            opponentCount: 7, mixedCharacters: true, bossId: p.id });
        const setup = launch.getAiDebugSetup(), options = launch.resolveAiDebugBuildOptions(setup, 4, .15);
        assert.equal(setup.mode, p.mode); assert.equal(setup.opponentCount, p.roster.length);
        assert.equal(options.level, undefined); assert.equal(options.difficultyOverride, undefined);
        assert.equal(options.soloLane, p.roster.length === 1 ? 4 : undefined);
        assert.deepEqual(options.fixedRoster, bossRoster(p));
        for (let i = 0; i < p.roster.length; i++) {
            const slot = p.roster[i], entry = options.fixedRoster[i];
            assert.ok(slot.level >= 1 && slot.level <= 30);
            assert.notEqual(slot.skill, 'extreme'); assert.equal(entry.profile.difficulty, AI_INTELLIGENCE[slot.skill].value);
        }
    }
    launch.setAiDebugSetup({ ...launch.getAiDebugSetup(), bossId: '不存在', level: 12, opponentCount: 1 });
    const normal = launch.resolveAiDebugBuildOptions(launch.getAiDebugSetup(), 4, .5);
    assert.equal(normal.fixedRoster, undefined); assert.equal(normal.level, 12); assert.equal(normal.difficultyOverride, .5);
});

test('团队只提交意图；预备、两侧施压、退让换班有上限且不改身体、资源或全局策略', () => {
    const global = JSON.stringify(AI_CHARACTER_STRATEGIES), r = stationary();
    const before = r.racers.map(s => ({ distance: s.body.distance, position: s.body.node.position.clone(),
        speed: s.body.currentSpeed, energy: s.condition.energy, heartRate: s.body.heartRate, rhythm: { ...s.body.rhythmStats } }));
    decide(r, 2); assert.equal(r.director.phase, 'prepare');
    assert.ok(r.director.orders.some(o => o.phase === '靠近预备'));
    decide(r, 1); assert.equal(r.director.phase, 'press');
    const pressing = r.director.orders.filter(o => o.phase === '协作争位');
    assert.equal(pressing.length, 2); assert.ok(pressing[0].targetZ * pressing[1].targetZ < 0, '有两侧队员时分两侧配合');
    const identities = [...r.director.orders];
    decide(r, 4); assert.equal(r.director.phase, 'rest');
    assert.ok(r.director.orders.some(o => o.phase === '拉开换班'));
    decide(r, 30);
    assert.equal(r.director.pressureBySlot[0], 0, '队长专注竞速');
    assert.ok(r.director.pressureBySlot.filter(n => n > 0).length >= 3, '交班不是永远同一队员');
    assert.deepEqual(r.racers.map(s => ({ distance: s.body.distance, position: s.body.node.position.clone(),
        speed: s.body.currentSpeed, energy: s.condition.energy, heartRate: s.body.heartRate, rhythm: { ...s.body.rhythmStats } })), before);
    assert.equal(JSON.stringify(AI_CHARACTER_STRATEGIES), global);
    r.director.reset(); assert.deepEqual(r.director.orders, identities);
    assert.equal(r.director.pressureSamples, 0); assert.ok(r.director.orders.every(o => o.targetZ === null));
});

test('碰撞失衡结束当前围堵并保留恢复间隔；池边、墙前和远端不会被强行招募', () => {
    const r = stationary(); decide(r, 3);
    const index = r.director.orders.findIndex(o => o.phase === '协作争位');
    r.team[index].body.applyCollisionImpulse(-1, 0); r.director.update(.25);
    assert.equal(r.director.phase, 'rest'); assert.equal(r.director.contactBreaks, 1);
    assert.ok(r.director.orders.every(o => o.phase !== '协作争位'));
    decide(r, 2); assert.equal(r.director.phase, 'rest');
    for (const kind of ['pool-edge', 'wall', 'remote', 'far']) {
        const safe = stationary();
        if (kind === 'pool-edge') safe.player.body.node.position.z = safe.player.body.courseLayout.poolWidth / 2 - .2;
        if (kind === 'wall') safe.player.body.motor.startRace(49, .8);
        if (kind === 'remote') safe.team.forEach(s => { s.ai.remoteDriven = true; });
        if (kind === 'far') safe.team.forEach(s => { s.body.node.position.x += 40; });
        decide(safe, 12); assert.equal(safe.director.pressureSamples, 0, kind);
        if (kind === 'remote') assert.ok(safe.director.orders.every(o => o.targetZ === null));
    }
});

test('玩家停赛后清除遗留指令，策略重置不换order身份且独立参数不污染普通AI', () => {
    const r = stationary(); decide(r, 3);
    assert.ok(r.director.orders.some(o => o.targetZ !== null));
    r.player.body.stopRace(); r.director.update(.25);
    assert.ok(r.director.orders.every(o => o.targetZ === null && !o.preferKick && o.allowJump));
    const combo = h.create(findBossPreset('master-combo'));
    assert.equal(combo.director.orders[0].style.heartTarget, 150);
    assert.equal(AI_CHARACTER_STRATEGIES.cartonSwimmer14.heartTarget, 162);
    assert.equal(h.createSwimmer('cartonSwimmer6').ai.bossOrder, null);
});

test('真实GameManager入口只在AI调试挂Boss，生涯票据、房间和网络不读取本地预设', () => {
    for (const [debug, room, net] of [[true, false, null], [true, true, null], [true, false, { seed: 99 }], [false, false, null]]) {
        let selected = null, distance = null, reads = 0;
        const ticket = { ai: { opponentCount: 7 }, distance: 200, seed: 12 };
        const Flow = compile([method('initializeRaceContext')], {
            consumeRoomMode: () => room, consumeNetRaceSession: () => net, consumeTutorialRequest: () => false,
            TUTORIAL_RUNTIME: {}, setSoloRaceTicket() {}, setSoloRaceDistance: v => { distance = v; },
            setSoloAiEvent: v => { selected = v; }, getSoloRaceTicket: () => ticket,
            findBossPreset, getAiDebugSetup: () => { reads++; return { bossId: 'master-combo' }; },
            reseedSharedRandom() {}, NetRaceController: class {},
        });
        const owner = new Flow(); owner._aiDebugMode = debug; owner.initializeRaceContext();
        if (debug && !room && !net) { assert.equal(distance, 400); assert.equal(selected.opponentCount, 1); assert.equal(reads, 1); }
        else { assert.equal(reads, 0); assert.equal(selected, debug ? null : ticket.ai); }
    }
});

test('Boss与普通AI调试均沿用10秒收尾，Boss阵容创建不会覆盖窗口，生涯仍读取票据', () => {
    const assignments = [];
    const visit = node => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && node.left.getText(source) === 'this._raceManager.finishGraceSeconds') assignments.push(node.getText(source));
        ts.forEachChild(node, visit);
    };
    visit(cls);
    assert.equal(assignments.length, 1, '创建Boss不能再次改写完赛窗口');
    const Flow = compile([`setup() { ${assignments[0]}; }`], { getSoloRaceTicket: () => ({ terms: { finishGraceSeconds: 90 } }) });
    for (const boss of [null, { preset: presets[0] }]) {
        const owner = new Flow(); Object.assign(owner, { _raceManager: {}, _bossAiDirector: boss,
            _roomMode: false, _netSession: null, _aiDebugMode: true, _tutorialMode: false });
        owner.setup(); assert.equal(owner._raceManager.finishGraceSeconds, 10);
    }
    const career = new Flow(); Object.assign(career, { _raceManager: {}, _roomMode: false,
        _netSession: null, _aiDebugMode: false, _tutorialMode: false });
    career.setup(); assert.equal(career._raceManager.finishGraceSeconds, 90);
});

test('真实固定阵容创建保留七个席位和居中1v1，重赛不调用随机阵容', () => {
    const { CompetitorManager } = h.load('competitor/CompetitorManager');
    for (const p of presets) {
        setSoloAiEvent({ minLevel: 1, maxLevel: 30, opponentCount: p.roster.length, intelligence: p.roster.map(s => s.skill) });
        balance.setRaceDifficulty(p.mode); balance.setSoloRaceDistance(p.distance);
        const one = p.roster.length === 1, playerLane = one ? 3 : 0, primaryLane = one ? 4 : 1;
        const manager = new CompetitorManager({ laneLayout: { laneCount: 8, centerZ: i => (i - 3.5) * 2.625 },
            courseLayout: h.create(p).player.body.courseLayout, playerLaneIndex: playerLane, primaryAiLaneIndex: primaryLane });
        manager._factory = { create(root, options) {
            const swimmer = h.createSwimmer().body; swimmer.swimmerName = options.displayName;
            swimmer.node.position.z = options.z;
            swimmer.node.addComponent = C => { const c = new C(); c.node = swimmer.node; return c; };
            return swimmer;
        } };
        const roster = bossRoster(p);
        const built = manager.buildAi({}, { fixedRoster: roster, soloLane: one ? primaryLane : undefined });
        assert.equal(built.aiControllers.length, p.roster.length);
        for (let i = 0; i < p.roster.length; i++) {
            const controller = built.aiControllers[i], slot = p.roster[i];
            assert.equal(controller.characterId, slot.characterId); assert.equal(controller.level, slot.level);
            assert.equal(controller.intelligence.id, slot.skill); assert.equal(controller.swimmer.swimmerName, slot.name);
        }
        if (one) assert.equal(built.aiSwimmers[0].node.position.z, 1.3125);
        assert.throws(() => manager.buildAi({}, { fixedRoster: roster.slice(0, -1) }), /人数不一致/);
    }
    setSoloAiEvent(null); balance.setSoloRaceDistance(null);
    let rerolls = 0;
    const Flow = compile([method('randomizeAiRosterForRestart')], {});
    const owner = new Flow(); owner._aiDebugMode = true;
    owner.createCompetitorManager = () => ({ reassignAiRoster() { rerolls++; } });
    owner.randomizeAiRosterForRestart(); assert.equal(rerolls, 0);
});

test('八关真实输入能跑完；潜航队真下潜和小跳，禁跳角色不跳，主动配合不超限', () => {
    for (const p of presets) {
        const row = h.replay(p, { character: 'cartonSwimmer6', level: 30, skill: 'expert', fps: 30, completeField: true });
        assert.ok(row.finished, p.id); assert.ok(row.longestStall <= 8, p.id);
        assert.equal(row.aiDnf, 0, '解除收尾窗口后，全部AI也能游完全程');
        assert.ok(row.maxConcurrent <= p.pressureCount, p.id);
        assert.ok(row.team.every(s => Number.isFinite(s.energy) && s.energy >= 0));
        for (const s of row.team) if (s.character === 'cartonSwimmer13' || s.character === 'cartonSwimmer15') assert.equal(s.jumps, 0);
        if (p.policy === 'dive') {
            assert.ok(row.diveDecisions > 0);
            assert.ok(row.team.filter(s => s.character === 'cartonSwimmer13').every(s => s.underwater > 2));
            assert.ok(row.team.some(s => s.character === 'cartonSwimmer8' && s.jumps > 0));
        }
        if (p.id === 'champion-muscles') {
            assert.ok(row.closePressureSeconds > 0); assert.ok(row.pressureBySlot.filter(n => n > 0).length >= 3);
        }
    }
});

test('同种子完整Boss回放复现成绩、资源与换班，普通对手不挂任何Boss指令', () => {
    const p = findBossPreset('champion-muscles'), options = { fps: 60, character: 'cartonSwimmer13', seed: 2468 };
    assert.deepEqual(h.replay(p, options), h.replay(p, options));
    assert.equal(h.create(findBossPreset('city-ninja')).player.ai.bossOrder, null);
    balance.setSoloRaceDistance(null); setSoloAiEvent(null); assert.equal(getFixedSoloAiCount(), undefined);
});
