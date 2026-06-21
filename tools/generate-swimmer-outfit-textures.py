import argparse
import math
import os
import sys

import bpy


OUTFITS = {
    'red-blue': ('#F0443A', '#1677E8'),
    'blue-white': ('#176DDA', '#F5EEDC'),
    'black-yellow': ('#242A35', '#FFD12A'),
    'green-orange': ('#20C46A', '#FF7926'),
    'purple-cyan': ('#8B4DFF', '#23DCE8'),
    'orange-navy': ('#FF8926', '#183C8F'),
    'pink-mint': ('#F03BA8', '#62EDB2'),
    'cyan-red': ('#18C7D8', '#F04450'),
    'yellow-purple': ('#F4C936', '#7847D8'),
    'white-red': ('#F1EEE3', '#D93149'),
}

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
    parser.add_argument('--base-texture', required=True)
    parser.add_argument('--output-dir', required=True)
    return parser.parse_args(argv)


def point_in_triangle(px: float, py: float, points: list[tuple[float, float]]) -> bool:
    (ax, ay), (bx, by), (cx, cy) = points
    d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def rasterized_pixels(mesh: bpy.types.Object, polygons: list[bpy.types.MeshPolygon], width: int, height: int) -> set[int]:
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


def polygon_weight(mesh: bpy.types.Object, polygon: bpy.types.MeshPolygon, groups: set[str]) -> float:
    names = {group.index: group.name for group in mesh.vertex_groups}
    return max(
        sum(weight.weight for weight in mesh.data.vertices[index].groups if names.get(weight.group) in groups)
        for index in polygon.vertices
    )


def srgb_channel_to_linear(value: int) -> float:
    channel = value / 255
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def hex_to_linear(value: str) -> tuple[float, float, float]:
    value = value.removeprefix('#')
    return tuple(srgb_channel_to_linear(int(value[index:index + 2], 16)) for index in (0, 2, 4))


def is_garment_pixel(color: list[float]) -> bool:
    r, g, b = color
    maximum = max(color)
    minimum = min(color)
    luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    blue_or_cyan = b >= r * 0.92 and b >= g * 0.78
    neutral_dark = luminance < 0.16 and maximum - minimum < 0.12
    return blue_or_cyan or neutral_dark


def recolor(pixels: list[float], indices: set[int], target: tuple[float, float, float]) -> int:
    changed = 0
    for index in indices:
        offset = index * 4
        original = pixels[offset:offset + 3]
        if not is_garment_pixel(original):
            continue
        luminance = 0.2126 * original[0] + 0.7152 * original[1] + 0.0722 * original[2]
        brightness = min(1.08, max(0.34, 0.34 + math.sqrt(min(1.0, luminance / 0.42)) * 0.76))
        for channel in range(3):
            pixels[offset + channel] = min(1.0, target[channel] * brightness)
        changed += 1
    return changed


def main() -> None:
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.input_model))
    mesh = next(
        obj for obj in bpy.context.scene.objects
        if obj.type == 'MESH' and obj.parent and obj.parent.type == 'ARMATURE'
    )
    base_image = bpy.data.images.load(os.path.abspath(args.base_texture), check_existing=False)
    width, height = base_image.size

    trunks_faces = [
        polygon for polygon in mesh.data.polygons
        if 0.36 <= polygon.center.z <= 0.60 and polygon_weight(mesh, polygon, TRUNKS_GROUPS) >= 0.45
    ]
    cap_faces = [
        polygon for polygon in mesh.data.polygons
        if polygon.center.z >= 0.89 and polygon_weight(mesh, polygon, CAP_GROUPS) >= 0.55
    ]
    trunks_pixels = rasterized_pixels(mesh, trunks_faces, width, height)
    cap_pixels = rasterized_pixels(mesh, cap_faces, width, height)
    print(
        f'masks trunks_faces={len(trunks_faces)} trunks_pixels={len(trunks_pixels)} '
        f'cap_faces={len(cap_faces)} cap_pixels={len(cap_pixels)}'
    )

    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)
    original_pixels = list(base_image.pixels)
    for outfit_id, (trunks_hex, cap_hex) in OUTFITS.items():
        pixels = original_pixels.copy()
        trunks_changed = recolor(pixels, trunks_pixels, hex_to_linear(trunks_hex))
        cap_changed = recolor(pixels, cap_pixels, hex_to_linear(cap_hex))
        output = bpy.data.images.new(f'Swimmer0621_2_{outfit_id}', width=width, height=height, alpha=False)
        output.pixels[:] = pixels
        output.filepath_raw = os.path.join(output_dir, f'{outfit_id}.jpg')
        output.file_format = 'JPEG'
        output.save()
        bpy.data.images.remove(output)
        print(
            f'outfit={outfit_id} trunks={trunks_hex} cap={cap_hex} '
            f'changed={trunks_changed}+{cap_changed} output={os.path.join(output_dir, f"{outfit_id}.jpg")}'
        )


if __name__ == '__main__':
    main()
