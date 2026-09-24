'use strict';

const path = require('node:path');
const { readWechatConfig, assertWechatProjectOutput } = require('../extensions/wechat-race-subpackage/wechat-project-config');
const { assertTextureCompressionPolicy } = require('../extensions/wechat-race-subpackage/texture-compression-policy');
const { assertUiFontPolicy } = require('./ui-font-policy');
const { auditWechatPackageOutput } = require('../extensions/wechat-race-subpackage/wechat-package-budget');
const { assertBuiltMotionRuntime, assertBuiltMotionStorage } = require('../extensions/wechat-race-subpackage/sampled-motion-storage');
const { assertStartupCodeOutput, assertStartupSceneEntry } = require('../extensions/wechat-race-subpackage/startup-code-policy');

const projectRoot = path.resolve(__dirname, '..');
try {
    const args = process.argv.slice(2);
    if (args.length && (args[0] !== '--build' || args.length > 2)) {
        throw new Error('用法：npm run wechat:check [-- --build [构建目录]]');
    }
    const config = readWechatConfig();
    assertStartupSceneEntry(projectRoot);
    console.log('[wechat-project] 登录场景的启动脚本绑定与 UUID 唯一性检查通过。');
    console.log(`[wechat-project] AppID ${config.packages.wechatgame.appid}，横屏，配置用途：开发与体验版。`);
    const textures = assertTextureCompressionPolicy(projectRoot);
    console.log(`[wechat-project] 贴图策略通过：${textures.eligible} 张压缩贴图。`);
    const fonts = assertUiFontPolicy(projectRoot);
    console.log(`[wechat-project] 字体检查通过：${fonts.glyphCount} 个字符。`);
    if (args[0] === '--build') {
        const output = path.resolve(projectRoot, args[1] || 'build/wechatgame');
        const result = assertWechatProjectOutput(output);
        const startup = assertStartupCodeOutput(output);
        console.log(`[wechat-project] 主包脚本 ${(startup.mainJsBytes / 1024).toFixed(1)} KiB；延迟业务脚本 ${(startup.gameplayJsBytes / 1024).toFixed(1)} KiB。`);
        assertBuiltMotionRuntime(output);
        const motions = assertBuiltMotionStorage(projectRoot, output);
        const budget = auditWechatPackageOutput(output);
        console.log(`[wechat-project] ${motions.motions} 个动作的解码入口与无损构建后处理检查通过。`);
        console.log(`[wechat-project] 构建包入口、分包及 AppID 检查通过：${result.appid}。`);
        console.log(`[wechat-project] 主包 ${(budget.mainBytes / 1024).toFixed(1)} / 4096 KiB；总包 ${(budget.totalBytes / 1024).toFixed(1)} / 30720 KiB。`);
    } else {
        console.log('[wechat-project] 本次只检查项目源文件；构建后请运行 npm run wechat:check -- --build。');
    }
    console.log('[wechat-project] 平台权限、资质、广告、云存档及真机验收需另行确认，此检查不代表具备提审条件。');
} catch (error) {
    console.error(`[wechat-project] ${error.message}`);
    process.exitCode = 1;
}
