'use strict';

// 只读审计转换后的开发包。模拟结果用于发现启动盲区，不代表手机实测。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

function auditZip(file, root) {
    const bytes = fs.readFileSync(file), errors = [], seen = new Set();
    let tail = bytes.length - 22;
    while (tail >= Math.max(0, bytes.length - 65557)
        && (bytes.readUInt32LE(tail) !== 0x06054b50 || tail + 22 + bytes.readUInt16LE(tail + 20) !== bytes.length)) tail--;
    if (tail < Math.max(0, bytes.length - 65557)) throw new Error('找不到 ZIP 目录尾');
    const count = bytes.readUInt16LE(tail + 10);
    let offset = bytes.readUInt32LE(tail + 16), files = 0;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let value = i;
        for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : value >>> 1;
        table[i] = value >>> 0;
    }
    for (let i = 0; i < count; i++) {
        if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
        const method = bytes.readUInt16LE(offset + 10), expectedCrc = bytes.readUInt32LE(offset + 16);
        const compressed = bytes.readUInt32LE(offset + 20), uncompressed = bytes.readUInt32LE(offset + 24);
        const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30);
        const commentLength = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42);
        const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
        offset += 46 + nameLength + extraLength + commentLength;
        if (name.endsWith('/')) continue;
        files++;
        if (seen.has(name)) errors.push('ZIP 重复条目：' + name);
        seen.add(name);
        if (bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('ZIP 本地头损坏：' + name);
        const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
        const data = bytes.subarray(start, start + compressed);
        const decoded = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
        if (!decoded) throw new Error('不支持的 ZIP 压缩方式：' + method);
        let crc = 0xffffffff;
        for (const value of decoded) crc = (crc >>> 8) ^ table[(crc ^ value) & 255];
        if (((crc ^ 0xffffffff) >>> 0) !== expectedCrc || decoded.length !== uncompressed) errors.push('ZIP CRC 或大小不符：' + name);
        const absolute = path.resolve(root, name), relative = path.relative(root, absolute);
        if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative === '..') {
            errors.push('ZIP 路径越界：' + name); continue;
        }
        if (!fs.existsSync(absolute) || !fs.readFileSync(absolute).equals(decoded)) errors.push('ZIP 与解包目录不符：' + name);
    }
    for (const entry of scan(root)) if (!seen.has(entry.path)) errors.push('ZIP 缺少目录中的文件：' + entry.path);
    return { bytes: bytes.length, entries: count, files, errors };
}

function scan(root) {
    const files = [];
    function visit(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) visit(file);
            else if (entry.isFile()) files.push({ path: path.relative(root, file).replaceAll('\\', '/'),
                bytes: fs.statSync(file).size,
                sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
        }
    }
    visit(root);
    return files;
}

function decodeUuid(uuid) {
    const parts = uuid.split('@'), encoded = parts[0];
    if (encoded.length !== 22) return uuid;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', hex = '0123456789abcdef';
    let decoded = encoded.slice(0, 2);
    for (let i = 2; i < 22; i += 2) {
        const left = alphabet.indexOf(encoded[i]), right = alphabet.indexOf(encoded[i + 1]);
        if (left < 0 || right < 0) throw new Error('不支持的压缩 UUID');
        decoded += hex[left >> 2] + hex[((left & 3) << 2) | (right >> 4)] + hex[right & 15];
    }
    return decoded.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
        + (parts.length > 1 ? '@' + parts.slice(1).join('@') : '');
}

function bootstrapProbe(source, options = {}) {
    const failures = [], scheduled = [], loads = [], eventCalls = [];
    const global = { fetch: options.fetchAbsent ? undefined : function () {},
        requestAnimationFrame(callback) { scheduled.push(callback); } };
    const context = {
        GameGlobal: global, Error, console: { log() {}, error() {} },
        wx: { getSystemInfoSync() { return { platform: 'android' }; } },
        require(name) {
            loads.push(name);
            if (name === './tap-startup-guard') {
                const boot = require('./templates/taptap-startup-guard');
                return { noopEvents: boot.noopEvents, create(root, config) {
                    return boot.create(root, { ...config, schedule() { return 1; }, cancel() {},
                        log(line) { if (line.includes('[TapBoot] failed')) failures.push(line); } });
                } };
            }
            if (name === './tap-startup-diagnostic') return { failed(error) { failures.push(String(error)); } };
            if (name === './web-adapter' || name === 'src/polyfills.bundle.js' || name === 'src/system.bundle.js') return {};
            if (name === 'src/import-map.js') return { default: {} };
            if (name === './first-screen') {
                const waiting = { then() { return waiting; }, catch() {} };
                return { start() { return waiting; } };
            }
            if (name === './tap-event-config.json') return {};
            if (name === './tap-event-test') return { install() {
                eventCalls.push('install');
                if (options.eventFailure) throw new Error('模拟事件采集安装失败');
            } };
            throw new Error('模拟器不执行引擎：' + name);
        },
    };
    context.canvas = { width: 1280, height: 720 };
    context.window = { devicePixelRatio: 1 };
    context.System = { warmup() {} };
    let thrown = null;
    try { vm.runInNewContext(source, context, { timeout: 1000 }); }
    catch (error) { thrown = String(error); }
    const initScheduled = scheduled.length > 0;
    if (source.includes('bootModule.create') && scheduled.length) {
        try { scheduled.shift()(); } catch (error) { thrown = String(error); }
    }
    return { thrown, caughtByStartupDiagnostic: failures.length > 0,
        initScheduled, eventInstallCalls: eventCalls.length, loadedModules: loads };
}

async function firstScreenProbe(source, options = {}) {
    const frames = [], errors = [], exports = { exports: {} };
    let outcome = 'pending';
    const gl = new Proxy({}, { get(_, key) {
        if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
        if (key === 'clear' && options.drawFailure) return () => { throw new Error('模拟绘制失败'); };
        if (String(key).startsWith('create')) return () => ({});
        return () => undefined;
    } });
    class Image {
        constructor() { this.width = 512; this.height = 128; }
        set src(value) { Promise.resolve().then(() => {
            if (options.imageFailure) this.onerror(new Error('模拟图片加载失败：' + value));
            else this.onload();
        }); }
    }
    const canvas = { width: 1280, height: 720, getContext() { return gl; } };
    vm.runInNewContext(source, { module: exports, window: { canvas, devicePixelRatio: 1 }, canvas,
        Image, Float32Array, Promise, console: { log() {} },
        requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
        cancelAnimationFrame() {} }, { timeout: 1000 });
    try {
        exports.exports.start('default', 'default', 'false')
            .then(() => { outcome = 'fulfilled'; }, error => { outcome = 'rejected'; errors.push(String(error)); });
    } catch (error) { outcome = 'thrown'; errors.push(String(error)); }
    for (let i = 0; i < 8; i++) await Promise.resolve();
    if (!options.frameAbsent && frames.length) {
        try { frames.shift()(); } catch (error) { errors.push(String(error)); }
        for (let i = 0; i < 8; i++) await Promise.resolve();
    }
    return { outcome, queuedFrames: frames.length, errors };
}

async function audit(root, baseline) {
    const files = scan(root), names = new Set(files.map(file => file.path));
    const syntaxErrors = [], jsonErrors = [], manifestErrors = [], bundles = [];
    for (const file of files) {
        const absolute = path.join(root, file.path);
        if (file.path.endsWith('.js')) {
            try { new vm.Script(fs.readFileSync(absolute, 'utf8'), { filename: file.path }); }
            catch (error) { syntaxErrors.push({ path: file.path, error: String(error) }); }
        }
        if (file.path.endsWith('.json')) {
            try { JSON.parse(fs.readFileSync(absolute, 'utf8')); }
            catch (error) { jsonErrors.push({ path: file.path, error: String(error) }); }
        }
    }
    const settings = JSON.parse(fs.readFileSync(path.join(root, 'src/settings.json'), 'utf8'));
    const config = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));
    for (const name of settings.assets.projectBundles) {
        const relative = settings.assets.subpackages.includes(name) ? 'subpackages/' + name : 'assets/' + name;
        const configPath = relative + '/config.json';
        if (!names.has(configPath)) { manifestErrors.push('缺少 Bundle 配置：' + configPath); continue; }
        const bundle = JSON.parse(fs.readFileSync(path.join(root, configPath), 'utf8'));
        const imports = files.filter(file => file.path.startsWith(relative + '/' + bundle.importBase + '/'));
        // 当前适配器将 .cconb 映射为 .bin、.ccon 映射为 .json。
        const importNames = new Set(imports.map(file => path.posix.basename(file.path).replace(/\.(json|ccon|cconb|bin)$/, '')));
        for (const id of Object.keys(bundle.packs)) if (!importNames.has(id)) manifestErrors.push('缺少合并资源：' + name + '/' + id);
        const scenes = [];
        for (const [scene, index] of Object.entries(bundle.scenes)) {
            const uuid = decodeUuid(bundle.uuids[index]);
            const packed = Object.values(bundle.packs).some(indices => indices.includes(index));
            const present = packed || importNames.has(uuid);
            if (!present) manifestErrors.push('缺少场景资源：' + scene);
            scenes.push({ scene, present, packed });
        }
        if (bundle.hasPreloadScript && !names.has(relative + '/index.js')) manifestErrors.push('缺少 Bundle 脚本：' + name);
        const nativeNames = files.filter(file => file.path.startsWith(relative + '/' + bundle.nativeBase + '/'))
            .map(file => path.posix.basename(file.path));
        const packedIndices = new Set(Object.values(bundle.packs).flat());
        const redirects = new Set((bundle.redirect || []).filter((_, index) => index % 2 === 0));
        for (const [indexString, assetPath] of Object.entries(bundle.paths)) {
            const index = Number(indexString), uuid = decodeUuid(bundle.uuids[index]);
            const present = packedIndices.has(index) || redirects.has(index) || importNames.has(uuid)
                || nativeNames.some(file => file.startsWith(uuid + '.'));
            if (!present) manifestErrors.push('声明的资源没有导入或原生文件：' + name + '/' + assetPath[0]);
        }
        bundles.push({ name, files: files.filter(file => file.path.startsWith(relative + '/')).length,
            bytes: files.filter(file => file.path.startsWith(relative + '/')).reduce((sum, file) => sum + file.bytes, 0), scenes });
    }
    for (const subpackage of config.subpackages || []) {
        if (!settings.assets.subpackages.includes(subpackage.name)) manifestErrors.push('分包名称与引擎配置不一致：' + subpackage.name);
        if (!names.has(subpackage.root + 'game.js')) manifestErrors.push('缺少分包入口：' + subpackage.root);
    }
    for (const file of ['game.js', 'application.js', 'first-screen.js', 'web-adapter.js', 'engine-adapter.js',
        'src/import-map.js', 'src/polyfills.bundle.js', 'src/system.bundle.js', 'src/chunks/bundle.js',
        'src/effect.bin', 'cocos-js/cc.js', 'logo.png', 'slogan.png', 'tap-event-test.js', 'tap-event-config.json']) {
        if (!names.has(file)) manifestErrors.push('缺少启动文件：' + file);
    }
    const previous = baseline ? scan(baseline) : [];
    const previousMap = new Map(previous.map(file => [file.path, file]));
    const difference = baseline ? {
        same: files.filter(file => previousMap.get(file.path)?.sha256 === file.sha256).length,
        changed: files.filter(file => previousMap.has(file.path) && previousMap.get(file.path).sha256 !== file.sha256).map(file => file.path),
        added: files.filter(file => !previousMap.has(file.path)).map(file => file.path),
        removed: previous.filter(file => !names.has(file.path)).map(file => file.path),
    } : null;
    const entry = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
    const firstScreen = fs.readFileSync(path.join(root, 'first-screen.js'), 'utf8');
    const eventSource = fs.readFileSync(path.join(root, 'tap-event-test.js'), 'utf8');
    const eventExports = {};
    let prePolyfillFailure = null;
    try {
        vm.runInNewContext(eventSource, { exports: eventExports, WeakMap: undefined,
            setTimeout, console: { log() {} } }, { timeout: 1000 });
        eventExports.install({}, { version: config.productVersion });
    } catch (error) { prePolyfillFailure = String(error); }
    const zipFile = path.join(root, '..', 'game.zip');
    return { version: config.productVersion, scope: '本地文件及模拟环境，未模拟真实 GPU 或 TapTap 宿主',
        zip: fs.existsSync(zipFile) ? auditZip(zipFile, root) : null,
        files: files.length, unpackedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
        jsChecked: files.filter(file => file.path.endsWith('.js')).length,
        jsonChecked: files.filter(file => file.path.endsWith('.json')).length,
        syntaxErrors, jsonErrors, manifestErrors,
        forbiddenTextures: files.filter(file => /\.(?:pvr|pkm)$/.test(file.path)).map(file => file.path),
        remoteBundles: settings.assets.remoteBundles, assetServer: settings.assets.server,
        largestFiles: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 8).map(({ path, bytes }) => ({ path, bytes })),
        bundles, difference,
        probes: {
            entryNormal: bootstrapProbe(entry), entryEventFailure: bootstrapProbe(entry, { eventFailure: true }),
            entryFetchAbsent: bootstrapProbe(entry, { fetchAbsent: true }),
            eventWeakMapAbsent: { error: prePolyfillFailure },
            firstScreenNormal: await firstScreenProbe(firstScreen),
            firstScreenImageFailure: await firstScreenProbe(firstScreen, { imageFailure: true }),
            firstScreenFrameAbsent: await firstScreenProbe(firstScreen, { frameAbsent: true }),
            firstScreenDrawFailure: await firstScreenProbe(firstScreen, { drawFailure: true }),
        },
    };
}

module.exports = { audit, auditZip, bootstrapProbe, firstScreenProbe, decodeUuid };
if (require.main === module) {
    const root = path.resolve(process.argv[2] || 'build/TapEvents-0.0.5/game');
    const baseline = path.resolve(process.argv[3] || 'build/TapDiagnostic-0.0.3/game');
    audit(root, baseline).then(report => console.log(JSON.stringify(report, null, 2)))
        .catch(error => { console.error(error); process.exitCode = 1; });
}
