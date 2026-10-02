'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { visitTargetImages, resolveRawAssetPaths, inspectAstcMipChain } = require('./texture-mipmap-policy');
const run = promisify(execFile);

// Creator 3.8.8 的 gltf-embeded-image 不提供独立 image 导入器的离线 mip 文件。
// 在 JSON 压缩及 MD5 命名前，使用 Creator 自带工具补齐构建输出；不改 GLB、UUID 或回退图。
function editorTools() {
    const resources = process.resourcesPath || path.join(path.dirname(process.execPath), 'resources');
    const sharp = require(path.join(resources, 'app.asar', 'node_modules', 'sharp'));
    const astcEncoder = path.join(resources, 'tools', 'astc-encoder',
        process.platform === 'win32' ? 'astcenc.exe' : 'astcenc');
    if (!fs.existsSync(astcEncoder)) throw new Error(`[embedded-mipmap] 找不到 Creator ASTC 编码器：${astcEncoder}`);
    return { sharp, astcEncoder };
}

function packMipLevels(layers) {
    const header = Buffer.alloc(8 + layers.length * 4);
    header.writeUInt32LE(0x50494d43);
    header.writeUInt32LE(layers.length, 4);
    layers.forEach((layer, i) => header.writeUInt32LE(layer.length, 8 + i * 4));
    const packed = Buffer.concat([header, ...layers]);
    inspectAstcMipChain(packed);
    return packed;
}

function resolveEmbeddedSource(projectRoot, image) {
    const sourceBase = path.join(projectRoot, 'library', image.uuid.slice(0, 2), image.uuid);
    // GLB 重导入为 PNG 后，library 中可能仍残留旧 JPG。
    // 当前子资源的 files 是导入器声明；不能按目录中有几种后缀判断当前原图。
    const declared = (image.files || []).filter(ext => /^\.(png|jpe?g)$/i.test(ext));
    if (declared.length) {
        if (declared.length !== 1 || !fs.existsSync(sourceBase + declared[0])) {
            throw new Error(`[embedded-mipmap] 当前导入记录的原图缺失或不唯一：${sourceBase}；声明：${declared.join(', ')}`);
        }
        return sourceBase + declared[0];
    }
    // 兼容没有 files 字段的导入记录，只有确实唯一时才使用目录回退。
    const sources = ['.png', '.jpg', '.jpeg'].map(ext => sourceBase + ext).filter(f => fs.existsSync(f));
    if (sources.length !== 1) throw new Error(`[embedded-mipmap] 内嵌贴图导入原图缺失或不唯一：${sourceBase}`);
    return sources[0];
}

async function bakeEmbeddedTextureMipmaps(projectRoot, result, suppliedTools) {
    const targets = [];
    visitTargetImages(projectRoot, target => {
        if (target.expected === 'linear' && target.image.importer === 'gltf-embeded-image'
            && target.image.userData?.compressSettings?.useCompressTexture === true
            && result.containsAsset(target.image.uuid)) targets.push(target);
        return false;
    });
    const presets = JSON.parse(fs.readFileSync(path.join(projectRoot, 'settings/v2/packages/builder.json'), 'utf8'))
        .textureCompressConfig;
    if (targets.length && presets.genMipmaps !== true) throw new Error('[embedded-mipmap] 压缩纹理 genMipmaps 必须开启。');
    let tools;
    let generated = 0, cached = 0, unchanged = 0;
    for (const { image, relativeMeta } of targets) {
        const raw = resolveRawAssetPaths(result, image.uuid);
        const files = raw.filter(file => path.extname(file).toLowerCase() === '.astc');
        if (!files.length || !raw.some(file => /\.(png|jpe?g)$/i.test(file) && fs.existsSync(file))) {
            throw new Error(`[embedded-mipmap] ${relativeMeta} :: ${image.name} 缺少 ASTC 或 PNG/JPG 回退。`);
        }
        for (const file of files) {
            const outputRoot = path.resolve(result.dest) + path.sep;
            if (!path.resolve(file).startsWith(outputRoot)) throw new Error(`[embedded-mipmap] 输出路径超出构建目录：${file}`);
            const base = fs.readFileSync(file);
            if (base.length >= 4 && base.readUInt32LE(0) === 0x50494d43) {
                inspectAstcMipChain(base);
                unchanged++;
                continue;
            }
            if (base.length < 16 || base.readUInt32LE(0) !== 0x5ca1ab13) {
                throw new Error(`[embedded-mipmap] ${image.name} 的 ASTC 基础层损坏。`);
            }
            const width = base.readUIntLE(7, 3), height = base.readUIntLE(10, 3);
            const block = `${base[4]}x${base[5]}`;
            const format = presets.userPreset[image.userData.compressSettings.presetId]?.options?.miniGame;
            const quality = format?.[`astc_${block}`]?.quality;
            if (!['veryfast', 'fast', 'medium', 'thorough', 'exhaustive'].includes(quality)) {
                throw new Error(`[embedded-mipmap] ${image.name} 的 ASTC 块尺寸与压缩预设不匹配。`);
            }
            const source = resolveEmbeddedSource(projectRoot, image);
            const sourceBytes = fs.readFileSync(source);
            const digest = crypto.createHash('sha256').update('embedded-mipmap-v1/lanczos3')
                .update(sourceBytes).update(base).update(quality).digest('hex');
            const workDir = path.join(projectRoot, 'temp/builder/EmbeddedAstcMipmaps', digest);
            const cacheFile = path.join(workDir, 'complete.astc');
            if (fs.existsSync(cacheFile)) {
                const packed = fs.readFileSync(cacheFile);
                const info = inspectAstcMipChain(packed);
                if (info.width !== width || info.height !== height) throw new Error('[embedded-mipmap] 缓存尺寸不符。');
                fs.writeFileSync(file, packed);
                cached++;
                continue;
            }
            tools = tools || suppliedTools || editorTools();
            const info = await tools.sharp(sourceBytes).metadata();
            if (info.width !== width || info.height !== height) {
                throw new Error(`[embedded-mipmap] ${image.name} 的基础层与原图尺寸不符。`);
            }
            fs.mkdirSync(workDir, { recursive: true });
            const layers = [base];
            for (let w = width, h = height, level = 1; w > 1 || h > 1; level++) {
                w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2));
                const png = path.join(workDir, `${level}.png`);
                const astc = path.join(workDir, `${level}.astc`);
                await tools.sharp(sourceBytes).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png().toFile(png);
                await run(tools.astcEncoder, ['-cl', png, astc, block, `-${quality}`, '-j', '2'],
                    { windowsHide: true, maxBuffer: 1024 * 1024 });
                layers.push(fs.readFileSync(astc));
            }
            const packed = packMipLevels(layers);
            fs.writeFileSync(cacheFile, packed);
            fs.writeFileSync(file, packed);
            generated++;
        }
    }
    return { generated, cached, unchanged };
}

module.exports = { bakeEmbeddedTextureMipmaps, packMipLevels, resolveEmbeddedSource };
