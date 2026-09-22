"""同源水球六面检查；发光顶点色与运行时相同，不输出游戏图标。"""
from pathlib import Path
import sys
import bpy
from mathutils import Vector
SOURCE=Path(__file__).resolve().parent
sys.path.insert(0,str(SOURCE))
from model_tools import camera_at
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'CannonWaterBall.blend'))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=8
scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard';scene.render.film_transparent=True
camera=camera_at((1,-4,1.5),(0,0,0),.73)
for side,delta in [('front',(0,-4,0)),('back',(0,4,0)),('left',(-4,0,0)),('right',(4,0,0)),('top',(0,0,4)),('bottom',(0,0,-4)),('review',(1,-4,1.5))]:
    camera.location=Vector(delta);camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(SOURCE/('CannonWaterBall-'+side+'.png'));bpy.ops.render.render(write_still=True)
