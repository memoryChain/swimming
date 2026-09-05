"""依据底图颜色与表面位置修复皮肤覆盖，不对相邻 UV 岛做膨胀。"""
from pathlib import Path
import argparse
import json
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def repair(work):
    for i in (5,6,8,9,10,11,12):
        folder=work/f'CartonSwimmer{i}'
        base_path=folder/'base.png'
        if not base_path.exists():
            base_path=next(folder.glob('base-source.*'))
        base=np.asarray(Image.open(base_path).convert('RGB'))/255.
        original=np.asarray(Image.open(folder/f'CartonSwimmer{i}ColorMask.png').convert('RGBA'))
        geometry=np.load(folder/'geometry.npz')
        h,w=base.shape[:2]
        if (w, h) != (512, 512) or original.shape != (h, w, 4):
            raise RuntimeError(f'CartonSwimmer{i} 的底图或遮罩尺寸已变化，需重新审查参数。')
        position=np.zeros((h,w,3));valid=np.zeros((h,w),bool);support=np.zeros((h,w))
        for uv, tri in zip(geometry['uv'],geometry['triangles']):
            p=uv*np.array([w,-h])+np.array([0,h])
            lo=np.maximum(np.floor(p.min(0)).astype(int),0);hi=np.minimum(np.ceil(p.max(0)).astype(int),[w-1,h-1])
            if np.any(hi<lo): continue
            yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1];q=np.stack([xx+.5,yy+.5],-1)
            a,b,c=p;v0=b-a;v1=c-a;det=v0[0]*v1[1]-v0[1]*v1[0]
            if abs(det)<1e-7:continue
            rel=q-a
            u=(rel[...,0]*v1[1]-rel[...,1]*v1[0])/det
            v=(v0[0]*rel[...,1]-v0[1]*rel[...,0])/det
            inside=(u>=0)&(v>=0)&(u+v<=1)
            pts=geometry['vertices'][tri]
            xyz=pts[0]+u[...,None]*(pts[1]-pts[0])+v[...,None]*(pts[2]-pts[0])
            position[yy[inside],xx[inside]]=xyz[inside];valid[yy[inside],xx[inside]]=True
            samples=original[yy[inside],xx[inside],2]/255.
            if len(samples):support[yy[inside],xx[inside]]=float((samples>.7).mean())
        distance,nearest=distance_transform_edt(~valid,return_indices=True)
        if not valid.any():
            raise RuntimeError(f'CartonSwimmer{i} 没有可用的 UV 覆盖。')
        position[~valid]=position[tuple(nearest[:,~valid])]
        support[~valid]=support[tuple(nearest[:,~valid])]
        np.save(folder/'position.npy',position)
        # 在 4 倍采样下计算覆盖，再按面积降采样，避免硬阈值留下锯齿。
        base=np.asarray(Image.open(base_path).convert('RGB').resize((w*4,h*4),Image.Resampling.BILINEAR),dtype=np.float32)/255.
        position=position.astype(np.float32).repeat(4,0).repeat(4,1)
        support=support.astype(np.float32).repeat(4,0).repeat(4,1)
        r,g,b=base.transpose(2,0,1);sat=(base.max(2)-base.min(2))/np.maximum(base.max(2),1e-5)
        # 暖色皮肤的内部覆盖保持完整；灰白衣袜不因闭运算被染色。
        low,high={5:(.12,.22),6:(.20,.28),8:(.16,.25),9:(.12,.22),10:(.10,.18),11:(.13,.23),12:(.08,.16)}[i]
        strong=support>.65
        skin=smooth(np.where(strong,.035,low),np.where(strong,.09,high),r-b)*smooth(.008,.038,r-g)*smooth(.005,.035,g-b)
        skin*=smooth(.26,.48,r)
        if i in (6,8):
            skin*=smooth(.68,.79,r)
        if i in (11,12):
            skin*=np.where(strong,1,1-smooth(.47,.60,sat))
        if i == 11:
            # 此角色的指缝、耳部及袖口皮肤阴影偏橙，不能用装备的饱和度阈值排除。
            arms=(np.abs(position[...,0])>.10)&(position[...,2]>.65)&(position[...,2]<.80)
            peach=smooth(.07,.15,r-b)*smooth(.018,.055,r-g)*smooth(.008,.035,g-b)
            peach*=smooth(.18,.29,b)*smooth(.35,.48,g)
            skin=np.maximum(skin,peach*np.where(arms,1,smooth(.02,.18,support)))
            arm_skin=smooth(.035,.07,r-b)*smooth(.008,.025,r-g)*smooth(.001,.02,g-b)*smooth(.25,.4,r)
            skin=np.maximum(skin,arm_skin*arms)
        if i == 12:
            # 浅灰桃色指节和膝盖高光需要按已确认的裸露部位覆盖。
            bare=((np.abs(position[...,0])>.34)&(position[...,2]>.64)&(position[...,2]<.77))|((position[...,2]>.205)&(position[...,2]<.31))
            highlight=smooth(.016,.042,r-b)*smooth(.003,.016,r-g)*smooth(-.008,.008,g-b)
            skin=np.maximum(skin,highlight*bare)
        # 头部的棕色头发与肤色接近，采用既有高置信度肤色区域作为保护。
        head=position[...,2]>.76
        if i in (6,8):
            skin[head]*=smooth(.73,.83,r[head])
        # 皮肤内部使用确定覆盖，过渡仅留给接近真实边界的颜色。
        skin=smooth(.18,.62,skin)
        skin=np.asarray(Image.fromarray(skin.astype(np.float32)).resize((w,h),Image.Resampling.BOX))
        result=original.copy();result[...,2]=np.uint8(skin*255+.5)
        # 衣服的绿色误差不能在明确的暖色皮肤内部留下高对比碎点。
        result[...,0][skin>.8]=0
        Image.fromarray(result).save(folder/'candidate.png',optimize=True)
        report = {
            'character': f'CartonSwimmer{i}',
            'size': [w, h],
            'supersample': 4,
            'changedBluePixels': int(np.count_nonzero(result[..., 2] != original[..., 2])),
            'changedRedPixels': int(np.count_nonzero(result[..., 0] != original[..., 0])),
            'greenUnchanged': bool(np.array_equal(result[..., 1], original[..., 1])),
            'alphaUnchanged': bool(np.array_equal(result[..., 3], original[..., 3])),
            'originalBytes': (folder/f'CartonSwimmer{i}ColorMask.png').stat().st_size,
            'candidateBytes': (folder/'candidate.png').stat().st_size,
        }
        (folder/'repair-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(i, '变化像素',int(np.any(result!=original,axis=2).sum()),'肤色覆盖',float(skin[valid].mean()))



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='生成卡通角色肤色修复候选，不写入运行时资产。')
    parser.add_argument('--workdir', type=Path, required=True, help='Blender 审计导出的原始快照目录')
    repair(parser.parse_args().workdir.resolve())
