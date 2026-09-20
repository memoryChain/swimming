"""显示青蛙参考修订稿，含同一圆底下的大图与小尺寸。"""
from pathlib import Path
import re

root = Path(__file__).resolve().parent
source = (root / 'preview.html').read_text()
style = re.search(r'<style>([\s\S]*?)</style>', source).group(1)
frog = next(article for article in re.findall(r'<article\b[\s\S]*?</article>', source) if '<h2>蛙少</h2>' in article)
html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>青蛙参考修订</title><style>' + style + '.sheet{width:560px;padding:32px 44px}.large{width:320px;height:320px}.sizes{gap:32px}.sheet>p{text-align:center;margin-top:20px}article{border:0}</style><main class="sheet">' + frog + '<p>横线瞳孔 · 前肢自然下垂 · 后腿紧凑屈起</p></main></html>'
(root / 'frog-review.html').write_text(html)
