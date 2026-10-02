// 离线检查真实导演与状态方法；不启动 Creator，不修改运行时配置。
// 运行：npx.cmd --yes --package typescript@5.4.5 -c "node scripts/audit-entertainment-execution.cjs"
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHarness } = require('../tests/helpers/cocos-math-harness.cjs');
const root = path.resolve(__dirname, '..');
const tsPath = process.env.TYPESCRIPT_PATH || process.env.PATH.split(path.delimiter)
    .map(p => path.resolve(p, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p));
const ts = require(tsPath);
const h = createHarness({ './TurtleBusPresentation': { TurtleBusVisual: class {
    constructor() { this.node = { position: { x: 0, y: 0, z: 0 } }; }
    update() {} reset() {} hide() {} dispose() {} ringWorld(_ring, out) { out.set(0, 0, 0); }
} } });
const load = file => h.load(path.join(root, 'assets/scripts', file));
const { buildEntertainmentRacePlan } = load('core/EntertainmentRacePlan.ts');
const { EntertainmentModeDirector, EntertainmentEventId: E, entertainmentEventName } = load('core/EntertainmentModeDirector.ts');
const { TurtleBusController } = load('core/TurtleBusController.ts');
const turtle = load('core/TurtleBusRules.ts');
const { TURTLE_BUS_LAYOUT } = load('core/TurtleBusLayout.ts');
const recovery = load('core/EntertainmentRecoveryController.ts');
const geyser = load('core/GeyserBrawlRules.ts');
const { LitterBrawlController, LITTER_BRAWL_TUNING, ENTERTAINMENT_LITTER_MIN_WAVE_INTERVAL_SECONDS } = load('core/LitterBrawlController.ts');
const { GameState } = load('core/GameConstants.ts');

function extractClass(file, className, names, context = {}) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, 'assets/scripts', file), 'utf8'),
        ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className);
    const members = names.map(name => {
        const member = cls.members.find(n => n.name?.getText(source) === name);
        assert.ok(member, `${className}.${name}`);
        return member.getText(source);
    }).join('\n');
    return vm.runInNewContext(ts.transpileModule(`class Subject { ${members} }; Subject`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
}

// 保守下界：主段恰好按计划时长完成，无航次延长、受击或停游。
// 输入是合成领先进度，不是完整马达重演；失败能证明预算不足，通过不能证明实机通过。
function replay(seed, distance, grade, speed, fps = 30) {
    const plan = buildEntertainmentRacePlan(seed, distance, grade);
    const director = new EntertainmentModeDirector(seed, distance, true, undefined, undefined, undefined, plan);
    const activated = new Set(), completed = new Set(), timeline = [];
    const finish = distance / speed;
    for (let frame = 1; frame / fps < finish; frame++) {
        const seconds = frame / fps;
        const beforeIndex = director.snapshot().eventIndex;
        const transition = director.update(1 / fps, seconds * speed, true, speed);
        for (const [key, label] of [['previewEvent', '预告'], ['activatedEvent', '激活'], ['finishedEvent', '结束']]) {
            if (transition[key] === null) continue;
            const index = key === 'finishedEvent' ? beforeIndex : director.snapshot().eventIndex;
            timeline.push({ phase: label, event: entertainmentEventName(transition[key]), index,
                seconds: +seconds.toFixed(2), distance: +(seconds * speed).toFixed(2) });
            if (key === 'activatedEvent') activated.add(index);
            if (key === 'finishedEvent') completed.add(index);
        }
    }
    const cancelledPreview = director.lockAfterFirstFinish().cancelledPreview;
    const required = plan.stages.map((stage, i) => stage.required ? i : -1).filter(i => i >= 0);
    return { seed, distance, grade, speed, fps, skippedMask: director.skippedStageMask(), finishSeconds: +finish.toFixed(2),
        order: plan.stages.map(stage => entertainmentEventName(stage.event)),
        missingRequired: required.filter(i => !activated.has(i)),
        incompleteRequired: required.filter(i => !completed.has(i)),
        missingMain: plan.stages.map((_, i) => i).filter(i => !activated.has(i)),
        cancelledPreview, timeline };
}

const schedules = [];
let example = replay(6, 200, 5, 2.5);
for (const distance of [200, 400]) for (const grade of [3, 5]) for (const speed of [2, 2.5, 3, 3.4]) {
    const runs = Array.from({ length: 200 }, (_, i) => replay(i + 1, distance, grade, speed));
    schedules.push({ distance, grade, speed, seeds: runs.length,
        missingRequired: runs.filter(r => r.missingRequired.length).length,
        incompleteRequired: runs.filter(r => r.incompleteRequired.length).length,
        missingMain: runs.filter(r => r.missingMain.length).length });
}

function racer() {
    return { node: { active: true, layer: 1, position: { x: 0, y: 0, z: 0 } }, startPosition: { z: 0 },
        raceDirection: 1, currentSpeed: 2.5, isCollisionActive: true, isEntertainmentInvulnerable: false,
        get distance() { return this.motor.distance; },
        motor: { distance: 10, isRacing: true, ability: { depth: 0 }, armStrokeSequence: 0, tow: null,
            beginTurtleGrip() {}, clearTurtleTow() { this.tow = null; },
            captureTurtleGrip(distance, lateral) { this.distance = distance; this.lateralOffset = lateral; },
            setTurtleTowTarget(speed, distance, lateral) { this.tow = { speed, distance, lateral }; } } };
}

function turtleAfterIneligible(authoritative, state) {
    const swimmer = racer();
    const course = { courseLength: 50, direction: 1, startX: 0, finishX: 50, poolWidth: 21, waterY: 0 };
    const bus = new TurtleBusController({}, course, swimmer, [], 1);
    const age = 5, startOffset = 7;
    swimmer.motor.distance = turtle.turtleBusPositionAt(age, startOffset)
        + turtle.TURTLE_BUS_RING_FORWARD_OFFSETS[0] - TURTLE_BUS_LAYOUT.passengerRootBack;
    swimmer.node.position.z = turtle.turtleBusRingWorldLateral(0, 1, 0);
    bus.setAuthority(false);
    bus.applyNetSnapshot({ tripId: 1, phase: turtle.turtleBusPhaseAt(age, startOffset), age,
        direction: 1, routeZ: 0, startOffset, occupants: [0, -1, -1, -1], hands: [3, 0, 0, 0],
        gripProtectedUntil: [0, 0, 0, 0] });
    bus.updateReplica(0);
    assert.equal(bus.seats.hands[0], 3);
    assert.ok(swimmer.motor.tow);
    if (authoritative) bus.setAuthority(true);
    swimmer.isCollisionActive = false;
    swimmer.isEntertainmentInvulnerable = state === '重生保护';
    swimmer.motor.isRacing = state !== '击倒';
    swimmer.motor.clearTurtleTow();
    if (authoritative) bus.update(1 / 60, true);
    else bus.updateReplica(1 / 60);
    const result = { authority: authoritative ? '房主' : '访客', state,
        hands: bus.seats.hands[0], towReapplied: swimmer.motor.tow !== null };
    bus.dispose();
    return result;
}
const turtleResults = ['击倒', '重生保护', '腾空或翻身'].flatMap(state =>
    [turtleAfterIneligible(true, state), turtleAfterIneligible(false, state)]);

let gateDistance = 200;
const Gate = extractClass('core/GameManager.ts', 'GameManager', ['canSpawnGradedObstacleWave',
    'canContinueGradedObstacleSpawns', 'gradedEntertainmentStage'], {
    EntertainmentDirectorPhase: load('core/EntertainmentModeDirector.ts').EntertainmentDirectorPhase,
    EntertainmentEventId: E, getRaceDistance: () => gateDistance,
});
function auditObstacleWaves(seed, distance, grade, speed, gated) {
    const plan = buildEntertainmentRacePlan(seed, distance, grade, 'debris');
    const director = new EntertainmentModeDirector(seed, distance, true, undefined, undefined, undefined, plan);
    const manager = new Gate();
    gateDistance = distance;
    let seconds = 0;
    Object.assign(manager, { _entertainmentRacePlan: plan, _entertainmentDirector: director,
        entertainmentReferenceSpeed: () => speed, entertainmentLeaderDistance: () => seconds * speed,
        _raceManager: { get elapsedSeconds() { return seconds; }, hasAnyFinisher: () => false } });
    const racer = { active: true, finished: false, distance: 0, lateral: -8 };
    const waves = [];
    const litter = new LitterBrawlController(1, seed, 21, () => racer,
        wave => waves.push({ wave, seconds: +seconds.toFixed(2), distance: +racer.distance.toFixed(2),
            phase: director.phaseId(), event: director.currentEvent(), remaining: director.secondsRemaining() }),
        undefined, { waveDistances: plan.obstacle.litterWaveDistances, waveCounts: plan.obstacle.litterWaveCounts,
            landingLeadDistance: LITTER_BRAWL_TUNING.landingLeadDistance }, undefined, undefined,
        { itemsPerWave: Math.max(...plan.obstacle.litterWaveCounts), poolSize: plan.obstacle.litterPoolSize },
        undefined, undefined, ENTERTAINMENT_LITTER_MIN_WAVE_INTERVAL_SECONDS, 0,
        gated ? () => manager.canSpawnGradedObstacleWave(true) : () => seconds >= 10,
        Infinity, true);
    for (let frame = 1; frame / 30 < distance / speed; frame++) {
        seconds = frame / 30;
        racer.distance = seconds * speed;
        // 真实 GameManager 顺序：先推进导演，后进行障碍投放。
        if (gated && !manager.canContinueGradedObstacleSpawns()) litter.cancelPendingWaves();
        director.update(1 / 30, racer.distance, true, speed);
        litter.update(1 / 30, GameState.RACING);
    }
    const pendingAtFinish = litter.pendingWaveCount();
    litter.cancelPendingWaves();
    return { seed, distance, grade, speed, gated, planned: plan.obstacle.litterWaveDistances.length,
        actual: waves.length, pendingAtFinish, cancelled: litter.cancelledCount(), waves };
}
const obstacleResults = [200, 400].flatMap(distance => [3, 5].flatMap(grade =>
    [true, false].map(gated => auditObstacleWaves(6, distance, grade, 2.5, gated))));

const Subject = extractClass('entity/Swimmer.ts', 'Swimmer', ['geyserHitEligible', 'applyGeyserHit',
    'clearForcedLaunch', 'snapshotGeyserLane', 'restoreGeyserLane', 'isCollisionActive', 'isSharkTargetable'], {
    getRaceDistance: () => 200, StrokeType: { LEFT: 0, RIGHT: 1 },
});
function swimmerFixture() {
    const s = new Subject();
    Object.assign(s, { distance: 20, node: { active: true, position: { x: 20, y: 0, z: 0 } },
        _entertainmentKnocked: false, _entertainmentInvulnerable: false,
        _geyserHits: new geyser.GeyserHitLedger(), geyserTuning: geyser.GEYSER_TUNING,
        _forcedLaunch: null, _forcedLaunchGrace: 0, _forcedLaunchEdge: 0, _phases: {},
        _courseLayout: { swimY: 0, distanceToCurrentCourseEnd: () => 30 }, clearGiantWave() {},
        _motor: { isRacing: true, lateralOffset: 0, currentSpeed: 3, heading: 0, ability: { depth: 0 },
            starts: 0, setForcedLaunchPosition(_d, _l, speed) { this.currentSpeed = speed; },
            applyCollisionPitchImpulse() {}, beginForcedLaunch() { this.starts++; } } });
    s.node.setPosition = (x, y, z) => Object.assign(s.node.position, { x, y, z });
    return s;
}
const safeguards = [];
for (const flag of ['_entertainmentKnocked', '_entertainmentInvulnerable']) {
    const s = swimmerFixture(); s[flag] = true;
    assert.equal(s.applyGeyserHit(1001, 2), false);
    assert.equal(s.applyGeyserHit(1001, 2, 0, undefined, true), false);
    assert.equal(s.isCollisionActive, false);
    assert.equal(s.isSharkTargetable, false);
    safeguards.push(`${flag} 拒绝普通及权威喷泉命中、人物碰撞和鲨鱼目标`);
}
{
    const s = swimmerFixture();
    assert.equal(s.applyGeyserHit(1001, 1), true);
    assert.equal(s.applyGeyserHit(1001, 2), true);
    assert.equal(s.applyGeyserHit(1001, 2), false);
    assert.equal(s.isCollisionActive, false);
    assert.equal(s.isSharkTargetable, false);
    const snap = s.snapshotGeyserLane(1, 0);
    s.clearForcedLaunch();
    s.restoreGeyserLane(1, snap, 0.1);
    assert.equal(s._forcedLaunch, null);
    safeguards.push('擦边可升级核心；同一核心不重复；落水后的旧快照不重新弹起');
}
{
    const calls = [];
    const c = new recovery.EntertainmentRecoveryController(1, {
        onKnocked: () => calls.push('击倒'), onRespawn: () => calls.push('重生'), onRecovered: () => calls.push('恢复'),
    });
    assert.ok(c.tryKnockDown(0, recovery.EntertainmentRecoveryReason.CANNON, 20));
    assert.equal(c.tryKnockDown(0, recovery.EntertainmentRecoveryReason.MINEFIELD, 20), null);
    c.update(3.5);
    assert.equal(c.tryKnockDown(0, recovery.EntertainmentRecoveryReason.SHARK, 20), null);
    c.update(2);
    assert.equal(c.isDamageable(0), true);
    assert.deepEqual(calls, ['击倒', '重生', '恢复']);
    safeguards.push('跨事件重复击倒被拒绝；3.5 秒重生后保留 2 秒保护');
}

process.stdout.write(JSON.stringify({ assumptions: '固定领先进度、所有主段按计划准时完成；只验证调度时间下界，非实机发生率',
    schedules, example, exampleFrameRates: example ? [30, 60, 120].map(fps =>
        replay(example.seed, example.distance, example.grade, example.speed, fps)) : [],
    turtleResults, obstacleResults, safeguards }, null, 2) + '\n');
