"""在专用后台场景渲染换气对照，不访问 Creator 或用户的 Blender 场景。"""
import json
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.cache' / 'freestyle-breathing-preview'


def main():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    for entry in json.loads((OUT / 'manifest.json').read_text(encoding='utf8')):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(OUT / entry['file']))
        for obj in set(bpy.data.objects) - before:
            if obj.parent is None:
                obj.location += Vector((entry['col'] * 4.2, entry['row'] * 3.0, 0))
    bpy.ops.object.camera_add(location=(8.8, -10, 24))
    camera = bpy.context.object
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 22
    scene.camera = camera
    bpy.ops.object.light_add(type='AREA', location=(8, -5, 14))
    bpy.context.object.data.energy = 2300
    bpy.context.object.data.shape = 'DISK'
    bpy.context.object.data.size = 15
    scene.world.color = (.5, .5, .5)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.render.resolution_x = 1900
    scene.render.resolution_y = 1250
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'Standard'
    for name, location in [('oblique', (8.8, -10, 24)), ('top', (8.8, 4.5, 30))]:
        camera.location = location
        camera.rotation_euler = (Vector((8.8, 4.5, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(OUT / f'breathing-{name}.png')
        bpy.ops.render.render(write_still=True)
    camera.data.ortho_scale = 5.8
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1000
    target = Vector((9.1, 1.5, 0.2))
    for name, location in [('close-right', (10, 8, 5)), ('close-left', (10, -5, 5))]:
        camera.location = location
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(OUT / f'breathing-{name}.png')
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
