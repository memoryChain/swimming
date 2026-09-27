'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { createHash } = require('node:crypto');
const { validateManifest, verifyRelease } = require('./verify-wechat-cdn.cjs');
const { isClientVersion } = require('../extensions/wechat-race-subpackage/remote-assets');
const receiptName = name => /^release-verified(?:\.[a-f0-9]{64})?\.json$/.test(name);
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const etag = object => String(object?.ETag || '').replace(/^"|"$/g, '').toLowerCase();
const matches = (object, entry) => !!object && Number(object.Size) === entry.size && etag(object) === (entry.etag || entry.md5);
// COS 分片上传的 ETag 不是文件 MD5，首次必须下载校验后才可记录复用。
const multipart = (object, entry) => !!object && Number(object.Size) === entry.size
    && /^[a-f0-9]{32}-[1-9][0-9]*$/.test(etag(object));
const safePath = value => typeof value === 'string' && /^remote\/[a-zA-Z0-9_/@.-]+$/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..');

function download(url, maxBytes = 2 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'Accept-Encoding': 'identity' } }, res => {
            if (res.statusCode !== 200) { res.resume(); reject(new Error(`CDN 发布记录读取失败：HTTP ${res.statusCode}`)); return; }
            const chunks = []; let size = 0;
            res.on('data', chunk => { size += chunk.length; if (size > maxBytes) res.destroy(new Error('CDN 发布记录过大')); else chunks.push(chunk); });
            res.on('error', reject); res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.setTimeout(20000, () => req.destroy(new Error('CDN 发布记录读取超时')));
        req.on('error', reject);
    });
}

async function createStore(config) {
    // 与官方 CLI 使用同一登录态；只刷新既有授权，不弹出新授权或输出凭据。
    const { getCredentialWithoutCheck } = require('@cloudbase/toolbox');
    const CloudBase = require('@cloudbase/manager-node');
    const credential = await getCredentialWithoutCheck();
    if (!credential?.secretId || !credential?.secretKey) throw new Error('云端授权失效，请执行 pnpm cdn:login 后重试。');
    const storage = new CloudBase({ envId: config.envId, region: config.region,
        secretId: credential.secretId, secretKey: credential.secretKey, token: credential.token }).storage;
    return {
        list: prefix => storage.listDirectoryFiles(prefix),
        upload: (file, key) => storage.uploadFile({ localPath: file, cloudPath: key }),
        copy: (source, target) => storage.copyFile({ sourcePath: source, destPath: target, skipExisting: true }),
        read: key => download(`${config.origin}/${key}`),
    };
}

async function parallel(items, action, limit = 8) {
    let next = 0, failure;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (!failure && next < items.length) {
            const item = items[next++];
            try { await action(item); } catch (error) { failure ||= error; }
        }
    }));
    if (failure) throw failure;
}

function parseReceipt(bytes, object, version, config) {
    if (!matches(object, { size: bytes.length, md5: hash(bytes, 'md5') })) throw new Error('云端发布记录与存储元数据不一致，请重试。');
    const receipt = JSON.parse(bytes.toString('utf8'));
    if (![1, 2].includes(receipt.schema) || receipt.envId !== config.envId || (receipt.clientVersion || receipt.version) !== version
        || (receipt.schema === 2 && !/^[a-f0-9]{64}$/.test(receipt.contentHash))
        || !/^[a-f0-9]{64}$/.test(receipt.manifestSha256) || !Array.isArray(receipt.files)
        || !receipt.files.length || receipt.files.some(e => !safePath(e.path) || !Number.isSafeInteger(e.size) || e.size < 0
            || !/^[a-f0-9]{64}$/.test(e.sha256) || !/^[a-f0-9]{32}$/.test(e.md5)
            || (e.etag !== undefined && !/^[a-f0-9]{32}-[1-9][0-9]*$/.test(e.etag)))
        || new Set(receipt.files.map(e => e.path)).size !== receipt.files.length) throw new Error('云端发布记录格式无效。');
    return receipt;
}

async function publishIncremental(release, { store, verify = verifyRelease, log = console.log, forceVerify = false } = {}) {
    const { config, manifest, publishRoot, cloudPath } = release;
    validateManifest(manifest);
    store ||= await createStore(config);
    const files = manifest.files.map(e => ({ ...e, md5: hash(fs.readFileSync(path.join(publishRoot, e.path)), 'md5') }));
    const manifestBytes = fs.readFileSync(path.join(publishRoot, 'release-manifest.json'));
    const manifestSha256 = hash(manifestBytes);
    const receiptFile = `release-verified.${manifest.contentHash}.json`;
    const receiptKey = `${cloudPath}/${receiptFile}`;
    log('正在比对云端文件和已验证发布记录…');
    let objects = new Map((await store.list(`${cloudPath}/`)).map(o => [o.Key, o]));
    const proof = new Map();
    const accepted = new Set();
    async function acceptReceipt(object, version) {
        if (accepted.has(object.Key)) return;
        accepted.add(object.Key);
        const receipt = parseReceipt(await store.read(object.Key), object, version, config);
        if (object.Key === receiptKey && receipt.manifestSha256 !== manifestSha256) throw new Error('同版本发布记录与本地清单不一致，拒绝覆盖。');
        for (const entry of receipt.files) {
            const key = `${config.prefix}/${version}/${entry.path}`;
            if (matches(objects.get(key), entry)) proof.set(key, entry);
        }
    }
    // 同一客户端版本可能反复构建。资源共用目录，小清单按内容摘要区分，旧包仍可读取原资源。
    for (const object of objects.values()) {
        const name = object.Key.slice(cloudPath.length + 1);
        if (receiptName(name)) await acceptReceipt(object, manifest.clientVersion);
    }
    // 只有目标缺文件时才读取历史版本。已有版本的重复构建无需扫描全部历史资源。
    if (files.some(e => !objects.has(`${cloudPath}/${e.path}`))) {
        objects = new Map((await store.list(`${config.prefix}/`)).map(o => [o.Key, o]));
        const receipts = [...objects.values()].filter(o => {
            const parts = o.Key.split('/');
            return parts.length === 3 && parts[0] === config.prefix && isClientVersion(parts[1])
                && receiptName(parts[2]) && o.Key !== receiptKey;
        }).sort((a, b) => String(b.LastModified).localeCompare(String(a.LastModified)));
        for (const object of receipts) await acceptReceipt(object, object.Key.split('/')[1]);
    }
    const sources = new Map();
    for (const [key, entry] of proof) sources.set(`${entry.sha256}:${entry.size}:${entry.md5}`, key);
    const uploads = [], copies = [], checks = [];
    let skipped = 0;
    for (const entry of files) {
        const key = `${cloudPath}/${entry.path}`, target = objects.get(key), verified = proof.get(key);
        const known = verified?.sha256 === entry.sha256 && matches(target, verified);
        if (target && !matches(target, entry) && !known && !multipart(target, entry)) throw new Error(`不可变版本的云端文件内容不符，拒绝覆盖：${entry.path}`);
        if (target) {
            skipped++;
            if (!known) checks.push(entry);
        } else {
            const source = sources.get(`${entry.sha256}:${entry.size}:${entry.md5}`);
            if (source) copies.push({ entry, source, key });
            else { uploads.push({ entry, key }); checks.push(entry); }
        }
    }
    const uploadBytes = uploads.reduce((sum, item) => sum + item.entry.size, 0);
    log(`增量计划：跳过 ${skipped} 个，云端复用 ${copies.length} 个，上传 ${uploads.length} 个（${uploadBytes} 字节）。`);
    const manifestEntry = { size: manifestBytes.length, md5: hash(manifestBytes, 'md5') };
    const manifestKey = `${cloudPath}/release-manifest.${manifest.contentHash}.json`;
    if (objects.has(manifestKey) && !matches(objects.get(manifestKey), manifestEntry)) throw new Error('云端版本清单不一致，拒绝覆盖。');
    let completed = 0;
    await parallel([...copies.map(item => ({ ...item, type: 'copy' })), ...uploads.map(item => ({ ...item, type: 'upload' }))], async item => {
        if (item.type === 'copy') await store.copy(item.source, item.key);
        else await store.upload(path.join(publishRoot, item.entry.path), item.key);
        completed++;
        if (completed % 100 === 0) log(`已处理 ${completed}/${copies.length + uploads.length} 个资源。`);
    });
    if (!objects.has(manifestKey)) await store.upload(path.join(publishRoot, 'release-manifest.json'), manifestKey);
    // 上传/云端复制完成后重新检查目标，不能仅凭 API 返回成功就放行。
    if (uploads.length || copies.length || !objects.has(manifestKey)) {
        objects = new Map((await store.list(`${cloudPath}/`)).map(o => [o.Key, o]));
    }
    for (const entry of files) {
        const key = `${cloudPath}/${entry.path}`, target = objects.get(key), verified = proof.get(key);
        if (matches(target, entry) || (verified?.sha256 === entry.sha256 && matches(target, verified))) continue;
        if (multipart(target, entry)) checks.push(entry);
        else throw new Error(`发布后存储校验失败：${entry.path}`);
    }
    if (!matches(objects.get(manifestKey), manifestEntry)) throw new Error('发布后清单校验失败。');
    // 复用项已有 SHA-256 验证记录，且复制前后的存储 MD5 相同。只下载新增/未验证项；
    // 每次仍检查远程 Bundle 配置的公开访问，避免把登录态可读误当作游戏可下载。
    const probeFiles = files.filter(e => /^remote\/[^/]+\/config\.[^/]*json$/.test(e.path));
    const verifyFiles = forceVerify ? files : [...new Map([...checks, ...probeFiles].map(e => [e.path, e])).values()];
    log(`资源已就绪，正在公开下载校验 ${verifyFiles.length}/${files.length} 个文件（其余复用已验证记录）。`);
    if (verifyFiles.length) await verify({ ...manifest, files: verifyFiles });
    const receiptFiles = files.map(entry => {
        const objectEtag = etag(objects.get(`${cloudPath}/${entry.path}`));
        return objectEtag === entry.md5 ? entry : { ...entry, etag: objectEtag };
    });
    const receiptBytes = Buffer.from(JSON.stringify({ schema: 2, envId: config.envId, clientVersion: manifest.clientVersion, contentHash: manifest.contentHash, manifestSha256, files: receiptFiles }) + '\n');
    const receiptObject = objects.get(receiptKey);
    if (receiptObject && !matches(receiptObject, { size: receiptBytes.length, md5: hash(receiptBytes, 'md5') })) throw new Error('已有发布完成记录内容不同，拒绝覆盖。');
    if (!receiptObject) {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-cdn-receipt-'));
        try {
            const file = path.join(temp, receiptFile); fs.writeFileSync(file, receiptBytes);
            // 最后写入完成记录；中途失败的发布永远不会被视为已验证版本。
            await store.upload(file, receiptKey);
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    }
    const publicReceipt = await store.read(receiptKey);
    if (!publicReceipt.equals(receiptBytes)) throw new Error('发布完成记录公开下载校验失败。');
    const result = { skipped, copied: copies.length, uploaded: uploads.length, uploadBytes, verified: verifyFiles.length };
    log(`增量发布完成：上传 ${result.uploaded} 个，云端复用 ${result.copied} 个，跳过 ${result.skipped} 个。`);
    return result;
}
module.exports = { publishIncremental, createStore };
