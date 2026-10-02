'use strict';

// 从 0.0.5 创建独立启动保护测试包；保留旧包与所有引擎/美术资源。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const { audit } = require('./audit-taptap-startup.cjs');

function replaceOnce(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error('启动保护锚点变化：' + anchor.slice(0, 65));
    return source.replace(anchor, replacement);
}
function guardFirstScreen(source) {
    if (source.includes('failFirstScreen')) throw new Error('拒绝重复添加启动画面保护');
    source = replaceOnce(source, 'var afterTick = null;', `var afterTick = null;
var pendingReject = null;
var startupFailure = null;
var screenEnded = false;
function failFirstScreen(error) {
  if (screenEnded || startupFailure) return;
  startupFailure = error;
  try { cancelAnimationFrame(rafHandle); } catch (_) {}
  var reject = pendingReject;
  pendingReject = null; afterTick = null;
  if (reject) reject(error);
  try { if (globalThis.__swimmingTapStartup) globalThis.__swimmingTapStartup.failed(error, 'first-screen-frame'); } catch (_) {}
}`);
    source = replaceOnce(source, `    draw();
    tick();
    if (afterTick) {
      afterTick();
      afterTick = null;
    }`, `    try {
      draw();
      tick();
      if (afterTick) {
        var resolve = afterTick;
        afterTick = null; pendingReject = null;
        resolve();
      }
    } catch (error) { failFirstScreen(error); }`);
    source = replaceOnce(source, '    cancelAnimationFrame(rafHandle);', '    screenEnded = true;\n    cancelAnimationFrame(rafHandle);');
    source = replaceOnce(source, `    afterTick = function afterTick() {
      resolve();
    };`, `    if (startupFailure) { reject(startupFailure); return; }
    pendingReject = reject;
    afterTick = function afterTick() { resolve(); };`);
    source = replaceOnce(source, '  initVertexBuffer();', `  if (!gl) throw new Error('first-screen WebGL context unavailable');
  initVertexBuffer();`);
    source = replaceOnce(source, `    return setProgress(0);
  });`, `    return setProgress(0);
  }, function (error) { failFirstScreen(error); throw error; });`);
    new vm.Script(source);
    return source;
}

async function build() {
    const source = path.join(root, 'build/TapEvents-0.0.5/game');
    const destination = path.join(root, 'build/TapGuard-0.0.6'), game = path.join(destination, 'game');
    if (fs.existsSync(destination)) throw new Error('输出目录已存在，保留后再选择新版本：' + destination);
    const config = JSON.parse(fs.readFileSync(path.join(source, 'game.json'), 'utf8'));
    if (config.productVersion !== '0.0.5') throw new Error('源包版本必须为 0.0.5');
    const sourceZip = fs.readFileSync(path.join(source, '..', 'game.zip'));
    const signature = 'tap-guard-006-' + crypto.createHash('sha256').update(sourceZip).digest('hex').slice(0, 12);
    const firstScreen = guardFirstScreen(fs.readFileSync(path.join(source, 'first-screen.js'), 'utf8'));
    const entry = fs.readFileSync(path.join(__dirname, 'templates/taptap-guarded-entry.js'), 'utf8')
        .replace('__VERSION__', '0.0.6').replace('__SIGNATURE__', signature);
    new vm.Script(entry);
    fs.cpSync(source, game, { recursive: true });
    fs.writeFileSync(path.join(game, 'game.js'), entry);
    fs.writeFileSync(path.join(game, 'first-screen.js'), firstScreen);
    fs.copyFileSync(path.join(__dirname, 'templates/taptap-startup-guard.js'), path.join(game, 'tap-startup-guard.js'));
    fs.copyFileSync(path.join(__dirname, 'templates/taptap-event-test.js'), path.join(game, 'tap-event-test.js'));
    config.productVersion = '0.0.6';
    fs.writeFileSync(path.join(game, 'game.json'), JSON.stringify(config, null, 2));
    const events = JSON.parse(fs.readFileSync(path.join(game, 'tap-event-config.json'), 'utf8'));
    events.version = '0.0.6';
    fs.writeFileSync(path.join(game, 'tap-event-config.json'), JSON.stringify(events, null, 2));
    for (const file of ['tap-startup-diagnostic.js', 'tap-font-diagnostic.js']) {
        const absolute = path.join(game, file);
        let text = fs.readFileSync(absolute, 'utf8').replace("version: '0.0.5'", "version: '0.0.6'")
            .replace('tap-startup-005-', 'tap-startup-006-');
        if (file === 'tap-startup-diagnostic.js') {
            text = replaceOnce(text, "    console.log('[TapStartup] ' + stage + ' ' + JSON.stringify(state));",
                "    try { console.log('[TapStartup] ' + stage + ' ' + JSON.stringify(state)); } catch (_) {}");
        }
        fs.writeFileSync(absolute, text);
    }
    const archive = require(path.join(root, 'extensions/taptap-minigame-tools/node_modules/archiver'))('zip', { zlib: { level: 9 } });
    const zip = path.join(destination, 'game.zip');
    await new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(zip);
        stream.on('close', resolve); stream.on('error', reject); archive.on('error', reject);
        archive.pipe(stream); archive.directory(game, false); archive.finalize().catch(reject);
    });
    const report = await audit(game, source);
    if (report.zip.errors.length || report.syntaxErrors.length || report.jsonErrors.length || report.manifestErrors.length) {
        throw new Error('新包文件审计失败：' + JSON.stringify(report));
    }
    fs.writeFileSync(path.join(destination, 'startup-audit.json'), JSON.stringify(report, null, 2));
    const receipt = { version: '0.0.6', sourceVersion: '0.0.5', signature,
        mode: events.test_transport_enabled ? 'configured_receiver' : 'local_only',
        bytes: fs.statSync(zip).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'),
        difference: report.difference };
    if (receipt.bytes >= 20000000) throw new Error('新包超过项目保守 20 MB 预算');
    fs.writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ zip, ...receipt }, null, 2));
}
module.exports = { guardFirstScreen, replaceOnce };
if (require.main === module) build().catch(error => { console.error(error); process.exitCode = 1; });
