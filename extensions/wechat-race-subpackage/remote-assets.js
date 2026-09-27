'use strict';
const { settingsFile } = require('./build-layout');

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const BUNDLES = ['ui'];
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

const isClientVersion = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(value);
function readClientVersion(projectRoot) {
    const { clientVersion } = read(path.join(projectRoot, 'config/game-versions.json'));
    if (!isClientVersion(clientVersion)) throw Error('[remote-assets] 请在 config/game-versions.json 填写合法的 clientVersion；不会自动生成版本号。');
    return clientVersion;
}

function readRemoteConfig(projectRoot) {
    const config = read(path.join(projectRoot, 'config/build/wechat-remote-assets.json'));
    const url = new URL(config.origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.pathname !== '/' || !/^[a-z0-9][a-z0-9-]*$/.test(config.prefix)
        || JSON.stringify(config.bundles) !== JSON.stringify(BUNDLES) || typeof config.enabled !== 'boolean'
        || (config.autoUpload !== undefined && typeof config.autoUpload !== 'boolean')) {
        throw Error('[remote-assets] 远程配置必须使用 HTTPS 域名、独立目录和 ui 资源包。');
    }
    return { ...config, origin: url.origin };
}

function listFiles(root) {
    const files = [];
    function visit(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) throw Error('[remote-assets] 发布目录不允许符号链接。');
            if (entry.isDirectory()) visit(file);
            else if (entry.isFile()) files.push(path.relative(root, file).split(path.sep).join('/'));
        }
    }
    visit(root);
    return files.sort();
}

/** 将已验证的 Creator 微信构建转换为引擎原生远程 Bundle 布局；脚本始终留在微信包。 */
function exportRemoteAssets(projectRoot, outputRoot, config = readRemoteConfig(projectRoot)) {
    const clientVersion = readClientVersion(projectRoot);
    const settingsPath = settingsFile(outputRoot);
    const gamePath = path.join(outputRoot, 'game.json');
    const settings = read(settingsPath), game = read(gamePath);
    if (settings.assets?.remoteBundles?.some(name => BUNDLES.includes(name))) {
        throw Error('[remote-assets] 请从完整本地构建重新导出，不能重复转换远程包。');
    }
    if (settings.assets?.server || settings.assets?.remoteBundles?.length) {
        throw Error('[remote-assets] 已有其他远程服务配置，拒绝覆盖。');
    }
    const files = [], scripts = [];
    for (const name of BUNDLES) {
        const root = path.join(outputRoot, 'subpackages', name);
        const version = settings.assets.bundleVers?.[name];
        if (!version) throw Error(`[remote-assets] ${name} 缺少 Cocos MD5 缓存标识，请启用 MD5 Cache 重新构建。`);
        const suffix = `${version}.`;
        const configName = `config.${suffix}json`, scriptName = `index.${suffix}js`;
        const bundle = read(path.join(root, configName));
        if (bundle.name !== name || bundle.isZip || !settings.assets.subpackages?.includes(name)
            || !game.subpackages?.some(p => p.name === name && p.root === `subpackages/${name}/`)) {
            throw Error(`[remote-assets] ${name} 必须来自完整且未打整包 ZIP 的本地资源分包。`);
        }
        for (const relative of listFiles(root)) {
            const source = path.join(root, relative);
            if (relative === 'game.js') continue;
            const bytes = fs.readFileSync(source);
            const entry = { path: `remote/${name}/${relative}`, size: bytes.length, sha256: sha(bytes), source };
            if (relative === scriptName) scripts.push({ ...entry, path: `src/bundle-scripts/${name}/${relative}` });
            else {
                if (relative !== configName && !/^(import|native)\//.test(relative)) {
                    throw Error(`[remote-assets] 资源目录出现未识别文件：${name}/${relative}`);
                }
                if (/\.(js|ts|map|psd|blend|pvr|pkm)$/i.test(relative)) throw Error(`[remote-assets] 禁止发布文件：${relative}`);
                files.push(entry);
            }
        }
        if (!scripts.some(entry => entry.path === `src/bundle-scripts/${name}/${scriptName}`)) throw Error(`[remote-assets] ${name} 缺少本地脚本入口。`);
    }
    const metadata = files.map(({ source, ...entry }) => entry);
    const localScripts = scripts.map(({ source, ...entry }) => entry);
    // 摘要只检查本次构建的一致性；发布目录唯一由负责人填写的 clientVersion 决定。
    const contentHash = sha(JSON.stringify({ files: metadata, scripts: localScripts }));
    const server = `${config.origin}/${config.prefix}/${clientVersion}/`;
    const publishRoot = path.join(projectRoot, 'output/wechat-cdn', config.prefix, clientVersion);
    const manifest = { schema: 2, clientVersion, contentHash, server, bundles: BUNDLES, bytes: files.reduce((sum, f) => sum + f.size, 0), files: metadata, localScripts };
    // 内容地址不可变；先验证已有文件，避免覆盖同版本资源或在失败时破坏本地分包。
    for (const entry of files) {
        const target = path.join(publishRoot, entry.path);
        if (fs.existsSync(target) && sha(fs.readFileSync(target)) !== entry.sha256) throw Error(`[remote-assets] 已有发布文件内容不一致：${entry.path}`);
    }
    // 仅重建自动生成的本地暂存目录；云端旧包引用的文件保持不变。
    fs.rmSync(publishRoot, { recursive: true, force: true });
    for (const entry of files) {
        const target = path.join(publishRoot, entry.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (!fs.existsSync(target)) fs.copyFileSync(entry.source, target, fs.constants.COPYFILE_EXCL);
    }
    write(path.join(publishRoot, 'release-manifest.json'), manifest);
    for (const entry of scripts) {
        const target = path.join(outputRoot, entry.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(entry.source, target);
    }
    write(path.join(outputRoot, 'src/cdn-release.json'), { clientVersion, contentHash });
    settings.assets.server = server;
    settings.assets.remoteBundles = BUNDLES.slice();
    settings.assets.subpackages = settings.assets.subpackages.filter(name => !BUNDLES.includes(name));
    game.subpackages = game.subpackages.filter(p => !BUNDLES.includes(p.name));
    write(settingsPath, settings); write(gamePath, game);
    for (const name of BUNDLES) fs.rmSync(path.join(outputRoot, 'subpackages', name), { recursive: true });
    return { ...manifest, publishRoot };
}

function assertRemoteOutput(outputRoot) {
    const settings = read(settingsFile(outputRoot));
    const remote = settings.assets?.remoteBundles || [];
    if (!remote.length) return null;
    if (JSON.stringify(remote) !== JSON.stringify(BUNDLES)) throw Error('[remote-assets] 远程资源布局已变更，请重新构建；仅 UI 使用 CDN，角色、动作和场馆必须留在微信分包。');
    if (!BUNDLES.every(name => remote.includes(name)) || !/^https:\/\/.+\/[A-Za-z0-9][A-Za-z0-9._-]{0,31}\/$/.test(settings.assets.server || '')) {
        throw Error('[remote-assets] 远程资源缺少完整 Bundle 配置或固定版本地址。');
    }
    const game = read(path.join(outputRoot, 'game.json'));
    for (const name of ['race', 'music']) {
        const version = settings.assets.bundleVers?.[name];
        const root = path.join(outputRoot, 'subpackages', name);
        if (!settings.assets.subpackages?.includes(name)
            || !game.subpackages?.some(p => p.name === name && p.root === `subpackages/${name}/`)
            || !['game.js', `config.${version}.json`, `index.${version}.js`].every(file => fs.existsSync(path.join(root, file)))) {
            throw Error(`[remote-assets] ${name} 必须保留为完整微信分包，请重新构建。`);
        }
    }
    for (const name of BUNDLES) {
        const version = settings.assets.bundleVers?.[name];
        if (settings.assets.subpackages?.includes(name) || game.subpackages?.some(p => p.name === name)
            || fs.existsSync(path.join(outputRoot, 'subpackages', name)) || fs.existsSync(path.join(outputRoot, 'assets', name))
            || !fs.existsSync(path.join(outputRoot, 'src/bundle-scripts', name, `index.${version ? `${version}.` : ''}js`))) {
            throw Error(`[remote-assets] ${name} 资源必须移出微信包，脚本入口必须保留本地。`);
        }
    }
    if (fs.existsSync(path.join(outputRoot, 'remote'))) throw Error('[remote-assets] 远程资源不能留在微信上传目录。');
    const marker = read(path.join(outputRoot, 'src/cdn-release.json'));
    if (!isClientVersion(marker.clientVersion) || !/^[a-f0-9]{64}$/.test(marker.contentHash)
        || !settings.assets.server.endsWith(`/${marker.clientVersion}/`)) throw Error('[remote-assets] 构建中的客户端版本与 CDN 地址不一致。');
    return { server: settings.assets.server, bundles: BUNDLES, ...marker };
}

module.exports = { readClientVersion, isClientVersion, readRemoteConfig, exportRemoteAssets, assertRemoteOutput, listFiles };
