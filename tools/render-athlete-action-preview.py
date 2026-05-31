import math
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
GLB = ROOT / "assets/resources/models/FreestyleCartoonAthleteV2.glb"
OUT = ROOT / "tools/action_preview"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=str(GLB))

OUT.mkdir(exist_ok=True)

camera_data = bpy.data.cameras.new("PreviewCamera")
camera = bpy.data.objects.new("PreviewCamera", camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera
camera.location = (0, -7.5, 2.2)
camera.rotation_euler = (math.radians(76), 0, 0)
camera.data.lens = 55

light_data = bpy.data.lights.new("PreviewLight", "AREA")
light = bpy.data.objects.new("PreviewLight", light_data)
bpy.context.collection.objects.link(light)
light.location = (0, -4, 5)
light.data.energy = 600
light.data.size = 5

bpy.context.scene.render.engine = "BLENDER_EEVEE"
bpy.context.scene.render.resolution_x = 900
bpy.context.scene.render.resolution_y = 900
if hasattr(bpy.context.scene, "eevee"):
    bpy.context.scene.eevee.taa_render_samples = 32

for frame in [1, 8, 16, 24, 32, 40]:
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    bpy.context.scene.render.filepath = str(OUT / f"frame_{frame:02d}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDER", bpy.context.scene.render.filepath)
