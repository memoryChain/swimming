'use strict';
// 只递归编译实际运行依赖；禁止把 cc、资源或客户端 SDK 打进云函数。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readTarget } = require('./wechat-cloud-target.cjs');
const root = path.resolve(__dirname, '..');
function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const entry of process.env.PATH.split(path.delimiter)) {
        const file = path.resolve(entry, '../typescript/lib/typescript.js');
        if (fs.existsSync(file)) return require(file);
    }
    throw Error('请通过 pnpm cloud:build 使用 TypeScript 5.4.5');
}
function build(output, { target, compatibility = false } = {}) {
    const info = readTarget(target, root);
    output ||= path.join(root, 'cloud/functions', info.target);
    if (compatibility && info.target !== 'production') throw Error('旧入口兼容包只能为 production 生成');
    if (compatibility && info.rulesVersion !== 3) throw Error('现有兼容入口固定支持规则2/3；后续版本必须保留它并新增独立入口');
    const ts = compiler();
    if (ts.version !== '5.4.5') throw Error('云规则必须使用 TypeScript 5.4.5');
    const scripts = path.join(root, 'assets/scripts'), compiled = new Map();
    function visit(relative) {
        if (compiled.has(relative)) return;
        const source = fs.readFileSync(path.join(scripts, relative + '.ts'), 'utf8');
        const result = ts.transpileModule(source, { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
        } }).outputText;
        compiled.set(relative, result);
        for (const match of result.matchAll(/require\(["']([^"']+)["']\)/g)) {
            if (!match[1].startsWith('.')) throw Error(`云规则包含禁止依赖：${relative} → ${match[1]}`);
            const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
            if (dependency.startsWith('..')) throw Error('云规则依赖越界');
            visit(dependency);
        }
    }
    ['backend/PlayerProfile', 'backend/CloudProtocol', 'backend/IdentityConfig', 'progression/CareerRules',
        'progression/ProgressionBalance', 'app/PlayerCharacterConfig'].forEach(visit);
    const digest = crypto.createHash('sha256').update(JSON.stringify([...compiled].sort())).digest('hex');
    const legacyRoot = path.join(root, 'cloud/compat/v2');
    const legacyManifest = JSON.parse(fs.readFileSync(path.join(legacyRoot, 'rules-manifest.json'), 'utf8'));
    const legacyModules = legacyManifest.modules.sort().map(name => [name, fs.readFileSync(path.join(legacyRoot, 'rules', name + '.js'), 'utf8')]);
    const legacyDigest = crypto.createHash('sha256').update(JSON.stringify(legacyModules)).digest('hex');
    if (legacyDigest !== legacyManifest.sha256) throw Error('旧规则快照已改变，拒绝打包');
    const functions = [
        { kind: 'player', name: info.functionName }, { kind: 'admin', name: info.adminFunctionName },
        ...(compatibility ? [{ kind: 'player', name: 'swimming-player', compatibility: true }, { kind: 'admin', name: 'swimming-admin', compatibility: true }] : []),
    ];
    for (const func of functions) {
        const { kind, name } = func;
        const directory = path.join(output, name);
        fs.mkdirSync(directory, { recursive: true });
        // 清理仅由本脚本生成的规则目录，防止已移除的旧规则留在部署包中。
        fs.rmSync(path.join(directory, 'rules'), { recursive: true, force: true });
        for (const [relative, code] of compiled) {
            const target = path.join(directory, 'rules', relative + '.js');
            fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, code);
        }
        fs.copyFileSync(path.join(root, 'cloud/src', `${kind}-entry.cjs`), path.join(directory, 'index.js'));
        fs.copyFileSync(path.join(root, 'cloud/src/service.cjs'), path.join(directory, 'service.cjs'));
        for (const file of ['deployment.cjs', 'legacy-rules.cjs']) fs.copyFileSync(path.join(root, 'cloud/src', file), path.join(directory, file));
        fs.rmSync(path.join(directory, 'compat'), { recursive: true, force: true });
        fs.cpSync(legacyRoot, path.join(directory, 'compat/v2'), { recursive: true });
        fs.writeFileSync(path.join(directory, 'deployment-target.json'), JSON.stringify({ ...info,
            name, compatibility: func.compatibility === true }, null, 2) + '\n');
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0',
            private: true, main: 'index.js', dependencies: { 'wx-server-sdk': '3.0.1',
                ...(kind === 'admin' ? { '@cloudbase/node-sdk': '3.18.3' } : {}) } }, null, 2) + '\n');
        fs.writeFileSync(path.join(directory, 'rules-manifest.json'), JSON.stringify({ typescript: ts.version,
            sha256: digest, modules: [...compiled.keys()].sort() }, null, 2) + '\n');
    }
    const manifests = functions.map(func => {
        const directory = path.join(output, func.name);
        const files = [];
        function walk(at, prefix = '') {
            for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                if (entry.name === 'node_modules') continue;
                const relative = prefix + entry.name;
                if (entry.isDirectory()) walk(path.join(at, entry.name), relative + '/');
                else files.push({ path: relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(at, entry.name))).digest('hex') });
            }
        }
        walk(directory);
        return { ...func, files };
    });
    fs.writeFileSync(path.join(output, 'cloud-release.json'), JSON.stringify({ schema: 1, ...info,
        rulesSha256: digest, legacyRulesSha256: legacyDigest, functions: manifests }, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'cloudbaserc.json'), JSON.stringify({ envId: info.environmentId, region: info.region,
        functionRoot: '.', functions: functions.map(func => ({ name: func.name, runtime: 'Nodejs20.19', handler: 'index.main', installDependency: true })) }, null, 2) + '\n');
    return { output, ...info, functions: functions.map(func => func.name), modules: compiled.size, sha256: digest };
}
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length > 2 || args[1] && args[1] !== '--compatibility') throw Error('用法：pnpm cloud:build [development|production] [--compatibility]');
    console.log(JSON.stringify(build(undefined, { target: args[0], compatibility: args[1] === '--compatibility' }), null, 2));
}
module.exports = { build };
