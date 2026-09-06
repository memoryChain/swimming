"""修复深潜先锋瓶组蒙皮；只改 GLB 中选定顶点的关节与权重字节。

先用 Blender MCP 确认完整部件选区，再运行本脚本生成候选文件。
输入为已验收的 CartonSwimmer13 模型；默认不覆盖运行时资产。
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path


def read_glb(path):
    data = path.read_bytes()
    assert data[:4] == b"glTF" and struct.unpack_from("<I", data, 4)[0] == 2
    size = struct.unpack_from("<I", data, 12)[0]
    assert data[16:20] == b"JSON" and data[24 + size:28 + size] == b"BIN\0"
    return data, json.loads(data[20:20 + size]), 28 + size


def accessor(data, doc, binary_start, index):
    acc = doc["accessors"][index]
    assert "sparse" not in acc
    view = doc["bufferViews"][acc["bufferView"]]
    assert view.get("buffer", 0) == 0
    fmt = "<" + {5121: "B", 5123: "H", 5125: "I", 5126: "f"}[acc["componentType"]] * {
        "SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16,
    }[acc["type"]]
    size = struct.calcsize(fmt)
    start = binary_start + view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    offsets = [start + i * view.get("byteStride", size) for i in range(acc["count"])]
    return [struct.unpack_from(fmt, data, p) for p in offsets], offsets, fmt


def repair(source, output):
    original, doc, start = read_glb(source)
    assert len(doc["meshes"]) == len(doc["skins"]) == 1
    assert len(doc["meshes"][0]["primitives"]) == 1
    primitive = doc["meshes"][0]["primitives"][0]
    attrs = primitive["attributes"]
    assert "JOINTS_1" not in attrs and "WEIGHTS_1" not in attrs
    positions, _, _ = accessor(original, doc, start, attrs["POSITION"])
    indices, _, _ = accessor(original, doc, start, primitive["indices"])
    joints, joint_offsets, joint_fmt = accessor(original, doc, start, attrs["JOINTS_0"])
    weights, weight_offsets, weight_fmt = accessor(original, doc, start, attrs["WEIGHTS_0"])
    assert weight_fmt == "<ffff"
    assert len(positions) == 7896 and len(indices) == 5562 * 3
    parents = list(range(len(positions)))

    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    def union(a, b):
        parents[find(a)] = find(b)

    # 按位置焊接拓扑用于选区，不修改实际顶点、UV 或索引。
    unique = {}
    for i, position in enumerate(positions):
        key = tuple(round(x, 6) for x in position)
        if key in unique:
            union(i, unique[key])
        else:
            unique[key] = i
    for i in range(0, len(indices), 3):
        a, b, c = (indices[i + j][0] for j in range(3))
        union(a, b)
        union(a, c)
    components = {}
    for i in range(len(positions)):
        components.setdefault(find(i), []).append(i)
    # glTF 为 Y 向上、背部为 -Z；只选完整瓶体、固定环、阀门部件。
    selected_components = [ids for ids in components.values() if all(
        -0.09 < positions[i][0] < 0.09 and 0.51 < positions[i][1] < 0.83
        and -0.17 < positions[i][2] < -0.075 for i in ids
    )]
    selected = sorted(i for ids in selected_components for i in ids)
    assert len(selected_components) == 11 and len(selected) == 985, "模型版本或瓶组选区不符，必须重新目视确认"
    joint_names = [doc["nodes"][i]["name"] for i in doc["skins"][0]["joints"]]
    target = joint_names.index("Spine02")
    before_influences = sorted({joint_names[j] for i in selected for j, w in zip(joints[i], weights[i]) if w > 0})
    patched = bytearray(original)
    allowed = set()
    for i in selected:
        for offsets, fmt, values in (
            (joint_offsets, joint_fmt, (target, 0, 0, 0)),
            (weight_offsets, weight_fmt, (1.0, 0.0, 0.0, 0.0)),
        ):
            struct.pack_into(fmt, patched, offsets[i], *values)
            allowed.update(range(offsets[i], offsets[i] + struct.calcsize(fmt)))
    changed = [i for i, (a, b) in enumerate(zip(original, patched)) if a != b]
    assert all(i in allowed for i in changed)
    assert len(patched) == len(original)
    output.parent.mkdir(parents=True, exist_ok=True)
    assert source.resolve() != output.resolve(), "请保留输入基线，先生成独立候选"
    output.write_bytes(patched)
    report = {
        "sourceSha256": hashlib.sha256(original).hexdigest(),
        "outputSha256": hashlib.sha256(patched).hexdigest(),
        "vertexCount": len(positions), "triangleCount": len(indices) // 3,
        "selectedComponentCount": len(selected_components), "selectedVertexCount": len(selected),
        "targetBone": "Spine02", "weight": 1, "previousBones": before_influences,
        "changedBytes": len(changed), "onlySelectedJointWeightBytesChanged": True,
        "fileBytesBefore": len(original), "fileBytesAfter": len(patched),
        "selectedVertices": selected,
    }
    output.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "selectedVertices"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    repair(args.source, args.output)
