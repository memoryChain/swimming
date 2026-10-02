'use strict';

// 单变量字体实验：从已审计基础事件包生成副本，名字以外的字体表必须逐字节一致。
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { audit } = require('./audit-taptap-startup.cjs');
const { replaceOnce } = require('./create-taptap-guarded-build.cjs');
const root = path.resolve(__dirname,'..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function build() {
    const source = path.join(root,'build/TapBasicAnalytics-0.0.10/game');
    const target = path.join(root,'build/TapFontFamily-0.0.11'), game = path.join(target,'game');
    if(fs.existsSync(target))throw Error('输出已存在，拒绝覆盖');
    const baselineHash=hash(path.join(source,'../game.zip'));
    if(baselineHash!=='b95134117334bdb759a5162faa79f9944311e6f031bb96b47426236612ba5a82')throw Error('0.0.10 基线不匹配');
    const checked=await audit(source);
    if(checked.zip.errors.length||checked.manifestErrors.length||checked.syntaxErrors.length||checked.jsonErrors.length)throw Error('基线审计失败');
    const python=path.join(root,'.cache/ui-font-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python3');
    if(!fs.existsSync(python))throw Error('请先运行 pnpm fonts:setup');
    const config=JSON.parse(fs.readFileSync(path.join(source,'game.json'),'utf8'));
    if(config.productVersion!=='0.0.10')throw Error('基线版本错误');
    fs.cpSync(source,game,{recursive:true});
    const rename=spawnSync(python,[path.join(__dirname,'prepare-taptap-fonts.py'),game],{encoding:'utf8'});
    if(rename.status!==0)throw Error(rename.stderr||'字体转换失败');
    const fonts=JSON.parse(rename.stdout);
    const entry=replaceOnce(fs.readFileSync(path.join(game,'game.js'),'utf8'),'tap-events-010-18d0f968d62e','tap-font-011-'+baselineHash.slice(0,12))
        .replaceAll("version: '0.0.10'","version: '0.0.11'");
    fs.writeFileSync(path.join(game,'game.js'),entry);
    config.productVersion='0.0.11';fs.writeFileSync(path.join(game,'game.json'),JSON.stringify(config,null,2));
    fs.writeFileSync(path.join(game,'tap-event-config.json'),JSON.stringify({version:'0.0.11',endpoint:'',test_transport_enabled:false},null,2));
    fs.writeFileSync(path.join(game,'tap-font-diagnostic.js'),fs.readFileSync(path.join(__dirname,'templates/taptap-font-diagnostic.js'),'utf8').replace("version: '0.0.4'","version: '0.0.11'"));
    const startup=path.join(game,'tap-startup-diagnostic.js');
    fs.writeFileSync(startup,fs.readFileSync(startup,'utf8').replaceAll("version: '0.0.10'","version: '0.0.11'").replaceAll('tap-startup-010-','tap-startup-011-'));
    const archive=require(path.join(root,'extensions/taptap-minigame-tools/node_modules/archiver'))('zip',{zlib:{level:9}});
    const zip=path.join(target,'game.zip');
    await new Promise((resolve,reject)=>{const stream=fs.createWriteStream(zip);stream.on('close',resolve);stream.on('error',reject);archive.on('error',reject);archive.pipe(stream);archive.directory(game,false);archive.finalize().catch(reject);});
    const report=await audit(game,source);
    const allowed=['game.js','game.json','tap-event-config.json','tap-font-diagnostic.js','tap-startup-diagnostic.js',...fonts.map(f=>f.path)];
    if(report.zip.errors.length||report.manifestErrors.length||report.syntaxErrors.length||report.jsonErrors.length||report.difference.added.length||report.difference.removed.length
        ||report.difference.changed.length!==allowed.length||report.difference.changed.some(f=>!allowed.includes(f)))throw Error('字体实验出现非预期差异');
    const receipt={version:'0.0.11',baselineVersion:'0.0.10',baselineHash,fonts,deviceValidated:false,
        analyticsMode:'local_only',bytes:fs.statSync(zip).size,sha256:hash(zip),difference:report.difference};
    if(receipt.bytes>=20000000)throw Error('包体超出 20 MB 预算');
    fs.writeFileSync(path.join(target,'receipt.json'),JSON.stringify(receipt,null,2));
    fs.writeFileSync(path.join(target,'startup-audit.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(receipt,null,2));
}
if(require.main===module)build().catch(error=>{console.error(error);process.exitCode=1;});
