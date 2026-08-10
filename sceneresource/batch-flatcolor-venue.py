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
import struct
import sys
import zlib

import bpy


ATLAS_IMAGE_NAME = "BleacherFlatColorAtlas"
ATLAS_MATERIAL_NAME = "BleacherFlatColorAtlas_Material"
ATLAS_UV_NAME = "BleacherFlatColorAtlasUV"
ATLAS_WIDTH = 48
ATLAS_HEIGHT = 16
ATLAS_TEMP_FILENAME = ".BleacherFlatColorAtlas.tmp.png"

# Values are linear RGB, matching the original flat-colour material factors.
# The generated PNG must contain sRGB-encoded bytes because VenueHeightShade
# converts sampled texture values back to linear at runtime.
SOURCE_MATERIALS = {
    "Bleacher_Step_Concrete": (132 / 255, 196 / 255, 204 / 255, 1.0),
    "StadiumSeat_Blue": (0.02, 0.135, 0.52, 1.0),
    "StadiumSeat_Blue_Dark": (0.006, 0.04, 0.17, 1.0),
}
SOURCE_MATERIAL_INDEX = {
    name: index for index, name in enumerate(SOURCE_MATERIALS)
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
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
        for color in SOURCE_MATERIALS.values()
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
        if names == [ATLAS_MATERIAL_NAME]:
            completed.append(obj)
            continue
        unknown = sorted(set(names) - SOURCE_MATERIALS.keys())
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


def collapse_object(obj: bpy.types.Object, atlas_material: bpy.types.Material) -> None:
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

    color_count = len(SOURCE_MATERIALS)
    for polygon in obj.data.polygons:
        source_name = source_names.get(polygon.material_index)
        if source_name not in SOURCE_MATERIAL_INDEX:
            raise RuntimeError(
                f"{obj.name}: polygon {polygon.index} uses unsupported material {source_name}"
            )
        atlas_index = SOURCE_MATERIAL_INDEX[source_name]
        u = (atlas_index + 0.5) / color_count
        for loop_index in polygon.loop_indices:
            uv_layer.data[loop_index].uv = (u, 0.5)
        polygon.material_index = 0

    obj.data.materials.clear()
    obj.data.materials.append(atlas_material)
    obj.data.update()


def main() -> None:
    args = parse_args()
    targets = sorted(
        (obj for obj in bpy.data.objects if is_bleacher_object(obj)),
        key=lambda obj: obj.name,
    )
    if len(targets) != 13:
        raise RuntimeError(f"expected 13 bleacher targets, found {len(targets)}")

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
    }
    print(json.dumps(report, indent=2))
    if args.dry_run:
        return

    image = create_atlas_image()
    material = create_atlas_material(image)
    for obj in pending:
        collapse_object(obj, material)

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