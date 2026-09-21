'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_MAIN_BYTES = 4 * 1024 * 1024;
// 按当前项目 30 MiB 额度拦截磁盘总量；它与微信上传统计存在口径差异，
// 达到此检查不等于上传验收，实际产物仍应留出余量。
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set(['.bak', '.blend', '.blend1', '.blendbak', '.psd', '.psb']);

function auditWechatPackageOutput(outputRoot) {
    const resolvedRoot = path.resolve(outputRoot);
    const manifest = JSON.parse(fs.readFileSync(path.join(resolvedRoot, 'game.json'), 'utf8'));
    const subpackageRoots = (manifest.subpackages || []).map(({ root }) => {
        if (typeof root !== 'string' || !root || path.isAbsolute(root) || root.split(/[\\/]/).includes('..')) {
            throw new Error('[wechat-package] Invalid subpackage root');
        }
        return root.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
    });
    const files = [];
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(absolute);
            else if (entry.isFile()) files.push({
                path: path.relative(resolvedRoot, absolute).replace(/\\/g, '/'),
                bytes: fs.statSync(absolute).size,
            });
        }
    }
    visit(resolvedRoot);
    const forbiddenTextures = files.filter((file) => /\.(pvr|pkm)$/i.test(file.path));
    if (forbiddenTextures.length) {
        throw new Error(`[texture-policy] Build emitted unexpected PVR/PKM textures: ${forbiddenTextures.slice(0, 8).map((file) => file.path).join(', ')}. `
            + 'Creator is using stale/default compression presets. Close and reopen Creator, run npm run textures:check, then rebuild.');
    }
    const sourceFiles = files.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file.path).toLowerCase())
        || path.basename(file.path) === '.DS_Store');
    if (sourceFiles.length) {
        throw new Error(`[wechat-package] Source-only files in runtime package: ${sourceFiles.slice(0, 8).map((file) => file.path).join(', ')}`);
    }
    let mainBytes = 0, totalBytes = 0;
    for (const file of files) {
        totalBytes += file.bytes;
        if (!subpackageRoots.some((root) => file.path.startsWith(root))) mainBytes += file.bytes;
    }
    if (mainBytes > MAX_MAIN_BYTES) {
        throw new Error(`[wechat-package] Main package is ${(mainBytes / 1024).toFixed(1)} KiB, exceeding the 4096 KiB limit.`);
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
        const largest = files.sort((a, b) => b.bytes - a.bytes).slice(0, 8)
            .map((file) => `${file.path} (${(file.bytes / 1024).toFixed(1)} KiB)`).join(', ');
        throw new Error(`[wechat-package] Total package is ${(totalBytes / 1024).toFixed(1)} KiB, exceeding the 30720 KiB (30 MiB) limit. Largest files: ${largest}`);
    }
    return { mainBytes, totalBytes, remainingBytes: MAX_TOTAL_BYTES - totalBytes };
}

module.exports = { auditWechatPackageOutput, MAX_MAIN_BYTES, MAX_TOTAL_BYTES };
