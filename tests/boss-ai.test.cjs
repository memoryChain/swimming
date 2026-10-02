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

function stationary(id = 'champion-muscles', initialDistance = 10) {
    const r = h.create(findBossPreset(id), { initialDistance });
    r.player.body.node.position.z = 0;
    r.team.forEach((s, i) => { s.body.node.position.z = i % 2 ? -.8 - i * .1 : .8 + i * .1; });
    r.director.reset();
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
    assert.ok(r.director.orders.some(o => o.phase === '协同集合就位'));
    decide(r, 1); assert.equal(r.director.phase, 'press');
    const pressing = r.director.orders.filter(o => o.task === 'intercept' || o.task === 'cover');
    assert.equal(pressing.length, 2); assert.ok(pressing[0].targetZ * pressing[1].targetZ < 0, '有两侧队员时分两侧配合');
    const identities = [...r.director.orders];
    assert.equal(pressing[0].partnerSlot, r.director.orders.indexOf(pressing[1]));
    assert.equal(pressing[1].partnerSlot, r.director.orders.indexOf(pressing[0]));
    assert.ok(r.director.orders.every(o => o.task !== 'race'), '整队有职责，不只有两个施压者接到任务');
    assert.ok(r.director.orders.some(o => o.task === 'relay'));
    decide(r, 3); assert.equal(r.director.phase, 'release');
    assert.ok(r.director.orders.some(o => o.phase === '撤出阵型让位接班'));
    decide(r, 2); assert.equal(r.director.phase, 'rest');
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
    const index = r.director.orders.findIndex(o => o.task === 'intercept');
    r.team[index].body.applyCollisionImpulse(-1, 0); r.director.update(.25);
    assert.equal(r.director.phase, 'release'); assert.equal(r.director.contactBreaks, 1);
    assert.ok(r.director.orders.every(o => o.task !== 'intercept' && o.task !== 'cover'));
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

test('八关真实输入能跑完；禁跳角色不跳，主动配合不超限', () => {
    for (const p of presets) {
        const row = h.replay(p, { character: 'cartonSwimmer6', level: 30, skill: 'expert', fps: 30, completeField: true });
        assert.ok(row.finished, p.id); assert.ok(row.longestStall <= 8, p.id);
        assert.equal(row.aiDnf, 0, '解除收尾窗口后，全部AI也能游完全程');
        assert.ok(row.maxConcurrent <= p.pressureCount, p.id);
        assert.ok(row.team.every(s => Number.isFinite(s.energy) && s.energy >= 0));
        for (const s of row.team) if (s.character === 'cartonSwimmer13' || s.character === 'cartonSwimmer15') assert.equal(s.jumps, 0);
        if (p.policy === 'dive') {
            assert.ok(row.team.some(s => s.character === 'cartonSwimmer13' && s.underwater > 2));
            assert.ok(row.team.some(s => s.character === 'cartonSwimmer8' && s.jumps > 0));
        }
    }
});

test('队伍集结需要真实到位；远处成员有追赶/等待目标，超时仍不到位就取消进攻', () => {
    const r = stationary();
    for (let i = 1; i < r.team.length; i++) r.team[i].body.startRace(20, .8);
    decide(r, 3);
    assert.equal(r.director.phase, 'prepare');
    assert.equal(r.director.engagements, 0);
    const orders = r.director.orders.filter(o => o.task === 'intercept' || o.task === 'cover');
    assert.equal(orders.length, 2);
    assert.ok(orders.every(o => Number.isFinite(o.targetSpeed) && Number.isFinite(o.targetDistance)));
    decide(r, 10);
    assert.equal(r.director.engagements, 0);
    assert.equal(r.director.abortedAssemblies, 1);
});

test('进入最后50米池段后仍能组织团队，不把不存在的下一折返墙误算成负距离', () => {
    const r = stationary('champion-muscles', 160);
    assert.equal(r.player.body.courseLayout.nextInternalTurnDistance(160, 200), null);
    decide(r, 3);
    assert.equal(r.director.phase, 'press');
    assert.ok(r.director.orders.some(o => o.task === 'intercept'));
});

test('候补保留分开的巡航通道，玩家换侧不会把未参与集结的队员全部挤到池边', () => {
    const r = h.create(findBossPreset('champion-muscles'), { initialDistance: 10 });
    const homes = r.team.map(s => s.body.node.position.z);
    r.player.body.node.position.z = 5;
    decide(r, .25);
    const reserves = r.director.orders.map((o, i) => ({ o, i })).filter(({ o }) => o.task === 'reserve');
    assert.equal(reserves.length, 6);
    for (const { o, i } of reserves) assert.equal(o.targetZ, homes[i]);
    assert.equal(new Set(reserves.map(({ o }) => o.targetZ)).size, reserves.length);
    assert.ok(reserves.every(({ o }) => o.targetSpeed === null), '待命不为陪跑而集体减速');
});

test('折返侧翼提前集结，真实进入折返窗口才发起进攻', () => {
    const r = stationary('master-wall', 20);
    decide(r, 7);
    assert.equal(r.director.phase, 'prepare');
    assert.equal(r.director.engagements, 0);
    assert.equal(r.director.orders.filter(o => o.task === 'intercept' || o.task === 'cover').length, 2);
    for (let i = 0; i < r.team.length; i++) {
        const o = r.director.orders[i];
        if (o.task !== 'intercept' && o.task !== 'cover') continue;
        r.team[i].body.startRace(o.targetDistance, .8);
        r.team[i].body.node.position.z = o.targetZ;
    }
    r.director.update(.25);
    assert.equal(r.director.phase, 'prepare', '队形到位也不能提前进入施压阶段');
    for (const s of r.racers) {
        const z = s.body.node.position.z;
        s.body.startRace(s.body.distance + 10, .8);
        // startRace会还原出发泳道；本夹具只向前推进池段，保留已到位的队形。
        s.body.node.position.z = z;
    }
    r.director.update(.25);
    assert.equal(r.director.phase, 'press');
    assert.equal(r.director.engagements, 1);
});

test('队员退出、转向异向或改为真人时，整组取消失效配合且不再发指令给该成员', () => {
    for (const kind of ['remote', 'stop', 'turn']) {
        const r = stationary(); decide(r, 3);
        const index = r.director.orders.findIndex(o => o.task === 'cover');
        if (kind === 'remote') r.team[index].ai.remoteDriven = true;
        if (kind === 'stop') r.team[index].body.stopRace();
        if (kind === 'turn') r.team[index].body.startRace(65, .8);
        r.director.update(.25);
        assert.equal(r.director.phase, 'release', kind);
        assert.equal(r.director.orders[index].task, 'race', kind);
        assert.equal(r.director.orders[index].targetSpeed, null, kind);
    }
});

test('潜航队友真实下潜后才放行穿越，计时器本身不能假装潜航已经完成', () => {
    const r = h.create(findBossPreset('region-dive'), { level: 14, skill: 'skilled', initialDistance: 10 });
    r.player.body.node.position.z = 0;
    r.team[2].body.node.position.z = -1;
    r.team[3].body.node.position.z = 1.2;
    r.director.reset(); decide(r, 2.5);
    const diverIndex = r.director.orders.findIndex(o => o.task === 'dive');
    const hopperIndex = r.director.orders.findIndex(o => o.task === 'pass');
    assert.ok(diverIndex >= 0 && hopperIndex >= 0);
    assert.equal(r.director.orders[hopperIndex].partnerSlot, diverIndex);
    assert.equal(r.director.orders[hopperIndex].allowJump, false);
    assert.equal(r.director.phase, 'prepare');
    assert.ok(r.director.orders[diverIndex].preferKick);
    for (let n = 0; n < 20; n++) r.team[diverIndex].step(.05);
    assert.equal(r.team[diverIndex].body.isUnderwater, true);
    r.director.update(.25);
    assert.equal(r.director.phase, 'press');
    assert.equal(r.director.orders[hopperIndex].allowJump, true);
    assert.ok(r.director.divePassSamples > 0);
});

test('真实输入形成双人施压、接班和技能接应，30/60Hz均有实际协作窗口', () => {
    const characters = h.load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS.map(c => c.id);
    for (const fps of [30, 60]) {
        const dives = [];
        for (const seed of [42, 2468, 20261002]) for (const character of ['cartonSwimmer6', 'cartonSwimmer13', 'muscleMan']) {
            dives.push(h.replay(findBossPreset('region-dive'), { character, level: 14, skill: 'skilled', seed, fps }));
        }
        assert.ok(dives.some(r => r.engagements > 0 && r.divePassSeconds > 0), `潜航${fps}Hz`);
        const groups = [];
        for (const seed of [42, 2468, 20261002]) for (const character of characters) {
            groups.push(h.replay(findBossPreset('champion-muscles'), { character, level: 30, skill: 'expert', seed, fps }));
        }
        assert.ok(groups.some(r => r.pairedPressureSeconds > 0), `双人真实近距${fps}Hz`);
        assert.ok(groups.every(r => r.assignmentBySlot.every(n => n > 0)), '七名队员都有团队职责');
    }
    const relays = [];
    for (const fps of [30, 60]) for (const seed of [42, 2468, 20261002]) for (const character of characters) {
        relays.push(h.replay(findBossPreset('region-endurance'), { character, level: 17, skill: 'skilled', seed, fps }));
    }
    assert.ok(relays.some(r => r.handoffs > 0), '接班者实际接替并发起下一次协作');
    assert.ok(relays.some(r => r.pressureBySlot.filter(n => n > 0).length >= 2), '双方轮换，不是同一机甲独游');
});

test('团队路线与等待配速通过真实左右划水和踢腿实现，不给速度、位移或体力补偿', () => {
    const r = h.create(findBossPreset('champion-muscles'));
    const member = r.team[3], order = r.director.orders[3];
    order.targetZ = 4; order.targetSpeed = order.targetDistance = null; order.allowJump = false;
    const before = member.body.node.position.z;
    for (let n = 0; n < 240; n++) member.step(1 / 30);
    assert.ok(Math.abs(member.body.node.position.z - 4) < Math.abs(before - 4), '持续真实斜游能向集合路线靠拢');
    order.targetZ = member.body.node.position.z; order.targetSpeed = .4; order.targetDistance = member.body.distance - 3;
    const energy = member.condition.energy, kicks = member.ai.debugSnapshot().kickSeconds;
    for (let n = 0; n < 90; n++) member.step(1 / 30);
    assert.ok(member.ai.debugSnapshot().kickSeconds > kicks + 1, '领先的接班队员真实踢腿等待');
    assert.ok(member.condition.energy <= energy, '策略不能恢复体力');
});

test('同种子完整Boss回放复现成绩、资源与换班，普通对手不挂任何Boss指令', () => {
    const p = findBossPreset('champion-muscles'), options = { fps: 60, character: 'cartonSwimmer13', seed: 2468 };
    assert.deepEqual(h.replay(p, options), h.replay(p, options));
    assert.equal(h.create(findBossPreset('city-ninja')).player.ai.bossOrder, null);
    balance.setSoloRaceDistance(null); setSoloAiEvent(null); assert.equal(getFixedSoloAiCount(), undefined);
});
