'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readWechatConfig, applyWechatProjectConfig, assertWechatProjectOutput } = require('../extensions/wechat-race-subpackage/wechat-project-config');

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
    ] };
    const write = () => {
        fs.writeFileSync(path.join(root, 'project.config.json'), JSON.stringify(project));
        fs.writeFileSync(path.join(root, 'game.json'), JSON.stringify(game));
    };
    for (const file of ['game.js', 'src/settings.json', 'subpackages/race/game.js', 'subpackages/music/game.js']) {
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
