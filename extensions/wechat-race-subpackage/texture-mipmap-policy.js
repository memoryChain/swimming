'use strict';

const fs = require('fs');
const path = require('path');

// 纯色色板按固定 UV 查表，缩小会混入相邻色带；粒子和动态水面不在本次范围内。
const COLOR_ATLAS = /^(BleacherFlatColorAtlas|StandArchitectureArtAtlas|PoolsidePropsFlatColorAtlas)\.image$/;
const POOL_IMAGES = new Set(['LaneFloatBeads.png', 'PoolBanner.png', 'PoolFasciaBrand.png',
    'PoolFeedFloor.png', 'IndoorNightSky.png']);

function mipFilterForImage(relativeMeta, imageName = '') {
    if (/^assets\/race\/models\/[^/]+\.(glb|gltf)\.meta$/i.test(relativeMeta)
        || /^assets\/race\/models\/[^/]+ColorMask\.png\.meta$/i.test(relativeMeta)) return 'linear';
    if (/^assets\/race\/pool\/[^/]+\.(glb|gltf)\.meta$/i.test(relativeMeta)) {
        return COLOR_ATLAS.test(imageName) ? 'none' : 'linear';
    }
    if (relativeMeta.startsWith('assets/race/pool/') && POOL_IMAGES.has(path.basename(relativeMeta, '.meta'))) return 'linear';
    return null;
}

function visitTargetImages(projectRoot, visitor) {
    for (const directory of ['assets/race/pool', 'assets/race/models']) {
        const absolute = path.join(projectRoot, directory);
        if (!fs.existsSync(absolute)) continue;
        for (const name of fs.readdirSync(absolute).sort()) {
            if (!name.endsWith('.meta')) continue;
            const relativeMeta = `${directory}/${name}`;
            const metaPath = path.join(absolute, name);
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            const images = meta.importer === 'image' ? [meta]
                : Object.values(meta.subMetas || {}).filter(sub => sub.importer === 'gltf-embeded-image');
            let dirty = false;
            for (const image of images) {
                const expected = mipFilterForImage(relativeMeta, image.name);
                if (expected === null) continue;
                const samplers = Object.values(meta.subMetas || {}).filter(sub => sub.importer === 'texture'
                    && sub.userData?.imageUuidOrDatabaseUri === image.uuid);
                dirty = visitor({ relativeMeta, metaPath, image, samplers, expected }) || dirty;
            }
            if (dirty) fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
        }
    }
}

function auditTextureMipmaps(projectRoot, { fix = false } = {}) {
    const result = { enabled: 0, disabled: 0, changed: 0, changedFiles: 0, issues: [] };
    const changedFiles = new Set();
    visitTargetImages(projectRoot, ({ relativeMeta, image, samplers, expected }) => {
        let dirty = false;
        for (const sampler of samplers) {
            if (expected === 'linear') result.enabled++;
            else result.disabled++;
            if (sampler.userData.mipfilter === expected) continue;
            result.issues.push({ relativePath: relativeMeta, assetName: sampler.name || sampler.displayName,
                expected: `mipfilter=${expected}`, current: `mipfilter=${sampler.userData.mipfilter}`,
                reason: expected === 'linear' ? '泳池/角色启用完整 mip 链采样' : '纯色色板保持单级采样', kind: 'mipmap' });
            if (fix) {
                sampler.userData.mipfilter = expected;
                result.changed++;
                changedFiles.add(relativeMeta);
                dirty = true;
            }
        }
        return dirty;
    });
    result.changedFiles = changedFiles.size;
    return result;
}

// Cocos 3.8.8 ImageAsset.parseCompressedTextures 使用 CMIP 包装多个独立 ASTC 层。
// 检查每层头、尺寸、块数和文件长度，拒绝裸 ASTC、缺层与构建缓存残留。
function inspectAstcMipChain(buffer) {
    function requireValid(condition, message) { if (!condition) throw new Error(message); }
    requireValid(buffer.length >= 12 && buffer.readUInt32LE(0) === 0x50494d43, 'ASTC 缺少 CMIP 多级包装');
    const levels = buffer.readUInt32LE(4);
    requireValid(levels > 0 && levels <= 32 && 8 + levels * 4 <= buffer.length, 'CMIP 层数或头部长度无效');
    let offset = 8 + levels * 4;
    let width = 0, height = 0, blockX = 0, blockY = 0;
    for (let level = 0; level < levels; level++) {
        const length = buffer.readUInt32LE(8 + level * 4);
        requireValid(length >= 32 && offset + length <= buffer.length, `mip ${level} 数据被截断`);
        requireValid(buffer.readUInt32LE(offset) === 0x5ca1ab13, `mip ${level} ASTC 头无效`);
        const bx = buffer[offset + 4], by = buffer[offset + 5];
        const w = buffer.readUIntLE(offset + 7, 3), h = buffer.readUIntLE(offset + 10, 3);
        requireValid(buffer[offset + 6] === 1 && buffer.readUIntLE(offset + 13, 3) === 1, '只支持二维 ASTC');
        requireValid(['4x4', '5x4', '5x5', '6x5', '6x6', '8x5', '8x6', '8x8',
            '10x5', '10x6', '10x8', '10x10', '12x10', '12x12'].includes(`${bx}x${by}`), 'ASTC 块尺寸无效');
        if (level === 0) {
            width = w; height = h; blockX = bx; blockY = by;
            requireValid(w > 0 && h > 0, 'ASTC 图片尺寸无效');
            requireValid(levels === Math.floor(Math.log2(Math.max(w, h))) + 1, 'mip 链未覆盖到 1×1');
        }
        requireValid(bx === blockX && by === blockY, 'mip 层压缩格式不一致');
        requireValid(w === Math.max(1, Math.floor(width / 2 ** level))
            && h === Math.max(1, Math.floor(height / 2 ** level)), `mip ${level} 尺寸不连续`);
        requireValid(length === 16 + Math.ceil(w / bx) * Math.ceil(h / by) * 16, `mip ${level} 块数据长度无效`);
        offset += length;
    }
    requireValid(offset === buffer.length, 'CMIP 有多余数据');
    return { width, height, levels, bytes: buffer.length };
}

function assertBuildMipmaps(projectRoot, result) {
    const checked = new Set();
    visitTargetImages(projectRoot, ({ relativeMeta, image, expected }) => {
        if (expected !== 'linear' || !result.containsAsset(image.uuid)) return false;
        const raw = result.getRawAssetPaths(image.uuid).flatMap(info => info.raw || []);
        const astc = raw.filter(file => path.extname(file).toLowerCase() === '.astc');
        const compressed = image.userData?.compressSettings?.useCompressTexture === true;
        if (compressed && (astc.length === 0 || !raw.some(file => /\.(png|jpe?g)$/i.test(file)))) {
            throw new Error(`[texture-mipmap] ${relativeMeta} 缺少 ASTC 或 PNG/JPG 回退输出`);
        }
        for (const file of raw) {
            if (!fs.existsSync(file)) throw new Error(`[texture-mipmap] 构建输出不存在：${file}`);
        }
        for (const file of astc) {
            if (checked.has(file)) continue;
            try { inspectAstcMipChain(fs.readFileSync(file)); }
            catch (error) { throw new Error(`[texture-mipmap] ${relativeMeta} :: ${image.name || image.uuid}: ${error.message}。请确认压缩纹理 genMipmaps 开启，清理构建缓存后重新构建。`); }
            checked.add(file);
        }
        return false;
    });
    return { compressedImages: checked.size };
}

module.exports = { mipFilterForImage, auditTextureMipmaps, inspectAstcMipChain, assertBuildMipmaps };
