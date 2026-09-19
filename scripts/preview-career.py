"""从 career-ui 测试导出的实际节点生成离线排版图，不代表引擎截图。"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageChops
ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / 'assets/race/fonts/ShuiMasterUI-SemiBold.ttf'

def render(n, canvas, x=640, y=360, sx=1, sy=1):
    if not n.get('active', True): return
    p=n['position']; x+=p['x']*sx; y-=p['y']*sy
    s=n['scale']; sx*=s['x']; sy*=s['y']
    size=n.get('size',{}); w=round(size.get('width',0)*sx); h=round(size.get('height',0)*sy)
    a=n.get('anchor',{'x':.5,'y':.5}); left=round(x-w*a['x']); top=round(y-h*(1-a['y']))
    layer=Image.new('RGBA',canvas.size)
    if w>0 and h>0:
        if n.get('fill'): ImageDraw.Draw(layer).rectangle((left,top,left+w,top+h),fill=tuple(n['fill']))
        if n.get('asset'):
            file=ROOT/'assets/race'/n['asset'].replace('/texture','.png')
            if not file.exists(): file=file.with_suffix('.jpg')
            if file.exists():
                art=Image.open(file).convert('RGBA')
                if n.get('sliced'):
                    iw,ih=art.size; b=min(n.get('inset',18),iw//2,ih//2,w//2,h//2)
                    out=Image.new('RGBA',(w,h))
                    xs=[0,b,iw-b,iw]; ys=[0,b,ih-b,ih]; dx=[0,b,w-b,w]; dy=[0,b,h-b,h]
                    for i in range(3):
                        for j in range(3):
                            if dx[i+1] <= dx[i] or dy[j+1] <= dy[j]: continue
                            out.paste(art.crop((xs[i],ys[j],xs[i+1],ys[j+1])).resize((dx[i+1]-dx[i],dy[j+1]-dy[j]),Image.Resampling.LANCZOS),(dx[i],dy[j]))
                    art=out
                else: art=art.resize((w,h),Image.Resampling.LANCZOS)
                tint=n.get('tint')
                if tint: art=ImageChops.multiply(art,Image.new('RGBA',art.size,tuple(tint[:3])+ (255,)))
                layer.paste(art,(left,top))
        if n.get('text'):
            text=n['text']; fs=max(1,round(n.get('font',24)*sy)); lines=text.split('\n')
            while fs>1:
                f=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Black.ttf' if n.get('numberFont') else str(FONT.with_name('ShuiMasterUI-Regular.ttf') if n.get('weight')=='regular' else FONT),fs)
                if max(f.getlength(t) for t in lines)<=w and len(lines)*n.get('lineHeight',fs+7)<=h+8: break
                fs-=1
            d=ImageDraw.Draw(layer); lh=n.get('lineHeight',fs+7); yy=top if n.get('verticalAlign')==0 else top+(h-len(lines)*lh)/2
            for line in lines:
                tw=f.getlength(line); xx=left if n.get('align')==0 else left+w-tw if n.get('align')==2 else left+(w-tw)/2
                d.text((xx,yy),line,font=f,fill=tuple(n.get('color',[9,25,67])),anchor='lt'); yy+=lh
    for child in n['children']: render(child,layer,x,y,sx,sy)
    if n.get('mask'):
        mask=Image.new('L',canvas.size); ImageDraw.Draw(mask).ellipse((left,top,left+w,top+h),fill=255)
        layer.putalpha(ImageChops.multiply(layer.getchannel('A'),mask))
    canvas.alpha_composite(layer)

if __name__=='__main__':
    scenes=json.loads(Path(sys.argv[1]).read_text()); out=Path(sys.argv[2]); out.mkdir(parents=True,exist_ok=True)
    for name,tree in scenes.items():
        if name=='lobby': continue
        canvas=Image.new('RGBA',(1280,720)); render(tree,canvas); canvas.save(out/(name+'.png'))
    print(f'离线排版图已保存：{out}')
