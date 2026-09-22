"""仅离线渲染作者源六面与无文字透明图标，不接触 Creator。"""
from pathlib import Path
import sys,shutil,argparse
import bpy
from mathutils import Vector
SOURCE=Path(__file__).resolve().parent;ROOT=SOURCE.parents[1];sys.path.insert(0,str(SOURCE))
from model_tools import camera_at
parser=argparse.ArgumentParser();parser.add_argument('--only',choices=['WaterBallCannon','SprayBuoy'])
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
for name,icon,target,scale in [('WaterBallCannon','cannon',(0,-.25,.72),2.65),('SprayBuoy','mine',(-.08,0,.67),1.95)]:
    if args.only and name!=args.only:continue
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/(name+'.blend')))
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
    scene.render.resolution_x=384;scene.render.resolution_y=384;scene.render.resolution_percentage=100
    scene.world=bpy.data.worlds.new('离线背景');scene.world.color=(.45,.45,.45)
    scene.view_settings.view_transform='Standard';scene.render.film_transparent=True
    light=bpy.data.lights.new('离线柔光','AREA');light.energy=380;light.size=4
    node=bpy.data.objects.new('离线柔光',light);scene.collection.objects.link(node);node.location=(1,-3,5)
    camera=camera_at((2,-4,2.6),target,scale)
    def render(suffix,delta):
        camera.location=Vector(target)+Vector(delta);camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(SOURCE/(name+'-'+suffix+'.png'));bpy.ops.render.render(write_still=True)
    for side,delta in [('front',(0,-4,0)),('back',(0,4,0)),('left',(-4,0,0)),('right',(4,0,0)),('top',(0,0,4)),('bottom',(0,0,-4)),('review',(2,-4,2.6))]:render(side,delta)
    scene.render.resolution_x=256;scene.render.resolution_y=256
    render('icon',(2,-4,2.6))
    out=ROOT/'art/ui/entertainment-banner-v1'
    shutil.copy2(SOURCE/(name+'-icon.png'),out/('icon-'+icon+'-generated-source.png'))
    shutil.copy2(SOURCE/(name+'-icon.png'),ROOT/'assets/race/ui/entertainment-banner-v1'/('icon-'+icon+'.png'))
    title='运动场水炮' if icon=='cannon' else '气球喷水浮标'
    (out/('icon-'+icon+'.svg')).write_text('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><title>'+title+'</title><desc>作者源 art/water-play-obstacles/'+name+'.blend；由 render_obstacles.py 离线渲染，无按钮文字。</desc><image href="icon-'+icon+'-generated-source.png" width="256" height="256"/></svg>\n',encoding='utf-8')
