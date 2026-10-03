'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const TARGETS = ['development', 'production'];
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function readProtocol(root = ROOT) {
    const source = fs.readFileSync(path.join(root, 'assets/scripts/backend/CloudProtocol.ts'), 'utf8');
    const match = source.match(/version:\s*(\d+),\s*rulesVersion:\s*(\d+)/);
    if (!match) throw Error('无法读取云协议版本');
    return { protocol: Number(match[1]), rulesVersion: Number(match[2]) };
}
function readTarget(target, root = ROOT, { allowUnconfigured = false } = {}) {
    const config = json(path.join(root, 'config/cloud-environments.json'));
    target ||= config.activeTarget;
    if (config.schema !== 1 || !TARGETS.includes(target) || !TARGETS.includes(config.activeTarget)) throw Error('云构建目标必须是 development 或 production');
    const environmentId = config.environments?.[target]?.environmentId;
    if (typeof environmentId !== 'string' || (environmentId && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,100}$/.test(environmentId))) throw Error('云环境 ID 无效');
    if (!environmentId && !allowUnconfigured) throw Error(`尚未配置 ${target} 云环境；请运行 pnpm cloud:configure ${target} <环境ID>`);
    const collectionPrefix = config.environments[target].collectionPrefix;
    if (collectionPrefix !== (target === 'development' ? 'dev_' : '')) throw Error('测试集合必须使用 dev_ 前缀，正式集合必须保持原名称');
    if (!/^[a-z]+-[a-z]+$/.test(config.region)) throw Error('云环境地域无效');
    const versions = readProtocol(root);
    const infix = target === 'development' ? '-dev' : '';
    const functionName = `swimming-player${infix}-v${versions.rulesVersion}`;
    return { target, environmentId, collectionPrefix, region: config.region, ...versions, functionName,
        adminFunctionName: `swimming-admin${infix}-v${versions.rulesVersion}`,
        outputName: target === 'development' ? 'wechatgame-development' : 'wechatgame',
        buildStamp: `swimming-cloud:${target}:${environmentId}:${functionName}:p${versions.protocol}-r${versions.rulesVersion}` };
}
function renderClientConfig(info) {
    return `/** 由 pnpm cloud:configure 生成；开发与正式函数、集合和缓存分别隔离。 */\nexport const WECHAT_CLOUD_CONFIG = {\n    target: '${info.target}',\n    environmentId: '${info.environmentId}',\n    functionName: '${info.functionName}',\n    adminFunctionName: '${info.adminFunctionName}',\n    storageNamespace: '${info.collectionPrefix}',\n    buildStamp: '${info.buildStamp}',\n    timeoutMs: 12000,\n} as const;\n`;
}
function assertClientConfig(root = ROOT, target) {
    const info = readTarget(target, root);
    const source = fs.readFileSync(path.join(root, 'assets/scripts/backend/WechatCloudConfig.ts'), 'utf8');
    if (source.replace(/\r\n/g, '\n') !== renderClientConfig(info)) throw Error('客户端云配置与构建目标不一致；请先运行 pnpm cloud:configure，等待 Creator 导入后重新构建');
    return info;
}
function gameplayFiles(output) {
    const directory = path.join(output, 'subpackages/gameplay');
    return fs.readdirSync(directory).filter(name => name.endsWith('.js')).sort().map(name => ({
        path: `subpackages/gameplay/${name}`, sha256: sha256(fs.readFileSync(path.join(directory, name))),
    }));
}
function inspectClientOutput(output, info) {
    const files = gameplayFiles(output);
    if (!files.some(file => fs.readFileSync(path.join(output, file.path), 'utf8').includes(info.buildStamp))) throw Error('微信包内云配置与目标不一致，或仍为旧构建；必须从源码重新构建');
    return files;
}
function writeClientRelease(root, output) {
    const info = assertClientConfig(root);
    const files = inspectClientOutput(output, info);
    const receipt = { schema: 1, ...info, files };
    fs.writeFileSync(path.join(output, 'cloud-release.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
}
function assertClientRelease(root, output, target) {
    const info = readTarget(target, root);
    const receipt = json(path.join(output, 'cloud-release.json'));
    const files = inspectClientOutput(output, info);
    for (const key of ['schema', 'target', 'environmentId', 'functionName', 'protocol', 'rulesVersion', 'buildStamp']) {
        if (receipt[key] !== (key === 'schema' ? 1 : info[key])) throw Error(`微信云发布记录不匹配：${key}`);
    }
    if (JSON.stringify(files) !== JSON.stringify(receipt.files)) throw Error('微信游戏脚本已改变，请重新构建并核验');
    return receipt;
}
module.exports = { ROOT, TARGETS, readTarget, readProtocol, renderClientConfig, assertClientConfig, writeClientRelease, assertClientRelease, sha256 };
