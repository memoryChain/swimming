'use strict';

// 从 0.0.4 副本添加业务事件，保留此前引擎、字体诊断与所有资源。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const parser = require(path.join(root, 'extensions/taptap-minigame-tools/converter/node_modules/@babel/parser'));
const traverse = require(path.join(root, 'extensions/taptap-minigame-tools/converter/node_modules/@babel/traverse')).default;
const GLOBAL = 'globalThis.__swimmingTapEvents';

function instrumentMain(source) {
    if (source.includes(GLOBAL)) throw new Error('输入包已包含事件插桩，拒绝重复生成。');
    const edits = [], found = { flow: 0, manager: 0, attach: 0, lobby: 0 };
    const ast = parser.parse(source, { sourceType: 'script' });
    const surround = (node, prefix, suffix) => {
        edits.push({ at: node.start, text: prefix }, { at: node.end, text: suffix });
    };
    traverse(ast, {
        CallExpression(modulePath) {
            const call = modulePath.node;
            if (call.callee.type !== 'MemberExpression' || call.callee.object.name !== 'System'
                || call.callee.property.name !== 'register') return;
            const moduleId = call.arguments[0]?.value;
            const factory = call.arguments[call.arguments.length - 1];
            const exportName = factory.params?.[0]?.name;
            if (!['chunks:///_virtual/GameFlowController.ts', 'chunks:///_virtual/GameManager.ts',
                'chunks:///_virtual/LoginManager.ts'].includes(moduleId)) return;
            const aliases = {};
            modulePath.traverse({ AssignmentExpression(p) {
                const right = p.node.right;
                if (p.node.left.type === 'Identifier' && right.type === 'MemberExpression'
                    && ['getRaceDifficultyConfig', 'getRaceDistance', 'getPlayerCharacterSelection'].includes(right.property.name)) {
                    aliases[right.property.name] = p.node.left.name;
                }
            } });
            modulePath.traverse({
                CallExpression(p) {
                    const node = p.node;
                    if (node.callee.type === 'Identifier' && node.callee.name === exportName && node.arguments.length === 2) {
                        const name = node.arguments[0]?.value;
                        if (name === 'GameFlowController') { surround(node.arguments[1], `${GLOBAL}.wrapFlow(`, ')'); found.flow++; }
                        if (name === 'GameManager') { surround(node.arguments[1], `${GLOBAL}.wrapManager(`, ')'); found.manager++; }
                    }
                    if (moduleId !== 'chunks:///_virtual/LoginManager.ts' || node.callee.type !== 'MemberExpression'
                        || node.callee.property.name !== 'build' || node.arguments.length !== 4) return;
                    const callback = node.arguments[3];
                    if (callback.type !== 'FunctionExpression' || callback.params.length !== 2) return;
                    // 只在登录 UI 异步加载成功并有有效根节点时记录，不以场景加载代替可操作大厅。
                    let hasRoot = false, hasRetry = false;
                    p.get('arguments.3').traverse({ MemberExpression(q) {
                        if (q.node.property.name === '_loginUiRoot') hasRoot = true;
                        if (q.node.property.name === '_loginUiRetries') hasRetry = true;
                    } });
                    if (!hasRoot || !hasRetry) return;
                    const error = callback.params[0].name, refs = callback.params[1].name;
                    edits.push({ at: callback.body.end - 1,
                        text: `;if(!${error}&&${refs}&&${refs}.root&&${refs}.root.isValid){${GLOBAL}.lobbyReady();}` });
                    found.lobby++;
                },
                AssignmentExpression(p) {
                    const node = p.node, left = node.left, right = node.right;
                    if (moduleId !== 'chunks:///_virtual/GameManager.ts' || left.type !== 'MemberExpression'
                        || left.property.name !== '_gameFlow' || right.type !== 'CallExpression'
                        || right.callee.type !== 'MemberExpression' || right.callee.property.name !== 'createGameFlow') return;
                    const required = ['getRaceDifficultyConfig', 'getRaceDistance', 'getPlayerCharacterSelection'];
                    if (required.some(key => !aliases[key])) throw new Error('比赛配置依赖不完整，停止插桩。');
                    const owner = source.slice(left.object.start, left.object.end);
                    const context = `function(){return {mode:${aliases.getRaceDifficultyConfig}().id,`
                        + `distance:${aliases.getRaceDistance}(),character_id:${aliases.getPlayerCharacterSelection}().characterId,`
                        + `play_type:${owner}._netSession?'network':'local',test_type:'normal'};}`;
                    surround(right, `${GLOBAL}.attachFlow(`, `,${owner},${context})`);
                    found.attach++;
                }
            });
        }
    });
    if (Object.values(found).some(count => count !== 1)) throw new Error(`业务事件锚点不匹配：${JSON.stringify(found)}`);
    for (const edit of edits.sort((a, b) => b.at - a.at)) source = source.slice(0, edit.at) + edit.text + source.slice(edit.at);
    parser.parse(source, { sourceType: 'script' });
    return { source, anchors: found };
}

async function main() {
    const sourceDir = path.join(root, 'build/TapDiagnostic-0.0.4/game');
    const target = path.join(root, 'build/TapEvents-0.0.5');
    if (fs.existsSync(target)) throw new Error(`输出目录已存在：${target}`);
    const config = JSON.parse(fs.readFileSync(path.join(sourceDir, 'game.json'), 'utf8'));
    if (config.productVersion !== '0.0.4') throw new Error('源包必须是 0.0.4 字体诊断包。');
    const mainPath = 'assets/main/index.js';
    const inputMain = fs.readFileSync(path.join(sourceDir, mainPath), 'utf8');
    const instrumented = instrumentMain(inputMain);
    const entry = fs.readFileSync(path.join(sourceDir, 'game.js'), 'utf8');
    const anchor = "var tapStartupDiagnostic = require('./tap-startup-diagnostic');";
    if (entry.split(anchor).length !== 2) throw new Error('启动入口锚点变化，停止生成。');
    const game = path.join(target, 'game');
    fs.cpSync(sourceDir, game, { recursive: true });
    config.productVersion = '0.0.5';
    const eventConfig = { version: '0.0.5', endpoint: '', test_transport_enabled: false };
    fs.writeFileSync(path.join(game, 'game.json'), JSON.stringify(config, null, 2));
    fs.writeFileSync(path.join(game, 'tap-event-config.json'), JSON.stringify(eventConfig, null, 2));
    fs.copyFileSync(path.join(__dirname, 'templates/taptap-event-test.js'), path.join(game, 'tap-event-test.js'));
    fs.writeFileSync(path.join(game, mainPath), instrumented.source);
    fs.writeFileSync(path.join(game, 'game.js'), entry.replace(anchor, anchor
        + "\nrequire('./tap-event-test').install(globalThis, require('./tap-event-config.json'));"));
    const startup = path.join(game, 'tap-startup-diagnostic.js');
    fs.writeFileSync(startup, fs.readFileSync(startup, 'utf8').replaceAll('tap-startup-004-', 'tap-startup-005-')
        .replace("version: '0.0.4'", "version: '0.0.5'"));
    // 字体诊断逻辑原样保留，仅同步它显示的包版本。
    const font = path.join(game, 'tap-font-diagnostic.js');
    fs.writeFileSync(font, fs.readFileSync(font, 'utf8').replace("version: '0.0.4'", "version: '0.0.5'"));
    const archive = require(path.join(root, 'extensions/taptap-minigame-tools/node_modules/archiver'))('zip', { zlib: { level: 9 } });
    await new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(path.join(target, 'game.zip'));
        stream.on('close', resolve); stream.on('error', reject); archive.on('error', reject);
        archive.pipe(stream); archive.directory(game, false); archive.finalize().catch(reject);
    });
    const zip = path.join(target, 'game.zip');
    const receipt = { version: '0.0.5', sourceVersion: '0.0.4', mode: 'local_only',
        backendStatus: 'TapDB initializing; project ID not yet available', anchors: instrumented.anchors,
        bytes: fs.statSync(zip).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex') };
    if (receipt.bytes >= 20000000) throw new Error('测试包超过当前后台 20 MB 预算。');
    fs.writeFileSync(path.join(target, 'receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ zip, ...receipt }));
}
module.exports = { instrumentMain };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
