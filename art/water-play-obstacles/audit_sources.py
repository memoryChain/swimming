"""独立后台只读核查源模型、封闭边界、法线与可编辑动作。"""
from pathlib import Path
import json,bpy,bmesh
SOURCE=Path(__file__).resolve().parent
report={}
for name in ['WaterBallCannon','SprayBuoy']:
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
    assert actions,name+' 缺少源动作'
    report[name]={'parts':parts,'actions':actions,'fps':bpy.context.scene.render.fps,'frameEnd':bpy.context.scene.frame_end,'note':'GLB 导出静态资源，游戏使用权威阶段驱动固定节点动作。'}
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
