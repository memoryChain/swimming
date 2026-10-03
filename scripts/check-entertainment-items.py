"""离线核查娱乐 GLB 的结构、尺寸、色彩空间及模型预算。"""
import json
import argparse
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_glb(path):
    binary = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', binary)
    assert magic == 0x46546c67 and version == 2 and length == len(binary), path
    size, kind = struct.unpack_from('<II', binary, 12)
    assert kind == 0x4e4f534a
    document = json.loads(binary[20:20 + size])
    offset = 20 + size
    size, kind = struct.unpack_from('<II', binary, offset)
    assert kind == 0x004e4942 and offset + 8 + size == len(binary)
    return document, binary[offset + 8:]


def accessor(document, binary, index):
    data = document['accessors'][index]
    view = document['bufferViews'][data['bufferView']]
    fmt, denominator = {5126: ('f', 1), 5123: ('H', 65535), 5121: ('B', 255)}[data['componentType']]
    count = {'VEC3': 3, 'VEC4': 4, 'SCALAR': 1}[data['type']]
    stride = view.get('byteStride', struct.calcsize(fmt) * count)
    offset = view.get('byteOffset', 0) + data.get('byteOffset', 0)
    values = [struct.unpack_from('<' + fmt * count, binary, offset + i * stride) for i in range(data['count'])]
    if data.get('normalized'):
        values = [tuple(v / denominator for v in row) for row in values]
    return values


def linear(value):
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


def validate(item_id, old):
    path = ROOT / 'assets/race/items' / (item_id + '.glb')
    doc, binary = read_glb(path)
    assert len(doc['meshes']) == len(doc['nodes']) == len(doc['materials']) == len(doc['scenes']) == 1, item_id
    assert doc['scenes'][0]['nodes'] == [0] and doc.get('scene', 0) == 0, item_id
    assert not any(doc.get(key) for key in ('images', 'textures', 'animations', 'skins', 'cameras')), item_id
    node = doc['nodes'][0]
    assert not any(key in node for key in ('rotation', 'translation', 'scale', 'matrix')), item_id
    assert node['name'] == old.get('nodeName', item_id), item_id
    assert 'KHR_materials_unlit' in doc['materials'][0].get('extensions', {}), item_id
    primitive, = doc['meshes'][0]['primitives']
    assert primitive.get('mode', 4) == 4
    assert set(primitive['attributes']) == {'POSITION', 'NORMAL', 'COLOR_0'}, item_id
    points = accessor(doc, binary, primitive['attributes']['POSITION'])
    normals = accessor(doc, binary, primitive['attributes']['NORMAL'])
    colors = accessor(doc, binary, primitive['attributes']['COLOR_0'])
    indices = [row[0] for row in accessor(doc, binary, primitive['indices'])]
    old_points = list(zip(*[iter(old['positions'])] * 3))
    old_colors = list(zip(*[iter(old['colors'])] * 4))
    for axis in range(3):
        assert abs(min(p[axis] for p in points) - min(p[axis] for p in old_points)) < 1e-6, item_id
        assert abs(max(p[axis] for p in points) - max(p[axis] for p in old_points)) < 1e-6, item_id
    lookup = {}
    for point, color in zip(old_points, old_colors):
        key = tuple(round(v, 5) for v in point)
        lookup.setdefault(key, []).append(tuple(linear(v) for v in color[:3]) + (color[3],))
    for point, normal, color in zip(points, normals, colors):
        assert abs(sum(v*v for v in normal) - 1) < 1e-5, item_id
        candidates = lookup.get(tuple(round(v, 5) for v in point))
        if not candidates and item_id == 'MealTray':
            # 盖／装饰底面延伸 1mm，外沿底面延伸 7mm，均接入原底盘。
            for delta in (.001, .007):
                candidates = lookup.get(tuple(round(v, 5) for v in (point[0], point[1], point[2] + delta)))
                if candidates: break
        if not candidates and item_id == 'CalmSlush' and abs(abs(point[2])-.28) < 1e-6:
            candidates = lookup.get(tuple(round(v, 5) for v in (point[0], point[1], .3075 if point[2]>0 else -.3075)))
        assert candidates, (item_id, '无基准顶点', point)
        assert min(max(abs(a-b) for a, b in zip(color, c)) for c in candidates) <= 1/65535 + 1e-6, (item_id, '颜色不符')
    assert len(indices) == len(old['indices']), item_id
    for i in range(0, len(indices), 3):
        a, b, c = [points[j] for j in indices[i:i+3]]
        u, v = [b[k]-a[k] for k in range(3)], [c[k]-a[k] for k in range(3)]
        cross = (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])
        assert sum(n*n for n in cross) > 1e-15, (item_id, '退化面')
        normal = normals[indices[i]]
        assert sum(x*y for x,y in zip(cross, normal)) > 0, (item_id, '法线与绕序不符')
    return {'triangles': len(indices)//3, 'exportVertices': len(points), 'bytes': path.stat().st_size,
            'size': [round(max(p[k] for p in points)-min(p[k] for p in points), 6) for k in range(3)]}


def validate_imported(item_id):
    path = ROOT / 'assets/race/items' / (item_id + '.glb')
    meta = json.loads(path.with_suffix('.glb.meta').read_text())
    assert meta['imported'], (item_id, 'Cocos 导入失败')
    meshes = [s for s in meta['subMetas'].values() if s['importer'] == 'gltf-mesh']
    scenes = [s for s in meta['subMetas'].values() if s['importer'] == 'gltf-scene']
    materials = [s for s in meta['subMetas'].values() if s['importer'] == 'gltf-material']
    assert len(meshes) == len(scenes) == len(materials) == 1, (item_id, '子资源数量错误或导入缓存过期')
    assert scenes[0]['name'] == item_id + '.prefab', (item_id, '资源路径不匹配')
    legacy = {
        'StimulantBottle': ('2a623d89-1c89-4b0b-96ce-0c1f4a895036', 'f5ff4', 'b9684'),
        'CalmSlush': ('988fb449-6ef7-430c-9a6d-7e480294457f', 'c4dc0', 'bf0b2'),
    }
    if item_id in legacy:
        uuid, mesh_id, mat_id = legacy[item_id]
        assert meta['uuid'] == uuid
        for sub, suffix in zip((meshes[0], materials[0]), (mesh_id, mat_id)):
            assert sub['uuid'] == uuid + '@' + suffix, (item_id, '旧 UUID 变更')
    assert meta['userData']['assetFinder']['scenes'] == [scenes[0]['uuid']], item_id
    mesh_uuid = meshes[0]['uuid']
    cache = ROOT / 'library' / mesh_uuid[:2] / (mesh_uuid + '.json')
    imported = json.loads(cache.read_text())['_struct']
    doc, binary = read_glb(path)
    primitive, = doc['meshes'][0]['primitives']
    bundle, = imported['vertexBundles']
    assert [a['name'] for a in bundle['attributes']] == ['a_position', 'a_normal', 'a_color']
    # 当前 Creator 3.8.8 输出为 float32 位置/法线 + RGBA16 UNORM 顶点色。
    assert bundle['view']['stride'] == 32 and bundle['attributes'][2]['format'] == 42
    raw = cache.with_suffix('.bin').read_bytes()
    for attribute, offset, fmt in [('POSITION', 0, 'fff'), ('NORMAL', 12, 'fff'), ('COLOR_0', 24, 'HHHH')]:
        expected = accessor(doc, binary, primitive['attributes'][attribute])
        assert bundle['view']['count'] == len(expected)
        for i, values in enumerate(expected):
            actual = struct.unpack_from('<' + fmt, raw, bundle['view']['offset'] + i*32 + offset)
            if attribute == 'COLOR_0': actual = tuple(v/65535 for v in actual)
            assert max(abs(a-b) for a,b in zip(actual, values)) < 1e-6, (item_id, '实际导入属性不符', attribute, i)
    indices = [row[0] for row in accessor(doc, binary, primitive['indices'])]
    index_view = imported['primitives'][0]['indexView']
    assert index_view['count'] == len(indices)
    assert list(struct.unpack_from('<' + 'H' * len(indices), raw, index_view['offset'])) == indices
    prefab_uuid = scenes[0]['uuid']
    prefab_path = ROOT / 'library' / prefab_uuid[:2] / (prefab_uuid + '.json')
    prefab = json.loads(prefab_path.read_text())
    nodes = [n for n in prefab if n.get('__type__') == 'cc.Node']
    renderers = [n for n in prefab if n.get('__type__') == 'cc.MeshRenderer']
    assert len(renderers) == 1 and renderers[0]['_mesh']['__uuid__'] == mesh_uuid, item_id
    for node in nodes:
        assert all(abs(node['_lpos'][axis]) < 1e-6 for axis in 'xyz'), item_id
        assert all(abs(node['_lscale'][axis]-1) < 1e-6 for axis in 'xyz'), item_id
        assert all(abs(node['_lrot'][axis]) < 1e-6 for axis in 'xyz') and abs(abs(node['_lrot']['w'])-1) < 1e-6, item_id


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--imported', action='store_true', help='还核查本机 Creator 的真实导入缓存')
    args = parser.parse_args()
    references = json.loads((ROOT / 'modelresource/entertainment/legacy-reference.json').read_text())['items']
    results = {item_id: validate(item_id, old) for item_id, old in references.items()}
    if args.imported:
        for item_id in references: validate_imported(item_id)
        print('六种道具的 Cocos 实际网格字节、Prefab 路径、变换及旧主／网格／材质 UUID 检查通过')
    print(json.dumps(results, ensure_ascii=False, indent=2))
    print('六种 GLB 结构、轴向、尺寸、线性顶点色、面数和法线检查通过')
