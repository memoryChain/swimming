'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyWechatFirstScreen, assertWechatFirstScreen } = require('../extensions/wechat-race-subpackage/wechat-first-screen');

function fixture(t, bundle = 'resources', suffix = '.hash.png') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-first-screen-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const out = path.join(root, 'build'), startup = path.join(root, 'assets/startup');
    fs.mkdirSync(startup, { recursive: true });
    fs.writeFileSync(path.join(startup, 'StartupResources.ts'), "background: 'ui/bg/texture', logo: 'ui/logo/texture'");
    for (const [name, uuid] of [['bg', 'ab-background'], ['logo', 'cd-logo']]) {
        const asset = path.join(root, 'assets/resources/ui', name + '.png');
        fs.mkdirSync(path.dirname(asset), { recursive: true }); fs.writeFileSync(asset, '图片');
        fs.writeFileSync(asset + '.meta', JSON.stringify({ uuid }));
        const native = path.join(out, 'assets', bundle, 'native', uuid.slice(0, 2));
        fs.mkdirSync(native, { recursive: true }); fs.writeFileSync(path.join(native, uuid + suffix), '图片');
    }
    const file = path.join(out, 'first-screen.js');
    const original = ['start', 'end', 'setProgress', 'updateBgVertexBuffer', 'initLogoTexture', 'drawProgressBar', 'updateVertexBuffer', 'initProgressVertexBuffer']
        .map(name => `function ${name}() {\n}`).join('\n') + '\n'
        + ['bgName', 'logoName', 'bgColor', 'progressBarColor', 'progressBackground', 'useCustomBg', 'useLogo', 'useDefaultLogo', 'fitWidth', 'fitHeight']
            .map(name => `let ${name} = false;`).join('\n');
    fs.writeFileSync(file, original);
    return { root, out, file, original };
}

test('构建复用原生素材，支持 MD5 文件名，备份和重复处理不复制图片', t => {
    const { root, out, file, original } = fixture(t);
    assert.throws(() => assertWechatFirstScreen(root, out), /wechat:finalize/);
    assert.equal(applyWechatFirstScreen(root, out, { checkOnly: true }).changed, true);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    const backupRoot = path.join(root, 'backup');
    applyWechatFirstScreen(root, out, { backupRoot }); assertWechatFirstScreen(root, out);
    assert.equal(applyWechatFirstScreen(root, out).changed, false);
    assert.equal(fs.readFileSync(path.join(backupRoot, 'first-screen.js'), 'utf8'), original);
    assert.match(fs.readFileSync(file, 'utf8'), /assets\/resources\/native\/ab\/ab-background.hash.png/);
    assert.deepEqual(fs.readdirSync(out).sort(), ['assets', 'first-screen.js']);
});

for (const suffix of ['.png', '.hash.jpg']) {
    test(`首场景预加载移动素材后，resources/native 不存在也能定位 ${suffix}`, t => {
        const { root, out, file } = fixture(t, 'start-scene', suffix);
        assert.equal(fs.existsSync(path.join(out, 'assets/resources/native')), false);
        applyWechatFirstScreen(root, out);
        assertWechatFirstScreen(root, out);
        const source = fs.readFileSync(file, 'utf8');
        assert.ok(source.includes(`assets/start-scene/native/ab/ab-background${suffix}`));
        assert.ok(source.includes(`assets/start-scene/native/cd/cd-logo${suffix}`));
        assert.equal(applyWechatFirstScreen(root, out).changed, false);
        assert.deepEqual(fs.readdirSync(path.join(out, 'assets')), ['start-scene']);
    });
}

test('背景与 Logo 可以分别位于两个主包 bundle', t => {
    const { root, out, file } = fixture(t);
    const target = path.join(out, 'assets/start-scene/native/ab');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(path.join(out, 'assets/resources/native/ab'), target);
    applyWechatFirstScreen(root, out);
    assertWechatFirstScreen(root, out);
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(source.includes('assets/start-scene/native/ab/ab-background.hash.png'));
    assert.ok(source.includes('assets/resources/native/cd/cd-logo.hash.png'));
});

test('素材缺失或只存在于尚未搬走的业务分包时，给出明确错误且不修改入口', t => {
    const { root, out, file, original } = fixture(t, 'race');
    assert.throws(() => applyWechatFirstScreen(root, out), /background（ab-background），找到 0 个候选/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('跨 bundle 或同目录存在多个候选时拒绝猜测', t => {
    const { root, out, file, original } = fixture(t);
    const duplicate = path.join(out, 'assets/start-scene/native/ab/ab-background.png');
    fs.mkdirSync(path.dirname(duplicate), { recursive: true });
    fs.writeFileSync(duplicate, '图片');
    assert.throws(() => applyWechatFirstScreen(root, out), /background（ab-background），找到 2 个候选/);
    fs.renameSync(duplicate, path.join(out, 'assets/resources/native/ab/ab-background.png'));
    assert.throws(() => applyWechatFirstScreen(root, out), /background（ab-background），找到 2 个候选/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
});
