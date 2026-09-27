'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Creator 的 MD5 Cache 同时改变 settings 和 Bundle 文件名。所有构建审计共用此入口。
function settingsFile(outputRoot) {
    const directory = path.join(outputRoot, 'src');
    const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => /^settings(?:\.[a-f0-9]+)?\.json$/.test(name)) : [];
    if (files.length !== 1) throw new Error(`[wechat-build] settings 文件无法唯一定位（${files.length} 个）：${directory}。请完整重建，勿同时运行两个构建。`);
    return path.join(directory, files[0]);
}
module.exports = { settingsFile };
