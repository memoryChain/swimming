"""生成三枚修订图标的同尺寸前后对照页面，不修改 PNG 像素。"""
import base64
import json
from pathlib import Path

root = Path(__file__).resolve().parent
data = json.loads((root / 'manifest.json').read_text())
html = (root / 'preview.html').read_text()

def icon(file, size):
    uri = 'data:image/png;base64,' + base64.b64encode(file.read_bytes()).decode()
    return f'<div class="icon {size}" style="--icon:url(\'{uri}\')"></div>'

cards = []
for item in data['items']:
    if item['id'] not in ('frog-hop', 'precision', 'kick-dive'):
        continue
    old = root / 'history/before-fuller' / item['file']
    new = root / 'history/after-fuller' / item['file']
    pairs = ''.join(f'<div><p class="tag">{label}</p>{icon(file,"large")}<div class="sizes">{icon(file,"s48")}{icon(file,"s64")}</div></div>' for label, file in [('修订前', old), ('修订后', new)])
    cards.append(f'<article style="--ink:{item["color"]}"><h2>{item["role"]}</h2><h3>{item["skill"]}</h3><div class="pair">{pairs}</div></article>')
html = html.replace('同一套剪影，十种角色能力', '三枚图标 · 饱满度修订')
html = html.replace('固定深灰底 · 单一主题色 · 动势轮廓 · 大图与小尺寸对照', '同尺寸前后对照 · 增大主体色块 · 收拢辅助元素')
start = html.index('<section class="grid">')
end = html.index('</section>', start) + len('</section>')
html = html[:start] + '<section class="grid">' + ''.join(cards) + '</section>' + html[end:]
html = html.replace('</style>', '.grid{grid-template-columns:repeat(3,1fr);gap:26px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:20px}.tag{font-size:12px;margin-bottom:12px}.large{width:170px;height:170px}.sizes{gap:15px;margin-top:18px}article{padding-top:20px;padding-bottom:20px}.sheet{max-width:1440px}@media(max-width:1000px){.grid{grid-template-columns:1fr}}</style>')
(root / 'fuller-comparison.html').write_text(html)
