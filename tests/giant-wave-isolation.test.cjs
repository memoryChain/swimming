const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 执行入口方法本身；只替换场景、控制器构造和外部配置。
function fixture() {
    const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/core/GameManager.ts'), 'utf8');
    const body = source.match(/private updateGiantWave\(dt: number\): void \{([\s\S]*?)\n    \}/)?.[1];
    assert.ok(body);
    const calls = { built: 0, disposed: 0, updated: 0, cleared: 0 };
    const setup = { seed: 17, giantWavePreset: 'single', entertainmentIntensity: 5 };
    let options;
    const config = { id: 'giant-wave-brawl' };
    const context = {
        getRaceDifficultyConfig: () => config,
        getAiDebugSetup: () => setup,
        getRaceDistance: () => 400,
        COURSE_LAYOUT: {}, GameState: { RACING: 'racing' },
        GiantWaveController: class {
            constructor(...args) { calls.built++; options = args.slice(-2); }
            update() { calls.updated++; }
            dispose() { calls.disposed++; }
        },
    };
    const update = vm.runInNewContext(`(function(dt) {${body}\n})`, context);
    const manager = {
        _aiDebugMode: true, _netSession: null, _modelDebugFlow: { active: false },
        _worldRoot: { isValid: true }, _raceHud: { isValid: true }, _playerSwimmer: {},
        _aiSwimmers: Array.from({ length: 7 }, () => ({})), _aiControllers: [],
        _state: 'racing', _giantWave: null,
        activePlayerAutopilot: () => ({ setGiantWaveTargetZ() { calls.cleared++; } }),
    };
    return { config, calls, manager, setup, context, options: () => options, tick: () => update.call(manager, 1 / 60) };
}

test('综合巨浪由导演活动状态门控，正式单机和联机均推进，结束只清理一次', () => {
    for (const net of [null, { localPos: 2 }]) {
        const f = fixture();
        let active = true;
        f.context.EntertainmentEventId = { GIANT_WAVE: 9 };
        f.context.isEntertainmentEventBurstActive = event => active && event === 9;
        f.manager._aiDebugMode = false;
        f.manager._netSession = net;
        f.manager._entertainmentDirector = {};
        f.manager._giantWave = { update() { f.calls.updated++; }, dispose() { f.calls.disposed++; } };
        for (let i = 0; i < 60; i++) f.tick();
        assert.equal(f.calls.updated, 60);
        active = false;
        for (let i = 0; i < 60; i++) f.tick();
        assert.equal(f.calls.disposed, 1);
        assert.equal(f.manager._giantWave, null);
    }
});

test('真实装配传入计划档位、导演序号种子和恢复年龄，不读取单项波数预设', () => {
    const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/core/GameManager.ts'), 'utf8');
    const body = source.match(/private createEntertainmentGiantWave\(playEntrance: boolean\): void \{([\s\S]*?)\n    \}/)?.[1];
    assert.ok(body);
    let args, sync;
    const context = {
        EntertainmentEventId: { GIANT_WAVE: 9 }, isEntertainmentEventBurstActive: () => true,
        COURSE_LAYOUT: {}, getRaceDistance: () => 400, getSharedRandomSeed: () => 712,
        ENTERTAINMENT_GIANT_WAVE_SECONDS: 20,
        GiantWaveController: class { constructor(...values) { args = values; } syncEventAge(...values) { sync = values; } },
    };
    const create = vm.runInNewContext(`(function(playEntrance) {${body}\n})`, context);
    const manager = { _worldRoot: { isValid: true }, _raceHud: { isValid: true }, _playerSwimmer: {},
        _aiSwimmers: Array(7).fill({}), _aiControllers: Array(7).fill({ remoteDriven: false }),
        _entertainmentDirector: { snapshot: () => ({ activationSerial: 4 }), secondsRemaining: () => 12.5 },
        _netSession: {}, _netRaceController: { isHost: false },
        gradedEntertainmentStage: () => ({ intensity: 2 }),
    };
    create.call(manager, false);
    assert.equal(args[5], (712 ^ Math.imul(4, 0x57415645)) >>> 0);
    assert.equal(args[6], 'single');
    assert.equal(args[9], 2);
    assert.equal(args[10], 400);
    assert.equal(args[11], true);
    assert.deepEqual(Array.from(sync), [7.5, false]);
    assert.equal(args[12](0), true);
    assert.equal(args[12](1), false);
    manager._netRaceController.isHost = true;
    assert.equal(args[12](1), true);
});

test('联机会话、普通模式和模型调试均不创建巨浪资源或推进巨浪', () => {
    for (const reason of ['network', 'normal', 'other-mode', 'model-debug']) {
        const f = fixture();
        if (reason === 'network') f.manager._netSession = { isHost: true };
        if (reason === 'normal') f.manager._aiDebugMode = false;
        if (reason === 'other-mode') f.config.id = 'entertainment-brawl';
        if (reason === 'model-debug') f.manager._modelDebugFlow.active = true;
        for (let i = 0; i < 600; i++) f.tick();
        assert.deepEqual(f.calls, { built: 0, disposed: 0, updated: 0, cleared: 0 }, reason);
    }
});

test('本地测试创建一次；进入联机会话即释放，后续帧不重复销毁', () => {
    const f = fixture();
    for (let i = 0; i < 600; i++) f.tick();
    assert.equal(f.calls.built, 1); assert.equal(f.calls.updated, 600);
    assert.deepEqual(Array.from(f.options()), [5, 400]);
    f.manager._netSession = { isHost: false };
    for (let i = 0; i < 600; i++) f.tick();
    assert.equal(f.manager._giantWave, null);
    assert.deepEqual(f.calls, { built: 1, disposed: 1, updated: 600, cleared: 1 });
});

test('巨浪与海龟不创建旧统计条，喷泉保留大小口统计入口', () => {
    const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/core/GameManager.ts'), 'utf8');
    const body = source.match(/private buildEntertainmentIntensityDebugHud\([^)]*\): void \{([\s\S]*?)\n    \}/)?.[1];
    let mode = 'giant-wave-brawl', builds = 0;
    const build = vm.runInNewContext(`(function(raceHud, width, height) {${body}\n})`, {
        getAiDebugSetup: () => ({ entertainmentIntensity: 5 }),
        getRaceDifficultyConfig: () => ({ id: mode }),
    });
    const manager = { _aiDebugMode: true, _netSession: null, _intensityDebugHud: { build() { builds++; } } };
    for (mode of ['giant-wave-brawl', 'turtle-bus-brawl']) build.call(manager, {}, 1280, 720);
    assert.equal(builds, 0);
    // 喷泉已接入大小口和候选避让统计，不再属于无数据入口。
    mode = 'geyser-brawl'; build.call(manager, {}, 1280, 720);
    assert.equal(builds, 1);
    mode = 'shark-brawl'; build.call(manager, {}, 1280, 720);
    assert.equal(builds, 2);
});
