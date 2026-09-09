"""第一轮场馆减面：76 块广告挡板与 24 件倒角方块。

在 editable 运行创作；在 master 传 --sync 定向重建两个批次。
默认只在内存试算，--apply 才保存；随后必须运行标准合批和导出脚本。
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
EDITABLE = ROOT / 'sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend'
MASTER = ROOT / 'sceneresource/SwimmingVenue_Rebuild_FlatColor.blend'
VERSION_KEY = 'venue_simple_box_version'
BOX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def ad_module():
    spec = importlib.util.spec_from_file_location('venue_ads', Path(__file__).with_name('refine-venue-ad-boards.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def bounds(points):
    return tuple((min(v[i] for v in points), max(v[i] for v in points)) for i in range(3))


def world_bounds(obj):
    return bounds([obj.matrix_world @ v.co for v in obj.data.vertices])


def corners(limits):
    lo = [p[0] for p in limits]
    hi = [p[1] for p in limits]
    return [Vector(p) for p in [(lo[0], lo[1], lo[2]), (hi[0], lo[1], lo[2]),
            (hi[0], hi[1], lo[2]), (lo[0], hi[1], lo[2]),
            (lo[0], lo[1], hi[2]), (hi[0], lo[1], hi[2]),
            (hi[0], hi[1], hi[2]), (lo[0], hi[1], hi[2])]]


def replace_box(obj, points):
    old = obj.data
    name = old.name
    mesh = bpy.data.meshes.new(name + '_simple')
    mesh.from_pydata(points, [], BOX_FACES)
    for material in old.materials:
        mesh.materials.append(material)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    # 坐标基底可以翻转；统一外法线并检查闭合与正体积。
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    assert all(edge.is_manifold for edge in bm.edges), obj.name
    assert bm.calc_volume(signed=True) > 1e-9, obj.name
    bm.to_mesh(mesh)
    bm.free()
    obj.data = mesh
    if old.users == 0:
        bpy.data.meshes.remove(old)
        mesh.name = name
    obj[VERSION_KEY] = 1
    assert triangles(obj) == 12


def author():
    assert Path(bpy.data.filepath).resolve() == EDITABLE
    ads = ad_module()
    boards = ads.sources()
    props = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render
             and o.name.startswith('PoolsideProp_')
             and (o.get(VERSION_KEY) == 1 or triangles(o) == 44)]
    assert len(boards) == 76 and len(props) == 24, (len(boards), len(props))
    report = []
    for obj in boards + props:
        before = triangles(obj)
        old_bounds = world_bounds(obj)
        old_matrix = obj.matrix_world.copy()
        is_board = obj in boards
        if obj.get(VERSION_KEY) != 1:
            assert len(obj.data.materials) == 1, obj.name
            if is_board:
                panel = ads.describe(obj)
                # 源板的局部 X/Y 是长度/厚度；保留其原旋转和裁切端点。
                # 半板的最长边可能是斜向三角化边，不能用该边重定向盒体。
                local_bounds = bounds([v.co for v in obj.data.vertices])
                replace_box(obj, corners(local_bounds))
                uv = obj.data.uv_layers.new(name='UVMap')
                # 使用原板的投影范围和广告分配，正反文字沿用已有映射规则。
                for poly in obj.data.polygons:
                    ads.remap_face(obj, poly, panel, uv.data)
                assert all(-1e-5 <= c <= 1.00001 for v in uv.data for c in v.uv)
            else:
                local_bounds = bounds([v.co for v in obj.data.vertices])
                replace_box(obj, corners(local_bounds))
                # 六个局部支承平面不动，保留桌脚/屏幕/座面原有接触位置。
                assert bounds([v.co for v in obj.data.vertices]) == local_bounds
        assert obj.matrix_world == old_matrix, obj.name
        assert triangles(obj) == 12, obj.name
        delta = max(abs(a - b) for old, new in zip(old_bounds, world_bounds(obj)) for a, b in zip(old, new))
        # 去倒角补回角点允许厘米级包围盒差，防止错轴和不正确的角板方向。
        assert delta < 0.035, (obj.name, delta)
        report.append({'name': obj.name, 'before': before, 'after': 12, 'boundsDelta': delta})
    assert sum(triangles(o) for o in boards) == 912
    return {'mode': 'author', 'objects': report, 'boards': 912, 'boxProps': 288}


def join_sources(target, source_path, names):
    old_mesh_name = target.data.name
    old_matrix = target.matrix_world.copy()
    old_bounds = world_bounds(target)
    with bpy.data.libraries.load(str(source_path), link=False) as (_, loaded):
        loaded.objects = names
    objects = loaded.objects
    assert len(objects) == len(names) and all(o is not None for o in objects)
    for obj in objects:
        bpy.context.scene.collection.objects.link(obj)
        obj.hide_set(False)
        obj.hide_viewport = False
    bpy.context.view_layer.update()
    source_bounds = bounds([o.matrix_world @ v.co for o in objects for v in o.data.vertices])
    expected_triangles = sum(triangles(o) for o in objects)
    # 原生 Join 负责各对象 world transform；空活动对象定义目标坐标系。
    anchor = bpy.data.objects.new('FirstPassJoin', bpy.data.meshes.new('FirstPassJoin'))
    anchor.matrix_world = old_matrix
    bpy.context.scene.collection.objects.link(anchor)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects + [anchor]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = anchor
    bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    anchor.data.transform(old_matrix.inverted())
    anchor.matrix_world = old_matrix
    bpy.context.view_layer.update()
    assert triangles(anchor) == expected_triangles
    assert max(abs(a-b) for x,y in zip(source_bounds,world_bounds(anchor)) for a,b in zip(x,y)) < 2e-5
    old_mesh = target.data
    target.data = anchor.data
    bpy.data.objects.remove(anchor, do_unlink=True)
    if old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)
    target.data.name = old_mesh_name
    assert target.matrix_world == old_matrix
    delta = max(abs(a-b) for x,y in zip(old_bounds,world_bounds(target)) for a,b in zip(x,y))
    assert delta < 0.035, (target.name, delta)
    return {'name': target.name, 'triangles': triangles(target), 'boundsDelta': delta, 'sources': len(names)}


def sync():
    assert Path(bpy.data.filepath).resolve() == MASTER
    with bpy.data.libraries.load(str(EDITABLE), link=False) as (available, _):
        board_names = [n for n in available.objects if n.startswith('OlympicPanel_') and ('_T1_' in n or '_T3_' in n)]
        prop_names = [n for n in available.objects if n.startswith(('PoolsideProp_', 'Prototype_'))]
    assert len(board_names) == 76 and len(prop_names) == 276
    board = bpy.data.objects['OlympicPanels_Merged']
    board_material = board.data.materials[0]
    a = join_sources(board, EDITABLE, board_names)
    board.data.materials.clear()
    board.data.materials.append(board_material)
    for poly in board.data.polygons:
        poly.material_index = 0
    b = join_sources(bpy.data.objects['PoolsideProps_Merged'], EDITABLE, prop_names)
    assert a['triangles'] == 912 and b['triangles'] == 5104, (a,b)
    return {'mode': 'sync', 'batches': [a,b]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sync', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    report = sync() if args.sync else author()
    if args.apply:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
    report['saved'] = args.apply
    output = ROOT / 'temp/venue-first-pass'
    output.mkdir(parents=True, exist_ok=True)
    (output / (report['mode'] + '-report.json')).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
