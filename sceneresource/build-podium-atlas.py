"""生成领奖台矢量源与256² RGB图集，依赖resvg-py/Pillow。

数字是专用粗体几何标识，不是运行时UI文字。尺寸与模型共用podium-design.json。
"""
from pathlib import Path
from io import BytesIO
import json
import resvg_py
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'sceneresource/venue-textures'
DESIGN=json.loads((ROOT/'sceneresource/podium-design.json').read_text(encoding='utf8'))
# 等高、等笔画的运动号码；轻微切角留在贴图中，不增加文字几何。
DIGITS={
    1:'M8 18 L28 0 H48 V100 H23 V29 L8 37 Z',
    2:'M0 16 L16 0 H54 L68 14 V43 L25 77 H68 V100 H0 V74 L44 39 V23 H24 V35 H0 Z',
    3:'M0 0 H54 L68 14 V42 L58 50 L68 59 V86 L54 100 H0 V77 H44 V62 H14 V39 H44 V23 H0 Z',
}


def build():
    c=DESIGN['colors'];width=DESIGN['stepWidth']
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">']
    for rank,height in enumerate(DESIGN['stepHeights'],1):
        body=height-DESIGN['topChamfer'];ox,y=((0,0),(128,0),(0,128))[rank-1]
        py=lambda z:y+120-z/body*112
        parts.append(f'<rect x="{ox}" y="{y}" width="128" height="128" fill="{c["front"]}"/>')
        # 独立深色端面采样点，让无光照材质也能读出体积。
        parts.append(f'<rect x="{ox}" y="{y}" width="4" height="128" fill="{c["side"]}"/>')
        # 相邻台阶底带在同一世界高度接续；两侧不设独立脚座。
        for z,color in ((.115,c['ribbon']),(.065,c['base'])):
            parts.append(f'<rect x="{ox}" y="{py(z)}" width="128" height="{y+128-py(z)}" fill="{color}"/>')
        ph=DESIGN['numberHeight']/body*112
        pw=DESIGN['numberHeight']*.68/width*112
        mid=(body+.115)/2
        x=ox+64-pw/2;y0=py(mid+DESIGN['numberHeight']/2)
        # 数字1实际轮廓更窄，以真实轮廓中心定位。
        if rank==1:x=ox+64-28*pw/68
        parts.append(f'<path d="{DIGITS[rank]}" fill="{c["number"]}" transform="translate({x} {y0}) scale({pw/68} {ph/100})"/>')
        if rank==1:
            # 冠军小冠标，宽约14cm，只占原图集几个像素。
            cw=.14/width*112;ch=.065/body*112
            parts.append(f'<path d="M0 0 L22 30 L50 0 L78 30 L100 0 L88 75 H12 Z M12 85 H88 V100 H12 Z" fill="{c["gold"]}" transform="translate({ox+64-cw/2} {py(.68)}) scale({cw/100} {ch/100})"/>')
    # 三块128²名次区加一个纯色区，提高数字清晰度，保持整图256²。
    for x,color in ((128,c['top']),(160,c['rim']),(192,c['side']),(224,c['base'])):
        parts.append(f'<rect x="{x}" y="128" width="32" height="128" fill="{color}"/>')
    parts.append('</svg>')
    svg='\n'.join(parts);OUT.mkdir(exist_ok=True)
    (OUT/'PodiumFinish.svg').write_text(svg,encoding='utf8')
    png=resvg_py.svg_to_bytes(svg_string=svg,skip_system_fonts=True)
    Image.open(BytesIO(png)).convert('RGB').save(OUT/'PodiumFinish.png',optimize=True)


if __name__=='__main__':build()
