import argparse
import os
import statistics
import sys

import bpy


DEFAULT_ARM_GROUPS = (
    'L_Clavicle,L_Upperarm,L_UpperarmTwist01,L_UpperarmTwist02,'
    'R_Clavicle,R_Upperarm,R_UpperarmTwist01,R_UpperarmTwist02,'
    'LeftShoulder,LeftArm,RightShoulder,RightArm'
)
DEFAULT_TRUNKS_GROUPS = (
    'Waist,Hips,LeftUpLeg,RightUpLeg,'
    'L_ThighTwist01,L_ThighTwist02,R_ThighTwist01,R_ThighTwist02'
)
DEFAULT_CAP_GROUPS = 'Head,HeadTop_End'
DEFAULT_TORSO_GROUPS = 'Spine01,Spine02,Spine,Spine1,Spine2,Waist,Chest,UpperChest'


def blender_args():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def csv_names(value):
    return {name.strip() for name in value.split(',') if name.strip()}


def axis_value(vector, axis):
    return getattr(vector, axis)


def parse_range(value):
    parts = [float(part.strip()) for part in value.split(',')]
    if len(parts) != 2 or parts[0] > parts[1]:
        raise argparse.ArgumentTypeError('expected min,max')
    return parts[0], parts[1]


def point_in_triangle(px, py, points):
    (ax, ay), (bx, by), (cx, cy) = points
    d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def rasterized_pixels(mesh, polygons, width, height):
    uv_layer = mesh.data.uv_layers.active.data
    result = set()
    for polygon in polygons:
        points = [(uv_layer[index].uv.x * width, uv_layer[index].uv.y * height) for index in polygon.loop_indices]
        if len(points) != 3:
            continue
        min_x = max(0, int(min(point[0] for point in points)))
        max_x = min(width - 1, int(max(point[0] for point in points)) + 1)
        min_y = max(0, int(min(point[1] for point in points)))
        max_y = min(height - 1, int(max(point[1] for point in points)) + 1)
        for y in range(min_y, max_y + 1):
            for x in range(min_x, max_x + 1):
                if point_in_triangle(x + 0.5, y + 0.5, points):
                    result.add(y * width + x)
    return result


def rasterized_coverage(mesh, polygons, width, height, supersample):
    high_width = width * supersample
    high_height = height * supersample
    high_pixels = rasterized_pixels(mesh, polygons, high_width, high_height)
    coverage = [0.0] * (width * height)
    sample_weight = 1.0 / (supersample * supersample)
    for index in high_pixels:
        high_y, high_x = divmod(index, high_width)
        x = high_x // supersample
        y = high_y // supersample
        coverage[y * width + x] += sample_weight
    return coverage


def rasterized_polygon_weights(mesh, polygon_weights, width, height):
    result = [0.0] * (width * height)
    for polygon_index, weight in polygon_weights.items():
        for pixel_index in rasterized_pixels(mesh, [mesh.data.polygons[polygon_index]], width, height):
            result[pixel_index] = max(result[pixel_index], weight)
    return result


def smoothstep(edge0, edge1, value):
    t = max(0.0, min(1.0, (value - edge0) / max(edge1 - edge0, 1e-8)))
    return t * t * (3.0 - 2.0 * t)


def dark_cyan_confidence(color):
    r, g, b = color
    luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    chroma = max(color) - min(color)
    neutral_dark = (1.0 - smoothstep(0.25, 0.45, luminance)) * (1.0 - smoothstep(0.12, 0.30, chroma))
    cyan = smoothstep(0.02, 0.14, max(g, b) - r) * smoothstep(0.08, 0.24, max(g, b))
    return max(neutral_dark, cyan)


def image_color_at(image_pixels, image_width, image_height, x, y, output_width, output_height):
    source_x = min(image_width - 1, int((x + 0.5) * image_width / output_width))
    source_y = min(image_height - 1, int((y + 0.5) * image_height / output_height))
    offset = (source_y * image_width + source_x) * 4
    return image_pixels[offset:offset + 3]


def load_model(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    absolute = os.path.abspath(path)
    extension = os.path.splitext(absolute)[1].lower()
    if extension not in ('.glb', '.gltf'):
        raise RuntimeError('input must be GLB or GLTF')
    bpy.ops.import_scene.gltf(filepath=absolute)
    candidates = [
        obj for obj in bpy.context.scene.objects
        if obj.type == 'MESH' and obj.data.uv_layers.active and obj.vertex_groups
    ]
    if not candidates:
        raise RuntimeError('no rigged mesh with UVs and vertex groups found')
    mesh = max(candidates, key=lambda obj: len(obj.data.polygons))
    images = [image for image in bpy.data.images if image.type == 'IMAGE' and image.size[0] > 0]
    if not images:
        raise RuntimeError('no embedded or linked image found')
    image = max(images, key=lambda item: item.size[0] * item.size[1])
    return mesh, image


def mesh_bounds(mesh):
    coordinates = [vertex.co for vertex in mesh.data.vertices]
    return {
        axis: (min(axis_value(value, axis) for value in coordinates), max(axis_value(value, axis) for value in coordinates))
        for axis in ('x', 'y', 'z')
    }


def normalized_axis(value, bounds, axis):
    minimum, maximum = bounds[axis]
    return (axis_value(value, axis) - minimum) / max(maximum - minimum, 1e-8)


def normalized_side(value, bounds, axis):
    minimum, maximum = bounds[axis]
    center = (minimum + maximum) * 0.5
    return abs(axis_value(value, axis) - center) / max(maximum - minimum, 1e-8)


def polygon_weight(mesh, polygon, group_names):
    index_to_name = {group.index: group.name for group in mesh.vertex_groups}
    return max(
        sum(weight.weight for weight in mesh.data.vertices[index].groups if index_to_name.get(weight.group) in group_names)
        for index in polygon.vertices
    )


def select_shadow_faces(mesh, bounds, args):
    arm_groups = csv_names(args.arm_groups)
    target = []
    reference = []
    for polygon in mesh.data.polygons:
        up = normalized_axis(polygon.center, bounds, args.up_axis)
        side = normalized_side(polygon.center, bounds, args.side_axis)
        weight = polygon_weight(mesh, polygon, arm_groups)
        if not (args.shadow_up[0] <= up <= args.shadow_up[1] and weight >= args.target_weight):
            continue
        if args.shadow_side[0] <= side <= args.shadow_side[1]:
            target.append(polygon)
        elif args.reference_side[0] <= side <= args.reference_side[1] and weight >= args.reference_weight:
            reference.append(polygon)
    return target, reference


def expand_shadow_faces(mesh, bounds, seeds, args):
    vertex_to_polygons = {}
    for polygon in mesh.data.polygons:
        for vertex_index in polygon.vertices:
            vertex_to_polygons.setdefault(vertex_index, set()).add(polygon.index)
    allowed_groups = csv_names(args.arm_groups) | csv_names(args.torso_groups)
    distances = {polygon.index: 0 for polygon in seeds}
    frontier = set(distances)
    for distance in range(1, args.topology_rings + 1):
        next_frontier = set()
        for polygon_index in frontier:
            polygon = mesh.data.polygons[polygon_index]
            for vertex_index in polygon.vertices:
                for neighbor_index in vertex_to_polygons.get(vertex_index, ()):
                    if neighbor_index in distances:
                        continue
                    neighbor = mesh.data.polygons[neighbor_index]
                    up = normalized_axis(neighbor.center, bounds, args.up_axis)
                    if not args.expanded_up[0] <= up <= args.expanded_up[1]:
                        continue
                    if polygon_weight(mesh, neighbor, allowed_groups) < 0.05:
                        continue
                    distances[neighbor_index] = distance
                    next_frontier.add(neighbor_index)
        frontier = next_frontier
        if not frontier:
            break
    return {
        polygon_index: max(0.28, 1.0 - distance / max(args.topology_rings + 1, 1) * 0.72)
        for polygon_index, distance in distances.items()
    }


def select_garment_faces(mesh, bounds, args):
    trunks_groups = csv_names(args.trunks_groups)
    cap_groups = csv_names(args.cap_groups)
    trunks = []
    cap = []
    for polygon in mesh.data.polygons:
        up = normalized_axis(polygon.center, bounds, args.up_axis)
        if args.trunks_up[0] <= up <= args.trunks_up[1] and polygon_weight(mesh, polygon, trunks_groups) >= args.trunks_weight:
            trunks.append(polygon)
        if up >= args.cap_up and polygon_weight(mesh, polygon, cap_groups) >= args.cap_weight:
            cap.append(polygon)
    return trunks, cap


def percentile(values, ratio):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * ratio))]


def print_audit(mesh, image, args):
    bounds = mesh_bounds(mesh)
    target, reference = select_shadow_faces(mesh, bounds, args)
    expanded = expand_shadow_faces(mesh, bounds, target, args)
    trunks, cap = select_garment_faces(mesh, bounds, args)
    print(f'mesh={mesh.name} vertices={len(mesh.data.vertices)} polygons={len(mesh.data.polygons)}')
    print(f'image={image.name} size={image.size[0]}x{image.size[1]}')
    print('bounds=' + ' '.join(f'{axis}[{bounds[axis][0]:.5f},{bounds[axis][1]:.5f}]' for axis in ('x', 'y', 'z')))
    print('vertex_groups=' + ','.join(sorted(group.name for group in mesh.vertex_groups)))
    print(f'candidate_faces shadow={len(target)} expanded_shadow={len(expanded)} reference_skin={len(reference)} trunks={len(trunks)} cap={len(cap)}')


def repair_shadow(mesh, image, args):
    bounds = mesh_bounds(mesh)
    target_faces, reference_faces = select_shadow_faces(mesh, bounds, args)
    target_face_weights = expand_shadow_faces(mesh, bounds, target_faces, args)
    width, height = image.size
    target_pixel_weights = rasterized_polygon_weights(mesh, target_face_weights, width, height)
    target_pixels = {index for index, weight in enumerate(target_pixel_weights) if weight > 0}
    reference_pixels = rasterized_pixels(mesh, reference_faces, width, height)
    if not target_pixels or not reference_pixels:
        raise RuntimeError('empty shadow or reference selection; audit axes, ranges, and bone aliases')
    pixels = list(image.pixels)
    reference_colors = [tuple(pixels[index * 4:index * 4 + 3]) for index in reference_pixels]
    reference_colors = [color for color in reference_colors if max(color) - min(color) < 0.55 and color[0] > color[2] * 1.08]
    if not reference_colors:
        raise RuntimeError('no plausible skin reference pixels; adjust reference region')
    skin = tuple(statistics.median(color[channel] for color in reference_colors) for channel in range(3))
    skin_luminance = 0.2126 * skin[0] + 0.7152 * skin[1] + 0.0722 * skin[2]
    luminances = []
    for index in target_pixels:
        r, g, b = pixels[index * 4:index * 4 + 3]
        luminances.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
    print(
        f'shadow_faces={len(target_faces)} expanded_faces={len(target_face_weights)} rings={args.topology_rings} '
        f'pixels={len(target_pixels)} reference_faces={len(reference_faces)} pixels={len(reference_pixels)}'
    )
    print(f'skin_luminance={skin_luminance:.4f} target_p10={percentile(luminances, 0.1):.4f} target_p50={percentile(luminances, 0.5):.4f}')
    corrected = 0
    for index in target_pixels:
        offset = index * 4
        color = pixels[offset:offset + 3]
        luminance = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]
        topology_weight = target_pixel_weights[index]
        threshold_ratio = args.extended_threshold_ratio + (args.luminance_ratio - args.extended_threshold_ratio) * topology_weight
        threshold = skin_luminance * threshold_ratio
        if luminance >= threshold:
            continue
        severity = min(1.0, (threshold - luminance) / max(threshold * 0.38, 1e-6))
        amount = args.blend_min + severity * (args.blend_max - args.blend_min)
        for channel in range(3):
            pixels[offset + channel] = color[channel] * (1 - amount) + skin[channel] * amount
        corrected += 1
    image.pixels[:] = pixels
    image.filepath_raw = os.path.abspath(args.output_texture)
    image.file_format = 'JPEG' if image.filepath_raw.lower().endswith(('.jpg', '.jpeg')) else 'PNG'
    image.save()
    print(f'corrected_pixels={corrected} output={image.filepath_raw}')


def make_mask(mesh, image, args):
    bounds = mesh_bounds(mesh)
    trunks_faces, cap_faces = select_garment_faces(mesh, bounds, args)
    trunks_coverage = rasterized_coverage(mesh, trunks_faces, args.size, args.size, args.supersample)
    cap_coverage = rasterized_coverage(mesh, cap_faces, args.size, args.size, args.supersample)
    if not any(trunks_coverage) or not any(cap_coverage):
        raise RuntimeError('empty trunks or cap selection; audit axes, ranges, and bone aliases')
    image_width, image_height = image.size
    image_pixels = list(image.pixels) if args.refine_mode == 'dark-cyan' else []
    pixels = [0.0] * (args.size * args.size * 4)
    for index in range(args.size * args.size):
        offset = index * 4
        confidence = 1.0
        if args.refine_mode == 'dark-cyan':
            y, x = divmod(index, args.size)
            confidence = dark_cyan_confidence(
                image_color_at(image_pixels, image_width, image_height, x, y, args.size, args.size)
            )
        pixels[offset] = trunks_coverage[index] * confidence
        pixels[offset + 1] = cap_coverage[index] * confidence
        pixels[offset + 3] = 1.0
    output_path = os.path.abspath(args.output_mask)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    output = bpy.data.images.new('SwimmerColorMask', width=args.size, height=args.size, alpha=False)
    output.colorspace_settings.name = 'Non-Color'
    output.pixels[:] = pixels
    output.filepath_raw = output_path
    output.file_format = 'PNG'
    output.save()
    print(
        f'trunks_faces={len(trunks_faces)} pixels={sum(value > 0.001 for value in trunks_coverage)} '
        f'cap_faces={len(cap_faces)} pixels={sum(value > 0.001 for value in cap_coverage)} '
        f'fractional_edges={sum(0.001 < value < 0.999 for value in pixels[0::4])}+'
        f'{sum(0.001 < value < 0.999 for value in pixels[1::4])} '
        f'antialias={args.supersample}x refine={args.refine_mode} output={output_path}'
    )


def add_shared_arguments(parser):
    parser.add_argument('--input', required=True)
    parser.add_argument('--up-axis', choices=('x', 'y', 'z'), default='z')
    parser.add_argument('--side-axis', choices=('x', 'y', 'z'), default='y')
    parser.add_argument('--arm-groups', default=DEFAULT_ARM_GROUPS)
    parser.add_argument('--torso-groups', default=DEFAULT_TORSO_GROUPS)
    parser.add_argument('--trunks-groups', default=DEFAULT_TRUNKS_GROUPS)
    parser.add_argument('--cap-groups', default=DEFAULT_CAP_GROUPS)
    parser.add_argument('--shadow-up', type=parse_range, default=(0.69, 0.79))
    parser.add_argument('--expanded-up', type=parse_range, default=(0.60, 0.82))
    parser.add_argument('--topology-rings', type=int, default=3)
    parser.add_argument('--shadow-side', type=parse_range, default=(0.06, 0.24))
    parser.add_argument('--reference-side', type=parse_range, default=(0.29, 0.45))
    parser.add_argument('--target-weight', type=float, default=0.12)
    parser.add_argument('--reference-weight', type=float, default=0.75)
    parser.add_argument('--trunks-up', type=parse_range, default=(0.36, 0.60))
    parser.add_argument('--trunks-weight', type=float, default=0.45)
    parser.add_argument('--cap-up', type=float, default=0.89)
    parser.add_argument('--cap-weight', type=float, default=0.55)


def parse_args():
    parser = argparse.ArgumentParser(description='Audit and repair swimmer model textures in Blender')
    subparsers = parser.add_subparsers(dest='command', required=True)
    audit = subparsers.add_parser('audit')
    add_shared_arguments(audit)
    repair = subparsers.add_parser('repair-shadow')
    add_shared_arguments(repair)
    repair.add_argument('--output-texture', required=True)
    repair.add_argument('--luminance-ratio', type=float, default=0.94)
    repair.add_argument('--extended-threshold-ratio', type=float, default=0.80)
    repair.add_argument('--blend-min', type=float, default=0.55)
    repair.add_argument('--blend-max', type=float, default=0.90)
    mask = subparsers.add_parser('make-mask')
    add_shared_arguments(mask)
    mask.add_argument('--output-mask', required=True)
    mask.add_argument('--size', type=int, default=512)
    mask.add_argument('--supersample', type=int, default=4)
    mask.add_argument('--refine-mode', choices=('geometry', 'dark-cyan'), default='geometry')
    return parser.parse_args(blender_args())


def main():
    args = parse_args()
    mesh, image = load_model(args.input)
    if args.command == 'audit':
        print_audit(mesh, image, args)
    elif args.command == 'repair-shadow':
        repair_shadow(mesh, image, args)
    elif args.command == 'make-mask':
        make_mask(mesh, image, args)


if __name__ == '__main__':
    main()
