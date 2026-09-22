"""离线绘制可编辑 SVG 与不透明色图；只依赖 Blender 自带 numpy，不在游戏中画图。"""
from pathlib import Path
import math
import numpy as np
import bpy

SIZE = 512


def build_warning_texture(out: Path):
    shapes = []
    def polygon(points, fill):
        shapes.append(('polygon', points, fill))
    def ellipse(cx, cy, rx, ry, fill):
        shapes.append(('ellipse', (cx, cy, rx, ry), fill))
    navy, cream, blue = '#113e58', '#fff3bd', '#25cdea'
    # 三面印花绕球一周，主比赛角度和反向携带均有一面可读。
    for center in (SIZE / 12, SIZE * 5 / 12, SIZE * 9 / 12):
        def p(points, fill):
            polygon([(center + x*.9, 180 + y*1.6) for x, y in points], fill)
        burst = [(-67,15),(-49,-9),(-64,-41),(-31,-35),(-27,-71),(-7,-53),
                 (16,-79),(26,-43),(56,-53),(47,-15),(69,0),(47,24),
                 (57,55),(25,46),(7,77),(-10,52),(-43,65),(-38,34)]
        p(burst, navy)
        p([(x*.85,y*.85) for x,y in burst], cream)
        # 大水滴占据标识中心，感叹号留出粗壮的负形。
        drop = [(0,-57),(12,-33),(29,-9),(35,16),(30,35),(17,46),
                (0,50),(-18,45),(-31,32),(-35,13),(-29,-10),(-13,-34)]
        p(drop, navy)
        p([(x*.77,y*.77+3) for x,y in drop], blue)
        p([(-7,-20),(7,-20),(5,16),(-5,16)], navy)
        ellipse(center,180+28*1.6,6*.9,7*1.6,navy)
        # 侧边两颗水滴，保持大形状，避免细线在小画面中消失。
        for sign in (-1,1):
            p([(sign*58,-80),(sign*50,-64),(sign*62,-60),(sign*67,-69)], navy)
            p([(sign*58,-75),(sign*55,-67),(sign*61,-66)], blue)
    # 色带和印花共享同一张图，避免顶点色乘暗浅色警示。
    background = [('polygon',[(0,0),(512,0),(512,512),(0,512)],'#ff5310')]
    for center in (SIZE/12,SIZE*5/12,SIZE*9/12):
        background.append(('polygon',[(center-31,0),(center+31,0),(center+31,512),(center-31,512)],'#ffc20e'))
    background.append(('polygon',[(0,430),(512,430),(512,512),(0,512)],'#ffc20e'))
    shapes = background + shapes
    # 环绕接缝的印花也复制至另一边，UV 接缝处颜色一致。
    shapes += [(kind, ([(x+512,y) for x,y in data] if kind=='polygon' else (data[0]+512,*data[1:])), color)
               for kind,data,color in shapes[len(background):] if (min(x for x,y in data) if kind=='polygon' else data[0]-data[2]) < 0]
    svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
           '<title>定时水球：三面喷水警示印花</title>']
    for kind,data,color in shapes:
        if kind=='polygon':
            svg.append('<polygon fill="'+color+'" points="'+' '.join(f'{x:.3f},{y:.3f}' for x,y in data)+'"/>')
        else:
            cx,cy,rx,ry=data
            svg.append(f'<ellipse fill="{color}" cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}"/>')
    (out/'warning-artwork.svg').write_text('\n'.join(svg)+ '\n</svg>\n',encoding='utf-8')
    resolution = SIZE*2
    yy,xx=np.mgrid[:resolution,:resolution].astype(np.float32)
    xx=(xx+.5)/2; yy=(yy+.5)/2
    rgb=np.ones((resolution,resolution,3),dtype=np.float32)
    for kind,data,color in shapes:
        if kind=='ellipse':
            cx,cy,rx,ry=data;mask=((xx-cx)/rx)**2+((yy-cy)/ry)**2<=1
        else:
            mask=np.zeros(xx.shape,dtype=bool)
            for i,(x1,y1) in enumerate(data):
                x2,y2=data[(i+1)%len(data)]
                if y1==y2: continue
                mask ^= ((y1>yy)!=(y2>yy)) & (xx<(x2-x1)*(yy-y1)/(y2-y1)+x1)
        rgb[mask]=[int(color[i:i+2],16)/255 for i in (1,3,5)]
    rgb=rgb.reshape(SIZE,2,SIZE,2,3).mean(axis=(1,3))
    # BYTE 图像像素保留 sRGB 数值，避免再次转换把橙黄与水蓝压暗。
    rgba=np.concatenate((rgb,np.ones((SIZE,SIZE,1),dtype=np.float32)),axis=2)
    img=bpy.data.images.new('WaterBalloonWarning',width=SIZE,height=SIZE,alpha=False)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).ravel())
    img.filepath_raw=str(out/'warning-basecolor.png');img.file_format='PNG';img.save();img.pack()
    return img
