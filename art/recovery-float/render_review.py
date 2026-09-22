"""从运行时蒙皮几何生成离线接触审查图，不加载 Creator。"""
from pathlib import Path
import bpy
import json
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
rows=json.loads((ROOT/'.cache/recovery-float-review.json').read_text(encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.samples=24
scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('审查背景');scene.world.color=(.35,.35,.35)

def material(name,color):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); return m
body=material('审查用中性材质',(.3,.52,.6))
water=material('水面参考',(.05,.2,.28))
with bpy.data.libraries.load(str(OUT/'RecoveryFloatRing.blend'),link=False) as (src,dst):
    dst.objects=['RecoveryFloatRing']
template=dst.objects[0]
for index,row in enumerate(rows):
    col=index%4; line=index//4
    offset=Vector((col*2.2,-line*2.5,0))
    for m in row['meshes']:
        mesh=bpy.data.meshes.new(row['file']); indices=m['indices']
        mesh.from_pydata(m['vertices'],[],[indices[i:i+3] for i in range(0,len(indices),3)]);mesh.update()
        mesh.materials.append(body)
        obj=bpy.data.objects.new(row['file'],mesh);scene.collection.objects.link(obj);obj.location=offset;obj['reviewIndex']=index
    ring=template.copy();ring.data=template.data
    scene.collection.objects.link(ring)
    ring['reviewIndex']=index
    ring.location=Vector(row['ring']['position'])+offset;ring.scale=(row['ring']['radius'],)*3
    # 水面只用边框，保留水下双腿可见便于检查。
    bpy.ops.mesh.primitive_plane_add(size=1.65,location=offset+Vector((.5,0,.055)))
    plane=bpy.context.object; plane.data.materials.append(water)
    plane.hide_render=True
    label=bpy.data.curves.new('角色编号','FONT');label.body=row['file'].replace('.glb','');label.size=.14
    obj=bpy.data.objects.new('角色编号',label);scene.collection.objects.link(obj);obj.location=offset+Vector((-.2,-.9,-.56))
    obj['reviewIndex']=index
    obj.rotation_euler=(.8,0,0)

def camera(location,target,scale):
    data=bpy.data.cameras.new('离线审查相机');obj=bpy.data.objects.new('离线审查相机',data);scene.collection.objects.link(obj)
    obj.location=location;obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO';data.ortho_scale=scale;scene.camera=obj
    return obj
light=bpy.data.lights.new('审查灯','AREA');light.energy=1700;light.shape='DISK';light.size=10
obj=bpy.data.objects.new('审查灯',light);scene.collection.objects.link(obj);obj.location=(4,-2,7)
scene.view_settings.view_transform='Standard'
cam=camera((10,-13,12),(3.5,-2.5,0),10)
scene.render.resolution_x=1600;scene.render.resolution_y=1400
scene.render.filepath=str(OUT/'all-characters.png');bpy.ops.render.render(write_still=True)
# 单个最宽与最窄角色分别检查正面、侧面及上方。
scene.render.resolution_x=900;scene.render.resolution_y=900
for index in (0,1):
    for obj in scene.objects:
        if 'reviewIndex' in obj:obj.hide_render=obj['reviewIndex']!=index or obj.type=='FONT'
    target=Vector((index*2.2+.6,0,0))
    for name,delta in [('side',(0,-4,1.5)),('front',(4,0,1.5)),('top',(0,0,5))]:
        cam.location=target+Vector(delta);cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=1.55
        scene.render.filepath=str(OUT/f'contact-{index}-{name}.png');bpy.ops.render.render(write_still=True)
