"""独立作者模型的统一光照对照与六面检查，不打开 Creator。"""
import bpy,sys
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent

def setup(source):
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene=bpy.context.scene
    for obj in bpy.data.objects:
        if obj.type=='ARMATURE':obj.data.pose_position='REST'
        elif obj.type=='MESH' and obj.name=='Icosphere':obj.hide_render=True
        elif obj.type in ('CAMERA','LIGHT'):obj.hide_render=True
    scene.render.engine='CYCLES';scene.cycles.samples=20
    scene.render.resolution_x=1000;scene.render.resolution_y=720;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.world=bpy.data.worlds.new('审稿环境');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.11,.16,.21,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.6
    scene.view_settings.view_transform='AgX'
    for name,pos,energy,size in [('主光',(-1,-3,4),180,3),('补光',(-3,1,1),90,3),('轮廓光',(2,3,2),160,2)]:
        o=bpy.data.objects.new(name,bpy.data.lights.new(name,'AREA'));scene.collection.objects.link(o);o.location=pos;o.data.energy=energy;o.data.size=size;o.rotation_euler=(Vector((0,.1,.2))-o.location).to_track_quat('-Z','Y').to_euler()
    cam=bpy.data.objects.new('审稿相机',bpy.data.cameras.new('审稿相机'));scene.collection.objects.link(cam);scene.camera=cam;cam.data.type='ORTHO'
    return scene,cam

def render(scene,cam,name,pos,target=(0,.02,.245),scale=1.45):
    cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=scale
    scene.render.filepath=str(HERE/(name+'.png'));bpy.ops.render.render(write_still=True)

scene,cam=setup(HERE/'Shark_Original_Toy_Study.blend')
views=[('hero',(-3,-1.5,1.2)),('left',(-3,.02,.245)),('right',(3,.02,.245)),('front',(0,-3,.245)),('back',(0,3,.245)),('top',(0,.02,3)),('bottom',(0,.02,-3))]
for name,pos in (views[:1] if '--quick' in sys.argv else views):render(scene,cam,name,pos)
if '--quick' not in sys.argv:
    render(scene,cam,'valve',(-3,-.1,1),(0,.16,.20),.39)
    render(scene,cam,'face',(-3,-2,.7),(0,-.32,.18),.48)
    scene,cam=setup(HERE.parent/'archive/SharkModel_pre_D.blend')
    render(scene,cam,'original',(-3,-1.5,1.2));render(scene,cam,'original-side',(-3,.02,.245))
print('离线试稿渲染完成')
