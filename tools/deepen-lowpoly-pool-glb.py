"""Deepen the runtime low-poly pool GLB.

The source Blender executable is not always available in the local toolchain, so
this script applies a small, deterministic geometry patch directly to the GLB:
floor and floor markings are lowered, and four simple inner wall meshes are
added so the deeper basin has visible sides.

Usage:
python tools/deepen-lowpoly-pool-glb.py --input assets/resources/pool/LowPolyPool.glb --output assets/resources/pool/LowPolyPool.glb
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import struct
from typing import Any


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

POOL_WATER_Y = 0.055
ORIGINAL_FLOOR_TOP_Y = -0.68
TARGET_DEPTH_MULTIPLIER = 2.0
DEPTH_DELTA = -(POOL_WATER_Y - ORIGINAL_FLOOR_TOP_Y) * (TARGET_DEPTH_MULTIPLIER - 1.0)
TARGET_FLOOR_TOP_Y = ORIGINAL_FLOOR_TOP_Y + DEPTH_DELTA

WALL_MATERIAL_NAME = "LPVenue_cartoon_pool_tile_white"
WALL_NODE_PREFIX = "pool_inner_wall_deep_"

FLOOR_TOP_OFFSETS = {
    "pool_floor": 0.0,
    "lane_floor_line_": 0.042,
    "lane_t_end_far_": 0.063,
    "lane_t_end_near_": 0.063,
    "pool_tile_grout_cross_": 0.054,
    "pool_tile_grout_long_": 0.051,
}


def pad4(data: bytes, pad: bytes) -> bytes:
    return data + pad * ((4 - len(data) % 4) % 4)


def read_glb(path: pathlib.Path) -> tuple[dict[str, Any], bytes]:
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2 or length != len(data):
        raise ValueError(f"{path} is not a valid GLB v2 file")

    gltf: dict[str, Any] | None = None
    binary = b""
    offset = 12
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == JSON_CHUNK:
            gltf = json.loads(chunk.rstrip(b" \t\r\n\x00").decode("utf-8"))
        elif chunk_type == BIN_CHUNK:
            binary = chunk

    if gltf is None:
        raise ValueError(f"{path} has no JSON chunk")
    return gltf, binary


def write_glb(path: pathlib.Path, gltf: dict[str, Any], binary: bytes) -> None:
    json_bytes = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    bin_bytes = pad4(binary, b"\x00")
    total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    output = bytearray()
    output += struct.pack("<III", 0x46546C67, 2, total_length)
    output += struct.pack("<II", len(json_bytes), JSON_CHUNK)
    output += json_bytes
    output += struct.pack("<II", len(bin_bytes), BIN_CHUNK)
    output += bin_bytes
    path.write_bytes(output)


def accessor_position_max_y(gltf: dict[str, Any], mesh_index: int) -> float:
    mesh = gltf["meshes"][mesh_index]
    max_y = -math.inf
    for primitive in mesh.get("primitives", []):
        position_accessor = primitive.get("attributes", {}).get("POSITION")
        if position_accessor is None:
            continue
        accessor = gltf["accessors"][position_accessor]
        max_y = max(max_y, accessor.get("max", [0.0, 0.0, 0.0])[1])
    if not math.isfinite(max_y):
        raise ValueError(f"mesh {mesh_index} has no POSITION max")
    return max_y


def floor_top_offset(name: str) -> float | None:
    for prefix, offset in FLOOR_TOP_OFFSETS.items():
        if name.startswith(prefix):
            return offset
    return None


def lower_floor_nodes(gltf: dict[str, Any]) -> list[str]:
    changed: list[str] = []
    for node in gltf.get("nodes", []):
        name = node.get("name", "")
        top_offset = floor_top_offset(name)
        if top_offset is None:
            continue
        mesh_index = node.get("mesh")
        if mesh_index is None:
            continue
        translation = node.setdefault("translation", [0.0, 0.0, 0.0])
        translation[1] = TARGET_FLOOR_TOP_Y + top_offset - accessor_position_max_y(gltf, mesh_index)
        changed.append(name)
    return changed


def material_index(gltf: dict[str, Any], name: str) -> int:
    for index, material in enumerate(gltf.get("materials", [])):
        if material.get("name") == name:
            return index
    raise ValueError(f"missing material {name}")


def cube_geometry(size: tuple[float, float, float]) -> tuple[list[float], list[int]]:
    sx, sy, sz = (value * 0.5 for value in size)
    positions = [
        -sx, -sy, -sz,
        sx, -sy, -sz,
        sx, sy, -sz,
        -sx, sy, -sz,
        -sx, -sy, sz,
        sx, -sy, sz,
        sx, sy, sz,
        -sx, sy, sz,
    ]
    indices = [
        0, 1, 2, 0, 2, 3,
        5, 4, 7, 5, 7, 6,
        4, 0, 3, 4, 3, 7,
        1, 5, 6, 1, 6, 2,
        3, 2, 6, 3, 6, 7,
        4, 5, 1, 4, 1, 0,
    ]
    return positions, indices


def append_aligned(binary: bytes, payload: bytes) -> tuple[bytes, int]:
    padded = pad4(binary, b"\x00")
    offset = len(padded)
    return padded + payload, offset


def add_accessor(
    gltf: dict[str, Any],
    binary: bytes,
    payload: bytes,
    *,
    component_type: int,
    count: int,
    type_name: str,
    mins: list[float] | None = None,
    maxs: list[float] | None = None,
) -> tuple[bytes, int]:
    binary, byte_offset = append_aligned(binary, payload)
    buffer_view_index = len(gltf.setdefault("bufferViews", []))
    gltf["bufferViews"].append({
        "buffer": 0,
        "byteOffset": byte_offset,
        "byteLength": len(payload),
    })
    accessor: dict[str, Any] = {
        "bufferView": buffer_view_index,
        "byteOffset": 0,
        "componentType": component_type,
        "count": count,
        "type": type_name,
    }
    if mins is not None:
        accessor["min"] = mins
    if maxs is not None:
        accessor["max"] = maxs
    accessor_index = len(gltf.setdefault("accessors", []))
    gltf["accessors"].append(accessor)
    return binary, accessor_index


def add_wall(
    gltf: dict[str, Any],
    binary: bytes,
    *,
    name: str,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    material: int,
) -> bytes:
    for node in gltf.get("nodes", []):
        if node.get("name") == name:
            node["translation"] = list(center)
            return binary

    positions, indices = cube_geometry(size)
    pos_payload = struct.pack(f"<{len(positions)}f", *positions)
    idx_payload = struct.pack(f"<{len(indices)}H", *indices)
    mins = [-size[0] * 0.5, -size[1] * 0.5, -size[2] * 0.5]
    maxs = [size[0] * 0.5, size[1] * 0.5, size[2] * 0.5]

    binary, position_accessor = add_accessor(
        gltf,
        binary,
        pos_payload,
        component_type=5126,
        count=8,
        type_name="VEC3",
        mins=mins,
        maxs=maxs,
    )
    binary, index_accessor = add_accessor(
        gltf,
        binary,
        idx_payload,
        component_type=5123,
        count=len(indices),
        type_name="SCALAR",
        mins=[min(indices)],
        maxs=[max(indices)],
    )

    mesh_index = len(gltf.setdefault("meshes", []))
    gltf["meshes"].append({
        "name": f"{name}_mesh",
        "primitives": [{
            "attributes": {"POSITION": position_accessor},
            "indices": index_accessor,
            "material": material,
            "mode": 4,
        }],
    })

    node_index = len(gltf.setdefault("nodes", []))
    gltf["nodes"].append({
        "name": name,
        "mesh": mesh_index,
        "translation": list(center),
    })

    roots = gltf.get("scenes", [{}])[gltf.get("scene", 0)].get("nodes", [])
    if roots and gltf["nodes"][roots[0]].get("name") == "LowPolyPool":
        gltf["nodes"][roots[0]].setdefault("children", []).append(node_index)
    else:
        gltf["scenes"][gltf.get("scene", 0)].setdefault("nodes", []).append(node_index)
    return binary


def add_inner_walls(gltf: dict[str, Any], binary: bytes) -> bytes:
    material = material_index(gltf, WALL_MATERIAL_NAME)
    wall_top_y = 0.02
    wall_bottom_y = TARGET_FLOOR_TOP_Y
    wall_height = wall_top_y - wall_bottom_y
    wall_center_y = (wall_top_y + wall_bottom_y) * 0.5
    thickness = 0.12

    walls = [
        ("north", (25.0, wall_center_y, -10.56), (50.0, wall_height, thickness)),
        ("south", (25.0, wall_center_y, 10.56), (50.0, wall_height, thickness)),
        ("west", (-0.06, wall_center_y, 0.0), (thickness, wall_height, 21.0)),
        ("east", (50.06, wall_center_y, 0.0), (thickness, wall_height, 21.0)),
    ]
    for side, center, size in walls:
        binary = add_wall(
            gltf,
            binary,
            name=f"{WALL_NODE_PREFIX}{side}",
            center=center,
            size=size,
            material=material,
        )
    return binary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    gltf, binary = read_glb(args.input)
    lowered = lower_floor_nodes(gltf)
    binary = add_inner_walls(gltf, binary)
    gltf.setdefault("buffers", [{"byteLength": 0}])[0]["byteLength"] = len(pad4(binary, b"\x00"))
    write_glb(args.output, gltf, binary)
    depth = POOL_WATER_Y - TARGET_FLOOR_TOP_Y
    print(f"lowered_nodes={len(lowered)} depth={depth:.3f} delta={DEPTH_DELTA:.3f}")


if __name__ == "__main__":
    main()
