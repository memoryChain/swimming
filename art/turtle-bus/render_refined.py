"""只读源资产与正式角色样件，生成六视图和抓握近景，不保存预览相机到模型源。"""
from pathlib import Path
import json
import bpy
from mathutils import Vector
ART=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(ART/'TurtleBus.blend'))
scene=bpy.context.scene
scene.world=bpy.data.worlds.new('ReviewWorld');scene.world.color=(.085,.11,.13)
scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO'
scene.display.shading.color_type='MATERIAL';scene.display.shading.show_cavity=True
scene.display.shading.background_type='WORLD'
scene.render.resolution_x=1200;scene.render.resolution_y=800;scene.render.resolution_percentage=100
cam_data=bpy.data.cameras.new('ReviewCamera');cam=bpy.data.objects.new('ReviewCamera',cam_data)
scene.collection.objects.link(cam);scene.camera=cam;cam_data.type='ORTHO'

def render(name,target,direction,scale):
    cam.location=Vector(target)+Vector(direction).normalized()*20
    cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    cam_data.ortho_scale=scale;scene.render.filepath=str(ART/f'preview-{name}.png')
    bpy.ops.render.render(write_still=True)

for name,d in [('top',(0,0,1)),('bottom',(0,0,-1)),('front',(1,0,0)),('rear',(-1,0,0)),('left',(0,-1,0)),('right',(0,1,0))]:
    render(name,(-1,0,.1),d,11.3)
render('hero',(-1.3,0,.1),(7,-9,11),10.6)
objects=[o for o in scene.objects if o.type=='MESH']
for o in objects:o.hide_render=not o.name.startswith(('Circle1_',))
samples=json.loads((ART/'grip-review-data.json').read_text(encoding='utf8'))
for model in samples:
    made=[]
    for i,part in enumerate(model['parts']):
        mesh=bpy.data.meshes.new('PosedSwimmer')
        vertices=[(v[0]-3.5,v[1]-.95,v[2]) for v in part['vertices']]
        faces=[part['indices'][j:j+3] for j in range(0,len(part['indices']),3)]
        mesh.from_pydata(vertices,[],faces);mesh.update()
        obj=bpy.data.objects.new('PosedSwimmer',mesh);scene.collection.objects.link(obj);made.append(obj)
        mat=bpy.data.materials.new('ReviewSwimmer');mat.diffuse_color=part['color'];mesh.materials.append(mat)
    stem=Path(model['file']).stem
    render('grip-'+stem,(-4.6,-.95,.02),(2,-6,5),4.6)
    render('grip-side-'+stem,(-4.6,-.95,.02),(0,-1,0),4.6)
    for obj in made:bpy.data.objects.remove(obj,do_unlink=True)
