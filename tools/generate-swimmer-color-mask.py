import argparse
import os
import sys

import bpy


TRUNKS_GROUPS = {
    'Waist',
    'L_ThighTwist01', 'L_ThighTwist02',
    'R_ThighTwist01', 'R_ThighTwist02',
}
CAP_GROUPS = {'Head'}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-model', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--size', type=int, default=512)
    return parser.parse_args(argv)


def point_in_triangle(px: float, py: float, points: list[tuple[float, float]]) -> bool:
    (ax, ay), (bx, by), (cx, cy) = points
    d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def rasterized_pixels(mesh: bpy.types.Object, polygons: list[bpy.types.MeshPolygon], size: int) -> set[int]:
    uv_layer = mesh.data.uv_layers.active.data
    result: set[int] = set()
    for polygon in polygons:
        points = [(uv_layer[index].uv.x * size, uv_layer[index].uv.y * size) for index in polygon.loop_indices]
        min_x = max(0, int(min(point[0] for point in points)))
        max_x = min(size - 1, int(max(point[0] for point in points)) + 1)
        min_y = max(0, int(min(point[1] for point in points)))
        max_y = min(size - 1, int(max(point[1] for point in points)) + 1)
        for y in range(min_y, max_y + 1):
            for x in range(min_x, max_x + 1):
                if point_in_triangle(x + 0.5, y + 0.5, points):
                    result.add(y * size + x)
    return result


def rasterized_coverage(
    mesh: bpy.types.Object,
    polygons: list[bpy.types.MeshPolygon],
    size: int,
    supersample: int,
) -> list[float]:
    high_size = size * supersample
    high_pixels = rasterized_pixels(mesh, polygons, high_size)
    coverage = [0.0] * (size * size)
    sample_weight = 1.0 / (supersample * supersample)
    for index in high_pixels:
        high_y, high_x = divmod(index, high_size)
        x = high_x // supersample
        y = high_y // supersample
        coverage[y * size + x] += sample_weight
    return coverage


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    t = max(0.0, min(1.0, (value - edge0) / max(edge1 - edge0, 1e-8)))
    return t * t * (3.0 - 2.0 * t)


def garment_confidence(color: list[float]) -> float:
    r, g, b = color
    luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    chroma = max(color) - min(color)
    neutral_dark = (1.0 - smoothstep(0.25, 0.45, luminance)) * (1.0 - smoothstep(0.12, 0.30, chroma))
    cyan = smoothstep(0.02, 0.14, max(g, b) - r) * smoothstep(0.08, 0.24, max(g, b))
    return max(neutral_dark, cyan)


def polygon_weight(mesh: bpy.types.Object, polygon: bpy.types.MeshPolygon, groups: set[str]) -> float:
    names = {group.index: group.name for group in mesh.vertex_groups}
    return max(
        sum(weight.weight for weight in mesh.data.vertices[index].groups if names.get(weight.group) in groups)
        for index in polygon.vertices
    )


def main() -> None:
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.input_model))
    mesh = next(
        obj for obj in bpy.context.scene.objects
        if obj.type == 'MESH' and obj.parent and obj.parent.type == 'ARMATURE'
    )

    trunks_faces = [
        polygon for polygon in mesh.data.polygons
        if 0.36 <= polygon.center.z <= 0.60 and polygon_weight(mesh, polygon, TRUNKS_GROUPS) >= 0.45
    ]
    cap_faces = [
        polygon for polygon in mesh.data.polygons
        if polygon.center.z >= 0.89 and polygon_weight(mesh, polygon, CAP_GROUPS) >= 0.55
    ]
    base_image = max(
        (image for image in bpy.data.images if image.type == 'IMAGE' and image.size[0] > 0),
        key=lambda image: image.size[0] * image.size[1],
    )
    if tuple(base_image.size) != (args.size, args.size):
        raise RuntimeError(f'base texture is {base_image.size[0]}x{base_image.size[1]}, expected {args.size}x{args.size}')
    base_pixels = list(base_image.pixels)
    trunks_coverage = rasterized_coverage(mesh, trunks_faces, args.size, 4)
    cap_coverage = rasterized_coverage(mesh, cap_faces, args.size, 4)

    pixels = [0.0] * (args.size * args.size * 4)
    for index in range(args.size * args.size):
        offset = index * 4
        confidence = garment_confidence(base_pixels[offset:offset + 3])
        pixels[offset] = trunks_coverage[index] * confidence
        pixels[offset + 1] = cap_coverage[index] * confidence
        pixels[offset + 3] = 1.0

    output_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    output = bpy.data.images.new('Swimmer0621_2_ColorMask', width=args.size, height=args.size, alpha=False)
    output.colorspace_settings.name = 'Non-Color'
    output.pixels[:] = pixels
    output.filepath_raw = output_path
    output.file_format = 'PNG'
    output.save()
    print(
        f'mask trunks_faces={len(trunks_faces)} trunks_pixels={sum(value > 0.001 for value in trunks_coverage)} '
        f'cap_faces={len(cap_faces)} cap_pixels={sum(value > 0.001 for value in cap_coverage)} '
        f'fractional_edges={sum(0.001 < value < 0.999 for value in pixels[0::4])}+'
        f'{sum(0.001 < value < 0.999 for value in pixels[1::4])} '
        f'antialias=4x refine=dark-cyan output={output_path}'
    )


if __name__ == '__main__':
    main()
