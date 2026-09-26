'use strict';
// 只递归编译实际运行依赖；禁止把 cc、资源或客户端 SDK 打进云函数。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
function build(output = path.join(root, 'cloud/functions')) {
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
    for (const kind of ['player', 'admin']) {
        const directory = path.join(output, `swimming-${kind}`);
        fs.mkdirSync(directory, { recursive: true });
        // 清理仅由本脚本生成的规则目录，防止已移除的旧规则留在部署包中。
        fs.rmSync(path.join(directory, 'rules'), { recursive: true, force: true });
        for (const [relative, code] of compiled) {
            const target = path.join(directory, 'rules', relative + '.js');
            fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, code);
        }
        fs.copyFileSync(path.join(root, 'cloud/src', `${kind}-entry.cjs`), path.join(directory, 'index.js'));
        fs.copyFileSync(path.join(root, 'cloud/src/service.cjs'), path.join(directory, 'service.cjs'));
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `swimming-${kind}`, version: '1.0.0',
            private: true, main: 'index.js', dependencies: { 'wx-server-sdk': '3.0.1',
                ...(kind === 'admin' ? { '@cloudbase/node-sdk': '3.18.3' } : {}) } }, null, 2) + '\n');
        fs.writeFileSync(path.join(directory, 'rules-manifest.json'), JSON.stringify({ typescript: ts.version,
            sha256: digest, modules: [...compiled.keys()].sort() }, null, 2) + '\n');
    }
    return { output, modules: compiled.size, sha256: digest };
}
if (require.main === module) console.log(JSON.stringify(build(), null, 2));
module.exports = { build };
