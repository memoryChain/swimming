"""Collapse the current flat-colour bleachers to one embedded atlas material.

Run this after synchronizing the editable venue into the merged FlatColor blend:

    blender -b sceneresource/SwimmingVenue_Rebuild_FlatColor.blend \
        --python sceneresource/batch-flatcolor-venue.py -- --dry-run

Remove ``--dry-run`` to update and save the loaded blend file. The operation is
idempotent and preserves every object, polygon, transform, and runtime node name.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
import zlib

import bpy
from mathutils import Vector


ATLAS_IMAGE_NAME = "BleacherFlatColorAtlas"
ATLAS_MATERIAL_NAME = "BleacherFlatColorAtlas_Material"
ATLAS_UV_NAME = "BleacherFlatColorAtlasUV"
ATLAS_VERSION_PROPERTY = "bleacher_flat_color_atlas_version"
ATLAS_VERSION = 6
ATLAS_WIDTH = 192
ATLAS_HEIGHT = 16
ATLAS_TEMP_FILENAME = ".BleacherFlatColorAtlas.tmp.png"
POOL_CENTER = Vector((25.0, 0.0, 0.0))
TIER_BRIGHTNESS = (1.0, 0.82, 0.66, 0.52)

# Values are linear RGB. The seatless bleacher bands use a venue-blue palette
# with separate tread, riser, and side values so the geometry reads unlit.
# The generated PNG must contain sRGB-encoded bytes because VenueHeightShade
# converts sampled texture values back to linear at runtime.
CONCRETE_TOP_COLOR = (0.025, 0.12, 0.48, 1.0)
CONCRETE_FRONT_COLOR = (0.015, 0.075, 0.30, 1.0)
CONCRETE_SIDE_COLOR = (0.008, 0.04, 0.16, 1.0)
WALL_SILVER_COLOR = (0.617206562, 0.672443157, 0.701101892, 1.0)
WALL_SILVER_MATERIAL = "Venue_Wall_SilverGray"
SOURCE_MATERIALS = {
    "Bleacher_Step_Concrete": CONCRETE_TOP_COLOR,
}
ORIENTATION_COLORS = {
    "Top": CONCRETE_TOP_COLOR,
    "Front": CONCRETE_FRONT_COLOR,
    "Side": CONCRETE_SIDE_COLOR,
}
ATLAS_COLORS = {
    f"T{tier}{orientation}": tuple(channel * brightness for channel in color[:3]) + (1.0,)
    for tier, brightness in enumerate(TIER_BRIGHTNESS, start=1)
    for orientation, color in ORIENTATION_COLORS.items()
}
ATLAS_COLOR_INDEX = {name: index for index, name in enumerate(ATLAS_COLORS)}
AUTHORED_MATERIAL_TO_ATLAS = {
    f"Bleacher_T{tier}_{orientation}_Blue": f"T{tier}{orientation}"
    for tier in range(1, 5)
    for orientation in ORIENTATION_COLORS
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--author-editable", action="store_true")
    return parser.parse_args(argv)


def is_bleacher_object(obj: bpy.types.Object) -> bool:
    lower = obj.name.lower()
    return (
        obj.type == "MESH"
        and not obj.hide_render
        and (lower.startswith("bleacherbatch_") or lower == "cornerstands_merged")
    )


def used_material_names(obj: bpy.types.Object) -> list[str]:
    names: list[str] = []
    for material_index in sorted({polygon.material_index for polygon in obj.data.polygons}):
        if material_index >= len(obj.material_slots):
            raise RuntimeError(f"{obj.name}: invalid material index {material_index}")
        material = obj.material_slots[material_index].material
        if material is None:
            raise RuntimeError(f"{obj.name}: empty material slot {material_index}")
        names.append(material.name)
    return names


def estimate_primitive_count() -> int:
    total = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        total += max(1, len({polygon.material_index for polygon in obj.data.polygons}))
    return total


def linear_to_srgb(value: float) -> float:
    if value <= 0.0031308:
        return value * 12.92
    return 1.055 * (value ** (1 / 2.4)) - 0.055


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    payload = chunk_type + data
    return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload))


def write_atlas_png(path: str) -> None:
    colors = [
        tuple(round(linear_to_srgb(channel) * 255) for channel in color[:3])
        + (round(color[3] * 255),)
        for color in ATLAS_COLORS.values()
    ]
    stripe_width = ATLAS_WIDTH // len(colors)
    row = bytearray([0])
    for x in range(ATLAS_WIDTH):
        row.extend(colors[min(x // stripe_width, len(colors) - 1)])
    pixels = bytes(row) * ATLAS_HEIGHT
    header = struct.pack(">IIBBBBB", ATLAS_WIDTH, ATLAS_HEIGHT, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(pixels, level=9))
        + png_chunk(b"IEND", b"")
    )
    with open(path, "wb") as output:
        output.write(png)


def validate_targets(targets: list[bpy.types.Object]) -> tuple[list[bpy.types.Object], list[bpy.types.Object]]:
    pending: list[bpy.types.Object] = []
    completed: list[bpy.types.Object] = []
    for obj in targets:
        names = used_material_names(obj)
        if names == [ATLAS_MATERIAL_NAME] and obj.get(ATLAS_VERSION_PROPERTY) == ATLAS_VERSION:
            completed.append(obj)
            continue
        unknown = sorted(
            set(names)
            - SOURCE_MATERIALS.keys()
            - AUTHORED_MATERIAL_TO_ATLAS.keys()
            - {ATLAS_MATERIAL_NAME}
        )
        if unknown:
            raise RuntimeError(f"{obj.name}: unsupported materials {unknown}")
        pending.append(obj)
    return pending, completed


def create_atlas_image() -> bpy.types.Image:
    image = bpy.data.images.get(ATLAS_IMAGE_NAME)
    if image is not None:
        bpy.data.images.remove(image, do_unlink=True)
    if not bpy.data.filepath:
        raise RuntimeError("cannot pack the atlas in an unnamed blend file")
    temporary_path = os.path.join(os.path.dirname(bpy.data.filepath), ATLAS_TEMP_FILENAME)
    write_atlas_png(temporary_path)
    image = bpy.data.images.load(temporary_path, check_existing=False)
    image.name = ATLAS_IMAGE_NAME
    image.colorspace_settings.name = "sRGB"
    image.pack()
    image.filepath = f"//{ATLAS_TEMP_FILENAME}"
    return image


def create_atlas_material(image: bpy.types.Image) -> bpy.types.Material:
    material = bpy.data.materials.get(ATLAS_MATERIAL_NAME)
    if material is None:
        material = bpy.data.materials.new(ATLAS_MATERIAL_NAME)
    material.use_nodes = True
    material.diffuse_color = (1.0, 1.0, 1.0, 1.0)

    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Closest"
    texture.extension = "CLIP"

    shader.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    shader.inputs["Roughness"].default_value = 1.0
    shader.inputs["Emission Strength"].default_value = 1.0
    emission = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
    if emission is None:
        raise RuntimeError("Principled BSDF has no emission colour input")
    material.node_tree.links.new(texture.outputs["Color"], emission)
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def atlas_u(color_name: str) -> float:
    return (ATLAS_COLOR_INDEX[color_name] + 0.5) / len(ATLAS_COLORS)


def concrete_orientation_name(
    obj: bpy.types.Object,
    polygon: bpy.types.MeshPolygon,
    normal_matrix,
) -> str:
    normal = (normal_matrix @ polygon.normal).normalized()
    if normal.z >= 0.7:
        return "Top"
    if normal.z <= -0.7:
        return "Side"

    side_match = re.search(r"_t[1-4]_([nse])(?:_|$)", obj.name.lower())
    if side_match:
        front_by_side = {
            "n": Vector((0.0, -1.0, 0.0)),
            "s": Vector((0.0, 1.0, 0.0)),
            "e": Vector((-1.0, 0.0, 0.0)),
        }
        return "Front" if normal.dot(front_by_side[side_match.group(1)]) >= 0.7 else "Side"

    # Merged corner stands do not have a cardinal side suffix. Their risers
    # face toward the pool while end caps and rear walls do not.
    center = obj.matrix_world @ polygon.center
    radial = Vector((POOL_CENTER.x - center.x, POOL_CENTER.y - center.y, 0.0))
    if radial.length_squared <= 1e-8:
        return "Side"
    radial.normalize()
    tangent = Vector((-radial.y, radial.x, 0.0))
    radial_dot = normal.dot(radial)
    return "Front" if radial_dot >= 0.5 and radial_dot >= abs(normal.dot(tangent)) else "Side"


def object_tier(obj: bpy.types.Object) -> int | None:
    match = re.search(r"_t([1-4])_", obj.name.lower())
    return int(match.group(1)) if match else None


def object_world_z_bounds(obj: bpy.types.Object) -> tuple[float, float]:
    values = [(obj.matrix_world @ vertex.co).z for vertex in obj.data.vertices]
    return min(values), max(values)


def tier_z_boundaries(targets: list[bpy.types.Object]) -> tuple[float, float, float]:
    ranges = {
        tier: [float("inf"), float("-inf")]
        for tier in range(1, 5)
    }
    for obj in targets:
        tier = object_tier(obj)
        if tier is None:
            continue
        minimum, maximum = object_world_z_bounds(obj)
        ranges[tier][0] = min(ranges[tier][0], minimum)
        ranges[tier][1] = max(ranges[tier][1], maximum)
    if any(not all(map(lambda value: value not in (float("inf"), float("-inf")), bounds)) for bounds in ranges.values()):
        raise RuntimeError("cannot derive all four bleacher tier bounds")
    return tuple(
        (ranges[tier][1] + ranges[tier + 1][0]) * 0.5
        for tier in range(1, 4)
    )


def polygon_tier(
    obj: bpy.types.Object,
    polygon: bpy.types.MeshPolygon,
    boundaries: tuple[float, float, float],
) -> int:
    named_tier = object_tier(obj)
    if named_tier is not None:
        return named_tier
    world_z = (obj.matrix_world @ polygon.center).z
    if world_z < boundaries[0]:
        return 1
    if world_z < boundaries[1]:
        return 2
    if world_z < boundaries[2]:
        return 3
    return 4


def atlas_source_name(
    obj: bpy.types.Object,
    polygon: bpy.types.MeshPolygon,
    uv_layer: bpy.types.MeshUVLoopLayer,
) -> str:
    average_u = sum(uv_layer.data[index].uv.x for index in polygon.loop_indices) / len(polygon.loop_indices)
    version = obj.get(ATLAS_VERSION_PROPERTY, 1)
    if version >= 6:
        return "Bleacher_Step_Concrete"
    if version == 5:
        if average_u < 12 / 14:
            return "Bleacher_Step_Concrete"
        raise RuntimeError(f"{obj.name}: obsolete seat UV found in seatless atlas")
    if version >= 2:
        if average_u < 0.6:
            return "Bleacher_Step_Concrete"
        raise RuntimeError(f"{obj.name}: obsolete seat UV found in seatless atlas")
    if average_u < 1 / 3:
        return "Bleacher_Step_Concrete"
    raise RuntimeError(f"{obj.name}: obsolete seat UV found in seatless atlas")


def collapse_object(
    obj: bpy.types.Object,
    atlas_material: bpy.types.Material,
    boundaries: tuple[float, float, float],
) -> None:
    if obj.data.users > 1:
        obj.data = obj.data.copy()
    source_names = {
        index: slot.material.name
        for index, slot in enumerate(obj.material_slots)
        if slot.material is not None
    }
    uv_layer = obj.data.uv_layers.get(ATLAS_UV_NAME)
    if uv_layer is None:
        uv_layer = obj.data.uv_layers.new(name=ATLAS_UV_NAME)
    obj.data.uv_layers.active = uv_layer
    uv_layer.active_render = True

    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    for polygon in obj.data.polygons:
        source_name = source_names.get(polygon.material_index)
        if source_name == ATLAS_MATERIAL_NAME:
            source_name = atlas_source_name(obj, polygon, uv_layer)
        if source_name == "Bleacher_Step_Concrete":
            orientation = concrete_orientation_name(obj, polygon, normal_matrix)
            color_name = f"T{polygon_tier(obj, polygon, boundaries)}{orientation}"
        elif source_name in AUTHORED_MATERIAL_TO_ATLAS:
            color_name = AUTHORED_MATERIAL_TO_ATLAS[source_name]
        else:
            raise RuntimeError(
                f"{obj.name}: polygon {polygon.index} uses unsupported material {source_name}"
            )
        u = atlas_u(color_name)
        for loop_index in polygon.loop_indices:
            uv_layer.data[loop_index].uv = (u, 0.5)
        polygon.material_index = 0

    obj.data.materials.clear()
    obj.data.materials.append(atlas_material)
    obj[ATLAS_VERSION_PROPERTY] = ATLAS_VERSION
    obj.data.update()


def create_authored_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    shader.inputs["Roughness"].default_value = 1.0
    shader.inputs["Emission Strength"].default_value = 1.0
    emission = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
    if emission is None:
        raise RuntimeError("Principled BSDF has no emission colour input")
    emission.default_value = color
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def compact_material_slots(obj: bpy.types.Object) -> None:
    used_indices = sorted({polygon.material_index for polygon in obj.data.polygons})
    if not used_indices:
        obj.data.materials.clear()
        return
    old_materials = [slot.material for slot in obj.material_slots]
    if any(index >= len(old_materials) or old_materials[index] is None for index in used_indices):
        raise RuntimeError(f"{obj.name}: cannot compact invalid material slots")
    index_map = {old_index: new_index for new_index, old_index in enumerate(used_indices)}
    polygon_indices = [polygon.material_index for polygon in obj.data.polygons]
    obj.data.materials.clear()
    for old_index in used_indices:
        obj.data.materials.append(old_materials[old_index])
    for polygon, old_index in zip(obj.data.polygons, polygon_indices):
        polygon.material_index = index_map[old_index]
    obj.data.update()


def remove_obsolete_seat_materials() -> None:
    obsolete_names = {"StadiumSeat_Blue", "StadiumSeat_Blue_Dark"}
    for obj in list(item for item in bpy.data.objects if item.type == "MESH"):
        obsolete_indices = {
            index
            for index, slot in enumerate(obj.material_slots)
            if slot.material is not None and slot.material.name in obsolete_names
        }
        if not obsolete_indices:
            continue
        obsolete_faces = sum(
            1 for polygon in obj.data.polygons if polygon.material_index in obsolete_indices
        )
        if obsolete_faces:
            if obj.name != "BleacherNew_Module_Source" or not obj.hide_render:
                raise RuntimeError(f"seat geometry remains on {obj.name}: {obsolete_faces} faces")
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
            continue
        compact_material_slots(obj)
    for material_name in obsolete_names:
        material = bpy.data.materials.get(material_name)
        if material is not None:
            if material.users != 0:
                raise RuntimeError(f"obsolete seat material still has {material.users} users: {material_name}")
            bpy.data.materials.remove(material)


def author_editable() -> None:
    materials = {
        authored_name: create_authored_material(authored_name, ATLAS_COLORS[atlas_name])
        for authored_name, atlas_name in AUTHORED_MATERIAL_TO_ATLAS.items()
    }
    silver_material = create_authored_material(WALL_SILVER_MATERIAL, WALL_SILVER_COLOR)
    changed_objects = 0
    changed_faces = 0
    counts: dict[str, int] = {}
    accepted = {"Bleacher_Step_Concrete", *AUTHORED_MATERIAL_TO_ATLAS.keys()}
    for obj in sorted((item for item in bpy.data.objects if item.type == "MESH"), key=lambda item: item.name):
        tier = object_tier(obj)
        if tier is None or obj.hide_render:
            continue
        source_names = {
            index: slot.material.name
            for index, slot in enumerate(obj.material_slots)
            if slot.material is not None
        }
        matching = [
            polygon
            for polygon in obj.data.polygons
            if source_names.get(polygon.material_index) in accepted
        ]
        if not matching:
            continue
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
        assignments: list[tuple[int, str]] = []
        for polygon in obj.data.polygons:
            source_name = source_names.get(polygon.material_index)
            if source_name not in accepted:
                continue
            orientation = concrete_orientation_name(obj, polygon, normal_matrix)
            material_name = f"Bleacher_T{tier}_{orientation}_Blue"
            assignments.append((polygon.index, material_name))
            counts[material_name] = counts.get(material_name, 0) + 1
        used_names = sorted({name for _, name in assignments})
        slot_by_name = {
            slot.material.name: index
            for index, slot in enumerate(obj.material_slots)
            if slot.material is not None
        }
        for name in used_names:
            if name not in slot_by_name:
                obj.data.materials.append(materials[name])
                slot_by_name[name] = len(obj.data.materials) - 1
        for polygon_index, material_name in assignments:
            obj.data.polygons[polygon_index].material_index = slot_by_name[material_name]
        compact_material_slots(obj)
        obj.data.update()
        changed_objects += 1
        changed_faces += len(assignments)

    silver_faces = 0
    for obj in sorted((item for item in bpy.data.objects if item.type == "MESH"), key=lambda item: item.name):
        if obj.hide_render:
            continue
        source_names = {
            index: slot.material.name
            for index, slot in enumerate(obj.material_slots)
            if slot.material is not None
        }
        target_indices = {
            index
            for index, name in source_names.items()
            if name == "Upper_Tier_Platform_Blue"
            or (name == "Bleacher_Step_Concrete" and obj.name.startswith("AccessCore_"))
        }
        if not target_indices:
            continue
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        silver_slot = next(
            (
                index
                for index, slot in enumerate(obj.material_slots)
                if slot.material is not None and slot.material.name == WALL_SILVER_MATERIAL
            ),
            None,
        )
        if silver_slot is None:
            obj.data.materials.append(silver_material)
            silver_slot = len(obj.data.materials) - 1
        for polygon in obj.data.polygons:
            if polygon.material_index in target_indices:
                polygon.material_index = silver_slot
                silver_faces += 1
        compact_material_slots(obj)
        obj.data.update()
    remove_obsolete_seat_materials()
    if changed_objects <= 0:
        raise RuntimeError("editable authoring matched no bleacher objects")
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
    print(json.dumps({
        "saved": bpy.data.filepath,
        "authoredObjects": changed_objects,
        "authoredFaces": changed_faces,
        "silverFaces": silver_faces,
        "materials": counts,
    }, indent=2))


def sync_master_wall_materials() -> int:
    silver_material = create_authored_material(WALL_SILVER_MATERIAL, WALL_SILVER_COLOR)
    targets = {
        "StandStructure_Merged": "Upper_Tier_Platform_Blue",
        "BleacherAccess_Architecture_Merged": "Bleacher_Step_Concrete",
    }
    changed_faces = 0
    for object_name, source_material_name in targets.items():
        obj = bpy.data.objects.get(object_name)
        if obj is None or obj.type != "MESH":
            raise RuntimeError(f"missing master wall batch: {object_name}")
        source_indices = {
            index
            for index, slot in enumerate(obj.material_slots)
            if slot.material is not None and slot.material.name == source_material_name
        }
        if not source_indices:
            if any(
                slot.material is not None and slot.material.name == WALL_SILVER_MATERIAL
                for slot in obj.material_slots
            ):
                continue
            raise RuntimeError(f"{object_name}: missing wall material {source_material_name}")
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        obj.data.materials.append(silver_material)
        silver_slot = len(obj.data.materials) - 1
        for polygon in obj.data.polygons:
            if polygon.material_index in source_indices:
                polygon.material_index = silver_slot
                changed_faces += 1
        obj.data.update()
    return changed_faces


def main() -> None:
    args = parse_args()
    if args.author_editable:
        author_editable()
        return
    targets = sorted(
        (obj for obj in bpy.data.objects if is_bleacher_object(obj)),
        key=lambda obj: obj.name,
    )
    if len(targets) != 13:
        raise RuntimeError(f"expected 13 bleacher targets, found {len(targets)}")

    silver_faces = 0 if args.dry_run else sync_master_wall_materials()
    before = estimate_primitive_count()
    pending, completed = validate_targets(targets)
    predicted = before - sum(len(used_material_names(obj)) - 1 for obj in pending)
    report = {
        "blend": bpy.data.filepath,
        "dryRun": args.dry_run,
        "targets": len(targets),
        "pending": len(pending),
        "completed": len(completed),
        "primitiveDrawsBefore": before,
        "primitiveDrawsAfter": predicted,
        "silverFaces": silver_faces,
    }
    print(json.dumps(report, indent=2))
    if args.dry_run:
        return

    image = create_atlas_image()
    material = create_atlas_material(image)
    boundaries = tier_z_boundaries(targets)
    for obj in pending:
        collapse_object(obj, material, boundaries)
    remove_obsolete_seat_materials()

    actual = estimate_primitive_count()
    if actual != predicted:
        raise RuntimeError(f"primitive count mismatch: predicted {predicted}, got {actual}")
    if not bpy.data.filepath:
        raise RuntimeError("refusing to save an unnamed blend file")
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
    temporary_path = os.path.join(os.path.dirname(bpy.data.filepath), ATLAS_TEMP_FILENAME)
    if os.path.exists(temporary_path):
        os.remove(temporary_path)
    print(json.dumps({"saved": bpy.data.filepath, "primitiveDraws": actual}, indent=2))


if __name__ == "__main__":
    main()