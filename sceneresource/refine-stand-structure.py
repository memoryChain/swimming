"""按现有支撑墙/楼板接触面生成看台柱梁；所有源构件合并为一个运行时批次。"""
from pathlib import Path
import math
import struct
import sys
import zlib

import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend'
MASTER=ROOT/'sceneresource/SwimmingVenue_Rebuild_FlatColor.blend'
PREFIX='StandArchitectureArt_'
TARGET=PREFIX+'Merged'


def bounds(o):
    pts=[o.matrix_world@Vector(p) for p in o.bound_box]
    return [[min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]]


def material():
    path=ROOT/'temp/venue-audit/StandArchitectureArtAtlas.png'
    path.parent.mkdir(parents=True,exist_ok=True)
    colors=[(159,191,211),(106,148,176),(64,106,140)]
    row=b'\0'+b''.join(bytes(c)*16 for c in colors)
    def chunk(k,d):return struct.pack('>I',len(d))+k+d+struct.pack('>I',zlib.crc32(k+d))
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>2I5B',48,16,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(row*16))+chunk(b'IEND',b''))
    im=bpy.data.images.get('StandArchitectureArtAtlas')
    if im:bpy.data.images.remove(im,do_unlink=True)
    im=bpy.data.images.load(str(path),check_existing=False);im.name='StandArchitectureArtAtlas';im.pack();im.filepath='//StandArchitectureArtAtlas.png'
    mat=bpy.data.materials.get('StandArchitectureArtAtlas_Material') or bpy.data.materials.new('StandArchitectureArtAtlas_Material')
    mat.use_nodes=True;n=mat.node_tree.nodes;n.clear()
    out=n.new('ShaderNodeOutputMaterial');p=n.new('ShaderNodeBsdfPrincipled');tex=n.new('ShaderNodeTexImage');tex.image=im;tex.interpolation='Closest'
    p.inputs['Base Color'].default_value=(0,0,0,1);p.inputs['Emission Strength'].default_value=1;p.inputs['Roughness'].default_value=1
    mat.node_tree.links.new(tex.outputs['Color'],p.inputs['Emission Color']);mat.node_tree.links.new(p.outputs['BSDF'],out.inputs['Surface'])
    return mat


def author():
    assert Path(bpy.data.filepath).resolve()==SOURCE
    for o in list(bpy.data.objects):
        if o.name.startswith(PREFIX):bpy.data.objects.remove(o,do_unlink=True)
    col=bpy.data.collections.get('StandArchitectureArt') or bpy.data.collections.new('StandArchitectureArt')
    if col.name not in bpy.context.scene.collection.children:bpy.context.scene.collection.children.link(col)
    mat=material()
    floor=bounds(bpy.data.objects['Venue_Rectangular_Ground'])[1][2]
    ceiling=bounds(bpy.data.objects['T3RingFloor_O'])[0][2]
    made=[]

    def box(name,lo,hi,axis,direction):
        vertices=[(x,y,z) for z in (lo[2],hi[2]) for y in (lo[1],hi[1]) for x in (lo[0],hi[0])]
        faces=[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)]
        mesh=bpy.data.meshes.new(name+'_Mesh');mesh.from_pydata(vertices,[],faces);mesh.materials.append(mat);mesh.update()
        uv=mesh.uv_layers.new(name='StandArtAtlasUV')
        for face in mesh.polygons:
            tone=0 if face.normal.z>.5 else (1 if face.normal[axis]*direction>.5 else 2)
            for i in face.loop_indices:uv.data[i].uv=((tone+.5)/3,.5)
        obj=bpy.data.objects.new(name,mesh);col.objects.link(obj);made.append(obj)
        return obj

    for side in ('N','S','E','W'):
        wall=bounds(bpy.data.objects['StandSupport_'+side]);core=bounds(bpy.data.objects['AccessCore_'+side+'_Architecture'])
        axis=1 if side in ('N','S') else 0;along=1-axis
        direction=-1 if side in ('N','E') else 1
        wall_face=wall[0 if direction<0 else 1][axis]
        segments=[(wall[0][along],core[0][along]-.15),(core[1][along]+.15,wall[1][along])]
        if '--prototype' in sys.argv:
            if side!='N':continue
            segments=[(32,38)]
        for section,(start,end) in enumerate(segments):
            # 梁顶贴楼板底；背面贴支撑墙朝池面，柱从地面接至梁底。
            lo=[0,0,ceiling-.28];hi=[0,0,ceiling]
            lo[along]=start;hi[along]=end
            lo[axis]=min(wall_face,wall_face+direction*.44);hi[axis]=max(wall_face,wall_face+direction*.44)
            beam=box(f'{PREFIX}{side}_{section}_Beam',lo,hi,axis,direction)
            count=max(2,math.ceil((end-start)/6)+1)
            for i in range(count):
                center=start+.25+(end-start-.5)*i/(count-1)
                plo=lo.copy();phi=hi.copy();plo[2]=floor;phi[2]=lo[2]
                plo[along]=center-.22;phi[along]=center+.22
                plo[axis]=min(wall_face,wall_face+direction*.32);phi[axis]=max(wall_face,wall_face+direction*.32)
                post=box(f'{PREFIX}{side}_{section}_Post_{i:02}',plo,phi,axis,direction)
                assert abs(bounds(post)[1][2]-bounds(beam)[0][2])<1e-5
                assert abs(bounds(post)[0][2]-floor)<1e-5
            assert abs(bounds(beam)[1][2]-ceiling)<1e-5
    print({'objects':len(made),'triangles':len(made)*12,'floorZ':floor,'ceilingZ':ceiling})
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))


def sync():
    assert Path(bpy.data.filepath).resolve()==MASTER
    with bpy.data.libraries.load(str(SOURCE),link=False) as (available,data):
        data.objects=[name for name in available.objects if name.startswith(PREFIX)]
    assert len(data.objects)>3,'不能导出未完成的单模块样板'
    previous=bpy.data.objects.get(TARGET)
    if previous:
        old_mesh=previous.data
        old_mat=old_mesh.materials[0]
        old_images=[n.image for n in old_mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]
        bpy.data.objects.remove(previous,do_unlink=True)
        if old_mesh.users==0:bpy.data.meshes.remove(old_mesh)
        if old_mat.users==0:bpy.data.materials.remove(old_mat)
        for image in old_images:
            if image.users==0:bpy.data.images.remove(image)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in data.objects:
        bpy.context.scene.collection.objects.link(obj);obj.select_set(True)
    bpy.context.view_layer.objects.active=data.objects[0]
    bpy.context.view_layer.update();bpy.ops.object.join()
    obj=bpy.context.object;obj.name=TARGET;obj.data.name=TARGET+'_Mesh'
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    assert len(obj.data.materials)==1
    obj.data.materials[0].name='StandArchitectureArtAtlas_Material'
    for node in obj.data.materials[0].node_tree.nodes:
        if node.type=='TEX_IMAGE' and node.image:node.image.name='StandArchitectureArtAtlas'
    bpy.ops.wm.save_as_mainfile(filepath=str(MASTER))


if __name__=='__main__':
    sync() if '--sync' in sys.argv else author()
