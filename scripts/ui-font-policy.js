'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'ui-font-config.json');

function readConfig(projectRoot) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { projectRoot: path.resolve(projectRoot), ...config };
}

function walkTextFiles(root, extensions, files) {
    if (!fs.existsSync(root)) {
        return;
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const target = path.join(root, entry.name);
        if (entry.isDirectory()) {
            walkTextFiles(target, extensions, files);
        } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
            files.push(target);
        }
    }
}

function collectUiGlyphs(projectRoot) {
    const config = readConfig(projectRoot);
    const extensions = new Set(config.scan.extensions.map((extension) => extension.toLowerCase()));
    const files = [];
    for (const relativeRoot of config.scan.roots) {
        walkTextFiles(path.join(config.projectRoot, relativeRoot), extensions, files);
    }
    files.sort();

    const glyphs = new Set([...config.scan.alwaysInclude]);
    for (const filePath of files) {
        const text = fs.readFileSync(filePath, 'utf8');
        for (const character of text) {
            const codePoint = character.codePointAt(0);
            if (codePoint >= 0xa0 && codePoint !== 0xfeff) {
                glyphs.add(character);
            }
        }
    }
    const text = [...glyphs].sort((left, right) => left.codePointAt(0) - right.codePointAt(0)).join('');
    return {
        config,
        files,
        glyphText: text,
        glyphHash: sha256(Buffer.from(text, 'utf8')),
    };
}

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function assertUiFontPolicy(projectRoot) {
    const scan = collectUiGlyphs(projectRoot);
    const manifestPath = path.join(scan.config.projectRoot, scan.config.manifestPath);
    if (!fs.existsSync(manifestPath)) {
        throw new Error('[ui-font-policy] 字体清单不存在。请先运行 `pnpm fonts:setup` 和 `pnpm fonts:build`。');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.schemaVersion !== scan.config.schemaVersion || manifest.glyphHash !== scan.glyphHash) {
        throw new Error(
            '[ui-font-policy] 工程文案已变化，字体子集已过期。请运行 `pnpm fonts:build`，不要手工修改字符表。',
        );
    }

    for (const output of scan.config.outputs) {
        const outputPath = path.join(scan.config.projectRoot, output.path);
        const recorded = manifest.outputs?.find((entry) => entry.path === output.path);
        if (!fs.existsSync(outputPath) || !recorded) {
            throw new Error(`[ui-font-policy] 缺少生成字体 ${output.path}。请运行 \`pnpm fonts:build\`。`);
        }
        const actualHash = sha256(fs.readFileSync(outputPath));
        if (actualHash !== recorded.sha256) {
            throw new Error(`[ui-font-policy] ${output.path} 与字体清单不一致。请重新运行 \`pnpm fonts:build\`。`);
        }
    }
    return { glyphCount: [...scan.glyphText].length, scannedFiles: scan.files.length };
}

if (require.main === module) {
    const projectRoot = path.resolve(__dirname, '..');
    try {
        const result = assertUiFontPolicy(projectRoot);
        console.log(`[ui-font-policy] 已验证 ${result.glyphCount} 个字符，扫描 ${result.scannedFiles} 个工程文案文件。`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

module.exports = { assertUiFontPolicy, collectUiGlyphs };
