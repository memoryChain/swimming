"""离线对照两个场馆 GLB；只创建展示相机，不保存 Blender 源文件。

通过 scripts/run-blender.py 启动，脚本参数 --before 为备份 GLB。
画面使用 GLB 自带材质，不代表 Cocos 水面着色或微信运行效果。
"""
import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--before', required=True)
parser.add_argument('--views', nargs='*', help='只重画指定视角')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
output = ROOT / 'temp/venue-first-pass'
output.mkdir(parents=True, exist_ok=True)

for version, path in [('before', Path(args.before)), ('after', ROOT / 'assets/race/pool/LowPolyPool.glb')]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 8
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Standard'
    scene.world = bpy.data.worlds.new('场馆离线预览背景')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.12, 0.16, 0.2, 1)
    for obj in scene.objects:
        if obj.type == 'MESH' and 'ceiling' in obj.name.lower():
            obj.hide_render = True
    camera = bpy.data.objects.new('离线展示相机', bpy.data.cameras.new('离线展示相机'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    for name, eye, target, fov in [
        ('forward', (8, 2, 1.2), (28, -1, 1.4), 64),
        ('reverse', (42, 2, 1.2), (22, -1, 1.4), 64),
        ('props-front', (25, 9.5, 2.4), (25, 14.6, 1.1), 55),
        ('props-back', (25, 19, 2.4), (25, 14.6, 1.1), 65),
        ('board-front', (9, 10.5, 1.2), (9, 18.1, 0.6), 55),
        ('board-back', (9, 20, 1.6), (9, 17.9, 0.7), 90),
        ('east-door', (50, 0, 1.4), (58, 0, 1.2), 65),
        ('corner', (49, 7, 1.5), (58, 17, 1.8), 64),
    ]:
        if args.views and name not in args.views:
            continue
        # 看台会遮住挡板背面；检查广告时隔离挡板，避免空画面误判通过。
        for obj in scene.objects:
            if obj.type == 'MESH':
                obj.hide_render = 'ceiling' in obj.name.lower() or (
                    name.startswith('board-') and obj.name != 'OlympicPanels_Merged')
        camera.location = eye
        camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.angle = math.radians(fov)
        scene.render.filepath = str(output / f'{version}-venue-{name}.png')
        bpy.ops.render.render(write_still=True)
print('场馆离线对照完成：', output)
