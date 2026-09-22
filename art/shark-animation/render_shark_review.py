"""仅渲染独立作者源，输出六面、近景和无文字透明图标，不访问 Creator。"""
import bpy, sys, json
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(HERE/'SharkModel_bite_source.blend'))
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=12
scene.render.resolution_x=640; scene.render.resolution_y=640; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
scene.world=bpy.data.worlds.new('离线背景'); scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.13,.19,.25,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.5
scene.view_settings.view_transform='AgX'
for name,pos,energy,size in [('主柔光',(1,-3,4),200,3),('补光',(-3,-1,1),100,3),('轮廓光',(1,3,2),150,2)]:
    light=bpy.data.objects.new(name,bpy.data.lights.new(name,'AREA')); scene.collection.objects.link(light)
    light.location=pos; light.data.energy=energy; light.data.size=size
    light.rotation_euler=(Vector((0,0,.25))-light.location).to_track_quat('-Z','Y').to_euler()
cam=bpy.data.objects.new('离线相机',bpy.data.cameras.new('离线相机')); scene.collection.objects.link(cam); scene.camera=cam
cam.data.type='ORTHO'
def render(name,pos,scale=1.58,target=(0,.20,.28)):
    cam.location=pos; cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.ortho_scale=scale
    scene.render.filepath=str(HERE/(name+'.png')); bpy.ops.render.render(write_still=True)
scene.frame_set(1)
for name,pos in ([] if '--export-icon-only' in sys.argv else [('front',(0,-3,.28)),('back',(0,3,.28)),('left',(-3,.2,.28)),('right',(3,.2,.28)),('top',(0,.2,3)),('bottom',(0,.2,-3)),('hero',(-3,-1.7,1.45))]):
    render(name,pos)
scene.render.film_transparent=True; scene.render.resolution_x=256; scene.render.resolution_y=256
if '--export-icon-only' not in sys.argv:
    render('icon-shark',(-3,-1.7,1.45),1.45,(0,.20,.28))
if '--apply-icon' in sys.argv:
    # 保留运行时 128px 画布；源模型、灯光和镜头是图标的可编辑作者源。
    source=bpy.data.images.load(str(HERE/'icon-shark.png'),check_existing=False)
    # 先实际读像素，再改目标路径；避免惰性加载读取目标位置的旧图。
    source.pixels[:]
    source.filepath_raw=str(HERE.parents[1]/'art/ui/entertainment-banner-v1/icon-shark-generated-source.png'); source.save()
    source.scale(128,128)
    source.filepath_raw=str(HERE.parents[1]/'assets/race/ui/entertainment-banner-v1/icon-shark.png'); source.save()
print('D_离线渲染完成')
