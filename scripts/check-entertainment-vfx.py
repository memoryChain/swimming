"""核对巨浪／喷泉／浮标喷水 GLB 与原有效果一致，按需检查 Creator 实际导入字节和资源路径。"""
import argparse
import importlib.util
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('item_check', ROOT / 'scripts/check-entertainment-items.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def validate(name, original, directory):
    file = directory / (name + '.glb')
    doc, raw = reader.read_glb(file)
    assert len(doc['scenes']) == len(doc['nodes']) == len(doc['meshes']) == len(doc['materials']) == 1, name
    assert doc['scenes'][0]['nodes'] == [0] and doc.get('scene', 0) == 0, name
    node = doc['nodes'][0]
    assert node['name'] == name and not any(k in node for k in ('translation', 'rotation', 'scale', 'matrix')), name
    assert not any(doc.get(k) for k in ('textures', 'images', 'animations', 'skins')), name
    assert 'KHR_materials_unlit' in doc['materials'][0].get('extensions', {}), name
    primitive, = doc['meshes'][0]['primitives']
    assert set(primitive['attributes']) == {'POSITION', 'COLOR_0'} and not primitive.get('targets'), name
    points = reader.accessor(doc, raw, primitive['attributes']['POSITION'])
    colors = reader.accessor(doc, raw, primitive['attributes']['COLOR_0'])
    indices = [v[0] for v in reader.accessor(doc, raw, primitive['indices'])]
    old_points = list(zip(*[iter(original['positions'])] * 3))
    old_colors = list(zip(*[iter(original['colors'])] * 4))
    # 核对有向三角形每个角的位置和颜色，允许导出器重新排列顶点。
    assert len(indices) == len(original['indices']), name
    for new_index, old_index in zip(indices, original['indices']):
        assert max(abs(a-b) for a, b in zip(points[new_index], old_points[old_index])) < 1e-6, (name, '三角面不符')
        assert max(abs(a-b) for a, b in zip(colors[new_index], old_colors[old_index])) <= 1/65535 + 1e-6, (name, '颜色不符')
    assert file.stat().st_size < 40000, name
    return {'triangles': len(indices)//3, 'vertices': len(points), 'bytes': file.stat().st_size}


def validate_imported(name, directory, library):
    meta = json.loads((directory / (name + '.glb.meta')).read_text())
    assert meta['imported'], (name, 'Creator 尚未成功导入')
    meshes = [s for s in meta['subMetas'].values() if s['importer'] == 'gltf-mesh']
    scenes = [s for s in meta['subMetas'].values() if s['importer'] == 'gltf-scene']
    assert len(meshes) == len(scenes) == 1 and scenes[0]['name'] == name + '.prefab', name
    uuid = meshes[0]['uuid']
    cache = library / uuid[:2] / (uuid + '.json')
    imported = json.loads(cache.read_text())['_struct']
    bundle, = imported['vertexBundles']
    # Creator 会自动补法线；按实际格式定位字段，仍逐字节核对位置和颜色。
    offsets = {}
    offset = 0
    for attr in bundle['attributes']:
        field = attr['name']
        assert field not in offsets and field in ('a_position', 'a_normal', 'a_color'), (name, field)
        expected_format = 42 if field == 'a_color' else 32
        assert attr['format'] == expected_format, (name, field, '格式')
        assert attr.get('isNormalized', False) == (field == 'a_color'), (name, field, '归一化')
        offsets[field] = offset
        offset += 8 if field == 'a_color' else 12
    assert {'a_position', 'a_color'} <= offsets.keys(), name
    stride = bundle['view']['stride']
    assert stride == offset, (name, '顶点步长')
    data = cache.with_suffix('.bin').read_bytes()
    doc, raw = reader.read_glb(directory / (name + '.glb'))
    primitive, = doc['meshes'][0]['primitives']
    for attr, offset, fmt in [('POSITION', offsets['a_position'], 'fff'), ('COLOR_0', offsets['a_color'], 'HHHH')]:
        values = reader.accessor(doc, raw, primitive['attributes'][attr])
        assert len(values) == bundle['view']['count'], name
        for i, value in enumerate(values):
            actual = struct.unpack_from('<' + fmt, data, bundle['view']['offset'] + i*stride + offset)
            if attr == 'COLOR_0': actual = tuple(v/65535 for v in actual)
            assert max(abs(a-b) for a, b in zip(actual, value)) < 1e-6, (name, attr, i)
    indices = [v[0] for v in reader.accessor(doc, raw, primitive['indices'])]
    view = imported['primitives'][0]['indexView']
    assert view['count'] == len(indices)
    assert list(struct.unpack_from('<' + 'H'*len(indices), data, view['offset'])) == indices, name
    uuid = scenes[0]['uuid']
    prefab = json.loads((library / uuid[:2] / (uuid + '.json')).read_text())
    renderers = [n for n in prefab if n.get('__type__') == 'cc.MeshRenderer']
    assert len(renderers) == 1 and renderers[0]['_mesh']['__uuid__'] == meshes[0]['uuid'], name
    for n in prefab:
        if n.get('__type__') != 'cc.Node': continue
        assert all(abs(n['_lpos'][a]) < 1e-6 and abs(n['_lscale'][a]-1) < 1e-6 and abs(n['_lrot'][a]) < 1e-6 for a in 'xyz'), name
        assert abs(abs(n['_lrot']['w'])-1) < 1e-6, name


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, default=ROOT/'assets/race/items')
    p.add_argument('--imported', action='store_true')
    p.add_argument('--library', type=Path, default=ROOT/'library', help='指定现有 Creator 项目的导入缓存目录')
    args = p.parse_args()
    reference = {}
    for effect in ('GiantWave', 'Geyser', 'SprayBuoySplash'):
        reference.update(json.loads((ROOT/'modelresource/entertainment'/(effect+'-reference.json')).read_text())['meshes'])
    result = {name: validate(name, old, args.directory) for name, old in reference.items()}
    if args.imported:
        for name in reference: validate_imported(name, args.directory, args.library)
        print('Creator 实际导入字节、Prefab 路径及变换检查通过')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print('巨浪／喷泉／浮标喷水 GLB 与原有效果的形状和线性顶点色一致')
