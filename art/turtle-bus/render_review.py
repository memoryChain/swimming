"""Render a local Blender review image without changing the authoring source."""
from pathlib import Path
import bpy
from mathutils import Vector

art = Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(art / "TurtleBus.blend"))
bpy.ops.object.camera_add(location=(-1.0, 0, 21))
camera = bpy.context.object
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 13
bpy.context.scene.camera = camera
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.light = 'STUDIO'
scene.display.shading.show_cavity = True
scene.render.resolution_x = 1200
scene.render.resolution_y = 750
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
for name, position, target in (
    ('top', (-1, 0, 21), (-1, 0, 0)),
    ('side', (-1, -20, 5), (-1, 0, 0)),
    ('front', (15, 0, 4), (-1, 0, 0)),
    ('rear', (-19, 0, 4), (-1, 0, 0)),
    ('bottom', (-1, 0, -20), (-1, 0, 0)),
):
    camera.location = position
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(art / f'preview-{name}.png')
    bpy.ops.render.render(write_still=True)
