"""Refresh the two low-poly pool meshes in Cocos' generated library cache.

This is only needed when Creator keeps serving an older GLB import while the
editor file watcher is paused. The authored source remains the Blender/GLB pair.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UUID = "a751d540-5ebd-4868-a41a-334975b3aed3"
LIB = ROOT / "library" / "a7"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def patch_wall() -> None:
    bin_path = LIB / f"{UUID}@abf3a.bin"
    json_path = LIB / f"{UUID}@abf3a.json"
    data = bytearray(bin_path.read_bytes())
    stride = 48
    for vertex in range(16):
        base = vertex * stride
        x = struct.unpack_from("<f", data, base)[0]
        z = struct.unpack_from("<f", data, base + 8)[0]
        if abs(x) < 1e-4:
            x = 0.03
        elif abs(x - 50.0) < 1e-4:
            x = 49.97
        if abs(abs(z) - 10.5) < 1e-4:
            z = 10.48 if z > 0 else -10.48
        struct.pack_into("<f", data, base, x)
        struct.pack_into("<f", data, base + 8, z)
    bin_path.write_bytes(data)
    mesh = read_json(json_path)
    mesh["_struct"]["minPosition"].update(x=0.03, z=-10.48)
    mesh["_struct"]["maxPosition"].update(x=49.97, z=10.48)
    write_json(json_path, mesh)


def patch_water() -> None:
    bin_path = LIB / f"{UUID}@fa0d6.bin"
    json_path = LIB / f"{UUID}@fa0d6.json"
    stride = 48
    # Cocos coordinates: x is course axis, y is vertical, z is lane axis.
    verts = [
        (-50.0, -0.15, -10.5, 0.0, 1.0, 0.0, 0.0, 0.0),
        (0.0, -0.15, -10.5, 0.0, 1.0, 0.0, 1.0, 0.0),
        (0.0, -0.15, 10.5, 0.0, 1.0, 0.0, 1.0, 1.0),
        (-50.0, -0.15, 10.5, 0.0, 1.0, 0.0, 0.0, 1.0),
    ]
    out = bytearray()
    for values in verts:
        out.extend(struct.pack("<8f", *values))
        # Tangent is the final vec4 in the 48-byte interleaved vertex.
        out.extend(struct.pack("<4f", 1.0, 0.0, 0.0, 1.0))
    out.extend(struct.pack("<6H", 0, 1, 2, 0, 2, 3))
    bin_path.write_bytes(out)
    mesh = read_json(json_path)
    primitive = mesh["_struct"]["primitives"][0]
    primitive["indexView"].update(offset=192, length=12, count=6)
    bundle = mesh["_struct"]["vertexBundles"][0]
    bundle["view"].update(length=192, count=4)
    mesh["_struct"]["minPosition"].update(x=-50.0, y=-0.15, z=-10.5)
    mesh["_struct"]["maxPosition"].update(x=0.0, y=-0.15, z=10.5)
    write_json(json_path, mesh)


def patch_meta() -> None:
    path = ROOT / "assets" / "race" / "pool" / "LowPolyPool.glb.meta"
    meta = read_json(path)
    for sub in meta.get("subMetas", {}).values():
        user_data = sub.get("userData", {})
        if user_data.get("gltfIndex") == 8:
            sub["name"] = "立方体.003_TopOnly.mesh"
            user_data["triangleCount"] = 2
    write_json(path, meta)


if __name__ == "__main__":
    patch_wall()
    patch_water()
    patch_meta()
    print("patched pool wall/water library cache")
