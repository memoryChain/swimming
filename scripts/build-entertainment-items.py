"""用独立后台 Blender 建立可编辑道具源，或导出人工编辑后的源文件。

python3 scripts/run-blender.py -- --python scripts/build-entertainment-items.py -- rebuild
python3 scripts/run-blender.py -- --python scripts/build-entertainment-items.py -- export
"""
import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import bpy
import bmesh
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'modelresource' / 'entertainment'
BLEND = SOURCE / 'EntertainmentItems.blend'
OUTPUT = ROOT / 'assets' / 'race' / 'items'
spec = importlib.util.spec_from_file_location('recipes', ROOT / 'scripts' / 'entertainment-item-recipes.py')
recipes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipes)


def linear(value):
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


def material(name):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    attribute = nodes.new('ShaderNodeVertexColor')
    attribute.layer_name = 'Color'
    output = nodes.new('ShaderNodeOutputMaterial')
    # 直接连接颜色会隐式成为无光照表面，glTF 导出器识别为 KHR_materials_unlit。
    mat.node_tree.links.new(attribute.outputs['Color'], output.inputs['Surface'])
    return mat


def make_part(collection, item_id, name, vertices, faces, corner_colors, mat):
    # Blender Z 向上 → 导出 glTF Y 向上；转换不留节点旋转或缩放。
    mesh = bpy.data.meshes.new(item_id + '_' + name + 'Mesh')
    mesh.from_pydata([(x, -z, y) for x, y, z in vertices], [], faces)
    mesh.update()
    attr = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    for polygon, colors in zip(mesh.polygons, corner_colors):
        for index, color in zip(polygon.loop_indices, colors):
            attr.data[index].color = (*[linear(v) for v in color[:3]], color[3])
    mesh.color_attributes.active_color = attr
    mesh.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if any(not e.is_manifold for e in bm.edges):
        raise ValueError('部件存在开放边：' + item_id + '/' + name)
    if bm.calc_volume(signed=True) <= 0:
        raise ValueError('部件法线或体积错误：' + item_id + '/' + name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(item_id + '_' + name, mesh)
    collection.objects.link(obj)
    obj['role'] = name
    obj['authorColorSpace'] = 'sRGB palette converted once to linear COLOR_0'
    return obj


def rebuild():
    if BLEND.exists():
        raise FileExistsError('源文件已存在；保留人工编辑。重新制作请先另存源文件。')
    reference = json.loads((SOURCE / 'legacy-reference.json').read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    initial = bpy.context.scene
    for item_id, spec in recipes.ITEMS.items():
        scene = bpy.data.scenes.new(item_id)
        scene.unit_settings.system = 'METRIC'
        scene.unit_settings.scale_length = 1
        scene.view_settings.view_transform = 'Standard'
        scene['assetId'] = item_id
        scene['runtimeCoordinates'] = 'Y up; meters; origin and bounds match legacy-reference.json'
        collection = bpy.data.collections.new(item_id + '_Editable')
        scene.collection.children.link(collection)
        source = reference['items'][item_id]
        mat = material(source.get('materialName', item_id + 'VertexColor'))
        for part in recipes.recipe(item_id, source):
            make_part(collection, item_id, *part, mat)
        if 'rings' in spec:
            obj = collection.objects[0]
            for name, start, end in [('Cap', 0, 2), ('Neck', 2, 4), ('BodyAndLabel', 4, spec['rings'] - 1),
                                     ('Base', spec['rings'] - 1, spec['rings'])]:
                group = obj.vertex_groups.new(name=name)
                group.add(list(range(start * spec['segments'], end * spec['segments'])), 1, 'REPLACE')
        print('部件完成：', item_id, [obj['role'] for obj in collection.objects])
    bpy.data.scenes.remove(initial)
    bpy.context.window.scene = bpy.data.scenes['StimulantBottle']
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.shading.type = 'SOLID'
                area.spaces.active.shading.light = 'FLAT'
                area.spaces.active.shading.color_type = 'VERTEX'
                area.spaces.active.region_3d.view_distance = 2.4
                area.spaces.active.region_3d.view_location = (0, 0, 0)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))


def export_staged(output):
    reference = json.loads((SOURCE / 'legacy-reference.json').read_text())
    report = {}
    for item_id in recipes.ITEMS:
        scene = bpy.data.scenes[item_id]
        bpy.context.window.scene = scene
        sources = [o for o in scene.objects if o.type == 'MESH']
        if not sources or any(o.data.users != 1 for o in sources):
            raise ValueError('源部件缺失或共享 Mesh：' + item_id)
        if any(o.modifiers for o in sources):
            raise ValueError('请先应用修改器后再导出：' + item_id)
        if any(o.type != 'MESH' for o in scene.objects):
            raise ValueError('正式源场景不能包含灯光、相机或辅助对象：' + item_id)
        scene.view_layers[0].update()
        contacts = []
        for left, right in recipes.CONTACTS.get(item_id, []):
            a, b = scene.objects[item_id + '_' + left], scene.objects[item_id + '_' + right]
            tree_a = BVHTree.FromPolygons([a.matrix_world @ v.co for v in a.data.vertices],
                                         [list(p.vertices) for p in a.data.polygons])
            tree_b = BVHTree.FromPolygons([b.matrix_world @ v.co for v in b.data.vertices],
                                         [list(p.vertices) for p in b.data.polygons])
            intersections = len(tree_a.overlap(tree_b))
            gap = min(tree_a.find_nearest(b.matrix_world @ vertex.co)[3]
                      for vertex in b.data.vertices)
            if not intersections and gap > 1e-6:
                raise ValueError('部件未接触：' + item_id + '/' + left + '/' + right)
            contacts.append({'parts': [left, right], 'surfaceIntersections': intersections,
                             'nearestVertexDistance': round(gap, 8)})
        bpy.ops.object.select_all(action='DESELECT')
        copies = []
        for obj in sources:
            copy = obj.copy()
            copy.data = obj.data.copy()
            scene.collection.objects.link(copy)
            copy.select_set(True)
            copies.append(copy)
        bpy.context.view_layer.objects.active = copies[0]
        if len(copies) > 1:
            bpy.ops.object.join()
        merged = bpy.context.object
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        old = reference['items'][item_id]
        merged.name = old.get('nodeName', item_id)
        merged.data.name = old.get('meshName', item_id + 'Mesh')
        # 原名已经用于源部件；临时移开原名，以免 Blender 自动追加 .001。
        mat = sources[0].data.materials[0]
        original_mat_name = mat.name
        expected_mat_name = old.get('materialName', item_id + 'VertexColor')
        mat.name = expected_mat_name
        merged.data.materials.clear()
        merged.data.materials.append(mat)
        bm = bmesh.new()
        bm.from_mesh(merged.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        if any(not edge.is_manifold for edge in bm.edges) or bm.calc_volume(signed=True) <= 0:
            raise ValueError('导出对象开放边或错误体积：' + item_id)
        bm.free()
        merged.data.calc_loop_triangles()
        triangles = len(merged.data.loop_triangles)
        if triangles > len(old['indices']) // 3:
            raise ValueError('超过原始三角面预算：' + item_id)
        original_scene_name = scene.name
        scene.name = 'Scene'
        bpy.ops.export_scene.gltf(filepath=str(output / (item_id + '.glb')), export_format='GLB',
            use_selection=True, use_active_scene=True, export_yup=True, export_normals=True, export_texcoords=False,
            export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='EXPORT',
            export_animations=False, export_skins=False, export_morph=False, export_cameras=False,
            export_lights=False, export_extras=False)
        scene.name = original_scene_name
        report[item_id] = {'sourceParts': [o['role'] for o in sources], 'sourceVertices': sum(len(o.data.vertices) for o in sources),
                           'contacts': contacts,
                           'triangles': triangles, 'bytes': (output / (item_id + '.glb')).stat().st_size}
        mesh = merged.data
        bpy.data.objects.remove(merged, do_unlink=True)
        bpy.data.meshes.remove(mesh)
        mat.name = original_mat_name
    return report


def export_items():
    # 六件全部通过检查后才替换运行时文件，失败不留下半套资源。
    with tempfile.TemporaryDirectory(prefix='entertainment-items-') as temporary:
        staging = Path(temporary)
        report = export_staged(staging)
        for item_id in recipes.ITEMS:
            (staging / (item_id + '.glb')).replace(OUTPUT / (item_id + '.glb'))
    (SOURCE / 'export-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['rebuild', 'export'])
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if args.action == 'rebuild':
        rebuild()
    else:
        bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    export_items()


if __name__ == '__main__':
    main()
