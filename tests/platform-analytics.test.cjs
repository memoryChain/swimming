// 执行统一业务层与平台工厂，不需要平台 SDK 或启动编辑器。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const root = path.resolve(__dirname, '..');
function load(name, imports = {}, extra = {}) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/platform', name + '.ts'), 'utf8'),
        { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, { exports, require(id) { assert.ok(id in imports, '未注入模块：' + id); return imports[id]; }, console, ...extra });
    return exports;
}
const trackerLogic = load('RaceAnalyticsTracker');
const config = load('AnalyticsConfig');
const { GameAnalytics } = load('GameAnalytics', { './RaceAnalyticsTracker': trackerLogic, './AnalyticsConfig': config });
const { DisabledAnalytics } = load('DisabledAnalytics');
const start = { mode: 'wild-400', distance: 400, character_id: 'cartonSwimmer16', play_type: 'local', test_type: 'normal' };

test('业务事件和去重与平台无关，未来平台只实现统一接口即可接收完整字段', () => {
    for (const name of ['douyin', 'wechat', 'default']) {
        const events = [], adapter = { platform: name, enabled: true,
            getLaunchContext: () => ({ startedAt: 100, source: 'other' }),
            report: (event, fields) => events.push({ event, fields }) };
        const analytics = new GameAnalytics(adapter, config.PLATFORM_ANALYTICS_CONFIG, () => 350);
        analytics.reportLobbyReady(); analytics.reportLobbyReady();
        const race = analytics.createRaceTracker(); race.start(start); race.start(start);
        race.endLocalFinish(100.125, 2, 400); race.end('quit', 0, 0, 0); race.again();
        assert.deepEqual(events.map(row => row.event), ['lobby_ready', 'race_start', 'race_end', 'race_again']);
        assert.equal(events[0].fields.load_ms, 250); assert.equal(events[2].fields.time_ms, 100125);
        for (const row of events) for (const key of Object.keys(config.PLATFORM_ANALYTICS_CONFIG)) {
            assert.equal(row.fields[key], config.PLATFORM_ANALYTICS_CONFIG[key]);
        }
        race.reset(); race.start({ ...start, distance: 200 }); race.end('dnf', 20, 8, 100);
        assert.equal(events.at(-1).fields.progress_percent, 50);
    }
});

test('未接入平台显式关闭，没有事件缓存、计时器、来源查询或比赛记录器', () => {
    for (const platform of ['wechat', 'default']) {
        const adapter = new DisabledAnalytics(platform);
        assert.equal(adapter.enabled, false); assert.equal(adapter.platform, platform);
        adapter.report = () => assert.fail('不应调用平台上报');
        adapter.getLaunchContext = () => assert.fail('不应读取来源');
        const analytics = new GameAnalytics(adapter, config.PLATFORM_ANALYTICS_CONFIG, () => assert.fail('不应读取时间'));
        for (let i = 0; i < 100; i++) { analytics.reportLobbyReady(); assert.equal(analytics.createRaceTracker(), null); }
    }
});

test('平台选择集中在工厂；微信和网页不会创建抖音实现，实例跨场景复用', () => {
    for (const [env, expected] of [[{ WECHAT: true, BYTEDANCE: false }, 'wechat'],
        [{ WECHAT: false, BYTEDANCE: false }, 'default'], [{ WECHAT: false, BYTEDANCE: true }, 'douyin']]) {
        let constructions = 0;
        class Douyin { platform = 'douyin'; constructor() { constructions++; } }
        class Game { constructor(adapter) { this.adapter = adapter; } }
        const runtime = load('PlatformAnalytics', { 'cc/env': env, './DouyinAnalytics': { DouyinAnalytics: Douyin },
            './DisabledAnalytics': { DisabledAnalytics }, './GameAnalytics': { GameAnalytics: Game } });
        const analytics = runtime.gameAnalytics(); assert.equal(runtime.gameAnalytics(), analytics);
        assert.equal(analytics.adapter.platform, expected); assert.equal(constructions, expected === 'douyin' ? 1 : 0);
    }
});

test('任何平台实现上报异常都不能影响比赛；只提醒一次，不阻止后续事件', () => {
    let calls = 0, warnings = 0;
    const { GameAnalytics: SafeAnalytics } = load('GameAnalytics', {
        './RaceAnalyticsTracker': trackerLogic, './AnalyticsConfig': config,
    }, { console: { warn() { warnings++; } } });
    const analytics = new SafeAnalytics({ platform: 'wechat', enabled: true,
        getLaunchContext: () => ({ startedAt: 0, source: 'other' }), report() { calls++; throw new Error('上报失败'); } });
    assert.doesNotThrow(() => analytics.reportLobbyReady());
    const race = analytics.createRaceTracker();
    assert.doesNotThrow(() => { race.start(start); race.endLocalFinish(10, 1, 400); race.again(); });
    assert.equal(calls, 4); assert.equal(warnings, 1);
});

test('统一事件字典约束公共层实际字段及整数数值', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'config/analytics-events.json'), 'utf8'));
    const events = [], analytics = new GameAnalytics({ platform: 'default', enabled: true,
        getLaunchContext: () => ({ startedAt: 100, source: 'other' }), report: (event, fields) => events.push({ event, fields }) },
        config.PLATFORM_ANALYTICS_CONFIG, () => 250);
    analytics.reportLobbyReady(); const race = analytics.createRaceTracker();
    race.start(start); race.endLocalFinish(101.1234, 2, 400); race.again();
    for (const { event, fields } of events) {
        const expected = { ...schema.commonFields, ...schema.events.find(row => row.name === event).fields };
        assert.deepEqual(Object.keys(fields).sort(), Object.keys(expected).sort());
        for (const [key, type] of Object.entries(expected)) {
            assert.equal(typeof fields[key], type);
            if (type === 'number') assert.ok(Number.isInteger(fields[key]));
        }
    }
});
