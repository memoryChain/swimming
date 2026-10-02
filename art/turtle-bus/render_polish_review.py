"""只读源模型或正式离线几何；固定机位生成形体/顶点色对照，不保存审查相机。"""
import argparse
import json
import sys
from pathlib import Path
import bpy
from mathutils import Vector, Matrix
import math


def read_geometry(path):
    text = path.read_text(encoding='utf8')
    return json.loads(text.split('=', 1)[1].rsplit(';', 1)[0].replace(' as const', '').strip())


def colored_mesh(name, vertices, indices, colors):
    faces = [tuple(reversed(indices[i:i + 3])) for i in range(0, len(indices), 3)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    attr = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
    mesh.color_attributes.active_color = attr
    for i, item in enumerate(attr.data):
        item.color = colors[i * 4:i * 4 + 4]
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def cannon_meshes(path):
    # 读取正式同源顶点色；与海龟共用颜色解释与无光照预览，不重建水炮。
    for name, data in read_geometry(path)['WaterBallCannon'].items():
        positions = data['positions']
        vertices = [Vector((positions[i], positions[i + 2], positions[i + 1])) for i in range(0, len(positions), 3)]
        if name == 'CannonNozzle':
            rotation = Matrix.Rotation(math.radians(40), 3, 'X')
            vertices = [rotation @ p + Vector((0, 0, 1.04)) for p in vertices]
        colored_mesh(name, vertices, data['indices'], data['colors'])


def runtime_meshes(path, layout_path):
    geometry = read_geometry(path)
    layout = read_geometry(layout_path)
    for group, data in geometry.items():
        for instance in range(4 if group in ('ring', 'rope') else 1):
            pivot = data['pivot']
            offset = (layout['ringForward'][instance], layout['ringLateral'][instance], 0) if group == 'ring' else (pivot[0], pivot[2], pivot[1])
            positions = data['positions']
            vertices = [(positions[i] + offset[0], positions[i + 2] + offset[1], positions[i + 1] + offset[2]) for i in range(0, len(positions), 3)]
            if group == 'rope':
                anchor = Vector((layout['harnessForward'], math.copysign(layout['harnessLateral'], layout['ringLateral'][instance]), layout['harnessHeight']))
                end = Vector((layout['ringForward'][instance] + .71, layout['ringLateral'][instance], .15))
                direction = end - anchor
                rotation = Vector((1, 0, 0)).rotation_difference(direction.normalized())
                vertices = [anchor + rotation @ Vector((positions[i] * direction.length, positions[i + 2], positions[i + 1])) for i in range(0, len(positions), 3)]
            obj = colored_mesh(group, vertices, data['indices'], data['colors'])
            obj['runtime_group'] = group
            obj['pivot'] = offset


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--blend', type=Path)
    parser.add_argument('--geometry', type=Path)
    parser.add_argument('--cannon-geometry', type=Path, help='正式水炮顶点色几何，使用同一显示条件对比')
    parser.add_argument('--layout', type=Path)
    parser.add_argument('--out-dir', required=True, type=Path)
    parser.add_argument('--prefix', default='review')
    parser.add_argument('--views', default='hero,front,back,left,right,top,bottom,face,fin,full')
    parser.add_argument('--solid', action='store_true')
    parser.add_argument('--flap', type=float, default=0, help='静态核查摆鳍相位，范围 -1 到 1')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.out_dir.mkdir(parents=True, exist_ok=True)
    if args.blend:
        bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        if args.cannon_geometry:
            cannon_meshes(args.cannon_geometry)
        else:
            runtime_meshes(args.geometry, args.layout)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO' if args.blend or args.solid else 'FLAT'
    scene.display.shading.color_type = 'SINGLE' if args.solid else 'MATERIAL' if args.blend else 'VERTEX'
    scene.display.shading.single_color = (.62, .62, .62)
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = False
    scene.display.shading.show_specular_highlight = False
    scene.display.shading.background_type = 'WORLD'
    scene.world = bpy.data.worlds.new('ReviewWorld')
    scene.world.color = (.065, .085, .10)
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 850
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    camera = bpy.data.objects.new('只读审查相机', bpy.data.cameras.new('ReviewCamera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = 'ORTHO'
    objects = [o for o in scene.objects if o.type == 'MESH']
    for obj in objects:
        group = obj.get('runtime_group', '')
        if group in ('frontLeft', 'frontRight', 'rearLeft', 'rearRight'):
            # Cocos X 轴转角转换至 Blender Z 向上坐标；与正式 9°/5° 幅度一致。
            p = obj.get('pivot', (0, 0, 0))
            angle = (1 if group.endswith('Right') else -1) * (9 if group.startswith('front') else 5) * max(-1, min(1, args.flap))
            obj.matrix_world = Matrix.Translation(p) @ Matrix.Rotation(math.radians(angle), 4, 'X') @ Matrix.Translation(-Vector(p))
    views = {
        'hero': ((0, 0, .16), (6, -8, 6), 4.8),
        'front': ((.1, 0, .15), (1, 0, 0), 4.8),
        'back': ((.1, 0, .15), (-1, 0, 0), 4.8),
        'left': ((.1, 0, .15), (0, -1, 0), 4.8),
        'right': ((.1, 0, .15), (0, 1, 0), 4.8),
        'top': ((.1, 0, .15), (0, 0, 1), 5.8),
        'bottom': ((.1, 0, .15), (0, 0, -1), 5.8),
        'face': ((1.30, 0, .23), (5, -8, 3), 1.7),
        'fin': ((.02, -.99, .1), (2, -7, 3), 2.75),
        'full': ((-1.3, 0, .1), (7, -9, 11), 10.6),
    }
    if args.cannon_geometry:
        views = {'hero': ((0, 0, .9), (6, 8, 5), 3.3)}
    for name in args.views.split(','):
        for obj in objects:
            obj.select_set(False)
            obj.hide_render = name != 'full' and obj.get('runtime_group') in ('ring', 'rope', 'authoring_only')
        target, direction, scale = views[name]
        camera.location = Vector(target) + Vector(direction).normalized() * 20
        camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.ortho_scale = scale
        scene.render.filepath = str((args.out_dir / f'{args.prefix}-{name}.png').resolve())
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
