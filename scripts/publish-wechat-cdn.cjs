'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readClientVersion, readRemoteConfig, assertRemoteOutput, listFiles } = require('../extensions/wechat-race-subpackage/remote-assets');
const { publishIncremental } = require('./wechat-cdn-incremental.cjs');
const { validateManifest } = require('./verify-wechat-cdn.cjs');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function validateRelease(projectRoot, buildRoot) {
    const config = readRemoteConfig(projectRoot);
    if (!/^[a-z0-9-]+$/.test(config.envId || '') || !/^[a-z]+-[a-z]+$/.test(config.region || '')) throw new Error('请配置 CDN 发布环境和地域');
    const remote = assertRemoteOutput(buildRoot);
    if (!remote) throw new Error('当前构建尚未生成远程资源，请先在 Creator 构建微信小游戏');
    const base = `${config.origin}/${config.prefix}/`;
    if (!remote.server.startsWith(base)) throw new Error('构建资源服务器与项目配置不一致');
    const clientVersion = readClientVersion(projectRoot);
    if (remote.clientVersion !== clientVersion || remote.server !== `${base}${clientVersion}/`) throw new Error('clientVersion 与构建不一致，请重新构建。');
    const publishRoot = path.join(projectRoot, 'output/wechat-cdn', config.prefix, clientVersion);
    const manifest = read(path.join(publishRoot, 'release-manifest.json'));
    if (manifest.schema !== 2 || manifest.clientVersion !== clientVersion || manifest.contentHash !== remote.contentHash || manifest.server !== remote.server || !Array.isArray(manifest.files) || !manifest.files.length || !Array.isArray(manifest.localScripts)) throw new Error('发布清单与构建不匹配');
    if (sha(JSON.stringify({ files: manifest.files, scripts: manifest.localScripts })) !== manifest.contentHash) throw new Error('资源版本内容摘要不符');
    validateManifest(manifest);
    for (const [baseDir, entries, prefix] of [[publishRoot, manifest.files, 'remote/'], [buildRoot, manifest.localScripts, 'src/bundle-scripts/']]) {
        for (const entry of entries) {
            if (typeof entry.path !== 'string' || !entry.path.startsWith(prefix) || entry.path.split('/').some(p => !p || p === '.' || p === '..') || entry.path.includes('\\')) throw new Error('发布文件路径无效');
            const file = path.join(baseDir, entry.path);
            if (fs.lstatSync(file).isSymbolicLink()) throw new Error('发布文件不允许符号链接');
            const bytes = fs.readFileSync(file);
            if (bytes.length !== entry.size || sha(bytes) !== entry.sha256) throw new Error(`构建后文件已变化，请重新构建：${entry.path}`);
        }
    }
    const expected = [...manifest.files.map(e => e.path), 'release-manifest.json'].sort();
    if (JSON.stringify(listFiles(publishRoot)) !== JSON.stringify(expected)) throw new Error('发布目录含清单之外的文件，拒绝上传');
    return { config, manifest, publishRoot, cloudPath: `${config.prefix}/${clientVersion}` };
}

async function main() {
    const args = process.argv.slice(2);
    const checkOnly = args.includes('--check');
    const forceVerify = args.includes('--verify-all');
    const positional = args.filter(arg => !['--check', '--verify-all'].includes(arg));
    if (positional.length > 1 || positional.some(arg => arg.startsWith('-'))) throw new Error('用法：pnpm cdn:publish [构建目录] [--check] [--verify-all]');
    const release = validateRelease(root, path.resolve(root, positional[0] || 'build/wechatgame'));
    console.log(`环境：${release.config.envId}\n资源：${release.cloudPath}\n文件：${release.manifest.files.length}\n大小：${release.manifest.bytes} 字节`);
    if (checkOnly) return;
    await publishIncremental(release, { forceVerify });
    console.log('资源增量发布和完整性检查通过；现在可以在微信开发者工具上传对应代码包。');
}
module.exports = { validateRelease };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
