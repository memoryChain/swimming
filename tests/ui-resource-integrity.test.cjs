'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const directory of process.env.PATH.split(path.delimiter)) {
        const candidate = path.resolve(directory, '../typescript/lib/typescript.js');
        if (fs.existsSync(candidate)) return require(candidate);
    }
    throw new Error('需要 typescript@5.4.5');
}
const ts = compiler();
const root = path.resolve(__dirname, '..');
function files(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(directory, entry.name);
        return entry.isDirectory() ? files(full) : [full];
    });
}
function walk(node, visit) { visit(node); ts.forEachChild(node, child => walk(child, visit)); }
function strings(value) {
    return typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
}
const resourceModule = { exports: {} };
const startupResources = { exports: {} };
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'assets/startup/StartupResources.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(startupResources.exports);
new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/core/ResourcePaths.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(resourceModule.exports, () => startupResources.exports);
const resourcePaths = resourceModule.exports.RESOURCE_PATHS;

test('所有 UI 图片均有集中路径登记，所有登记路径都能解析到唯一现存资源', () => {
    const actual = new Map();
    const counts = {};
    for (const bundle of ['assets/race', 'assets/resources']) {
        for (const file of files(path.join(root, bundle, 'ui')).filter(file => /\.(png|jpg|jpeg|webp|prefab)$/i.test(file))) {
            const asset = path.relative(path.join(root, bundle), file).replace(/\\/g, '/').replace(/\.[^.]+$/, '');
            assert.ok(!actual.has(asset), `资源路径重复：${asset}`);
            assert.ok(fs.existsSync(file + '.meta'), `缺少导入信息：${file}`);
            actual.set(asset, file);
            const group = `${bundle}/${asset.split('/').slice(0, 2).join('/')}`;
            counts[group] = (counts[group] || 0) + 1;
        }
    }
    const declared = new Set(strings(resourcePaths).filter(value => value.startsWith('ui/')).map(value => value.replace(/\/(texture|spriteFrame)$/, '')));
    for (const asset of actual.keys()) assert.ok(declared.has(asset), `没有集中登记的 UI 资源：${asset}`);
    for (const asset of declared) assert.ok(actual.has(asset), `资源已删除但声明仍在：${asset}`);
    console.log(`已核对 ${actual.size} 个 UI 资源（含 Prefab），覆盖 ${Object.keys(counts).length} 组路径。`);
});

test('资源引用不能只藏在无调用入口的私有 UI 方法中', () => {
    const dead = [];
    for (const directory of ['assets/scripts/ui', 'assets/scripts/app']) {
        for (const file of files(path.join(root, directory)).filter(file => file.endsWith('.ts'))) {
            const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
            const aliases = new Set(['RESOURCE_PATHS']);
            walk(source, node => {
                if (ts.isVariableDeclaration(node) && node.initializer?.getText(source).startsWith('RESOURCE_PATHS.')) aliases.add(node.name.getText(source));
            });
            walk(source, node => {
                if (!ts.isClassDeclaration(node)) return;
                const members = new Map(node.members.map(member => [member.name?.getText(source) || 'constructor', member]));
                const edges = new Map(), live = new Set();
                for (const [name, member] of members) {
                    const refs = new Set();
                    walk(member, child => {
                        if (ts.isPropertyAccessExpression(child) && child.expression.kind === ts.SyntaxKind.ThisKeyword) refs.add(child.name.text);
                        // 动态成员访问无法可靠静态判定，保守地保留该类全部成员。
                        if (ts.isElementAccessExpression(child) && child.expression.kind === ts.SyntaxKind.ThisKeyword) for (const key of members.keys()) refs.add(key);
                    });
                    edges.set(name, refs);
                    const privateMember = member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword);
                    if (!privateMember || ts.isPropertyDeclaration(member)
                        || ['onLoad', 'start', 'update', 'lateUpdate', 'onEnable', 'onDisable', 'onDestroy'].includes(name)) live.add(name);
                }
                const pending = [...live];
                for (let i = 0; i < pending.length; i++) for (const ref of edges.get(pending[i]) || []) {
                    if (!live.has(ref)) { live.add(ref); pending.push(ref); }
                }
                for (const [name, member] of members) {
                    if (live.has(name)) continue;
                    let referencesArt = false;
                    walk(member, child => { if (ts.isIdentifier(child) && aliases.has(child.text)) referencesArt = true; });
                    if (referencesArt) dead.push(`${path.relative(root, file)}:${name}`);
                }
            });
        }
    }
    assert.deepEqual(dead, [], '发现仅由不可达旧方法引用的 UI 素材，需要核对生产调用链');
});

test('精简后的 Prefab 索引、父子关系和组件归属完整，并满足构建器节点契约', () => {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/ui/SpeedStarsUI.prefab'), 'utf8'));
    function checkRefs(value) {
        if (!value || typeof value !== 'object') return;
        if ('__id__' in value) assert.ok(Number.isInteger(value.__id__) && value.__id__ >= 0 && value.__id__ < data.length);
        assert.ok(!('__uuid__' in value), '界面美术现由运行时加载，不应重新引入旧 Prefab 位图依赖');
        Object.values(value).forEach(checkRefs);
    }
    checkRefs(data);
    const nodes = new Set();
    for (const [index, object] of data.entries()) {
        if (object.__type__ !== 'cc.Node') continue;
        nodes.add(object._name);
        for (const child of object._children) assert.equal(data[child.__id__]._parent.__id__, index);
        for (const component of object._components) assert.equal(data[component.__id__].node.__id__, index);
    }
    assert.ok(!nodes.has('ResultPanel'));
    const source = ts.createSourceFile('builder.ts', fs.readFileSync(path.join(root, 'assets/scripts/ui/SpeedStarsUiPrefabBuilder.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    walk(source, node => {
        if (ts.isCallExpression(node) && ['requireNode', 'requireLabel'].includes(node.expression.getText(source)) && ts.isStringLiteral(node.arguments[1])) {
            assert.ok(nodes.has(node.arguments[1].text), `构建器需要的节点缺失：${node.arguments[1].text}`);
        }
    });
    for (const name of ['Distance50Button', 'Distance100Button', 'Distance200Button', 'TopLeftPlate', 'Placement', 'TimerPlate', 'Timer', 'SpeedValue', 'SpeedBarRoot']) assert.ok(nodes.has(name));
});
