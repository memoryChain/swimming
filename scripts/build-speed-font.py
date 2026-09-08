"""按 HUD 参考重新绘制速度专用字形；不修改游戏通用字体。"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

OUT = Path(__file__).resolve().parent.parent / 'assets/race/fonts'
def box(x,y,w,h):
    return [(x,y),(x,y+h),(x+w,y+h),(x+w,y)]
outer=[(0,60),(0,640),(60,700),(360,700),(420,640),(420,60),(360,0),(60,0)]
paths={
'0':[outer, list(reversed(box(140,140,140,420)))],
'1':[[(30,490),(30,610),(170,700),(310,700),(310,140),(410,140),(410,0),(30,0),(30,140),(170,140),(170,530)]],
'2':[[(0,490),(0,640),(60,700),(360,700),(420,640),(420,360),(360,300),(140,300),(140,140),(420,140),(420,0),(0,0),(0,380),(60,440),(280,440),(280,560),(140,560),(140,490)]],
'3':[[(0,500),(0,640),(60,700),(360,700),(420,640),(420,410),(375,360),(420,310),(420,60),(360,0),(60,0),(0,60),(0,200),(140,200),(140,140),(280,140),(280,280),(160,280),(160,420),(280,420),(280,560),(140,560),(140,500)]],
'4':[[(0,700),(140,700),(140,340),(280,340),(280,700),(420,700),(420,0),(280,0),(280,200),(0,200)]],
'5':[[(420,700),(420,560),(140,560),(140,420),(360,420),(420,360),(420,60),(360,0),(60,0),(0,60),(0,190),(140,190),(140,140),(280,140),(280,280),(0,280),(0,700)]],
'6':[[(420,520),(280,520),(280,560),(140,560),(140,420),(360,420),(420,360),(420,60),(360,0),(60,0),(0,60),(0,640),(60,700),(360,700),(420,640)],list(reversed(box(140,140,140,140)))],
'7':[[(0,700),(420,700),(420,560),(265,0),(110,0),(270,560),(140,560),(140,490),(0,490)]],
'8':[outer,list(reversed(box(140,420,140,140))),list(reversed(box(140,140,140,140)))],
'9':[[(0,180),(140,180),(140,140),(280,140),(280,280),(60,280),(0,340),(0,640),(60,700),(360,700),(420,640),(420,60),(360,0),(60,0),(0,60)],list(reversed(box(140,420,140,140)))],
'.':[box(0,0,140,140)],
'/':[[(0,-10),(190,720),(285,720),(95,-10)]],
'm':[[(0,0),(0,480),(110,480),(110,445),(150,480),(260,480),(300,435),(345,480),(440,480),(500,420),(500,0),(390,0),(390,350),(335,350),(335,0),(220,0),(220,350),(110,350),(110,0)]],
's':[[(340,480),(340,370),(110,370),(110,290),(290,290),(340,240),(340,50),(290,0),(0,0),(0,110),(230,110),(230,180),(50,180),(0,230),(0,430),(50,480)]],
}
glyphs={};metrics={};cmap={};order=['.notdef','space']
def make(name,contours,width):
    pen=TTGlyphPen(None)
    for contour in contours:
        pen.moveTo(contour[0])
        for pt in contour[1:]: pen.lineTo(pt)
        pen.closePath()
    glyphs[name]=pen.glyph();metrics[name]=(width,0)
make('.notdef',[outer,list(reversed(box(100,100,220,500)))],480)
make('space',[],220);cmap[32]='space'
for char,contours in paths.items():
    name={'/':'slash','.':'period'}.get(char,'uni%04X'%ord(char))
    order.append(name);cmap[ord(char)]=name
    make(name,contours,{'m':550,'s':390,'.':205,'/':330}.get(char,480))
fb=FontBuilder(1000,isTTF=True)
fb.setupGlyphOrder(order);fb.setupCharacterMap(cmap);fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics(metrics);fb.setupHorizontalHeader(ascent=850,descent=-150)
fb.setupNameTable({'familyName':'ShuiMaster Speed','styleName':'Heavy','uniqueFontIdentifier':'ShuiMasterSpeed-Heavy-1.000','fullName':'ShuiMaster Speed Heavy','psName':'ShuiMasterSpeed-Heavy','version':'Version 1.000','description':'Custom angular HUD numerals; 0-9, decimal point and m/s. Designed for the swimming project.'})
fb.setupOS2(sTypoAscender=850,sTypoDescender=-150,usWinAscent=850,usWinDescent=150,usWeightClass=900,fsType=0,sxHeight=480,sCapHeight=700)
fb.setupPost();fb.setupMaxp()
target=OUT/'ShuiMasterSpeed-Heavy.ttf';fb.save(target)
check=TTFont(target)
assert all(ord(c) in check.getBestCmap() for c in '0123456789.m/s')
print(f'字体已生成，字形数：{len(order)}，文件：{target.name}')
