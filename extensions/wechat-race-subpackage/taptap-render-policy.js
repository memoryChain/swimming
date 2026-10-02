'use strict';

const fs = require('fs');
const path = require('path');

function assertTapRenderConfig(projectRoot, options) {
    if (!options.packages?.['taptap-minigame-tools']?.enableTapConvert) return;
    const settings = JSON.parse(fs.readFileSync(path.join(projectRoot, 'settings/v2/packages/engine.json'), 'utf8'));
    const key = options.engineModulesConfigKey || settings.modules.globalConfigKey;
    const config = settings.modules.configs[key];
    if (!config) throw new Error(`[taptap-render] 找不到功能裁剪配置：${key}`);
    const overrides = options.overwriteProjectSettings?.includeModules || {};
    const selected = config.includeModules || [];
    const webgl = selected.includes('gfx-webgl') && overrides['gfx-webgl'] !== 'off';
    const webgl2 = overrides['gfx-webgl2'] === 'on'
        || (selected.includes('gfx-webgl2') && overrides['gfx-webgl2'] !== 'off');
    if (!webgl && !webgl2) {
        throw new Error('[taptap-render] WebGL 渲染后端全部被关闭。请在构建任务的“功能裁剪”选择 taptap，再构建。');
    }
}

module.exports = { assertTapRenderConfig };
