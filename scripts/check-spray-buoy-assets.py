"""核对喷雾浮标、扶圈及五份喷水资源；可检查 Creator 的实际导入网格。"""
import argparse
import hashlib
import importlib.util
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('vfx_check', ROOT / 'scripts/check-entertainment-vfx.py')
vfx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vfx)
reader = vfx.reader
ORIGINAL = {
    'SprayBuoy': ('bd5ae72c542448febecdea70fba21542721cc13d7f5ebdddf804a1935063413d',
                  '4513d5fd-af7a-47a1-9a4e-ea76dc01d37c', 2, 1328),
    'RecoveryFloatRing': ('3a216a62795f797b83504f34f9adf0cd8fd75dd93c61c94a3dde5b489c4c1e58',
                         '93b00e21-d283-4aac-953f-202c51fc36c9', 1, 640),
}


def validate_original(name, directory):
    file = directory / (name + '.glb')
    digest, uuid, mesh_count, triangles = ORIGINAL[name]
    assert hashlib.sha256(file.read_bytes()).hexdigest() == digest, (name, '原资源字节发生变化')
    doc, raw = reader.read_glb(file)
    assert len(doc['meshes']) == mesh_count and len(doc['materials']) == 1, name
    assert not any(doc.get(k) for k in ('images', 'textures', 'animations', 'skins')), name
    assert json.loads(file.with_suffix('.glb.meta').read_text())['uuid'] == uuid, (name, '资源身份变化')
    actual_triangles = 0
    for mesh in doc['meshes']:
        primitive, = mesh['primitives']
        assert set(primitive['attributes']) == {'POSITION', 'NORMAL', 'COLOR_0'}, name
        actual_triangles += doc['accessors'][primitive['indices']]['count'] // 3
    assert actual_triangles == triangles, name
    return {'triangles': triangles, 'bytes': file.stat().st_size}


def validate_imported(name, directory, library):
    file = directory / (name + '.glb')
    doc, raw = reader.read_glb(file)
    meta = json.loads(file.with_suffix('.glb.meta').read_text())
    assert meta['imported'], (name, 'Creator 尚未成功导入')
    mesh_metas = [m for m in meta['subMetas'].values() if m['importer'] == 'gltf-mesh']
    scene, = [m for m in meta['subMetas'].values() if m['importer'] == 'gltf-scene']
    assert scene['name'] == name + '.prefab' and len(mesh_metas) == len(doc['meshes']), name
    # Cocos Creator 3.8.8 的 gfx.Format 编号；浮标 RGB32F 与 Blender RGBA16UI 均可读取。
    formats = {32: ('fff', 1), 44: ('ffff', 1), 42: ('HHHH', 65535), 35: ('BBBB', 255)}
    uuids = set()
    for mesh in doc['meshes']:
        imported_meta, = [m for m in mesh_metas if m['name'] == mesh['name'] + '.mesh']
        uuid = imported_meta['uuid']
        uuids.add(uuid)
        cache = library / uuid[:2] / (uuid + '.json')
        imported = json.loads(cache.read_text())['_struct']
        bundle, = imported['vertexBundles']
        data = cache.with_suffix('.bin').read_bytes()
        offset, attributes = 0, {}
        for attr in bundle['attributes']:
            assert attr['format'] in formats, (name, attr)
            fmt, denominator = formats[attr['format']]
            attributes[attr['name']] = (offset, fmt, denominator if attr.get('isNormalized') else 1)
            offset += struct.calcsize('<' + fmt)
        assert offset == bundle['view']['stride'], (name, '顶点步长')
        primitive, = mesh['primitives']
        for gltf, cocos in [('POSITION', 'a_position'), ('COLOR_0', 'a_color')]:
            values = reader.accessor(doc, raw, primitive['attributes'][gltf])
            assert len(values) == bundle['view']['count'], name
            offset, fmt, denominator = attributes[cocos]
            for i, value in enumerate(values):
                actual = struct.unpack_from('<' + fmt, data, bundle['view']['offset'] + i*bundle['view']['stride'] + offset)
                actual = tuple(v/denominator for v in actual)
                assert len(actual) == len(value) and max(abs(a-b) for a, b in zip(actual, value)) < 1e-6, (name, gltf, i)
        indices = [v[0] for v in reader.accessor(doc, raw, primitive['indices'])]
        view = imported['primitives'][0]['indexView']
        assert view['count'] == len(indices) and view['stride'] == 2, (name, '索引格式')
        assert list(struct.unpack_from('<' + 'H'*len(indices), data, view['offset'])) == indices, name
    uuid = scene['uuid']
    prefab = json.loads((library / uuid[:2] / (uuid + '.json')).read_text())
    renderers = [n for n in prefab if n.get('__type__') == 'cc.MeshRenderer']
    assert len(renderers) == len(uuids) and {r['_mesh']['__uuid__'] for r in renderers} == uuids, name
    for node in doc['nodes']:
        candidates = [n for n in prefab if n.get('__type__') == 'cc.Node' and n['_name'] == node['name']]
        assert candidates, (name, node['name'], '导入节点缺失')
        for field, expected, axes in [('_lpos', node.get('translation', [0, 0, 0]), 'xyz'),
                                      ('_lscale', node.get('scale', [1, 1, 1]), 'xyz'),
                                      ('_lrot', node.get('rotation', [0, 0, 0, 1]), 'xyzw')]:
            for actual in candidates:
                assert max(abs(actual[field][a]-b) for a, b in zip(axes, expected)) < 1e-6, (name, node['name'], field)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, default=ROOT/'assets/race/items')
    p.add_argument('--library', type=Path, default=ROOT/'library')
    p.add_argument('--imported', action='store_true')
    args = p.parse_args()
    result = {name: validate_original(name, args.directory) for name in ORIGINAL}
    meshes = json.loads((ROOT/'modelresource/entertainment/SprayBuoySplash-reference.json').read_text())['meshes']
    result.update({name: vfx.validate(name, old, args.directory) for name, old in meshes.items()})
    if args.imported:
        for name in result:
            validate_imported(name, args.directory, args.library)
        print('七份 GLB 的 Creator 实际位置、颜色、索引、Prefab 路径和气球转轴检查通过')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print('浮标／扶圈保留原版资源；喷水形状和颜色与原版一致；没有新增图片或 mip 配置')
