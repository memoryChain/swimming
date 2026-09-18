#!/usr/bin/env python3
"""使用实际运行时切图做离线合成；角色参考不代表 Cocos 实时模型验收。"""
from pathlib import Path
import sys
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'temp/lobby-b-preview'
OUT.mkdir(parents=True, exist_ok=True)
ART = ROOT / 'assets/race/ui/lobby-b'
FONT = ROOT / 'assets/race/fonts/ShuiMasterUI-SemiBold.ttf'
# 离线预览可指定本机同名字体；不复制到运行时资源或声称已随包。
NUMBER_FONT = Path(os.environ.get('LOBBY_NUMBER_FONT', '/System/Library/Fonts/Supplemental/Arial Black.ttf'))
if not NUMBER_FONT.exists(): NUMBER_FONT = FONT
W = int(sys.argv[1]) if len(sys.argv) > 1 else 1280
S = max(W / 1280, 1)
background = Image.open(ART / 'background.png').convert('RGBA').resize((round(1280*S),round(720*S)),Image.Resampling.LANCZOS)
base = Image.new('RGBA',(W,720))
base.alpha_composite(background,(round((W-1280*S)/2),round((720-720*S)/2-240*(S-1))))
def shift(x,manage=False):
    if manage: return round(x+(W-1280)/2-190.5*(S-1))
    return x+W-1280 if x >= 800 else x
def art(name, box, path=None):
    im = Image.open(path or ART / (name + '.png')).convert('RGBA')
    x,y,w,h = box
    base.alpha_composite(im.resize((w,h),Image.Resampling.LANCZOS),(shift(x,name=='character-button'),y))
def text(s,x,y,size=20,color='#0e2042',anchor='mm'):
    ImageDraw.Draw(base).text((shift(x,s=='角色与培养'),y),s,font=ImageFont.truetype(str(NUMBER_FONT if s and all(c in '0123456789LV./ ' for c in s) else FONT),size),fill=color,anchor=anchor)
art('character-info',(17,199,233,274))
art('career-card',(809,160,449,250))
art('career-badge',(1028,117,206,192))
art('career-button',(809,409,441,91))
art('arrow',(1199,439,24,30))
art('progress-track',(842,354,370,10))
art('progress-fill',(842,354,296,10))
art('quick-button',(902,516,352,102))
art('quick-icon',(947,542,38,43))
art('character-button',(318,600,263,70))
art('skill-base',(64,452,74,74))
art('skill-breath',(78,466,46,44))
art('online',(805,516,102,102), ROOT/'assets/race/ui/lobby-v1/online-button.png')
reference = OUT/'character-reference.png'
if reference.exists(): base.alpha_composite(Image.open(reference).convert('RGBA'),(round((W-1280)/2-174*(S-1)),0))
text('健身教练',62,213,28,anchor='lm');text('LV.1',92,246,16,'white')
for i,(name,y) in enumerate([('体力',291),('技巧',343),('爆发',396)]):
    text(name,109,y,16,anchor='lm');text('200',109,y+22,20,anchor='lm')
text('生涯之路',877,211,16,'#9e631b')
text('泳馆新秀',834,255,40,anchor='lm')
text('下一站 俱乐部选手',839,293,16,'#536b8d',anchor='lm')
text('联赛积分',844,338,16,anchor='lm');text('80',1162,336,26,'#03c1d3',anchor='rm');text('/ 100',1168,339,16,'#99a9c2',anchor='lm')
text('再获20积分，开放晋级杯',844,381,14,'#536b8d',anchor='lm')
text('继续生涯',835,454,28,anchor='lm');text('联赛·第1站',1145,454,18)
text('快速比赛',1103,567,38);text('联机',856,576,18)
text('角色与培养',477,635,24)
# 共享顶栏保留微信右上胶囊的运行时预留，示意昵称及币数。
art('top-player',(33,10,227,86),ROOT/'assets/race/ui/lobby-v1/top-player.png')
art('career-badge',(225,34,42,39));text('冠军飞鱼',171,53,20,'white')
art('top-currency',(990,25,198,56),ROOT/'assets/race/ui/lobby-v1/top-currency.png')
art('top-settings',(934,25,56,56),ROOT/'assets/race/ui/lobby-v1/top-settings.png')
text('2461',1086,53,22,'white')
base.convert('RGB').save(OUT/f'layout-{W}.jpg',quality=94)
print(OUT/f'layout-{W}.jpg')
# alpha 必须真实存在；深浅底对照，不依赖查看器对透明 RGB 的解释。
thumbs = Image.new('RGB',(900,520),'#839ab1')
for i,name in enumerate(['career-card','career-button','quick-button','character-info']):
    im=Image.open(ART/(name+'.png')).convert('RGBA')
    assert im.getchannel('A').getextrema()[0] == 0, name
    im.thumbnail((430,230))
    thumbs.paste(im,(10+(i%2)*450,10+(i//2)*260),im)
thumbs.save(OUT/'alpha-check.jpg',quality=94)
