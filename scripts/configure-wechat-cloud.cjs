'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function configure(environmentId) {
    if (typeof environmentId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,100}$/.test(environmentId)) {
        throw Error('用法：pnpm cloud:configure <云环境ID>；只填写公开环境 ID，不填写 AppSecret');
    }
    const build = JSON.parse(fs.readFileSync(path.join(root, 'config/build/wechatgame.json'), 'utf8'));
    const configFile = path.join(root, 'assets/scripts/backend/WechatCloudConfig.ts');
    const source = fs.readFileSync(configFile, 'utf8');
    const updated = source.replace(/environmentId: '[^']*'/, `environmentId: '${environmentId}'`);
    if (!source.includes('environmentId:')) throw Error('云配置字段不存在');
    fs.writeFileSync(configFile, updated);
    // 根目录项目只将构建输出识别为小游戏，源模型和云函数不会混入客户端包。
    const projectFile = path.join(root, 'project.config.json');
    const existing = fs.existsSync(projectFile) ? JSON.parse(fs.readFileSync(projectFile, 'utf8')) : {};
    fs.writeFileSync(projectFile, JSON.stringify({ ...existing, appid: build.packages.wechatgame.appid,
        projectname: 'swimming-cloud', compileType: 'game', miniprogramRoot: 'build/wechatgame/',
        cloudfunctionRoot: 'cloud/functions/', setting: { ...existing.setting, es6: true } }, null, 2) + '\n');
    return { environmentId, appid: build.packages.wechatgame.appid, projectFile,
        next: '先运行 pnpm cloud:build，再在微信开发者工具导入项目根目录。配置云函数环境变量和集合后部署；客户端需要重新构建。' };
}
if (require.main === module) console.log(JSON.stringify(configure(process.argv[2]), null, 2));
module.exports = { configure };
