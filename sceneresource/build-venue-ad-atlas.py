"""生成广告矢量源及 512² 图集；只在制作阶段运行，不含运行时绘图。

依赖：fonttools、resvg-py、Pillow。字体轮廓来自项目字体，不依赖系统字体。
SVG 已转曲，可直接修改并重新栅格化；PNG 是 Blender 使用的源纹理。
"""
from pathlib import Path
from io import BytesIO
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import resvg_py
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'sceneresource/venue-textures'
FONT = TTFont(ROOT / 'assets/race/fonts/ShuiMasterUI-SemiBold.ttf')
GLYPHS = FONT.getGlyphSet()
CMAP = FONT.getBestCmap()
NAVY = '#123750'
CREAM = '#FFF5DE'
PARTS = []


def shape(markup):
    PARTS.append(markup)


def text(label, x, y, width, height, color):
    # 转曲并用字形实际边界拟合，所有品牌在低分辨率图集中仍有大字高。
    from fontTools.pens.boundsPen import BoundsPen
    pen = SVGPathPen(GLYPHS)
    bounds = BoundsPen(GLYPHS)
    offset = 0
    for char in label:
        glyph = GLYPHS[CMAP[ord(char)]]
        transform = (1, 0, 0, 1, offset, 0)
        glyph.draw(TransformPen(pen, transform))
        glyph.draw(TransformPen(bounds, transform))
        offset += glyph.width + 18
    left, bottom, right, top = bounds.bounds
    scale = min(width / (right-left), height / (top-bottom))
    shape(f'<path fill="{color}" transform="translate({x-left*scale:.3f} {y+top*scale:.3f}) scale({scale:.6f} {-scale:.6f})" d="{pen.getCommands()}"/>')


def wave(x, y, color):
    shape(f'<path d="M{x} {y+12} q8 -12 16 0 t16 0 t16 0 M{x} {y+25} q8 -12 16 0 t16 0 t16 0" fill="none" stroke="{color}" stroke-width="5"/>')


def bolt(x,y,color):
    shape(f'<path d="M{x+23} {y} L{x+1} {y+25} H{x+19} L{x+12} {y+40} L{x+42} {y+13} H{x+24} L{x+31} {y} Z" fill="{color}"/>')


def drop(x,y,color):
    shape(f'<path d="M{x+24} {y} C{x+18} {y+10} {x+7} {y+20} {x+7} {y+27} A17 17 0 0 0 {x+41} {y+27} C{x+41} {y+20} {x+30} {y+10} {x+24} {y} Z" fill="{color}"/>')


def chevrons(x,y,color):
    for offset in (0,18,36):
        shape(f'<path d="M{x+offset} {y} l14 18 -14 18 h10 l14 -18 -14 -18 Z" fill="{color}"/>')


def build():
    shape('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">')
    shape(f'<rect width="512" height="512" fill="{NAVY}"/>')
    # 每行64px，实际面板取 y=8..56；上下各8px为同色隔离区。
    recipes = [
        ('WAVE', 'SWIM GEAR', '#0B6479', CREAM, '#68E0D0', wave),
        ('AQUA+', 'STAY FRESH', '#A2E6CF', NAVY, '#1D938B', drop),
        ('BOOST', 'MAKE WAVES', '#EA7044', CREAM, '#FFD06A', bolt),
        ('SWIM CLUB', 'EVERY LAP COUNTS', CREAM, NAVY, '#1BA0A0', wave),
        ('GO! SWIM', 'CHASE YOUR BEST', '#E8CF52', NAVY, '#FFFFFF', chevrons),
        ('FLOW', 'FIND YOUR RHYTHM', '#244B70', CREAM, '#70DDD0', wave),
    ]
    for row, (brand, tagline, bg, fg, accent, icon) in enumerate(recipes):
        y = row*64
        shape(f'<rect y="{y}" width="512" height="64" fill="{bg}"/>')
        shape(f'<path d="M462 {y} h50 v64 h-76 Z" fill="{accent}"/>')
        icon(14,y+12,fg)
        text(brand,78,y+15,205,33,fg)
        shape(f'<rect x="294" y="{y+20}" width="2" height="24" fill="{fg}" opacity="0.45"/>')
        text(tagline,310,y+24,126,16,fg)
        shape(f'<path d="M480 {y+20} l10 12 -10 12" fill="none" stroke="{bg}" stroke-width="5"/>')
    # 半块入口挡板单独排版，避免把完整横幅压扁或裁掉字标。
    for col,(brand,bg,fg,icon) in enumerate((('WAVE','#0B6479',CREAM,wave),('AQUA+','#A2E6CF',NAVY,drop))):
        x=col*256
        shape(f'<rect x="{x}" y="384" width="256" height="64" fill="{bg}"/>')
        icon(x+12,396,fg)
        text(brand,x+76,402,159,29,fg)
    # 旧转角挡板端部相互遮挡，专用居中构图让文字远离被遮挡的两端。
    wave(147,462,'#70DDD0')
    text('WAVE',211,465,149,30,CREAM)
    shape('</svg>')
    svg='\n'.join(PARTS)
    OUT.mkdir(exist_ok=True)
    (OUT/'VenueAdBoards.svg').write_text(svg,encoding='utf8')
    png=resvg_py.svg_to_bytes(svg_string=svg,skip_system_fonts=True)
    Image.open(BytesIO(png)).convert('RGB').save(OUT/'VenueAdBoards.png',optimize=True)
    print('已生成广告图集：512×512，RGB，无透明通道')


if __name__=='__main__':
    build()
