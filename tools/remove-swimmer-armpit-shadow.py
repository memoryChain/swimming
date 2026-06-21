import argparse
import os
import statistics
import sys

import bpy


ARM_GROUPS = {
    'L_Clavicle', 'L_Upperarm', 'L_UpperarmTwist01', 'L_UpperarmTwist02',
    'R_Clavicle', 'R_Upperarm', 'R_UpperarmTwist01', 'R_UpperarmTwist02',
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output-texture')
    parser.add_argument('--audit-only', action='store_true')
    return parser.parse_args(argv)


def arm_weight(mesh: bpy.types.Object, polygon: bpy.types.MeshPolygon, group_names: dict[int, str]) -> float:
    return max(
        sum(
            weight.weight
            for weight in mesh.data.vertices[vertex_index].groups
            if group_names.get(weight.group) in ARM_GROUPS
        )
        for vertex_index in polygon.vertices
    )


def point_in_triangle(px: float, py: float, points: list[tuple[float, float]]) -> bool:
    (ax, ay), (bx, by), (cx, cy) = points
    d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    has_negative = d1 < 0 or d2 < 0 or d3 < 0
    has_positive = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_negative and has_positive)


def rasterized_pixels(
    mesh: bpy.types.Object,
    polygons: list[bpy.types.MeshPolygon],
    width: int,
    height: int,
) -> set[int]:
    uv_layer = mesh.data.uv_layers.active.data
    result: set[int] = set()
    for polygon in polygons:
        points = [(uv_layer[index].uv.x * width, uv_layer[index].uv.y * height) for index in polygon.loop_indices]
        min_x = max(0, int(min(point[0] for point in points)))
        max_x = min(width - 1, int(max(point[0] for point in points)) + 1)
        min_y = max(0, int(min(point[1] for point in points)))
        max_y = min(height - 1, int(max(point[1] for point in points)) + 1)
        for y in range(min_y, max_y + 1):
            for x in range(min_x, max_x + 1):
                if point_in_triangle(x + 0.5, y + 0.5, points):
                    result.add(y * width + x)
    return result


def percentile(values: list[float], ratio: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * ratio))]


def main() -> None:
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.input))
    mesh = next(
        obj for obj in bpy.context.scene.objects
        if obj.type == 'MESH' and obj.parent and obj.parent.type == 'ARMATURE'
    )
    image = next(image for image in bpy.data.images if image.type == 'IMAGE' and image.size[0] > 0)
    width, height = image.size
    group_names = {group.index: group.name for group in mesh.vertex_groups}

    target_polygons = []
    reference_polygons = []
    for polygon in mesh.data.polygons:
        center = polygon.center
        weight = arm_weight(mesh, polygon, group_names)
        if not (0.69 <= center.z <= 0.79 and weight >= 0.12):
            continue
        lateral = abs(center.y)
        if 0.025 <= lateral <= 0.095:
            target_polygons.append(polygon)
        elif 0.115 <= lateral <= 0.18 and weight >= 0.75:
            reference_polygons.append(polygon)

    target_pixels = rasterized_pixels(mesh, target_polygons, width, height)
    reference_pixels = rasterized_pixels(mesh, reference_polygons, width, height)
    pixels = list(image.pixels)

    reference_colors = [tuple(pixels[index * 4:index * 4 + 3]) for index in reference_pixels]
    reference_colors = [color for color in reference_colors if max(color) - min(color) < 0.55 and color[0] > color[2] * 1.08]
    if not reference_colors:
        raise RuntimeError('no valid skin reference pixels found')
    skin = tuple(statistics.median(color[channel] for color in reference_colors) for channel in range(3))
    skin_luminance = 0.2126 * skin[0] + 0.7152 * skin[1] + 0.0722 * skin[2]

    target_luminance = []
    for index in target_pixels:
        r, g, b = pixels[index * 4:index * 4 + 3]
        target_luminance.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
    print(
        f'target_faces={len(target_polygons)} target_pixels={len(target_pixels)} '
        f'reference_faces={len(reference_polygons)} reference_pixels={len(reference_pixels)}'
    )
    print(
        f'skin_linear=({skin[0]:.4f},{skin[1]:.4f},{skin[2]:.4f}) luminance={skin_luminance:.4f} '
        f'target_luminance p10={percentile(target_luminance, 0.1):.4f} '
        f'p50={percentile(target_luminance, 0.5):.4f} p90={percentile(target_luminance, 0.9):.4f}'
    )
    if args.audit_only:
        return
    if not args.output_texture:
        raise RuntimeError('--output-texture is required unless --audit-only is set')

    corrected = 0
    threshold = skin_luminance * 0.94
    for index in target_pixels:
        offset = index * 4
        color = pixels[offset:offset + 3]
        luminance = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]
        if luminance >= threshold:
            continue
        amount = min(1.0, (threshold - luminance) / max(threshold * 0.38, 1e-6))
        amount = 0.55 + amount * 0.35
        for channel in range(3):
            pixels[offset + channel] = color[channel] * (1 - amount) + skin[channel] * amount
        corrected += 1

    image.pixels[:] = pixels
    image.filepath_raw = os.path.abspath(args.output_texture)
    image.file_format = 'JPEG' if image.filepath_raw.lower().endswith(('.jpg', '.jpeg')) else 'PNG'
    image.save()
    print(f'corrected_pixels={corrected} output={image.filepath_raw}')


if __name__ == '__main__':
    main()
