"""使用运行时导出的实际角色姿态生成 Blender 离线样片，不启动 Creator。"""
import json
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.cache' / 'butterfly-preview'

def main():
    # 仅在 --factory-startup 后的专用后台场景运行。
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    for entry in json.loads((OUT / 'manifest.json').read_text(encoding='utf8')):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(OUT / entry['file']))
        added = set(bpy.data.objects) - before
        for obj in added:
            if obj.parent is None:
                obj.location += Vector((entry['col'] * 4.8, entry['row'] * 5, 0))
    bpy.ops.object.camera_add(location=(10, -17, 23))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((10,2.5,0))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 27
    scene.camera = camera
    bpy.ops.object.light_add(type='AREA', location=(8,-5,14))
    bpy.context.object.data.energy = 2200
    bpy.context.object.data.shape = 'DISK'
    bpy.context.object.data.size = 15
    scene.world.color = (.5,.5,.5)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = str(OUT / 'butterfly-keyframes.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'butterfly-preview.blend'))
    bpy.ops.render.render(write_still=True)

if __name__ == '__main__':
    main()
