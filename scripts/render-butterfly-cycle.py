"""专用后台场景渲染连续蝶泳，水面线用于判断穿水，非实机效果。"""
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.cache' / 'butterfly-cycle'

def main():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(OUT / 'MuscleMan.glb'))
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 8
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 640
    scene.render.resolution_y = 360
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.fps = 30
    scene.world.color = (.35,.35,.35)
    scene.view_settings.view_transform = 'Standard'
    # 水面参照线保留身体全轮廓，后续接入实机才验证水体遮挡和水花。
    material = bpy.data.materials.new('WaterReference')
    material.diffuse_color = (.04,.40,.60,1)
    for y in [-.55,.55]:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(.85,y,0))
        rail = bpy.context.object
        rail.scale = (2.4,.015,.015)
        rail.data.materials.append(material)
    bpy.ops.object.light_add(type='AREA',location=(1,-3,5))
    bpy.context.object.data.energy = 450
    bpy.context.object.data.size = 5
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type='ORTHO'
    camera.data.ortho_scale=2.65
    scene.camera = camera
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'butterfly-cycle.blend'))
    for view, location in [('side',(.85,-5,.38)),('race',(2.5,-3,2.5))]:
        camera.location = location
        camera.rotation_euler=(Vector((.85,0,.03))-camera.location).to_track_quat('-Z','Y').to_euler()
        target=OUT/view
        target.mkdir(exist_ok=True)
        for frame in range(32):
            scene.frame_set(frame)
            scene.render.filepath=str(target/f'{frame:03}.png')
            bpy.ops.render.render(write_still=True)

if __name__ == '__main__':
    main()
