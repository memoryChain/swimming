// 使用本机 Creator 的 Effect 编译器与引擎 chunk 离线校验，不启动编辑器。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const engine = process.env.COCOS_ENGINE_ROOT || path.resolve(
    JSON.parse(fs.readFileSync(path.join(root, 'temp/tsconfig.cocos.json'), 'utf8')).compilerOptions.paths['db://internal/*'][0], '../../..');
const archivePath = process.env.COCOS_APP_ASAR || path.resolve(engine, '../../../app.asar');
const archive = fs.readFileSync(archivePath);
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)));
const archiveOffset = 8 + archive.readUInt32LE(4);
const ts = findTypeScript();
const cache = new Map();
function findTypeScript() {
    try { return require('typescript'); } catch {}
    for (const dir of process.env.PATH.split(path.delimiter)) {
        const file = path.resolve(dir, '../typescript/lib/typescript.js');
        if (fs.existsSync(file)) return require(file);
    }
    throw new Error('请通过 typescript@5.4.5 的 npx 环境运行');
}
function entry(name) {
    let value = header;
    for (const part of name.split('/')) value = value?.files?.[part];
    return value;
}
function readArchive(name) {
    const value = entry(name);
    if (!value || value.files) throw new Error('归档中缺少文件：' + name);
    if (value.unpacked) return fs.readFileSync(archivePath + '.unpacked/' + name, 'utf8');
    const offset = archiveOffset + Number(value.offset);
    return archive.subarray(offset, offset + value.size).toString('utf8');
}
function resolveArchive(name) {
    for (const file of [name, name + '.js', name + '.json']) if (entry(file)?.size !== undefined) return file;
    if (entry(name + '/package.json')) {
        const main = JSON.parse(readArchive(name + '/package.json')).main || 'index.js';
        if (main !== '.') return resolveArchive(path.posix.join(name, main));
    }
    if (entry(name + '/index.js')) return name + '/index.js';
    return null;
}
function evaluate(code, filename, localRequire) {
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports,__filename,__dirname){' + code + '\n})', { filename })
        (localRequire, module, module.exports, filename, path.dirname(filename));
    return module.exports;
}
function engineModule(relative, overrides = {}) {
    const filename = path.join(engine, relative);
    const source = fs.readFileSync(filename, 'utf8');
    return evaluate(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
        filename, id => { if (id in overrides) return overrides[id]; throw new Error('未声明的引擎编译依赖：' + id); });
}
// GPU 对象基类不参与编译；枚举、类型大小、采样器 hash 与映射均使用引擎原实现。
const gfx = engineModule('cocos/gfx/base/define.ts', { '../../core/data/gc-object': { GCObject: class {} } });
gfx.Sampler = engineModule('cocos/gfx/base/states/sampler.ts', { '../define': gfx }).Sampler;
const defineSource = fs.readFileSync(path.join(engine, 'cocos/rendering/define.ts'), 'utf8');
const enums = ['RenderPassStage', 'RenderPriority', 'SetIndex'].map(name => {
    const result = defineSource.match(new RegExp('export enum ' + name + ' \\{[^}]+\\}'));
    if (!result) throw new Error('缺少引擎枚举：' + name);
    return result[0];
}).join('\n');
const render = evaluate(ts.transpileModule(enums, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, 'render-enums', require);
const hash = engineModule('cocos/core/algorithm/murmurhash2_gc.ts');
const mappings = engineModule('editor/exports/offline-mappings.ts', {
    '../../cocos/gfx': gfx, '../../cocos/rendering/define': render, '../../cocos/core': hash,
});
function loadArchive(name) {
    if (cache.has(name)) return cache.get(name);
    const source = readArchive(name);
    if (name.endsWith('.json')) { const value = JSON.parse(source); cache.set(name, value); return value; }
    const value = evaluate(source, name, id => {
        if (id === 'cc/editor/offline-mappings') return mappings;
        if (id.startsWith('.')) return loadArchive(resolveArchive(path.posix.join(path.posix.dirname(name), id)));
        if (require('node:module').builtinModules.includes(id)) return require(id);
        let dir = path.posix.dirname(name);
        while (true) {
            const target = resolveArchive(path.posix.join(dir, 'node_modules', id));
            if (target) return loadArchive(target);
            if (dir === '.') break;
            dir = path.posix.dirname(dir);
        }
        return createRequire(__filename)(id);
    });
    cache.set(name, value);
    return value;
}
const compiler = loadArchive('modules/engine-extensions/extensions/engine-extends/static/effect-compiler/index.js');
compiler.options.throwOnError = true;
compiler.options.skipParserTest = false;
function chunks(dir) {
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
        const filename = path.join(dir, file.name);
        if (file.isDirectory()) chunks(filename);
        else if (file.name.endsWith('.chunk')) {
            const name = path.relative(path.join(engine, 'editor/assets/chunks'), filename).replaceAll('\\', '/').replace(/\.chunk$/, '');
            compiler.addChunk(name, fs.readFileSync(filename, 'utf8'));
        }
    }
}
chunks(path.join(engine, 'editor/assets/chunks'));
const results = {};
for (const relative of ['assets/race/effects/WhirlpoolFunnel.effect', 'assets/race/material-effects/RagingPoolWater.effect']) {
    const result = compiler.buildEffect(path.basename(relative, '.effect'), fs.readFileSync(path.join(root, relative), 'utf8'));
    results[path.basename(relative, '.effect')] = result;
    console.log('Effect 编译通过：' + relative + '；着色程序 ' + result.shaders.length);
}
// 生成文件仅用于离线 WebGL 检查，不写入 Creator 导入缓存。
const out = path.join(root, 'temp/whirlpool-review');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'compiled-effects.json'), JSON.stringify(results));
