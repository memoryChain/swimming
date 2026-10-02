'use strict';

// 独立启动对照包：验证微信专用绘制等待是否阻塞 TapTap；不代表真机根因已确认。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { replaceOnce } = require('./create-taptap-guarded-build.cjs');
const { audit } = require('./audit-taptap-startup.cjs');
const root = path.resolve(__dirname, '..');

function directEntry(input) {
    let source = input.replace(/\r\n/g, '\n');
    source = replaceOnce(source,
        "    var firstScreen = boot.step('first-screen-import', function () { return require('./first-screen'); });",
        "    boot.note('startup-policy', { mode: 'direct-engine', experimental: true });");
    source = replaceOnce(source, `    boot.step('first-screen-start', function () { return firstScreen.start('default', 'default', 'false'); })
      .then(function () { return boot.step('application-import', function () { return System['import']('./application.js'); }); })
      .then(function (module) {
        return boot.step('progress-20', function () { return firstScreen.setProgress(0.2); })
          .then(function () { return new module.Application(); });
      }).then(function (application) {
        return boot.step('progress-40', function () { return firstScreen.setProgress(0.4); })
          .then(function () { return application; });
      }).then(function (application) {`,
        `    boot.step('application-import', function () { return System['import']('./application.js'); })
      .then(function (module) { return new module.Application(); })
      .then(function (application) {`);
    source = replaceOnce(source, `          .then(function (cc) {
            return boot.step('progress-60', function () { return firstScreen.setProgress(0.6); })
              .then(function () { return cc; });
          }).then(function (cc) {`, '          .then(function (cc) {');
    source = replaceOnce(source, `          }).then(function () {
            return boot.step('first-screen-end', function () { return firstScreen.end(); });
          }).then(function () {`, '          }).then(function () {');
    source = replaceOnce(source, `  var sysInfo = boot.step('host-system-info', function () { return wx.getSystemInfoSync(); });
  if (sysInfo.platform.toLocaleLowerCase() === 'android') {
    boot.mark('android-first-frame');
    GameGlobal.requestAnimationFrame(__initApp);
  } else { __initApp(); }`, `  // 微信模板为取得第二帧尺寸而延迟整个初始化。TapTap 对照包先创建适配器和画布，
  // 由引擎自身启动渲染循环；不改全局 requestAnimationFrame，也不绕过引擎资源就绪。
  boot.mark('direct-init-app');
  __initApp();`);
    new vm.Script(source);
    return source;
}

async function build() {
    const source = path.join(root, 'build/TapTiming-0.0.7/game');
    const destination = path.join(root, 'build/TapDirectStart-0.0.8');
    const game = path.join(destination, 'game'), version = '0.0.8';
    if (fs.existsSync(destination)) throw new Error('输出已存在，拒绝覆盖：' + destination);
    const baselineHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(source, '../game.zip'))).digest('hex');
    if (baselineHash !== '76a623b26f2c7d2021e7b980be3231e5dec391ee23f619bdcb352615f0805c91') {
        throw new Error('0.0.7 基线 ZIP 与已上传版本不一致');
    }
    const baseline = await audit(source);
    if (baseline.zip.errors.length || baseline.manifestErrors.length || baseline.syntaxErrors.length || baseline.jsonErrors.length) {
        throw new Error('0.0.7 解包目录与基线不一致或审计失败');
    }
    const config = JSON.parse(fs.readFileSync(path.join(source, 'game.json'), 'utf8'));
    if (config.productVersion !== '0.0.7') throw new Error('基线版本必须为 0.0.7');
    const signature = 'tap-direct-008-' + baselineHash.slice(0, 12);
    let entry = directEntry(fs.readFileSync(path.join(source, 'game.js'), 'utf8'));
    entry = entry.replaceAll("version: '0.0.7'", "version: '0.0.8'")
        .replace('tap-timing-007-4426358c50e1', signature);
    fs.cpSync(source, game, { recursive: true });
    fs.writeFileSync(path.join(game, 'game.js'), entry);
    config.productVersion = version;
    fs.writeFileSync(path.join(game, 'game.json'), JSON.stringify(config, null, 2));
    const eventConfig = JSON.parse(fs.readFileSync(path.join(game, 'tap-event-config.json'), 'utf8'));
    eventConfig.version = version;
    fs.writeFileSync(path.join(game, 'tap-event-config.json'), JSON.stringify(eventConfig, null, 2));
    for (const name of ['tap-font-diagnostic.js', 'tap-startup-diagnostic.js']) {
        const file = path.join(game, name);
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("version: '0.0.7'", "version: '0.0.8'")
            .replace('tap-startup-007-', 'tap-startup-008-'));
    }
    const zip = path.join(destination, 'game.zip');
    const archive = require(path.join(root, 'extensions/taptap-minigame-tools/node_modules/archiver'))('zip', { zlib: { level: 9 } });
    await new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(zip);
        stream.on('close', resolve); stream.on('error', reject); archive.on('error', reject);
        archive.pipe(stream); archive.directory(game, false); archive.finalize().catch(reject);
    });
    const report = await audit(game, source);
    const allowed = ['game.js', 'game.json', 'tap-event-config.json', 'tap-font-diagnostic.js', 'tap-startup-diagnostic.js'];
    if (report.zip.errors.length || report.syntaxErrors.length || report.jsonErrors.length || report.manifestErrors.length
        || report.difference.added.length || report.difference.removed.length
        || report.difference.changed.some(file => !allowed.includes(file))) {
        throw new Error('对照包出现非预期差异或审计失败');
    }
    const receipt = { version, sourceVersion: '0.0.7', baselineHash, signature,
        mode: 'direct-engine-experiment', deviceValidated: false,
        bytes: fs.statSync(zip).size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), difference: report.difference };
    if (receipt.bytes >= 20000000) throw new Error('对照包超过 20 MB 预算');
    fs.writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2));
    fs.writeFileSync(path.join(destination, 'startup-audit.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(receipt, null, 2));
}
module.exports = { directEntry };
if (require.main === module) build().catch(error => { console.error(error); process.exitCode = 1; });
