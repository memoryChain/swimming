const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { instrumentEngine, instrumentEntry } = require('../scripts/create-taptap-startup-diagnostic.cjs');

const fixture = `var S = {}, x = S;
function Manager() {}
(function () {
  var e = Manager.prototype;
  e.init = function () { S.WebGLDevice && (this._gfxDevice = new S.WebGLDevice()); return this._initSwapchain(); };
  e._initSwapchain = function () { return this._gfxDevice.createSwapchain(); };
})();
x.WebGLDevice = function () { this.createSwapchain = function () { return 123; }; };`;

test('引擎诊断保留正常初始化，并记录缺失后端时的真实对象', () => {
    const logs = [];
    const context = { console: { log: value => logs.push(value) } };
    vm.createContext(context);
    vm.runInContext(instrumentEngine(fixture), context);
    assert.equal(vm.runInContext('new Manager().init()', context), 123);
    assert.ok(logs.some(line => line.includes('registered') && line.includes('"webgl":"function"')));
    assert.ok(logs.some(line => line.includes('swapchain') && line.includes('"device":"object"')));
    vm.runInContext('delete S.WebGLDevice', context);
    assert.throws(() => vm.runInContext('new Manager().init()', context), /createSwapchain/);
    assert.ok(logs.some(line => line.includes('swapchain') && line.includes('"device":"undefined"')));
    assert.throws(() => instrumentEngine('var unrelated = 1;'), /锚点不匹配/);
});

test('启动诊断记录错误后继续抛出同一异常，正常返回值与后端调用次数保持一致', () => {
    const logs = [];
    const exports = {};
    const error = new Error('启动失败样本');
    let tries = 0;
    function Manager() {}
    Manager.prototype._tryInitializeDeviceSync = function () { tries++; this._gfxDevice = {}; return true; };
    Manager.prototype.init = function (fail) {
        if (fail) throw error;
        return this._tryInitializeDeviceSync(function () {}, {});
    };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../scripts/templates/taptap-startup-diagnostic.js'), 'utf8'), {
        exports, console: { log: value => logs.push(value) }, window: {}
    });
    const cc = { cclegacy: {}, gfx: { DeviceManager: Manager } };
    exports.ready(cc, 'before-adapter');
    exports.ready(cc, 'after-adapter');
    assert.equal(new Manager().init(false), true);
    assert.equal(tries, 1);
    assert.throws(() => new Manager().init(true), value => value === error);
    assert.ok(logs.some(line => line.includes('device-failed')));
    assert.throws(() => instrumentEntry('var incompatible = true;'), /入口结构变化/);
});
