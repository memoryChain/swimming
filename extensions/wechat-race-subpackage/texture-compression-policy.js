'use strict';

// Shared by the command-line fixer and the WeChat build-time audit gate.

const fs = require('fs');
const path = require('path');

const PRESETS = Object.freeze({
    UI_ALPHA: 'astc-ui-alpha-5x5',
    MODEL_ALPHA: 'astc-model-alpha-6x6',
    OPAQUE_QUALITY: 'astc-opaque-6x6',
    WORLD_ALPHA: 'astc-world-alpha-8x8',
    WORLD_OPAQUE: 'astc-world-opaque-8x8',
});

const POLICY_PRESET_IDS = new Set(Object.values(PRESETS));
const UI_MIN_PIXELS = 16 * 1024;
const WORLD_MIN_PIXELS = 32 * 1024;
const DEFAULT_MIN_PIXELS = 64 * 1024;
const QUALITY_MIN_PIXELS = 256 * 1024;
const SHARP_ART_NAME = /(banner|brand|score|sign|logo|title|text|font|label)/i;
const MODEL_DIRECTORY = /\/(model|models|character|characters)\//i;
const MAIN_PACKAGE_UI_DIRECTORY = /\/assets\/resources\/ui\//i;

function normalizeRelative(projectRoot, filePath) {
    return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function visitFiles(root, visitor) {
    if (!fs.existsSync(root)) {
        return;
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const target = path.join(root, entry.name);
        if (entry.isDirectory()) {
            visitFiles(target, visitor);
        } else {
            visitor(target);
        }
    }
}

function readPngDimensions(buffer) {
    const pngSignature = '89504e470d0a1a0a';
    if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
        return null;
    }
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}

function readJpegDimensions(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return null;
    }
    let offset = 2;
    while (offset + 8 < buffer.length) {
        while (offset < buffer.length && buffer[offset] !== 0xff) {
            offset++;
        }
        while (offset < buffer.length && buffer[offset] === 0xff) {
            offset++;
        }
        if (offset >= buffer.length) {
            break;
        }
        const marker = buffer[offset++];
        if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            continue;
        }
        if (offset + 2 > buffer.length) {
            break;
        }
        const segmentLength = buffer.readUInt16BE(offset);
        if (segmentLength < 2 || offset + segmentLength > buffer.length) {
            break;
        }
        const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
            || (marker >= 0xc5 && marker <= 0xc7)
            || (marker >= 0xc9 && marker <= 0xcb)
            || (marker >= 0xcd && marker <= 0xcf);
        if (isStartOfFrame && segmentLength >= 7) {
            return {
                width: buffer.readUInt16BE(offset + 5),
                height: buffer.readUInt16BE(offset + 3),
            };
        }
        offset += segmentLength;
    }
    return null;
}

function readImageDimensions(imagePath) {
    const extension = path.extname(imagePath).toLowerCase();
    const buffer = fs.readFileSync(imagePath);
    if (extension === '.png') {
        return readPngDimensions(buffer);
    }
    if (extension === '.jpg' || extension === '.jpeg') {
        return readJpegDimensions(buffer);
    }
    return null;
}

function classifyStandaloneImage(projectRoot, imagePath, userData) {
    const relative = normalizeRelative(projectRoot, imagePath);
    const normalized = `/${relative}`;
    const dimensions = readImageDimensions(imagePath);
    if (!dimensions) {
        return {
            unsupported: true,
            reason: '仅自动识别 PNG/JPG 尺寸，请为这种图片格式补充规则',
        };
    }

    const pixels = dimensions.width * dimensions.height;
    const hasAlpha = userData?.hasAlpha === true;
    const isUi = /\/ui\//i.test(normalized);
    const isSharpArt = SHARP_ART_NAME.test(path.basename(imagePath));

    // assets/resources is Cocos' built-in main package. Shipping ASTC plus its
    // fallback here duplicates every login/HUD image and can exceed WeChat's 4MB
    // main-package source limit before the race subpackage is even considered.
    // The high-value 3D/venue textures live under assets/race and remain ASTC.
    if (MAIN_PACKAGE_UI_DIRECTORY.test(normalized)) {
        return {
            excluded: true,
            reason: 'resources UI 属于微信首包，为满足 4MB 限制不生成压缩变体',
        };
    }

    if (isUi) {
        if (pixels < UI_MIN_PIXELS) {
            return null;
        }
        return {
            presetId: hasAlpha ? PRESETS.UI_ALPHA : PRESETS.OPAQUE_QUALITY,
            reason: hasAlpha ? 'UI/透明锐利边缘' : 'UI/不透明大图',
        };
    }

    if (/\/race\//i.test(normalized)) {
        if (pixels < WORLD_MIN_PIXELS) {
            return null;
        }
        if (hasAlpha) {
            return {
                presetId: isSharpArt ? PRESETS.MODEL_ALPHA : PRESETS.WORLD_ALPHA,
                reason: isSharpArt ? '场景透明标识' : '低频透明环境纹理',
            };
        }
        return {
            presetId: isSharpArt || pixels >= QUALITY_MIN_PIXELS
                ? PRESETS.OPAQUE_QUALITY
                : PRESETS.WORLD_OPAQUE,
            reason: isSharpArt || pixels >= QUALITY_MIN_PIXELS
                ? '场景大图/标识'
                : '低频不透明环境纹理',
        };
    }

    if (pixels < DEFAULT_MIN_PIXELS) {
        return null;
    }
    return {
        presetId: hasAlpha ? PRESETS.MODEL_ALPHA : PRESETS.OPAQUE_QUALITY,
        reason: '未归类的大纹理使用保守质量档',
    };
}

function classifyEmbeddedImage(projectRoot, metaPath, embeddedMeta) {
    const relative = normalizeRelative(projectRoot, metaPath);
    const normalized = `/${relative}`;
    const imageName = embeddedMeta.name || '';
    const hasAlpha = embeddedMeta.userData?.hasAlpha === true;
    const qualitySensitive = MODEL_DIRECTORY.test(normalized) || SHARP_ART_NAME.test(imageName);

    if (qualitySensitive) {
        return {
            presetId: hasAlpha ? PRESETS.MODEL_ALPHA : PRESETS.OPAQUE_QUALITY,
            reason: hasAlpha ? '模型透明内嵌贴图' : '模型/标识内嵌贴图',
        };
    }
    return {
        presetId: hasAlpha ? PRESETS.WORLD_ALPHA : PRESETS.WORLD_OPAQUE,
        reason: hasAlpha ? '场景透明内嵌贴图' : '场景不透明内嵌贴图',
    };
}

function configuredPreset(userData) {
    const settings = userData?.compressSettings;
    if (!settings || settings.useCompressTexture !== true || typeof settings.presetId !== 'string') {
        return null;
    }
    return settings.presetId;
}

function setPreset(userData, presetId) {
    userData.compressSettings = {
        useCompressTexture: true,
        presetId,
    };
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validatePresetDefinitions(projectRoot) {
    const settingsPath = path.join(projectRoot, 'settings', 'v2', 'packages', 'builder.json');
    const settings = readJson(settingsPath);
    const definitions = settings?.textureCompressConfig?.userPreset || {};
    const missing = [...POLICY_PRESET_IDS].filter((presetId) => !definitions[presetId]);
    if (missing.length > 0) {
        throw new Error(
            `[texture-policy] settings/v2/packages/builder.json 缺少预设: ${missing.join(', ')}`,
        );
    }
}

function makeIssue(relativePath, assetName, expected, current, reason, kind = 'configuration') {
    return {
        relativePath,
        assetName,
        expected,
        current,
        reason,
        kind,
    };
}

function auditTextureCompression(projectRoot, options = {}) {
    const resolvedRoot = path.resolve(projectRoot);
    const fix = options.fix === true;
    validatePresetDefinitions(resolvedRoot);

    const result = {
        checked: 0,
        eligible: 0,
        mipmapSamplersDisabled: 0,
        ignoredSmall: 0,
        ignoredMainPackage: 0,
        changed: 0,
        changedFiles: 0,
        issues: [],
    };
    const assetsRoot = path.join(resolvedRoot, 'assets');

    visitFiles(assetsRoot, (metaPath) => {
        if (!metaPath.endsWith('.meta')) {
            return;
        }

        let meta;
        try {
            meta = readJson(metaPath);
        } catch (error) {
            result.issues.push(makeIssue(
                normalizeRelative(resolvedRoot, metaPath),
                path.basename(metaPath),
                '有效 JSON',
                '无法解析',
                error.message,
                'invalid-meta',
            ));
            return;
        }

        let dirty = false;
        const relativeMeta = normalizeRelative(resolvedRoot, metaPath);
        if (meta.importer === 'image') {
            const imagePath = metaPath.slice(0, -'.meta'.length);
            if (!fs.existsSync(imagePath)) {
                return;
            }
            result.checked++;
            const classification = classifyStandaloneImage(resolvedRoot, imagePath, meta.userData);
            if (!classification) {
                result.ignoredSmall++;
                return;
            }
            if (classification.excluded) {
                result.ignoredMainPackage++;
                const current = configuredPreset(meta.userData);
                if (current) {
                    result.issues.push(makeIssue(
                        relativeMeta,
                        path.basename(imagePath),
                        '不生成压缩变体',
                        current,
                        classification.reason,
                    ));
                    if (fix) {
                        delete meta.userData.compressSettings;
                        result.changed++;
                        dirty = true;
                    }
                }
                if (dirty) {
                    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
                    result.changedFiles++;
                }
                return;
            }
            if (classification.unsupported) {
                result.issues.push(makeIssue(
                    relativeMeta,
                    path.basename(imagePath),
                    '补充压缩分类规则',
                    '未处理',
                    classification.reason,
                    'unsupported-image',
                ));
                return;
            }
            result.eligible++;
            const current = configuredPreset(meta.userData);
            if (current !== classification.presetId) {
                result.issues.push(makeIssue(
                    relativeMeta,
                    path.basename(imagePath),
                    classification.presetId,
                    current || '未配置',
                    classification.reason,
                ));
                if (fix) {
                    setPreset(meta.userData, classification.presetId);
                    result.changed++;
                    dirty = true;
                }
            }
        } else if (meta.importer === 'gltf') {
            for (const [subId, subMeta] of Object.entries(meta.subMetas || {})) {
                if (subMeta?.importer !== 'gltf-embeded-image' || !subMeta.userData) {
                    continue;
                }
                result.checked++;
                result.eligible++;
                const classification = classifyEmbeddedImage(resolvedRoot, metaPath, subMeta);
                const current = configuredPreset(subMeta.userData);
                if (current !== classification.presetId) {
                    result.issues.push(makeIssue(
                        relativeMeta,
                        `${subMeta.name || 'embedded-image'}@${subId}`,
                        classification.presetId,
                        current || '未配置',
                        classification.reason,
                    ));
                    if (fix) {
                        setPreset(subMeta.userData, classification.presetId);
                        result.changed++;
                        dirty = true;
                    }
                }

                // A raw .astc file contains only its base image. Cocos' GLTF
                // importer enables linear mip sampling by default, but WebGL
                // cannot generate the missing mip chain for compressed ASTC
                // textures. On iOS WeChat this leaves the texture incomplete
                // and has shown up as magenta/corrupted model and venue pixels.
                // Keep bilinear filtering, but explicitly disable mip sampling
                // on every Texture2D sub-asset that references this image.
                for (const [textureId, textureMeta] of Object.entries(meta.subMetas || {})) {
                    const textureUserData = textureMeta?.userData;
                    if (textureUserData?.imageUuidOrDatabaseUri !== subMeta.uuid) {
                        continue;
                    }
                    result.mipmapSamplersDisabled++;
                    if (textureUserData.mipfilter === 'none') {
                        continue;
                    }
                    result.issues.push(makeIssue(
                        relativeMeta,
                        `${textureMeta.name || 'embedded-texture'}@${textureId}`,
                        'mipfilter=none',
                        `mipfilter=${textureUserData.mipfilter || '未配置'}`,
                        'ASTC 裸文件没有 mip 链，GLB 纹理不得启用 mip 采样',
                        'compressed-mipmap',
                    ));
                    if (fix) {
                        textureUserData.mipfilter = 'none';
                        result.changed++;
                        dirty = true;
                    }
                }
            }
        }

        if (dirty) {
            fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
            result.changedFiles++;
        }
    });

    return result;
}

function formatIssues(issues, limit = 30) {
    const lines = issues.slice(0, limit).map((issue) => (
        `- ${issue.relativePath} :: ${issue.assetName}\n`
        + `  当前=${issue.current}，应为=${issue.expected}（${issue.reason}）`
    ));
    if (issues.length > limit) {
        lines.push(`- 其余 ${issues.length - limit} 项省略`);
    }
    return lines.join('\n');
}

function assertTextureCompressionPolicy(projectRoot) {
    const result = auditTextureCompression(projectRoot, { fix: false });
    if (result.issues.length > 0) {
        throw new Error(
            `[texture-policy] 发现 ${result.issues.length} 个纹理压缩问题。`
            + '先在项目根目录运行 npm run textures:fix，然后等待 Creator 导入完成后重新构建。\n'
            + formatIssues(result.issues),
        );
    }
    return result;
}

function runCli() {
    const args = new Set(process.argv.slice(2));
    const fix = args.has('--fix');
    const projectRoot = path.resolve(__dirname, '..', '..');
    const result = auditTextureCompression(projectRoot, { fix });

    if (fix && result.changed > 0) {
        console.log(
            `[texture-policy] 已修复 ${result.changed} 个纹理配置，涉及 ${result.changedFiles} 个 .meta 文件。`,
        );
        console.log('请等待 Cocos Creator 完成资源重新导入，再执行构建。');
        return;
    }

    if (result.issues.length > 0) {
        console.error(`[texture-policy] 发现 ${result.issues.length} 个纹理压缩问题：`);
        console.error(formatIssues(result.issues));
        console.error('运行 npm run textures:fix 自动修复。');
        process.exitCode = 1;
        return;
    }

    console.log(
        `[texture-policy] 检查通过：扫描 ${result.checked} 项，`
        + `纳入压缩 ${result.eligible} 项，关闭 GLB mip 采样 ${result.mipmapSamplersDisabled} 项，`
        + `首包 UI 保持原图 ${result.ignoredMainPackage} 项，`
        + `保留小纹理 ${result.ignoredSmall} 项。`,
    );
}

module.exports = {
    PRESETS,
    auditTextureCompression,
    assertTextureCompressionPolicy,
    formatIssues,
};

if (require.main === module) {
    runCli();
}
