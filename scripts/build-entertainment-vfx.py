"""把原有巨浪／喷泉效果转成可编辑 Blender 源，或导出人工编辑后的源；不改造型。

python3 scripts/run-blender.py -- --python scripts/build-entertainment-vfx.py -- create --effect giant-wave --output /tmp/original-wave
python3 scripts/run-blender.py -- --python scripts/build-entertainment-vfx.py -- export --effect giant-wave
"""
import argparse
import json
import sys
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[1]
EFFECTS = {'giant-wave': 'GiantWave', 'geyser': 'Geyser', 'spray-buoy-splash': 'SprayBuoySplash'}


def make_source(path, reference):
    if path.exists():
        raise FileExistsError('保留已有源稿，请另存后再制作：' + str(path))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    initial = bpy.context.scene
    for name in reference:
        g = reference[name]
        scene = bpy.data.scenes.new(name)
        bpy.context.window.scene = scene
        scene.view_settings.view_transform = 'Standard'
        scene['runtimeCoordinates'] = 'Cocos Y-up；归一化尺寸，比赛中沿用原来变换'
        collection = bpy.data.collections.new(name + '_Editable')
        scene.collection.children.link(collection)
        positions = list(zip(*[iter(g['positions'])] * 3))
        faces = list(zip(*[iter(g['indices'])] * 3))
        mesh = bpy.data.meshes.new(name + 'Mesh')
        # Cocos 坐标换成 Blender Z-up，导出后还原，不留节点变换。
        mesh.from_pydata([(x, -z, y) for x, y, z in positions], [], faces)
        mesh.update()
        colors = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
        for target, color in zip(colors.data, zip(*[iter(g['colors'])] * 4)):
            # 原有效果直接写的是线性色，不重复转换为线性。
            target.color = color
        mesh.color_attributes.active_color = colors
        for face in mesh.polygons:
            face.use_smooth = True
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
        obj['source'] = '原运行时固定网格，保留形状与顶点色'
        mat = bpy.data.materials.new(name + 'VertexColor')
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        nodes.clear()
        color = nodes.new('ShaderNodeVertexColor')
        color.layer_name = 'Color'
        output = nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(color.outputs['Color'], output.inputs['Surface'])
        mesh.materials.append(mat)
    bpy.data.scenes.remove(initial)
    bpy.context.window.scene = bpy.data.scenes[next(iter(reference))]
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.shading.type = 'SOLID'
                area.spaces.active.shading.color_type = 'VERTEX'
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


def export(source, output, names):
    bpy.ops.wm.open_mainfile(filepath=str(source))
    output.mkdir(parents=True, exist_ok=True)
    for name in names:
        scene = bpy.data.scenes[name]
        bpy.context.window.scene = scene
        obj, = scene.objects
        if (obj.type != 'MESH' or obj.modifiers
                or any(abs(v) > 1e-7 for v in obj.location)
                or any(abs(v) > 1e-7 for v in obj.rotation_euler)
                or any(abs(v - 1) > 1e-7 for v in obj.scale)):
            raise ValueError('源对象应为单网格、已应用变换、无修改器：' + name)
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        scene.name = 'Scene'
        bpy.ops.export_scene.gltf(filepath=str(output / (name + '.glb')), export_format='GLB',
            use_selection=True, use_active_scene=True, export_yup=True, export_normals=False,
            export_texcoords=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
            export_materials='EXPORT', export_animations=False, export_skins=False, export_morph=False,
            export_cameras=False, export_lights=False, export_extras=False)
        scene.name = name


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['create', 'export'])
    p.add_argument('--output', type=Path)
    p.add_argument('--source', type=Path)
    p.add_argument('--effect', choices=EFFECTS, required=True)
    args = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
    name = EFFECTS[args.effect]
    reference = json.loads((ROOT / 'modelresource/entertainment' / (name + '-reference.json')).read_text())['meshes']
    source_path = args.source or ROOT / 'modelresource/entertainment' / (name + '.blend')
    if args.action == 'create':
        source = (args.output / (name + '.blend')) if args.output else source_path
        make_source(source, reference)
        export(source, args.output or ROOT / 'assets/race/items', reference)
    else:
        export(source_path, args.output or ROOT / 'assets/race/items', reference)


if __name__ == '__main__':
    main()
