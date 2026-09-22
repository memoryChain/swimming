"""离线状态、六面结构、真实角色挂载与转交示意；不是游戏实机。"""
from pathlib import Path
import bpy
import json
import math
from mathutils import Vector, Quaternion

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[1]
bpy.ops.wm.open_mainfile(filepath=str(OUT/'TimedWaterBalloon.blend'))
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=12
scene.render.resolution_x=640;scene.render.resolution_y=640;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('离线背景');scene.world.color=(.23,.3,.36)
scene.view_settings.view_transform='AgX'
body=bpy.data.objects['BalloonBody'];connector=bpy.data.objects['BalloonConnector'];root=bpy.data.objects['TimedWaterBalloon']
light=bpy.data.lights.new('离线柔光','AREA');light.energy=450;light.size=4
node=bpy.data.objects.new('离线柔光',light);scene.collection.objects.link(node);node.location=(1,-3,4)
camera=bpy.data.objects.new('离线相机',bpy.data.cameras.new('离线相机'));scene.collection.objects.link(camera);scene.camera=camera
camera.data.type='ORTHO'


def render(name,location,target,scale=1):
    camera.location=location;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=scale
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)


for state,scale,angle in [('normal',1,0),('inflated',1.22,0),('locked',1.22,4)]:
    body.scale=(scale,)*3;body.rotation_euler.y=math.radians(angle)
    for view,delta in [('front',(0,-3,0)),('side',(3,0,0)),('race',(2,-3,1.7))]:
        render(state+'-'+view,Vector((0,0,.32))+Vector(delta),(0,0,.32),.88)
body.scale=(1,)*3;body.rotation_euler.y=0
for name,delta in [('back',(0,3,0)),('left',(-3,0,0)),('top',(0,0,3)),('bottom',(0,0,-3))]:
    render('structure-'+name,Vector((0,0,.3))+Vector(delta),(0,0,.3),.85)
# 从同一模型离线导出透明图标，文字仍由游戏 Label 承担。
scene.render.film_transparent=True;scene.render.resolution_x=256;scene.render.resolution_y=256
render('icon-timed-water-balloon',(1.8,-3,1.6),(0,0,.3),.72)
scene.render.film_transparent=False;scene.render.resolution_x=1000;scene.render.resolution_y=750
rows=json.loads((ROOT/'.cache/timed-water-balloon-review.json').read_text(encoding='utf-8'))
neutral=bpy.data.materials.new('角色中性审查材质');neutral.diffuse_color=(.15,.48,.58,1)
review=[]
for i,row in enumerate(rows):
    offset=Vector(((i%4)*2.4,-(i//4)*1.9,0))
    for m in row['meshes']:
        mesh=bpy.data.meshes.new(row['file']);idx=m['indices'];mesh.from_pydata(m['vertices'],[],[idx[j:j+3] for j in range(0,len(idx),3)]);mesh.update();mesh.materials.append(neutral)
        obj=bpy.data.objects.new(row['file'],mesh);scene.collection.objects.link(obj);obj.location=offset;obj['reviewIndex']=i;review.append(obj)
    for template in (body,connector):
        obj=template.copy();obj.data=template.data;obj.parent=None;scene.collection.objects.link(obj)
        rotation=Quaternion(row['rotation'])
        obj.location=offset+Vector(row['position'])+rotation @ template.location;obj['reviewIndex']=i
        obj.rotation_mode='QUATERNION';obj.rotation_quaternion=rotation
        if template==body:obj.scale=(1.22,)*3
        review.append(obj)
body.hide_render=True;connector.hide_render=True
render('all-character-mounts',(7,-10,10),(3.5,-1.7,.05),10.5)
for i in (0,1):
    for obj in review:obj.hide_render=obj['reviewIndex']!=i
    target=Vector(rows[i]['position'])+Vector((i*2.4,0,.1))
    for name,delta in [('front',(4,0,1)),('side',(0,-4,1)),('race',(-3,-4,3))]:
        render('mount-'+str(i)+'-'+name,target+Vector(delta),target,1.9)
# 三个时刻示意同一个道具沿短弧线转交；幽灵样本只用于离线说明。
for obj in review:obj.hide_render=True
body.hide_render=False;connector.hide_render=False
for i in range(5):
    t=i/4
    for template in (body,connector):
        obj=template.copy();obj.data=template.data;obj.parent=None;scene.collection.objects.link(obj)
        obj.location=template.location+Vector((-1+2*t,0,math.sin(t*math.pi)*.55))
        obj.scale=(1.12,)*3 if template==body else (1,)*3
body.hide_render=True;connector.hide_render=True
render('transfer-arc',(0,-6,2),(0,0,.5),3.2)
print('离线预览已完成，未启动或截图 Creator。')
