"""实际运行时缩放／旋转采样的离线渲染图集；不属于游戏实录。"""
from pathlib import Path
import bpy, json, numpy as np
from mathutils import Vector, Quaternion

out=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(out/'TimedWaterBalloon.blend'))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=8
scene.render.resolution_x=256;scene.render.resolution_y=256;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('离线背景');scene.world.color=(.23,.3,.36);scene.view_settings.view_transform='AgX'
light=bpy.data.lights.new('离线柔光','AREA');light.energy=450;light.size=4
node=bpy.data.objects.new('离线柔光',light);scene.collection.objects.link(node);node.location=(1,-3,4)
camera=bpy.data.objects.new('离线相机',bpy.data.cameras.new('离线相机'));scene.collection.objects.link(camera);scene.camera=camera
camera.location=(1.7,-3,1.8);camera.rotation_euler=(Vector((0,0,.38))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=1.04
body=bpy.data.objects['BalloonBody'];body.rotation_mode='QUATERNION'
frames=json.loads((out/'animation-samples.json').read_text(encoding='utf-8'))['frames']
atlas=np.zeros((12*256,8*256,4),dtype=np.float32)
temp=out.parents[1]/'.cache/balloon-motion-frame.png'
for i,frame in enumerate(frames):
    sx,sy,sz=frame['scale'];body.scale=(sx,sz,sy);body.rotation_quaternion=Quaternion(frame['quaternion'])
    scene.render.filepath=str(temp);bpy.ops.render.render(write_still=True)
    img=bpy.data.images.load(str(temp),check_existing=False)
    pixels=np.array(img.pixels[:],dtype=np.float32).reshape((256,256,4))
    y=(11-i//8)*256;x=(i%8)*256;atlas[y:y+256,x:x+256]=pixels
    bpy.data.images.remove(img)
image=bpy.data.images.new('离线动画图集',width=2048,height=3072,alpha=False)
image.pixels.foreach_set(atlas.ravel());image.filepath_raw=str(out/'animation-strip.png');image.file_format='PNG';image.save()
print('已输出 96 帧离线动画图集。')
