"""只生成独立蒙皮候选：收窄肩部衣服误混入的头骨影响。

当前仅在 CartonSwimmer16 的已记录基线上通过完整验收。
其他模型必须独立检查选区、动作和真实网格，不能自动安装候选。
只依赖 Python 标准库；不改变骨架、几何、UV、关节索引或纹理。
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct


def accessor(data, doc, binary_start, index):
    acc = doc['accessors'][index]
    assert 'sparse' not in acc and not acc.get('normalized')
    view = doc['bufferViews'][acc['bufferView']]
    fmt = '<' + {5121: 'B', 5123: 'H', 5126: 'f'}[acc['componentType']] * 4
    assert acc['type'] == 'VEC4'
    size = struct.calcsize(fmt)
    start = binary_start + view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    offsets = [start + i * view.get('byteStride', size) for i in range(acc['count'])]
    return [list(struct.unpack_from(fmt, data, offset)) for offset in offsets], offsets, fmt


def smooth(a, b, value):
    t = max(0., min(1., (value - a) / (b - a)))
    return t * t * (3 - 2 * t)


def repair(source, output, expected_hash):
    assert source.resolve() != output.resolve(), '只能生成独立候选'
    original = source.read_bytes()
    assert hashlib.sha256(original).hexdigest() == expected_hash, '基线版本不符，禁止重复衰减'
    assert original[:4] == b'glTF'
    size = struct.unpack_from('<I', original, 12)[0]
    doc, binary_start = json.loads(original[20:20 + size]), 28 + size
    assert len(doc['meshes']) == len(doc['skins']) == 1
    assert len(doc['meshes'][0]['primitives']) == 1
    attrs = doc['meshes'][0]['primitives'][0]['attributes']
    assert 'JOINTS_1' not in attrs and 'WEIGHTS_1' not in attrs
    joints, _, _ = accessor(original, doc, binary_start, attrs['JOINTS_0'])
    weights, offsets, fmt = accessor(original, doc, binary_start, attrs['WEIGHTS_0'])
    assert fmt == '<ffff' and len(joints) == len(weights)
    names = [doc['nodes'][i]['name'] for i in doc['skins'][0]['joints']]
    assert len(names) == 41
    before = [row[:] for row in weights]
    for v, labels in enumerate([[names[j] for j in row] for row in joints]):
        for side in ['L', 'R']:
            clavicles = [k for k, name in enumerate(labels) if name == side + '_Clavicle']
            upper = sum(before[v][k] for k, name in enumerate(labels) if name.startswith(side + '_Upperarm'))
            if not clavicles or upper < .08:
                continue
            clavicle = clavicles[0]
            shoulder = upper + before[v][clavicle]
            # 肩带/上臂占主体、头骨只是残留影响的选区；颈部中心不纳入。
            # 平滑保留衣领边界，不修改颈骨、前臂或其他骨的原权重。
            gate = smooth(.65, .85, shoulder) * smooth(.25, .5, before[v][clavicle])
            removed = 0.
            for k, name in enumerate(labels):
                if name == 'Head':
                    cut = weights[v][k] * gate
                    weights[v][k] -= cut
                    removed += cut
            # 按作者原有的肩带/上臂比例回分，不强绑单骨或人为固定分配比。
            for k, name in enumerate(labels):
                if k == clavicle or name.startswith(side + '_Upperarm'):
                    weights[v][k] += removed * before[v][k] / shoulder
    assert all(math.isfinite(w) and w >= 0 for row in weights for w in row)
    assert max(abs(sum(a) - sum(b)) for a, b in zip(before, weights)) < 1e-6
    patched, changed, allowed = bytearray(original), [], set()
    for v, row in enumerate(weights):
        saved = struct.pack(fmt, *row)
        if saved == original[offsets[v]:offsets[v] + 16]:
            continue
        changed.append(v)
        patched[offsets[v]:offsets[v] + 16] = saved
        allowed.update(range(offsets[v], offsets[v] + 16))
    differences = {i for i, (a, b) in enumerate(zip(original, patched)) if a != b}
    assert changed and differences <= allowed and len(patched) == len(original)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(patched)
    report = {
        'model': source.name, 'profile': 'shoulder-head-family-v1',
        'sourceSha256': expected_hash, 'outputSha256': hashlib.sha256(patched).hexdigest(),
        'vertexCount': len(weights), 'changedVertexCount': len(changed),
        'changedBytes': len(differences), 'fileBytes': len(original),
        'onlyWeightBytesChanged': True, 'changedVertices': changed,
    }
    output.with_suffix('.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({k: v for k, v in report.items() if k != 'changedVertices'}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    repair(args.source, args.output, args.source_sha256)
