"""从独立图标生成可交互设计预览；保留原始 PNG，不修改像素。"""
import base64
import json
from pathlib import Path

root = Path(__file__).resolve().parent
data = json.loads((root / 'manifest.json').read_text())

def uri(name):
    return 'data:image/png;base64,' + base64.b64encode((root / name).read_bytes()).decode()

cards = []
for index, item in enumerate(data['items'], 1):
    src = uri(item['file'])
    cards.append(f'''<article style="--ink:{item['color']};--icon:url('{src}')">
    <div class="icon large" role="img" aria-label="{item['skill']}"></div>
    <h2>{item['role']}</h2><h3>{item['skill']}</h3>
    <div class="sizes"><div class="mini"><div class="icon s48"></div><span>48 px</span></div>
    <div class="mini"><div class="icon s64"></div><span>64 px</span></div></div>
    </article>''')

html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>划水大师 · 角色技能剪影</title><style>
*{box-sizing:border-box}body{margin:0;background:#171e21;color:#e9eef0;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
.sheet{max-width:1600px;margin:auto;padding:38px 54px 30px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px}
h1{font-size:30px;letter-spacing:1px;margin:0 0 9px;font-weight:650}p{margin:0;font-size:14px;color:#a2b0b6;line-height:1.8}.mark{font-size:12px;color:#acbbc1;margin-bottom:8px;letter-spacing:3px}
.controls{display:flex;gap:8px}button{cursor:pointer;border:1px solid #536169;border-radius:8px;background:transparent;color:#c4d0d5;padding:9px 14px;font:inherit;font-size:13px}button.active{background:#cadad7;border-color:#cadad7;color:#21342e}
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:20px 22px}article{min-width:0;text-align:center;padding:14px 12px 13px;border-top:1px solid #384349}
.icon{background:#303638;border-radius:50%;position:relative;flex-shrink:0}.icon:after{content:"";display:block;position:absolute;inset:7%;background:var(--ink);-webkit-mask-image:var(--icon);mask-image:var(--icon);-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center}
.large{width:176px;height:176px;margin:0 auto 14px}.s48{width:48px;height:48px}.s64{width:64px;height:64px}.sizes{display:flex;align-items:flex-end;justify-content:center;gap:24px;margin-top:12px}.mini{display:flex;align-items:center;flex-direction:column;gap:6px}.mini span{font-size:10px;color:#7e9099}
h2{font-size:18px;font-weight:600;margin:0 0 5px}h3{font-size:13px;font-weight:400;margin:0;color:var(--ink)}
footer{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #384349;margin-top:26px;padding-top:19px;gap:24px}.baseline{display:flex;gap:16px;align-items:center}.coach{width:70px;height:70px;border-radius:50%;background:#303638;display:grid;place-items:center}.coach img{width:46px;height:46px;object-fit:contain}.baseline strong{font-weight:500;font-size:14px}.baseline p{font-size:12px}.note{font-size:12px;text-align:right;max-width:510px;color:#84979f;line-height:1.8}
.mono article{--ink:#dce9e6!important}.raw .icon:after{background-image:var(--icon);background-color:transparent;background-size:contain;background-position:center;background-repeat:no-repeat;mask-image:none;-webkit-mask-image:none}
@media(max-width:900px){.sheet{padding:26px 24px}.grid{grid-template-columns:repeat(2,1fr)}header,footer{align-items:flex-start;flex-direction:column}.note{text-align:left}.controls{margin-top:15px}}
</style><main class="sheet"><header><div><div class="mark">划水大师 / 技能图标设计</div><h1>同一套剪影，十种角色能力</h1><p>固定深灰底 · 单一主题色 · 动势轮廓 · 大图与小尺寸对照</p></div>
<div class="controls"><button class="active" onclick="setMode('color',this)">主题色</button><button onclick="setMode('mono',this)">同色辨识</button><button onclick="setMode('raw',this)">生成原稿</button></div></header>
<section class="grid">''' + ''.join(cards) + '''</section><footer><div class="baseline"><div class="coach"><img src="''' + uri('coach-reference.png') + '''" alt="现有呼吸管理图标"></div><div><strong>健身教练 · 呼吸管理</strong><p>现有正式图标，仅作风格对照</p></div></div><div class="note">设计预览 · 尚未接入游戏<br>统一底色 #303638；主题色视图以透明轮廓呈现平涂色。<br>圆底与图标分层，图标文件不包含文字。</div></footer></main><script>
function setMode(mode,button){document.body.className=mode==='color'?'':mode;for(const b of document.querySelectorAll('button'))b.classList.toggle('active',b===button)}
</script></html>'''
(root / 'preview.html').write_text(html, encoding='utf-8')
print(root / 'preview.html')
