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
    const config = { id: 'giant-wave-brawl' };
    const context = {
        getRaceDifficultyConfig: () => config,
        getAiDebugSetup: () => ({ seed: 17, giantWavePreset: 'single' }),
        COURSE_LAYOUT: {}, GameState: { RACING: 'racing' },
        GiantWaveController: class {
            constructor() { calls.built++; }
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
    return { config, calls, manager, tick: () => update.call(manager, 1 / 60) };
}

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
    f.manager._netSession = { isHost: false };
    for (let i = 0; i < 600; i++) f.tick();
    assert.equal(f.manager._giantWave, null);
    assert.deepEqual(f.calls, { built: 1, disposed: 1, updated: 600, cleared: 1 });
});
