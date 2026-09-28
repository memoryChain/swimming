// 汇总现有作者源与网上参考图；不生成或修改运行时资源。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const data = file => {
    const ext = path.extname(file).toLowerCase();
    return `data:image/${ext === '.png' ? 'png' : 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}`;
};
const local = file => path.join(__dirname, file);
const project = file => path.join(root, file);
const groups = [
    ['游戏现有资产：统一在形体、色块和结构上', [
        ['水球大炮', project('art/water-play-obstacles/WaterBallCannon-review.png'), '借鉴蓝白主色与橙色功能部位、宽窄和高低层次。细节服务于炮口和转轴的辨识。', null],
        ['当前电动玩具鲨', project('art/shark-animation/hero.png'), '借鉴完整动物轮廓、浅色腹部和明确表情。玩具部件很少，但身份清楚。', null],
        ['可乐瓶', local('litter-cola.png'), '借鉴连续截面：瓶颈、肩、身、底是一体轮廓，标签只是少量大色块。', null],
        ['压瘪矿泉水瓶', local('litter-crushed.png'), '借鉴不对称轮廓与低面数转折。海龟的鳍也应有有意的弧度和收尖。', null],
    ]],
    ['网上参考：各取一部分，不整套照搬', [
        ['参考一 · 自然海龟的形体关系', local('real-turtle.jpg'), '看头颈连接、低矮龟壳和前鳍根部的过渡。鳞片、照片纹理和真实皮肤细节不带入游戏。', 'https://www.fisheries.noaa.gov/feature-story/what-can-you-do-save-sea-turtles'],
        ['参考二 · 连续的壳与清楚的盾片', local('turtle-silhouette.png'), '看干净的背壳分区、浅色腹缘和四鳍轮廓。四肢上的密集格纹需要大量删减。', 'https://www.blenderkit.com/asset-gallery-detail/162b6cee-32a5-4a54-ad15-f08b9bdf9a49/'],
        ['参考三 · 低多边形体积', local('turtle-faceted.jpg'), '看龟壳包边、头颈和弯曲鳍面的立体转折。过碎的三角明暗不照搬，避免石雕感。', 'https://www.renderhub.com/ocstard/st-t2-m3'],
        ['参考四 · 可抓握的充气圈', local('tube-handles.jpg'), '只借鉴厚实圈体、固定把手、系绳耳与外围绳。去掉靠背、杯托、坐网、品牌文字；玩家仍在圈后双手抓握。', 'https://www.intex.pt/insuflaveis/boias/56825-boia-de-roda-inflavel-individual-intex-river-run-135-cm'],
    ]],
    ['当前海龟：要处理的是比例和连接', [
        ['现有海龟作者源', local('current-turtle.png'), '头尾长约4.85、展开宽约5.64。龟壳色块密而近似、眼部零件感较强；鳍的展开姿态放大了整体占屏。', null],
        ['现有四圈与绳索', local('current-bus-top.png'), '整组横宽约8.6。圈体偏细，四条直绳像硬杆；现有抓握垫并未围绕乘客双手布局。', null],
    ]],
];
const cards = groups.map(([title, entries]) => `<section><h2>${title}</h2><div class="grid">${entries.map(([name, file, note, url]) => `<article><button class="image" aria-label="放大${name}"><img src="${data(file)}" alt="${name}"></button><div class="copy"><h3>${name}</h3><p>${note}</p>${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">查看图片来源 ↗</a>` : '<span class="tag">项目作者源预览</span>'}</div></article>`).join('')}</div></section>`).join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>海龟班车 · 建模方向对照</title><style>
*{box-sizing:border-box}body{margin:0;background:#edf2f2;color:#19363d;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1260px;margin:auto;padding:36px 24px 70px}.eyebrow{letter-spacing:.12em;color:#397471;font-size:13px}h1{font-size:38px;line-height:1.25;margin:12px 0}header p{max-width:900px}.lead{font-size:20px}.notice{color:#5e7076;font-size:14px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}section{margin-top:38px}h2{font-size:23px;margin:0 0 18px}article{background:white;border:1px solid #d5e0df;border-radius:15px;overflow:hidden}.image{border:0;padding:0;width:100%;background:#e0e9ec;cursor:zoom-in;display:block}.image img{display:block;width:100%;height:320px;object-fit:contain}.copy{padding:18px 22px}h3{margin:0;font-size:19px}.copy p{margin:9px 0;color:#426069}a{color:#006d78}.tag{font-size:13px;color:#6c7c7f}.proposal{background:#fff7e7;border-left:5px solid #e79e40;padding:22px 28px;border-radius:10px}.proposal p{margin:8px 0}.proposal strong{color:#794910}table{border-collapse:collapse;width:100%;background:#fff}th,td{text-align:left;border-bottom:1px solid #d8e3e3;padding:13px 16px}th{background:#dceceb}dialog{padding:8px;border:0;background:#283e48;max-width:96vw;max-height:94vh;border-radius:10px}dialog::backdrop{background:#07151ce6}dialog img{display:block;max-width:92vw;max-height:84vh;object-fit:contain}dialog button{display:block;margin:7px auto;background:white;border:0;border-radius:5px;padding:5px 18px}footer{margin-top:25px;color:#637d82;font-size:13px}@media(max-width:680px){main{padding:24px 15px}.grid{grid-template-columns:1fr}h1{font-size:28px}.image img{height:260px}table{font-size:14px}th,td{padding:9px}}
</style><main><header><span class="eyebrow">美术方向研究 · 2026-09-28</span><h1>小一号的海龟，清楚可抓的四个拖圈</h1><p class="lead">建议保留自然海龟的辨识度，用克制的低多边形和泳池道具配色统一风格。重心放在紧凑轮廓、连续结构，以及真实可对齐的抓握位置。</p><p class="notice">本页是参考与作者源对照，不是新模型成品或游戏截图。图片采用不同预览光照；尺寸建议仍需放入正式角色与游戏镜头校准。点击任意图片可放大。</p></header>${cards}<section class="proposal"><h2>建议的建模方向</h2><p><strong>海龟：</strong>温和、慢悠悠的海龟；长椭圆低拱壳、短而连续的头颈、后掠弧形前鳍。主色为清晰的绿壳、浅青绿皮肤、奶油色腹缘；眼睛融入头部，只保留小瞳孔、眼睑和短嘴线。</p><p><strong>泳圈：</strong>厚实的橙白充气拖圈，带两个深色抓握把手和少量气阀／接缝。四个圈使用同一造型；功能点用统一色，不做四种互相竞争的皮肤。</p><p><strong>连接：</strong>龟壳后半部的宽软牵引带连接左右系绳点，绳索再接到各圈前侧。每根绳轻微弯曲；人物停在圈后，双手接触靠人一侧的两个把手。</p><p><strong>先做的关键样件：</strong>一只海龟、一只圈、一名正式角色。先证明缩小后仍有辨识度、双手抓握不穿模，再复制另外三个圈并做整体队形。</p></section><section><h2>首轮比例试稿范围</h2><table><thead><tr><th>部位</th><th>建议起点</th><th>校准依据</th></tr></thead><tbody><tr><td>海龟本体</td><td>现尺寸的65%～70%</td><td>头尾约3.2～3.4，展开宽约3.7～4.0；这是试稿范围</td></tr><tr><td>背壳</td><td>保持长椭圆，减少繁碎色片</td><td>一个连续壳面，少量清楚盾片，腹缘有厚度</td></tr><tr><td>泳圈外径</td><td>先保留约1.4，增厚圈体</td><td>按正式角色肩宽、手距、前臂长度校准，不随海龟整体缩放</td></tr><tr><td>四圈队形</td><td>收拢浅扇形，保留轻微前后错位</td><td>先测人物占用范围，再确定间距；视觉与抓取点同步调整</td></tr><tr><td>牵引绳</td><td>保持细而可见，轻微下垂</td><td>端点真实接入牵引带与圈前绳耳，避开鳍和手臂</td></tr></tbody></table></section><footer>网上图片仅用于此建模研究，原作者与来源见各卡片链接；不会作为游戏贴图或模型直接接入。运行预算沿用单一简单材质、顶点色与少量网格，先保持约三千三角面的整体量级。</footer></main><dialog><img alt="参考图放大"><button>关闭</button></dialog><script>const d=document.querySelector('dialog');document.querySelectorAll('.image').forEach(b=>b.addEventListener('click',()=>{d.querySelector('img').src=b.querySelector('img').src;d.showModal()}));d.querySelector('button').addEventListener('click',()=>d.close());d.addEventListener('click',e=>{if(e.target===d)d.close()});</script></html>`;
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('已生成 art/turtle-bus/reference-study/index.html');
