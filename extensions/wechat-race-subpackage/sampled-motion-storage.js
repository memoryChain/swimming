'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

// 只改变存储布局。禁止四舍五入、量化、插值、删帧或改变四元数符号。
function encodeSampledMotion(data) {
    if (data.$motion || !Array.isArray(data.samples) || !data.samples.length) {
        throw new Error(`[motion-storage] Invalid source motion: ${data.id}`);
    }
    const fields = Object.keys(data.samples[0]);
    const bones = Object.keys(data.samples[0].rotations);
    for (const sample of data.samples) {
        if (!isDeepStrictEqual(Object.keys(sample), fields)
            || !isDeepStrictEqual(Object.keys(sample.rotations), bones)
            || bones.some((bone) => !Array.isArray(sample.rotations[bone])
                || sample.rotations[bone].length !== 4
                || sample.rotations[bone].some((number) => !Number.isFinite(number)))) {
            throw new Error(`[motion-storage] Inconsistent sample schema: ${data.id}`);
        }
    }
    const constants = {};
    const varying = [];
    for (const bone of bones) {
        const first = data.samples[0].rotations[bone];
        if (data.samples.every((sample) => isDeepStrictEqual(sample.rotations[bone], first))) {
            constants[bone] = first;
        } else {
            varying.push(bone);
        }
    }
    return {
        ...data,
        $motion: { version: 1, fields, bones, constants },
        samples: data.samples.map((sample) => fields.map((field) => field === 'rotations'
            ? varying.flatMap((bone) => sample.rotations[bone]) : sample[field])),
    };
}

function readSourceMotions(projectRoot) {
    const directory = path.join(projectRoot, 'assets/race/model-actions/tPose');
    const motions = new Map();
    for (const name of fs.readdirSync(directory).sort()) {
        if (!name.endsWith('.json')) continue;
        // Creator 序列化 JsonAsset 时会把 -0 写为 0。按同样的 JSON 语义比较，
        // 不把这一既有行为误判为缓存过期；其余数值与字段必须完全一致。
        const data = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))));
        // divePrep 是单个静态姿态，保持原样。
        if (!Array.isArray(data.samples)) continue;
        if (motions.has(data.id)) throw new Error(`[motion-storage] Duplicate source id: ${data.id}`);
        motions.set(data.id, data);
    }
    if (!motions.size) throw new Error('[motion-storage] No source motions');
    return motions;
}

function compactBuiltMotions(projectRoot, outputRoot, { checkOnly = false, backupRoot } = {}) {
    const sources = readSourceMotions(projectRoot);
    const encoded = new Map([...sources].map(([id, source]) => [id, encodeSampledMotion(source)]));
    const seen = new Set();
    const changes = [];
    let beforeBytes = 0, afterBytes = 0;
    function transform(value) {
        if (!value || typeof value !== 'object') return value;
        const source = sources.get(value.id);
        if (source && value.sourceFile === source.sourceFile && Array.isArray(value.samples)) {
            // 防止误处理 Cocos 序列化外壳或未更新的动作构建缓存。
            const compact = encoded.get(value.id);
            if (!isDeepStrictEqual(value, source) && !isDeepStrictEqual(value, compact)) {
                throw new Error(`[motion-storage] Built motion differs from source: ${value.id}`);
            }
            seen.add(value.id);
            return compact;
        }
        for (const key of Object.keys(value)) value[key] = transform(value[key]);
        return value;
    }
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(file);
            else if (entry.isFile() && entry.name.endsWith('.json')) {
                const original = fs.readFileSync(file, 'utf8');
                const data = JSON.parse(original);
                const before = JSON.stringify(data);
                const after = JSON.stringify(transform(data));
                if (after !== before) {
                    changes.push({ file, content: after });
                    beforeBytes += Buffer.byteLength(original);
                    afterBytes += Buffer.byteLength(after);
                }
            }
        }
    }
    visit(path.join(outputRoot, 'subpackages/race/import'));
    const missing = [...sources.keys()].filter((id) => !seen.has(id));
    if (missing.length) throw new Error(`[motion-storage] Missing built motions: ${missing.join(', ')}`);
    // 全部动作核验成功后才写入；源 JSON、UUID 和 Cocos 的依赖/版本索引保持原样。
    if (!checkOnly) {
        // 独立后处理保留修改前的构建数据；全部备份成功后才替换文件。
        if (backupRoot) {
            for (const change of changes) {
                const backup = path.join(backupRoot, path.relative(outputRoot, change.file));
                fs.mkdirSync(path.dirname(backup), { recursive: true });
                fs.copyFileSync(change.file, backup, fs.constants.COPYFILE_EXCL);
            }
        }
        for (const change of changes) fs.writeFileSync(change.file, change.content, 'utf8');
    }
    return { motions: seen.size, files: changes.length, beforeBytes, afterBytes, savedBytes: beforeBytes - afterBytes };
}

function assertBuiltMotionStorage(projectRoot, outputRoot) {
    const audit = compactBuiltMotions(projectRoot, outputRoot, { checkOnly: true });
    if (audit.files) {
        throw new Error(`[motion-storage] ${audit.motions} 个动作的构建后处理尚未完成，可无损减少 ${(audit.savedBytes / 1024).toFixed(1)} KiB。`
            + 'Creator 可能仍缓存旧插件；请运行 pnpm wechat:finalize 后再上传。');
    }
    return audit;
}

// 独立后处理不能把压缩数据写入缺少解码器的旧构建。检查实际产物中的
// Cocos 命名模块及加载器依赖；不能仅检查源码目录里有没有解码器。
function assertBuiltMotionRuntime(outputRoot) {
    let decoder = false, loader = false;
    function visit(directory) {
        if (!fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(file);
            else if (entry.isFile() && entry.name.endsWith('.js')) {
                const code = fs.readFileSync(file, 'utf8');
                for (const module of code.split(/System\.register\s*\(/).slice(1)) {
                    if (/^\s*["']chunks:\/\/\/_virtual\/SampledMotionStorage\.ts["']/.test(module)
                        && module.includes('decodeSampledMotion') && module.includes('$motion')
                        && module.includes('Invalid sampled motion storage header')
                        && module.includes('Invalid sampled motion storage row')) decoder = true;
                    if (/^\s*["']chunks:\/\/\/_virtual\/RaceBundleLoader\.ts["']/.test(module)
                        && module.includes('./SampledMotionStorage.ts') && module.includes('decodeSampledMotion')
                        && module.includes('loadRaceAsset') && module.includes('loadRaceAssetDir')) loader = true;
                }
            }
        }
    }
    for (const directory of ['assets', 'subpackages', 'src']) visit(path.join(outputRoot, directory));
    if (!decoder || !loader) {
        throw new Error('[motion-storage] 构建脚本缺少动作解码器或统一加载入口，请先重新构建；未修改动作资源。');
    }
}

module.exports = { encodeSampledMotion, readSourceMotions, compactBuiltMotions, assertBuiltMotionStorage, assertBuiltMotionRuntime };
