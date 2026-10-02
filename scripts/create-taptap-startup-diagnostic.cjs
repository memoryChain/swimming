'use strict';

// 仅复制现有 Tap 产物并添加启动诊断，不修改 Creator 工程或原始包。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const parser = require(path.join(root, 'extensions/taptap-minigame-tools/converter/node_modules/@babel/parser'));
const traverse = require(path.join(root, 'extensions/taptap-minigame-tools/converter/node_modules/@babel/traverse')).default;

function instrumentEngine(source) {
    const edits = [];
    let registrations = 0;
    let swapchains = 0;
    traverse(parser.parse(source, { sourceType: 'script' }), {
        AssignmentExpression(p) {
            const left = p.node.left;
            if (left.type !== 'MemberExpression') return;
            if (left.property.name === 'WebGLDevice') {
                if (p.parent.type !== 'ExpressionStatement' || left.object.type !== 'Identifier') {
                    throw new Error('WebGL 注册结构变化，停止生成诊断包。');
                }
                registrations++;
                const legacy = left.object.name;
                edits.push({ at: p.parent.end, text: `console.log('[TapStartup] registered '+JSON.stringify({webgl:typeof ${legacy}.WebGLDevice,webgl2:typeof ${legacy}.WebGL2Device}));` });
            }
            if (left.property.name === '_initSwapchain' && p.node.right.type === 'FunctionExpression') {
                swapchains++;
                const owner = p.scope.getBinding(left.object.name);
                // 从同一原型的 init 函数读取实际使用的 legacy 对象，避免依赖压缩变量名。
                let legacy;
                const scope = owner.scope.path;
                scope.traverse({ MemberExpression(q) {
                    if (q.node.property.name === 'WebGLDevice' && q.node.object.type === 'Identifier') legacy = q.node.object.name;
                } });
                if (!legacy) throw new Error('找不到渲染管理器使用的 WebGL 注册对象。');
                edits.push({ at: p.node.right.body.start + 1, text: `console.log('[TapStartup] swapchain '+JSON.stringify({device:typeof this._gfxDevice,initialized:this._deviceInitialized,renderType:this._renderType,webgl:typeof ${legacy}.WebGLDevice,webgl2:typeof ${legacy}.WebGL2Device}));` });
            }
        },
    });
    if (registrations !== 1 || swapchains !== 1) throw new Error(`引擎诊断锚点不匹配：注册 ${registrations}，交换链 ${swapchains}。`);
    for (const edit of edits.sort((a, b) => b.at - a.at)) source = source.slice(0, edit.at) + edit.text + source.slice(edit.at);
    parser.parse(source, { sourceType: 'script' });
    return source;
}

function instrumentEntry(source) {
    const anchor = "      require('./engine-adapter');";
    if (source.split(anchor).length !== 2) throw new Error('启动入口结构变化，停止生成诊断包。');
    return "var tapStartupDiagnostic = require('./tap-startup-diagnostic');\n"
        + source.replace(anchor, "      tapStartupDiagnostic.ready(cc, 'before-adapter');\n" + anchor
            + "\n      tapStartupDiagnostic.ready(cc, 'after-adapter');")
            .replace('    console.error(err);', "    tapStartupDiagnostic.failed(err);\n    console.error(err);");
}

async function buildDiagnostic() {
    const input = path.join(root, 'build/TapBuild/game');
    const output = path.join(root, 'build/TapDiagnostic-0.0.3');
    if (fs.existsSync(output)) throw new Error(`诊断目录已经存在，请保留或改名后重试：${output}`);
    const config = JSON.parse(fs.readFileSync(path.join(input, 'game.json'), 'utf8'));
    if (config.productVersion !== '0.0.2') throw new Error(`仅接受已确认的 0.0.2 产物，当前为 ${config.productVersion}`);
    const engine = fs.readFileSync(path.join(input, 'cocos-js/cc.js'), 'utf8');
    const instrumented = instrumentEngine(engine);
    const entry = instrumentEntry(fs.readFileSync(path.join(input, 'game.js'), 'utf8'));
    const signature = 'tap-startup-003-' + crypto.createHash('sha256').update(engine).digest('hex').slice(0, 12);
    const game = path.join(output, 'game');
    fs.cpSync(input, game, { recursive: true });
    config.productVersion = '0.0.3';
    fs.writeFileSync(path.join(game, 'game.json'), JSON.stringify(config, null, 2));
    fs.writeFileSync(path.join(game, 'game.js'), entry);
    fs.writeFileSync(path.join(game, 'cocos-js/cc.js'), instrumented);
    const template = fs.readFileSync(path.join(__dirname, 'templates/taptap-startup-diagnostic.js'), 'utf8');
    fs.writeFileSync(path.join(game, 'tap-startup-diagnostic.js'), template.replace('__DIAGNOSTIC_SIGNATURE__', signature));
    const archiver = require(path.join(root, 'extensions/taptap-minigame-tools/node_modules/archiver'));
    await new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(path.join(output, 'game.zip'));
        const archive = archiver('zip', { zlib: { level: 9 } });
        stream.on('error', reject);
        stream.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(stream);
        archive.directory(game, false);
        archive.finalize().catch(reject);
    });
    console.log(JSON.stringify({ signature, version: config.productVersion, zip: path.join(output, 'game.zip'), bytes: fs.statSync(path.join(output, 'game.zip')).size }));
}

module.exports = { instrumentEngine, instrumentEntry };
if (require.main === module) buildDiagnostic().catch(error => { console.error(error); process.exitCode = 1; });
