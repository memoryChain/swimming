"""在独立候选中收窄胸肩对大臂的牵拉，只改 WEIGHTS_0。

仅适用于本次逐个验证的七个角色。骨架或网格改版后必须重新做选区和动作验收。
通过普通 Python 运行；Blender 负责候选的真实蒙皮及多视角验收。
"""
import argparse
import hashlib
import json
import re
import struct
from pathlib import Path

import numpy as np

SOURCE_HASHES = {
    'CartonSwimmer6.glb': '08436c136d48f73baca7b6388757e3393cabaed900a284f26b13268515cda456',
    'CartonSwimmer8.glb': '9afd08e991ab674d06183b77d36c5dd97a3d8c7adfde073533fe0581b1eb4dab',
    'CartonSwimmer11.glb': '74e9a5e9970704c2edaeeabdb7a9337822a3e15d1549ed1ec1031ecc4d47635c',
    'CartonSwimmer12.glb': '8dd11126ef7f2cf43d13ef6d7ba8ff9284fc726475ee42f5343595448829d25b',
    'CartonSwimmer13.glb': '1f84a8d6f47b906168bf2b8d9a7a024db0bbc249d1837492e1c4ec5b93f4a10b',
    'CartonSwimmer14.glb': 'bacc550794c2bceff1a188cfd16b01cea3d8a955644f84c70e1b76264cffa32d',
    'MuscleMan.glb': '9f7da7894c9d4c8c0c35525dd5d0ad895e33e5c3c745de0a23ad32fb73f54536',
}


def read_accessor(data, doc, binary_start, index):
    acc = doc['accessors'][index]
    assert 'sparse' not in acc and not acc.get('normalized'), '当前候选只接受未归一化存储'
    view = doc['bufferViews'][acc['bufferView']]
    fmt = '<' + {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}[acc['componentType']] * {
        'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16,
    }[acc['type']]
    size = struct.calcsize(fmt)
    start = binary_start + view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    offsets = [start + i * view.get('byteStride', size) for i in range(acc['count'])]
    return np.array([struct.unpack_from(fmt, data, p) for p in offsets]), offsets, fmt


def smooth(a, b, value):
    t = max(0., min(1., (value - a) / (b - a)))
    return t * t * (3 - 2 * t)


def repair(source, output):
    assert source.name in SOURCE_HASHES and source.resolve() != output.resolve()
    original = source.read_bytes()
    assert hashlib.sha256(original).hexdigest() == SOURCE_HASHES[source.name], '模型版本不符或已修复，必须从已验证基线重新评估'
    assert original[:4] == b'glTF'
    size = struct.unpack_from('<I', original, 12)[0]
    doc, start = json.loads(original[20:20 + size]), 28 + size
    assert len(doc['meshes']) == len(doc['skins']) == 1
    assert len(doc['meshes'][0]['primitives']) == 1
    primitive = doc['meshes'][0]['primitives'][0]
    attrs = primitive['attributes']
    assert 'JOINTS_1' not in attrs and 'WEIGHTS_1' not in attrs
    positions, _, _ = read_accessor(original, doc, start, attrs['POSITION'])
    joints, _, _ = read_accessor(original, doc, start, attrs['JOINTS_0'])
    weights, wo, wf = read_accessor(original, doc, start, attrs['WEIGHTS_0'])
    assert wf == '<ffff'
    old_joints, old_weights = joints.copy(), weights.copy()
    binds, _, _ = read_accessor(original, doc, start, doc['skins'][0]['inverseBindMatrices'])
    names = [doc['nodes'][i]['name'] for i in doc['skins'][0]['joints']]
    assert len(names) == 41
    for side in ['L', 'R']:
        arm = names.index(side + '_Upperarm')
        fore = names.index(side + '_Forearm')
        origin = np.linalg.inv(binds[arm].reshape(4, 4, order='F'))[:3, 3]
        end = np.linalg.inv(binds[fore].reshape(4, 4, order='F'))[:3, 3]
        axis = end - origin
        length = np.linalg.norm(axis)
        assert 0.05 < length < 0.3
        axis /= length
        for v, point in enumerate(positions):
            # 头颈、下肢及根部混合选区不属于本次肩臂修复。
            if any(old_weights[v, k] > .01 and re.search('Thigh|Calf|Foot|Toe|Head|Neck|Hip|Root', names[old_joints[v, k]]) for k in range(4)):
                continue
            upper = [k for k in range(4) if names[joints[v, k]].startswith(side + '_Upperarm')]
            total = sum(weights[v, k] for k in upper)
            delta = point - origin
            t = np.dot(delta, axis) / length
            radial = np.linalg.norm(delta - axis * t * length) / length
            if total < .05:
                continue
            gate = smooth(.1, .6, total) * (1 - smooth(.55, .9, radial))
            if gate < .00001:
                continue
            removed = 0.
            for k in range(4):
                name = names[joints[v, k]]
                keep = 1.
                if name == side + '_Clavicle' or name.startswith(('Spine', 'Waist')):
                    keep = 1 - smooth(-.35, .35, t) * gate
                # 肘部原有上臂／前臂过渡保持不动，避免缩窄后把拉伸集中到肘圈。
                removed += weights[v, k] * (1 - keep)
                weights[v, k] *= keep
            if removed <= 0:
                continue
            for k in upper:
                weights[v, k] += removed * weights[v, k] / total
    assert np.isfinite(weights).all() and weights.min() >= 0
    assert np.max(np.abs(weights.sum(axis=1) - old_weights.sum(axis=1))) < 1e-6
    patched = bytearray(original)
    changed_rows, allowed = [], set()
    for v in range(len(positions)):
        # 小于浮点保存精度的差异不产生无意义改动。
        weight_bytes = struct.pack(wf, *weights[v])
        if weight_bytes == original[wo[v]:wo[v]+16]:
            continue
        changed_rows.append(v)
        patched[wo[v]:wo[v]+16] = weight_bytes
        allowed.update(range(wo[v], wo[v]+16))
    changed_bytes = {i for i, (a, b) in enumerate(zip(original, patched)) if a != b}
    assert changed_bytes <= allowed and len(patched) == len(original)
    assert changed_rows
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(patched)
    report = {
        'model': source.name, 'profile': 'upper-arm-parent-falloff-v1',
        'sourceSha256': hashlib.sha256(original).hexdigest(),
        'outputSha256': hashlib.sha256(patched).hexdigest(),
        'vertexCount': len(positions), 'changedVertexCount': len(changed_rows),
        'changedBytes': len(changed_bytes), 'fileBytes': len(original),
        'onlyWeightBytesChanged': True, 'changedVertices': changed_rows,
    }
    output.with_suffix('.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({k: v for k, v in report.items() if k != 'changedVertices'}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_directory', type=Path)
    parser.add_argument('output_directory', type=Path)
    args = parser.parse_args()
    for file in SOURCE_HASHES:
        repair(args.source_directory / file, args.output_directory / file)
