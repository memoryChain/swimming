'use strict';

// 在已验收的启动诊断包副本中补充字体采样，保留原包供对照。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function main() {
    const source = path.join(root, 'build/TapDiagnostic-0.0.3/game');
    const target = path.join(root, 'build/TapDiagnostic-0.0.4');
    if (fs.existsSync(target)) throw new Error(`输出目录已存在：${target}`);
    const config = JSON.parse(fs.readFileSync(path.join(source, 'game.json'), 'utf8'));
    if (config.productVersion !== '0.0.3') throw new Error('源包必须是 0.0.3 启动诊断包。');
    const entry = fs.readFileSync(path.join(source, 'game.js'), 'utf8');
    const anchor = "      tapStartupDiagnostic.ready(cc, 'before-adapter');";
    if (entry.split(anchor).length !== 2) throw new Error('诊断入口锚点发生变化。');
    const game = path.join(target, 'game');
    fs.cpSync(source, game, { recursive: true });
    config.productVersion = '0.0.4';
    fs.writeFileSync(path.join(game, 'game.json'), JSON.stringify(config, null, 2));
    fs.writeFileSync(path.join(game, 'game.js'), entry.replace(anchor,
        anchor + "\n      require('./tap-font-diagnostic').install(cc);"));
    const startup = path.join(game, 'tap-startup-diagnostic.js');
    fs.writeFileSync(startup, fs.readFileSync(startup, 'utf8').replaceAll('tap-startup-003-', 'tap-startup-004-').replace("version: '0.0.3'", "version: '0.0.4'"));
    fs.copyFileSync(path.join(__dirname, 'templates/taptap-font-diagnostic.js'), path.join(game, 'tap-font-diagnostic.js'));
    const archive = require(path.join(root, 'extensions/taptap-minigame-tools/node_modules/archiver'))('zip', { zlib: { level: 9 } });
    await new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(path.join(target, 'game.zip'));
        stream.on('close', resolve); stream.on('error', reject); archive.on('error', reject);
        archive.pipe(stream); archive.directory(game, false); archive.finalize().catch(reject);
    });
    console.log(JSON.stringify({ zip: path.join(target, 'game.zip'), version: '0.0.4', bytes: fs.statSync(path.join(target, 'game.zip')).size }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
