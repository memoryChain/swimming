"""离线比较早松、准确、晚松和加踢腿；使用导出的真实运行时动作，不启动 Creator。"""
from pathlib import Path
import argparse
import sys
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.cache' / 'butterfly-buoyancy'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='CartonSwimmer5')
    parser.add_argument('--view', choices=['side', 'race'], default='side')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 4
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 720
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Standard'
    scene.world.color = (.4, .4, .4)
    line = bpy.data.materials.new('WaterReference')
    line.diffuse_color = (.08, .55, .8, 1)
    for index, scenario in enumerate(['early', 'perfect', 'late', 'kick']):
        existing = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(OUT / f'{args.model}-{scenario}.glb'))
        # 每行一个角色，整体平移不写入被动画驱动的角色节点。
        holder = bpy.data.objects.new(f'Comparison-{scenario}', None)
        scene.collection.objects.link(holder)
        for obj in set(bpy.data.objects) - existing - {holder}:
            if obj.parent is None:
                obj.parent = holder
        holder.location.z = (3 - index) * .75
        bpy.ops.mesh.primitive_cube_add(size=1, location=(.85, -.5, holder.location.z))
        rail = bpy.context.object
        rail.scale = (2.3, .008, .008)
        rail.data.materials.append(line)
    bpy.ops.object.light_add(type='AREA', location=(1, -4, 6))
    bpy.context.object.data.energy = 800
    bpy.context.object.data.size = 5
    bpy.ops.object.camera_add(location=(.9, -6, 1.35) if args.view == 'side' else (3, -6, 3.8))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((.9, 0, 1.35)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 4.8
    scene.camera = camera
    name = 'comparison-final' if args.model == 'CartonSwimmer5' and args.view == 'side' else f'{args.model}-{args.view}'
    frames = OUT / name
    frames.mkdir(exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / f'{name}.blend'))
    for frame in range(17):
        scene.frame_set(frame * 2)
        scene.render.filepath = str(frames / f'{frame:03}.png')
        bpy.ops.render.render(write_still=True)

if __name__ == '__main__':
    main()
