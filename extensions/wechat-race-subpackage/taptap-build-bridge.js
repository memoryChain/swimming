'use strict';

const fs = require('fs');
const path = require('path');

// 官方 1.2.2 的转换钩子先于本项目的分包收尾执行。保留转换器，延后调用它。
function installTapBuildBridge(projectRoot) {
    const file = path.join(projectRoot, 'extensions/taptap-minigame-tools/dist/hooks.js');
    if (!fs.existsSync(file)) throw new Error('[taptap-build] 未安装 TapTap 转换插件。');
    const source = fs.readFileSync(file, 'utf8');
    const marker = 'SWIMMING_TAP_BUILD_AFTER_AUDIT';
    if (source.includes(marker)) return;
    const anchor = "    console.log('[Tap小游戏] 开始转换为Tap小游戏...');";
    if (source.split(anchor).length !== 2) throw new Error('[taptap-build] 转换插件版本变化，需要重新核对构建顺序。');
    const guard = `    // ${marker}\n`
        + `    if (!options.__swimmingBuildAudited) {\n`
        + `        console.log('[Tap小游戏] 等待项目贴图检查与分包整理完成后转换');\n`
        + `        return;\n`
        + `    }\n`;
    fs.writeFileSync(file, source.replace(anchor, guard + anchor), 'utf8');
}

async function convertTapAfterAudit(projectRoot, options, result) {
    if (!options.packages?.['taptap-minigame-tools']?.enableTapConvert) return;
    const hooks = require(path.join(projectRoot, 'extensions/taptap-minigame-tools/dist/hooks.js'));
    await hooks.onAfterBuild({ ...options, __swimmingBuildAudited: true }, result);
    const zip = path.join(path.dirname(result.dest), 'TapBuild/game.zip');
    const bytes = fs.statSync(zip).size;
    // 官方不同页面存在 20 MB / 60M 口径差异，先采用较保守的 ZIP 预算。
    // 这项检查不代表首包/分包已被平台验收，仍需上传开发包验证。
    if (bytes >= 20 * 1000 * 1000) {
        throw new Error(`[taptap-build] Tap ZIP 为 ${(bytes / 1000 / 1000).toFixed(2)} MB，超出暂定的 20 MB 保守预算。`);
    }
    console.log(`[taptap-build] 转换后 ZIP ${(bytes / 1000 / 1000).toFixed(2)} MB；首包与分包限制仍以平台上传校验为准。`);
}

module.exports = { installTapBuildBridge, convertTapAfterAudit };
