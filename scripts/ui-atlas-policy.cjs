'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const SETTINGS = {
    padding: 4, allowRotation: false, forceSquared: false, powerOfTwo: false,
    contourBleed: true, paddingBleed: true, filterUnused: false,
    removeTextureInBundle: true, removeImageInBundle: true, removeSpriteAtlasInBundle: false,
};

function exportPathsSource(config) {
    const mapping = Object.fromEntries(Object.entries(config.assets).map(([oldPath, asset]) => [oldPath, asset.path]));
    return '// 由 config/ui-atlases.json 生成；运行 pnpm ui:atlases:sync 更新。\n'
        + 'var UI_ATLAS_EXPORT_PATHS = ' + JSON.stringify(mapping, null, 2) + ';\n'
        + 'function uiAtlasExportFile(project, group, name) {\n'
        + ' var relative = UI_ATLAS_EXPORT_PATHS[group+"/"+name+".png"];\n'
        + ' if (!relative) return null;\n'
        + ' var file = new File(project+"/assets/race/ui/"+relative);\n'
        + ' if (!file.parent.exists) file.parent.create();\n'
        + ' return file;\n}\n';
}

function syncUiAtlasExports(root = ROOT) {
    const file = path.join(root, 'scripts/ui-atlas-export-paths.jsx');
    const source = exportPathsSource(read(path.join(root, 'config/ui-atlases.json')));
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === source) return false;
    fs.writeFileSync(file, source); return true;
}

function auditUiAtlases(root = ROOT, { fix = false } = {}) {
    const config = read(path.join(root, 'config/ui-atlases.json'));
    const issues = [], pendingImport = [], groups = [];
    let changed = 0, images = 0;
    const exportFile = path.join(root, 'scripts/ui-atlas-export-paths.jsx');
    if (!fs.existsSync(exportFile) || fs.readFileSync(exportFile, 'utf8') !== exportPathsSource(config)) {
        if (fix) { syncUiAtlasExports(root); changed++; }
        else issues.push('PS 导出路径已过期，请运行 pnpm ui:atlases:sync');
    }
    for (const [group, spec] of Object.entries(config.groups)) {
        const directory = path.join(root, 'assets/race/ui', group);
        const pac = path.join(directory, 'atlas.pac');
        const metaFile = pac + '.meta';
        if (!fs.existsSync(pac) || !fs.existsSync(metaFile)) { issues.push(`${group}：缺少图集配置或导入元数据`); continue; }
        const meta = read(metaFile);
        if (meta.importer !== 'auto-atlas') { issues.push(`${group}：必须使用 Cocos 自动图集`); continue; }
        const expected = { ...SETTINGS, maxWidth: spec.maxWidth, maxHeight: spec.maxHeight,
            compressSettings: { useCompressTexture: true, presetId: 'astc-ui-alpha-5x5' } };
        const user = meta.userData;
        let dirty = false;
        for (const [key, value] of Object.entries(expected)) {
            if (JSON.stringify(user[key]) === JSON.stringify(value)) continue;
            if (fix) { user[key] = value; dirty = true; } else issues.push(`${group}：图集 ${key} 配置不匹配`);
        }
        for (const [key, value] of Object.entries({ wrapModeS: 'clamp-to-edge', wrapModeT: 'clamp-to-edge', mipfilter: 'none' })) {
            if (user.textureSetting?.[key] === value) continue;
            if (fix) { user.textureSetting ??= {}; user.textureSetting[key] = value; dirty = true; }
            else issues.push(`${group}：图集采样 ${key} 配置不匹配`);
        }
        if (dirty) { write(metaFile, meta); changed++; }
        const names = new Set(); let pixels = 0, count = 0;
        for (const name of fs.readdirSync(directory).filter(name => /\.png$/i.test(name))) {
            const image = path.join(directory, name), data = fs.readFileSync(image);
            if (data.length < 24 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
                issues.push(`${group}/${name}：无效 PNG`); continue;
            }
            const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
            pixels += width * height; images++; count++;
            if (width + SETTINGS.padding > spec.maxWidth || height + SETTINGS.padding > spec.maxHeight) issues.push(`${group}/${name}：超出图集尺寸`);
            if (names.has(path.parse(name).name)) issues.push(`${group}/${name}：重复子图名称`);
            names.add(path.parse(name).name);
            const imageMetaFile = image + '.meta';
            if (!fs.existsSync(imageMetaFile)) { pendingImport.push(`${group}/${name}`); continue; }
            const imageMeta = read(imageMetaFile);
            let imageDirty = false;
            if (imageMeta.userData?.type !== 'sprite-frame') {
                if (fix) { imageMeta.userData ??= {}; imageMeta.userData.type = 'sprite-frame'; imageDirty = true; }
                else issues.push(`${group}/${name}：必须以 SpriteFrame 导入`);
            }
            const frame = Object.values(imageMeta.subMetas || {}).find(sub => sub.importer === 'sprite-frame');
            if (!frame) {
                if (imageDirty) { write(imageMetaFile, imageMeta); changed++; }
                pendingImport.push(`${group}/${name}：等待 Creator 生成 SpriteFrame`); continue;
            }
            const frameSettings = { trimType: 'none', rotated: false, packable: true };
            let frameDirty = false;
            for (const [key, value] of Object.entries(frameSettings)) {
                if (frame.userData[key] === value) continue;
                if (fix) { frame.userData[key] = value; frameDirty = true; }
                else issues.push(`${group}/${name}：SpriteFrame ${key} 配置不匹配`);
            }
            if (frameDirty || imageDirty) { write(imageMetaFile, imageMeta); changed++; }
            // 不伪造导入几何；修复 trim 后必须等 Creator 重新导入再审计。
            if (frame.userData.width !== width || frame.userData.height !== height
                || frame.userData.rawWidth !== width || frame.userData.rawHeight !== height
                || frame.userData.trimX !== 0 || frame.userData.trimY !== 0
                || frame.userData.offsetX !== 0 || frame.userData.offsetY !== 0) {
                pendingImport.push(`${group}/${name}：等待 Creator 重新导入 SpriteFrame，裁剪尺寸或偏移未更新`);
            }
        }
        if (!count) issues.push(`${group}：图集为空`);
        if (pixels > spec.maxWidth * spec.maxHeight * spec.maxPages) issues.push(`${group}：源图面积超过纹理页预算`);
        groups.push({ group, count, pixels, maxPages: spec.maxPages });
    }
    // 迁移时保留的资产身份，允许替换 PNG，但不允许重新生成原 UUID。
    for (const asset of Object.values(config.assets)) {
        const file = path.join(root, 'assets/race/ui', asset.path);
        if (!fs.existsSync(file) || !fs.existsSync(file + '.meta')) issues.push(`迁移资源缺失：${asset.path}`);
        else if (read(file + '.meta').uuid !== asset.uuid) issues.push(`迁移资源 UUID 已改变：${asset.path}`);
    }
    return { images, groups, issues, pendingImport, changed };
}

function assertUiAtlasPolicy(root = ROOT) {
    const result = auditUiAtlases(root);
    if (result.issues.length || result.pendingImport.length) {
        throw new Error('[ui-atlas] 图集尚未就绪：\n' + [...result.issues, ...result.pendingImport].join('\n')
            + '\n请先让现有 Creator 会话导入资源，执行 pnpm ui:atlases:fix，再等待重新导入后构建。');
    }
    return result;
}

function assertBuiltUiAtlases(root, output) {
    const config = read(path.join(root, 'config/ui-atlases.json'));
    const directory = path.join(output, 'subpackages/ui');
    const files = fs.readdirSync(directory).filter(name => /^config(?:\.[^.]+)?\.json$/.test(name));
    if (files.length !== 1) throw new Error('[ui-atlas] 构建缺少唯一的 UI Bundle 配置');
    const file = files[0];
    const bundle = read(path.join(directory, file));
    const entries = Object.values(bundle.paths).map(info => ({ path: info[0], type: bundle.types[info[1]] }));
    for (const [group, spec] of Object.entries(config.groups)) {
        if (!entries.some(info => info.path === spec.atlas.slice(3) && info.type === 'cc.SpriteAtlas')) {
            throw new Error(`[ui-atlas] 构建缺少可加载图集：${spec.atlas}`);
        }
        const duplicate = entries.find(info => info.path.startsWith(group + '/')
            && ((info.type === 'cc.Texture2D' && info.path.endsWith('/texture')) || info.type === 'cc.ImageAsset'));
        if (duplicate) throw new Error(`[ui-atlas] 构建仍保留图集源散图纹理：${duplicate.path}`);
    }
    return { groups: Object.keys(config.groups).length };
}

module.exports = { auditUiAtlases, assertUiAtlasPolicy, assertBuiltUiAtlases, syncUiAtlasExports };
if (require.main === module) {
    if (process.argv.includes('--sync')) {
        console.log(syncUiAtlasExports() ? '已同步 PS 导出路径。' : 'PS 导出路径已是最新。');
        return;
    }
    const fix = process.argv.includes('--fix');
    const result = auditUiAtlases(ROOT, { fix });
    console.log(`已检查 ${result.groups.length} 组图集、${result.images} 张源图，修改 ${result.changed} 个配置。`);
    for (const issue of result.issues) console.error(issue);
    if (result.pendingImport.length) console.error(`尚有 ${result.pendingImport.length} 张图片的 SpriteFrame 等待生成或重新导入。`);
    if (result.issues.length || (!fix && result.pendingImport.length)) process.exitCode = 1;
}
