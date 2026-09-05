"""用原挡板几何和材质制作 T1/T3 广告图集；同步时只更新合批 UV 和图片。

先在 editable 运行，再在 master 使用 --sync，随后执行标准合批和导出。
不移动挡板，不新增面、材质或节点，保留导入资源身份。
"""
from pathlib import Path
from collections import Counter
import json
import sys
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[1]
EDITABLE = ROOT/'sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend'
MASTER = ROOT/'sceneresource/SwimmingVenue_Rebuild_FlatColor.blend'
ATLAS = ROOT/'sceneresource/venue-textures/VenueAdBoards.png'
IMAGE = 'blue_bleachers_3d_model_basecolor.003'
TARGET = 'OlympicPanels_Merged'
VERSION = 1
UP = Vector((0,0,1))


def sources():
    return sorted((o for o in bpy.data.objects if o.type=='MESH' and
                   o.name.startswith('OlympicPanel_') and
                   ('_T1_' in o.name or '_T3_' in o.name) and not o.hide_render),
                  key=lambda o:o.name)


def describe(obj):
    points=[obj.matrix_world@v.co for v in obj.data.vertices]
    center=sum(points,Vector())/len(points)
    # 使用已有面板的最长水平边，角看台也从实际几何推导，不依赖名称方位。
    edges=[points[e.vertices[1]]-points[e.vertices[0]] for e in obj.data.edges]
    axis=max((e for e in edges if abs(e.z)<1e-4),key=lambda e:e.length).normalized()
    normal=axis.cross(UP).normalized()
    if normal.dot(Vector((25,0,center.z))-center)<0:normal.negate()
    right=UP.cross(normal).normalized()
    r=[p.dot(right) for p in points]
    return {'name':obj.name,'center':center,'normal':normal,'right':right,
            'lo':min(r),'hi':max(r),'bottom':min(p.z for p in points),
            'top':max(p.z for p in points),'faces':len(obj.data.polygons),
            'row':int(obj.get('venue_ad_row',0)),
            'corner':obj.name.split('_')[-2] in ('NE','NW','SE','SW'),
            'half':obj.name.startswith('OlympicPanel_AccessHalf_')}


def remap_face(obj, polygon, panel, uv):
    points=[obj.matrix_world@obj.data.vertices[i].co for i in polygon.vertices]
    n=(points[1]-points[0]).cross(points[2]-points[0]).normalized()
    face_center=sum(points,Vector())/len(points)
    broad=abs(n.dot(panel['normal']))>.98 and max(p.z for p in points)-min(p.z for p in points)>.2
    for li,p in zip(polygon.loop_indices,points):
        # 转角原模型存在遮挡，使用广告底色连接相邻居中字标，避免半个文字。
        if not broad or panel['corner']:
            uv[li].uv=(.02,1-509/512)
            continue
        u=(p.dot(panel['right'])-panel['lo'])/(panel['hi']-panel['lo'])
        # 两面分别以观看者的右方为正，避免反向看到镜像字标。
        if (face_center-panel['center']).dot(panel['normal'])<0:u=1-u
        v=(p.z-panel['bottom'])/(panel['top']-panel['bottom'])
        assert -.02<=u<=1.02 and -.02<=v<=1.02,(panel['name'],u,v)
        u=max(0,min(1,u));v=max(0,min(1,v))
        row=panel['row']
        if panel['half']:
            px=(row%2)*256+2+u*252
            py=384+56-v*48
        else:
            px=2+u*508
            py=row*64+56-v*48
        uv[li].uv=(px/512,1-py/512)


def replace_image():
    previous=bpy.data.images[IMAGE]
    image=bpy.data.images.load(str(ATLAS),check_existing=False)
    assert tuple(image.size)==(512,512)
    image.colorspace_settings.name='sRGB'
    image.pack()
    for material in bpy.data.materials:
        if material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type=='TEX_IMAGE' and node.image==previous:
                    node.image=image
                    node.interpolation='Linear'
    bpy.data.images.remove(previous)
    image.name=IMAGE
    image.filepath='//venue-textures/VenueAdBoards.png'


def author():
    assert Path(bpy.data.filepath).resolve()==EDITABLE
    objects=sources()
    assert len(objects)==76
    for index,obj in enumerate(objects):
        if obj.data.users>1:obj.data=obj.data.copy()
        # 固定顺序交错配色；按层错位，使上下两排不成为相同色条。
        number=int(obj.name.rsplit('_',1)[-1]) if obj.name.rsplit('_',1)[-1].isdigit() else index
        side=obj.name.split('_')[-2]
        shift={'N':0,'S':2,'E':1,'W':3,'NE':2,'NW':4,'SE':3,'SW':5}.get(side,0)
        obj['venue_ad_row']=(number-1+shift+(3 if '_T3_' in obj.name else 0))%6
        if '_T3_' in obj.name and (len(side)==2 or
                (side in ('N','S') and number in (1,12)) or
                (side in ('E','W') and number in (1,6))):
            obj['venue_ad_row']=7
        panel=describe(obj)
        uv=obj.data.uv_layers.active or obj.data.uv_layers.new(name='UVMap')
        for poly in obj.data.polygons:remap_face(obj,poly,panel,uv.data)
        obj['venue_ad_version']=VERSION
    replace_image()
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(EDITABLE))
    print(json.dumps({'boards':len(objects),'tiers':dict(Counter('T1' if '_T1_' in o.name else 'T3' for o in objects)),'geometryChanged':False}))


def sync():
    assert Path(bpy.data.filepath).resolve()==MASTER
    with bpy.data.libraries.load(str(EDITABLE),link=False) as (available,loaded):
        loaded.objects=[n for n in available.objects if n.startswith('OlympicPanel_') and ('_T1_' in n or '_T3_' in n)]
    for obj in loaded.objects:bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    panels=[describe(o) for o in loaded.objects]
    assert len(panels)==76 and all(o.get('venue_ad_version')==VERSION for o in loaded.objects)
    target=bpy.data.objects[TARGET]
    original_name=target.data.name
    original_matrix=target.matrix_world.copy()
    original_vertices=[v.co.copy() for v in target.data.vertices]
    tree=KDTree(sum(p['faces'] for p in panels))
    # 大三角形重心偏向端部；用源面的重心定位，不能按整块中心分配，
    # 否则入口半板和转角的端面会被错误分给邻板。
    for index,obj in enumerate(loaded.objects):
        for poly in obj.data.polygons:
            center=sum((obj.matrix_world@obj.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
            tree.insert(center,index)
    tree.balance()
    counts=Counter()
    uv=target.data.uv_layers.active
    assert uv and len(target.data.polygons)==sum(p['faces'] for p in panels)
    for poly in target.data.polygons:
        center=sum((target.matrix_world@target.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
        _,index,distance=tree.find(center)
        assert distance<.05,(index,distance)
        panel=panels[index]
        counts[panel['name']]+=1
        remap_face(target,poly,panel,uv.data)
    # 每块挡板须完整覆盖；防止入口半板、角挡板误分配给相邻广告。
    assert all(counts[p['name']]==p['faces'] for p in panels),dict(counts)
    assert target.data.name==original_name and target.matrix_world==original_matrix
    assert all(a==b.co for a,b in zip(original_vertices,target.data.vertices))
    target['venue_ad_version']=VERSION
    target['venue_ad_board_count']=len(panels)
    for obj in loaded.objects:bpy.data.objects.remove(obj,do_unlink=True)
    replace_image()
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(MASTER))
    print(json.dumps({'syncedBoards':len(panels),'geometryChanged':False,'primitives':len(target.data.materials)}))


if __name__=='__main__':
    sync() if '--sync' in sys.argv else author()
