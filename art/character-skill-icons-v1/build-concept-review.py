"""为用户指定的新构图生成三枚图标设计展示。"""
import re
from pathlib import Path

root = Path(__file__).resolve().parent
html = (root / 'preview.html').read_text()
articles = re.findall(r'<article\b[\s\S]*?</article>', html)
selected = [article for article in articles if any(f'<h2>{name}</h2>' in article for name in ('蛙少', '忍者哥', '潜水哥'))]
start = html.index('<section class="grid">')
end = html.index('</section>', start) + len('</section>')
html = html[:start] + '<section class="grid">' + ''.join(selected) + '</section>' + html[end:]
html = html.replace('同一套剪影，十种角色能力', '三枚技能图标 · 新构图')
html = html.replace('固定深灰底 · 单一主题色 · 动势轮廓 · 大图与小尺寸对照', '正面跃蛙 · 忍者与瞄准环 · 潜水头像')
html = html.replace('</style>', '.sheet{max-width:1200px}.grid{grid-template-columns:repeat(3,1fr);gap:40px}.large{width:230px;height:230px;margin-top:10px;margin-bottom:18px}article{padding-top:16px}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style>')
(root / 'concept-review.html').write_text(html)
