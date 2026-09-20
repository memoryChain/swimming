"""显示潜水镜局部修订稿，含大图与小尺寸。"""
from pathlib import Path
import re

root = Path(__file__).resolve().parent
source = (root / 'preview.html').read_text()
style = re.search(r'<style>([\s\S]*?)</style>', source).group(1)
article = next(item for item in re.findall(r'<article\b[\s\S]*?</article>', source) if '<h2>潜水哥</h2>' in item)
html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>一体式潜水镜修订</title><style>' + style + '.sheet{width:560px;padding:32px 44px}.large{width:320px;height:320px}.sizes{gap:32px}.sheet>p{text-align:center;margin-top:20px}article{border:0}</style><main class="sheet">' + article + '<p>一体式镜片 · 连通大视窗 · 圆润鼻窝</p></main></html>'
(root / 'diver-review.html').write_text(html)
