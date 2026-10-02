'use strict';

// 保留失败样本的字体和引擎，只增加 CPU/GPU 读回与有条件补传实验。
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { audit } = require('./audit-taptap-startup.cjs');
const { replaceOnce } = require('./create-taptap-guarded-build.cjs');
const root = path.resolve(__dirname, '..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function build() {
    const source = path.join(root, 'build/TapFontFamily-0.0.11/game');
    const target = path.join(root, 'build/TapTextureProbe-0.0.12'), game = path.join(target, 'game');
    if (fs.existsSync(target)) throw Error('输出已存在，拒绝覆盖');
    const baselineHash = hash(path.join(source, '../game.zip'));
    if (baselineHash !== '7177935e6ba74cee91956be21d36fa92fe8c14447f1be1ee10ad0cb9ae8884a8') throw Error('0.0.11 基线不匹配');
    const checked = await audit(source);
    if (checked.zip.errors.length || checked.manifestErrors.length || checked.syntaxErrors.length || checked.jsonErrors.length) throw Error('基线审计失败');
    const config = JSON.parse(fs.readFileSync(path.join(source, 'game.json'), 'utf8'));
    if (config.productVersion !== '0.0.11') throw Error('基线版本错误');
    fs.cpSync(source, game, { recursive: true });
    let entry = replaceOnce(fs.readFileSync(path.join(game, 'game.js'), 'utf8'),
        "require('./tap-font-diagnostic').install(cc);",
        "require('./tap-font-diagnostic').install(cc, { inspectPage: require('./tap-texture-probe').create(cc, { repairConfirmedBlank: true }) });");
    entry = replaceOnce(entry, 'tap-font-011-b95134117334', 'tap-texture-012-' + baselineHash.slice(0, 12))
        .replaceAll("version: '0.0.11'", "version: '0.0.12'");
    fs.writeFileSync(path.join(game, 'game.js'), entry);
    config.productVersion = '0.0.12'; fs.writeFileSync(path.join(game, 'game.json'), JSON.stringify(config, null, 2));
    const eventConfig = JSON.parse(fs.readFileSync(path.join(game, 'tap-event-config.json'), 'utf8'));
    eventConfig.version = '0.0.12';
    fs.writeFileSync(path.join(game, 'tap-event-config.json'), JSON.stringify(eventConfig, null, 2));
    fs.writeFileSync(path.join(game, 'tap-font-diagnostic.js'), fs.readFileSync(path.join(__dirname, 'templates/taptap-font-diagnostic.js'), 'utf8').replace("version: '0.0.4'", "version: '0.0.12'"));
    fs.copyFileSync(path.join(__dirname, 'templates/taptap-texture-probe.js'), path.join(game, 'tap-texture-probe.js'));
    const startup = path.join(game, 'tap-startup-diagnostic.js');
    fs.writeFileSync(startup, fs.readFileSync(startup, 'utf8').replaceAll("version: '0.0.11'", "version: '0.0.12'").replaceAll('tap-startup-011-', 'tap-startup-012-'));
    const archive = require(path.join(root, 'extensions/taptap-minigame-tools/node_modules/archiver'))('zip', { zlib: { level: 9 } });
    const zip = path.join(target, 'game.zip');
    await new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(zip); stream.on('close', resolve); stream.on('error', reject); archive.on('error', reject);
        archive.pipe(stream); archive.directory(game, false); archive.finalize().catch(reject);
    });
    const report = await audit(game, source);
    const allowed = ['game.js', 'game.json', 'tap-event-config.json', 'tap-font-diagnostic.js', 'tap-startup-diagnostic.js'];
    if (report.zip.errors.length || report.manifestErrors.length || report.syntaxErrors.length || report.jsonErrors.length
        || report.difference.added.length !== 1 || report.difference.added[0] !== 'tap-texture-probe.js'
        || report.difference.removed.length || report.difference.changed.length !== allowed.length
        || report.difference.changed.some(f => !allowed.includes(f))) throw Error('纹理实验出现非预期差异');
    const receipt = { version: '0.0.12', baselineVersion: '0.0.11', baselineHash, deviceValidated: false,
        analyticsMode: 'local_only', experiment: 'readback-and-reupload-only-confirmed-transparent-labels',
        bytes: fs.statSync(zip).size, sha256: hash(zip), difference: report.difference };
    if (receipt.bytes >= 20000000) throw Error('包体超出 20 MB 预算');
    fs.writeFileSync(path.join(target, 'receipt.json'), JSON.stringify(receipt, null, 2));
    fs.writeFileSync(path.join(target, 'startup-audit.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(receipt, null, 2));
}
if (require.main === module) build().catch(error => { console.error(error); process.exitCode = 1; });
