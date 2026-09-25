'use strict';

const fs = require('fs');
const path = require('path');

function resolveArt(projectRoot, outputRoot) {
    const resources = fs.readFileSync(path.join(projectRoot, 'assets/startup/StartupResources.ts'), 'utf8');
    const art = {};
    for (const key of ['background', 'logo']) {
        const resource = new RegExp(`\\b${key}:\\s*'([^']+)/texture'`).exec(resources)?.[1];
        if (!resource) throw new Error(`[first-screen] 首屏资源表缺少 ${key}。`);
        const root = path.join(projectRoot, 'assets/resources', resource);
        const source = ['.png', '.jpg'].map(ext => root + ext).find(file => fs.existsSync(file));
        if (!source) throw new Error(`[first-screen] 缺少首屏素材 ${resource}。`);
        const { uuid } = JSON.parse(fs.readFileSync(source + '.meta', 'utf8'));
        // 开启首场景分包后，场景显式依赖可能从 resources 移到 start-scene。
        // 只查这两个主包目录；此时业务分包可能尚未搬走，不能递归扫描整个 assets。
        const directories = ['start-scene', 'resources'].map(bundle =>
            path.join(outputRoot, 'assets', bundle, 'native', uuid.slice(0, 2)));
        const candidates = directories.flatMap(directory => {
            if (!fs.existsSync(directory)) return [];
            return fs.readdirSync(directory, { withFileTypes: true })
                .filter(entry => entry.isFile() && entry.name.startsWith(uuid + '.') && /\.(png|jpg)$/.test(entry.name))
                .map(entry => path.join(directory, entry.name));
        });
        if (candidates.length !== 1) {
            throw new Error(`[first-screen] 主包原生图片无法唯一定位：${key}（${uuid}），`
                + `找到 ${candidates.length} 个候选。查找目录：${directories.join('、')}。`
                + (candidates.length ? `候选文件：${candidates.join('、')}。` : '请确认素材已导出到 resources 或 start-scene 主包。'));
        }
        art[key] = path.relative(outputRoot, candidates[0]).split(path.sep).join('/');
    }
    return art;
}

function brandedSource(projectRoot, outputRoot, source) {
    let clean = source.replace(/\n?\/\/ swimming-first-screen:start[\s\S]*?\/\/ swimming-first-screen:end\r?\n?/, '');
    for (const name of ['start', 'end', 'setProgress', 'updateBgVertexBuffer', 'initLogoTexture', 'drawProgressBar']) {
        if (!clean.includes(`function ${name}(`) && !clean.includes(`function ${name} (`)) {
            throw new Error(`[first-screen] 首屏模板不兼容，缺少 ${name}。`);
        }
    }
    const art = resolveArt(projectRoot, outputRoot);
    const values = {
        bgName: art.background, logoName: art.logo,
        bgColor: [8 / 255, 81 / 255, 181 / 255, 1],
        progressBarColor: [201 / 255, 1, 52 / 255, 1],
        progressBackground: [0, 29 / 255, 65 / 255, 0.65],
        useCustomBg: true, useLogo: true, useDefaultLogo: false, fitWidth: false, fitHeight: false,
    };
    for (const [key, value] of Object.entries(values)) {
        const expression = new RegExp(`let ${key} = [^;\\n]+;`, 'g');
        if ([...clean.matchAll(expression)].length !== 1) throw new Error(`[first-screen] 配置项不兼容：${key}。`);
        clean = clean.replace(expression, () => `let ${key} = ${JSON.stringify(value)};`);
    }
    const template = fs.readFileSync(path.join(__dirname, 'templates/first-screen-branding.js'), 'utf8').replace(/\r\n/g, '\n');
    for (const name of ['updateVertexBuffer', 'initProgressVertexBuffer']) {
        const expression = new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}`, 'g');
        const replacement = template.match(expression)?.[0];
        if (!replacement || [...clean.matchAll(expression)].length !== 1) throw new Error(`[first-screen] 布局函数不兼容：${name}。`);
        clean = clean.replace(expression, () => replacement);
    }
    return clean;
}

function applyWechatFirstScreen(projectRoot, outputRoot, options = {}) {
    const file = path.join(outputRoot, 'first-screen.js');
    const source = fs.readFileSync(file, 'utf8');
    const updated = brandedSource(projectRoot, outputRoot, source);
    const changed = updated !== source;
    if (changed && !options.checkOnly) {
        if (options.backupRoot) {
            fs.mkdirSync(options.backupRoot, { recursive: true });
            fs.copyFileSync(file, path.join(options.backupRoot, 'first-screen.js'));
        }
        fs.writeFileSync(file, updated, 'utf8');
    }
    return { changed };
}

function assertWechatFirstScreen(projectRoot, outputRoot) {
    if (applyWechatFirstScreen(projectRoot, outputRoot, { checkOnly: true }).changed) {
        throw new Error('[first-screen] 加载画面未更新，请运行 pnpm wechat:finalize。');
    }
}

module.exports = { applyWechatFirstScreen, assertWechatFirstScreen };
