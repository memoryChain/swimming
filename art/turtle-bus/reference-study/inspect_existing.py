"""只读现有作者源，生成美术方向比较图；不保存或改动游戏模型。"""
from pathlib import Path
import importlib.util
import json
import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]


def render(objects, name, direction, color='MATERIAL'):
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            obj.hide_render = obj not in objects
            obj.select_set(False)
    corners = [obj.matrix_world @ Vector(v) for obj in objects for v in obj.bound_box]
    lower = Vector([min(v[k] for v in corners) for k in range(3)])
    upper = Vector([max(v[k] for v in corners) for k in range(3)])
    center = (lower + upper) * .5
    camera_data = bpy.data.cameras.new('ComparisonCamera')
    camera = bpy.data.objects.new('ComparisonCamera', camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = center + Vector(direction).normalized() * 20
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data.type = 'ORTHO'
    inverse = camera.rotation_euler.to_matrix().transposed()
    points = [inverse @ (v - center) for v in corners]
    width = max(v.x for v in points) - min(v.x for v in points)
    height = max(v.y for v in points) - min(v.y for v in points)
    camera_data.ortho_scale = max(width, height * 1.5) * 1.15
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.color_type = color
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.show_cavity = True
    scene.display.shading.background_type = 'WORLD'
    scene.world.color = (.055, .075, .09)
    scene.render.resolution_x = 1050
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(OUT / (name + '.png'))
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    return {'min': list(lower), 'max': list(upper), 'dimensions': list(upper-lower)}


bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'art/turtle-bus/TurtleBus.blend'))
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
body = [o for o in objects if not o.name.startswith(('Tow ', 'Grip ', 'Harness '))]
audit = {'turtle': render(body, 'current-turtle', (6, -8, 7))}
render(objects, 'current-bus-top', (0, 0, 20))
render(objects, 'current-bus-side', (0, -20, 4))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.world = bpy.data.worlds.new('StudyWorld')
spec = importlib.util.spec_from_file_location('litter_source', ROOT / 'art/litter-debris/build_litter_debris.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
collection = bpy.data.collections.new('ExistingLitterComparison')
bpy.context.scene.collection.children.link(collection)
material = module.material()
objects = []
for name, builder in [('Cola', module.build_classic_cola), ('Crushed', module.build_crushed_water),
                      ('Sport', module.build_sport_drink), ('Tray', module.build_meal_tray)]:
    obj = module.make_object(name, builder(), collection, material, 'comparison')
    objects.append(obj)
    bpy.context.view_layer.update()
    audit[name] = render([obj], 'litter-' + name.lower(), (4, -7, 6), 'VERTEX')
(OUT / 'existing-proportions.json').write_text(json.dumps(audit, indent=2), encoding='utf8')
