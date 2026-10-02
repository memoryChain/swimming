'use strict';

// 固定 0.0.9 可启动基线，只更新四项基础事件与版本标记，避免混入其他在制玩法。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { audit } = require('./audit-taptap-startup.cjs');
const { replaceOnce } = require('./create-taptap-guarded-build.cjs');
const root = path.resolve(__dirname, '..');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

async function build() {
    const source = path.join(root, 'build/TapLifecycle-0.0.9/game');
    const target = path.join(root, 'build/TapBasicAnalytics-0.0.10');
    const game = path.join(target, 'game');
    if (fs.existsSync(target)) throw Error('输出已存在，拒绝覆盖：' + target);
    const baselineHash = hash(path.join(source, '../game.zip'));
    if (baselineHash !== '18d0f968d62ed81b958ae26fa34677e024dc85f776092dc9cfe54b2b288a11ef') throw Error('0.0.9 基线不匹配');
    const checked = await audit(source);
    if (checked.zip.errors.length || checked.jsonErrors.length || checked.syntaxErrors.length || checked.manifestErrors.length) throw Error('基线审计失败');
    const config = JSON.parse(fs.readFileSync(path.join(source, 'game.json'), 'utf8'));
    if (config.productVersion !== '0.0.9') throw Error('源包版本错误');
    const entry = replaceOnce(fs.readFileSync(path.join(source, 'game.js'), 'utf8'),
        'tap-life-009-45b8cee17730', 'tap-events-010-' + baselineHash.slice(0,12))
        .replaceAll("version: '0.0.9'", "version: '0.0.10'");
    if (!entry.includes("{ version: '0.0.10', endpoint: '', test_transport_enabled: false }")) throw Error('事件配置锚点不匹配');
    fs.cpSync(source, game, {recursive:true});
    fs.writeFileSync(path.join(game,'game.js'), entry);
    fs.copyFileSync(path.join(__dirname,'templates/taptap-event-test.js'),path.join(game,'tap-event-test.js'));
    config.productVersion = '0.0.10';
    fs.writeFileSync(path.join(game,'game.json'),JSON.stringify(config,null,2));
    fs.writeFileSync(path.join(game,'tap-event-config.json'),JSON.stringify({version:'0.0.10',endpoint:'',test_transport_enabled:false},null,2));
    for (const name of ['tap-font-diagnostic.js','tap-startup-diagnostic.js']) {
        const file=path.join(game,name);
        fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll("version: '0.0.9'","version: '0.0.10'").replaceAll('tap-startup-009-','tap-startup-010-'));
    }
    const zip = path.join(target,'game.zip');
    const archive=require(path.join(root,'extensions/taptap-minigame-tools/node_modules/archiver'))('zip',{zlib:{level:9}});
    await new Promise((resolve,reject)=>{
        const stream=fs.createWriteStream(zip);stream.on('close',resolve);stream.on('error',reject);archive.on('error',reject);
        archive.pipe(stream);archive.directory(game,false);archive.finalize().catch(reject);
    });
    const report=await audit(game,source);
    const allowed=['game.js','game.json','tap-event-config.json','tap-event-test.js','tap-font-diagnostic.js','tap-startup-diagnostic.js'];
    if(report.zip.errors.length||report.syntaxErrors.length||report.jsonErrors.length||report.manifestErrors.length
        ||report.difference.added.length||report.difference.removed.length||report.difference.changed.length!==allowed.length
        ||report.difference.changed.some(file=>!allowed.includes(file)))throw Error('产物审计失败');
    const bytes=fs.statSync(zip).size;
    if(bytes>=20000000)throw Error('包体超过 20 MB 预算');
    const receipt={version:'0.0.10',schemaVersion:2,baselineVersion:'0.0.9',baselineHash,
        mode:'local_only',remoteIngestionVerified:false,deviceValidated:false,bytes,sha256:hash(zip),difference:report.difference};
    fs.writeFileSync(path.join(target,'receipt.json'),JSON.stringify(receipt,null,2));
    fs.writeFileSync(path.join(target,'startup-audit.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(receipt,null,2));
}
if(require.main===module)build().catch(error=>{console.error(error);process.exitCode=1;});
