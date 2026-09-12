const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');
const h = createAiHarness();
const { AI_INTELLIGENCE, AI_CHARACTER_STRATEGIES, AI_EVENTS, AI_EVENT_BY_MODE } = h.load('competitor/AiRaceConfig');
const { AiRacePlanner } = h.load('competitor/AiRacePlanner');
const { PLAYER_CHARACTER_DEFINITIONS } = h.load('app/PlayerCharacterConfig');
const { setRaceDifficulty } = h.load('core/GameBalance');
const { reseedSharedRandom } = h.load('core/SharedRNG');
const { buildRandomizedAiRoster } = h.load('competitor/CompetitorConfig');
const { STROKE_QUALITY_TUNING } = h.load('core/InputTuning');
const { PlayerConditionModel } = h.load('condition/PlayerConditionModel');

function observation(overrides = {}) {
    return { distance: 100, raceDistance: 200, wallDistance: 40, energy: 80, energyTotal: 140,
        heartRate: 100, speed: 2.5, infiniteStamina: false, supportsDolphin: true, dolphinReady: false,
        dolphinCost: 5, dolphinRange: 8, dolphinStrain: 25, minDolphinSpace: 3, kickDive: false,
        nearbyThreat: false, closeRace: false, strokeCostPerMeter: .7, ...overrides };
}

test('11个角色各等级与玩家共用属性和体力；智力不改身体', () => {
    for (const c of PLAYER_CHARACTER_DEFINITIONS) for (const level of [1, 15, 30]) {
        const s = h.create(c.id, level, .3), elite = h.create(c.id, level, 1);
        assert.deepEqual(s.profile, elite.profile);
        assert.equal(s.condition.energyTotal, c.stamina + level - 1);
        assert.equal(s.body.motor.weight, c.weight);
        assert.equal(s.body.motor.ability.id, c.abilityId);
        assert.equal(s.body.ultimate.gainAptitude, c.energyGain);
        const player = new PlayerConditionModel();
        player.setProgressionOverrides({ energyTotal: s.condition.energyTotal });
        player.setInfiniteStamina(c.abilityId === 'exoskeleton'); player.reset();
        for (let n = 0; n < 9; n++) player.updateFromStroke({ strokeAccepted: true });
        s.condition.consumeStrokes(9);
        player.consumeEnergy(5); s.condition.consumeEnergy(5);
        assert.equal(player.energy, s.condition.energy);
        const ratio = s.condition.energyRatio;
        s.condition.applyAuthoritativeState(ratio, 153);
        assert.ok(Math.abs(s.condition.energy - player.energy) < 1e-8);
        s.condition.reset(); assert.equal(s.condition.energy, c.stamina + level - 1);
    }
});

test('赛事等级段与智力独立、固定种子阵容复现、正式阵容不出现变态档', () => {
    const run = mode => { setRaceDifficulty(mode); reseedSharedRandom(987); return buildRandomizedAiRoster(8); };
    const first = run('beginner');
    assert.deepEqual(run('beginner'), first);
    assert.deepEqual(run('championship'), first, '赛程变化本身不改赛事强度');
    for (const { profile } of first) {
        assert.ok(profile.level >= 1 && profile.level <= 5);
        assert.notEqual(profile.intelligence, 'extreme');
        assert.ok(AI_CHARACTER_STRATEGIES[profile.characterId]);
    }
    const old = AI_EVENT_BY_MODE.beginner;
    try {
        AI_EVENT_BY_MODE.beginner = 'elite';
        for (const { profile } of run('beginner')) assert.ok(profile.level >= AI_EVENTS.elite.minLevel && profile.level <= 30);
    } finally { AI_EVENT_BY_MODE.beginner = old; }
});

test('400米更早节省体力；恢复有滞回；冲刺要求真实剩余体力', () => {
    const style = AI_CHARACTER_STRATEGIES.cartonSwimmer6, skill = AI_INTELLIGENCE.expert;
    const short = new AiRacePlanner(), long = new AiRacePlanner();
    short.decide(observation({ energy: 90 }), style, skill, .2);
    long.decide(observation({ raceDistance: 400, energy: 90 }), style, skill, .2);
    assert.equal(short.action, 'swim'); assert.equal(long.action, 'save');
    const p = new AiRacePlanner();
    p.decide(observation({ heartRate: 180 }), style, skill, .2); assert.equal(p.action, 'recover');
    p.decide(observation({ heartRate: 150 }), style, skill, 3); assert.equal(p.action, 'recover');
    p.decide(observation({ heartRate: 110 }), style, skill, 3); assert.equal(p.action, 'swim');
    p.decide(observation({ distance: 185, energy: 20 }), style, skill, 3); assert.equal(p.action, 'sprint');
    p.decide(observation({ distance: 185, energy: 2 }), style, skill, 3); assert.equal(p.action, 'save');
});

test('技能服从资格、空间、心率、预算；机器人不为体力休息、潜水哥会避碰', () => {
    const p = new AiRacePlanner(), style = AI_CHARACTER_STRATEGIES.cartonSwimmer8, skill = AI_INTELLIGENCE.expert;
    p.decide(observation({ dolphinReady: true }), style, skill, 2); assert.equal(p.wantsJump, true);
    for (const patch of [{ supportsDolphin: false }, { wallDistance: 2 }, { energy: 5 }, { heartRate: 170 }]) {
        p.reset(); p.decide(observation({ dolphinReady: true, ...patch }), style, skill, 2);
        // 高心率如果决定接下来恢复，可以接受正常负担后恢复，不把它当绝对禁用条件。
        if (!patch.heartRate) assert.equal(p.wantsJump, false);
    }
    p.reset(); p.decide(observation({ energy: 0, infiniteStamina: true }), AI_CHARACTER_STRATEGIES.cartonSwimmer15, skill, 1);
    assert.equal(p.action, 'swim');
    p.decide(observation({ kickDive: true, nearbyThreat: true }), AI_CHARACTER_STRATEGIES.cartonSwimmer13, skill, 1);
    assert.equal(p.action, 'evade');
});

test('极限预按仍完整经过长按分类，按下只给一次踢腿反馈', () => {
    setRaceDifficulty('beginner'); reseedSharedRandom(42);
    const s = h.create('cartonSwimmer15', 30, 1);
    let clock = 0, promotions = 0;
    const pressed = new Map();
    const kick = s.body.handleKickStroke.bind(s.body), held = s.body.handleStrokeHeld.bind(s.body);
    s.body.handleKickStroke = (side, confirmed) => { if (confirmed === false) pressed.set(side, clock); return kick(side, confirmed); };
    s.body.handleStrokeHeld = (side, down, pre) => {
        if (down) {
            assert.ok(pressed.has(side));
            assert.ok(clock - pressed.get(side) >= STROKE_QUALITY_TUNING.minHoldSeconds - 1e-8);
            assert.equal(pre, STROKE_QUALITY_TUNING.minHoldSeconds); promotions++;
        }
        return held(side, down, pre);
    };
    for (let i = 0; i < 600; i++) { clock += 1 / 60; s.step(1 / 60); }
    assert.ok(promotions > 10);
});

test('所有角色极限档真实200/400米能完赛，禁跳角色不跳，精度不靠修改判定', () => {
    for (const distance of [200, 400]) for (const c of PLAYER_CHARACTER_DEFINITIONS) {
        setRaceDifficulty(distance === 400 ? 'championship' : 'beginner'); reseedSharedRandom(2468);
        const s = h.create(c.id, 1, 1);
        let t = 0, depleted = null;
        for (; t < 240 && s.body.distance < distance; t += 1 / 30) {
            s.step(1 / 30); if (s.condition.energy <= 0 && depleted === null) depleted = t;
        }
        assert.ok(s.body.distance >= distance, c.id);
        assert.ok(depleted === null || t - depleted < 2, `${c.id}提前耗尽 ${t - depleted}`);
        assert.equal(s.body.rhythmStats.missCount, 0);
        assert.equal(s.body.rhythmStats.goodCount, 0);
        if (c.abilityId === 'kickDive' || c.abilityId === 'exoskeleton') assert.equal(s.ai.debugSnapshot().jumps, 0);
        if (distance === 400 && c.abilityId !== 'exoskeleton') assert.ok(s.ai.debugSnapshot().kickSeconds > 15);
    }
});

test('固定种子复现决策和成绩；远端真人、隐藏泳者不产生输入', () => {
    const run = () => {
        setRaceDifficulty('beginner'); reseedSharedRandom(4242);
        const s = h.create('cartonSwimmer10', 15, .5);
        for (let i = 0; i < 900; i++) s.step(1 / 30);
        return { distance: s.body.distance, ...s.ai.debugSnapshot(), ...s.body.rhythmStats };
    };
    assert.deepEqual(run(), run());
    for (const remote of [true, false]) {
        const s = h.create(); s.ai.remoteDriven = remote; s.body.node.active = remote;
        s.body.handleStroke = s.body.handleStrokeHeld = s.body.handleKickStroke = s.body.tryDolphinJump = () => assert.fail('不得操作');
        for (let i = 0; i < 200; i++) s.ai.stepSimulation(1 / 30);
        assert.equal(s.ai.debugSnapshot().decisions, 0);
    }
});

test('赛况观察对所有对手一致，不跨泳池把折返另一端当成贴身碰撞', () => {
    const { AIRaceObserver } = h.load('competitor/AIRaceObserver');
    const a = h.create().body, b = h.create().body, c = h.create().body;
    a.node.position.set(0, 0, 0); b.node.position.set(2, 0, 1); c.node.position.set(30, 0, 0);
    const first = new AIRaceObserver(b, [a, b, c]), second = new AIRaceObserver(c, [a, b, c]);
    assert.equal(first.nearestPhysicalOpponent(a, 4, 2), b);
    assert.equal(second.nearestPhysicalOpponent(a, 4, 2), b);
    b.node.active = false; assert.equal(first.nearestPhysicalOpponent(a, 4, 2), null);
});

test('观察真实AI的按压与结算只发送展示事件，不改变输入序列、成绩或资源', () => {
    const { StrokeType } = h.load('core/GameConstants');
    let presses = 0, releases = 0, results = 0;
    const sides = new Set();
    const run = observed => {
        setRaceDifficulty('championship'); reseedSharedRandom(4242);
        const s = h.create('cartonSwimmer5', 15, 1);
        if (observed) {
            s.ai.onObservedPressChanged = (side, pressed) => { sides.add(side); if (pressed) presses++; else releases++; };
            s.body.onObservedRhythmResult = result => { assert.ok(result.strokeSide === StrokeType.LEFT || result.strokeSide === StrokeType.RIGHT); results++; };
        }
        for (let i = 0; i < 1800; i++) s.step(1 / 30);
        const summary = { distance: s.body.distance, energy: s.condition.energy, heartRate: s.condition.heartRate,
            ...s.body.rhythmStats, ...s.ai.debugSnapshot() };
        if (observed) {
            const stats = s.body.rhythmStats;
            assert.equal(results, stats.perfectCount + stats.goodCount + stats.missCount, '每次结算只反馈一次');
            s.ai.stopSwimming();
            assert.equal(s.ai.isInputPressed(StrokeType.LEFT), false);
            assert.equal(s.ai.isInputPressed(StrokeType.RIGHT), false);
        }
        return summary;
    };
    assert.deepEqual(run(false), run(true));
    assert.ok(presses > 0 && releases > 0 && results > 0);
    assert.equal(sides.size, 2);
});

test('八个真实AI在狂野模式争位、碰撞和折返后仍能完赛，资源无异常', () => {
    const { AIRaceObserver } = h.load('competitor/AIRaceObserver');
    const { resolveSwimmerCollisions, SWIMMER_COLLISION } = h.load('entity/SwimmerCollisionResolver');
    setRaceDifficulty('competitive'); reseedSharedRandom(888);
    SWIMMER_COLLISION.enabled = false; resolveSwimmerCollisions([]); SWIMMER_COLLISION.enabled = true;
    const ids = ['muscleMan', 'cartonSwimmer9', 'cartonSwimmer13', 'cartonSwimmer5', 'cartonSwimmer10', 'cartonSwimmer11', 'cartonSwimmer14', 'cartonSwimmer8'];
    const racers = ids.map((id, i) => h.create(id, 15, .95, 0, i - 3.5));
    const bodies = racers.map(s => s.body), observer = new AIRaceObserver(null, bodies);
    let contacts = 0;
    for (const s of racers) {
        s.ai.raceObserver = observer;
        const bonus = s.body.addCollisionEnergyBonus.bind(s.body);
        s.body.addCollisionEnergyBonus = impulse => { contacts++; bonus(impulse); };
    }
    for (let step = 0; step < 9000 && bodies.some(b => b.distance < 200); step++) {
        for (const s of racers) if (s.body.distance < 200) s.step(1 / 30);
        resolveSwimmerCollisions(bodies);
    }
    assert.ok(contacts > 0);
    for (const s of racers) {
        assert.ok(s.body.distance >= 200, `${s.ai.characterId}被困在${s.body.distance}`);
        assert.ok(Number.isFinite(s.condition.energy) && s.condition.energy >= 0);
        assert.ok(Number.isFinite(s.body.node.position.z));
    }
    SWIMMER_COLLISION.enabled = false; resolveSwimmerCollisions([]); SWIMMER_COLLISION.enabled = true;
});

test('真实流程：倒计时重置AI，玩家晚跳不恢复AI体力，联机远端真人不被重置', () => {
    const tsPath = process.env.TYPESCRIPT_PATH || process.env.PATH.split(path.delimiter)
        .map(p => path.resolve(p, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p));
    const ts = require(tsPath);
    const file = path.join(h.root, 'assets/scripts/core/GameManager.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    let dive;
    const visit = node => { if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'applyPlayerDive') dive = node.initializer; ts.forEachChild(node, visit); };
    visit(source); assert.ok(dive);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'GameManager');
    const methods = cls.members.filter(n => ['syncConditionPhase', 'phaseForState'].includes(n.name?.getText(source)));
    const js = ts.transpileModule(`function makeDive() { return ${dive.getText(source)}; } class Flow { ${methods.map(n => n.getText(source)).join('\n')} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const { RacePhase } = h.load('condition/ConditionTypes'), { GameState } = h.load('core/GameConstants');
    const { makeDive, Flow } = vm.runInNewContext(js + ';({makeDive,Flow})', { RacePhase, GameState, reseedSharedRandom, getAiDebugSetup: () => ({ seed: 42 }) });
    for (const net of [false, true]) {
        const body = h.create(), remote = h.create();
        body.condition.consumeEnergy(20); remote.condition.consumeEnergy(30);
        const owner = new Flow();
        Object.assign(owner, { _netSession: net ? {} : null, _aiDebugMode: false,
            _aiConditions: [body.condition, remote.condition], _aiControllers: [{ remoteDriven: false }, { remoteDriven: true }],
            _playerCondition: new PlayerConditionModel(), _raceContext: { reset() {}, setPhase() {} } });
        owner.syncConditionPhase(GameState.COUNTDOWN);
        assert.equal(body.condition.energy, body.condition.energyTotal);
        assert.equal(remote.condition.energy, remote.condition.energyTotal - 30);
        body.condition.consumeEnergy(25);
        makeDive.call(owner)({});
        assert.equal(body.condition.energy, body.condition.energyTotal - 25);
    }
});
