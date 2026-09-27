'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readWechatConfig, applyWechatProjectConfig, assertWechatProjectOutput } = require('../extensions/wechat-race-subpackage/wechat-project-config');
const { configure } = require('../scripts/configure-wechat-cloud.cjs');

test('云开发根项目开启上传压缩并跟随构建 SourceMap 配置，保留其他本地设置', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-cloud-config-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'config/build'), { recursive: true });
    fs.mkdirSync(path.join(root, 'assets/scripts/backend'), { recursive: true });
    const build = { sourceMaps: false, packages: { wechatgame: { appid: 'wx89ee56c51312f147' } } };
    const buildFile = path.join(root, 'config/build/wechatgame.json');
    fs.writeFileSync(buildFile, JSON.stringify(build));
    fs.writeFileSync(path.join(root, 'assets/scripts/backend/WechatCloudConfig.ts'), "export const config = { environmentId: '' };\n");
    const file = path.join(root, 'project.config.json');
    const ignores = [{ type: 'file', value: 'local-notes.txt' }];
    fs.writeFileSync(file, JSON.stringify({ setting: { minified: false, uploadWithSourceMap: true, urlCheck: true }, packOptions: { ignore: ignores } }));
    configure('test-env', root);
    const project = JSON.parse(fs.readFileSync(file));
    assert.equal(project.setting.minified, true);
    assert.equal(project.setting.uploadWithSourceMap, false);
    assert.equal(project.setting.urlCheck, true);
    assert.deepEqual(project.packOptions.ignore, ignores);
    assert.equal(project.miniprogramRoot, 'build/wechatgame/');
    assert.equal(project.cloudfunctionRoot, 'cloud/functions/');
    build.sourceMaps = true; fs.writeFileSync(buildFile, JSON.stringify(build));
    configure('test-env', root);
    assert.equal(JSON.parse(fs.readFileSync(file)).setting.uploadWithSourceMap, true);
});

test('微信构建使用项目身份，保留调试和平台其他配置', () => {
    const options = { platform: 'wechatgame', debug: false, packages: {
        wechatgame: { appid: 'wx6ac3f5090a6b99c5', orientation: 'portrait', separateEngine: true },
        custom: { enabled: true },
    } };
    applyWechatProjectConfig(options);
    assert.equal(options.packages.wechatgame.appid, 'wx89ee56c51312f147');
    assert.equal(options.packages.wechatgame.orientation, 'landscapeRight');
    assert.equal(options.debug, false);
    assert.equal(options.packages.wechatgame.separateEngine, true);
    assert.equal(options.packages.custom.enabled, true);
});

test('其他平台的构建配置保持原样', () => {
    const options = { platform: 'web-mobile', name: 'preview' };
    applyWechatProjectConfig(options);
    assert.deepEqual(options, { platform: 'web-mobile', name: 'preview' });
});

test('拒绝错误 AppID、错误类型、竖屏和缺失分包的构建包', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-wechat-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const appid = readWechatConfig().packages.wechatgame.appid;
    const project = { appid, compileType: 'game' };
    const game = { deviceOrientation: 'landscapeRight', subpackages: [
        { name: 'race', root: 'subpackages/race/' },
        { name: 'music', root: 'subpackages/music/' },
        { name: 'gameplay', root: 'subpackages/gameplay/' },
        { name: 'startup-ui', root: 'subpackages/startup-ui/' },
    ] };
    const write = () => {
        fs.writeFileSync(path.join(root, 'project.config.json'), JSON.stringify(project));
        fs.writeFileSync(path.join(root, 'game.json'), JSON.stringify(game));
    };
    for (const file of ['game.js', 'src/settings.json', ...game.subpackages.map(item => item.root + 'game.js')]) {
        const target = path.join(root, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, '{}');
    }
    write();
    assert.equal(assertWechatProjectOutput(root).appid, appid);
    project.appid = 'wx6ac3f5090a6b99c5'; write();
    assert.throws(() => assertWechatProjectOutput(root), /AppID 不匹配/);
    project.appid = appid; project.compileType = 'miniprogram'; write();
    assert.throws(() => assertWechatProjectOutput(root), /compileType=game/);
    project.compileType = 'game'; game.deviceOrientation = 'portrait'; write();
    assert.throws(() => assertWechatProjectOutput(root), /横屏配置/);
    game.deviceOrientation = 'landscapeRight'; write();
    fs.unlinkSync(path.join(root, 'subpackages/music/game.js'));
    assert.throws(() => assertWechatProjectOutput(root), /music 分包/);
});
