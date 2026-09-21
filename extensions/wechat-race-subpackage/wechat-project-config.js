'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.resolve(__dirname, '../../config/build/wechatgame.json');

function readWechatConfig() {
    // 每次构建重新读取，修改配置后不依赖扩展模块缓存刷新。
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const wechat = config.packages?.wechatgame;
    if (config.platform !== 'wechatgame' || !/^wx[0-9a-f]{16}$/.test(wechat?.appid || '')) {
        throw new Error('[wechat-project] 微信构建配置缺少有效的小游戏 AppID。');
    }
    if (wechat.orientation !== 'landscapeRight') {
        throw new Error('[wechat-project] 划水大师必须使用横屏 landscapeRight。');
    }
    return config;
}

function applyWechatProjectConfig(options) {
    if (options.platform !== 'wechatgame') return;
    const config = readWechatConfig();
    const packages = options.packages || (options.packages = {});
    const wechat = packages.wechatgame || (packages.wechatgame = {});
    // AppID 与横屏由共享配置管理；保留面板中的调试、压缩等其他选择。
    wechat.appid = config.packages.wechatgame.appid;
    wechat.orientation = config.packages.wechatgame.orientation;
    options.name = config.name;
}

function assertWechatProjectOutput(outputRoot) {
    const config = readWechatConfig();
    const project = JSON.parse(fs.readFileSync(path.join(outputRoot, 'project.config.json'), 'utf8'));
    const game = JSON.parse(fs.readFileSync(path.join(outputRoot, 'game.json'), 'utf8'));
    const expected = config.packages.wechatgame;
    if (project.appid !== expected.appid) {
        throw new Error(`[wechat-project] 构建包 AppID 不匹配：应为 ${expected.appid}，实际为 ${project.appid}。请重新构建。`);
    }
    if (project.compileType !== 'game') {
        throw new Error('[wechat-project] 构建产物必须是小游戏（compileType=game）。');
    }
    if (game.deviceOrientation !== expected.orientation) {
        throw new Error('[wechat-project] 构建包横屏配置与项目不一致。请重新构建。');
    }
    for (const entry of ['game.js', 'src/settings.json']) {
        if (!fs.existsSync(path.join(outputRoot, entry))) {
            throw new Error(`[wechat-project] 构建包缺少入口文件 ${entry}。`);
        }
    }
    for (const name of ['race', 'music']) {
        const root = `subpackages/${name}/`;
        if (!game.subpackages?.some(item => item.name === name && item.root === root)
            || !fs.existsSync(path.join(outputRoot, root, 'game.js'))) {
            throw new Error(`[wechat-project] 构建包缺少 ${name} 分包配置或入口。`);
        }
    }
    return { appid: project.appid, orientation: game.deviceOrientation };
}

module.exports = { readWechatConfig, applyWechatProjectConfig, assertWechatProjectOutput };
