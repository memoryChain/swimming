'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const sidebar = { scene: '021036', launch_from: 'homepage', location: 'sidebar_card', showFrom: 10 };

// 启动与构建测试从分支的平台综合测试中拆出，不依赖尚未整合的游戏和侧边栏界面。
test('真实启动脚本在引擎前注册监听，捕获早期回调、隔离监听者与敏感 query', () => {
    let show, subscribed = 0;
    const context = vm.createContext({ Date, console, GameGlobal: {}, tt: {
        onShow(callback) { subscribed++; show = callback; callback(sidebar); },
        getLaunchOptionsSync() { throw new Error('有 onShow 时不应覆盖最新来源'); }
    } });
    const code = fs.readFileSync(path.join(root, 'extensions/douyin-platform-tools/launch-bootstrap.js'), 'utf8');
    vm.runInContext(code, context); vm.runInContext(code, context);
    const bridge = context.GameGlobal.__swimmingDouyinLaunch;
    assert.equal(subscribed, 1); assert.equal(bridge.sequence, 1);
    assert.equal(bridge.latest.location, 'sidebar_card');
    bridge.subscribe(() => { throw new Error('旧界面'); });
    let calls = 0; const off = bridge.subscribe(() => calls++);
    show({ query: { token: '不能保存' }, showFrom: 0 }); off(); show(sidebar);
    assert.equal(calls, 1); assert.equal('query' in bridge.latest, false);
});

test('构建监听注入幂等，game.js 第一条语句先于 loadCC，源引擎内容保留', () => {
    const { installLaunchBootstrap } = require('../extensions/douyin-platform-tools/hooks');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-launch-test-'));
    try {
        fs.writeFileSync(path.join(dir, 'game.js'), 'loadCC();\n');
        installLaunchBootstrap(dir); installLaunchBootstrap(dir);
        const code = fs.readFileSync(path.join(dir, 'game.js'), 'utf8');
        assert.equal(code, "require('./douyin-launch-bootstrap.js');\nloadCC();\n");
        assert(fs.existsSync(path.join(dir, 'douyin-launch-bootstrap.js')));
    } finally {
        assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
        assert(path.basename(dir).startsWith('douyin-launch-test-'));
        fs.rmSync(dir, { recursive: true });
    }
});

test('构建插件只注册抖音目标，微信和网页不读取或修改构建目录', async () => {
    const { configs } = require('../extensions/douyin-platform-tools/builder');
    const { onAfterBuild } = require('../extensions/douyin-platform-tools/hooks');
    assert.deepEqual(Object.keys(configs), ['bytedance-mini-game']);
    for (const platform of ['wechatgame', 'web-mobile', 'web-desktop', 'taptap-mini-game']) {
        const result = { get dest() { throw new Error('非抖音目标不应访问输出目录'); } };
        await onAfterBuild({ platform }, result);
    }
});

test('缺少抖音宿主时不建立桥接，冷启动兜底仅保留来源字段', () => {
    const code = fs.readFileSync(path.join(root, 'extensions/douyin-platform-tools/launch-bootstrap.js'), 'utf8');
    const absent = vm.createContext({ Date, GameGlobal: {} });
    vm.runInContext(code, absent);
    assert.equal(absent.GameGlobal.__swimmingDouyinLaunch, undefined);
    let registrations = 0, reads = 0;
    const context = vm.createContext({ Date, GameGlobal: {}, tt: {
        onShow() { registrations++; },
        getLaunchOptionsSync() { reads++; return { ...sidebar, query: { token: '不能保存' } }; },
    } });
    vm.runInContext(code, context);
    vm.runInContext(code, context);
    const bridge = context.GameGlobal.__swimmingDouyinLaunch;
    assert.equal(registrations, 1);
    assert.equal(reads, 1);
    assert.equal(bridge.sequence, 0);
    assert.equal(bridge.latest.location, 'sidebar_card');
    assert.equal('query' in bridge.latest, false);
    assert.equal(bridge, context.__swimmingDouyinLaunch);
});
