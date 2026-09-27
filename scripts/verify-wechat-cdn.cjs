'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { createHash } = require('node:crypto');

// 使用本地发布清单核验公开下载，不读取浏览器登录态或云密钥。
function verifyFile(url, entry) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { headers: { 'Accept-Encoding': 'identity' } }, response => {
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            let size = 0;
            const hash = createHash('sha256');
            response.on('data', chunk => {
                size += chunk.length;
                if (size > entry.size) response.destroy(new Error('响应超过清单大小'));
                else hash.update(chunk);
            });
            response.on('error', reject);
            response.on('end', () => {
                if (size !== entry.size || hash.digest('hex') !== entry.sha256) reject(new Error('大小或 SHA-256 不符'));
                else resolve();
            });
        });
        request.setTimeout(20000, () => request.destroy(new Error('下载超时')));
        request.on('error', reject);
    });
}

function validateManifest(manifest) {
    const base = new URL(manifest.server);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) throw new Error('发布地址必须为无凭据的 HTTPS 目录');
    if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('发布清单为空');
    for (const entry of manifest.files) {
        // Creator 的字体 MD5 位于目录名中：native/xx/uuid.hash/font.ttf。
        // 每段分别检查，允许目录后缀，同时拒绝路径穿越、空段和 URL 控制字符。
        const segments = typeof entry?.path === 'string' ? entry.path.split('/') : [];
        if (segments.length < 3 || segments[0] !== 'remote'
            || !segments.every(segment => /^[a-zA-Z0-9_@-]+(?:\.[a-zA-Z0-9_@-]+)*$/.test(segment))
            || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
            throw new Error(`发布清单文件条目无效：${JSON.stringify(entry?.path ?? null)}`);
        }
    }
    return base;
}

async function verifyRelease(manifest, { download = verifyFile, log = console.log } = {}) {
    const base = validateManifest(manifest);
    let next = 0;
    let passed = 0;
    const failures = [];
    const started = Date.now();
    await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < manifest.files.length) {
            const entry = manifest.files[next++];
            let failure;
            for (let attempt = 0; attempt < 2; attempt++) {
                try { await download(new URL(entry.path, base), entry); failure = null; break; }
                catch (error) { failure = error.message; }
            }
            if (failure) failures.push({ path: entry.path, error: failure });
            else passed++;
            if ((passed + failures.length) % 100 === 0) log(`已检查 ${passed + failures.length}/${manifest.files.length}，失败 ${failures.length}`);
        }
    }));
    log(JSON.stringify({ clientVersion: manifest.clientVersion || manifest.version, files: manifest.files.length, passed, failures, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
    if (failures.length) throw new Error(`${failures.length} 个 CDN 文件验证失败`);
}
module.exports = { validateManifest, verifyRelease };
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        if (args.length !== 1) throw new Error('用法：node scripts/verify-wechat-cdn.cjs <本地 release-manifest.json>');
        await verifyRelease(JSON.parse(fs.readFileSync(path.resolve(args[0]), 'utf8')));
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
