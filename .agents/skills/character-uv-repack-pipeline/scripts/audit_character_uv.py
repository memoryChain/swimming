"""Audit UV fragmentation and weld safety in the currently opened Blender file.

Run with Blender:
  blender --background model.blend --python audit_character_uv.py -- --output report.json
"""

import argparse
import json
import sys
from collections import defaultdict, deque
from pathlib import Path

import bpy
from mathutils.kdtree import KDTree


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--object")
    parser.add_argument("--source-uv")
    parser.add_argument("--target-uv")
    parser.add_argument("--raster-resolution", type=int, default=256)
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(argv)


def select_mesh(name):
    if name:
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            raise RuntimeError(f"Mesh object not found: {name}")
        return obj
    skinned = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and any(mod.type == "ARMATURE" and mod.object for mod in obj.modifiers)
    ]
    if len(skinned) == 1:
        return skinned[0]
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(meshes) == 1:
        return meshes[0]
    raise RuntimeError(
        "Specify --object because the scene does not contain exactly one skinned mesh: "
        + repr([obj.name for obj in meshes])
    )


def uv_area(mesh, layer, polygon):
    points = [layer.data[index].uv for index in polygon.loop_indices]
    twice_area = 0.0
    for index, point in enumerate(points):
        following = points[(index + 1) % len(points)]
        twice_area += point.x * following.y - following.x * point.y
    return abs(twice_area) * 0.5


def uv_islands(mesh, layer):
    parent = list(range(len(mesh.polygons)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[b] = a

    edge_faces = defaultdict(list)
    face_uvs = []
    for polygon in mesh.polygons:
        mapping = {}
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv = layer.data[loop_index].uv
            mapping[vertex_index] = (float(uv.x), float(uv.y))
        face_uvs.append(mapping)
        for edge_key in polygon.edge_keys:
            edge_faces[tuple(sorted(edge_key))].append(polygon.index)
    epsilon = 1e-6
    for edge_key, faces in edge_faces.items():
        if len(faces) != 2:
            continue
        a, b = faces
        if all(
            vertex in face_uvs[a]
            and vertex in face_uvs[b]
            and abs(face_uvs[a][vertex][0] - face_uvs[b][vertex][0]) <= epsilon
            and abs(face_uvs[a][vertex][1] - face_uvs[b][vertex][1]) <= epsilon
            for vertex in edge_key
        ):
            union(a, b)
    groups = defaultdict(list)
    for polygon in mesh.polygons:
        groups[find(polygon.index)].append(polygon.index)
    return list(groups.values())


def geometry_components(mesh):
    adjacency = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        adjacency[a].append(b)
        adjacency[b].append(a)
    seen = set()
    sizes = []
    for vertex in mesh.vertices:
        if vertex.index in seen:
            continue
        queue = deque([vertex.index])
        seen.add(vertex.index)
        size = 0
        while queue:
            current = queue.popleft()
            size += 1
            for neighbor in adjacency[current]:
                if neighbor not in seen:
                    seen.add(neighbor)
                    queue.append(neighbor)
        sizes.append(size)
    return sorted(sizes)


def weight_signature(obj, vertex_index):
    pairs = []
    for assignment in obj.data.vertices[vertex_index].groups:
        if assignment.weight > 1e-8:
            pairs.append(
                (obj.vertex_groups[assignment.group].name, round(float(assignment.weight), 6))
            )
    return tuple(sorted(pairs))


def weld_prediction(obj, tolerance):
    mesh = obj.data
    tree = KDTree(len(mesh.vertices))
    for vertex in mesh.vertices:
        tree.insert(vertex.co, vertex.index)
    tree.balance()
    signatures = [weight_signature(obj, index) for index in range(len(mesh.vertices))]
    pairs = set()
    different_weights = set()
    different_normals = set()
    for vertex in mesh.vertices:
        for _position, other, _distance in tree.find_range(vertex.co, tolerance):
            if other <= vertex.index:
                continue
            pair = (vertex.index, other)
            pairs.add(pair)
            if signatures[vertex.index] != signatures[other]:
                different_weights.add(pair)
            if vertex.normal.dot(mesh.vertices[other].normal) < 0.9999:
                different_normals.add(pair)
    return {
        "tolerance": tolerance,
        "duplicatePairCount": len(pairs),
        "duplicateVertexCount": len({index for pair in pairs for index in pair}),
        "differentWeightPairCount": len(different_weights),
        "differentNormalPairCount": len(different_normals),
        "safeByWeightsAndNormals": len(different_weights) == 0 and len(different_normals) == 0,
    }


def raster_overlap(mesh, layer, resolution):
    coverage = bytearray(resolution * resolution)
    mesh.calc_loop_triangles()
    for triangle in mesh.loop_triangles:
        points = [layer.data[index].uv for index in triangle.loops]
        min_x = max(0, int(min(point.x for point in points) * resolution))
        max_x = min(resolution - 1, int(max(point.x for point in points) * resolution))
        min_y = max(0, int(min(point.y for point in points) * resolution))
        max_y = min(resolution - 1, int(max(point.y for point in points) * resolution))
        a, b, c = points
        denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
        if abs(denominator) < 1e-15:
            continue
        for py in range(min_y, max_y + 1):
            y = (py + 0.5) / resolution
            for px in range(min_x, max_x + 1):
                x = (px + 0.5) / resolution
                alpha = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator
                beta = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator
                gamma = 1.0 - alpha - beta
                if alpha > 1e-7 and beta > 1e-7 and gamma > 1e-7:
                    pixel = py * resolution + px
                    coverage[pixel] = min(2, coverage[pixel] + 1)
    covered = sum(value > 0 for value in coverage)
    overlap = sum(value > 1 for value in coverage)
    return {
        "resolution": resolution,
        "coveredPixels": covered,
        "overlapPixels": overlap,
        "overlapFractionOfCovered": overlap / covered if covered else 0.0,
    }


def percentile(values, fraction):
    if not values:
        return None
    values = sorted(values)
    return values[min(len(values) - 1, int((len(values) - 1) * fraction))]


def density_report(mesh, source, target):
    ratios = []
    for polygon in mesh.polygons:
        source_area = uv_area(mesh, source, polygon)
        if source_area > 1e-15:
            ratios.append(uv_area(mesh, target, polygon) / source_area)
    return {
        "count": len(ratios),
        "p01": percentile(ratios, 0.01),
        "p05": percentile(ratios, 0.05),
        "p50": percentile(ratios, 0.50),
        "p95": percentile(ratios, 0.95),
        "p99": percentile(ratios, 0.99),
        "belowQuarterCount": sum(value < 0.25 for value in ratios),
        "aboveFourCount": sum(value > 4.0 for value in ratios),
    }


def main():
    args = parse_args()
    obj = select_mesh(args.object)
    mesh = obj.data
    target = mesh.uv_layers.get(args.target_uv) if args.target_uv else mesh.uv_layers.active
    if target is None:
        raise RuntimeError("Target mesh has no UV layer")
    islands = uv_islands(mesh, target)
    island_areas = [
        sum(uv_area(mesh, target, mesh.polygons[index]) for index in faces)
        for faces in islands
    ]
    degenerate = sum(uv_area(mesh, target, polygon) < 1e-12 for polygon in mesh.polygons)
    outside = sum(
        any(
            target.data[index].uv.x < 0.0
            or target.data[index].uv.x > 1.0
            or target.data[index].uv.y < 0.0
            or target.data[index].uv.y > 1.0
            for index in polygon.loop_indices
        )
        for polygon in mesh.polygons
    )
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    components = geometry_components(mesh)
    report = {
        "blend": bpy.data.filepath,
        "object": obj.name,
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "polygons": len(mesh.polygons),
        "materials": [material.name if material else None for material in mesh.materials],
        "uvLayers": [layer.name for layer in mesh.uv_layers],
        "targetUv": target.name,
        "uvIslandCount": len(islands),
        "uvAreaSum": sum(island_areas),
        "uvIslandAreaMin": min(island_areas) if island_areas else 0.0,
        "uvIslandAreaMax": max(island_areas) if island_areas else 0.0,
        "degenerateUvFaces": degenerate,
        "outsideUvFaces": outside,
        "rasterOverlap": raster_overlap(mesh, target, args.raster_resolution),
        "geometryComponentCount": len(components),
        "geometryComponentSizesSmallest": components[:20],
        "geometryComponentSizesLargest": components[-20:],
        "weldPredictions": [weld_prediction(obj, value) for value in (1e-7, 1e-6, 1e-5, 1e-4)],
        "armatures": [armature.name for armature in armatures],
        "boneCount": sum(len(armature.data.bones) for armature in armatures),
        "boneNames": [bone.name for armature in armatures for bone in armature.data.bones],
        "bounds": {
            "min": [min(vertex.co[axis] for vertex in mesh.vertices) for axis in range(3)],
            "max": [max(vertex.co[axis] for vertex in mesh.vertices) for axis in range(3)],
        },
    }
    if args.source_uv:
        source = mesh.uv_layers.get(args.source_uv)
        if source is None:
            raise RuntimeError(f"Source UV layer not found: {args.source_uv}")
        report["sourceTargetUvAreaRatios"] = density_report(mesh, source, target)
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
