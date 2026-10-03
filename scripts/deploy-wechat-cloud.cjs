'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, readTarget, sha256 } = require('./wechat-cloud-target.cjs');
function sourceManifest(directory) {
    const files = [];
    function walk(at, prefix = '') {
        for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name === 'node_modules') continue;
            const relative = prefix + entry.name;
            if (entry.isDirectory()) walk(path.join(at, entry.name), relative + '/');
            else if (entry.isFile()) files.push({ path: relative, sha256: sha256(fs.readFileSync(path.join(at, entry.name))) });
            else throw Error('部署包不能包含符号链接');
        }
    }
    walk(directory); return files;
}
function checkServerRelease(target, { compatibility = false, root = ROOT, directory } = {}) {
    const info = readTarget(target, root);
    directory ||= path.join(root, 'cloud/functions', info.target);
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'cloud-release.json'), 'utf8'));
    for (const key of ['target', 'environmentId', 'region', 'collectionPrefix', 'protocol', 'rulesVersion', 'functionName', 'adminFunctionName']) {
        if (receipt[key] !== info[key]) throw Error(`云部署目标不匹配：${key}`);
    }
    if (receipt.schema !== 1) throw Error('未知部署清单');
    const allowed = [info.functionName, info.adminFunctionName];
    if (compatibility && info.rulesVersion !== 3) throw Error('旧入口兼容包固定支持规则2/3，禁止后续版本覆盖');
    if (compatibility && info.target === 'production') allowed.push('swimming-player', 'swimming-admin');
    else if (compatibility) throw Error('兼容部署只允许 production');
    if (receipt.functions.length !== allowed.length || allowed.some(name => !receipt.functions.some(func => func.name === name))) throw Error('部署清单含错误入口；请按本次目标重新打包');
    for (const func of receipt.functions) {
        if (!allowed.includes(func.name)) throw Error('拒绝覆盖未授权的云函数入口');
        const at = path.join(directory, func.name);
        if (JSON.stringify(sourceManifest(at)) !== JSON.stringify(func.files)) throw Error(`部署源码已改变：${func.name}；请重新打包`);
        const deployment = JSON.parse(fs.readFileSync(path.join(at, 'deployment-target.json'), 'utf8'));
        const legacy = ['swimming-player', 'swimming-admin'].includes(func.name);
        if (deployment.name !== func.name || deployment.collectionPrefix !== info.collectionPrefix || deployment.environmentId !== info.environmentId
            || deployment.compatibility !== legacy || !!func.compatibility !== legacy) throw Error('函数入口与数据命名空间不匹配');
        const pkg = JSON.parse(fs.readFileSync(path.join(at, 'package.json'), 'utf8'));
        if (pkg.name !== func.name) throw Error('函数包名称不匹配');
    }
    return { info, receipt, directory };
}
function saveJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
function environment(detail) {
    return Object.fromEntries((detail.Environment?.Variables || []).map(item => [item.Key, item.Value]));
}
async function cloudClient(info) {
    const { getCredentialWithoutCheck } = require('@cloudbase/toolbox');
    const credential = await getCredentialWithoutCheck();
    if (!credential?.secretId || !credential?.secretKey) throw Error('官方 CloudBase CLI 登录态不可用，请先运行 tcb login');
    const CloudBase = require('@cloudbase/manager-node');
    return new CloudBase({ envId: info.environmentId, region: info.region,
        secretId: credential.secretId, secretKey: credential.secretKey, token: credential.token });
}
async function deploy(target, { compatibility = false, apply = false, root = ROOT } = {}) {
    const release = checkServerRelease(target, { compatibility, root });
    const api = (await cloudClient(release.info)).functions;
    const list = await api.getFunctionList(100, 0);
    if (list.TotalCount > 100) throw Error('云函数超过分页上限，先补充分页处理再发布');
    const names = new Set(list.Functions.map(func => func.FunctionName));
    const appId = JSON.parse(fs.readFileSync(path.join(root, 'config/build/wechatgame.json'), 'utf8')).packages.wechatgame.appid;
    const templates = {};
    for (const kind of ['player', 'admin']) {
        const name = `swimming-${kind}`;
        if (!names.has(name)) throw Error(`原函数不存在，不能继承其已核验配置：${name}`);
        templates[kind] = await api.getFunctionDetail(name);
        if (environment(templates[kind]).WECHAT_APP_ID !== appId) throw Error('原云函数 AppID 与项目不一致');
    }
    const plan = release.receipt.functions.map(func => ({ name: func.name, action: names.has(func.name) ? 'update-code' : 'create',
        compatibility: func.compatibility === true, collectionPrefix: release.info.collectionPrefix }));
    if (!apply) return { ...release.info, plan, applied: false };
    const parent = path.join(root, '.cache/cloud-backups'); fs.mkdirSync(parent, { recursive: true });
    const backup = fs.mkdtempSync(path.join(parent, `isolation-${release.info.target}-`));
    saveJson(path.join(backup, 'release.json'), release.receipt);
    // 发布前备份所有会更新的函数；任一读取/备份失败时不开始部署。
    const details = {};
    for (const item of plan) {
        if (item.action !== 'update-code') continue;
        const detail = await api.getFunctionDetail(item.name);
        if (detail.Status !== 'Active') throw Error(`云函数未就绪：${item.name}`);
        details[item.name] = detail;
        saveJson(path.join(backup, 'before', item.name + '-detail.json'), detail);
        const at = path.join(backup, 'before', item.name); fs.mkdirSync(at, { recursive: true });
        await api.downloadFunctionCode({ destPath: at, envId: release.info.environmentId, functionName: item.name });
        saveJson(path.join(backup, 'before', item.name + '-manifest.json'), sourceManifest(at));
    }
    const results = [];
    for (const item of plan) {
        const at = path.join(release.directory, item.name);
        const kind = item.name.startsWith('swimming-player') ? 'player' : 'admin';
        const detail = details[item.name];
        let result;
        if (detail) {
            const installDependency = detail.InstallDependency === 'TRUE';
            if (!installDependency) {
                const source = path.join(backup, 'before', item.name, 'node_modules');
                if (!fs.existsSync(source)) throw Error('原函数随包依赖缺失，拒绝改变安装方式');
                fs.rmSync(path.join(at, 'node_modules'), { recursive: true, force: true });
                fs.cpSync(source, path.join(at, 'node_modules'), { recursive: true });
            }
            result = await api.updateFunctionCode({ func: { name: item.name, runtime: detail.Runtime,
                handler: detail.Handler, installDependency, isWaitInstall: true }, functionPath: at, deployMode: installDependency ? 'zip' : 'cos' });
        } else {
            result = await api.createFunction({ func: { name: item.name, runtime: 'Nodejs20.19', handler: 'index.main',
                timeout: 10, memorySize: 256, installDependency: true, envVariables: environment(templates[kind]) }, functionPath: at, deployMode: 'zip' });
        }
        const after = await api.getFunctionDetail(item.name);
        if (after.Status !== 'Active') throw Error(`发布后状态异常：${item.name}`);
        if (detail && JSON.stringify(after.Environment) !== JSON.stringify(detail.Environment)) throw Error('代码发布改变了原函数环境变量，需核查');
        const downloaded = path.join(backup, 'after', item.name); fs.mkdirSync(downloaded, { recursive: true });
        await api.downloadFunctionCode({ destPath: downloaded, envId: release.info.environmentId, functionName: item.name });
        if (JSON.stringify(sourceManifest(downloaded)) !== JSON.stringify(sourceManifest(at))) throw Error(`线上源码与发布包不同：${item.name}`);
        saveJson(path.join(backup, 'after', item.name + '-detail.json'), after);
        const verified = { name: item.name, status: after.Status, modified: after.ModTime, requestId: result.RequestId,
            sourceFiles: sourceManifest(at).length, sourceVerified: true };
        results.push(verified); console.log(JSON.stringify(verified));
    }
    const completed = { target: release.info.target, environmentId: release.info.environmentId, backup,
        applied: true, results, completedAt: new Date().toISOString() };
    saveJson(path.join(backup, 'result.json'), completed); return completed;
}
if (require.main === module) {
    const [target, ...flags] = process.argv.slice(2);
    if (!target || flags.some(flag => !['--compatibility', '--apply'].includes(flag))) throw Error('用法：pnpm cloud:deploy <development|production> [--compatibility] [--apply]；默认只检查发布计划');
    deploy(target, { compatibility: flags.includes('--compatibility'), apply: flags.includes('--apply') })
        .then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(JSON.stringify({ failed: true, code: error.code, message: error.message })); process.exitCode = 1; });
}
module.exports = { checkServerRelease, sourceManifest, deploy };
