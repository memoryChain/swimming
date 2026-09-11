"""校验场馆贴图 UV；仅在所有使用者都只有 UV0 时修复导出的 -1 索引。"""
import argparse
import json
from pathlib import Path
import struct


def texture_infos(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower().endswith('texture') and isinstance(child, dict) and 'index' in child:
                yield child
            else:
                yield from texture_infos(child)


def validate_texture_uvs(document, repair=False):
    users = {}
    for mesh in document.get('meshes', []):
        for primitive in mesh.get('primitives', []):
            if 'material' in primitive:
                users.setdefault(primitive['material'], []).append(
                    {key for key in primitive.get('attributes', {}) if key.startswith('TEXCOORD_')})
    changes = []
    for index, material in enumerate(document.get('materials', [])):
        uv_sets = users.get(index, [])
        for info in texture_infos(material):
            transform = info.get('extensions', {}).get('KHR_texture_transform', {})
            bindings = [info] + ([transform] if 'texCoord' in transform else [])
            for binding in bindings:
                uv = binding.get('texCoord', 0)
                if repair and uv == -1 and uv_sets and all(uvs == {'TEXCOORD_0'} for uvs in uv_sets):
                    changes.append(binding)
                    continue
                if type(uv) is not int or uv < 0 or any(f'TEXCOORD_{uv}' not in uvs for uvs in uv_sets):
                    raise ValueError(f"材质 {material.get('name', index)} 引用无效 UV {uv}，网格 UV 为 {uv_sets}")
    # 全部检查通过后再修改，歧义或缺失 UV 不自动猜测。
    for binding in changes:
        binding['texCoord'] = 0
    return len(changes)


def check_glb(path, repair=False):
    path = Path(path)
    data = path.read_bytes()
    if len(data) < 20 or struct.unpack_from('<III', data) != (0x46546C67, 2, len(data)):
        raise ValueError('无效 GLB 头')
    size, kind = struct.unpack_from('<II', data, 12)
    if kind != 0x4E4F534A or 20 + size > len(data):
        raise ValueError('无效 GLB JSON 块')
    document = json.loads(data[20:20 + size])
    count = validate_texture_uvs(document, repair)
    if count:
        encoded = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        encoded += b' ' * (-len(encoded) % 4)
        # 网格、图片及其缓冲偏移全部保持原样，仅替换 JSON 中的 UV 引用。
        tail = data[20 + size:]
        header = struct.pack('<IIIII', 0x46546C67, 2, 20 + len(encoded) + len(tail), len(encoded), kind)
        path.write_bytes(header + encoded + tail)
    return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('glb', type=Path)
    parser.add_argument('--repair', action='store_true', help='仅修复无歧义的单 UV 网格 -1 引用')
    args = parser.parse_args()
    print(json.dumps({'path': str(args.glb), 'repairedTextureReferences': check_glb(args.glb, args.repair)}, ensure_ascii=False))
