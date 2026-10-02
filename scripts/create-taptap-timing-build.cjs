'use strict';

// 从已上传的 0.0.6 创建独立计时包，保留其引擎、模型、贴图和启动语义。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const { replaceOnce } = require('./create-taptap-guarded-build.cjs');
const { audit } = require('./audit-taptap-startup.cjs');
const parser = require(path.join(root, 'extensions/taptap-minigame-tools/converter/node_modules/@babel/parser'));
const traverse = require(path.join(root, 'extensions/taptap-minigame-tools/converter/node_modules/@babel/traverse')).default;

function instrumentMain(source) {
    if (source.includes('__swimmingTapTiming')) throw new Error('拒绝重复计时插桩');
    const edits = [], found = { LoginManager: 0, GameManager: 0, GameFlowController: 0 };
    traverse(parser.parse(source, { sourceType: 'script' }), {
        CallExpression(p) {
            const call = p.node;
            if (call.callee.type !== 'MemberExpression' || call.callee.object.name !== 'System'
                || call.callee.property.name !== 'register') return;
            const moduleId = call.arguments[0]?.value;
            const className = moduleId === 'chunks:///_virtual/LoginManager.ts' ? 'LoginManager'
                : moduleId === 'chunks:///_virtual/GameManager.ts' ? 'GameManager'
                    : moduleId === 'chunks:///_virtual/GameFlowController.ts' ? 'GameFlowController' : null;
            if (!className) return;
            const factory = call.arguments[call.arguments.length - 1], exportName = factory.params?.[0]?.name;
            p.traverse({ CallExpression(q) {
                const node = q.node;
                if (node.callee.type !== 'Identifier' || node.callee.name !== exportName
                    || node.arguments.length !== 2 || node.arguments[0].value !== className) return;
                const arg = node.arguments[1], method = className === 'LoginManager' ? 'wrapLogin'
                    : className === 'GameManager' ? 'wrapManager' : 'wrapFlow';
                // 安装失败时走原类导出；只包装生命周期，不修改类内部行为或比赛输入。
                edits.push({ at: arg.start, text: `((globalThis.__swimmingTapTiming&&globalThis.__swimmingTapTiming.${method})||function(value){return value;})(` },
                    { at: arg.end, text: ')' });
                found[className]++;
            } });
        }
    });
    if (Object.values(found).some(count => count !== 1)) throw new Error('计时锚点不匹配：' + JSON.stringify(found));
    for (const edit of edits.sort((a, b) => b.at - a.at)) source = source.slice(0, edit.at) + edit.text + source.slice(edit.at);
    parser.parse(source, { sourceType: 'script' });
    return { source, anchors: found };
}

function instrumentEvents(source) {
    source = replaceOnce(source, '    var api = options.api || {}, config = options.config || {};',
        '    var api = options.api || {}, config = options.config || {}, timing = options.timing;');
    source = replaceOnce(source, "        log('local', entry);", "        log('local', entry);\n        if (timing) { try { timing.business(name); } catch (_) {} }");
    source = replaceOnce(source, '                s.race = null; s.ended = false; s.again = false;',
        "                s.race = null; s.ended = false; s.again = false;\n                if (timing) { try { timing.transition('race_setup'); } catch (_) {} }");
    source = replaceOnce(source, '                idle(manager._gameFlow);',
        "                idle(manager._gameFlow);\n                if (timing) { try { timing.transition('return_to_lobby'); } catch (_) {} }");
    source = replaceOnce(source, "config: config });", "config: config, timing: root.__swimmingTapTiming });");
    source = replaceOnce(source, "            if (name === 'lobbyReady') {", "            if (name === 'lobbyReady') {\n                try { if (root.__swimmingTapTiming) root.__swimmingTapTiming.business('lobby_ready'); } catch (_) {}");
    new vm.Script(source);
    return source;
}

async function build() {
    const version = '0.0.7', source = path.join(root, 'build/TapGuard-0.0.6/game');
    const destination = path.join(root, 'build/TapTiming-0.0.7'), game = path.join(destination, 'game');
    if (fs.existsSync(destination)) throw new Error('输出目录已存在，拒绝覆盖：' + destination);
    const config = JSON.parse(fs.readFileSync(path.join(source, 'game.json'), 'utf8'));
    if (config.productVersion !== '0.0.6') throw new Error('计时基线必须是 0.0.6');
    const signature = 'tap-timing-007-' + crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(source, '..', 'game.zip'))).digest('hex').slice(0, 12);
    let entry = fs.readFileSync(path.join(source, 'game.js'), 'utf8')
        .replace("version: '0.0.6'", "version: '0.0.7'").replace(/tap-guard-006-[a-f0-9]+/, signature);
    entry = "try { require('./tap-timing-diagnostic').install(globalThis, { version: '0.0.7' }); } catch (_) {}\n" + entry;
    entry = replaceOnce(entry, "    boot.attachHost(typeof tap !== 'undefined' ? tap : wx);",
        "    boot.attachHost(typeof tap !== 'undefined' ? tap : wx);\n    boot.auxiliary('timing-host', function () { if (globalThis.__swimmingTapTiming) globalThis.__swimmingTapTiming.attachHost(typeof tap !== 'undefined' ? tap : wx); });");
    entry = replaceOnce(entry, "            boot.step('engine-adapter', function () { require('./engine-adapter'); });",
        "            boot.step('engine-adapter', function () { require('./engine-adapter'); });\n            boot.auxiliary('timing-engine', function () { if (globalThis.__swimmingTapTiming) globalThis.__swimmingTapTiming.attachEngine(cc); });");
    let guard = fs.readFileSync(path.join(source, 'tap-startup-guard.js'), 'utf8');
    guard = replaceOnce(guard, '    function log(name, data) {',
        '    function log(name, data) {\n        try { if (root.__swimmingTapTiming) root.__swimmingTapTiming.captureBoot(name, data); } catch (_) {}');
    const main = instrumentMain(fs.readFileSync(path.join(source, 'assets/main/index.js'), 'utf8'));
    const events = instrumentEvents(fs.readFileSync(path.join(source, 'tap-event-test.js'), 'utf8'));
    for (const text of [entry, guard, events]) new vm.Script(text);
    fs.cpSync(source, game, { recursive: true });
    fs.writeFileSync(path.join(game, 'game.js'), entry);
    fs.writeFileSync(path.join(game, 'tap-startup-guard.js'), guard);
    fs.writeFileSync(path.join(game, 'assets/main/index.js'), main.source);
    fs.writeFileSync(path.join(game, 'tap-event-test.js'), events);
    fs.copyFileSync(path.join(__dirname, 'templates/taptap-timing-diagnostic.js'), path.join(game, 'tap-timing-diagnostic.js'));
    config.productVersion = version;
    fs.writeFileSync(path.join(game, 'game.json'), JSON.stringify(config, null, 2));
    const eventConfig = JSON.parse(fs.readFileSync(path.join(game, 'tap-event-config.json'), 'utf8'));
    eventConfig.version = version;
    fs.writeFileSync(path.join(game, 'tap-event-config.json'), JSON.stringify(eventConfig, null, 2));
    for (const name of ['tap-startup-diagnostic.js', 'tap-font-diagnostic.js']) {
        const file = path.join(game, name);
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("version: '0.0.6'", "version: '0.0.7'")
            .replace('tap-startup-006-', 'tap-startup-007-'));
    }
    const zip = path.join(destination, 'game.zip');
    const archive = require(path.join(root, 'extensions/taptap-minigame-tools/node_modules/archiver'))('zip', { zlib: { level: 9 } });
    await new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(zip); stream.on('close', resolve); stream.on('error', reject);
        archive.on('error', reject); archive.pipe(stream); archive.directory(game, false); archive.finalize().catch(reject);
    });
    const report = await audit(game, source);
    if (report.zip.errors.length || report.syntaxErrors.length || report.jsonErrors.length || report.manifestErrors.length) {
        throw new Error('计时包审计失败：' + JSON.stringify(report));
    }
    if (report.difference.changed.some(name => !['game.js', 'game.json', 'tap-startup-guard.js', 'tap-event-config.json',
        'tap-event-test.js', 'tap-startup-diagnostic.js', 'tap-font-diagnostic.js', 'assets/main/index.js'].includes(name))) {
        throw new Error('计时包存在非预期资源变化');
    }
    const receipt = { version, sourceVersion: '0.0.6', signature, anchors: main.anchors, mode: 'local_only',
        observationBoundary: 'game_entry', bytes: fs.statSync(zip).size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), difference: report.difference };
    if (receipt.bytes >= 20000000) throw new Error('计时包超过保守 20 MB 预算');
    fs.writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2));
    fs.writeFileSync(path.join(destination, 'startup-audit.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ zip, ...receipt }, null, 2));
}
module.exports = { instrumentMain, instrumentEvents };
if (require.main === module) build().catch(error => { console.error(error); process.exitCode = 1; });
