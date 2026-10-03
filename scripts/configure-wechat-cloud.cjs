'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, TARGETS, readTarget, renderClientConfig } = require('./wechat-cloud-target.cjs');
function configure(target, environmentId, projectRoot = ROOT) {
    if (!TARGETS.includes(target)) throw Error('用法：pnpm cloud:configure <development|production> [环境ID]');
    const configFile = path.join(projectRoot, 'config/cloud-environments.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const next = structuredClone(config);
    next.activeTarget = target;
    if (environmentId !== undefined) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,100}$/.test(environmentId)) throw Error('云环境 ID 无效；不要填写密钥');
        next.environments[target].environmentId = environmentId;
    }
    // 先完整验证，不让错误参数留下半更新的客户端配置。
    const old = fs.readFileSync(configFile, 'utf8');
    fs.writeFileSync(configFile, JSON.stringify(next, null, 2) + '\n');
    let info;
    try { info = readTarget(target, projectRoot, { allowUnconfigured: true }); }
    catch (error) { fs.writeFileSync(configFile, old); throw error; }
    const build = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config/build/wechatgame.json'), 'utf8'));
    fs.writeFileSync(path.join(projectRoot, 'assets/scripts/backend/WechatCloudConfig.ts'), renderClientConfig(info));
    const buildFile = path.join(projectRoot, `config/build/wechatgame-${target}.json`);
    fs.writeFileSync(buildFile, JSON.stringify({ ...build, outputName: info.outputName }, null, 2) + '\n');
    const projectFile = path.join(projectRoot, 'project.config.json');
    const existing = fs.existsSync(projectFile) ? JSON.parse(fs.readFileSync(projectFile, 'utf8')) : {};
    fs.writeFileSync(projectFile, JSON.stringify({ ...existing, appid: build.packages.wechatgame.appid,
        projectname: `swimming-cloud-${target}`, compileType: 'game', miniprogramRoot: `build/${info.outputName}/`,
        cloudfunctionRoot: `cloud/functions/${target}/`, setting: { ...existing.setting, es6: true,
            minified: true, uploadWithSourceMap: build.sourceMaps === true } }, null, 2) + '\n');
    return { ...info, configured: !!info.environmentId, projectFile, buildFile,
        next: `运行 pnpm cloud:build ${target}；Creator 导入 ${path.relative(projectRoot, buildFile)} 后重新构建。提审包必须使用 production。` };
}
if (require.main === module) {
    if (process.argv.length > 4) throw Error('用法：pnpm cloud:configure <development|production> [环境ID]');
    console.log(JSON.stringify(configure(...process.argv.slice(2)), null, 2));
}
module.exports = { configure };
