"""重制低面数领奖台，修改源旗片配色；主文件仅定向同步领奖台。

旗片合批材质由batch-flatcolor-venue.py第8版按原色带迁移，不改变合批几何。
领奖台保留原节点、Mesh、材质名称；以地面为底座接触面，站位由运行时包围盒读取。
"""
from pathlib import Path
import importlib.util
import json
import sys
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
EDITABLE=ROOT/'sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend'
MASTER=ROOT/'sceneresource/SwimmingVenue_Rebuild_FlatColor.blend'
NAMES=tuple(f'award_podium_{i}' for i in (1,2,3))
MATERIAL='LPVenue_cartoon_podium_red.001'
IMAGE='PodiumRankLabelAtlas'
DESIGN=json.loads((ROOT/'sceneresource/podium-design.json').read_text(encoding='utf8'))


def atlas_material():
    old=bpy.data.images.get(IMAGE)
    if old:bpy.data.images.remove(old)
    image=bpy.data.images.load(str(ROOT/'sceneresource/venue-textures/PodiumFinish.png'),check_existing=False)
    image.name=IMAGE;image.pack();image.filepath='//venue-textures/PodiumFinish.png'
    m=bpy.data.materials.get(MATERIAL) or bpy.data.materials.new(MATERIAL)
    m.use_nodes=True;m.diffuse_color=(1,1,1,1)
    n=m.node_tree.nodes;n.clear();l=m.node_tree.links
    tex=n.new('ShaderNodeTexImage');tex.image=image;tex.interpolation='Linear';tex.extension='EXTEND'
    em=n.new('ShaderNodeEmission');output=n.new('ShaderNodeOutputMaterial')
    l.new(tex.outputs['Color'],em.inputs['Color']);l.new(em.outputs[0],output.inputs['Surface'])
    return m


def bounds(obj):
    points=[obj.matrix_world@v.co for v in obj.data.vertices]
    return [[min(p[i] for p in points),max(p[i] for p in points)] for i in range(3)]


def build_step(obj,rank,ground,center_y,material):
    original=json.loads(obj['podium_original_bounds']) if obj.get('podium_original_bounds') else bounds(obj)
    obj['podium_original_bounds']=json.dumps(original)
    xmin,xmax=original[0];width=DESIGN['stepWidth']
    ymin,ymax=center_y-width/2,center_y+width/2
    top=ground+DESIGN['stepHeights'][rank-1]
    # 台身齐平相接，不设独立底脚和外挑顶盖；仅踏面边缘留2cm倒角。
    chamfer=DESIGN['topChamfer']
    profiles=[(ground,0),(top-chamfer,0),(top,chamfer)]
    verts=[];faces=[];kinds=[]
    for z,inset in profiles:
        verts.extend(((xmin+inset,ymin+inset,z),(xmax-inset,ymin+inset,z),
                      (xmax-inset,ymax-inset,z),(xmin+inset,ymax-inset,z)))
    for ring in range(2):
        for side in range(4):
            faces.append((ring*4+side,ring*4+(side+1)%4,(ring+1)*4+(side+1)%4,(ring+1)*4+side))
            kinds.append(('body' if ring==0 else 'rim',side))
    faces.extend(((3,2,1,0),(8,9,10,11)));kinds.extend((('base',0),('top',0)))
    old=obj.data;mesh_name=old.name
    mesh=bpy.data.meshes.new(mesh_name+'_new')
    inverse=obj.matrix_world.inverted()
    mesh.from_pydata([inverse@Vector(v) for v in verts],[],faces);mesh.update()
    mesh.materials.append(material);uv=mesh.uv_layers.new(name='PodiumAtlasUV')
    for poly,(kind,side) in zip(mesh.polygons,kinds):
        for li in poly.loop_indices:
            p=Vector(verts[mesh.loops[li].vertex_index])
            if kind=='body':
                u=(p.y-ymin)/width
                if side==3:u=1-u
                v=(p.z-ground)/(top-chamfer-ground)
                ox,oy=((0,0),(128,0),(0,128))[rank-1]
                px=ox+(8+u*112 if side in (1,3) else 2)
                py=oy+120-v*112
            elif kind=='top':
                px=144;py=192
            else:
                px=240 if kind=='base' else 176 if kind=='rim' else 208
                py=192
            uv.data[li].uv=(px/256,1-py/256)
    obj.data=mesh
    if old.users==0:bpy.data.meshes.remove(old)
    mesh.name=mesh_name
    mesh.calc_loop_triangles()
    assert len(mesh.loop_triangles)==20
    edge_counts={tuple(sorted(e.vertices)):0 for e in mesh.edges}
    for poly in mesh.polygons:
        assert poly.area>1e-6
        for a,b in zip(poly.vertices,tuple(poly.vertices[1:])+tuple(poly.vertices[:1])):edge_counts[tuple(sorted((a,b)))]+=1
    assert all(n==2 for n in edge_counts.values())
    actual=bounds(obj)
    assert abs(actual[2][0]-ground)<1e-5 and abs(actual[2][1]-top)<1e-5
    assert abs((actual[0][0]+actual[0][1])/2-(xmin+xmax)/2)<1e-5
    obj['podium_finish_version']=DESIGN['version']
    print(json.dumps({'step':rank,'triangles':20,'groundGap':actual[2][0]-ground,'top':top,'centerY':center_y}))


def author():
    assert Path(bpy.data.filepath).resolve()==EDITABLE
    if '--podium-only' not in sys.argv:author_flags()
    ground=bounds(bpy.data.objects['Venue_Rectangular_Ground'])[2][1]
    champion=bounds(bpy.data.objects[NAMES[0]])
    center_y=sum(champion[1])/2;width=DESIGN['stepWidth']
    material=atlas_material()
    # 颁奖相机从场馆外侧(-X)观看，左至右为2/1/3；运行时按同名节点读取站立点。
    for rank,name in enumerate(NAMES,1):
        build_step(bpy.data.objects[name],rank,ground,center_y+({1:0,2:1,3:-1}[rank])*width,material)
    ordered=[bounds(bpy.data.objects[NAMES[i]]) for i in (2,0,1)]
    for left,right in zip(ordered,ordered[1:]):
        assert abs(left[1][1]-right[1][0])<1e-5,'相邻台阶必须无缝接触'
        assert all(abs(left[0][i]-right[0][i])<1e-5 for i in (0,1)),'前后立面必须齐平'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(EDITABLE))


def author_flags():
    spec=importlib.util.spec_from_file_location('venue_batch',ROOT/'sceneresource/batch-flatcolor-venue.py')
    batch=importlib.util.module_from_spec(spec);spec.loader.exec_module(batch)
    mint=batch.create_authored_material('PoolsideProp_Flag_Mint',tuple(c*.88 for c in batch.PROP_SOURCE_MATERIALS['PoolsideProp_Flag_Mint'][:3])+(1,))
    pearl=batch.create_authored_material('PoolsideProp_Flag_Pearl',tuple(c*.88 for c in batch.PROP_SOURCE_MATERIALS['LPVenue_cartoon_pool_edge_white'][:3])+(1,))
    flags=[o for o in bpy.data.objects if o.name.startswith('PoolsideProp_FlagLine') and '_Pennant_' in o.name]
    assert len(flags)==24
    for o in flags:
        o.data.materials.clear();o.data.materials.append(pearl if int(o.name.rsplit('_',1)[1])%2 else mint)
        o['flag_palette_version']=8


def sync():
    assert Path(bpy.data.filepath).resolve()==MASTER
    with bpy.data.libraries.load(str(EDITABLE),link=False) as (_,loaded):loaded.objects=list(NAMES)
    for source in loaded.objects:bpy.context.scene.collection.objects.link(source)
    bpy.context.view_layer.update()
    source_material=None
    for name,source in zip(NAMES,loaded.objects):
        target=bpy.data.objects[name];old=target.data;mesh_name=old.name
        assert source.matrix_world==target.matrix_world
        source_material=source.data.materials[0]
        target.data=source.data.copy()
        if old.users==0:bpy.data.meshes.remove(old)
        target.data.name=mesh_name
        target['podium_finish_version']=DESIGN['version']
        bpy.data.objects.remove(source,do_unlink=True)
    previous=bpy.data.materials.get(MATERIAL)
    if previous and previous!=source_material:
        previous.user_remap(source_material);bpy.data.materials.remove(previous)
    source_material.name=MATERIAL
    image=next(n.image for n in source_material.node_tree.nodes if n.type=='TEX_IMAGE')
    previous_image=bpy.data.images.get(IMAGE)
    if previous_image and previous_image!=image:
        previous_image.user_remap(image);bpy.data.images.remove(previous_image)
    image.name=IMAGE
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(MASTER))


if __name__=='__main__':sync() if '--sync' in sys.argv else author()
