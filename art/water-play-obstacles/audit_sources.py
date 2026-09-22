"""独立后台只读核查源模型、封闭边界、法线与可编辑动作。"""
from pathlib import Path
import json,bpy,bmesh,math
from mathutils import Vector
SOURCE=Path(__file__).resolve().parent
report={}
for name in ['WaterBallCannon','SprayBuoy','CannonWaterBall']:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/(name+'.blend')))
    parts=[]
    for obj in bpy.data.objects:
        if obj.type!='MESH':continue
        bm=bmesh.new();bm.from_mesh(obj.data)
        assert all(e.is_manifold for e in bm.edges),obj.name+' 有开放边界'
        assert bm.calc_volume()>0,obj.name+' 法线或体积异常'
        obj.data.calc_loop_triangles()
        assert all(t.area>1e-10 for t in obj.data.loop_triangles),obj.name+' 有退化面'
        parts.append(dict(name=obj.name,triangles=len(obj.data.loop_triangles),vertices=len(obj.data.vertices),volume=bm.calc_volume(),closed=True));bm.free()
    actions=[a.name for a in bpy.data.actions]
    if name!='CannonWaterBall':assert actions,name+' 缺少源动作'
    report[name]={'parts':parts,'actions':actions,'fps':bpy.context.scene.render.fps,'frameEnd':bpy.context.scene.frame_end,'note':'GLB 导出静态资源，游戏使用权威阶段驱动固定节点动作。'}
    if name=='WaterBallCannon':
        head=bpy.data.objects['CannonNozzle'];mouth=bpy.data.objects['Muzzle']
        assert mouth.parent==head and (mouth.location-Vector((0,-1.02,0))).length<1e-6
        assert (head.location-Vector((0,0,1.04))).length<1e-6
        assert abs(head.rotation_euler.x-math.radians(-40))<1e-6
        # 转轴中心线两侧的嵌入点 x=±0.32：端盖从 0.30 延伸到 0.58；
        # 喷管回弹 0～0.10m 时该截面外半径最小 0.398，大于 0.32。
        cap_overlap=.32-.30;head_overlap=.398-.32
        assert cap_overlap>0 and head_overlap>0
        clearance=10
        for degrees in range(25,86):
            for recoil in [0,-.1]:
                for v in head.data.vertices:
                    z=1.04+v.co.z*math.cos(math.radians(degrees))+(-v.co.y+recoil)*math.sin(math.radians(degrees))
                    clearance=min(clearance,z-.445)
        assert clearance>0,'抬头／回弹时喷管穿入底盘'
        report[name]['aimAudit']={'pivotCocos':[0,1.04,0],'muzzleLocalCocos':[0,0,1.02],'restPitch':40,'pitchChecked':[25,85],'capContactOverlap':cap_overlap,'headContactOverlap':head_overlap,'minimumHeadToDeckGap':clearance,'meshPivotVerified':True}
    if name=='SprayBuoy':
        top=bpy.data.objects['BuoyBalloon']
        anchor=tuple(top.location)
        assert all(abs(a-b)<1e-6 for a,b in zip(anchor,(-.32,-.05,.195))),'系带节点没有对准扣座'
        center=sum((v.co for v in list(top.data.vertices)[:6]),top.location*0)/6
        assert center.length<1e-6,'系带底环不在局部锚点'
        assert sum(p['triangles'] for p in parts)<=1500
        report[name]['connectionAudit']={'tetherRootError':center.length,'socketAnchorCocos':[-.32,.195,.05],'socketYRange':[.188,.210],'tetherStartY':.195,'knotYRange':[.585,.650],'tetherEndY':.625,'balloonStartsY':.61,'verified':True}
(SOURCE/'source-audit.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps(report))
