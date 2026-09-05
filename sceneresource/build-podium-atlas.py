"""生成领奖台矢量源与256² RGB图集，依赖fonttools/resvg-py/Pillow。"""
from pathlib import Path
from io import BytesIO
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
import resvg_py
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'sceneresource/venue-textures'


def build():
    font=TTFont(ROOT/'assets/race/fonts/ShuiMasterUI-SemiBold.ttf')
    glyphs=font.getGlyphSet();cmap=font.getBestCmap()
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">',
           '<rect width="256" height="256" fill="#143E59"/>']
    # 主体段实体高度由原顶部和地面推导；字形按米制比例映射，避免矮台数字压扁。
    for rank,body_height,accent in ((1,.56,'#E6BE63'),(2,.38,'#CEDFE9'),(3,.24,'#D79670')):
        y=(rank-1)*64
        parts.append(f'<rect y="{y}" width="256" height="64" fill="#194B66"/>')
        parts.append(f'<rect y="{y+10}" width="256" height="2" fill="{accent}"/>')
        parts.append(f'<rect y="{y+56}" width="256" height="8" fill="#10364E"/>')
        glyph=glyphs[cmap[ord(str(rank))]];pen=SVGPathPen(glyphs);bounds=BoundsPen(glyphs)
        glyph.draw(pen);glyph.draw(bounds);left,bottom,right,top=bounds.bounds
        physical_height=min(.27,body_height*.65)
        ph=physical_height/body_height*48
        pw=physical_height*(right-left)/(top-bottom)/1.4*248
        sx=pw/(right-left);sy=ph/(top-bottom)
        parts.append(f'<path fill="#F0F5F5" transform="translate({128-pw/2-left*sx} {y+33-ph/2+top*sy}) scale({sx} {-sy})" d="{pen.getCommands()}"/>')
        # 两侧短饰线烘入贴图，距离数字留白，避免另建徽章或文字Mesh。
        for x in (46,178):
            parts.append(f'<path d="M{x} {y+31} h25 M{x+4} {y+36} h17" stroke="{accent}" stroke-width="2"/>')
    # 最后一行：四条纯色，分别给踏面、外缘、侧壁和贴地底座。
    for x,color in ((0,'#DCE9EB'),(64,'#7BCFBE'),(128,'#143E59'),(192,'#0D293B')):
        parts.append(f'<rect x="{x}" y="192" width="64" height="64" fill="{color}"/>')
    parts.append('<rect x="7" y="199" width="50" height="50" rx="2" fill="#6E939F"/>')
    for y in (210,222,234):
        parts.append(f'<path d="M16 {y} h32" stroke="#87AAB3" stroke-width="2"/>')
    parts.append('</svg>')
    svg='\n'.join(parts);OUT.mkdir(exist_ok=True)
    (OUT/'PodiumFinish.svg').write_text(svg,encoding='utf8')
    png=resvg_py.svg_to_bytes(svg_string=svg,skip_system_fonts=True)
    Image.open(BytesIO(png)).convert('RGB').save(OUT/'PodiumFinish.png',optimize=True)


if __name__=='__main__':build()
