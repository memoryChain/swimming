const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertTapRenderConfig } = require('../extensions/wechat-race-subpackage/taptap-render-policy');
const root = path.resolve(__dirname, '..');
// Creator 重新保存配置会生成新 UUID，测试按名称定位，不固定用户配置 ID。
const configs = JSON.parse(fs.readFileSync(path.join(root, 'settings/v2/packages/engine.json'), 'utf8')).modules.configs;
const TAP_RENDER_CONFIG_KEY = Object.keys(configs).find(key => configs[key].name === 'taptap');
const options = { engineModulesConfigKey: 'custom-config-62586aa7-3e38-4b8b-b2c1-42185257bb02',
    packages: { 'taptap-minigame-tools': { enableTapConvert: true } },
    overwriteProjectSettings: { includeModules: { 'gfx-webgl2': 'off' } } };

test('复现只选 WebGL2 又强制关闭的配置冲突，构建前拒绝；taptap 配置保留 WebGL1', () => {
    assert.throws(() => assertTapRenderConfig(root, options), /后端全部被关闭/);
    assert.doesNotThrow(() => assertTapRenderConfig(root, { ...options, engineModulesConfigKey: TAP_RENDER_CONFIG_KEY }));
    assert.throws(() => assertTapRenderConfig(root, { ...options, engineModulesConfigKey: TAP_RENDER_CONFIG_KEY,
        overwriteProjectSettings: { includeModules: { 'gfx-webgl': 'off', 'gfx-webgl2': 'off' } } }), /后端全部/);
    assert.doesNotThrow(() => assertTapRenderConfig(root, { ...options, packages: {} }));
    assert.doesNotThrow(() => assertTapRenderConfig(root, { ...options,
        overwriteProjectSettings: { includeModules: { 'gfx-webgl2': 'inherit-project-setting' } } }));
});

test('Tap 配置的渲染开关和模块列表一致，其余模块沿用微信配置', () => {
    const configs = JSON.parse(fs.readFileSync(path.join(root, 'settings/v2/packages/engine.json'), 'utf8')).modules.configs;
    const tap = configs[TAP_RENDER_CONFIG_KEY], wechat = configs[options.engineModulesConfigKey];
    assert.equal(tap.cache['gfx-webgl']._value, true);
    assert.equal(tap.cache['gfx-webgl2']._value, false);
    assert.ok(tap.includeModules.includes('gfx-webgl'));
    assert.ok(!tap.includeModules.includes('gfx-webgl2'));
    const nonGfx = config => config.includeModules.filter(x => !x.startsWith('gfx-')).sort();
    assert.deepEqual(nonGfx(tap), nonGfx(wechat));
    assert.equal(wechat.cache['gfx-webgl']._value, false);
    assert.equal(wechat.cache['gfx-webgl2']._value, true);
});
