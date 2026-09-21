'use strict';

const path = require('node:path');
const { readWechatConfig, assertWechatProjectOutput } = require('../extensions/wechat-race-subpackage/wechat-project-config');
const { assertTextureCompressionPolicy } = require('../extensions/wechat-race-subpackage/texture-compression-policy');
const { assertUiFontPolicy } = require('./ui-font-policy');

const projectRoot = path.resolve(__dirname, '..');
try {
    const args = process.argv.slice(2);
    if (args.length && (args[0] !== '--build' || args.length > 2)) {
        throw new Error('用法：npm run wechat:check [-- --build [构建目录]]');
    }
    const config = readWechatConfig();
    console.log(`[wechat-project] AppID ${config.packages.wechatgame.appid}，横屏，配置用途：开发与体验版。`);
    const textures = assertTextureCompressionPolicy(projectRoot);
    console.log(`[wechat-project] 贴图策略通过：${textures.eligible} 张压缩贴图。`);
    const fonts = assertUiFontPolicy(projectRoot);
    console.log(`[wechat-project] 字体检查通过：${fonts.glyphCount} 个字符。`);
    if (args[0] === '--build') {
        const output = path.resolve(projectRoot, args[1] || 'build/wechatgame');
        const result = assertWechatProjectOutput(output);
        console.log(`[wechat-project] 构建包入口、分包及 AppID 检查通过：${result.appid}。`);
    } else {
        console.log('[wechat-project] 本次只检查项目源文件；构建后请运行 npm run wechat:check -- --build。');
    }
    console.log('[wechat-project] 平台权限、资质、广告、云存档及真机验收需另行确认，此检查不代表具备提审条件。');
} catch (error) {
    console.error(`[wechat-project] ${error.message}`);
    process.exitCode = 1;
}
