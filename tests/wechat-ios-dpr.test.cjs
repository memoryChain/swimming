'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { applyWechatIosDpr, assertWechatIosDpr } = require('../extensions/wechat-race-subpackage/wechat-ios-dpr');

function buildEntry(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-dpr-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const entry = path.join(root, 'game.js');
    fs.writeFileSync(entry, "require('./web-adapter');\n");
    applyWechatIosDpr(root);
    assertWechatIosDpr(root);
    const once = fs.readFileSync(entry, 'utf8');
    applyWechatIosDpr(root);
    assert.equal(fs.readFileSync(entry, 'utf8'), once);
    return once;
}

for (const [platform, nativeDpr, expected] of [
    ['ios', 3, 2.2], ['ios', 2, 2], ['android', 3, 3], ['devtools', 3, 3],
]) {
    test(`${platform} 原生 DPR ${nativeDpr}，引擎启动时使用 ${expected}`, t => {
        const source = buildEntry(t);
        let width = 844;
        const wx = {
            getDeviceInfo: () => ({ platform }),
            getWindowInfo() {
                assert.equal(this, wx);
                return Object.freeze({ pixelRatio: nativeDpr, windowWidth: width, windowHeight: 390, safeArea: { left: 44 } });
            },
            getSystemInfoSync() {
                assert.equal(this, wx);
                return { platform, pixelRatio: nativeDpr, devicePixelRatio: nativeDpr, windowWidth: width };
            },
        };
        const originalWindow = wx.getWindowInfo;
        const logs = [];
        vm.runInNewContext(source, { wx, console: { log: message => logs.push(message) }, require: () => {
            // 模拟引擎初始化时复制接口，后续横竖屏变化仍读取实时尺寸。
            const cachedWindow = wx.getWindowInfo.bind(wx);
            assert.equal(cachedWindow().pixelRatio, expected);
            assert.equal(wx.getSystemInfoSync().pixelRatio, expected);
            assert.equal(wx.getSystemInfoSync().devicePixelRatio, expected);
            assert.equal(cachedWindow().safeArea.left, 44);
            width = 390;
            assert.equal(cachedWindow().windowWidth, 390);
        } });
        assert.deepEqual(logs, [`[DPR] 平台=${platform} 原始=${nativeDpr} 生效=${expected} iOS上限=2.2`],
            '启动只打印一次，后续窗口和系统信息查询不能重复打印');
        if (platform !== 'ios') assert.equal(wx.getWindowInfo, originalWindow);
    });
}

test('旧微信基础库只提供 getSystemInfoSync 时仍限制 iOS DPR', t => {
    const wx = { getSystemInfoSync: () => ({ platform: 'ios', pixelRatio: 3, windowWidth: 844 }) };
    const logs = [];
    vm.runInNewContext(buildEntry(t), { wx, console: { log: message => logs.push(message) }, require: () => {
        assert.equal(wx.getSystemInfoSync().pixelRatio, 2.2);
        assert.equal(wx.getSystemInfoSync().windowWidth, 844);
        assert.equal(wx.getWindowInfo, undefined);
    } });
    assert.deepEqual(logs, ['[DPR] 平台=ios 原始=3 生效=2.2 iOS上限=2.2']);
});

test('设备查询不可用时不阻断原入口', t => {
    let started = false;
    vm.runInNewContext(buildEntry(t), {
        wx: { getSystemInfoSync() { throw new Error('不可用'); } },
        require: () => { started = true; },
    });
    assert.equal(started, true);
});

test('旧插件产物被审计拒绝，后处理保留原入口与备份且可重复运行', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-dpr-stale-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const entry = path.join(root, 'game.js');
    const body = "require('./web-adapter');\r\n";
    const stale = '// swimming-ios-dpr:start\n;(function () {})();\n// swimming-ios-dpr:end\n' + body;
    fs.writeFileSync(entry, stale);
    assert.throws(() => assertWechatIosDpr(root), /wechat:finalize/);
    assert.equal(applyWechatIosDpr(root, { checkOnly: true }).changed, true);
    assert.equal(fs.readFileSync(entry, 'utf8'), stale);
    const backupRoot = path.join(root, 'backup');
    assert.equal(applyWechatIosDpr(root, { backupRoot }).changed, true);
    assert.equal(fs.readFileSync(path.join(backupRoot, 'game.js'), 'utf8'), stale);
    assertWechatIosDpr(root);
    const updated = fs.readFileSync(entry, 'utf8');
    assert.equal(updated.split('// swimming-ios-dpr:end\n')[1], body);
    assert.equal(applyWechatIosDpr(root, { backupRoot }).changed, false);
    assert.equal(fs.readFileSync(path.join(backupRoot, 'game.js'), 'utf8'), stale);
    fs.writeFileSync(entry, updated.replace('console.log(`[DPR]', 'void (`[DPR]'));
    assert.throws(() => assertWechatIosDpr(root), /wechat:finalize/);
});
