const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertStartupCodeOutput, assertStartupSceneEntry, assertStartupPreviewEntry } = require('../extensions/wechat-race-subpackage/startup-code-policy');
const { pathToFileURL } = require('node:url');
const { collectUiGlyphs, assertUiFontPolicy } = require('../scripts/ui-font-policy');
const crypto = require('node:crypto');

test('启动绑定拒绝 Creator 重分配 UUID 后的旧场景引用、重复 UUID 及陈旧预览注册', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-startup-entry-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (file, text) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
    const script = 'assets/startup/StartupManager.ts';
    const uuid = '250e5bfe-7ba4-472d-81d1-2fd5bdd7bc2a', classId = '250e5v+e6RHLYHRL9W917wq';
    write(script, ''); write(`${script}.meta`, JSON.stringify({ uuid }));
    const scene = [{ __type__: 'cc.Node', _name: 'Canvas', _components: [{ __id__: 1 }] },
        { __type__: '9decbEGd4VPKZbspaVsnO6H', node: { __id__: 0 }, _enabled: true }];
    const saveScene = () => write('assets/scenes/Login.scene', JSON.stringify(scene));
    saveScene(); assert.throws(() => assertStartupSceneEntry(root), /不能沿用旧脚本/);
    scene[1].__type__ = classId; saveScene(); assert.deepEqual(assertStartupSceneEntry(root), { uuid, classId });
    write('assets/Other.ts.meta', JSON.stringify({ uuid }));
    assert.throws(() => assertStartupSceneEntry(root), /UUID 冲突/);
    write('assets/Other.ts.meta', JSON.stringify({ uuid: '9decb106-7785-4f29-96ec-a5a56c9cee87' }));
    const preview = 'temp/programming/packer-driver/targets/preview/';
    write(`${preview}import-map.json`, JSON.stringify({ imports: { [pathToFileURL(path.join(root, script)).href]: './entry.js' } }));
    write(`${preview}entry.js`, '_cclegacy._RF.push({}, "9decbEGd4VPKZbspaVsnO6H", "StartupManager", undefined);');
    assert.throws(() => assertStartupPreviewEntry(root), /注册 ID 与场景不一致/);
    write(`${preview}entry.js`, `_cclegacy._RF.push({}, "${classId}", "StartupManager", undefined);`);
    assert.deepEqual(assertStartupPreviewEntry(root), { uuid, classId });
    scene[1]._enabled = false; saveScene(); assert.throws(() => assertStartupSceneEntry(root), /必须绑定/);
});

test('实际构建守卫拒绝业务代码回流主包、旧入口和启动预加载业务包', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-startup-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    function write(file, code) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, code); }
    const modules = names => names.map(name => `System.register("chunks:///_virtual/${name}.ts",[],function(){})`).join(';');
    const main = modules(['StartupManager', 'StartupView', 'DeferredCodeLoader']);
    const gameplay = modules(['LoginManager', 'GameManager', 'PrepareRaceFlow', 'RoomFlow']);
    write('assets/main/index.js', main); write('subpackages/gameplay/index.js', gameplay);
    write('src/settings.json', JSON.stringify({ assets: { preloadBundles: [{ bundle: 'main' }, { bundle: 'resources' }] } }));
    assert.deepEqual(assertStartupCodeOutput(root), { mainJsBytes: Buffer.byteLength(main), gameplayJsBytes: Buffer.byteLength(gameplay) });
    write('src/bundle-scripts/gameplay/index.js', gameplay);
    assert.throws(() => assertStartupCodeOutput(root), /必须只存在于 gameplay/);
    write('src/bundle-scripts/gameplay/index.js', ''); write('assets/main/index.js', '');
    assert.throws(() => assertStartupCodeOutput(root), /主包缺少/);
    write('assets/main/index.js', main);
    write('src/settings.json', JSON.stringify({ assets: { preloadBundles: [{ bundle: 'gameplay' }] } }));
    assert.throws(() => assertStartupCodeOutput(root), /不能配置为启动预加载/);
});

test('专用首屏字形只扫描指定文案文件，不携带大厅和比赛中文字库', () => {
    const root = path.resolve(__dirname, '..');
    const scan = collectUiGlyphs(root, ['assets/startup/StartupCopy.ts']);
    assert.equal(scan.files.length, 1);
    for (const letter of '开游加载中点击重试') assert.ok(scan.glyphText.includes(letter));
    assert.ok([...scan.glyphText].length < 120);
    assert.ok(collectUiGlyphs(root).glyphText.length > scan.glyphText.length * 10);
});

test('首屏新增已有的大厅文字时，也必须重建专用字体', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-font-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (file, text) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
    write('assets/startup/StartupCopy.ts', "'开游'"); write('assets/scripts/Copy.ts', "'别'");
    const scan = collectUiGlyphs(root), config = scan.config;
    const outputs = config.outputs.map(output => {
        const content = Buffer.from(output.path); write(output.path, content);
        return { path: output.path, sha256: crypto.createHash('sha256').update(content).digest('hex'),
            glyphHash: collectUiGlyphs(root, output.scanRoots).glyphHash };
    });
    write(config.manifestPath, JSON.stringify({ schemaVersion: config.schemaVersion, glyphHash: scan.glyphHash, outputs }));
    assertUiFontPolicy(root);
    write('assets/startup/StartupCopy.ts', "'开游别'");
    assert.equal(collectUiGlyphs(root).glyphHash, scan.glyphHash);
    assert.throws(() => assertUiFontPolicy(root), /首屏字形已变化/);
});
