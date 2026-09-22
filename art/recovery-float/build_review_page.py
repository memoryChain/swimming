"""将离线蒙皮审查图与现有恢复卡排版打包为手机可打开的单文件。"""
from pathlib import Path
import base64
import json
import re

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
def data(path,mime):return 'data:'+mime+';base64,'+base64.b64encode(path.read_bytes()).decode()
copy=(ROOT/'assets/scripts/ui/EntertainmentRecoveryCopy.ts').read_text(encoding='utf-8')
words=[]
for pool in re.findall(r'const \w+_COPY = \[(.*?)\] as const;',copy,re.S):words.extend(re.findall(r"'([^']+)'",pool))
assert len(words)==43
images=''.join(f'<figure><img loading="lazy" src="{data(OUT/file,"image/png")}"><figcaption>{label}</figcaption></figure>' for file,label in [
    ('contact-0-side.png','肌肉男：侧面圈沿接触'),('contact-0-front.png','肌肉男：正面双臂'),
    ('contact-1-side.png','逐浪少女：细臂与短前臂'),('contact-1-top.png','逐浪少女：俯视接触'),
    ('all-characters.png','11 个现有角色：圈径随身体尺寸适配')])
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>B1 浮圈恢复离线审查</title><style>
@font-face{font-family:Shui;src:url(FONT)}*{box-sizing:border-box}body{margin:0;background:#102533;color:#e6f5fa;font:16px/1.7 system-ui,sans-serif}main{max-width:1050px;margin:auto;padding:20px}h1{font-size:25px;line-height:1.3}p{color:#b5d0db}strong{color:#ffe0a0}figure{margin:16px 0;background:#203642;border-radius:12px;overflow:hidden}img{display:block;width:100%}figcaption{padding:10px 14px;font-size:14px}svg{width:100%;height:auto}button{border:0;border-radius:8px;padding:12px 18px;background:#ffc44b;color:#172e3b;font-weight:700}#copy{font-family:Shui}details{padding:10px 0}summary{cursor:pointer}li{margin:8px 0}.note{padding:12px 16px;border-left:3px solid #ffbd4c;background:#233744}
</style><main><h1>B1 共用浮圈恢复</h1>
<p>橙白浮圈、双臂搭圈、头部露出水面、双腿轻摆。保留 3.5 秒暂停、2 秒保护及三颗眩晕星。</p>
<p class="note"><strong>这是离线审查，不是游戏截图。</strong>人物使用真实运行时蒙皮几何和中性审查材质；正式角色贴图保持原样。水面、摄像机、眩晕星和透明排序仍需在引擎及真机中核对。</p>
<figure><svg viewBox="0 0 980 276" role="img" aria-label="恢复卡程序字排版"><image href="CARD" width="980" height="276"/>
<g fill="#fff9ef" style="font-family:Shui"><text x="324" y="108" text-anchor="middle" font-size="34">调整中</text>
<text id="copy" x="320" y="205" font-size="60">正在找回方向...</text></g><rect x="344" y="246" width="420" height="8" rx="4" fill="#183446"/><rect x="344" y="246" width="280" height="8" rx="4" fill="#beda41"/></svg>
<figcaption>复用现有底板，文字由程序显示；此处只检查独立卡片排版。</figcaption></figure>
<button id="next">查看下一条恢复提示</button><span id="counter">　1 / 43</span>
IMAGES
<details><summary>本次检查与边界</summary><ul><li>11 个角色、双向姿态、连续 20 轮进入与退出；肘膝不反折或侧折，圈沿按肩宽与前臂适配。</li><li>浮圈 640 三角形、单网格、单材质、无贴图；每泳道复用一个实例。</li><li>人物、浮圈和眩晕星共用闪退显隐；新位置闪入时圈已停用。</li><li>资源导入、实际角色贴图下的接触效果、四种来源的实机全流程、iOS/Android 微信双机和性能仍待验收。</li></ul></details>
</main><script>const words=WORDS;let index=0;document.getElementById('next').onclick=()=>{index=(index+1)%words.length;const text=document.getElementById('copy');text.textContent=words[index]+'...';text.setAttribute('font-size',words[index].length<=6?60:48);document.getElementById('counter').textContent='　'+(index+1)+' / '+words.length;};</script></html>'''
page=page.replace('FONT',data(ROOT/'assets/race/fonts/ShuiMasterUI-SemiBold.ttf','font/ttf')).replace('CARD',data(ROOT/'assets/race/ui/entertainment-recovery-v1/rescue-card.png','image/png')).replace('IMAGES',images).replace('WORDS',json.dumps(words,ensure_ascii=False))
(OUT/'review.html').write_text(page,encoding='utf-8')
print('已生成自包含离线审查页：art/recovery-float/review.html')
