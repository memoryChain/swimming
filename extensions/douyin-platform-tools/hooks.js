'use strict';
const fs = require('node:fs');
const path = require('node:path');
const START = "require('./douyin-launch-bootstrap.js');";

function installLaunchBootstrap(destination) {
    const output = path.resolve(destination);
    const entry = path.join(output, 'game.js');
    const code = fs.readFileSync(entry, 'utf8');
    fs.copyFileSync(path.join(__dirname, 'launch-bootstrap.js'), path.join(output, 'douyin-launch-bootstrap.js'));
    if (!code.startsWith(START)) fs.writeFileSync(entry, START + '\n' + code);
    return output;
}
exports.installLaunchBootstrap = installLaunchBootstrap;
if (require.main === module) {
    if (!process.argv[2]) throw new Error('请提供已构建的抖音包目录');
    installLaunchBootstrap(process.argv[2]);
}
exports.onAfterBuild = async function (options, result) {
    if (options.platform !== 'bytedance-mini-game') return;
    installLaunchBootstrap(result.dest);
    console.log('[DouyinPlatform] 已安装引擎启动前的侧边栏来源监听');
};
