'use strict';

// 从已验证可冷启动的 0.0.8 生成重复进入诊断包，不改变恢复/暂停行为。
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');
const { replaceOnce } = require('./create-taptap-guarded-build.cjs');
const { audit } = require('./audit-taptap-startup.cjs');
const root = path.resolve(__dirname, '..');
function instrumentEntry(source) {
    source = source.replace(/\r\n/g, '\n');
    // TapTap 的代码模块加载器未注册 JSON require；开发包只内联固定的无网络配置。
    source = replaceOnce(source, "require('./tap-event-config.json')",
        "{ version: '0.0.9', endpoint: '', test_transport_enabled: false }");
    source = replaceOnce(source, "    boot.attachHost(typeof tap !== 'undefined' ? tap : wx);",
        "    boot.attachHost(typeof tap !== 'undefined' ? tap : wx);\n    boot.auxiliary('life-host', function () { globalThis.__swimmingTapLife.attachHost(typeof tap !== 'undefined' ? tap : wx); });");
    source = replaceOnce(source, "            boot.step('engine-adapter', function () { require('./engine-adapter'); });",
        "            boot.step('engine-adapter', function () { require('./engine-adapter'); });\n            boot.auxiliary('life-engine', function () { globalThis.__swimmingTapLife.attachEngine(cc); });");
    source = "try { require('./tap-lifecycle-diagnostic').install(globalThis, { version: '0.0.9' }); } catch (_) {}\n" + source;
    new vm.Script(source); return source;
}
async function build() {
    const source = path.join(root, 'build/TapDirectStart-0.0.8/game');
    const dest = path.join(root, 'build/TapLifecycle-0.0.9'), game = path.join(dest, 'game'), version = '0.0.9';
    if (fs.existsSync(dest)) throw new Error('输出已存在，拒绝覆盖：' + dest);
    const baselineHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'../game.zip'))).digest('hex');
    if (baselineHash !== '45b8cee17730792792c3b53db1eda0d979f985544689a7c4f49f3258dedfa58c') throw new Error('0.0.8 基线不匹配');
    const baseline = await audit(source);
    if (baseline.zip.errors.length || baseline.manifestErrors.length || baseline.syntaxErrors.length || baseline.jsonErrors.length) throw new Error('基线审计未通过');
    const config = JSON.parse(fs.readFileSync(path.join(source,'game.json'),'utf8'));
    if (config.productVersion !== '0.0.8') throw new Error('基线版本不符');
    const signature = 'tap-life-009-' + baselineHash.slice(0,12);
    const entry = instrumentEntry(fs.readFileSync(path.join(source,'game.js'),'utf8'))
        .replaceAll("version: '0.0.8'", "version: '0.0.9'").replace('tap-direct-008-76a623b26f2c',signature);
    fs.cpSync(source,game,{recursive:true});
    fs.writeFileSync(path.join(game,'game.js'),entry);
    fs.copyFileSync(path.join(__dirname,'templates/taptap-lifecycle-diagnostic.js'),path.join(game,'tap-lifecycle-diagnostic.js'));
    config.productVersion=version;fs.writeFileSync(path.join(game,'game.json'),JSON.stringify(config,null,2));
    fs.writeFileSync(path.join(game,'tap-event-config.json'),JSON.stringify({version,endpoint:'',test_transport_enabled:false},null,2));
    for (const file of ['tap-font-diagnostic.js','tap-startup-diagnostic.js']) {
        const p=path.join(game,file);
        let content=fs.readFileSync(p,'utf8').replace("version: '0.0.8'","version: '0.0.9'").replace('tap-startup-008-','tap-startup-009-');
        // 单行列出八个 Label 会被手机导出截断；逐个输出小样本，不改字体或 Label。
        if(file==='tap-font-diagnostic.js') {
            content=replaceOnce(content,'if (records++ >= 24) return;','if (records++ >= 100) return;');
            content=replaceOnce(content,"    log('page', { entry: entry, delayMs: delay, labels: labels });",
                "    labels.forEach(function (label, index) { log('label', { entry: entry, delayMs: delay, index: index, label: label }); });");
        }
        fs.writeFileSync(p,content);
    }
    const zip=path.join(dest,'game.zip');
    const archive=require(path.join(root,'extensions/taptap-minigame-tools/node_modules/archiver'))('zip',{zlib:{level:9}});
    await new Promise((resolve,reject)=>{const s=fs.createWriteStream(zip);s.on('close',resolve);s.on('error',reject);archive.on('error',reject);archive.pipe(s);archive.directory(game,false);archive.finalize().catch(reject);});
    const report=await audit(game,source);
    const allowed=['game.js','game.json','tap-event-config.json','tap-font-diagnostic.js','tap-startup-diagnostic.js'];
    if(report.zip.errors.length||report.syntaxErrors.length||report.jsonErrors.length||report.manifestErrors.length
        ||report.difference.removed.length||report.difference.added.length!==1||report.difference.added[0]!=='tap-lifecycle-diagnostic.js'
        ||report.difference.changed.some(x=>!allowed.includes(x)))throw new Error('存在非预期差异或审计失败');
    const receipt={version,sourceVersion:'0.0.8',baselineHash,signature,mode:'lifecycle-observation',deviceValidated:false,
        bytes:fs.statSync(zip).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'),difference:report.difference};
    if(receipt.bytes>=20000000)throw new Error('包体超过 20 MB 预算');
    fs.writeFileSync(path.join(dest,'receipt.json'),JSON.stringify(receipt,null,2));
    fs.writeFileSync(path.join(dest,'startup-audit.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(receipt,null,2));
}
module.exports={instrumentEntry};
if(require.main===module)build().catch(e=>{console.error(e);process.exitCode=1;});
