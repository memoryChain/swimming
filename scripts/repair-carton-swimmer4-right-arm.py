"""修复劲浪猛将右臂关节及权重；在 Blender 后台中执行。

输入为第一次导入留下的 CartonSwimmer4_CanonicalAxes.blend。
该角色的手臂网格近似对称，原始右臂关节却偏到皮肤外缘。
仅针对这一资产使用已验证的左臂绑定作参照，不能批量用于其他角色。
"""

import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree


PARTS = (
    "Upperarm", "UpperarmTwist01", "UpperarmTwist02",
    "Forearm", "ForearmTwist01", "ForearmTwist02", "Hand",
)


def surface_weights(point, triangle, vertices, weights):
    """左右三角剖分不同时，按最近表面的重心坐标插值。"""
    a, b, c = (vertices[i].co for i in triangle)
    v0, v1, v2 = b - a, c - a, point - a
    d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
    denominator = d00 * d11 - d01 * d01
    if abs(denominator) < 1e-16:
        return weights[triangle[0]]
    u = (d11 * v2.dot(v0) - d01 * v2.dot(v1)) / denominator
    v = (d00 * v2.dot(v1) - d01 * v2.dot(v0)) / denominator
    factors = [max(0, 1 - u - v), max(0, u), max(0, v)]
    total = sum(factors)
    result = {}
    for index, factor in zip(triangle, factors):
        for name, weight in weights[index].items():
            result[name] = result.get(name, 0) + weight * factor / total
    return result


def mirrored_name(name):
    if name.startswith("L_"):
        return "R_" + name[2:]
    if name.startswith("R_"):
        return "L_" + name[2:]
    return name


def repair(source, output):
    bpy.ops.wm.open_mainfile(filepath=str(source))
    rig = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    assert mesh.data.name == "CartonSwimmer4_Mesh", "输入必须是劲浪猛将的标准轴向制作源文件"
    before = {b.name: b.matrix_local.copy() for b in rig.data.bones}
    positions = [v.co.copy() for v in mesh.data.vertices]
    weights = [
        {mesh.vertex_groups[g.group].name: g.weight for g in vertex.groups}
        for vertex in mesh.data.vertices
    ]
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for part in PARTS:
        right, left = (rig.data.edit_bones[side + part] for side in ("R_", "L_"))
        delta = Vector((-left.head.x, left.head.y, left.head.z)) - right.head
        # 平移头尾，不改变已经标准化的骨骼旋转轴或骨长。
        right.head += delta
        right.tail += delta
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    kd = KDTree(len(mesh.data.vertices))
    for vertex in mesh.data.vertices:
        kd.insert(vertex.co, vertex.index)
    kd.balance()
    mesh.data.calc_loop_triangles()
    triangles = [
        tuple(t.vertices) for t in mesh.data.loop_triangles
        if all(mesh.data.vertices[i].co.x > 0 for i in t.vertices)
    ]
    bvh = BVHTree.FromPolygons(positions, triangles, all_triangles=True)
    changed = []
    unmatched = []
    max_distance = max_dropped = 0.0
    for vertex in mesh.data.vertices:
        # 保留头、躯干中心及左半身。非对称肩部饰件没有可靠匹配时保留原权重。
        if vertex.co.x >= -0.1 or vertex.co.z < 0.59:
            continue
        target = Vector((-vertex.co.x, vertex.co.y, vertex.co.z))
        _, index, distance = kd.find(target)
        source_weights = weights[index]
        if distance > 1e-5:
            point, _, index, distance = bvh.find_nearest(target)
            source_weights = surface_weights(point, triangles[index], mesh.data.vertices, weights)
        arm_weight = sum(
            weight for name, weight in source_weights.items()
            if name.startswith("L_") and (name[2:] in PARTS or name == "L_Clavicle")
        )
        if arm_weight <= 0.05:
            continue
        if distance > 0.002:
            unmatched.append(vertex.index)
            continue
        max_distance = max(max_distance, distance)
        ordered = sorted(source_weights.items(), key=lambda row: -row[1])
        max_dropped = max(max_dropped, sum(weight for _, weight in ordered[4:]))
        total = sum(weight for _, weight in ordered[:4])
        replacement = {
            mirrored_name(name): weight / total
            for name, weight in ordered[:4] if weight > 1e-7
        }
        old = weights[vertex.index]
        difference = sum(abs(old.get(n, 0) - replacement.get(n, 0)) for n in old.keys() | replacement.keys())
        if difference <= 1e-6:
            continue
        for group in list(vertex.groups):
            mesh.vertex_groups[group.group].remove([vertex.index])
        for name, weight in replacement.items():
            mesh.vertex_groups[name].add([vertex.index], weight, "REPLACE")
        changed.append(vertex.index)

    max_axis_error = 0.0
    for bone in rig.data.bones:
        angle = math.degrees(before[bone.name].to_quaternion().rotation_difference(bone.matrix_local.to_quaternion()).angle)
        max_axis_error = max(max_axis_error, min(angle, 360 - angle))
    vertex_delta = max((v.co - positions[v.index]).length for v in mesh.data.vertices)
    assert max_axis_error < 0.05 and vertex_delta == 0
    assert changed and max_dropped < 0.02
    for vertex in mesh.data.vertices:
        current = {mesh.vertex_groups[g.group].name: g.weight for g in vertex.groups}
        if vertex.index in changed:
            assert len(current) <= 4 and abs(sum(current.values()) - 1) < 1e-5
        else:
            assert current == weights[vertex.index]

    output.parent.mkdir(parents=True, exist_ok=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    rig.select_set(True)
    mesh.select_set(True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output.with_suffix(".blend")))
    bpy.ops.export_scene.gltf(
        filepath=str(output), export_format="GLB", use_selection=True, export_animations=False,
    )
    report = {
        "source": str(source), "output": str(output),
        "changedWeightRows": len(changed), "unmatchedRowsKept": unmatched,
        "maxMirroredSurfaceDistance": max_distance, "maxDroppedWeight": max_dropped,
        "meshVertexDelta": vertex_delta, "maxRestAxisErrorDegrees": max_axis_error,
        "jointChanges": {
            "R_" + part: {
                "before": list(before["R_" + part].translation),
                "after": list(rig.data.bones["R_" + part].head_local),
            } for part in PARTS
        },
    }
    output.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    assert args.output.suffix.lower() == ".glb"
    assert args.source.resolve() != args.output.with_suffix(".blend").resolve(), "必须保留原制作源文件"
    repair(args.source.resolve(), args.output.resolve())
