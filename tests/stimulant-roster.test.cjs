const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const tsPath = process.env.TYPESCRIPT_PATH || process.env.PATH.split(path.delimiter)
    .map(p => path.resolve(p, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p));
const ts = require(tsPath);
const cache = new Map();
const stubs = {
    cc: { Color: class {}, Vec3: class {} },
    './EntertainmentPropOutline': { EntertainmentPropOutline: class { dispose() {} } },
    './RaceBundleLoader': {}, './ResourcePaths': {}, './WaterFloatMotion': {}, './EntertainmentWaterSplash': {},
};
function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    } }).outputText;
    const requireLocal = id => stubs[id] ?? load(path.resolve(path.dirname(file), id + '.ts'));
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(requireLocal, module, module.exports);
    return module.exports;
}
const { StimulantBrawlController: Controller } = load(path.join(root, 'assets/scripts/core/StimulantBrawlController.ts'));
// 只省略资源与渲染初始化；选手缓存、世界拾取和收益结算执行正式代码。
for (const method of ['createProgramVisuals', 'createBeaconVisuals', 'loadModelVisuals']) Controller.prototype[method] = () => {};
const poolX = distance => {
    const leg = Math.floor(distance / 50), offset = distance % 50;
    return leg % 2 ? 50 - offset : offset;
};
function racer(distance, z = 0) {
    const swimmer = { distance, movementHeading: 0, raceDirection: 1, heartRate: 170,
        node: { active: true, worldPosition: { x: poolX(distance), y: -1, z } },
        motor: { ability: { infiniteStamina: false },
            applyHeartbeatSoda() { swimmer.heartRate += 40; },
            applyCalmSlush(drop) { swimmer.heartRate -= drop; } },
        triggerStimulantReaction() {}, triggerCalmSlushReaction() {}, clearStimulantReaction() {} };
    const condition = { energyRatio: .3, syncHeartRate() {}, restoreEnergyRatio(ratio) {
        condition.energyRatio += ratio; return ratio;
    } };
    return { swimmer, condition };
}
function fixture(kind = 'heartbeat-soda', distance = 135) {
    const available = [racer(distance, 8), null], messages = [], feedback = [];
    const course = { courseLength: 50, waterY: 0, swimPosition: (d, z) => ({ x: poolX(d), z }),
        distanceToWorldX: poolX, directionAtDistance: d => Math.floor(d / 50) % 2 ? -1 : 1 };
    const controller = new Controller({}, 7, { laneCount: 2, centerZ: () => 0 }, course,
        lane => available[lane], p => messages.push(p), p => feedback.push(p), () => {}, () => 0, null,
        [{ id: 0, wave: 4, distance, laneIndex: 1, lateralOffset: 0, kind }]);
    Object.assign(controller.items[0], { visualSpawnStarted: true, visualLanded: true });
    return { controller, available, messages, feedback };
}
test('道具先初始化、AI后创建：落后一整圈的AI经过旧苏打仍应拾取并获得收益', () => {
    const f = fixture();
    f.controller.update();
    f.available[1] = racer(35);
    f.controller.refreshRacers?.();
    f.controller.update();
    assert.equal(f.messages.length, 1, '后来创建的AI必须进入公共拾取名单');
    assert.equal(f.messages[0].collectorLane, 1);
    assert.equal(f.controller.items[0].collected, true);
    assert.equal(f.available[1].swimmer.heartRate, 210);
    assert.equal(f.available[1].condition.energyRatio, .6);
    f.controller.update();
    assert.equal(f.feedback.length, 1, '再次经过不能重复发放收益');
});
test('补齐名单也适用于冰沙、反向经过和潜水，不受心率策略或趟数限制', () => {
    const f = fixture('calm-slush');
    f.available[1] = racer(65);
    f.available[1].swimmer.raceDirection = -1;
    f.controller.refreshRacers?.();
    f.controller.update();
    assert.equal(f.messages.length, 1);
    assert.equal(f.available[1].swimmer.heartRate, 110);
    assert.equal(f.available[1].condition.energyRatio, .3);
});
test('选手替换后清除旧扫掠位置，网络校正不能沿旧身体轨迹补捡', () => {
    const f = fixture();
    f.available[1] = racer(32.5);
    f.controller.refreshRacers?.(); f.controller.update();
    f.available[1] = racer(37.5);
    f.controller.refreshRacers?.(); f.controller.update();
    assert.equal(f.messages.length, 0);
    f.available[1].swimmer.node.worldPosition.x = 35;
    f.controller.update();
    assert.equal(f.messages.length, 1);
});
test('刷新相同阵容保留短路径扫掠，不能每次刷新都漏掉跨帧经过', () => {
    const f = fixture();
    f.available[1] = racer(33.5);
    f.available[1].swimmer.movementHeading = Math.PI / 2;
    f.controller.refreshRacers(); f.controller.update();
    assert.equal(f.messages.length, 0);
    f.available[1].swimmer.node.worldPosition.x = 36.5;
    f.controller.refreshRacers(); f.controller.update();
    assert.equal(f.messages.length, 1);
});

const gmFile = path.join(root, 'assets/scripts/core/GameManager.ts');
const gmSource = ts.createSourceFile(gmFile, fs.readFileSync(gmFile, 'utf8'), ts.ScriptTarget.Latest, true);
const gmClass = gmSource.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'GameManager');
const buildAi = gmClass.members.find(n => n.name?.getText(gmSource) === 'buildDeferredAiSwimmers').getText(gmSource);
const Manager = vm.runInNewContext(ts.transpileModule(`class Manager { ${buildAi} }; Manager`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText, { RACE_OPPONENTS_ENABLED: true, AIRaceObserver: class {},
    AiConditionModel: class { constructor() { return racer(0).condition; } } });
for (const networked of [false, true]) test(`真实AI创建流程补齐${networked ? '联机远端真人与AI' : '单机AI'}，保留已落水道具`, () => {
    const f = fixture();
    const manager = new Manager(), ai = racer(35).swimmer;
    Object.assign(ai, { enableFreestylePresentation() {}, reset() {} });
    const controller = { bindCondition() {} };
    Object.assign(manager, {
        _aiDebugMode: false, _netSession: networked ? {} : null, _launchMode: 'race',
        _swimmersRoot: { isValid: true }, _playerSwimmer: f.available[0].swimmer,
        _aiControllers: [], _aiSwimmers: [], _aiConditions: [], _stimulantBrawl: f.controller,
        createCompetitorManager: () => ({ buildAi: () => ({ primaryAiController: controller,
            aiControllers: [controller], aiSwimmers: [ai] }) }),
        bindDolphinEnergyCost() {}, refreshPreRaceIntroRoster() {}, refreshSwimmerNameRoster() {},
        applySplashParticlesEnabled() {}, applyBodyFeedbackEnabled() {}, refreshAiDifficultyPanel() {}, debug() {},
        wireRemoteSwimmers() { f.available[1] = { swimmer: this._aiSwimmers[0], condition: this._aiConditions[0] }; },
    });
    manager.buildDeferredAiSwimmers();
    f.controller.update();
    assert.equal(f.messages.length, 1, 'GameManager 必须在阵容就位后补齐控制器名单');
    assert.equal(f.messages[0].collectorLane, 1);
    // 访客沿既有可靠事件结算；不自行调用权威拾取扫描。
    const guest = fixture(); guest.available[1] = racer(35); guest.controller.refreshRacers();
    guest.controller.applyPickup(f.messages[0]);
    assert.equal(guest.messages.length, 0);
    assert.equal(guest.available[1].condition.energyRatio, .6);
    assert.equal(guest.controller.snapshotState().collectorLanes[0], 1);
    assert.equal(guest.controller.applyPickup(f.messages[0]), false);
});
