"""离线道具预览；临时相机和灯光不会写回正式 .blend 源文件。"""
import argparse
import sys
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
VIEWS = {'front': (0, -1, 0), 'back': (0, 1, 0), 'left': (-1, 0, 0),
         'right': (1, 0, 0), 'top': (0, 0, 1), 'bottom': (0, 0, -1), 'color': (1.4, -2, 1.1)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'modelresource/entertainment/EntertainmentItems.blend'))
    clay = bpy.data.materials.new('TemporarySolidInspection')
    clay.diffuse_color = (.5, .5, .5, 1)
    clay.use_nodes = True
    clay.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.5, .5, .5, 1)
    for scene in list(bpy.data.scenes):
        bpy.context.window.scene = scene
        objects = list(scene.objects)
        points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
        minimum = Vector([min(v[k] for v in points) for k in range(3)])
        maximum = Vector([max(v[k] for v in points) for k in range(3)])
        center = (minimum + maximum) * .5
        size = max(maximum-minimum)
        camera = bpy.data.objects.new('TemporaryInspectionCamera', bpy.data.cameras.new('TemporaryInspectionCamera'))
        scene.collection.objects.link(camera)
        camera.data.type = 'ORTHO'
        camera.data.ortho_scale = size * 1.35
        scene.camera = camera
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'CPU'
        scene.cycles.samples = 8
        scene.cycles.use_denoising = False
        scene.render.resolution_x = scene.render.resolution_y = 300
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.film_transparent = False
        scene.world = bpy.data.worlds.new(scene.name + '_TemporaryWorld')
        scene.world.use_nodes = True
        scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.08, .08, .08, 1)
        scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .4
        light = bpy.data.objects.new('TemporaryInspectionLight', bpy.data.lights.new('TemporaryInspectionLight', 'AREA'))
        scene.collection.objects.link(light)
        light.data.energy = 120
        light.data.size = size * 2
        original = {obj: list(obj.data.materials) for obj in objects}
        for name, direction in VIEWS.items():
            view = Vector(direction).normalized()
            camera.location = center + view * size * 4
            camera.rotation_euler = (-view).to_track_quat('-Z', 'Y').to_euler()
            light.location = center + view * size * 2 + Vector((size, -size*.5, size*1.5))
            light.rotation_euler = (center-light.location).to_track_quat('-Z', 'Y').to_euler()
            for obj in objects:
                obj.data.materials.clear()
                if name == 'color':
                    for mat in original[obj]: obj.data.materials.append(mat)
                else:
                    obj.data.materials.append(clay)
            scene.render.filepath = str(args.output / (scene.name + '-' + name + '.png'))
            bpy.ops.render.render(write_still=True)
    print('离线源模型预览已导出：', args.output)


if __name__ == '__main__':
    main()
